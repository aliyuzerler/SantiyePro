/**
 * Hakediş servisi (Faz 08).
 *
 * Kurallar (prompts/phase-08-development.md, docs/04, docs/06):
 * - Hesaplama contracts/finance.ts saf fonksiyonlarında, BigInt ölçekli
 *   aritmetikle yapılır; yuvarlama: para 2 ondalık YARIM YUKARI.
 * - FİYAT SNAPSHOT'I: satır oluşturulduğunda kalem fiyatı kopyalanır;
 *   kalem fiyatı sonradan değişse bile satır (ve hakediş) değişmez.
 * - ONAYLI HAKEDİŞ DEĞİŞMEZ: PATCH/DELETE/satır değişimi yalnızca DRAFT'ta;
 *   hesaplama (calculate) onaylıda yeniden hesaplamaz, saklanan değeri döner.
 * - İPTAL POLİTİKASI: yalnızca DRAFT/PENDING iptal edilebilir; onay sonrası
 *   düzeltme yeni (mahsup) hakedişle yapılır.
 * - ZİNCİR: satırın previousQuantity'i, aynı kalem için önceki hakedişteki
 *   kümülatif miktarla aynı olmalıdır (REJECTED/CANCELLED hariç) — uydurma
 *   geçmiş engellenir. claimNo proje içinde benzersiz; dönemler üst üste
 *   binemez (REJECTED/CANCELLED hariç).
 * - KAPSAM: FIRM_ADMIN tümü; diğer roller yalnızca üye oldukları projeler.
 *   Kapsam dışı 404 (IDOR koruması).
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ProgressClaimStatus as PrismaProgressClaimStatus, Prisma } from '@prisma/client';
import {
  CLAIM_FORMULA_DESCRIPTION,
  buildPaginationMeta,
  computeClaimLine,
  computeClaimTotals,
  parseMoney,
  type ClaimCalculationDto,
  type ClaimLineDto,
  type ProgressClaimCreateRequest,
  type ProgressClaimDto,
  type ProgressClaimLineReplace,
  type ProgressClaimListQuery,
  type ProgressClaimStatus,
  type ProgressClaimUpdateRequest,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';

interface Actor {
  userId: string;
  roles: string[];
}

type ClaimRow = Prisma.ProgressClaimGetPayload<{ include: typeof CLAIM_INCLUDE }>;
type LineRow = Prisma.ProgressClaimLineGetPayload<{ include: typeof LINE_INCLUDE }>;

const LINE_INCLUDE = {
  contractItem: { select: { id: true, code: true, description: true, unit: true, contractQuantity: true } },
} satisfies Prisma.ProgressClaimLineInclude;

const CLAIM_INCLUDE = {
  project: { select: { id: true, name: true } },
  lines: { include: LINE_INCLUDE, orderBy: [{ contractItem: { sortOrder: 'asc' as const } }, { id: 'asc' as const }] },
  approvedBy: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ProgressClaimInclude;

/** Zincir ve dönem kurallarına dahil edilmeyecek durumlar. */
const EXCLUDED_FROM_CHAIN: PrismaProgressClaimStatus[] = ['REJECTED', 'CANCELLED'];

