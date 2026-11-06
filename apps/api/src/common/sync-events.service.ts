/**
 * Senkronizasyon olay günlüğü servisi (Faz 09 — docs/09).
 *
 * Amaç: yazma işlemlerinden sonra append-only SyncEvent işaretçisi tutmak.
 * Pull tarafı bu işaretçileri seq sırasına göre gruplar ve entity'nin GÜNCEL
 * durumunu okuyup döner; bu yüzden işaretçi yazımı entity yazımıyla aynı
 * transaction'da olmak zorunda değildir — en kötü durum eksik/kopuk delta
 * değil, bir sonraki olayla toparlanan güncel anlık görüntüdür.
 *
 * Kurallar:
 * - Kayıt yazımı ürün davranışını bozmamalı: hata loglanır, yazma işlemine
 *   geri fırlatılmaz (best-effort; sync günlüğü yan yol verisidir).
 * - delete (tombstone) yalnızca gerçek sert silinmelerde kullanılır; ürün
 *   felsefesi append-only olduğundan yalnızca MediaFile temizliği gibi
 *   uçlarda oluşur. Proje erişimi kaybı tombstone ile değil, pull yanıtındaki
 *   accessibleProjectIds snapshot'ı ile cihaza bildirilir.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type SyncEntityType =
  | 'project'
  | 'site'
  | 'task'
  | 'taskComment'
  | 'dailyReport'
  | 'attendanceRecord'
  | 'personnel';

export interface SyncEventInput {
  entityType: SyncEntityType;
  entityId: string;
  operation: 'upsert' | 'delete';
  projectId?: string | null;
  actorId?: string | null;
}

@Injectable()
export class SyncEventsService {
  private readonly logger = new Logger(SyncEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Tek olay kaydı — başarısızlık yazma akışını bozmaz. */
  async record(input: SyncEventInput, client?: Prisma.TransactionClient): Promise<void> {
    try {
      const db = client ?? this.prisma;
      await db.syncEvent.create({
        data: {
          entityType: input.entityType,
          entityId: input.entityId,
          operation: input.operation,
          projectId: input.projectId ?? null,
          actorId: input.actorId ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `SyncEvent yazılamadı (${input.entityType}/${input.entityId}/${input.operation}): ${
          error instanceof Error ? error.message : 'bilinmeyen hata'
        }`,
      );
    }
  }

  /** Çoklu olay (toplu puantaj vb.) — aynı best-effort sözleşme. */
  async recordMany(inputs: SyncEventInput[], client?: Prisma.TransactionClient): Promise<void> {
    for (const input of inputs) {
      await this.record(input, client);
    }
  }
}
