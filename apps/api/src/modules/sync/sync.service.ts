/**
 * Senkronizasyon servisi (Faz 09 — docs/09-offline-sync.md).
 *
 * PUSH — /sync/push:
 * - Her mutation SyncMutationLog defteri üzerinden idempotenttir: aynı
 *   clientMutationId tekrar geldiğinde mutation yeniden ÇALIŞTIRILMAZ, saklanan
 *   sonuç `replayed: true` ile döner (test senaryosu 3: aynı mutation 3 kez →
 *   tek kayıt).
 * - Sonuç her mutation için accepted/rejected/conflict + açıklamadır. Doğrulama
 *   hatası (VALIDATION_ERROR), kapsam dışı (NOT_FOUND) ve yetki (FORBIDDEN)
 *   KALICI reddedilmedir ve deftere yazılır (sessiz tekrar deneme yok);
 *   sunucu hatası (INTERNAL_ERROR) GEÇİCİDİR, deftere yazılmaz — istemci
 *   backoff ile yeniden dener.
 * - Çakışma politikası: kritik kayıtlar (stok, gider, puantaj duplicate'i)
 *   otomatik last-write-wins ile ÜZERİNE YAZILMAZ — ConflictException 'conflict'
 *   olur ve karar kullanıcıya bırakılır (docs/09).
 * - Dispatch gerçek servisler üzerinden yapılır: RBAC + kapsam + audit log +
 *   idempotency (clientMutationId) fabrika kurallarıyla birebir aynıdır.
 *
 * PULL — /sync/pull:
 * - Delta, SyncEvent seq (sunucu monotonik sırası) > cursor üzerinden gelir;
 *   cihaz saati asla sıralamaya katılmaz (test senaryosu 9).
 * - Kapsam: FIRM_ADMIN kurum geneli; diğer roller yalnızca üyesi olduğu
 *   projeler. Kapsam dışı olayın VERİSİ GÖNDERİLMEZ (IDOR), cursor yine de
 *   ilerler.
 * - Erişimi kaldırılan/silinen proje: yanıtın accessibleProjectIds
 *   snapshot'ında yer almaz; cihaz bu projelerin yerel verisini temizler
 *   (test senaryosu 8).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ZodError } from 'zod';
import type { HttpException } from '@nestjs/common';
import {
  pushAttendancePayloadSchema,
  pushDailyReportPayloadSchema,
  pushExpensePayloadSchema,
  pushStockMovementPayloadSchema,
  pushTaskCommentPayloadSchema,
  pushTaskUpdatePayloadSchema,
  type SyncMutation,
  type SyncMutationResult,
  type SyncPullQuery,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type UpdateTaskRequest,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { DailyReportsService } from '../daily-reports/daily-reports.service.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import { StockService } from '../inventory/stock.service.js';
import { fetchEntitySnapshot } from './sync-serializer.js';

export interface RequestMeta {
  ip: string;
  userAgent: string;
  traceId?: string;
}

const PULL_WINDOW = 400;
const DEFAULT_META: RequestMeta = { ip: 'sync', userAgent: 'sync' };

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly tasks: TasksService,
    private readonly dailyReports: DailyReportsService,
    private readonly expenses: ExpensesService,
    private readonly stock: StockService,
  ) {}

  // ---------- PUSH ----------

  async push(userId: string, request: SyncPushRequest, meta: RequestMeta = DEFAULT_META): Promise<SyncPushResponse> {
    const results: SyncMutationResult[] = [];
    for (const mutation of request.mutations) {
      results.push(await this.processMutation(userId, mutation, meta));
    }
    return { results, serverTime: new Date().toISOString() };
  }

  /** Tek mutation: defter kontrolü → çalıştır → deftere yaz (yarışta tekrar oku). */
  private async processMutation(userId: string, mutation: SyncMutation, meta: RequestMeta): Promise<SyncMutationResult> {
    const stored = await this.prisma.syncMutationLog.findUnique({
      where: { userId_clientMutationId: { userId, clientMutationId: mutation.clientMutationId } },
    });
    if (stored) {
      const result = stored.resultJson as SyncMutationResult;
      return { ...result, replayed: true };
    }

    const result = await this.executeMutation(userId, mutation, meta);

    // Geçici sunucu hatası deftere yazılmaz: istemci güvenle yeniden deneyebilir.
    if (result.status === 'rejected' && result.error?.code === 'INTERNAL_ERROR') {
      return result;
    }

    try {
      await this.prisma.syncMutationLog.create({
        data: {
          userId,
          clientMutationId: mutation.clientMutationId,
          mutationType: mutation.type,
          status: result.status,
          serverId: result.serverId ?? null,
          version: result.version ?? null,
          errorJson: result.error ?? undefined,
          resultJson: result,
        },
      });
    } catch (error) {
      // Eşzamanlı aynı anahtar: defterde kazananı döndür (çift çalıştırma yok).
      const race = await this.prisma.syncMutationLog.findUnique({
        where: { userId_clientMutationId: { userId, clientMutationId: mutation.clientMutationId } },
      });
      if (race) return { ...(race.resultJson as SyncMutationResult), replayed: true };
      this.logger.warn(`SyncMutationLog yazılamadı (${mutation.clientMutationId}): ${String(error)}`);
    }
    return result;
  }

  private async executeMutation(userId: string, mutation: SyncMutation, meta: RequestMeta): Promise<SyncMutationResult> {
    const base = { clientMutationId: mutation.clientMutationId };
    try {
      switch (mutation.type) {
        case 'attendance.mark': {
          const payload = pushAttendancePayloadSchema.parse(mutation.payload);
          const { record, replayed } = await this.attendance.create(
            userId,
            {
              projectId: payload.projectId,
              personnelId: payload.personnelId,
              workDate: payload.workDate,
              shiftKey: payload.shiftKey,
              status: payload.status,
              note: payload.note ?? null,
              checkInAt: payload.checkInAt ?? null,
              checkOutAt: payload.checkOutAt ?? null,
              clientMutationId: mutation.clientMutationId,
            },
            meta,
            'MOBILE',
          );
          return { ...base, status: 'accepted', replayed, serverId: record.id };
        }
        case 'task.update': {
          const payload = pushTaskUpdatePayloadSchema.parse(mutation.payload);
          const task = await this.tasks.update(
            userId,
            payload.taskId,
            {
              ...(payload.title !== undefined ? { title: payload.title } : {}),
              ...(payload.description !== undefined ? { description: payload.description } : {}),
              // Durum/öncelik geçerliliği ve geçiş kuralları serviste denetlenir;
              // bilinmeyen anahtar 400 VALIDATION_ERROR olarak push sonucuna düşer.
              ...(payload.status !== undefined ? { status: payload.status as UpdateTaskRequest['status'] } : {}),
              ...(payload.priority !== undefined ? { priority: payload.priority as UpdateTaskRequest['priority'] } : {}),
              ...(payload.assigneeId !== undefined ? { assigneeId: payload.assigneeId } : {}),
              ...(payload.dueAt !== undefined ? { dueAt: payload.dueAt } : {}),
              ...(payload.checklist !== undefined ? { checklist: payload.checklist } : {}),
              ...(payload.version !== undefined ? { version: payload.version } : {}),
            },
            meta,
          );
          return { ...base, status: 'accepted', replayed: false, serverId: task.id, version: task.version };
        }
        case 'task.comment': {
          const payload = pushTaskCommentPayloadSchema.parse(mutation.payload);
          const comment = await this.tasks.addComment(userId, payload.taskId, payload.body, meta);
          return { ...base, status: 'accepted', replayed: false, serverId: comment.id };
        }
        case 'dailyReport.upsertDraft': {
          const payload = pushDailyReportPayloadSchema.parse(mutation.payload);
          const common = {
            projectId: payload.projectId,
            siteId: payload.siteId ?? null,
            reportDate: payload.reportDate,
            weather: payload.weather ?? undefined,
            workSummary: payload.workSummary,
            workforceSummary: payload.workforceSummary ?? undefined,
            equipmentSummary: payload.equipmentSummary ?? undefined,
            issues: payload.issues ?? undefined,
            safetyNotes: payload.safetyNotes ?? undefined,
            nextDayPlan: payload.nextDayPlan ?? undefined,
            workers: payload.workers?.map((w) => ({
              name: w.name,
              jobTitle: w.jobTitle ?? undefined,
              workerCount: w.workerCount,
              hours: w.hours,
            })),
          };
          if (payload.reportId) {
            // Çakışma politikası: taslak olmayan rapor üzerine yazılmaz (docs/09).
            const current = await this.prisma.dailyReport.findUnique({
              where: { id: payload.reportId },
              select: { status: true, projectId: true },
            });
            if (!current || current.projectId !== payload.projectId) {
              return {
                ...base,
                status: 'rejected',
                replayed: false,
                error: { code: 'NOT_FOUND', message: 'Rapor bulunamadı; sunucudan yeniden çekin' },
              };
            }
            if (current.status !== 'DRAFT') {
              return {
                ...base,
                status: 'conflict',
                replayed: false,
                serverId: payload.reportId,
                error: {
                  code: 'CONFLICT',
                  message: `Rapor sunucuda '${current.status}' durumunda; taslak üzerine yazılmadı. Sunucu kopyasını çekip karşılaştırın.`,
                },
              };
            }
            const updated = await this.dailyReports.update(userId, payload.reportId, common, meta);
            return { ...base, status: 'accepted', replayed: false, serverId: updated.id };
          }
          const created = await this.dailyReports.create(userId, { ...common, mediaIds: undefined }, meta);
          return { ...base, status: 'accepted', replayed: false, serverId: created.id };
        }
        case 'expense.create': {
          const payload = pushExpensePayloadSchema.parse(mutation.payload);
          // Gider şemasında entity-seviyesi clientMutationId yoktur; idempotency
          // SyncMutationLog defteriyle sağlanır (çift gider oluşmaz).
          const expense = await this.expenses.createExpense(
            userId,
            {
              projectId: payload.projectId,
              categoryId: payload.categoryId,
              vendorName: payload.vendorName ?? undefined,
              description: payload.description,
              amount: payload.amount,
              currency: payload.currency,
              taxRate: payload.taxRate ?? null,
              expenseDate: payload.expenseDate,
            },
            meta,
          );
          return { ...base, status: 'accepted', replayed: false, serverId: expense.id };
        }
        case 'stock.movement': {
          const payload = pushStockMovementPayloadSchema.parse(mutation.payload);
          const { movement, replayed } = await this.stock.create(
            userId,
            {
              type: payload.type,
              materialId: payload.materialId,
              warehouseId: payload.warehouseId,
              targetWarehouseId: payload.targetWarehouseId ?? null,
              projectId: payload.projectId ?? null,
              quantity: payload.quantity,
              unit: payload.unit ?? undefined,
              unitCost: payload.unitCost ?? null,
              referenceType: payload.referenceType ?? 'OTHER',
              referenceId: payload.referenceId ?? undefined,
              note: payload.note ?? undefined,
              occurredAt: payload.occurredAt,
              clientMutationId: mutation.clientMutationId,
            },
            meta,
            'MOBILE',
          );
          return { ...base, status: 'accepted', replayed, serverId: movement.id };
        }
        default: {
          return {
            ...base,
            status: 'rejected',
            replayed: false,
            error: { code: 'VALIDATION_ERROR', message: `Bilinmeyen mutation türü: ${(mutation as { type: string }).type}` },
          };
        }
      }
    } catch (error) {
      return SyncService.errorToResult(base.clientMutationId, error);
    }
  }

  /** Hata → push sonucu eşlemesi (kalıcı red vs çakışma vs geçici hata). */
  private static errorToResult(clientMutationId: string, error: unknown): SyncMutationResult {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      return {
        clientMutationId,
        status: 'rejected',
        replayed: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: first ? `${first.path.join('.') || 'payload'}: ${first.message}` : 'Yük doğrulanamadı',
        },
      };
    }
    if (typeof error === 'object' && error !== null && 'getStatus' in error) {
      const httpError = error as HttpException;
      const status = httpError.getStatus();
      const body = (httpError.getResponse() ?? {}) as { code?: string; message?: string };
      const code = typeof body.code === 'string' ? body.code : status === 409 ? 'CONFLICT' : status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'VALIDATION_ERROR';
      const message = typeof body.message === 'string' ? body.message : httpError.message;
      if (status === 409) {
        return { clientMutationId, status: 'conflict', replayed: false, error: { code, message } };
      }
      if (status >= 500) {
        // Geçici: deftere yazılmaz, istemci backoff ile tekrar dener.
        return { clientMutationId, status: 'rejected', replayed: false, error: { code: 'INTERNAL_ERROR', message: 'Sunucu geçici hata verdi; yeniden denenecek' } };
      }
      return { clientMutationId, status: 'rejected', replayed: false, error: { code, message } };
    }
    return {
      clientMutationId,
      status: 'rejected',
      replayed: false,
      error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Bilinmeyen sunucu hatası' },
    };
  }

  // ---------- PULL ----------

  async pull(userId: string, query: SyncPullQuery): Promise<SyncPullResponse> {
    const [accessibleIds, canViewPersonnel] = await Promise.all([
      this.accessibleProjectIds(userId),
      this.hasPermission(userId, 'personnel.view'),
    ]);
    const accessible = new Set(accessibleIds);

    const events = await this.prisma.syncEvent.findMany({
      where: { seq: { gt: BigInt(query.cursor) } },
      orderBy: { seq: 'asc' },
      take: PULL_WINDOW,
    });

    // Delta sıkıştırma: aynı entity için yalnızca EN YENİ olay değerlendirilir.
    const latest = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      latest.set(`${event.entityType}:${event.entityId}`, event);
    }

    const changes: SyncPullResponse['changes'] = [];
    for (const event of latest.values()) {
      if (event.operation === 'delete') {
        changes.push({
          seq: Number(event.seq),
          entityType: event.entityType as SyncPullResponse['changes'][number]['entityType'],
          operation: 'delete',
          entityId: event.entityId,
          projectId: event.projectId,
          updatedAt: event.occurredAt.toISOString(),
        });
        continue;
      }

      const snapshot = await fetchEntitySnapshot(this.prisma, event.entityType, event.entityId);
      if (!snapshot) {
        // Kayıt arada sert silinmiş → tombstone olarak bildir.
        changes.push({
          seq: Number(event.seq),
          entityType: event.entityType as SyncPullResponse['changes'][number]['entityType'],
          operation: 'delete',
          entityId: event.entityId,
          projectId: event.projectId,
          updatedAt: event.occurredAt.toISOString(),
        });
        continue;
      }
      // Yetkisiz / artık erişilemeyen proje verisi cihaza GÖNDERİLMEZ (docs/09).
      if (snapshot.projectId !== null && !accessible.has(snapshot.projectId)) continue;
      if (event.entityType === 'personnel' && !canViewPersonnel) continue;

      changes.push({
        seq: Number(event.seq),
        entityType: event.entityType as SyncPullResponse['changes'][number]['entityType'],
        operation: 'upsert',
        entityId: event.entityId,
        projectId: snapshot.projectId,
        updatedAt: snapshot.updatedAt,
        data: snapshot.data,
      });
    }

    const cursor = events.length > 0 ? Number(events[events.length - 1]!.seq) : query.cursor;
    return {
      cursor,
      hasMore: events.length === PULL_WINDOW,
      changes,
      accessibleProjectIds: [...accessible],
      serverTime: new Date().toISOString(),
    };
  }

  /** Güncel kapsam snapshot'ı: admin kurum geneli, diğer roller üyelik. */
  private async accessibleProjectIds(userId: string): Promise<string[]> {
    const actor = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { roles: { select: { role: { select: { key: true } } } } },
    });
    const isAdmin = actor?.roles.some((r) => r.role.key === 'FIRM_ADMIN') ?? false;
    if (isAdmin) {
      const projects = await this.prisma.project.findMany({ select: { id: true } });
      return projects.map((p) => p.id);
    }
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });
    return memberships.map((m) => m.projectId);
  }

  private async hasPermission(userId: string, permission: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: 'ACTIVE' },
      select: { roles: { select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } } },
    });
    if (!user) return false;
    return user.roles.some((r) => r.role.permissions.some((p) => p.permission.key === permission));
  }
}