@Injectable()
export class ProgressClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  /** Kullanıcının üyesi olduğu proje kimlikleri (admin için null = tümü). */
  async scopedProjectIds(actor: Actor): Promise<string[] | null> {
    if (this.isAdmin(actor)) return null;
    const rows = await this.prisma.projectMember.findMany({
      where: { userId: actor.userId },
      select: { projectId: true },
    });
    return rows.map((r) => r.projectId);
  }

  /** Hakedişi kapsam içinde getir; kapsam dışıysa 404 (IDOR). */
  private async getClaimInScope(actor: Actor, claimId: string): Promise<ClaimRow> {
    const claim = await this.prisma.progressClaim.findFirst({
      where: { id: claimId, deletedAt: null },
      include: CLAIM_INCLUDE,
    });
    if (!claim) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Hakediş bulunamadı' });
    if (!this.isAdmin(actor)) {
      const member = await this.prisma.projectMember.findFirst({
        where: { projectId: claim.projectId, userId: actor.userId },
        select: { id: true },
      });
      if (!member) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Hakediş bulunamadı' });
    }
    return claim;
  }

  private assertCanManage(actor: Actor, claim: { createdById: string; status: ProgressClaimStatus }): void {
    if (claim.createdById !== actor.userId && !this.isAdmin(actor)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Yalnızca hakedişi hazırlayan veya firma yöneticisi bu işlemi yapabilir' });
    }
  }

  /** Dönem çakışması: aynı projede REJECTED/CANCELLED dışındaki hakedişlerle kesişme 409. */
  private async assertNoPeriodOverlap(projectId: string, periodStart: string, periodEnd: string, excludeClaimId?: string): Promise<void> {
    const overlap = await this.prisma.progressClaim.findFirst({
      where: {
        projectId,
        deletedAt: null,
        status: { notIn: EXCLUDED_FROM_CHAIN },
        ...(excludeClaimId ? { id: { not: excludeClaimId } } : {}),
        periodStart: { lte: new Date(`${periodEnd}T00:00:00.000Z`) },
        periodEnd: { gte: new Date(`${periodStart}T00:00:00.000Z`) },
      },
      select: { id: true, claimNo: true },
    });
    if (overlap) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Dönem, ${overlap.claimNo} numaralı hakedişle çakışıyor`,
        details: { conflictingClaimId: overlap.id },
      });
    }
  }

  /**
   * Zincir doğrulaması: her satır için previousQuantity, aynı kalemde önceki
   * (REJECTED/CANCELLED hariç) hakedişin kümülatif miktarına eşit olmalıdır;
   * önceki hakediş yoksa 0 olmalıdır. Ayrıca previousTotal, dönemi önce biten
   * en son hakedişin kümülatif toplamıdır (yoksa 0).
   */
  private async validateChainAndPreviousTotal(
    projectId: string,
    periodStart: string,
    lines: Array<{ contractItemId: string; previousQuantity: string }>,
    excludeClaimId?: string,
  ): Promise<string> {
    const itemIds = [...new Set(lines.map((l) => l.contractItemId))];

    // Dönemi önce biten en son hakediş (zincir toplamı için)
    const priorClaim = await this.prisma.progressClaim.findFirst({
      where: {
        projectId,
        deletedAt: null,
        status: { notIn: EXCLUDED_FROM_CHAIN },
        ...(excludeClaimId ? { id: { not: excludeClaimId } } : {}),
        periodEnd: { lt: new Date(`${periodStart}T00:00:00.000Z`) },
      },
      orderBy: [{ periodEnd: 'desc' }, { claimNo: 'desc' }],
      select: { id: true, cumulativeTotal: true },
    });
    const previousTotal = priorClaim ? priorClaim.cumulativeTotal.toFixed(2) : '0.00';

    // Her kalem için en son kümülatif miktar (aynı hakedişte tekrar eden satır yok — DB unique)
    const priorLines = await this.prisma.progressClaimLine.findMany({
      where: {
        contractItemId: { in: itemIds },
        claim: {
          projectId,
          deletedAt: null,
          status: { notIn: EXCLUDED_FROM_CHAIN },
          ...(excludeClaimId ? { id: { not: excludeClaimId } } : {}),
          periodEnd: { lt: new Date(`${periodStart}T00:00:00.000Z`) },
        },
      },
      orderBy: [{ claim: { periodEnd: 'desc' } }, { claim: { claimNo: 'desc' } }],
      select: { progressClaimId: true, contractItemId: true, cumulativeQuantity: true },
    });
    const latestCumulative = new Map<string, { quantity: string; claimId: string }>();
    for (const line of priorLines) {
      if (!latestCumulative.has(line.contractItemId)) {
        latestCumulative.set(line.contractItemId, { quantity: line.cumulativeQuantity.toFixed(3), claimId: line.progressClaimId });
      }
    }

    for (const line of lines) {
      const expected = latestCumulative.get(line.contractItemId);
      const prevNorm = normalizeQty3(line.previousQuantity);
      if (!expected) {
        if (prevNorm !== '0') {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Bu kalemde önceki hakediş yokken önceki miktar 0 olmalıdır',
          });
        }
        continue;
      }
      if (expected.claimId === excludeClaimId) continue; // kendi satırı hariç
      if (prevNorm !== normalizeQty3(expected.quantity)) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Önceki miktar, bu kalemdeki son hakedişin kümülatif miktarıyla uyumsuz (zincir bozulamaz)',
          details: { contractItemId: line.contractItemId, expectedPreviousQuantity: expected.quantity },
        });
      }
    }

    return previousTotal;
  }

  /** Satır girdilerini snapshot'lı hesaplanmış satırlara çevirir. */
  private async buildLines(
    projectId: string,
    lines: Array<{ contractItemId: string; previousQuantity: string; periodQuantity: string }>,
  ): Promise<{ data: Array<Omit<Prisma.ProgressClaimLineUncheckedCreateInput, 'progressClaimId'>>; dtos: ClaimLineDto[] }> {
    const itemIds = [...new Set(lines.map((l) => l.contractItemId))];
    const items = await this.prisma.contractItem.findMany({
      where: { id: { in: itemIds }, projectId },
      select: { id: true, code: true, description: true, unit: true, contractQuantity: true, unitPrice: true },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));

    const data: Array<Omit<Prisma.ProgressClaimLineUncheckedCreateInput, 'progressClaimId'>> = [];
    const dtos: ClaimLineDto[] = [];

    for (const line of lines) {
      const item = itemMap.get(line.contractItemId);
      if (!item) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sözleşme kalemi bulunamadı veya başka projeye ait' });
      }
      const computed = computeClaimLine({
        previousQuantity: line.previousQuantity,
        periodQuantity: line.periodQuantity,
        unitPrice: item.unitPrice.toFixed(4),
      });
      const cumulativeQty = computed.cumulativeQuantity;
      const contractQty = item.contractQuantity.toFixed(3);
      const isOver = qtyToNumber(cumulativeQty) > qtyToNumber(contractQty);
      data.push({
        contractItemId: item.id,
        previousQuantity: computed.previousQuantity,
        periodQuantity: computed.periodQuantity,
        cumulativeQuantity: computed.cumulativeQuantity,
        unitPriceSnapshot: computed.unitPriceSnapshot,
        lineAmount: computed.lineAmount,
      });
      dtos.push({
        id: '',
        contractItemId: item.id,
        code: item.code,
        description: item.description,
        unit: item.unit,
        contractQuantity: contractQty,
        previousQuantity: computed.previousQuantity,
        periodQuantity: computed.periodQuantity,
        cumulativeQuantity: cumulativeQty,
        unitPriceSnapshot: computed.unitPriceSnapshot,
        lineAmount: computed.lineAmount,
        isOver,
      });
    }

    return { data, dtos };
  }

  /** Kesinti brütü aşamaz (docs/04 net tutar kontrolü). */
  private assertDeductionWithinGross(deductionTotal: string, grossTotal: string): void {
    if (parseMoney(deductionTotal) > parseMoney(grossTotal)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Kesinti toplamı brüt tutarı aşamaz',
      });
    }
  }

  // ---------- Liste / detay ----------

  async listClaims(userId: string, query: ProgressClaimListQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);

    if (scope && !scope.includes(query.projectId)) {
      return { data: [], meta: buildPaginationMeta(query.page, query.pageSize, 0) };
    }

    const where: Prisma.ProgressClaimWhereInput = {
      projectId: query.projectId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    };

    const orderBy: Prisma.ProgressClaimOrderByWithRelationInput =
      query.sort === 'createdAt'
        ? { createdAt: query.order }
        : query.sort === 'claimNo'
          ? { claimNo: query.order }
          : { periodStart: query.order };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.progressClaim.count({ where }),
      this.prisma.progressClaim.findMany({
        where,
        orderBy: [orderBy, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: CLAIM_INCLUDE,
      }),
    ]);

    return {
      data: rows.map(ProgressClaimsService.toDto),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getClaim(userId: string, claimId: string): Promise<ProgressClaimDto> {
    const actor = await this.getActor(userId);
    const claim = await this.getClaimInScope(actor, claimId);
    return ProgressClaimsService.toDto(claim);
  }

  // ---------- Oluşturma ----------

  async createClaim(
    actorUserId: string,
    input: ProgressClaimCreateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ProgressClaimDto> {
    const actor = await this.getActor(actorUserId);
    const scope = await this.scopedProjectIds(actor);
    if (scope && !scope.includes(input.projectId)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });
    }
    const project = await this.prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
    if (!project) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });

    const claimNoDuplicate = await this.prisma.progressClaim.findFirst({
      where: { projectId: input.projectId, claimNo: input.claimNo, deletedAt: null },
      select: { id: true },
    });
    if (claimNoDuplicate) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Bu hakediş numarası bu projede zaten kullanımda' });
    }

    await this.assertNoPeriodOverlap(input.projectId, input.periodStart, input.periodEnd);
    const previousTotal = await this.validateChainAndPreviousTotal(input.projectId, input.periodStart, input.lines);
    const built = await this.buildLines(input.projectId, input.lines);

    const totals = computeClaimTotals({
      lines: built.dtos.map((d) => ({ lineAmount: d.lineAmount, previousAmount: '0.00' })),
      deductionTotal: input.deductionTotal,
      previousTotal,
    });
    this.assertDeductionWithinGross(totals.deductionTotal, totals.grossTotal);

    const claim = await this.prisma.progressClaim.create({
      data: {
        projectId: input.projectId,
        claimNo: input.claimNo,
        periodStart: new Date(`${input.periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${input.periodEnd}T00:00:00.000Z`),
        notes: input.notes ?? null,
        previousTotal: totals.previousTotal,
        grossTotal: totals.grossTotal,
        cumulativeTotal: totals.cumulativeTotal,
        deductionTotal: totals.deductionTotal,
        netTotal: totals.netTotal,
        createdById: actor.userId,
        lines: { create: built.data },
      },
      include: CLAIM_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'claim.created',
      entityType: 'ProgressClaim',
      entityId: claim.id,
      after: { claimNo: claim.claimNo, projectId: claim.projectId, netTotal: claim.netTotal.toFixed(2) },
      ...meta,
    });

    return ProgressClaimsService.toDto(claim);
  }

  // ---------- Güncelleme (yalnızca DRAFT) ----------

  async updateClaim(
    actorUserId: string,
    claimId: string,
    input: ProgressClaimUpdateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ProgressClaimDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getClaimInScope(actor, claimId);
    if (current.status !== 'DRAFT') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Yalnızca taslak hakediş düzenlenebilir' });
    }
    this.assertCanManage(actor, current);

    const periodStart = input.periodStart ?? current.periodStart.toISOString().slice(0, 10);
    const periodEnd = input.periodEnd ?? current.periodEnd.toISOString().slice(0, 10);
    if (periodEnd < periodStart) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Dönem bitişi başlangıçtan önce olamaz' });
    }

    const periodChanged = periodStart !== current.periodStart.toISOString().slice(0, 10) || periodEnd !== current.periodEnd.toISOString().slice(0, 10);
    if (periodChanged) {
      await this.assertNoPeriodOverlap(current.projectId, periodStart, periodEnd, current.id);
    }

    // Zincir toplamı dönem değiştiyse yeniden hesaplanır (satırlar aynı kalır)
    const linesInput = current.lines.map((l) => ({ contractItemId: l.contractItemId, previousQuantity: l.previousQuantity.toFixed(3) }));
    const previousTotal = periodChanged
      ? await this.validateChainAndPreviousTotal(current.projectId, periodStart, linesInput, current.id)
      : current.previousTotal.toFixed(2);

    const deductionTotal = input.deductionTotal ?? current.deductionTotal.toFixed(2);
    const totals = computeClaimTotals({
      lines: current.lines.map((l) => ({ lineAmount: l.lineAmount.toFixed(2), previousAmount: '0.00' })),
      deductionTotal,
      previousTotal,
    });
    this.assertDeductionWithinGross(totals.deductionTotal, totals.grossTotal);

    const claim = await this.prisma.progressClaim.update({
      where: { id: current.id },
      data: {
        periodStart: new Date(`${periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${periodEnd}T00:00:00.000Z`),
        notes: input.notes !== undefined ? input.notes : undefined,
        previousTotal: totals.previousTotal,
        grossTotal: totals.grossTotal,
        cumulativeTotal: totals.cumulativeTotal,
        deductionTotal: totals.deductionTotal,
        netTotal: totals.netTotal,
      },
      include: CLAIM_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'claim.updated',
      entityType: 'ProgressClaim',
      entityId: claim.id,
      before: { status: current.status, netTotal: current.netTotal.toFixed(2) },
      after: { status: claim.status, netTotal: claim.netTotal.toFixed(2) },
      ...meta,
    });

    return ProgressClaimsService.toDto(claim);
  }

  async replaceLines(
    actorUserId: string,
    claimId: string,
    input: ProgressClaimLineReplace,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ProgressClaimDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getClaimInScope(actor, claimId);
    if (current.status !== 'DRAFT') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Yalnızca taslak hakedişin satırları değiştirilebilir' });
    }
    this.assertCanManage(actor, current);

    // Aynı kalem iki kez verilemez
    const itemIds = input.lines.map((l) => l.contractItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Bir sözleşme kalemi hakedişte yalnızca bir kez yer alabilir' });
    }

    const periodStart = current.periodStart.toISOString().slice(0, 10);
    await this.validateChainAndPreviousTotal(current.projectId, periodStart, input.lines, current.id);
    const built = await this.buildLines(current.projectId, input.lines);

    const totals = computeClaimTotals({
      lines: built.dtos.map((d) => ({ lineAmount: d.lineAmount, previousAmount: '0.00' })),
      deductionTotal: current.deductionTotal.toFixed(2),
      previousTotal: current.previousTotal.toFixed(2),
    });
    this.assertDeductionWithinGross(totals.deductionTotal, totals.grossTotal);

    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.progressClaimLine.deleteMany({ where: { progressClaimId: current.id } });
      await tx.progressClaimLine.createMany({ data: built.data.map((l) => ({ ...l, progressClaimId: current.id })) });
      return tx.progressClaim.update({
        where: { id: current.id },
        data: {
          previousTotal: totals.previousTotal,
          grossTotal: totals.grossTotal,
          cumulativeTotal: totals.cumulativeTotal,
          deductionTotal: totals.deductionTotal,
          netTotal: totals.netTotal,
        },
        include: CLAIM_INCLUDE,
      });
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'claim.lines_replaced',
      entityType: 'ProgressClaim',
      entityId: claim.id,
      after: { lineCount: built.data.length, netTotal: claim.netTotal.toFixed(2) },
      ...meta,
    });

    return ProgressClaimsService.toDto(claim);
  }

  async deleteClaim(
    actorUserId: string,
    claimId: string,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<{ id: string; deleted: true }> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getClaimInScope(actor, claimId);
    if (current.status !== 'DRAFT') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Yalnızca taslak hakediş silinebilir' });
    }
    this.assertCanManage(actor, current);

    await this.prisma.progressClaim.update({
      where: { id: current.id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'claim.deleted',
      entityType: 'ProgressClaim',
      entityId: current.id,
      before: { claimNo: current.claimNo, netTotal: current.netTotal.toFixed(2) },
      ...meta,
    });

    return { id: current.id, deleted: true };
  }

  // ---------- Hesaplama önizlemesi ----------

  /**
   * DRAFT'ta değerler mevcut satırlardan yeniden hesaplanır (recalculated=true);
   * PENDING/APPROVED/REJECTED/CANCELLED'ta SAKLANAN değerler aynen döner
   * (recalculated=false) — onaylı hakediş asla yeniden hesaplanmaz.
   */
  async calculateClaim(userId: string, claimId: string): Promise<ClaimCalculationDto> {
    const actor = await this.getActor(userId);
    const claim = await this.getClaimInScope(actor, claimId);

    if (claim.status === 'DRAFT') {
      const totals = computeClaimTotals({
        lines: claim.lines.map((l) => ({ lineAmount: l.lineAmount.toFixed(2), previousAmount: '0.00' })),
        deductionTotal: claim.deductionTotal.toFixed(2),
        previousTotal: claim.previousTotal.toFixed(2),
      });
      return {
        claimId: claim.id,
        status: claim.status as ProgressClaimStatus,
        recalculated: true,
        formulaDescription: CLAIM_FORMULA_DESCRIPTION,
        lines: claim.lines.map((l) => ProgressClaimsService.toLineDto(l)),
        totals,
      };
    }

    return {
      claimId: claim.id,
      status: claim.status as ProgressClaimStatus,
      recalculated: false,
      formulaDescription: CLAIM_FORMULA_DESCRIPTION,
      lines: claim.lines.map((l) => ProgressClaimsService.toLineDto(l)),
      totals: {
        previousTotal: claim.previousTotal.toFixed(2),
        grossTotal: claim.grossTotal.toFixed(2),
        cumulativeTotal: claim.cumulativeTotal.toFixed(2),
        deductionTotal: claim.deductionTotal.toFixed(2),
        netTotal: claim.netTotal.toFixed(2),
      },
    };
  }

  // ---------- Durum geçişleri ----------

  async submitClaim(
    actorUserId: string,
    claimId: string,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ProgressClaimDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getClaimInScope(actor, claimId);
    if (current.status !== 'DRAFT') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Yalnızca taslak hakediş onaya gönderilebilir' });
    }
    this.assertCanManage(actor, current);

    // Gönderim anında zincir/çakışma kuralları yeniden doğrulanır
    // (taslak döneminde referans alınan hakediş iptal/red edilmiş olabilir).
    const periodStart = current.periodStart.toISOString().slice(0, 10);
    const periodEnd = current.periodEnd.toISOString().slice(0, 10);
    await this.assertNoPeriodOverlap(current.projectId, periodStart, periodEnd, current.id);
    const linesInput = current.lines.map((l) => ({
      contractItemId: l.contractItemId,
      previousQuantity: l.previousQuantity.toFixed(3),
    }));
    const previousTotal = await this.validateChainAndPreviousTotal(current.projectId, periodStart, linesInput, current.id);

    const totals = computeClaimTotals({
      lines: current.lines.map((l) => ({ lineAmount: l.lineAmount.toFixed(2), previousAmount: '0.00' })),
      deductionTotal: current.deductionTotal.toFixed(2),
      previousTotal,
    });

    const claim = await this.prisma.progressClaim.update({
      where: { id: current.id },
      data: {
        status: 'PENDING',
        submittedAt: new Date(),
        previousTotal: totals.previousTotal,
        grossTotal: totals.grossTotal,
        cumulativeTotal: totals.cumulativeTotal,
        deductionTotal: totals.deductionTotal,
        netTotal: totals.netTotal,
      },
      include: CLAIM_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'claim.submitted',
      entityType: 'ProgressClaim',
      entityId: claim.id,
      before: { status: current.status },
      after: { status: claim.status, netTotal: claim.netTotal.toFixed(2) },
      ...meta,
    });

    return ProgressClaimsService.toDto(claim);
  }

  async decideClaim(
    actorUserId: string,
    claimId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string | undefined,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ProgressClaimDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getClaimInScope(actor, claimId);
    if (current.status !== 'PENDING') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Yalnızca onay bekleyen hakediş karara bağlanabilir' });
    }
    if (decision === 'REJECTED' && !reason) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Red gerekçesi zorunludur' });
    }

    const claim = await this.prisma.progressClaim.update({
      where: { id: current.id },
      data: {
        status: decision,
        approvedById: actor.userId,
        approvedAt: new Date(),
        rejectionReason: decision === 'REJECTED' ? (reason ?? null) : null,
      },
      include: CLAIM_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: decision === 'APPROVED' ? 'claim.approved' : 'claim.rejected',
      entityType: 'ProgressClaim',
      entityId: claim.id,
      before: { status: current.status, netTotal: current.netTotal.toFixed(2) },
      after: { status: claim.status, netTotal: claim.netTotal.toFixed(2), ...(reason ? { reason } : {}) },
      ...meta,
    });

    return ProgressClaimsService.toDto(claim);
  }

  async cancelClaim(
    actorUserId: string,
    claimId: string,
    reason: string,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ProgressClaimDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getClaimInScope(actor, claimId);
    if (current.status !== 'DRAFT' && current.status !== 'PENDING') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Onaylanmış hakediş iptal edilemez; düzeltme yeni (mahsup) hakedişle yapılır',
      });
    }
    this.assertCanManage(actor, current);

    const claim = await this.prisma.progressClaim.update({
      where: { id: current.id },
      data: { status: 'CANCELLED', cancelReason: reason },
      include: CLAIM_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'claim.cancelled',
      entityType: 'ProgressClaim',
      entityId: claim.id,
      before: { status: current.status },
      after: { status: claim.status, reason },
      ...meta,
    });

    return ProgressClaimsService.toDto(claim);
  }

  // ---------- DTO ----------

  private static toLineDto(line: LineRow): ClaimLineDto {
    const cumulative = trimNum(line.cumulativeQuantity.toFixed(3));
    const contractQty = trimNum(line.contractItem.contractQuantity.toFixed(3));
    return {
      id: line.id,
      contractItemId: line.contractItemId,
      code: line.contractItem.code,
      description: line.contractItem.description,
      unit: line.contractItem.unit,
      contractQuantity: contractQty,
      previousQuantity: trimNum(line.previousQuantity.toFixed(3)),
      periodQuantity: trimNum(line.periodQuantity.toFixed(3)),
      cumulativeQuantity: cumulative,
      unitPriceSnapshot: trimNum(line.unitPriceSnapshot.toFixed(4)),
      lineAmount: line.lineAmount.toFixed(2),
      isOver: qtyToNumber(cumulative) > qtyToNumber(contractQty),
    };
  }

  private static toDto(claim: ClaimRow): ProgressClaimDto {
    return {
      id: claim.id,
      projectId: claim.projectId,
      projectName: claim.project.name,
      claimNo: claim.claimNo,
      periodStart: claim.periodStart.toISOString().slice(0, 10),
      periodEnd: claim.periodEnd.toISOString().slice(0, 10),
      status: claim.status as ProgressClaimStatus,
      previousTotal: claim.previousTotal.toFixed(2),
      grossTotal: claim.grossTotal.toFixed(2),
      cumulativeTotal: claim.cumulativeTotal.toFixed(2),
      deductionTotal: claim.deductionTotal.toFixed(2),
      netTotal: claim.netTotal.toFixed(2),
      notes: claim.notes,
      formulaDescription: CLAIM_FORMULA_DESCRIPTION,
      lines: claim.lines.map(ProgressClaimsService.toLineDto),
      createdById: claim.createdById,
      createdBy: { id: claim.createdBy.id, fullName: claim.createdBy.fullName },
      approvedById: claim.approvedById,
      approvedBy: claim.approvedBy ? { id: claim.approvedBy.id, fullName: claim.approvedBy.fullName } : null,
      approvedAt: claim.approvedAt?.toISOString() ?? null,
      rejectionReason: claim.rejectionReason,
      cancelReason: claim.cancelReason,
      createdAt: claim.createdAt.toISOString(),
      updatedAt: claim.updatedAt.toISOString(),
    };
  }
}

/** 3 ondalık kanonik karşılaştırma için normalize ("50.0"→"50", "050"→"50"). */
function normalizeQty3(v: string): string {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return v;
  return n.toString();
}

/** Miktar karşılaştırması için sayıya çevirme (yalnızca isOver bayrağı; hesap BigInt'tedir). */
function qtyToNumber(v: string): number {
  return Number.parseFloat(v);
}

/** DECIMAL çıktısındaki sondaki sıfırları budar ('350.000'→'350', '245.7500'→'245.75'). */
function trimNum(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
