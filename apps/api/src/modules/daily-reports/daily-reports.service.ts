import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  canTransitionDailyReportStatus,
  type CreateDailyReportRequest,
  type DailyReportDetailDto,
  type DailyReportDto,
  type DailyReportListQuery,
  type DailyReportMediaDto,
  type DailyReportRevisionDto,
  type DailyReportWorkerDto,
  type UpdateDailyReportRequest,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';
import { MediaService } from '../media/media.service.js';
import { buildMediaUrl } from '../../common/media/signed-url.js';
import { dateOnlyValue } from '../../common/date-utils.js';

/**
 * Günlük şantiye raporu servisi (Faz 05).
 *
 * Kapsam: projeler modülüyle aynı — FIRM_ADMIN tümü, diğer roller yalnızca
 * üyesi olduğu projenin raporları (kapsam dışı → 404, IDOR koruması).
 *
 * Düzenleme kuralları (docs/02 + docs/05):
 * - DAILY_REPORT_CREATE izni + kapsam gerekir.
 * - DRAFT / REJECTED düzenlemesi serbest; revizyon oluşmaz.
 * - SUBMITTED / APPROVED düzenlenirse ÖNCEKİ içerik DailyReportRevision
 *   snapshot'ına alınır (append-only), revisionNo artar; durum korunur.
 * - Durum geçişleri contracts matrisiyle sınırlıdır.
 */

interface Actor {
  userId: string;
  roles: string[];
}

type ReportRow = Prisma.DailyReportGetPayload<{
  include: {
    project: { select: { id: true; code: true; name: true } };
    site: { select: { id: true; name: true } };
    createdBy: { select: { id: true; fullName: true } };
    approvedBy: { select: { id: true; fullName: true } };
    workers: true;
    media: { include: { media: true } };
  };
}>;

