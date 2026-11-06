/**
 * Rapor servisi (Faz 10) — tüm raporlar GERÇEK DB verisinden üretilir.
 *
 * Kurallar (prompts/phase-10-development.md, docs/08, docs/06):
 * - Yetki: uçlarda PermissionsGuard raporun alt veri iznini zorunlu kılar
 *   (REPORT_PERMISSIONS); kapsam burada uygulanır — FIRM_ADMIN tüm projeler,
 *   diğer roller yalnızca üye oldukları projeler. Kapsam dışı proje filtresi
 *   boş sonuç döner (liste boşluğu bilgi sızdırmaz; detay uçlarındaki 404
 *   politikası burada geçerli değildir).
 * - Tarih aralığı verilmezse son 30 gün (sunucu tarafı varsayılan, belgeli) —
 *   sınırsız tarama engellenir (docs/08 "büyük veri kontrolü").
 * - Gruplamalı raporlarda sayfalama grup dizisi üzerinde dilimle yapılır;
 *   grup sayısı gün × proje ile sınırlıdır (30 gün × projeler).
 * - Para toplamları Prisma Decimal'den kanonik string'e çevrilir; birden
 *   fazla para birimi karışırsa toplam UYDURULMAZ (null + mixed işareti).
 * - Kritik stok karşılaştırması iki kolon arasında olduğundan JS'te yapılır;
 *   katalog sınırlı olduğu için bellek sınırı belgelenmiştir (docs/08 MVP).
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  parseMoney,
  type AttendanceReportQuery,
  type AttendanceReportRow,
  type ClaimSummaryQuery,
  type ClaimSummaryRow,
  type DailyReportSummaryQuery,
  type DailyReportSummaryRow,
  type ExpenseSummaryQuery,
  type ExpenseSummaryRow,
  type ProjectOverviewQuery,
  type ProjectOverviewRow,
  type StockBalanceQuery,
  type StockBalanceRow,
  type StockMovementQuery,
  type StockMovementRow,
  type TaskStatusQuery,
  type TaskStatusRow,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { dateOnlyValue } from '../../common/date-utils.js';

interface Actor {
  userId: string;
  roles: string[];
}

const ACTIVE_TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED'] as const;
/** Varsayılan rapor aralığı: son 30 gün (bugün dâhil). */
const DEFAULT_RANGE_DAYS = 30;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Ortak yardımcılar ----------

  async getActor(userId: string): Promise<Actor> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { roles: { select: { role: { select: { key: true } } } } },
    });
    return { userId, roles: user?.roles.map((r) => r.role.key) ?? [] };
  }

  private isAdmin(actor: Actor): boolean {
    return actor.roles.includes('FIRM_ADMIN');
  }

  async scopedProjectIds(actor: Actor): Promise<string[] | null> {
    if (this.isAdmin(actor)) return null;
    const rows = await this.prisma.projectMember.findMany({
      where: { userId: actor.userId },
      select: { projectId: true },
    });
    return rows.map((r) => r.projectId);
  }

  private istanbulToday(): string {
    // Europe/Istanbul (UTC+3, kalıcı — docs/implementation-notes.md).
    return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private istanbulTodayMinus(days: number): string {
    return new Date(Date.now() + 3 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private dayStart(dateStr: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `Geçersiz tarih: ${dateStr}` });
    }
    return new Date(`${dateStr}T00:00:00.000Z`);
  }

  private dayEndExclusive(dateStr: string): Date {
    return new Date(this.dayStart(dateStr).getTime() + 24 * 60 * 60 * 1000);
  }

  /** Tarih aralığı: verilmezse son 30 gün; ters aralık 400. */
  private resolveRange(dateFrom?: string, dateTo?: string): { dateFrom: string; dateTo: string } {
    const from = dateFrom ?? this.istanbulTodayMinus(DEFAULT_RANGE_DAYS - 1);
    const to = dateTo ?? this.istanbulToday();
    if (from > to) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Başlangıç tarihi bitişten sonra olamaz' });
    }
    return { dateFrom: from, dateTo: to };
  }

  /** Proje listesi kapsamı + sayfalama: proje başına satır üreten raporların iskeleti. */
  private async pagedProjectScope(
    scope: string[] | null,
    query: Pick<ProjectOverviewQuery, 'projectId' | 'page' | 'pageSize'>,
  ): Promise<{ total: number; page: { id: string; code: string; name: string; status: string }[] }> {
    const where: Prisma.ProjectWhereInput = {
      ...(scope ? { id: { in: scope } } : {}),
      ...(query.projectId ? { id: query.projectId } : {}),
    };
    const [total, page] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, code: true, name: true, status: true },
      }),
    ]);
    return { total, page };
  }

  // ---------- 1) Proje genel görünümü ----------

  async projectOverview(userId: string, query: ProjectOverviewQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);
    const { total, page: projects } = await this.pagedProjectScope(scope, query);
    const meta = buildPaginationMeta(query.page, query.pageSize, total);
    if (!projects.length) return { data: [] as ProjectOverviewRow[], meta };

    const ids = projects.map((p) => p.id);
    const now = new Date();

    const [taskGroups, overdueGroups, dailyGroups, attendanceGroups, movementGroups, expenseGroups, claimSums, itemCurrencies, taskMax, dailyMax, movementMax, expenseMax, claimMax] =
      await Promise.all([
        this.prisma.task.groupBy({ by: ['projectId', 'status'], where: { projectId: { in: ids } }, _count: { _all: true } }),
        this.prisma.task.groupBy({
          by: ['projectId'],
          where: { projectId: { in: ids }, status: { in: [...ACTIVE_TASK_STATUSES] }, dueAt: { lt: now } },
          _count: { _all: true },
        }),
        this.prisma.dailyReport.groupBy({ by: ['projectId', 'status'], where: { projectId: { in: ids } }, _count: { _all: true } }),
        this.prisma.attendanceRecord.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _count: { _all: true } }),
        this.prisma.stockMovement.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _count: { _all: true } }),
        this.prisma.expense.groupBy({
          by: ['projectId', 'status', 'currency'],
          where: { projectId: { in: ids }, deletedAt: null },
          _sum: { amount: true },
        }),
        this.prisma.progressClaim.groupBy({
          by: ['projectId'],
          where: { projectId: { in: ids }, status: 'APPROVED', deletedAt: null },
          _sum: { netTotal: true },
        }),
        this.prisma.contractItem.groupBy({ by: ['projectId', 'currency'], where: { projectId: { in: ids } }, _count: { _all: true } }),
        this.prisma.task.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _max: { updatedAt: true } }),
        this.prisma.dailyReport.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _max: { updatedAt: true } }),
        this.prisma.stockMovement.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _max: { occurredAt: true } }),
        this.prisma.expense.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, deletedAt: null }, _max: { updatedAt: true } }),
        this.prisma.progressClaim.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, deletedAt: null }, _max: { updatedAt: true } }),
      ]);

    const data: ProjectOverviewRow[] = projects.map((project) => {
      const taskStatusGroups = taskGroups.filter((g) => g.projectId === project.id);
      const taskCount = (status: string) => taskStatusGroups.find((g) => g.status === status)?._count._all ?? 0;
      const todo = taskCount('TODO');
      const inProgress = taskCount('IN_PROGRESS');
      const blocked = taskCount('BLOCKED');
      const done = taskCount('DONE');
      const cancelled = taskCount('CANCELLED');

      const dailyStatusGroups = dailyGroups.filter((g) => g.projectId === project.id);
      const dailyCount = (status: string) => dailyStatusGroups.find((g) => g.status === status)?._count._all ?? 0;

      // Giderler: para birimi başına durum toplamları — karışık para biriminde uydurma yok.
      const projectExpenseGroups = expenseGroups.filter((g) => g.projectId === project.id);
      const expenseCurrencies = [...new Set(projectExpenseGroups.map((g) => g.currency))];
      let expenseApprovedTotal: string | null = null;
      let expensePendingTotal: string | null = null;
      let expenseCurrency: string | null = null;
      let expenseMixedCurrency = false;
      if (expenseCurrencies.length === 1) {
        expenseCurrency = expenseCurrencies[0]!;
        const approved = projectExpenseGroups.find((g) => g.currency === expenseCurrency && g.status === 'APPROVED')?._sum.amount;
        const pending = projectExpenseGroups.find((g) => g.currency === expenseCurrency && g.status === 'PENDING')?._sum.amount;
        expenseApprovedTotal = approved ? String(approved) : null;
        expensePendingTotal = pending ? String(pending) : null;
      } else if (expenseCurrencies.length > 1) {
        expenseMixedCurrency = true;
      }

      // Hakediş: kalemlerin para birimleri tutarlıysa toplam gösterilir; karışıksa null.
      const claimCurrencies = [...new Set(itemCurrencies.filter((g) => g.projectId === project.id).map((g) => g.currency))];
      const claimSum = claimSums.find((g) => g.projectId === project.id)?._sum.netTotal;
      const claimApprovedNetTotal = claimCurrencies.length === 1 && claimSum ? String(claimSum) : null;

      const lastCandidates = [
        taskMax.find((g) => g.projectId === project.id)?._max.updatedAt ?? null,
        dailyMax.find((g) => g.projectId === project.id)?._max.updatedAt ?? null,
        movementMax.find((g) => g.projectId === project.id)?._max.occurredAt ?? null,
        expenseMax.find((g) => g.projectId === project.id)?._max.updatedAt ?? null,
        claimMax.find((g) => g.projectId === project.id)?._max.updatedAt ?? null,
      ].filter((v): v is Date => v !== null);
      const lastActivityAt = lastCandidates.length
        ? new Date(Math.max(...lastCandidates.map((d) => d.getTime()))).toISOString()
        : null;

      return {
        projectId: project.id,
        projectCode: project.code,
        projectName: project.name,
        projectStatus: project.status,
        taskTotal: todo + inProgress + blocked + done + cancelled,
        taskDone: done,
        taskActive: todo + inProgress + blocked,
        taskOverdue: overdueGroups.find((g) => g.projectId === project.id)?._count._all ?? 0,
        dailyReportTotal: dailyCount('DRAFT') + dailyCount('SUBMITTED') + dailyCount('APPROVED') + dailyCount('REJECTED'),
        dailyReportApproved: dailyCount('APPROVED'),
        dailyReportSubmitted: dailyCount('SUBMITTED'),
        attendanceRecordCount: attendanceGroups.find((g) => g.projectId === project.id)?._count._all ?? 0,
        stockMovementCount: movementGroups.find((g) => g.projectId === project.id)?._count._all ?? 0,
        expenseApprovedTotal,
        expensePendingTotal,
        expenseCurrency,
        expenseMixedCurrency,
        claimApprovedNetTotal,
        lastActivityAt,
      };
    });

    return { data, meta };
  }

  // ---------- 2) Günlük rapor özeti ----------

  async dailyReportSummary(userId: string, query: DailyReportSummaryQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);
    const { dateFrom, dateTo } = this.resolveRange(query.dateFrom, query.dateTo);
    const where: Prisma.DailyReportWhereInput = {
      ...(scope ? { projectId: { in: scope } } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.siteId ? { siteId: query.siteId } : {}),
      reportDate: { gte: this.dayStart(dateFrom), lt: this.dayEndExclusive(dateTo) },
      ...(query.status ? { status: query.status } : {}),
    };

    const [statusGroups, revisionGroups] = await Promise.all([
      this.prisma.dailyReport.groupBy({ by: ['projectId', 'reportDate', 'status'], where, _count: { _all: true } }),
      this.prisma.dailyReport.groupBy({ by: ['projectId', 'reportDate'], where, _sum: { revisionNo: true } }),
    ]);

    const buckets = new Map<string, DailyReportSummaryRow>();
    for (const g of statusGroups) {
      const key = `${g.projectId}|${dateOnlyValue(g.reportDate)}`;
      const bucket = buckets.get(key) ?? {
        reportDate: dateOnlyValue(g.reportDate),
        projectId: g.projectId,
        projectName: '',
        total: 0,
        draft: 0,
        submitted: 0,
        approved: 0,
        rejected: 0,
        revisionTotal: 0,
      };
      bucket.total += g._count._all;
      if (g.status === 'DRAFT') bucket.draft += g._count._all;
      else if (g.status === 'SUBMITTED') bucket.submitted += g._count._all;
      else if (g.status === 'APPROVED') bucket.approved += g._count._all;
      else if (g.status === 'REJECTED') bucket.rejected += g._count._all;
      buckets.set(key, bucket);
    }
    for (const g of revisionGroups) {
      const bucket = buckets.get(`${g.projectId}|${dateOnlyValue(g.reportDate)}`);
      if (bucket) bucket.revisionTotal = g._sum.revisionNo ?? 0;
    }

    const rows = [...buckets.values()].sort(
      (a, b) => b.reportDate.localeCompare(a.reportDate) || a.projectId.localeCompare(b.projectId),
    );
    const meta = buildPaginationMeta(query.page, query.pageSize, rows.length);
    const data = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    await this.fillProjectNames(data);
    return { data, meta };
  }

  // ---------- 3) Puantaj özeti ----------

  async attendanceReport(userId: string, query: AttendanceReportQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);
    const { dateFrom, dateTo } = this.resolveRange(query.dateFrom, query.dateTo);
    const where: Prisma.AttendanceRecordWhereInput = {
      ...(scope ? { projectId: { in: scope } } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.siteId ? { siteId: query.siteId } : {}),
      workDate: { gte: this.dayStart(dateFrom), lt: this.dayEndExclusive(dateTo) },
      ...(query.status ? { status: query.status } : {}),
    };

    const [statusGroups, minuteGroups] = await Promise.all([
      this.prisma.attendanceRecord.groupBy({ by: ['projectId', 'workDate', 'status'], where, _count: { _all: true } }),
      this.prisma.attendanceRecord.groupBy({ by: ['projectId', 'workDate'], where, _sum: { workedMinutes: true } }),
    ]);

    const buckets = new Map<string, AttendanceReportRow>();
    for (const g of statusGroups) {
      const key = `${g.projectId}|${dateOnlyValue(g.workDate)}`;
      const bucket: AttendanceReportRow = buckets.get(key) ?? {
        workDate: dateOnlyValue(g.workDate),
        projectId: g.projectId,
        projectName: '',
        recordCount: 0,
        workedMinutesTotal: 0,
        statusBreakdown: [],
      };
      bucket.recordCount += g._count._all;
      bucket.statusBreakdown.push({ status: g.status, count: g._count._all });
      buckets.set(key, bucket);
    }
    for (const g of minuteGroups) {
      const bucket = buckets.get(`${g.projectId}|${dateOnlyValue(g.workDate)}`);
      if (bucket) bucket.workedMinutesTotal = g._sum.workedMinutes ?? 0;
    }
    for (const bucket of buckets.values()) bucket.statusBreakdown.sort((a, b) => b.count - a.count);

    const rows = [...buckets.values()].sort(
      (a, b) => b.workDate.localeCompare(a.workDate) || a.projectId.localeCompare(b.projectId),
    );
    const meta = buildPaginationMeta(query.page, query.pageSize, rows.length);
    const data = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    await this.fillProjectNames(data);
    return { data, meta };
  }

  // ---------- 4) Stok bakiyesi ----------

  async stockBalance(userId: string, query: StockBalanceQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);
    // Depo kapsamı: kurum deposu (projectId null) herkese açık; proje deposu üyelik ister.
    const warehouseScope: Prisma.WarehouseWhereInput = scope
      ? { OR: [{ projectId: null }, { projectId: { in: scope } }] }
      : {};
    const where: Prisma.StockBalanceWhereInput = {
      warehouse: {
        AND: [
          warehouseScope,
          ...(query.warehouseId ? [{ id: query.warehouseId }] : []),
          ...(query.projectId ? [{ projectId: query.projectId }] : []),
        ],
      },
      ...(query.materialId ? { materialId: query.materialId } : {}),
    };

    // Katalog sınırlı olduğundan kartlar tek sorguda çekilir; kritik stok
    // karşılaştırması (quantity < minStock) iki kolon arasında olduğundan JS'te.
    const all = await this.prisma.stockBalance.findMany({
      where,
      include: {
        material: { select: { id: true, code: true, name: true, unit: true, minStock: true } },
        warehouse: { select: { id: true, name: true, projectId: true } },
      },
      orderBy: [{ material: { name: 'asc' } }, { id: 'asc' }],
    });

    const mapped: StockBalanceRow[] = all.map((row) => {
      const minStock = row.material.minStock;
      const belowMin = minStock !== null && Number(row.quantity) < Number(minStock);
      return {
        materialId: row.materialId,
        materialCode: row.material.code,
        materialName: row.material.name,
        unit: row.material.unit,
        warehouseId: row.warehouseId,
        warehouseName: row.warehouse.name,
        warehouseProjectId: row.warehouse.projectId,
        quantity: String(row.quantity),
        minStock: minStock === null ? null : String(minStock),
        belowMin,
        lastMovementAt: row.lastMovementAt.toISOString(),
      };
    });
    const belowMinOnly = query.belowMin === undefined ? undefined : query.belowMin === 'true';
    const filtered = belowMinOnly === undefined ? mapped : mapped.filter((r) => r.belowMin === belowMinOnly);
    const meta = buildPaginationMeta(query.page, query.pageSize, filtered.length);
    const data = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    return { data, meta };
  }

  // ---------- 5) Stok hareketleri ----------

  async stockMovements(userId: string, query: StockMovementQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);
    const { dateFrom, dateTo } = this.resolveRange(query.dateFrom, query.dateTo);
    const where: Prisma.StockMovementWhereInput = {
      AND: [
        // Hareket kapsamı: kurum hareketi (projectId null) herkese açık; proje
        // hareketi üyelik ister. Depo kapsamı da aynı anda denetlenir.
        ...(scope
          ? [
              { OR: [{ projectId: null }, { projectId: { in: scope } }] },
              { warehouse: { OR: [{ projectId: null }, { projectId: { in: scope } }] } },
            ]
          : []),
        { occurredAt: { gte: this.dayStart(dateFrom), lt: this.dayEndExclusive(dateTo) } },
        ...(query.projectId
          ? [
              {
                OR: [
                  { projectId: query.projectId },
                  { warehouse: { projectId: query.projectId } },
                  { targetWarehouse: { projectId: query.projectId } },
                ],
              },
            ]
          : []),
        ...(query.warehouseId ? [{ OR: [{ warehouseId: query.warehouseId }, { targetWarehouseId: query.warehouseId }] }] : []),
        ...(query.materialId ? [{ materialId: query.materialId }] : []),
        ...(query.type ? [{ type: query.type }] : []),
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        include: {
          material: { select: { code: true, name: true, unit: true } },
          warehouse: { select: { name: true } },
          targetWarehouse: { select: { name: true } },
          project: { select: { name: true } },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const data: StockMovementRow[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      materialName: row.material.name,
      materialCode: row.material.code,
      unit: row.material.unit,
      warehouseName: row.warehouse.name,
      targetWarehouseName: row.targetWarehouse?.name ?? null,
      projectName: row.project?.name ?? null,
      quantity: String(row.quantity),
      unitCost: row.unitCost === null ? null : String(row.unitCost),
      occurredAt: row.occurredAt.toISOString(),
      note: row.note,
      reversalOfId: row.reversesMovementId,
    }));
    return { data, meta: buildPaginationMeta(query.page, query.pageSize, total) };
  }

  // ---------- 6) Gider özeti ----------

  async expenseSummary(userId: string, query: ExpenseSummaryQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);
    const { dateFrom, dateTo } = this.resolveRange(query.dateFrom, query.dateTo);
    const where: Prisma.ExpenseWhereInput = {
      ...(scope ? { projectId: { in: scope } } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.status ? { status: query.status } : {}),
      expenseDate: { gte: this.dayStart(dateFrom), lt: this.dayEndExclusive(dateTo) },
      deletedAt: null,
    };
    const groups = await this.prisma.expense.groupBy({
      by: ['categoryId', 'currency', 'status'],
      where,
      _count: { _all: true },
      _sum: { amount: true },
    });

    interface Bucket {
      categoryId: string;
      currency: string;
      draftCount: number;
      pendingCount: number;
      approvedCount: number;
      rejectedCount: number;
      draftTotal: bigint;
      pendingTotal: bigint;
      approvedTotal: bigint;
      rejectedTotal: bigint;
    }
    const buckets = new Map<string, Bucket>();
    for (const g of groups) {
      const key = `${g.categoryId}|${g.currency}`;
      const bucket = buckets.get(key) ?? {
        categoryId: g.categoryId,
        currency: g.currency,
        draftCount: 0,
        pendingCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        draftTotal: 0n,
        pendingTotal: 0n,
        approvedTotal: 0n,
        rejectedTotal: 0n,
      };
      // Decimal → 2 ondalık ölçekli BigInt (yarım yukarı — contracts/finance.ts politikası).
      const amount = g._sum.amount ? parseMoney(g._sum.amount.toFixed(2)) : 0n;
      if (g.status === 'DRAFT') {
        bucket.draftCount += g._count._all;
        bucket.draftTotal += amount;
      } else if (g.status === 'PENDING') {
        bucket.pendingCount += g._count._all;
        bucket.pendingTotal += amount;
      } else if (g.status === 'APPROVED') {
        bucket.approvedCount += g._count._all;
        bucket.approvedTotal += amount;
      } else if (g.status === 'REJECTED') {
        bucket.rejectedCount += g._count._all;
        bucket.rejectedTotal += amount;
      }
      buckets.set(key, bucket);
    }

    const categoryIds = [...new Set([...buckets.values()].map((b) => b.categoryId))];
    const categories = categoryIds.length
      ? await this.prisma.expenseCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
      : [];
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));

    const canonical = (scaled: bigint): string => `${(scaled / 100n).toString()}.${(scaled % 100n).toString().padStart(2, '0')}`;
    const rows: ExpenseSummaryRow[] = [...buckets.values()]
      .map((b) => {
        const grand = b.draftTotal + b.pendingTotal + b.approvedTotal + b.rejectedTotal;
        return {
          categoryId: b.categoryId,
          categoryName: categoryName.get(b.categoryId) ?? '(kategori silinmiş)',
          currency: b.currency,
          draftCount: b.draftCount,
          pendingCount: b.pendingCount,
          approvedCount: b.approvedCount,
          rejectedCount: b.rejectedCount,
          draftTotal: canonical(b.draftTotal),
          pendingTotal: canonical(b.pendingTotal),
          approvedTotal: canonical(b.approvedTotal),
          rejectedTotal: canonical(b.rejectedTotal),
          grandTotal: canonical(grand),
        };
      })
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'tr') || a.currency.localeCompare(b.currency));

    const meta = buildPaginationMeta(query.page, query.pageSize, rows.length);
    const data = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    return { data, meta };
  }

  // ---------- 7) Hakediş dönem özeti ----------

  async claimSummary(userId: string, query: ClaimSummaryQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);
    const { dateFrom, dateTo } = this.resolveRange(query.dateFrom, query.dateTo);
    const where: Prisma.ProgressClaimWhereInput = {
      ...(scope ? { projectId: { in: scope } } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      periodStart: { gte: this.dayStart(dateFrom), lt: this.dayEndExclusive(dateTo) },
      deletedAt: null,
    };
    const [total, rows] = await Promise.all([
      this.prisma.progressClaim.count({ where }),
      this.prisma.progressClaim.findMany({
        where,
        include: {
          project: { select: { name: true } },
          lines: { select: { contractItem: { select: { currency: true } } } },
        },
        orderBy: [{ periodStart: 'desc' }, { claimNo: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const data: ClaimSummaryRow[] = rows.map((row) => {
      const currencies = [...new Set(row.lines.map((l) => l.contractItem.currency))];
      return {
        claimId: row.id,
        projectId: row.projectId,
        projectName: row.project.name,
        claimNo: row.claimNo,
        periodStart: dateOnlyValue(row.periodStart),
        periodEnd: dateOnlyValue(row.periodEnd),
        status: row.status,
        currency: currencies.length === 1 ? currencies[0]! : null,
        grossTotal: String(row.grossTotal),
        deductionTotal: String(row.deductionTotal),
        netTotal: String(row.netTotal),
        previousTotal: String(row.previousTotal),
        cumulativeTotal: String(row.cumulativeTotal),
      };
    });
    return { data, meta: buildPaginationMeta(query.page, query.pageSize, total) };
  }

  // ---------- 8) Görev durum / termin ----------

  async taskStatus(userId: string, query: TaskStatusQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);
    const { total, page: projects } = await this.pagedProjectScope(scope, query);
    const meta = buildPaginationMeta(query.page, query.pageSize, total);
    if (!projects.length) return { data: [] as TaskStatusRow[], meta };

    const ids = projects.map((p) => p.id);
    const now = new Date();
    const soonEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const siteFilter = query.siteId ? { siteId: query.siteId } : {};

    const [statusGroups, overdueGroups, dueSoonGroups] = await Promise.all([
      this.prisma.task.groupBy({
        by: ['projectId', 'status'],
        where: { projectId: { in: ids }, ...siteFilter },
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['projectId'],
        where: { projectId: { in: ids }, status: { in: [...ACTIVE_TASK_STATUSES] }, dueAt: { lt: now }, ...siteFilter },
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['projectId'],
        where: { projectId: { in: ids }, status: { in: [...ACTIVE_TASK_STATUSES] }, dueAt: { gte: now, lt: soonEnd }, ...siteFilter },
        _count: { _all: true },
      }),
    ]);

    const data: TaskStatusRow[] = projects.map((project) => {
      const groups = statusGroups.filter((g) => g.projectId === project.id);
      const countBy = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
      const todo = countBy('TODO');
      const inProgress = countBy('IN_PROGRESS');
      const blocked = countBy('BLOCKED');
      const done = countBy('DONE');
      const cancelled = countBy('CANCELLED');
      return {
        projectId: project.id,
        projectName: project.name,
        todo,
        inProgress,
        blocked,
        done,
        cancelled,
        overdue: overdueGroups.find((g) => g.projectId === project.id)?._count._all ?? 0,
        dueSoon: dueSoonGroups.find((g) => g.projectId === project.id)?._count._all ?? 0,
        total: todo + inProgress + blocked + done + cancelled,
      };
    });
    return { data, meta };
  }

  // ---------- Ortak: proje adlarını doldur ----------

  private async fillProjectNames(rows: { projectId: string; projectName: string }[]): Promise<void> {
    const ids = [...new Set(rows.map((r) => r.projectId))];
    if (!ids.length) return;
    const projects = await this.prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const name = new Map(projects.map((p) => [p.id, p.name]));
    for (const row of rows) row.projectName = name.get(row.projectId) ?? '(bilinmeyen proje)';
  }
}
