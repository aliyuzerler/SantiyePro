import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntryInput {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  traceId?: string | null;
}

/** Hassas alan adları — log/audit gövdelerinden çıkarılır (docs/07). */
const SENSITIVE_KEYS = /^(password|passwordHash|newPassword|currentPassword|token|refreshToken|accessToken|setupToken|secret|authorization)$/i;

/** Derin kopya + hassas alan temizliği. */
export function maskSensitive(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((v) => maskSensitive(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(key)) continue;
      out[key] = maskSensitive(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Denetim günlüğü servisi — append-only (docs/07: kritik iş kayıtları).
 * before/after gövdeleri maskelemesiz asla yazılmaz.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Audit kaydı yazar. Faz 10'dan itibaren oluşturulan kaydın id'sini döner
   * (export kanıtı raporlarda gösterilir); yazım başarısızsa null döner.
   */
  async record(entry: AuditEntryInput): Promise<{ id: string } | null> {
    const data: Prisma.AuditLogCreateInput = {
      action: entry.action,
      entityType: entry.entityType,
      actor: entry.actorUserId ? { connect: { id: entry.actorUserId } } : undefined,
      entityId: entry.entityId ?? null,
      beforeJson: (maskSensitive(entry.before) as Prisma.InputJsonValue) ?? undefined,
      afterJson: (maskSensitive(entry.after) as Prisma.InputJsonValue) ?? undefined,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      traceId: entry.traceId ?? null,
    };
    try {
      const row = await this.prisma.auditLog.create({ data });
      return { id: row.id };
    } catch (error) {
      // Audit yazımı ana akışı bloklamaz ama sessiz de kalmaz.
      this.logger.error(`Audit kaydı yazılamadı: ${String(error instanceof Error ? error.message : error)}`);
      return null;
    }
  }
}
