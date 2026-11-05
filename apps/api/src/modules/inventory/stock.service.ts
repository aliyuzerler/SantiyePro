/**
 * Stok hareketi servisi (Faz 07).
 *
 * Kurallar (prompts/phase-07-development.md, docs/04, docs/05):
 * - APPEND-ONLY: hareket update/delete ucu yoktur; düzeltme yalnızca REVERSAL.
 * - Negatif stok engeli: bakiye düşüşü tek koşullu atomik UPDATE ile —
 *   `UPDATE "StockBalance" SET quantity = quantity - q WHERE quantity >= q` —
 *   READ COMMITTED altında ikinci eşzamanlı çıkış predicate'i yeniden
 *   değerlendirir ve 0 satır günceller → 409 CONFLICT.
 * - Transfer: kaynak çıkış + hedef giriş tek transaction; bir taraf başarısızsa
 *   iki taraf da geri alınır (throw → rollback).
 * - clientMutationId unique: kuyruk tekrarı mevcut hareketi döner, stok
 *   ikinci kez düşmez (idempotency, docs/09).
 * - Birim uyumu: istek birimi malzemenin birimiyle eşleşmek zorundadır.
 * - Bakiye okuma modeli StockBalance ile tutulur; hareket kaydı asıl kaynaktır.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  formatQuantity,
  mergeDeltas,
  movementDeltas,
  normalizeQuantity,
  parseQuantity,
  reverseDeltas,
  type CreateMovementRequest,
  type MovementListQuery,
  type ReverseMovementRequest,
  type StockMovementDto,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';
import { InventoryService } from './inventory.service.js';

type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof MOVEMENT_INCLUDE }>;

const MOVEMENT_INCLUDE = {
  material: { select: { id: true, name: true, code: true, unit: true } },
  warehouse: { select: { id: true, name: true } },
  targetWarehouse: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  reversedBy: { select: { id: true } },
} satisfies Prisma.StockMovementInclude;

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
  ) {}

  // ---------- Hareket oluşturma ----------

  async create(
    actorUserId: string,
    input: CreateMovementRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
    source: 'WEB' | 'MOBILE' | 'API' = 'WEB',
  ): Promise<{ movement: StockMovementDto; replayed: boolean }> {
    const actor = await this.inventory.getActor(actorUserId);

    // Idempotency: çevrimdışı kuyruk tekrarı mevcut hareketi döner.
    if (input.clientMutationId) {
      const replay = await this.prisma.stockMovement.findUnique({
        where: { clientMutationId: input.clientMutationId },
        include: MOVEMENT_INCLUDE,
      });
      if (replay) return { movement: StockService.toDto(replay), replayed: true };
    }

    const material = await this.prisma.material.findUnique({ where: { id: input.materialId } });
    if (!material) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Malzeme bulunamadı' });
    if (!material.isActive) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Pasif malzemeye stok hareketi girilemez' });
    }

    // Birim uyumu (geliştirme promptu): istemci birimi malzeme birimiyle aynı olmalı.
    if (input.unit !== undefined && input.unit !== material.unit) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Birim uyumsuz: malzeme birimi '${material.unit}', istek birimi '${input.unit}'`,
      });
    }

    const warehouse = await this.inventory.getWarehouseInScope(actor, input.warehouseId);
    if (!warehouse.isActive) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Pasif depoya stok hareketi girilemez' });
    }

    // Transfer: hedef depo kapsam + aktiflik denetimi.
    if (input.type === 'TRANSFER') {
      if (!input.targetWarehouseId) {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Transfer için hedef depo seçilmelidir' });
      }
      const target = await this.inventory.getWarehouseInScope(actor, input.targetWarehouseId);
      if (!target.isActive) {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Pasif depoya stok hareketi girilemez' });
      }
    }

    // Proje referansı: proje deposunda depo projesi zorunlu olarak kullanılır;
    // kurum deposunda istemcinin verdiği proje kabul edilir (kapsam denetimli).
    let projectId: string | null = null;
    if (warehouse.projectId) {
      if (input.projectId && input.projectId !== warehouse.projectId) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Proje deposu hareketlerinde proje, deponun projesi olmalıdır',
        });
      }
      projectId = warehouse.projectId;
    } else if (input.projectId) {
      const scope = await this.inventory.scopedProjectIds(actor);
      if (scope && !scope.includes(input.projectId)) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });
      }
      const project = await this.prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
      if (!project) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });
      projectId = input.projectId;
    }

    const sides = movementDeltas({
      type: input.type,
      quantity: normalizeQuantity(input.quantity),
      warehouseId: warehouse.id,
      targetWarehouseId: input.targetWarehouseId ?? null,
    });
    if (sides.length === 0) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Geçersiz hareket tipi' });
    }

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      await StockService.applyDeltasForMaterial(tx, material.id, sides);
      return tx.stockMovement.create({
        data: {
          materialId: material.id,
          warehouseId: warehouse.id,
          targetWarehouseId: input.type === 'TRANSFER' ? input.targetWarehouseId! : null,
          projectId,
          type: input.type,
          quantity: normalizeQuantity(input.quantity),
          unitCost: input.unitCost ?? null,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          note: input.note ?? null,
          occurredAt,
          createdById: actor.userId,
          clientMutationId: input.clientMutationId ?? null,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'stock.movement.created',
      entityType: 'StockMovement',
      entityId: created.id,
      after: {
        type: created.type,
        materialId: created.materialId,
        quantity: normalizeQuantity(input.quantity),
        warehouseId: created.warehouseId,
        targetWarehouseId: created.targetWarehouseId,
        projectId: created.projectId,
        unitCost: input.unitCost ?? null,
        source,
      },
      ...meta,
    });

    return { movement: StockService.toDto(created), replayed: false };
  }

  /**
   * Bakiye taraflarını uygular (belirli malzeme): negatif delta koşullu atomik
   * UPDATE (yetersiz stok → 409, transaction rollback), pozitif delta upsert
   * tarzı artırım. Transferda iki taraf tek transaction'dadır — bir taraf 409
   * verirse her iki taraf da geri alınır (geliştirme promptu: atomiklik).
   */

  // ---------- Ters kayıt ----------

  async reverse(
    actorUserId: string,
    movementId: string,
    input: ReverseMovementRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<{ movement: StockMovementDto }> {
    const actor = await this.inventory.getActor(actorUserId);
    const original = await this.prisma.stockMovement.findUnique({
      where: { id: movementId },
      include: MOVEMENT_INCLUDE,
    });
    if (!original) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stok hareketi bulunamadı' });

    // Kapsam: hareketin deposuna erişim zorunlu (IDOR koruması).
    await this.inventory.getWarehouseInScope(actor, original.warehouseId);
    if (original.targetWarehouseId) {
      await this.inventory.getWarehouseInScope(actor, original.targetWarehouseId);
    }

    if (original.type === 'REVERSAL') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Ters kayıt olan bir hareket tekrar ters kaydedilemez' });
    }
    if (original.reversedBy) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Bu hareket zaten ters kaydedilmiş' });
    }

    const sides = reverseDeltas({
      type: original.type as Parameters<typeof reverseDeltas>[0]['type'],
      quantity: normalizeQuantity(original.quantity.toFixed(3)),
      warehouseId: original.warehouseId,
      targetWarehouseId: original.targetWarehouseId,
    });

    const reason = input.reason.trim();
    const note = original.note ? `${original.note} | Ters kayıt: ${reason}` : `Ters kayıt: ${reason}`;

    const created = await this.prisma.$transaction(async (tx) => {
      await StockService.applyDeltasForMaterial(tx, original.materialId, sides);
      return tx.stockMovement.create({
        data: {
          materialId: original.materialId,
          warehouseId: original.warehouseId,
          targetWarehouseId: original.targetWarehouseId,
          projectId: original.projectId,
          type: 'REVERSAL',
          quantity: normalizeQuantity(original.quantity.toFixed(3)),
          unitCost: original.unitCost,
          referenceType: original.referenceType,
          referenceId: original.referenceId,
          note,
          occurredAt: new Date(),
          createdById: actor.userId,
          reversesMovementId: original.id,
        },
        include: MOVEMENT_INCLUDE,
      });
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'stock.movement.reversed',
      entityType: 'StockMovement',
      entityId: created.id,
      after: {
        originalMovementId: original.id,
        originalType: original.type,
        quantity: normalizeQuantity(original.quantity.toFixed(3)),
        reason,
      },
      ...meta,
    });

    return { movement: StockService.toDto(created) };
  }

  /** Belirli bir malzeme için bakiye taraflarını uygular (transfer/ters kayıt yolu). */
  private static async applyDeltasForMaterial(
    tx: Prisma.TransactionClient,
    materialId: string,
    sides: { warehouseId: string; delta: string }[],
  ): Promise<void> {
    const merged = mergeDeltas(sides);
    for (const side of merged) {
      const scaled = parseQuantity(side.delta);
      if (scaled === 0n) continue;
      if (scaled < 0n) {
        // Negatif delta: koşullu atomik düşüş — yetersiz stokta 0 satır.
        const amount = formatQuantity(-scaled);
        const updated = await tx.$executeRaw`
          UPDATE "StockBalance"
          SET "quantity" = "quantity" - ${amount}::numeric, "lastMovementAt" = now()
          WHERE "materialId" = ${materialId} AND "warehouseId" = ${side.warehouseId}
            AND "quantity" >= ${amount}::numeric
        `;
        if (updated === 0) {
          throw new ConflictException({
            code: 'CONFLICT',
            message: 'Yetersiz stok: ters kayıt hedef depoda negatif bakiye oluşturur',
          });
        }
      } else {
        const amount = formatQuantity(scaled);
        await tx.$executeRaw`
          INSERT INTO "StockBalance" ("id", "materialId", "warehouseId", "quantity", "lastMovementAt")
          VALUES (${randomUUID()}, ${materialId}, ${side.warehouseId}, ${amount}::numeric, now())
          ON CONFLICT ("materialId", "warehouseId")
          DO UPDATE SET "quantity" = "StockBalance"."quantity" + ${amount}::numeric, "lastMovementAt" = now()
        `;
      }
    }
  }

  // ---------- Hareket listesi ----------

  async list(userId: string, query: MovementListQuery) {
    const actor = await this.inventory.getActor(userId);
    const scope = await this.inventory.scopedProjectIds(actor);

    // Açık proje filtresi kapsam dışıysa liste boş döner (varlık sızdırılmaz).
    if (query.projectId && scope && !scope.includes(query.projectId)) {
      return { data: [], meta: buildPaginationMeta(query.page, query.pageSize, 0) };
    }

    const where: Prisma.StockMovementWhereInput = {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.materialId ? { materialId: query.materialId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search
        ? {
            OR: [
              { note: { contains: query.search, mode: 'insensitive' } },
              { referenceId: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            occurredAt: {
              ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } : {}),
              ...(query.dateTo ? { lte: new Date(`${query.dateTo}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      // Depo kapsamı: kurum depoları + üye olunan proje depoları (IDOR koruması).
      warehouse: scope
        ? { OR: [{ projectId: null }, { projectId: { in: scope } }] }
        : query.warehouseId
          ? { id: query.warehouseId }
          : undefined,
    };

    const orderBy: Prisma.StockMovementOrderByWithRelationInput =
      query.sort === 'createdAt' ? { createdAt: query.order } : { occurredAt: query.order };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [orderBy, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: MOVEMENT_INCLUDE,
      }),
    ]);

    return { data: rows.map(StockService.toDto), meta: buildPaginationMeta(query.page, query.pageSize, total) };
  }

  private static toDto(row: MovementRow): StockMovementDto {
    return {
      id: row.id,
      type: row.type as StockMovementDto['type'],
      materialId: row.material.id,
      materialName: row.material.name,
      materialCode: row.material.code,
      unit: row.material.unit,
      warehouseId: row.warehouse.id,
      warehouseName: row.warehouse.name,
      targetWarehouseId: row.targetWarehouse?.id ?? null,
      targetWarehouseName: row.targetWarehouse?.name ?? null,
      projectId: row.project?.id ?? null,
      projectName: row.project?.name ?? null,
      quantity: normalizeQuantity(row.quantity.toFixed(3)),
      unitCost: row.unitCost === null ? null : row.unitCost.toFixed(4),
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      note: row.note,
      occurredAt: row.occurredAt.toISOString(),
      createdById: row.createdBy.id,
      createdBy: { id: row.createdBy.id, fullName: row.createdBy.fullName },
      reversesMovementId: row.reversesMovementId,
      clientMutationId: row.clientMutationId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
