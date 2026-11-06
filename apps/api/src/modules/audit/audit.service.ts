/**
 * Denetim günlüğü okuma servisi (Faz 10).
 *
 * Kurallar (prompts/phase-10-development.md, docs/07):
 * - Yalnızca audit.view izni (FIRM_ADMIN) — uçta PermissionsGuard zorunlu tutar.
 * - Önce/sonra gövdeleri YAZIM anında maskelendiği gibi OKUMA anında da yeniden
 *   maskelenir (derinlemesine savunma; ileride maskeleme kuralı genişlerse eski
 *   kayıtlar da okuma anında korunur).
 * - Tarih filtresi gün kesinliğidir (dateFrom 00:00 dâhil, dateTo günü sonuna
 *   kadar dâhil).
 * - Audit OKUMALARI audit log'a yazılmaz: kendi kendini üreten günlük gürültüsü
 *   denetim değerini düşürür; karar belgelenmiştir (test raporunda da kayıtlı).
 * - Append-only: bu servis yalnızca findMany/count kullanır.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  type AuditFacets,
  type AuditLogEntry,
  type AuditLogQuery,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { maskSensitive } from '../../common/audit.service.js';

const FACET_LIMIT = 100;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  private dayStart(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00.000Z`);
  }

  private dayEndExclusive(dateStr: string): Date {
    return new Date(this.dayStart(dateStr).getTime() + 24 * 60 * 60 * 1000);
  }

  async list(userId: string, query: AuditLogQuery) {
    void userId; // izin uçta audit.view ile denetlenir; kapsam filtresi kurum geneli tek kiracıdır.
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: this.dayStart(query.dateFrom) } : {}),
              ...(query.dateTo ? { lt: this.dayEndExclusive(query.dateTo) } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, fullName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const data: AuditLogEntry[] = rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actor: row.actor ? { id: row.actor.id, fullName: row.actor.fullName } : null,
      before: row.beforeJson === undefined || row.beforeJson === null ? null : maskSensitive(row.beforeJson) ?? null,
      after: row.afterJson === undefined || row.afterJson === null ? null : maskSensitive(row.afterJson) ?? null,
      ip: row.ip,
      userAgent: row.userAgent,
      traceId: row.traceId,
    }));
    return { data, meta: buildPaginationMeta(query.page, query.pageSize, total) };
  }

  /** Filtre açılır listeleri: ayrık entityType/action değerleri (sınırlı: son N). */
  async facets(userId: string): Promise<AuditFacets> {
    void userId;
    const [entityTypeRows, actionRows] = await Promise.all([
      this.prisma.auditLog.findMany({
        distinct: ['entityType'],
        select: { entityType: true },
        orderBy: { entityType: 'asc' },
        take: FACET_LIMIT,
      }),
      this.prisma.auditLog.findMany({
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
        take: FACET_LIMIT,
      }),
    ]);
    return {
      entityTypes: entityTypeRows.map((r) => r.entityType),
      actions: actionRows.map((r) => r.action),
    };
  }
}
