import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';
import { PasswordHasherService } from '../../common/password-hasher.service.js';
import { AuthService } from '../auth/auth.service.js';
import { buildPaginationMeta, SYSTEM_ROLES, type UserDto } from '@santiyepro/contracts';

/**
 * Kullanıcı yönetimi servisi (Faz 02).
 * Tüm işlemler 'user.manage' izniyle sınırlıdır (PermissionsGuard);
 * rol/status değişiklikleri ve Disable işlemleri denetim günlüğüne yazılır.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasherService,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
  ) {}

  async list(page: number, pageSize: number, search?: string): Promise<{ data: UserDto[]; meta: ReturnType<typeof buildPaginationMeta> }> {
    const where = {
      deletedAt: null,
      ...(search
        ? { OR: [{ fullName: { contains: search, mode: 'insensitive' as const } }, { email: { contains: search, mode: 'insensitive' as const } }] }
        : {}),
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { roles: { select: { role: { select: { key: true, label: true } } } } },
      }),
    ]);
    return {
      data: users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        status: u.status,
        roles: u.roles.map((r) => r.role.key),
        createdAt: u.createdAt.toISOString(),
      })),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async create(input: {
    fullName: string;
    email: string;
    phone?: string;
    password: string;
    roles: string[];
    actorUserId: string;
    meta: { ip: string; userAgent: string; traceId?: string };
  }): Promise<UserDto> {
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (existing) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Bu e-posta zaten kullanımda' });
    }
    const invalidRoles = input.roles.filter((r) => !(SYSTEM_ROLES as readonly string[]).includes(r));
    if (invalidRoles.length > 0) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Geçersiz rol seçimi' });
    }

    const passwordHash = await this.hasher.hash(input.password);
    const roleRecords = await this.prisma.role.findMany({ where: { key: { in: input.roles } } });
    const user = await this.prisma.user.create({
      data: {
        fullName: input.fullName,
        email,
        phone: input.phone,
        passwordHash,
        roles: { create: roleRecords.map((role) => ({ roleId: role.id })) },
      },
      include: { roles: { select: { role: { select: { key: true } } } } },
    });

    await this.audit.record({
      actorUserId: input.actorUserId,
      action: 'user.created',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, roles: input.roles },
      ...input.meta,
    });

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      roles: user.roles.map((r) => r.role.key),
      createdAt: user.createdAt.toISOString(),
    };
  }

  async update(input: {
    id: string;
    fullName?: string;
    phone?: string;
    status?: 'ACTIVE' | 'DISABLED';
    roles?: string[];
    actorUserId: string;
    meta: { ip: string; userAgent: string; traceId?: string };
  }): Promise<UserDto> {
    const before = await this.prisma.user.findFirst({
      where: { id: input.id, deletedAt: null },
      include: { roles: { select: { role: { select: { key: true } } } } },
    });
    if (!before) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Kullanıcı bulunamadı' });
    }
    const beforeRoles = before.roles.map((r) => r.role.key);

    if (input.status === 'DISABLED' && input.id === input.actorUserId) {
      // Kendini kilitleme koruması.
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Kendi hesabınızı devre dışı bırakamazsınız' });
    }

    if (input.roles) {
      const invalidRoles = input.roles.filter((r) => !(SYSTEM_ROLES as readonly string[]).includes(r));
      if (invalidRoles.length > 0) {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Geçersiz rol seçimi' });
      }
    }

    const data = {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };

    if (input.roles) {
      const nextRoleRecords = await this.prisma.role.findMany({ where: { key: { in: input.roles } } });
      const needsUpdate =
        input.fullName !== undefined || input.phone !== undefined || input.status !== undefined;
      await this.prisma.$transaction([
        this.prisma.userRole.deleteMany({ where: { userId: input.id } }),
        ...nextRoleRecords.map((role) =>
          this.prisma.userRole.create({ data: { userId: input.id, roleId: role.id } }),
        ),
        ...(needsUpdate ? [this.prisma.user.update({ where: { id: input.id }, data })] : []),
      ]);
    } else {
      await this.prisma.user.update({ where: { id: input.id }, data });
    }

    // Disable → tüm refresh token'ları iptal (docs/07; test maddesi 4).
    if (input.status === 'DISABLED') {
      await this.authService.revokeAllUserTokens(input.id);
    }

    const updated = await this.prisma.user.findUnique({
      where: { id: input.id },
      include: { roles: { select: { role: { select: { key: true } } } } },
    });

    const afterRoles = updated?.roles.map((r) => r.role.key) ?? [];

    await this.audit.record({
      actorUserId: input.actorUserId,
      action: input.status === 'DISABLED' ? 'user.disabled' : 'user.updated',
      entityType: 'User',
      entityId: input.id,
      before: {
        fullName: before.fullName,
        phone: before.phone,
        status: before.status,
        roles: beforeRoles,
      },
      after: {
        fullName: updated?.fullName,
        phone: updated?.phone,
        status: updated?.status,
        roles: afterRoles,
      },
      ...input.meta,
    });

    // Rol değişikliği ayrı denetim olayı (docs/06: rol değişiklikleri audit üretir).
    if (input.roles && (beforeRoles.length !== afterRoles.length || beforeRoles.some((r) => !afterRoles.includes(r)))) {
      await this.audit.record({
        actorUserId: input.actorUserId,
        action: 'user.role_changed',
        entityType: 'User',
        entityId: input.id,
        before: { roles: beforeRoles },
        after: { roles: afterRoles },
        ...input.meta,
      });
    }

    if (!updated) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Kullanıcı bulunamadı' });
    return {
      id: updated.id,
      fullName: updated.fullName,
      email: updated.email,
      phone: updated.phone,
      status: updated.status,
      roles: updated.roles.map((r) => r.role.key),
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async listRoles(): Promise<{ data: { key: string; label: string; isSystem: boolean }[] }> {
    const roles = await this.prisma.role.findMany({ orderBy: { key: 'asc' } });
    return { data: roles.map((r) => ({ key: r.key, label: r.label, isSystem: r.isSystem })) };
  }
}
