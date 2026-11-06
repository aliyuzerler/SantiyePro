/**
 * Puantaj servisi (Faz 06).
 *
 * Kurallar (prompts/phase-06-development.md, docs/04, docs/06):
 * - Kapsam modeli Projeler/Görevler ile aynı: FIRM_ADMIN tümü, diğer roller
 *   yalnızca üyesi olduğu projeler; kapsam dışı kayıt 404 (IDOR koruması).
 * - Duplicate engeli: aynı (personnel, proje, tarih, vardiya) tek kayıttır —
 *   DB unique constraint + servis kontrolü, 409 CONFLICT döner.
 * - Toplu işaretleme iki adımlıdır: önizleme (yazma yok) → onay (confirm: true).
 * - Devam durumları: 6 varsayılan + kurum ayarı uzantıları (OrgSettings);
 *   bilinmeyen durum 400 VALIDATION_ERROR döner.
 * - Giriş/çıkış doğrulaması: Gelmedi/İzinli/Raporlu/Resmî Tatil'de saat olamaz;
 *   çıkış girişten sonra olmalıdır; her iki saat de girilmişse çalışılan dakika
 *   hesaplanır (contracts.validateAttendanceTimes / resolveWorkedMinutes).
 * - Pasif personele yeni puantaj girilemez; geçmiş kayıtların düzeltmesi serbesttir.
 * - clientMutationId verilirse idempotenttir: aynı anahtar mevcut kaydı döner
 *   (çevrimdışı kuyruk tekrarları çift kayıt üretmez, docs/09).
 * - GPS: bu serviste konum alanı yoktur — toplama varsayılan kapalıdır (docs/07).
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  availableAttendanceStatuses,
  buildPaginationMeta,
  resolveWorkedMinutes,
  validateAttendanceTimes,
  workDateToDate,
  type AttendanceListQuery,
  type AttendanceRecordDto,
  type AttendanceSummaryQuery,
  type AttendanceSummaryResponse,
  type BulkAttendanceConfirmRequest,
  type BulkAttendanceEntry,
  type BulkAttendancePreviewRequest,
  type BulkAttendancePreviewResponse,
  type CreateAttendanceRequest,
  type UpdateAttendanceRequest,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';
import { OrgSettingsService } from '../org/org-settings.service.js';
import { SyncEventsService } from '../../common/sync-events.service.js';

interface Actor {
  userId: string;
  roles: string[];
}

type AttendanceRow = Prisma.AttendanceRecordGetPayload<{ include: typeof ATTENDANCE_INCLUDE }>;

const ATTENDANCE_INCLUDE = {
  project: { select: { id: true, code: true, name: true } },
  site: { select: { id: true, name: true } },
  personnel: { select: { id: true, fullName: true, employeeCode: true } },
  recordedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AttendanceRecordInclude;


@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orgSettings: OrgSettingsService,
    private readonly syncEvents: SyncEventsService,
  ) {}

  // ---------- Ortak yardımcılar ----------

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

  /** Kurum ayarıyla genişletilmiş durum kümesi (varsayılanlar + özel anahtarlar). */
  private async availableStatuses(): Promise<Set<string>> {
    const settings = await this.orgSettings.get();
    return new Set(availableAttendanceStatuses(settings.attendanceCustomStatuses));
  }

  private assertStatusAllowed(status: string, allowed: Set<string>): void {
    if (!allowed.has(status)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `'${status}' geçerli bir devam durumu değil. Kurum tanımlı durumlar: ${[...allowed].join(', ')}`,
      });
    }
  }

  private assertTimes(input: { status?: string; checkInAt?: string | null; checkOutAt?: string | null; workedMinutes?: number | null }): void {
    const result = validateAttendanceTimes(input as Parameters<typeof validateAttendanceTimes>[0]);
    if (!result.valid) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: result.message });
    }
  }

  /** Üyelik denetimli proje erişimi (admin dışındaki roller için zorunlu). */
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

  /** Kaydı aktör kapsamıyla bulur: kaydın projesine üyelik zorunludur. */
  private async getRecordInScope(actor: Actor, recordId: string): Promise<AttendanceRow> {
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        ...ATTENDANCE_INCLUDE,
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
    if (!record) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Puantaj kaydı bulunamadı' });
    if (!this.isAdmin(actor) && record.project.members.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Puantaj kaydı bulunamadı' });
    }
    return record;
  }

  private static toDto(row: AttendanceRow): AttendanceRecordDto {
    return {
      id: row.id,
      projectId: row.projectId,
      projectCode: row.project?.code ?? null,
      projectName: row.project?.name ?? null,
      siteId: row.siteId,
      siteName: row.site?.name ?? null,
      personnelId: row.personnelId,
      personnelName: row.personnel?.fullName ?? '',
      personnelEmployeeCode: row.personnel?.employeeCode ?? null,
      workDate: row.workDate.toISOString().slice(0, 10),
      shiftKey: row.shiftKey,
      status: row.status,
      checkInAt: row.checkInAt ? row.checkInAt.toISOString() : null,
      checkOutAt: row.checkOutAt ? row.checkOutAt.toISOString() : null,
      workedMinutes: row.workedMinutes,
      note: row.note,
      recordedById: row.recordedById,
      recordedBy: { id: row.recordedBy.id, fullName: row.recordedBy.fullName },
      source: row.source,
      clientMutationId: row.clientMutationId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ---------- Liste ----------

  async list(userId: string, query: AttendanceListQuery) {
    const actor = await this.getActor(userId);

    // Kapsam: projectId filtresi verilmişse üyelik denetlenir; personnelId ile
    // sorgularda da tüm satırlar üye olunan projelerle sınırlandırılır.
    const scopeProjectIds = this.isAdmin(actor)
      ? null
      : (
          await this.prisma.projectMember.findMany({
            where: { userId: actor.userId },
            select: { projectId: true },
          })
        ).map((m) => m.projectId);

    if (query.projectId && scopeProjectIds && !scopeProjectIds.includes(query.projectId)) {
      // Kapsam dışı proje: liste boş döner (kaydın varlığı sızdırılmaz).
      return { data: [], meta: buildPaginationMeta(query.page, query.pageSize, 0) };
    }

    const where: Prisma.AttendanceRecordWhereInput = {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.personnelId ? { personnelId: query.personnelId } : {}),
      ...(query.workDate ? { workDate: workDateToDate(query.workDate) } : {}),
      ...(!query.workDate && (query.dateFrom || query.dateTo)
        ? {
            workDate: {
              ...(query.dateFrom ? { gte: workDateToDate(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: workDateToDate(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.shiftKey ? { shiftKey: query.shiftKey } : {}),
      ...(scopeProjectIds ? { projectId: { in: scopeProjectIds } } : {}),
    };

    const orderBy: Prisma.AttendanceRecordOrderByWithRelationInput =
      query.sort === 'createdAt'
        ? { createdAt: query.order }
        : query.sort === 'fullName'
          ? { personnel: { fullName: query.order } }
          : { workDate: query.order };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.count({ where }),
      this.prisma.attendanceRecord.findMany({
        where,
        orderBy: [orderBy, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: ATTENDANCE_INCLUDE,
      }),
    ]);

    return { data: rows.map(AttendanceService.toDto), meta: buildPaginationMeta(query.page, query.pageSize, total) };
  }

  // ---------- Tek kayıt ----------

  async create(
    actorUserId: string,
    input: CreateAttendanceRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
    source: 'WEB' | 'MOBILE' | 'API' = 'WEB',
  ): Promise<{ record: AttendanceRecordDto; replayed: boolean }> {
    const actor = await this.getActor(actorUserId);

    // Idempotency: çevrimdışı kuyruğun yeniden gönderimleri çift kayıt üretmez.
    if (input.clientMutationId) {
      const replay = await this.prisma.attendanceRecord.findFirst({
        where: { clientMutationId: input.clientMutationId, recordedById: actor.userId },
        include: ATTENDANCE_INCLUDE,
      });
      if (replay) return { record: AttendanceService.toDto(replay), replayed: true };
    }

    this.assertTimes({ ...input, status: input.status });
    const allowed = await this.availableStatuses();
    this.assertStatusAllowed(input.status, allowed);

    const project = await this.getProjectInScope(actor, input.projectId);
    if (project.status === 'ARCHIVED') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Arşivlenmiş projeye puantaj girilemez' });
    }

    if (input.siteId) {
      const site = await this.prisma.site.findFirst({ where: { id: input.siteId, projectId: input.projectId } });
      if (!site) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Şantiye bulunamadı' });
    }

    const personnel = await this.prisma.personnel.findUnique({ where: { id: input.personnelId } });
    if (!personnel) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Personel bulunamadı' });
    if (personnel.status === 'PASSIVE') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Pasif personel için yeni puantaj girilemez' });
    }

    const workDate = workDateToDate(input.workDate);

    // Duplicate kontrolü: aynı personel/proje/tarih/vardiya (docs/04 unique örneği).
    const duplicate = await this.prisma.attendanceRecord.findUnique({
      where: {
        personnelId_projectId_workDate_shiftKey: {
          personnelId: input.personnelId,
          projectId: input.projectId,
          workDate,
          shiftKey: input.shiftKey,
        },
      },
    });
    if (duplicate) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Bu personel için aynı proje, tarih ve vardiyada puantaj kaydı zaten var',
        details: { existingRecordId: duplicate.id },
      });
    }

    try {
      const row = await this.prisma.attendanceRecord.create({
        data: {
          projectId: input.projectId,
          siteId: input.siteId ?? undefined,
          personnelId: input.personnelId,
          workDate,
          shiftKey: input.shiftKey,
          status: input.status,
          checkInAt: input.checkInAt ? new Date(input.checkInAt) : undefined,
          checkOutAt: input.checkOutAt ? new Date(input.checkOutAt) : undefined,
          workedMinutes: resolveWorkedMinutes(input) ?? undefined,
          note: input.note ?? undefined,
          recordedById: actor.userId,
          source,
          clientMutationId: input.clientMutationId,
        },
        include: ATTENDANCE_INCLUDE,
      });

      await this.audit.record({
        actorUserId: actor.userId,
        action: 'attendance.created',
        entityType: 'AttendanceRecord',
        entityId: row.id,
        after: {
          personnelId: row.personnelId,
          projectId: row.projectId,
          workDate: input.workDate,
          shiftKey: row.shiftKey,
          status: row.status,
          source: row.source,
        },
        ...meta,
      });

      // Faz 09: mobil çevrimdışı işaretleme pull ile diğer cihazlara taşınır.
      await this.syncEvents.record({
        entityType: 'attendanceRecord',
        entityId: row.id,
        operation: 'upsert',
        projectId: row.projectId,
        actorId: actor.userId,
      });

      return { record: AttendanceService.toDto(row), replayed: false };
    } catch (error) {
      // Eşzamanlı istekte unique constraint ihlali → aynı 409 sözleşmesi.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Bu personel için aynı proje, tarih ve vardiyada puantaj kaydı zaten var',
        });
      }
      throw error;
    }
  }

  async update(
    actorUserId: string,
    recordId: string,
    input: UpdateAttendanceRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<AttendanceRecordDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getRecordInScope(actor, recordId);

    const next = {
      status: input.status ?? current.status,
      checkInAt: input.checkInAt !== undefined ? input.checkInAt : current.checkInAt?.toISOString() ?? null,
      checkOutAt: input.checkOutAt !== undefined ? input.checkOutAt : current.checkOutAt?.toISOString() ?? null,
      workedMinutes: input.workedMinutes !== undefined ? input.workedMinutes : current.workedMinutes,
    };
    this.assertTimes(next);

    const allowed = await this.availableStatuses();
    if (input.status) this.assertStatusAllowed(input.status, allowed);

    if (input.siteId) {
      const site = await this.prisma.site.findFirst({ where: { id: input.siteId, projectId: current.projectId } });
      if (!site) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Şantiye bulunamadı' });
    }

    const row = await this.prisma.attendanceRecord.update({
      where: { id: recordId },
      data: {
        siteId: input.siteId !== undefined ? input.siteId : undefined,
        status: input.status,
        checkInAt: input.checkInAt !== undefined ? (input.checkInAt ? new Date(input.checkInAt) : null) : undefined,
        checkOutAt: input.checkOutAt !== undefined ? (input.checkOutAt ? new Date(input.checkOutAt) : null) : undefined,
        workedMinutes:
          input.workedMinutes !== undefined || input.checkInAt !== undefined || input.checkOutAt !== undefined
            ? (resolveWorkedMinutes(next) ?? undefined)
            : undefined,
        note: input.note !== undefined ? input.note : undefined,
      },
      include: ATTENDANCE_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'attendance.updated',
      entityType: 'AttendanceRecord',
      entityId: row.id,
      before: { status: current.status, checkInAt: next.checkInAt, checkOutAt: next.checkOutAt },
      after: { status: row.status, workDate: row.workDate.toISOString().slice(0, 10), shiftKey: row.shiftKey },
      ...meta,
    });

    await this.syncEvents.record({
      entityType: 'attendanceRecord',
      entityId: row.id,
      operation: 'upsert',
      projectId: row.projectId,
      actorId: actor.userId,
    });

    return AttendanceService.toDto(row);
  }

  // ---------- Toplu işaretleme: önizleme + onay ----------

  /**
   * Önizleme: hiçbir kayıt yazılmaz; her personel için uygulanacak işlemi
   * (CREATE/UPDATE/SKIP_*) tek tek listeler. Onay istemcisi bu çıktıyı gösterir.
   */
  async bulkPreview(userId: string, input: BulkAttendancePreviewRequest): Promise<BulkAttendancePreviewResponse> {
    const actor = await this.getActor(userId);
    await this.getProjectInScope(actor, input.projectId);
    this.assertTimes({ ...input });

    const allowed = await this.availableStatuses();
    this.assertStatusAllowed(input.status, allowed);

    const { entries } = await this.buildBulkPlan(input);
    return {
      projectId: input.projectId,
      workDate: input.workDate,
      shiftKey: input.shiftKey,
      status: input.status,
      createCount: entries.filter((e) => e.action === 'CREATE').length,
      updateCount: entries.filter((e) => e.action === 'UPDATE').length,
      skipCount: entries.filter((e) => e.action.startsWith('SKIP')).length,
      entries,
    };
  }

  /** Önizleme planını üretir: personel durumları + mevcut kayıtlar tek sorguda. */
  private async buildBulkPlan(input: BulkAttendancePreviewRequest): Promise<{ entries: BulkAttendanceEntry[] }> {
    const uniqueIds = [...new Set(input.personnelIds)];
    const [personnelRows, existingRows] = await Promise.all([
      this.prisma.personnel.findMany({ where: { id: { in: uniqueIds } } }),
      this.prisma.attendanceRecord.findMany({
        where: {
          projectId: input.projectId,
          workDate: workDateToDate(input.workDate),
          shiftKey: input.shiftKey,
          personnelId: { in: uniqueIds },
        },
      }),
    ]);

    const personnelById = new Map(personnelRows.map((p) => [p.id, p]));
    const existingByPersonnelId = new Map(existingRows.map((r) => [r.personnelId, r]));
    // personnelIds tekrarı plana tek kez girer; onay da aynı sırayla uygular.
    const seen = new Set<string>();
    const entries: BulkAttendanceEntry[] = [];

    for (const personnelId of input.personnelIds) {
      if (seen.has(personnelId)) continue;
      seen.add(personnelId);

      const personnel = personnelById.get(personnelId);
      if (!personnel) {
        entries.push({
          personnelId,
          personnelName: '(bilinmeyen)',
          action: 'SKIP_NOT_FOUND',
          detail: 'Personel bulunamadı',
        });
        continue;
      }
      if (personnel.status === 'PASSIVE') {
        entries.push({
          personnelId,
          personnelName: personnel.fullName,
          action: 'SKIP_PASSIVE',
          detail: 'Pasif personel — işaretlenmez',
        });
        continue;
      }

      const existing = existingByPersonnelId.get(personnelId);
      if (existing && existing.status === input.status) {
        entries.push({
          personnelId,
          personnelName: personnel.fullName,
          action: 'SKIP_DUPLICATE',
          detail: 'Aynı durumla kaydı zaten var',
        });
        continue;
      }
      entries.push({
        personnelId,
        personnelName: personnel.fullName,
        action: existing ? 'UPDATE' : 'CREATE',
        detail: existing
          ? `Mevcut kayıt güncellenecek (${existing.status} → ${input.status})`
          : 'Yeni kayıt açılacak',
      });
    }

    return { entries };
  }

  /**
   * Onay: yalnızca confirm: true ile gelir (zod şeması zorunlu kılar).
   * Önizleme planındaki CREATE/UPDATE satırları tek transaction'da uygulanır;
   * SKIP_* satırlarına dokunulmaz ve yanıtla bildirilir (yanlış kişiye
   * uygulanma riski test promptunda doğrulanır).
   */
  async bulkConfirm(
    actorUserId: string,
    input: BulkAttendanceConfirmRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
    source: 'WEB' | 'MOBILE' | 'API' = 'WEB',
  ): Promise<BulkAttendancePreviewResponse & { updatedCount: number }> {
    const actor = await this.getActor(actorUserId);

    // Yetki (attendance.edit) PermissionsGuard'da; kapsam burada nesne seviyesinde.
    const project = await this.getProjectInScope(actor, input.projectId);
    if (project.status === 'ARCHIVED') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Arşivlenmiş projeye puantaj girilemez' });
    }

    this.assertTimes({ ...input });
    const allowed = await this.availableStatuses();
    this.assertStatusAllowed(input.status, allowed);

    const { entries } = await this.buildBulkPlan(input);
    const workDate = workDateToDate(input.workDate);
    let createdCount = 0;
    let updatedCount = 0;
    const changedRecordIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        if (entry.action === 'CREATE') {
          const created = await tx.attendanceRecord.create({
            data: {
              projectId: input.projectId,
              siteId: input.siteId ?? undefined,
              personnelId: entry.personnelId,
              workDate,
              shiftKey: input.shiftKey,
              status: input.status,
              checkInAt: input.checkInAt ? new Date(input.checkInAt) : undefined,
              checkOutAt: input.checkOutAt ? new Date(input.checkOutAt) : undefined,
              workedMinutes: resolveWorkedMinutes(input) ?? undefined,
              note: input.note ?? undefined,
              recordedById: actor.userId,
              source,
            },
          });
          changedRecordIds.push(created.id);
          createdCount += 1;
        } else if (entry.action === 'UPDATE') {
          const updated = await tx.attendanceRecord.updateManyAndReturn({
            where: {
              personnelId: entry.personnelId,
              projectId: input.projectId,
              workDate,
              shiftKey: input.shiftKey,
            },
            data: {
              status: input.status,
              checkInAt: input.checkInAt ? new Date(input.checkInAt) : null,
              checkOutAt: input.checkOutAt ? new Date(input.checkOutAt) : null,
              workedMinutes: resolveWorkedMinutes(input),
              note: input.note ?? undefined,
            },
          });
          for (const rec of updated) changedRecordIds.push(rec.id);
          updatedCount += 1;
        }
      }
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'attendance.bulk_marked',
      entityType: 'AttendanceRecord',
      entityId: null,
      after: {
        projectId: input.projectId,
        workDate: input.workDate,
        shiftKey: input.shiftKey,
        status: input.status,
        createdCount,
        updatedCount,
        skipCount: entries.filter((e) => e.action.startsWith('SKIP')).length,
      },
      ...meta,
    });

    // Toplu işaretlemede değişen tüm kayıtlar pull deltasına girer.
    await this.syncEvents.recordMany(
      changedRecordIds.map((id) => ({
        entityType: 'attendanceRecord' as const,
        entityId: id,
        operation: 'upsert' as const,
        projectId: input.projectId,
        actorId: actor.userId,
      })),
    );

    return {
      projectId: input.projectId,
      workDate: input.workDate,
      shiftKey: input.shiftKey,
      status: input.status,
      createCount: createdCount,
      updateCount: updatedCount,
      skipCount: entries.filter((e) => e.action.startsWith('SKIP')).length,
      entries,
      updatedCount,
    };
  }

  // ---------- Özet (raporlar) ----------

  /** Tarih aralığı özeti: durum bazlı adetler, gün bazlı dağılım, toplam süre. */
  async summary(userId: string, query: AttendanceSummaryQuery): Promise<AttendanceSummaryResponse> {
    const actor = await this.getActor(userId);
    await this.getProjectInScope(actor, query.projectId);

    const from = workDateToDate(query.dateFrom);
    const to = workDateToDate(query.dateTo);
    const dayMs = 24 * 3600 * 1000;
    if (to.getTime() - from.getTime() > 366 * dayMs) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Özet aralığı en fazla 366 gün olabilir' });
    }

    const rows = await this.prisma.attendanceRecord.findMany({
      where: { projectId: query.projectId, workDate: { gte: from, lte: to } },
      select: { workDate: true, status: true, workedMinutes: true, personnelId: true },
    });

    const byStatus: Record<string, number> = {};
    const byDateMap = new Map<string, { counts: Record<string, number>; workedMinutes: number }>();
    let totalWorkedMinutes = 0;
    const personnelIds = new Set<string>();

    for (const row of rows) {
      const date = row.workDate.toISOString().slice(0, 10);
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      personnelIds.add(row.personnelId);
      totalWorkedMinutes += row.workedMinutes ?? 0;

      const day = byDateMap.get(date) ?? { counts: {}, workedMinutes: 0 };
      day.counts[row.status] = (day.counts[row.status] ?? 0) + 1;
      day.workedMinutes += row.workedMinutes ?? 0;
      byDateMap.set(date, day);
    }

    const byDate = [...byDateMap.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, value]) => ({ date, counts: value.counts, workedMinutes: value.workedMinutes }));

    return {
      projectId: query.projectId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      totalRecords: rows.length,
      uniquePersonnelCount: personnelIds.size,
      totalWorkedMinutes,
      byStatus,
      byDate,
    };
  }
}
