/**
 * Sözleşme kalemleri servisi (Faz 08).
 *
 * Fiyat güncellenebilir; ancak hakediş satırları snapshot sakladığı için
 * mevcut hakedişler etkilenmez (docs/04). Kapsam: claim.prepare sahipleri,
 * proje üyeliği zorunlu (admin hariç).
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  type ContractItemCreateRequest,
  type ContractItemDto,
  type ContractItemListQuery,
  type ContractItemUpdateRequest,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';

interface Actor {
  userId: string;
  roles: string[];
}

type ItemRow = Prisma.ContractItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

const ITEM_INCLUDE = {
  project: { select: { id: true, name: true } },
} satisfies Prisma.ContractItemInclude;

@Injectable()
export class ContractItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  private async getItemInScope(actor: Actor, itemId: string): Promise<ItemRow> {
    const item = await this.prisma.contractItem.findUnique({ where: { id: itemId }, include: ITEM_INCLUDE });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sözleşme kalemi bulunamadı' });
    if (!this.isAdmin(actor)) {
      const member = await this.prisma.projectMember.findFirst({
        where: { projectId: item.projectId, userId: actor.userId },
        select: { id: true },
      });
      if (!member) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sözleşme kalemi bulunamadı' });
    }
    return item;
  }

  async listContractItems(userId: string, query: ContractItemListQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);

    if (scope && !scope.includes(query.projectId)) {
      return { data: [], meta: buildPaginationMeta(query.page, query.pageSize, 0) };
    }

    const where: Prisma.ContractItemWhereInput = {
      projectId: query.projectId,
      ...(query.search
        ? {
            OR: [
              { description: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.contractItem.count({ where }),
      this.prisma.contractItem.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: ITEM_INCLUDE,
      }),
    ]);

    return {
      data: rows.map(ContractItemsService.toDto),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async createContractItem(
    actorUserId: string,
    input: ContractItemCreateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ContractItemDto> {
    const actor = await this.getActor(actorUserId);
    const scope = await this.scopedProjectIds(actor);
    if (scope && !scope.includes(input.projectId)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });
    }
    const project = await this.prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
    if (!project) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });

    if (input.code) {
      const duplicate = await this.prisma.contractItem.findUnique({
        where: { projectId_code: { projectId: input.projectId, code: input.code } },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException({ code: 'CONFLICT', message: 'Bu kod bu projede zaten kullanımda' });
      }
    }

    const row = await this.prisma.contractItem.create({
      data: {
        projectId: input.projectId,
        code: input.code ?? null,
        description: input.description,
        unit: input.unit,
        contractQuantity: input.contractQuantity,
        unitPrice: input.unitPrice,
        currency: input.currency,
        sortOrder: input.sortOrder,
        createdById: actor.userId,
      },
      include: ITEM_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'contractitem.created',
      entityType: 'ContractItem',
      entityId: row.id,
      after: { code: row.code, description: row.description, unitPrice: input.unitPrice },
      ...meta,
    });

    return ContractItemsService.toDto(row);
  }

  async updateContractItem(
    actorUserId: string,
    itemId: string,
    input: ContractItemUpdateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ContractItemDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getItemInScope(actor, itemId);

    if (input.code !== undefined && input.code !== null && input.code !== current.code) {
      const duplicate = await this.prisma.contractItem.findUnique({
        where: { projectId_code: { projectId: current.projectId, code: input.code } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException({ code: 'CONFLICT', message: 'Bu kod bu projede zaten kullanımda' });
    }

    const row = await this.prisma.contractItem.update({
      where: { id: current.id },
      data: {
        code: input.code !== undefined ? input.code : undefined,
        description: input.description,
        unit: input.unit,
        contractQuantity: input.contractQuantity,
        unitPrice: input.unitPrice,
        currency: input.currency,
        sortOrder: input.sortOrder,
      },
      include: ITEM_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'contractitem.updated',
      entityType: 'ContractItem',
      entityId: row.id,
      before: { unitPrice: current.unitPrice.toFixed(4), contractQuantity: current.contractQuantity.toFixed(3) },
      after: { unitPrice: row.unitPrice.toFixed(4), contractQuantity: row.contractQuantity.toFixed(3) },
      ...meta,
    });

    return ContractItemsService.toDto(row);
  }

  private async scopedProjectIds(actor: Actor): Promise<string[] | null> {
    if (this.isAdmin(actor)) return null;
    const rows = await this.prisma.projectMember.findMany({
      where: { userId: actor.userId },
      select: { projectId: true },
    });
    return rows.map((r) => r.projectId);
  }

  private static toDto(row: ItemRow): ContractItemDto {
    return {
      id: row.id,
      projectId: row.projectId,
      projectName: row.project.name,
      code: row.code,
      description: row.description,
      unit: row.unit,
      contractQuantity: trimNum(row.contractQuantity.toFixed(3)),
      unitPrice: trimNum(row.unitPrice.toFixed(4)),
      currency: row.currency,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** DECIMAL çıktısındaki sondaki sıfırları budar ('250.0000'→'250'). */
function trimNum(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
