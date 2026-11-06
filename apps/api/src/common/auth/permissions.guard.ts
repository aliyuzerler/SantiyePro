import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { permissionsForRoles } from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PERMISSIONS_KEY } from './decorators.js';

/** Rol → izin önbelleği: rol değişiklikleri en geç TTL kadar gecikmeyle etkili olur. */
const PERMISSIONS_CACHE_TTL_MS = 30_000;

interface CachedPermissions {
  roles: string[];
  permissions: Set<string>;
  loadedAt: number;
}

/**
 * İzin guard'ı (deny-by-default): @RequirePermissions(...) ile işaretli uçlarda
 * kullanıcının rollerinden gelen izin kümesi kontrol edilir.
 * Roller DB'den taze okunur; böylece rol düşürme/Disable etkisi token ömrüne bağlı kalmaz.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly cache = new Map<string, CachedPermissions>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // İzin işaretlenmemişse yalnızca kimlik doğrulaması yeterli.
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: { userId: string; email: string } }>();
    const user = req.user;
    if (!user) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Yetkisiz erişim' });

    const effective = await this.loadUserPermissions(user.userId);
    if (!effective) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Yetkisiz erişim' });
    }
    for (const permission of required) {
      if (!effective.permissions.has(permission)) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Yetkisiz erişim' });
      }
    }
    return true;
  }

  /**
   * Dinamik (parametreli) izin kontrolü — Faz 10 rapor export ucu gibi tek
   * handler'ın anahtara göre farklı izin istediği uçlar için. Guard ile aynı
   * önbellek ve DB mantığını kullanır.
   */
  async assertPermission(userId: string, permission: string): Promise<void> {
    const effective = await this.loadUserPermissions(userId);
    if (!effective || !effective.permissions.has(permission)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Yetkisiz erişim' });
    }
  }

  private async loadUserPermissions(userId: string): Promise<CachedPermissions | null> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.loadedAt < PERMISSIONS_CACHE_TTL_MS) return cached;

    const dbUser = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        status: true,
        roles: { select: { role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
      },
    });
    if (!dbUser || dbUser.status !== 'ACTIVE') return null;

    const roles = dbUser.roles.map((r) => r.role.key);
    // DB'deki rol izinleri + contracts matrisi (sistem rolleri için tek doğruluk kaynağı)
    const permissions = permissionsForRoles(roles);
    const entry: CachedPermissions = { roles, permissions, loadedAt: Date.now() };
    this.cache.set(userId, entry);
    return entry;
  }

  /** Testlerde rol değişikliğinin anında yansıması için. */
  invalidateCache(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}
