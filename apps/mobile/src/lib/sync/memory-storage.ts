/**
 * Bellek içi SyncStorage (Faz 09).
 *
 * Kullanım: jest testleri ve SQLite açılamayan ortamlarda yedek. Arayüz sözleşmesi
 * sqlite-storage.ts ile birebir aynıdır — testler gerçek depolama davranışını
 * (cursor, due filtresi, proje temizliği) aynı senaryolarla doğrular.
 *
 * Not (docs/07): burada parola/refresh token TUTULMAZ; yalnızca iş verisi var.
 */
import type { LocalEntityRow, MediaQueueRow, OutboxItem, SyncStorage } from './types';

export class MemorySyncStorage implements SyncStorage {
  private outbox = new Map<string, OutboxItem>();
  private meta = new Map<string, string>();
  private entities = new Map<string, LocalEntityRow>();
  private media = new Map<string, MediaQueueRow>();

  private entityKey(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  // ---------- outbox ----------

  async getOutbox(clientMutationId: string): Promise<OutboxItem | null> {
    const found = this.outbox.get(clientMutationId);
    return found ? { ...found, payload: { ...found.payload } } : null;
  }

  async putOutbox(item: OutboxItem): Promise<void> {
    this.outbox.set(item.clientMutationId, { ...item, payload: { ...item.payload } });
  }

  async listOutbox(): Promise<OutboxItem[]> {
    return [...this.outbox.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.clientMutationId.localeCompare(b.clientMutationId))
      .map((item) => ({ ...item, payload: { ...item.payload } }));
  }

  async dueOutbox(nowMs: number, limit: number): Promise<OutboxItem[]> {
    return (await this.listOutbox())
      .filter(
        (item) =>
          item.status === 'pending' &&
          (item.nextAttemptAt === null || item.nextAttemptAt <= nowMs) &&
          item.attemptCount < MAX_AUTO_ATTEMPTS,
      )
      .slice(0, limit);
  }

  async clearDoneOutbox(): Promise<number> {
    let removed = 0;
    for (const [key, item] of this.outbox) {
      if (item.status === 'done') {
        this.outbox.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  // ---------- cursor + meta ----------

  async getCursor(): Promise<number> {
    const raw = this.meta.get('sync_cursor');
    return raw ? Number(raw) : 0;
  }

  async setCursor(value: number): Promise<void> {
    this.meta.set('sync_cursor', String(value));
  }

  async getMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
  }

  // ---------- local_entities ----------

  async upsertEntities(rows: LocalEntityRow[]): Promise<void> {
    for (const row of rows) {
      this.entities.set(this.entityKey(row.entityType, row.entityId), { ...row });
    }
  }

  async deleteEntities(entityType: string, entityIds: string[]): Promise<void> {
    for (const id of entityIds) {
      this.entities.delete(this.entityKey(entityType, id));
    }
  }

  async listEntities(entityType: string, projectId?: string): Promise<LocalEntityRow[]> {
    return [...this.entities.values()]
      .filter((row) => row.entityType === entityType && (projectId === undefined || row.projectId === projectId))
      .map((row) => ({ ...row }));
  }

  async clearProjectEntities(projectId: string): Promise<number> {
    let removed = 0;
    for (const [key, row] of this.entities) {
      if (row.projectId === projectId) {
        this.entities.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  // ---------- media_queue ----------

  async getMedia(clientMutationId: string): Promise<MediaQueueRow | null> {
    const found = this.media.get(clientMutationId);
    return found ? { ...found } : null;
  }

  async putMedia(row: MediaQueueRow): Promise<void> {
    this.media.set(row.clientMutationId, { ...row });
  }

  async listMedia(status?: MediaQueueRow['status']): Promise<MediaQueueRow[]> {
    return [...this.media.values()]
      .filter((row) => (status ? row.status === status : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((row) => ({ ...row }));
  }

  async clearDoneMedia(): Promise<number> {
    let removed = 0;
    for (const [key, row] of this.media) {
      if (row.status === 'done') {
        this.media.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

/**
 * Otomatik deneme üst sınırı: bu sayıya ulaşan geçici hatalı kayıt 'failed'
 * olur ve yalnızca kullanıcının açık retry'ı ile yeniden kuyruğa girer.
 * Kayıt HİÇBİR KOŞULDA otomatik silinmez.
 */
export const MAX_AUTO_ATTEMPTS = 8;
