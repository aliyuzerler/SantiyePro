import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JwtService } from '../../common/auth/jwt.service.js';
import { AuditService } from '../../common/audit.service.js';
import { PasswordHasherService } from '../../common/password-hasher.service.js';
import { RateLimiterService } from '../../common/rate-limiter.service.js';
import type { UserDto } from '@santiyepro/contracts';


export const REFRESH_COOKIE_NAME = 'santiyepro_rt';
export const REFRESH_TTL_DAYS = 30;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(sha256(a), 'hex');
  const bufB = Buffer.from(sha256(b), 'hex');
  return timingSafeEqual(bufA, bufB);
}

/**
 * Kimlik doğrulama servisi (Faz 02).
 *
 * Güvenlik kuralları (docs/07):
 * - Login hataları kullanıcı var/yok ayrımı yapmaz: tek generic mesaj.
 * - Refresh token'lar yalnızca SHA-256 hash olarak saklanır.
 * - Rotasyon: her refresh'te eski token iptal edilir, yenis verilir.
 * - Reuse tespiti: iptal edilmiş token yeniden kullanılırsa token ailesinin
 *   tamamı iptal edilir ve denetim günlüğüne yazılır.
 * - Kullanıcı Disable edilince tüm refresh token'ları iptal edilir.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly hasher: PasswordHasherService,
    private readonly rateLimiter: RateLimiterService,
    private readonly audit: AuditService,
  ) {}

  // ---------- İlk kurulum ----------

  /**
   * İlk admin kurulumu: yalnızca sistemde kullanıcı yokken ve setup token
   * eşleştiğinde çalışır. Varsayılan parola yoktur — parola operatör tarafından
   * kurulum anında belirlenir. Token constant-time karşılaştırılır.
   */
  async bootstrap(input: {
    setupToken: string;
    fullName: string;
    email: string;
    phone?: string;
    password: string;
    meta: { ip: string; userAgent: string; traceId?: string };
  }): Promise<void> {
    const expected = process.env.ADMIN_SETUP_TOKEN ?? '';
    if (expected.length < 20 || !constantTimeEquals(input.setupToken, expected)) {
      await this.audit.record({
        action: 'auth.bootstrap_rejected',
        entityType: 'User',
        ip: input.meta.ip,
        userAgent: input.meta.userAgent,
        traceId: input.meta.traceId,
      });
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Kurulum anahtarı geçersiz' });
    }

    const userCount = await this.prisma.user.count({ where: { deletedAt: null } });
    if (userCount > 0) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Kurulum daha önce tamamlandı' });
    }

    const passwordHash = await this.hasher.hash(input.password);
    const adminRole = await this.prisma.role.findUnique({ where: { key: 'FIRM_ADMIN' } });
    if (!adminRole) throw new Error('Sistem rolleri seed edilmemiş (prisma db seed)');
    const admin = await this.prisma.user.create({
      data: {
        fullName: input.fullName,
        email: input.email.toLowerCase(),
        phone: input.phone,
        passwordHash,
        roles: { create: [{ roleId: adminRole.id }] },
      },
    });

    await this.audit.record({
      actorUserId: admin.id,
      action: 'auth.bootstrap_completed',
      entityType: 'User',
      entityId: admin.id,
      after: { email: admin.email, roles: ['FIRM_ADMIN'] },
      ip: input.meta.ip,
      userAgent: input.meta.userAgent,
      traceId: input.meta.traceId,
    });
  }

  /** İlk kurulum gerekiyor mu (kurulum ekranı için). */
  async needsSetup(): Promise<boolean> {
    const count = await this.prisma.user.count({ where: { deletedAt: null } });
    return count === 0;
  }

  // ---------- Giriş ----------

  async login(input: {
    email: string;
    password: string;
    meta: { ip: string; userAgent: string; traceId?: string };
  }): Promise<{ accessToken: string; refreshToken: string; user: UserDto }> {
    const { email, password, meta } = input;
    const normalizedEmail = email.toLowerCase();

    // Rate limit: IP başına 30/15dk, e-posta başına 5/15dk (docs/07: artan gecikme + limit).
    const ipResult = this.rateLimiter.consume(`login:ip:${meta.ip}`, 30, 15 * 60_000);
    if (!ipResult.allowed) {
      await this.audit.record({
        action: 'auth.login_rate_limited',
        entityType: 'User',
        after: { scope: 'ip' },
        ip: meta.ip,
        userAgent: meta.userAgent,
        traceId: meta.traceId,
      });
      throw new UnauthorizedException({
        code: 'RATE_LIMITED',
        message: `Çok fazla deneme. ${ipResult.retryAfterSeconds} saniye sonra tekrar deneyin.`,
      });
    }
    const emailResult = this.rateLimiter.consume(`login:email:${normalizedEmail}`, 5, 15 * 60_000);
    if (!emailResult.allowed) {
      await this.audit.record({
        action: 'auth.login_rate_limited',
        entityType: 'User',
        after: { scope: 'email' },
        ip: meta.ip,
        userAgent: meta.userAgent,
        traceId: meta.traceId,
      });
      throw new UnauthorizedException({
        code: 'RATE_LIMITED',
        message: `Çok fazla deneme. ${emailResult.retryAfterSeconds} saniye sonra tekrar deneyin.`,
      });
    }

    const user = await this.prisma.user.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
      include: { roles: { select: { role: { select: { key: true } } } } },
    });

    const passwordOk = user ? await this.hasher.verify(user.passwordHash, password) : false;

    if (!user || !passwordOk || user.status !== 'ACTIVE') {
      // Kullanıcı var/yok ayrımı sızdırılmaz: tek generic mesaj (docs/07).
      await this.audit.record({
        actorUserId: user?.id ?? null,
        action: 'auth.login_failed',
        entityType: 'User',
        after: { email: normalizedEmail, reason: user?.status === 'DISABLED' ? 'disabled' : 'invalid_credentials' },
        ip: meta.ip,
        userAgent: meta.userAgent,
        traceId: meta.traceId,
      });
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'E-posta veya parola geçersiz' });
    }

    this.rateLimiter.reset(`login:email:${normalizedEmail}`);

    const roles = user.roles.map((r) => r.role.key);
    const accessToken = await this.jwt.signAccessToken({ sub: user.id, email: user.email });
    const refreshToken = await this.issueRefreshToken(user.id, meta);

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.login_success',
      entityType: 'User',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      traceId: meta.traceId,
    });

    return { accessToken, refreshToken, user: toUserDto(user, roles) };
  }

  // ---------- Refresh rotasyonu ----------

  async refresh(input: {
    refreshToken?: string;
    meta: { ip: string; userAgent: string; traceId?: string };
  }): Promise<{ accessToken: string; refreshToken: string; user: UserDto }> {
    const { meta } = input;
    const raw = input.refreshToken;
    if (!raw) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Oturum yenilenemedi' });
    }
    const tokenHash = sha256(raw);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: { roles: { select: { role: { select: { key: true } } } } },
        },
      },
    });

    if (!existing) {
      await this.audit.record({ action: 'auth.refresh_invalid', entityType: 'RefreshToken', ...meta });
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Oturum geçersiz' });
    }

    // Reuse tespiti: iptal edilmiş token yeniden geldi → ailenin tamamını iptal et.
    if (existing.revokedAt) {
      await this.revokeFamily(existing.familyId);
      await this.audit.record({
        actorUserId: existing.userId,
        action: 'auth.refresh_reuse_detected',
        entityType: 'RefreshToken',
        entityId: existing.id,
        after: { familyId: existing.familyId, allFamilyTokensRevoked: true },
        ...meta,
      });
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Oturum geçersiz' });
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Oturum süresi doldu' });
    }

    const user = existing.user;
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      // Disable edilen kullanıcının token'ları reddedilir (test maddesi 4).
      await this.revokeFamily(existing.familyId);
      await this.audit.record({
        actorUserId: existing.userId,
        action: 'auth.refresh_rejected_disabled_user',
        entityType: 'RefreshToken',
        entityId: existing.id,
        ...meta,
      });
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Oturum geçersiz' });
    }

    // Rotasyon: eskiyi iptal et, yeniden üret (aynı aile).
    const newRaw = randomBytes(48).toString('base64url');
    const newToken = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId: existing.familyId,
        tokenHash: sha256(newRaw),
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60_000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedBy: newToken.id },
    });

    const roles = user.roles.map((r) => r.role.key);
    const accessToken = await this.jwt.signAccessToken({ sub: user.id, email: user.email });
    return { accessToken, refreshToken: newRaw, user: toUserDto(user, roles) };
  }

  // ---------- Oturum kapatma ----------

  async logout(input: { refreshToken?: string; meta: { ip: string; userAgent: string; traceId?: string } }): Promise<void> {
    if (!input.refreshToken) return;
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(input.refreshToken) },
    });
    if (existing && !existing.revokedAt) {
      await this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
      await this.audit.record({
        actorUserId: existing.userId,
        action: 'auth.logout',
        entityType: 'RefreshToken',
        entityId: existing.id,
        ...input.meta,
      });
    }
  }

  // ---------- Parola işlemleri ----------

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    meta: { ip: string; userAgent: string; traceId?: string };
  }): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: input.userId, deletedAt: null } });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Oturum geçersiz' });

    const currentOk = await this.hasher.verify(user.passwordHash, input.currentPassword);
    if (!currentOk) {
      await this.audit.record({
        actorUserId: user.id,
        action: 'auth.password_change_failed',
        entityType: 'User',
        entityId: user.id,
        ...input.meta,
      });
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Mevcut parola geçersiz' });
    }

    const sameAsOld = await this.hasher.verify(user.passwordHash, input.newPassword);
    if (sameAsOld) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Yeni parola eski parola ile aynı olamaz' });
    }

    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      // Güvenlik: parola değişince diğer oturumlar düşer (docs/07).
      this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: user.id,
      ...input.meta,
    });
  }

  /** Parola sıfırlama isteği — var/yok ayrımı sızdırılmaz, her zaman 202. */
  async forgotPassword(input: {
    email: string;
    meta: { ip: string; userAgent: string; traceId?: string };
  }): Promise<{ requested: true }> {
    const user = await this.prisma.user.findFirst({
      where: { email: input.email.toLowerCase(), deletedAt: null, status: 'ACTIVE' },
    });
    if (user) {
      // Eski bekleyen token'ları iptal et, yeni tek kullanımlık token üret (15 dk).
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      const raw = randomBytes(32).toString('base64url');
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(raw),
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      });
      await this.audit.record({
        actorUserId: user.id,
        action: 'auth.password_reset_requested',
        entityType: 'User',
        entityId: user.id,
        ...input.meta,
      });
      // E-posta teslimatı Faz 11'de; şimdilik token yalnızca sunucu log ortamına yazılır.
      if (process.env.NODE_ENV !== 'production') {
        console.info(`[dev-only] Parola sıfırlama token'ı üretildi (e-posta teslimi yok): ${raw}`);
      }
    }
    return { requested: true };
  }

  async resetPassword(input: {
    token: string;
    newPassword: string;
    meta: { ip: string; userAgent: string; traceId?: string };
  }): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
      include: { user: true },
    });
    const valid =
      record &&
      !record.usedAt &&
      record.expiresAt.getTime() > Date.now() &&
      record.user &&
      !record.user.deletedAt &&
      record.user.status === 'ACTIVE';
    if (!valid) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Bağlantı geçersiz veya süresi dolmuş' });
    }
    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({
      actorUserId: record.userId,
      action: 'auth.password_reset_completed',
      entityType: 'User',
      entityId: record.userId,
      ...input.meta,
    });
  }

  // ---------- Oturum bilgisi ----------

  async me(userId: string): Promise<UserDto | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { roles: { select: { role: { select: { key: true } } } } },
    });
    if (!user || user.status !== 'ACTIVE') return null;
    return toUserDto(user, user.roles.map((r) => r.role.key));
  }

  // ---------- Yardımcılar ----------

  /** Kullanıcı Disable edildiğinde tüm refresh token'larını iptal et. */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueRefreshToken(
    userId: string,
    meta: { ip: string; userAgent: string },
  ): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId: randomUUID(),
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60_000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return raw;
  }
}

type UserWithRoles = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: string;
  createdAt: Date;
};

function toUserDto(user: UserWithRoles, roles: string[]): UserDto {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    status: user.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    roles,
    createdAt: user.createdAt.toISOString(),
  };
}


