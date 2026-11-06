import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import {
  buildPaginationMeta,
  canTransitionTaskStatus,
  isTaskOverdue,
  permissionsForRoles,
  type CreateTaskRequest,
  type TaskChecklistItem,
  type TaskCommentDto,
  type TaskDetailDto,
  type TaskDto,
  type TaskFileRef,
  type TaskListQuery,
  type TaskStatusHistoryEntry,
  type UpdateTaskRequest,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';
import { SyncEventsService } from '../../common/sync-events.service.js';

/**
 * Görev yönetimi servisi (Faz 04).
 *
 * Kapsam modeli (docs/06) — Projeler modülüyle aynı:
 * - FIRM_ADMIN tüm projelerin görevlerine erişir.
 * - Diğer roller yalnızca üyesi olduğu projenin görevlerini görür; kapsam dışı
 *   görev hiç var olmamış gibi 404 döner (IDOR koruması).
 *
 * Yetki modeli:
 * - task.view: uçlarda PermissionsGuard ile.
 * - task.edit: görev alanlarının düzenlenmesi (servis katmanında).
 * - task.assign: assigneeId değişikliği (servis katmanında; docs/06 "Görev atama").
 * - İstisna: atanan kişi kendi görevinin DURUMUNU her zaman değiştirebilir
 *   (saha akışı: Bana Atananlar → başlat/tamamla); diğer alanlar task.edit ister.
 *
 * Durum makinesi contracts'taki TASK_STATUS_TRANSITIONS matrisidir; geçersiz
 * geçiş 400 VALIDATION_ERROR döner. Her durum değişikliği TaskStatusHistory
 * üretir (autoincrement id ile katı sıra). Atamada Notification event'i yazılır
 * (uygulama içi bildirim altyapısının temeli; push sağlayıcısı sonraki faz).
 */

interface Actor {
  userId: string;
  roles: string[];
}

type TaskRow = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

const TASK_INCLUDE = {
  project: { select: { id: true, code: true, name: true } },
  site: { select: { id: true, name: true } },
  assignee: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;

@Injectable()
export class TasksService {
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

  private permissionsOf(actor: Actor): Set<string> {
    return permissionsForRoles(actor.roles);
  }

  /**
   * Görevi aktör kapsamıyla bulur: admin değilse görevin projesine üyelik zorunludur.
   * Kapsam dışı / olmayan görev ayırt edilemez — ikisi de 404 döner.
   */
  private async getTaskInScope(actor: Actor, taskId: string): Promise<TaskRow> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        ...TASK_INCLUDE,
        project: {
          select: {
            id: true,
            code: true,
            name: true,
            members: { where: { userId: actor.userId }, select: { id: true } },
          },
        },
      },
    });
    if (!task) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Görev bulunamadı' });
    if (!this.isAdmin(actor) && task.project.members.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Görev bulunamadı' });
    }
    return task;
  }

  /** Üyelik denetimli proje erişimi (oluşturma istekleri için). */
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

  private static checklistOf(raw: Prisma.JsonValue): TaskChecklistItem[] {
    return Array.isArray(raw) ? (raw as TaskChecklistItem[]) : [];
  }

  private static fileRefsOf(raw: Prisma.JsonValue): TaskFileRef[] {
    return Array.isArray(raw) ? (raw as TaskFileRef[]) : [];
  }

  private static toDto(task: TaskRow): TaskDto {
    const dueAt = task.dueAt ? task.dueAt.toISOString() : null;
    return {
      id: task.id,
      projectId: task.projectId,
      projectCode: task.project?.code,
      projectName: task.project?.name,
      siteId: task.siteId,
      siteName: task.site?.name ?? null,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId,
      assignee: task.assignee?.id ? { id: task.assignee.id, fullName: task.assignee.fullName } : null,
      dueAt,
      completedAt: task.completedAt ? task.completedAt.toISOString() : null,
      checklist: TasksService.checklistOf(task.checklist),
      fileRefs: TasksService.fileRefsOf(task.fileRefs),
      commentCount: task._count.comments,
      version: task.version,
      overdue: isTaskOverdue({ dueAt, status: task.status }),
      createdById: task.createdById,
      createdBy: task.createdBy?.id ? { id: task.createdBy.id, fullName: task.createdBy.fullName } : null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  // ---------- Liste ----------

  async list(userId: string, query: TaskListQuery) {
    const actor = await this.getActor(userId);
    const assigneeId = query.assigneeId === 'me' ? actor.userId : query.assigneeId;

    const where: Prisma.TaskWhereInput = {
      // Kapsam: admin dışındaki roller yalnızca üyesi olduğu projelerin görevlerini görür.
      ...(!this.isAdmin(actor) ? { project: { members: { some: { userId: actor.userId } } } } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(assigneeId ? { assigneeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.overdue === 'true'
        ? { dueAt: { lt: new Date() }, status: { notIn: ['DONE', 'CANCELLED'] as TaskStatus[] } }
        : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };

    const orderBy: Prisma.TaskOrderByWithRelationInput[] =
      query.sort === 'priority'
        ? [{ priority: query.order }, { createdAt: 'desc' }]
        : [{ [query.sort]: query.order }, { id: 'asc' }];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: TASK_INCLUDE,
      }),
    ]);

    return { data: rows.map(TasksService.toDto), meta: buildPaginationMeta(query.page, query.pageSize, total) };
  }

  // ---------- Detay ----------

  async detail(userId: string, taskId: string): Promise<TaskDetailDto> {
    const actor = await this.getActor(userId);
    const task = await this.getTaskInScope(actor, taskId);

    const [comments, history] = await Promise.all([
      this.prisma.taskComment.findMany({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { fullName: true } } },
      }),
      this.prisma.taskStatusHistory.findMany({
        where: { taskId },
        orderBy: { id: 'asc' },
        include: { changedBy: { select: { fullName: true } } },
      }),
    ]);

    const commentDtos: TaskCommentDto[] = comments.map((c) => ({
      id: c.id,
      taskId: c.taskId,
      userId: c.userId,
      userFullName: c.user.fullName,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    }));

    const historyDtos: TaskStatusHistoryEntry[] = history.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      changedById: h.changedById,
      changedByFullName: h.changedBy.fullName,
      changedAt: h.changedAt.toISOString(),
    }));

    return { ...TasksService.toDto(task), comments: commentDtos, statusHistory: historyDtos };
  }

  // ---------- Oluşturma ----------

  async create(
    actorUserId: string,
    input: CreateTaskRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<TaskDto> {
    const actor = await this.getActor(actorUserId);
    const perms = this.permissionsOf(actor);

    // Atama task.assign izni ister (docs/06: Görev atama satırı).
    if (input.assigneeId && !perms.has('task.assign')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Görev atama yetkiniz yok' });
    }

    const project = await this.getProjectInScope(actor, input.projectId);
    if (project.status === 'ARCHIVED') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Arşivlenmiş projeye görev eklenemez' });
    }

    if (input.siteId) {
      const site = await this.prisma.site.findFirst({ where: { id: input.siteId, projectId: input.projectId } });
      if (!site) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Şantiye bulunamadı' });
    }

    if (input.assigneeId) {
      await this.assertAssignableUser(input.assigneeId, input.projectId);
    }

    const checklist: TaskChecklistItem[] = (input.checklist ?? []).map((item) => ({
      id: randomUUID(),
      label: item.label,
      done: item.done,
    }));
    const fileRefs: TaskFileRef[] = input.fileRefs ?? [];

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          projectId: input.projectId,
          siteId: input.siteId ?? undefined,
          title: input.title,
          description: input.description,
          status: 'TODO',
          priority: input.priority,
          assigneeId: input.assigneeId ?? undefined,
          dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
          checklist,
          fileRefs,
          createdById: actor.userId,
        },
        include: TASK_INCLUDE,
      });

      // İlk geçmiş kaydı: null → TODO (tam sıra izlenebilir).
      await tx.taskStatusHistory.create({
        data: { taskId: created.id, fromStatus: null, toStatus: 'TODO', changedById: actor.userId },
      });

      await this.notifyAssignment(
        tx,
        created.id,
        created.title,
        created.projectId,
        input.assigneeId ?? null,
        actor.userId,
      );

      return created;
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'task.created',
      entityType: 'Task',
      entityId: task.id,
      after: {
        title: task.title,
        projectId: task.projectId,
        status: task.status,
        assigneeId: task.assigneeId,
        priority: task.priority,
      },
      ...meta,
    });

    // Faz 09: çevrimdışı cihazlar pull ile görsün (docs/09 olay günlüğü).
    await this.syncEvents.record({
      entityType: 'task',
      entityId: task.id,
      operation: 'upsert',
      projectId: task.projectId,
      actorId: actor.userId,
    });

    return TasksService.toDto(task);
  }

  // ---------- Güncelleme ----------

  async update(
    actorUserId: string,
    taskId: string,
    input: UpdateTaskRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<TaskDto> {
    const actor = await this.getActor(actorUserId);
    const perms = this.permissionsOf(actor);
    const before = await this.getTaskInScope(actor, taskId);

    // İyimser eşzamanlılık: eski sürümle güncelleme → 409 (docs/04 version alanı).
    if (input.version !== undefined && input.version !== before.version) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Kayıt başka bir güncellemeyle değişti; sayfayı yenileyin',
      });
    }

    const { status, ...restFields } = input;
    const fieldChanges = { ...restFields };
    // version yukarıda iyimser eşzamanlılık denetiminde kullanıldı; alan değişikliği değildir.
    delete fieldChanges.version;
    const hasFieldChanges = Object.keys(fieldChanges).length > 0;
    const isAssignee = before.assigneeId === actor.userId;

    // Durum dışı alan değişikliği task.edit ister.
    if (hasFieldChanges && !perms.has('task.edit')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Görev düzenleme yetkiniz yok' });
    }

    const statusChanges = status !== undefined && status !== before.status;
    // Durum değişikliği: task.edit yetkilisi VEYA atanan kişinin kendisi (saha akışı).
    if (statusChanges && !perms.has('task.edit') && !isAssignee) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Görevin durumunu yalnızca atanan kişi veya düzenleme yetkilisi değiştirebilir',
      });
    }

    // Durum makinesi: geçersiz geçiş 400 (contracts matrisi).
    if (statusChanges && !canTransitionTaskStatus(before.status, status)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Geçersiz durum geçişi: ${before.status} → ${status}`,
      });
    }

    // Atama değişikliği task.assign ister; hedef kullanıcı aktif proje üyesi olmalı.
    if (fieldChanges.assigneeId !== undefined && fieldChanges.assigneeId !== before.assigneeId) {
      if (!perms.has('task.assign')) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Görev atama yetkiniz yok' });
      }
      if (fieldChanges.assigneeId) {
        await this.assertAssignableUser(fieldChanges.assigneeId, before.projectId);
      }
    }

    if (fieldChanges.siteId) {
      const site = await this.prisma.site.findFirst({
        where: { id: fieldChanges.siteId, projectId: before.projectId },
      });
      if (!site) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Şantiye bulunamadı' });
    }

    const nextStatus: TaskStatus = status ?? before.status;
    const data: Prisma.TaskUpdateInput = {
      ...(fieldChanges.title !== undefined ? { title: fieldChanges.title } : {}),
      ...(fieldChanges.description !== undefined ? { description: fieldChanges.description } : {}),
      ...(fieldChanges.siteId !== undefined
        ? { site: fieldChanges.siteId ? { connect: { id: fieldChanges.siteId } } : { disconnect: true } }
        : {}),
      ...(statusChanges ? { status } : {}),
      ...(fieldChanges.priority !== undefined ? { priority: fieldChanges.priority as TaskPriority } : {}),
      ...(fieldChanges.assigneeId !== undefined
        ? { assignee: fieldChanges.assigneeId ? { connect: { id: fieldChanges.assigneeId } } : { disconnect: true } }
        : {}),
      ...(fieldChanges.dueAt !== undefined
        ? { dueAt: fieldChanges.dueAt ? new Date(fieldChanges.dueAt) : null }
        : {}),
      ...(fieldChanges.checklist !== undefined ? { checklist: fieldChanges.checklist } : {}),
      ...(fieldChanges.fileRefs !== undefined ? { fileRefs: fieldChanges.fileRefs } : {}),
      // DONE'a geçişte tamamlanma zamanı; DONE terminal olduğu için geri dönüş yoktur.
      ...(statusChanges ? { completedAt: nextStatus === 'DONE' ? new Date() : null } : {}),
      version: { increment: 1 },
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id: taskId }, data });
      if (statusChanges) {
        await tx.taskStatusHistory.create({
          data: { taskId, fromStatus: before.status, toStatus: nextStatus, changedById: actor.userId },
        });
      }
      if (fieldChanges.assigneeId !== undefined && fieldChanges.assigneeId !== before.assigneeId) {
        await this.notifyAssignment(tx, taskId, before.title, before.projectId, fieldChanges.assigneeId, actor.userId);
      }
    });

    const after = await this.prisma.task.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
    if (!after) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Görev bulunamadı' });

    if (statusChanges) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: 'task.status_changed',
        entityType: 'Task',
        entityId: taskId,
        before: { status: before.status },
        after: { status: nextStatus },
        ...meta,
      });
    }

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'task.updated',
      entityType: 'Task',
      entityId: taskId,
      before: {
        title: before.title,
        status: before.status,
        priority: before.priority,
        assigneeId: before.assigneeId,
        dueAt: before.dueAt?.toISOString() ?? null,
      },
      after: {
        title: after.title,
        status: after.status,
        priority: after.priority,
        assigneeId: after.assigneeId,
        dueAt: after.dueAt?.toISOString() ?? null,
      },
      ...meta,
    });

    await this.syncEvents.record({
      entityType: 'task',
      entityId: taskId,
      operation: 'upsert',
      projectId: after.projectId,
      actorId: actor.userId,
    });

    return TasksService.toDto(after);
  }

  // ---------- Yorumlar ----------

  async listComments(userId: string, taskId: string): Promise<{ data: TaskCommentDto[] }> {
    const actor = await this.getActor(userId);
    await this.getTaskInScope(actor, taskId);
    const comments = await this.prisma.taskComment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { fullName: true } } },
    });
    return {
      data: comments.map((c) => ({
        id: c.id,
        taskId: c.taskId,
        userId: c.userId,
        userFullName: c.user.fullName,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  async addComment(
    actorUserId: string,
    taskId: string,
    body: string,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<TaskCommentDto> {
    const actor = await this.getActor(actorUserId);
    const task = await this.getTaskInScope(actor, taskId);

    const comment = await this.prisma.taskComment.create({
      data: { taskId, userId: actor.userId, body },
      include: { user: { select: { fullName: true } } },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'task.commented',
      entityType: 'Task',
      entityId: taskId,
      after: { commentId: comment.id, taskId, title: task.title },
      ...meta,
    });

    await this.syncEvents.record({
      entityType: 'taskComment',
      entityId: comment.id,
      operation: 'upsert',
      projectId: task.projectId,
      actorId: actor.userId,
    });

    return {
      id: comment.id,
      taskId: comment.taskId,
      userId: comment.userId,
      userFullName: comment.user.fullName,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
    };
  }

  // ---------- Yardımcılar ----------

  /** Atanan kullanıcı aktif ve projenin üyesi olmalıdır (docs/06 kapsam kuralı). */
  private async assertAssignableUser(userId: string, projectId: string): Promise<void> {
    const [user, membership] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: userId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { id: true },
      }),
    ]);
    if (!user || !membership) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Atanacak kullanıcı bulunamadı veya projenin üyesi değil',
      });
    }
  }

  /** Atama bildirimi event'i — kendine atamada üretilmez (bildirim altyapısı temeli). */
  private async notifyAssignment(
    tx: Prisma.TransactionClient,
    taskId: string,
    title: string,
    projectId: string,
    assigneeId: string | null,
    actorUserId: string,
  ): Promise<void> {
    if (!assigneeId || assigneeId === actorUserId) return;
    await tx.notification.create({
      data: {
        userId: assigneeId,
        type: 'task.assigned',
        payload: { taskId, taskTitle: title, projectId, assignedBy: actorUserId },
      },
    });
  }
}
