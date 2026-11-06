/**
 * Senkronizasyon çekirdek tipleri (Faz 09 — docs/09 yerel veri modeli).
 *
 * Outbox yaşam döngüsü:
 *   pending → sending → done
 *                 ├→ pending (geçici hata: backoff planlanır — ağ/5xx/timeout)
 *                 ├→ failed  (otomatik deneme hakkı bitti; kullanıcı güvenle yeniden dener)
 *                 ├→ rejected (kalıcı 4xx — açıklama saklanır, SESSİZCE SİLİNMEZ)
 *                 └→ conflict (sunucu çakışması — kullanıcı karar verir)
 *
 * Kritik kural (docs/09, test senaryosu 10): outbox başarısız mutation'ı
 * asla sessizce silmez; her kayıt kullanıcıya görünür kalır.
 */
import type { SyncMutationType } from '@santiyepro/contracts';

export type OutboxStatus = 'pending' | 'sending' | 'done' | 'failed' | 'rejected' | 'conflict';

export interface OutboxItem {
  clientMutationId: string;
  type: SyncMutationType;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attemptCount: number;
  /** Geçici hata sonrası bir sonraki deneme zamanı (epoch ms); null = hemen. */
  nextAttemptAt: number | null;
  lastError: string | null;
  /** rejected/conflict için makine okunur kod (VALIDATION_ERROR, CONFLICT…). */
  errorCode: string | null;
  /** Kabul edilen kaydın sunucu ID'si — local_entities eşlemesi için. */
  serverId: string | null;
  createdAt: string;
  syncedAt: string | null;
}

/** media_queue satırı — docs/09 (yerel dosya URI, hedef ilişki, upload durumu). */
export interface MediaQueueRow {
  clientMutationId: string;
  localUri: string;
  /** Hedef günlük raporun SUNUCU ID'si; rapor henüz push edilmediyse null. */
  targetReportId: string | null;
  /** Raporu üreten outbox mutation'ının clientMutationId'si — kabul olunca
   *  engine bu satırların targetReportId'sini sunucu ID ile günceller. */
  localRef: string | null;
  /** upload-url izni proje kapsamında verilir (docs/07). */
  projectId: string;
  mimeType: string;
  sizeBytes: number;
  status: 'pending' | 'uploading' | 'failed' | 'done';
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
}

/** Medya yeniden deneme üst sınırı — upload kesintilerinde kayıt durur, dosya kaybolmaz. */
export const MAX_MEDIA_ATTEMPTS = 5;

/** local_entities satırı — pull ile çekilen sunucu verisinin cihaz kopyası. */
export interface LocalEntityRow {
  entityType: string;
  entityId: string;
  projectId: string | null;
  updatedAt: string;
  data: unknown;
}

/** Kullanıcıya gösterilen senkron durumu (docs/09 durumlar bölümü). */
export interface SyncSnapshot {
  online: boolean;
  syncing: boolean;
  /** pending + failed — "Senkronizasyon bekliyor — X kayıt". */
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  rejectedCount: number;
  doneCount: number;
  /** Son başarılı senkron zamanı. */
  lastSyncAt: string | null;
  lastError: string | null;
  /** 401 refresh başarısız — kullanıcı login'e yönlendirilir, outbox durur. */
  authExpired: boolean;
}

/** Kalıcı depolama sözleşmesi — SQLite (gerçek cihaz) ve bellek içi (test) paylaştırır. */
export interface SyncStorage {
  // ---------- outbox ----------
  getOutbox(clientMutationId: string): Promise<OutboxItem | null>;
  putOutbox(item: OutboxItem): Promise<void>;
  listOutbox(): Promise<OutboxItem[]>;
  /** pending + attempt hakkı olan + nextAttemptAt'ı geçmiş kayıtlar (createdAt sırası). */
  dueOutbox(nowMs: number, limit: number): Promise<OutboxItem[]>;
  clearDoneOutbox(): Promise<number>;

  // ---------- cursor + meta ----------
  getCursor(): Promise<number>;
  setCursor(value: number): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  // ---------- local_entities ----------
  upsertEntities(rows: LocalEntityRow[]): Promise<void>;
  deleteEntities(entityType: string, entityIds: string[]): Promise<void>;
  listEntities(entityType: string, projectId?: string): Promise<LocalEntityRow[]>;
  /** Erişimi kalkan projenin TÜM yerel verisi temizlenir (tombstone etkisi). */
  clearProjectEntities(projectId: string): Promise<number>;

  // ---------- media_queue ----------
  getMedia(clientMutationId: string): Promise<MediaQueueRow | null>;
  putMedia(row: MediaQueueRow): Promise<void>;
  listMedia(status?: MediaQueueRow['status']): Promise<MediaQueueRow[]>;
  clearDoneMedia(): Promise<number>;
}

/** Ortak metrikler — snapshot üretimi için outbox özeti. */
export function summarizeOutbox(
  items: OutboxItem[],
): Pick<SyncSnapshot, 'pendingCount' | 'failedCount' | 'conflictCount' | 'rejectedCount' | 'doneCount'> {
  let pendingCount = 0;
  let failedCount = 0;
  let conflictCount = 0;
  let rejectedCount = 0;
  let doneCount = 0;
  for (const item of items) {
    switch (item.status) {
      case 'pending':
      case 'sending':
        pendingCount += 1;
        break;
      case 'failed':
        failedCount += 1;
        pendingCount += 1;
        break;
      case 'conflict':
        conflictCount += 1;
        break;
      case 'rejected':
        rejectedCount += 1;
        break;
      case 'done':
        doneCount += 1;
        break;
    }
  }
  return { pendingCount, failedCount, conflictCount, rejectedCount, doneCount };
}