const REPORT_INCLUDE = {
  project: { select: { id: true, code: true, name: true } },
  site: { select: { id: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  workers: true,
  media: { include: { media: true } },
} satisfies Prisma.DailyReportInclude;

@Injectable()
export class DailyReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mediaService: MediaService,
  ) {}

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

  private async getReportInScope(actor: Actor, reportId: string): Promise<ReportRow> {
    const report = await this.prisma.dailyReport.findUnique({
      where: { id: reportId },
      include: {
        ...REPORT_INCLUDE,
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
    if (!report) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rapor bulunamadı' });
    if (!this.isAdmin(actor) && report.project.members.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rapor bulunamadı' });
    }
    return report;
  }

  private toDto(report: ReportRow, withMediaUrls: boolean): DailyReportDto {
    return {
      id: report.id,
      projectId: report.projectId,
      projectCode: report.project?.code,
      projectName: report.project?.name,
      siteId: report.siteId,
      siteName: report.site?.name ?? null,
      reportDate: dateOnlyValue(report.reportDate),
      weather: report.weather,
      workSummary: report.workSummary,
      workforceSummary: report.workforceSummary,
      equipmentSummary: report.equipmentSummary,
      issues: report.issues,
      safetyNotes: report.safetyNotes,
      nextDayPlan: report.nextDayPlan,
      status: report.status,
      revisionNo: report.revisionNo,
      workers: report.workers
        .map((w): DailyReportWorkerDto => ({
          id: w.id,
          name: w.name,
          jobTitle: w.jobTitle,
          workerCount: w.workerCount,
          hours: w.hours.toFixed(2),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      media: report.media
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .filter((m) => m.media.scanStatus === 'CLEAN')
        .map((m) => this.toMediaDto(m.media, withMediaUrls)),
      mediaCount: report.media.length,
      createdById: report.createdById,
      createdBy: report.createdBy?.id ? { id: report.createdBy.id, fullName: report.createdBy.fullName } : null,
      submittedAt: report.submittedAt?.toISOString() ?? null,
      approvedBy: report.approvedBy?.id ? { id: report.approvedBy.id, fullName: report.approvedBy.fullName } : null,
      approvedAt: report.approvedAt?.toISOString() ?? null,
      rejectedReason: report.rejectedReason,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  }

  // ---------- Liste ----------

  async list(userId: string, query: DailyReportListQuery) {
    const actor = await this.getActor(userId);

    const where: Prisma.DailyReportWhereInput = {
      ...(!this.isAdmin(actor) ? { project: { members: { some: { userId: actor.userId } } } } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            reportDate: {
              ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } : {}),
              ...(query.dateTo ? { lte: new Date(`${query.dateTo}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.dailyReport.count({ where }),
      this.prisma.dailyReport.findMany({
        where,
        orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: REPORT_INCLUDE,
      }),
    ]);

    return {
      data: rows.map((r) => ({ ...this.toDto(r, false), media: [], mediaCount: r.media.length })),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize) },
    };
  }

  // ---------- Detay ----------

  async detail(userId: string, reportId: string): Promise<DailyReportDetailDto> {
    const actor = await this.getActor(userId);
    const report = await this.getReportInScope(actor, reportId);

    const revisions = await this.prisma.dailyReportRevision.findMany({
      where: { reportId },
      orderBy: { revisionNo: 'desc' },
      include: { createdBy: { select: { fullName: true } } },
    });

    const revisionDtos: DailyReportRevisionDto[] = revisions.map((r) => ({
      id: r.id,
      revisionNo: r.revisionNo,
      snapshot: r.snapshot as Record<string, unknown>,
      contentHash: r.contentHash,
      changedByFullName: r.createdBy.fullName,
      createdAt: r.createdAt.toISOString(),
    }));

    return { ...this.toDto(report, true), revisions: revisionDtos };
  }

  // ---------- Oluşturma ----------

  async create(
    actorUserId: string,
    input: CreateDailyReportRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<DailyReportDto> {
    const actor = await this.getActor(actorUserId);

    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      include: { members: { where: { userId: actor.userId }, select: { id: true } } },
    });
    if (!project || (!this.isAdmin(actor) && project.members.length === 0)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });
    }
    if (project.status === 'ARCHIVED') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Arşivlenmiş projeye rapor eklenemez' });
    }

    if (input.siteId) {
      const site = await this.prisma.site.findFirst({ where: { id: input.siteId, projectId: input.projectId } });
      if (!site) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Şantiye bulunamadı' });
    }

    await this.assertMediaList(actor, input.mediaIds ?? [], input.projectId);

    const report = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dailyReport.create({
        data: {
          projectId: input.projectId,
          siteId: input.siteId ?? undefined,
          reportDate: new Date(`${input.reportDate}T00:00:00.000Z`),
          weather: input.weather,
          workSummary: input.workSummary,
          workforceSummary: input.workforceSummary,
          equipmentSummary: input.equipmentSummary,
          issues: input.issues,
          safetyNotes: input.safetyNotes,
          nextDayPlan: input.nextDayPlan,
          status: 'DRAFT',
          createdById: actor.userId,
          workers: {
            create: (input.workers ?? []).map((w) => ({
              name: w.name,
              jobTitle: w.jobTitle,
              workerCount: w.workerCount,
              hours: w.hours,
            })),
          },
          media: {
            create: (input.mediaIds ?? []).map((mediaId, index) => ({ mediaId, sortOrder: index })),
          },
        },
        include: REPORT_INCLUDE,
      });
      return created;
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'dailyreport.created',
      entityType: 'DailyReport',
      entityId: report.id,
      after: { projectId: report.projectId, reportDate: input.reportDate, status: report.status },
      ...meta,
    });

    return this.toDto(report, false);
  }

  // ---------- Güncelleme (+ revizyon) ----------

  async update(
    actorUserId: string,
    reportId: string,
    input: UpdateDailyReportRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<DailyReportDto> {
    const actor = await this.getActor(actorUserId);
    const before = await this.getReportInScope(actor, reportId);

    if (input.siteId) {
      const site = await this.prisma.site.findFirst({ where: { id: input.siteId, projectId: before.projectId } });
      if (!site) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Şantiye bulunamadı' });
    }

    await this.assertMediaList(actor, input.mediaIds ?? [], before.projectId);

    // SUBMITTED / APPROVED rapor düzenlenirse önceki içerik snapshot'lanır (docs/02).
    const needsRevision = before.status === 'SUBMITTED' || before.status === 'APPROVED';

    const data: Prisma.DailyReportUpdateInput = {
      ...(input.siteId !== undefined
        ? { site: input.siteId ? { connect: { id: input.siteId } } : { disconnect: true } }
        : {}),
      ...(input.reportDate !== undefined ? { reportDate: new Date(`${input.reportDate}T00:00:00.000Z`) } : {}),
      ...(input.weather !== undefined ? { weather: input.weather } : {}),
      ...(input.workSummary !== undefined ? { workSummary: input.workSummary } : {}),
      ...(input.workforceSummary !== undefined ? { workforceSummary: input.workforceSummary } : {}),
      ...(input.equipmentSummary !== undefined ? { equipmentSummary: input.equipmentSummary } : {}),
      ...(input.issues !== undefined ? { issues: input.issues } : {}),
      ...(input.safetyNotes !== undefined ? { safetyNotes: input.safetyNotes } : {}),
      ...(input.nextDayPlan !== undefined ? { nextDayPlan: input.nextDayPlan } : {}),
      ...(needsRevision ? { revisionNo: { increment: 1 } } : {}),
      ...(input.workers !== undefined
        ? {
            workers: {
              deleteMany: {},
              create: input.workers.map((w) => ({
                name: w.name,
                jobTitle: w.jobTitle,
                workerCount: w.workerCount,
                hours: w.hours,
              })),
            },
          }
        : {}),
      ...(input.mediaIds !== undefined
        ? {
            media: {
              deleteMany: {},
              create: input.mediaIds.map((mediaId, index) => ({ mediaId, sortOrder: index })),
            },
          }
        : {}),
    };

    await this.prisma.$transaction(async (tx) => {
      if (needsRevision) {
        const snapshot = {
          reportDate: dateOnlyValue(before.reportDate),
          weather: before.weather,
          workSummary: before.workSummary,
          workforceSummary: before.workforceSummary,
          equipmentSummary: before.equipmentSummary,
          issues: before.issues,
          safetyNotes: before.safetyNotes,
          nextDayPlan: before.nextDayPlan,
          status: before.status,
          workers: before.workers.map((w) => ({ name: w.name, jobTitle: w.jobTitle, workerCount: w.workerCount, hours: w.hours.toFixed(2) })),
          mediaIds: before.media.map((m) => m.mediaId),
        };
        await tx.dailyReportRevision.create({
          data: {
            reportId: before.id,
            revisionNo: before.revisionNo,
            snapshot,
            contentHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
            createdById: actor.userId,
          },
        });
      }
      await tx.dailyReport.update({ where: { id: reportId }, data });
    });

    const after = await this.prisma.dailyReport.findUnique({ where: { id: reportId }, include: REPORT_INCLUDE });
    if (!after) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rapor bulunamadı' });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'dailyreport.updated',
      entityType: 'DailyReport',
      entityId: reportId,
      before: { status: before.status, workSummary: before.workSummary, revisionNo: before.revisionNo },
      after: { status: after.status, workSummary: after.workSummary, revisionNo: after.revisionNo },
      ...meta,
    });

    if (needsRevision) {
      await this.audit.record({
        actorUserId: actor.userId,
        action: 'dailyreport.revision_created',
        entityType: 'DailyReport',
        entityId: reportId,
        after: { revisionNo: before.revisionNo, revisionCount: after.revisionNo },
        ...meta,
      });
    }

    return this.toDto(after, false);
  }

  // ---------- Durum akışı ----------

  async submit(
    actorUserId: string,
    reportId: string,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<DailyReportDto> {
    const actor = await this.getActor(actorUserId);
    const before = await this.getReportInScope(actor, reportId);
    if (!canTransitionDailyReportStatus(before.status, 'SUBMITTED')) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Geçersiz durum geçişi: ${before.status} → SUBMITTED`,
      });
    }
    await this.prisma.dailyReport.update({
      where: { id: reportId },
      data: { status: 'SUBMITTED', submittedAt: new Date(), rejectedReason: null },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'dailyreport.submitted',
      entityType: 'DailyReport',
      entityId: reportId,
      before: { status: before.status },
      after: { status: 'SUBMITTED' },
      ...meta,
    });
    const after = await this.prisma.dailyReport.findUnique({ where: { id: reportId }, include: REPORT_INCLUDE });
    if (!after) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rapor bulunamadı' });
    return this.toDto(after, false);
  }

  async approve(
    actorUserId: string,
    reportId: string,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<DailyReportDto> {
    const actor = await this.getActor(actorUserId);
    const before = await this.getReportInScope(actor, reportId);
    if (!canTransitionDailyReportStatus(before.status, 'APPROVED')) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Geçersiz durum geçişi: ${before.status} → APPROVED`,
      });
    }
    await this.prisma.dailyReport.update({
      where: { id: reportId },
      data: { status: 'APPROVED', approvedById: actor.userId, approvedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'dailyreport.approved',
      entityType: 'DailyReport',
      entityId: reportId,
      before: { status: before.status },
      after: { status: 'APPROVED', approvedById: actor.userId },
      ...meta,
    });
    const after = await this.prisma.dailyReport.findUnique({ where: { id: reportId }, include: REPORT_INCLUDE });
    if (!after) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rapor bulunamadı' });
    return this.toDto(after, false);
  }

  async reject(
    actorUserId: string,
    reportId: string,
    reason: string,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<DailyReportDto> {
    const actor = await this.getActor(actorUserId);
    const before = await this.getReportInScope(actor, reportId);
    if (!canTransitionDailyReportStatus(before.status, 'REJECTED')) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Geçersiz durum geçişi: ${before.status} → REJECTED`,
      });
    }
    await this.prisma.dailyReport.update({
      where: { id: reportId },
      data: { status: 'REJECTED', rejectedReason: reason },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'dailyreport.rejected',
      entityType: 'DailyReport',
      entityId: reportId,
      before: { status: before.status },
      after: { status: 'REJECTED', reason },
      ...meta,
    });
    const after = await this.prisma.dailyReport.findUnique({ where: { id: reportId }, include: REPORT_INCLUDE });
    if (!after) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rapor bulunamadı' });
    return this.toDto(after, false);
  }

  async reopen(
    actorUserId: string,
    reportId: string,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<DailyReportDto> {
    const actor = await this.getActor(actorUserId);
    const before = await this.getReportInScope(actor, reportId);
    if (!canTransitionDailyReportStatus(before.status, 'DRAFT')) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Geçersiz durum geçişi: ${before.status} → DRAFT`,
      });
    }
    await this.prisma.dailyReport.update({
      where: { id: reportId },
      data: { status: 'DRAFT', rejectedReason: null },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'dailyreport.reopened',
      entityType: 'DailyReport',
      entityId: reportId,
      before: { status: before.status },
      after: { status: 'DRAFT' },
      ...meta,
    });
    const after = await this.prisma.dailyReport.findUnique({ where: { id: reportId }, include: REPORT_INCLUDE });
    if (!after) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rapor bulunamadı' });
    return this.toDto(after, false);
  }

  // ---------- Yardımcılar ----------

  /** Rapor galerisi DTO'su — imzalı URL yalnızca detay görünümünde üretilir. */
  private toMediaDto(
    media: {
      id: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      createdAt: Date;
    },
    withUrl: boolean,
  ): DailyReportMediaDto {
    const signed = withUrl ? buildMediaUrl(media.id, 'read') : null;
    return {
      id: media.id,
      originalName: media.originalName,
      mimeType: media.mimeType as DailyReportMediaDto['mimeType'],
      sizeBytes: media.sizeBytes,
      url: signed?.url ?? '',
      createdAt: media.createdAt.toISOString(),
    };
  }

  private async assertMediaList(actor: Actor, mediaIds: string[], projectId: string): Promise<void> {
    for (const mediaId of mediaIds) {
      await this.mediaService.assertAttachable(actor, mediaId, projectId);
    }
  }
}
