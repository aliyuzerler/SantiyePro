/**
 * Depo ve malzeme servisi (Faz 07).
 *
 * Kurallar (prompts/phase-07-development.md, docs/04, docs/06):
 * - Kapsam modeli diğer modüllerle aynı: FIRM_ADMIN tümü; diğer roller kurum
 *   deposunu (projectId null) ve üyesi oldukları projelerin depolarını görür.
 *   Kapsam dışı depo 404 döner (IDOR koruması, docs/06).
 * - Malzeme kataloğu kurum genellidir; kod verilirse benzersizdir (409).
 * - Depo pasife alma (isActive=false) vardır; sert silme yoktur (append-only
 *   iş kayıtları felsefesi, docs/02).
 * - Bakiye: hareket kaydı asıl kaynaktır; StockBalance okuma modeli
 *   transaction içinde koşullu atomik UPDATE ile güncellenir (stock.service).
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  normalizeQuantity,
  type BalanceListQuery,
  type MaterialCreateRequest,
  type MaterialDto,
  type MaterialListQuery,
  type MaterialUpdateRequest,
  type StockBalanceDto,
  type WarehouseCreateRequest,
  type WarehouseDto,
  type WarehouseListQuery,
  type WarehouseUpdateRequest,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';

interface Actor {
  userId: string;
  roles: string[];
}

type WarehouseRow = Prisma.WarehouseGetPayload<{ include: typeof WAREHOUSE_INCLUDE }>;
type MaterialRow = Prisma.MaterialGetPayload<Record<string, never>>;

const WAREHOUSE_INCLUDE = {
  project: { select: { id: true, name: true } },
} satisfies Prisma.WarehouseInclude;

const BALANCE_INCLUDE = {
  material: { select: { id: true, name: true, code: true, unit: true, minStock: true } },
  warehouse: {
    select: {
      id: true,
      name: true,
      projectId: true,
      project: { select: { id: true, name: true, members: { select: { userId: true } } } },
    },
  },
} satisfies Prisma.StockBalanceInclude;

@Injectable()
export class InventoryService {
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

  /** Depo kapsam denetimi: kurum deposu herkese açık; proje deposu üyelik ister. */
  async getWarehouseInScope(actor: Actor, warehouseId: string): Promise<WarehouseRow> {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: WAREHOUSE_INCLUDE,
    });
    if (!warehouse) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Depo bulunamadı' });
    if (warehouse.projectId && !this.isAdmin(actor)) {
      const member = await this.prisma.projectMember.findFirst({
        where: { projectId: warehouse.projectId, userId: actor.userId },
        select: { id: true },
      });
      if (!member) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Depo bulunamadı' });
    }
    return warehouse;
  }

  // ---------- Depolar ----------

  async listWarehouses(userId: string, query: WarehouseListQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);

    const where: Prisma.WarehouseWhereInput = {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.kurumOnly === 'true' ? { projectId: null } : {}),
      ...(query.kurumOnly === 'false' ? { projectId: { not: null } } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      // Kapsam: kurum depoları + üye olunan proje depoları
      ...(scope ? { OR: [{ projectId: null }, { projectId: { in: scope } }] } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.warehouse.count({ where }),
      this.prisma.warehouse.findMany({
        where,
        orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: WAREHOUSE_INCLUDE,
      }),
    ]);

    return {
      data: rows.map(InventoryService.toWarehouseDto),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async createWarehouse(
    actorUserId: string,
    input: WarehouseCreateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<WarehouseDto> {
    const actor = await this.getActor(actorUserId);
    const scope = await this.scopedProjectIds(actor);

    if (input.projectId) {
      if (scope && !scope.includes(input.projectId)) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });
      }
      const project = await this.prisma.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });
      if (project.status === 'ARCHIVED') {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Arşivlenmiş projeye depo açılamaz' });
      }
    }

    // Aynı kapsam içinde (proje veya kurum) aynı ad: 409.
    const duplicate = await this.prisma.warehouse.findFirst({
      where: { name: input.name, projectId: input.projectId ?? null },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Bu kapsamda aynı isimde bir depo zaten var' });
    }

    const row = await this.prisma.warehouse.create({
      data: {
        projectId: input.projectId ?? null,
        name: input.name,
        location: input.location ?? null,
        createdById: actor.userId,
      },
      include: WAREHOUSE_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'warehouse.created',
      entityType: 'Warehouse',
      entityId: row.id,
      after: { name: row.name, projectId: row.projectId, location: row.location },
      ...meta,
    });

    return InventoryService.toWarehouseDto(row);
  }

  async updateWarehouse(
    actorUserId: string,
    warehouseId: string,
    input: WarehouseUpdateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<WarehouseDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getWarehouseInScope(actor, warehouseId);

    if (
      input.name &&
      input.name !== current.name &&
      (await this.prisma.warehouse.findFirst({
        where: { name: input.name, projectId: current.projectId, id: { not: current.id } },
        select: { id: true },
      }))
    ) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Bu kapsamda aynı isimde bir depo zaten var' });
    }

    const row = await this.prisma.warehouse.update({
      where: { id: current.id },
      data: {
        name: input.name,
        location: input.location !== undefined ? input.location : undefined,
        isActive: input.isActive,
      },
      include: WAREHOUSE_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'warehouse.updated',
      entityType: 'Warehouse',
      entityId: row.id,
      before: { name: current.name, location: current.location, isActive: current.isActive },
      after: { name: row.name, location: row.location, isActive: row.isActive },
      ...meta,
    });

    return InventoryService.toWarehouseDto(row);
  }

  private static toWarehouseDto(row: WarehouseRow): WarehouseDto {
    return {
      id: row.id,
      projectId: row.projectId,
      projectName: row.project?.name ?? null,
      name: row.name,
      location: row.location,
      isActive: row.isActive,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ---------- Malzemeler ----------

  async listMaterials(userId: string, query: MaterialListQuery) {
    void userId; // Malzeme kataloğu kurum genellidir; inventory.view izni uçta denetlenir.

    const where: Prisma.MaterialWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.MaterialOrderByWithRelationInput =
      query.sort === 'code'
        ? { code: query.order }
        : query.sort === 'createdAt'
          ? { createdAt: query.order }
          : { name: query.order };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.material.count({ where }),
      this.prisma.material.findMany({
        where,
        orderBy: [orderBy, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map(InventoryService.toMaterialDto),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async createMaterial(
    actorUserId: string,
    input: MaterialCreateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<MaterialDto> {
    const actor = await this.getActor(actorUserId);

    if (input.code) {
      const duplicate = await this.prisma.material.findUnique({ where: { code: input.code }, select: { id: true } });
      if (duplicate) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Bu kodda bir malzeme zaten var',
          details: { existingId: duplicate.id },
        });
      }
    }

    try {
      const row = await this.prisma.material.create({
        data: {
          code: input.code ?? null,
          name: input.name,
          category: input.category ?? null,
          unit: input.unit,
          minStock: input.minStock ?? null,
          createdById: actor.userId,
        },
      });

      await this.audit.record({
        actorUserId: actor.userId,
        action: 'material.created',
        entityType: 'Material',
        entityId: row.id,
        after: { code: row.code, name: row.name, unit: row.unit, minStock: input.minStock ?? null },
        ...meta,
      });

      return InventoryService.toMaterialDto(row);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002') {
        throw new ConflictException({ code: 'CONFLICT', message: 'Bu kodda bir malzeme zaten var' });
      }
      throw error;
    }
  }

  async updateMaterial(
    actorUserId: string,
    materialId: string,
    input: MaterialUpdateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<MaterialDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.prisma.material.findUnique({ where: { id: materialId } });
    if (!current) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Malzeme bulunamadı' });

    if (input.code !== undefined && input.code !== null && input.code !== current.code) {
      const duplicate = await this.prisma.material.findUnique({ where: { code: input.code }, select: { id: true } });
      if (duplicate) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Bu kodda bir malzeme zaten var',
          details: { existingId: duplicate.id },
        });
      }
    }

    try {
      const row = await this.prisma.material.update({
        where: { id: current.id },
        data: {
          code: input.code !== undefined ? input.code : undefined,
          name: input.name,
          category: input.category !== undefined ? input.category : undefined,
          unit: input.unit,
          minStock: input.minStock !== undefined ? input.minStock : undefined,
          isActive: input.isActive,
        },
      });

      await this.audit.record({
        actorUserId: actor.userId,
        action: 'material.updated',
        entityType: 'Material',
        entityId: row.id,
        before: { code: current.code, name: current.name, unit: current.unit, isActive: current.isActive },
        after: { code: row.code, name: row.name, unit: row.unit, isActive: row.isActive },
        ...meta,
      });

      return InventoryService.toMaterialDto(row);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002') {
        throw new ConflictException({ code: 'CONFLICT', message: 'Bu kodda bir malzeme zaten var' });
      }
      throw error;
    }
  }

  private static toMaterialDto(row: MaterialRow): MaterialDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      category: row.category,
      unit: row.unit,
      minStock: row.minStock === null ? null : normalizeQuantity(row.minStock.toFixed(3)),
      isActive: row.isActive,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ---------- Bakiye (stok kartları) ----------

  /**
   * Stok kartları: malzeme × depo bakiyeleri. Kapsam: depo projesi üyelikle
   * sınırlandırılır (kurum depoları herkese açık). Kritik stok (bakiye ≤
   * minStock) bayrağı kartta taşınır.
   */
  async listBalances(userId: string, query: BalanceListQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);

    // Depo kapsamı: kurum depoları + üye olunan proje depoları
    const warehouseScope: Prisma.WarehouseWhereInput = scope
      ? { OR: [{ projectId: null }, { projectId: { in: scope } }] }
      : {};

    const where: Prisma.StockBalanceWhereInput = {
      warehouse: {
        AND: [
          warehouseScope,
          query.warehouseId ? { id: query.warehouseId } : {},
          query.projectId ? { projectId: query.projectId } : {},
        ],
      },
      ...(query.materialId ? { materialId: query.materialId } : {}),
      ...(query.search
        ? {
            OR: [
              { material: { name: { contains: query.search, mode: 'insensitive' } } },
              { material: { code: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.stockBalance.findMany({
      where,
      include: BALANCE_INCLUDE,
      orderBy: [{ material: { name: 'asc' } }, { warehouseId: 'asc' }],
      take: 500,
    });

    // Kapsam dışı proje deposu satırları sızdırılmaz (IDOR koruması).
    const visible = rows.filter((row) => {
      if (!row.warehouse.projectId || this.isAdmin(actor)) return true;
      return (row.warehouse.project?.members ?? []).some((m) => m.userId === actor.userId);
    });

    const filtered = query.lowStock
      ? visible.filter((row) => row.material.minStock !== null && row.quantity.lte(row.material.minStock))
      : visible;

    const data: StockBalanceDto[] = filtered.map((row) => ({
      materialId: row.material.id,
      materialName: row.material.name,
      materialCode: row.material.code,
      unit: row.material.unit,
      minStock: row.material.minStock === null ? null : normalizeQuantity(row.material.minStock.toFixed(3)),
      warehouseId: row.warehouse.id,
      warehouseName: row.warehouse.name,
      projectId: row.warehouse.projectId,
      projectName: row.warehouse.project?.name ?? null,
      quantity: normalizeQuantity(row.quantity.toFixed(3)),
      isLow: row.material.minStock !== null && row.quantity.lte(row.material.minStock),
      lastMovementAt: row.lastMovementAt.toISOString(),
    }));

    return { data, meta: { page: 1, pageSize: data.length, total: data.length, totalPages: 1 } };
  }
}
