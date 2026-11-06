import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ProjectStatus } from '@prisma/client';
import {
  buildPaginationMeta,
  canTransitionProjectStatus,
  type ProjectDetailDto,
  type ProjectDto,
  type ProjectListQuery,
  type ProjectMemberDto,
  type SiteDto,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';
import { SyncEventsService } from '../../common/sync-events.service.js';

/**
 * Projeler ve şantiyeler servisi (Faz 03).
 *
 * Kapsam modeli (docs/06):
 * - FIRM_ADMIN tüm projelere erişir.
 * - Diğer roller yalnızca ProjectMember olduğu projeleri görür; kapsam dışı
 *   proje hiç var olmamış gibi 404 döner (IDOR koruması — mevcudiyet sızdırılmaz).
 * - Yetki (project.view / project.edit) PermissionsGuard'da global izin olarak,
 *   üyelik ise burada nesne seviyesinde kontrol edilir.
 *
 * Arşivleme silme değildir: status ARCHIVED olur, bağlı şantiye/üyeler korunur.
 */

/** ISO DateTime → YYYY-MM-DD (DATE kolonu UTC gece yarısı döner; kayma yaşanmaz). */
function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

interface Actor {
  userId: string;
  roles: string[];
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly syncEvents: SyncEventsService,
  ) {}

  /** Kullanıcının rollerini DB'den taze okur (rol düşürme anında etkili olsun). */
  private async getActor(userId: string): Promise<Actor> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { roles: { select: { role: { select: { key: true } } } } },
    });
    return { userId, roles: user?.roles.map((r) => r.role.key) ?? [] };
  }

  private isAdmin(actor: Actor): boolean {
    return actor.roles.includes('FIRM_ADMIN');
  }

  /**
   * Projeyi aktör kapsamıyla bulur: admin değilse üyelik zorunludur.
   * Kapsam dışı / olmayan proje ayırt edilemez — ikisi de 404 döner.
   */
  private async getProjectInScope(actor: Actor, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { members: { where: { userId: actor.userId }, select: { id: true } } },
    });
    if (!project) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });
    if (!this.isAdmin(actor) && project.members.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });
    }
    return project;
  }

  private static toDto(
    project: Prisma.ProjectGetPayload<{
      include: { manager: { select: { id: true; fullName: true } }; _count: { select: { sites: true; members: true } } };
    }>,
  ): ProjectDto {
    return {
      id: project.id,
      code: project.code,
      name: project.name,
      clientName: project.clientName,
      description: project.description,
      address: project.address,
      startDate: dateOnly(project.startDate),
      plannedEndDate: dateOnly(project.plannedEndDate),
      actualEndDate: dateOnly(project.actualEndDate),
      contractAmount: project.contractAmount ? project.contractAmount.toFixed(2) : null,
      currency: project.currency,
      status: project.status,
      manager: project.manager?.id ? { id: project.manager.id, fullName: project.manager.fullName } : null,
      siteCount: project._count.sites,
      memberCount: project._count.members,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  // ---------- Liste ----------

  async list(userId: string, query: ProjectListQuery) {
    const actor = await this.getActor(userId);
    const where: Prisma.ProjectWhereInput = {
      // Varsayılan liste arşivlenenleri gizler; status=ARCHIVED filtresiyle görünür.
      status: query.status ?? { not: 'ARCHIVED' },
      ...(query.managerId ? { managerId: query.managerId } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' as const } },
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { clientName: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      // Kapsam: admin dışındaki roller yalnızca üyesi olduğu projeleri görür.
      ...(!this.isAdmin(actor) ? { members: { some: { userId: actor.userId } } } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          manager: { select: { id: true, fullName: true } },
          _count: { select: { sites: true, members: true } },
        },
      }),
    ]);

    return { data: rows.map(ProjectsService.toDto), meta: buildPaginationMeta(query.page, query.pageSize, total) };
  }

  // ---------- Detay ----------

  async detail(userId: string, projectId: string): Promise<ProjectDetailDto> {
    const actor = await this.getActor(userId);
    await this.getProjectInScope(actor, projectId);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        manager: { select: { id: true, fullName: true } },
        _count: { select: { sites: true, members: true } },
      },
    });
    if (!project) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });

    const [sites, members] = await Promise.all([
      this.prisma.site.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.projectMember.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, fullName: true, email: true } } },
      }),
    ]);

    const siteDtos: SiteDto[] = sites.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      name: s.name,
      address: s.address,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    }));

    const memberDtos: ProjectMemberDto[] = members.map((m) => ({
      id: m.id,
      userId: m.userId,
      fullName: m.user.fullName,
      email: m.user.email,
      scopeRole: m.scopeRole as ProjectMemberDto['scopeRole'],
      isManager: m.userId === project.managerId,
      createdAt: m.createdAt.toISOString(),
    }));

    return {
      ...ProjectsService.toDto(project),
      sites: siteDtos,
      members: memberDtos,
    };
  }

  // ---------- Oluşturma ----------

  async create(
    actorUserId: string,
    input: {
      code: string;
      name: string;
      clientName?: string;
      description?: string;
      address?: string;
      startDate?: string;
      plannedEndDate?: string;
      actualEndDate?: string;
      contractAmount?: string;
      currency: string;
      managerId?: string;
    },
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ProjectDto> {
    const actor = await this.getActor(actorUserId);
    const code = input.code.trim();

    const existing = await this.prisma.project.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Bu proje kodu zaten kullanımda' });
    }

    if (input.managerId) {
      const manager = await this.prisma.user.findFirst({
        where: { id: input.managerId, deletedAt: null, status: 'ACTIVE' },
      });
      if (!manager) {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Seçilen sorumlu bulunamadı veya aktif değil' });
      }
    }

    // Üyelikler: admin olmayan oluşturucu otomatik MANAGER üye olur; sorumlu da üye eklenir.
    const memberships = new Map<string, string>();
    if (!this.isAdmin(actor)) memberships.set(actor.userId, 'MANAGER');
    if (input.managerId) memberships.set(input.managerId, 'MANAGER');

    const project = await this.prisma.project.create({
      data: {
        code,
        name: input.name,
        clientName: input.clientName,
        description: input.description,
        address: input.address,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        plannedEndDate: input.plannedEndDate ? new Date(input.plannedEndDate) : undefined,
        actualEndDate: input.actualEndDate ? new Date(input.actualEndDate) : undefined,
        contractAmount: input.contractAmount !== undefined ? input.contractAmount : undefined,
        currency: input.currency,
        managerId: input.managerId,
        status: 'PLANNING',
        members: {
          create: [...memberships.entries()].map(([userId, scopeRole]) => ({
            userId,
            scopeRole,
            assignedBy: actor.userId,
          })),
        },
      },
      include: {
        manager: { select: { id: true, fullName: true } },
        _count: { select: { sites: true, members: true } },
      },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'project.created',
      entityType: 'Project',
      entityId: project.id,
      after: { code: project.code, name: project.name, status: project.status, managerId: project.managerId },
      ...meta,
    });

    // Faz 09: yeni proje, pull ile cihaz referansına düşer.
    await this.syncEvents.record({
      entityType: 'project',
      entityId: project.id,
      operation: 'upsert',
      projectId: project.id,
      actorId: actor.userId,
    });

    return ProjectsService.toDto(project);
  }

  // ---------- Güncelleme ----------

  async update(
    actorUserId: string,
    projectId: string,
    input: {
      name?: string;
      clientName?: string | null;
      description?: string | null;
      address?: string | null;
      startDate?: string | null;
      plannedEndDate?: string | null;
      actualEndDate?: string | null;
      contractAmount?: string | null;
      currency?: string;
      status?: ProjectStatus;
      managerId?: string | null;
    },
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ProjectDto> {
    const actor = await this.getActor(actorUserId);
    const before = await this.getProjectInScope(actor, projectId);

    // Durum geçişi kurallı: geçersiz geçiş 400 (contracts matrisi).
    if (input.status && input.status !== before.status) {
      if (!canTransitionProjectStatus(before.status, input.status)) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `Geçersiz durum geçişi: ${before.status} → ${input.status}`,
        });
      }
    }

    // Tarih tutarlılığı: birleşik nihai değerlerle başlangıç ≤ planlanan bitiş.
    const nextStart = input.startDate !== undefined ? input.startDate : dateOnly(before.startDate);
    const nextPlanned = input.plannedEndDate !== undefined ? input.plannedEndDate : dateOnly(before.plannedEndDate);
    if (nextStart && nextPlanned && nextStart > nextPlanned) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Planlanan bitiş tarihi başlangıçtan önce olamaz',
      });
    }

    if (input.managerId) {
      const manager = await this.prisma.user.findFirst({
        where: { id: input.managerId, deletedAt: null, status: 'ACTIVE' },
      });
      if (!manager) {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Seçilen sorumlu bulunamadı veya aktif değil' });
      }
    }

    const data: Prisma.ProjectUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.clientName !== undefined ? { clientName: input.clientName } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.startDate !== undefined
        ? { startDate: input.startDate ? new Date(input.startDate) : null }
        : {}),
      ...(input.plannedEndDate !== undefined
        ? { plannedEndDate: input.plannedEndDate ? new Date(input.plannedEndDate) : null }
        : {}),
      ...(input.actualEndDate !== undefined
        ? { actualEndDate: input.actualEndDate ? new Date(input.actualEndDate) : null }
        : {}),
      ...(input.contractAmount !== undefined ? { contractAmount: input.contractAmount } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.managerId !== undefined
        ? { manager: input.managerId ? { connect: { id: input.managerId } } : { disconnect: true } }
        : {}),
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: projectId }, data });
      // Yeni sorumlu atandıysa projeye MANAGER rolüyle üye yapılır.
      if (input.managerId) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId, userId: input.managerId } },
          update: { scopeRole: 'MANAGER' },
          create: { projectId, userId: input.managerId, scopeRole: 'MANAGER', assignedBy: actor.userId },
        });
      }
    });

    const after = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        manager: { select: { id: true, fullName: true } },
        _count: { select: { sites: true, members: true } },
      },
    });
    if (!after) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });

    if (input.status && input.status !== before.status) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: input.status === 'ARCHIVED' ? 'project.archived' : 'project.status_changed',
        entityType: 'Project',
        entityId: projectId,
        before: { status: before.status },
        after: { status: input.status },
        ...meta,
      });
    }

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'project.updated',
      entityType: 'Project',
      entityId: projectId,
      before: {
        name: before.name,
        clientName: before.clientName,
        managerId: before.managerId,
        status: before.status,
      },
      after: {
        name: after.name,
        clientName: after.clientName,
        managerId: after.managerId,
        status: after.status,
      },
      ...meta,
    });

    // Arşiv/status değişimi de cihaza delta olarak taşınır.
    await this.syncEvents.record({
      entityType: 'project',
      entityId: projectId,
      operation: 'upsert',
      projectId,
      actorId: actor.userId,
    });

    return ProjectsService.toDto(after);
  }

  // ---------- Şantiyeler ----------

  async listSites(userId: string, projectId: string): Promise<{ data: SiteDto[] }> {
    const actor = await this.getActor(userId);
    await this.getProjectInScope(actor, projectId);
    const sites = await this.prisma.site.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    return {
      data: sites.map((s) => ({
        id: s.id,
        projectId: s.projectId,
        name: s.name,
        address: s.address,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  async createSite(
    actorUserId: string,
    projectId: string,
    input: { name: string; address?: string },
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<SiteDto> {
    const actor = await this.getActor(actorUserId);
    const project = await this.getProjectInScope(actor, projectId);

    const duplicate = await this.prisma.site.findUnique({
      where: { projectId_name: { projectId, name: input.name.trim() } },
    });
    if (duplicate) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Bu adda şantiye bu projede zaten mevcut' });
    }

    const site = await this.prisma.site.create({
      data: { projectId: project.id, name: input.name.trim(), address: input.address },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'site.created',
      entityType: 'Site',
      entityId: site.id,
      after: { projectId, name: site.name },
      ...meta,
    });

    await this.syncEvents.record({
      entityType: 'site',
      entityId: site.id,
      operation: 'upsert',
      projectId,
      actorId: actor.userId,
    });

    return {
      id: site.id,
      projectId: site.projectId,
      name: site.name,
      address: site.address,
      status: site.status,
      createdAt: site.createdAt.toISOString(),
    };
  }

  async updateSite(
    actorUserId: string,
    projectId: string,
    siteId: string,
    input: { name?: string; address?: string | null; status?: 'ACTIVE' | 'INACTIVE' },
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<SiteDto> {
    const actor = await this.getActor(actorUserId);
    await this.getProjectInScope(actor, projectId);

    // Şantiye yalnızca bağlı olduğu projeden güncellenebilir (yanlış proje → 404).
    const site = await this.prisma.site.findFirst({ where: { id: siteId, projectId } });
    if (!site) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Şantiye bulunamadı' });

    if (input.name !== undefined && input.name.trim() !== site.name) {
      const duplicate = await this.prisma.site.findUnique({
        where: { projectId_name: { projectId, name: input.name.trim() } },
      });
      if (duplicate) {
        throw new ConflictException({ code: 'CONFLICT', message: 'Bu adda şantiye bu projede zaten mevcut' });
      }
    }

    const updated = await this.prisma.site.update({
      where: { id: siteId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'site.updated',
      entityType: 'Site',
      entityId: siteId,
      before: { name: site.name, status: site.status },
      after: { name: updated.name, status: updated.status },
      ...meta,
    });

    await this.syncEvents.record({
      entityType: 'site',
      entityId: siteId,
      operation: 'upsert',
      projectId: updated.projectId,
      actorId: actor.userId,
    });

    return {
      id: updated.id,
      projectId: updated.projectId,
      name: updated.name,
      address: updated.address,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  // ---------- Üyeler ----------

  async listMembers(userId: string, projectId: string): Promise<{ data: ProjectMemberDto[] }> {
    const actor = await this.getActor(userId);
    const project = await this.getProjectInScope(actor, projectId);
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });
    return {
      data: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        fullName: m.user.fullName,
        email: m.user.email,
        scopeRole: m.scopeRole as ProjectMemberDto['scopeRole'],
        isManager: m.userId === project.managerId,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async addMember(
    actorUserId: string,
    projectId: string,
    input: { userId: string; scopeRole: string },
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ProjectMemberDto> {
    const actor = await this.getActor(actorUserId);
    const project = await this.getProjectInScope(actor, projectId);

    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, deletedAt: null, status: 'ACTIVE' },
    });
    if (!user) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Kullanıcı bulunamadı veya aktif değil' });
    }

    const duplicate = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: input.userId } },
    });
    if (duplicate) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Kullanıcı bu projede zaten üye' });
    }

    const member = await this.prisma.projectMember.create({
      data: {
        projectId,
        userId: input.userId,
        scopeRole: input.scopeRole,
        assignedBy: actor.userId,
      },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'project.member_added',
      entityType: 'Project',
      entityId: projectId,
      after: { memberId: member.id, userId: input.userId, scopeRole: input.scopeRole },
      ...meta,
    });

    return {
      id: member.id,
      userId: member.userId,
      fullName: user.fullName,
      email: user.email,
      scopeRole: member.scopeRole as ProjectMemberDto['scopeRole'],
      isManager: member.userId === project.managerId,
      createdAt: member.createdAt.toISOString(),
    };
  }

  async updateMember(
    actorUserId: string,
    projectId: string,
    memberId: string,
    input: { scopeRole: string },
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ProjectMemberDto> {
    const actor = await this.getActor(actorUserId);
    const project = await this.getProjectInScope(actor, projectId);

    const member = await this.prisma.projectMember.findFirst({ where: { id: memberId, projectId } });
    if (!member) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje üyesi bulunamadı' });

    const updated = await this.prisma.projectMember.update({
      where: { id: memberId },
      data: { scopeRole: input.scopeRole },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'project.member_updated',
      entityType: 'Project',
      entityId: projectId,
      before: { memberId, scopeRole: member.scopeRole },
      after: { memberId, scopeRole: input.scopeRole },
      ...meta,
    });

    return {
      id: updated.id,
      userId: updated.userId,
      fullName: updated.user.fullName,
      email: updated.user.email,
      scopeRole: updated.scopeRole as ProjectMemberDto['scopeRole'],
      isManager: updated.userId === project.managerId,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async removeMember(
    actorUserId: string,
    projectId: string,
    memberId: string,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<void> {
    const actor = await this.getActor(actorUserId);
    const project = await this.getProjectInScope(actor, projectId);

    const member = await this.prisma.projectMember.findFirst({ where: { id: memberId, projectId } });
    if (!member) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje üyesi bulunamadı' });

    await this.prisma.$transaction([
      this.prisma.projectMember.delete({ where: { id: memberId } }),
      // Sorumlu üyelikten çıkarılırsa proje sorumluluğu boşa düşer.
      ...(project.managerId === member.userId
        ? [this.prisma.project.update({ where: { id: projectId }, data: { managerId: null } })]
        : []),
    ]);

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'project.member_removed',
      entityType: 'Project',
      entityId: projectId,
      before: { memberId, userId: member.userId, scopeRole: member.scopeRole },
      after: { managerCleared: project.managerId === member.userId },
      ...meta,
    });
  }
}
