/**
 * SQLite SyncStorage (Faz 09 — docs/09 yerel veri modeli).
 *
 * Tablolar:
 * - outbox: clientMutationId (PK), type, payload(JSON), status, attemptCount,
 *   nextAttemptAt, lastError, errorCode, serverId, createdAt, syncedAt.
 *   App kapanıp açılsa da kayıtlar burada durur (docs/09: outbox kaybolmaz).
 * - local_entities: pull ile çekilen sunucu verisi (entityType, entityId PK).
 * - media_queue: yerel dosya URI + hedef ilişki + upload durumu.
 * - sync_meta: sync_cursor ve lastSyncAt gibi anahtar/değer çiftleri.
 *
 * Güvenlik (docs/07): SQLite içinde parola/refresh token TUTULMAZ — token'lar
 * SecureStore'dadır. expo-sqlite modülü yalnızca init anında dinamik import
 * edilir; jest testleri bu dosyaya hiç dokunmadan bellek içi depoyla koşar.
 */
import type { LocalEntityRow, MediaQueueRow, OutboxItem, SyncStorage } from './types';
import { MAX_AUTO_ATTEMPTS } from './memory-storage.js';

const DB_NAME = 'santiyepro-sync.db';

/** expo-sqlite'ın SDK 58 API'sinin test edilebilir minimal yüzü. */
export interface SqliteDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

const DDL = `
CREATE TABLE IF NOT EXISTS outbox (
  clientMutationId TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  attemptCount INTEGER NOT NULL DEFAULT 0,
  nextAttemptAt INTEGER,
  lastError TEXT,
  errorCode TEXT,
  serverId TEXT,
  createdAt TEXT NOT NULL,
  syncedAt TEXT
);
CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox (status, nextAttemptAt);
CREATE TABLE IF NOT EXISTS local_entities (
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  projectId TEXT,
  updatedAt TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (entityType, entityId)
);
CREATE INDEX IF NOT EXISTS local_entities_project_idx ON local_entities (projectId);
CREATE TABLE IF NOT EXISTS media_queue (
  clientMutationId TEXT PRIMARY KEY NOT NULL,
  localUri TEXT NOT NULL,
  targetReportId TEXT,
  localRef TEXT,
  projectId TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  sizeBytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  attemptCount INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

export async function openSyncDatabase(): Promise<SqliteDatabase> {
  // Dinamik import: jest/node ortamı bu modülü yüklerken native taraf açılmaz.
  const SQLite = await import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(DDL);
  return db as unknown as SqliteDatabase;
}

function rowToOutbox(row: Record<string, unknown>): OutboxItem {
  return {
    clientMutationId: String(row.clientMutationId),
    type: String(row.type) as OutboxItem['type'],
    payload: JSON.parse(String(row.payload)) as Record<string, unknown>,
    status: String(row.status) as OutboxItem['status'],
    attemptCount: Number(row.attemptCount ?? 0),
    nextAttemptAt: row.nextAttemptAt === null || row.nextAttemptAt === undefined ? null : Number(row.nextAttemptAt),
    lastError: (row.lastError as string | null) ?? null,
    errorCode: (row.errorCode as string | null) ?? null,
    serverId: (row.serverId as string | null) ?? null,
    createdAt: String(row.createdAt),
    syncedAt: (row.syncedAt as string | null) ?? null,
  };
}

function rowToMedia(row: Record<string, unknown>): MediaQueueRow {
  return {
    clientMutationId: String(row.clientMutationId),
    localUri: String(row.localUri),
    targetReportId: (row.targetReportId as string | null) ?? null,
    localRef: (row.localRef as string | null) ?? null,
    projectId: String(row.projectId),
    mimeType: String(row.mimeType),
    sizeBytes: Number(row.sizeBytes ?? 0),
    status: String(row.status) as MediaQueueRow['status'],
    attemptCount: Number(row.attemptCount ?? 0),
    lastError: (row.lastError as string | null) ?? null,
    createdAt: String(row.createdAt),
  };
}

export class SqliteSyncStorage implements SyncStorage {
  private constructor(private readonly db: SqliteDatabase) {}

  static async open(): Promise<SqliteSyncStorage> {
    return new SqliteSyncStorage(await openSyncDatabase());
  }

  // ---------- outbox ----------

  async getOutbox(clientMutationId: string): Promise<OutboxItem | null> {
    const row = await this.db.getFirstAsync<Record<string, unknown>>(
      'SELECT * FROM outbox WHERE clientMutationId = ?',
      [clientMutationId],
    );
    return row ? rowToOutbox(row) : null;
  }

  async putOutbox(item: OutboxItem): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO outbox (clientMutationId, type, payload, status, attemptCount, nextAttemptAt, lastError, errorCode, serverId, createdAt, syncedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(clientMutationId) DO UPDATE SET
         type = excluded.type, payload = excluded.payload, status = excluded.status,
         attemptCount = excluded.attemptCount, nextAttemptAt = excluded.nextAttemptAt,
         lastError = excluded.lastError, errorCode = excluded.errorCode,
         serverId = excluded.serverId, syncedAt = excluded.syncedAt`,
      [
        item.clientMutationId,
        item.type,
        JSON.stringify(item.payload),
        item.status,
        item.attemptCount,
        item.nextAttemptAt,
        item.lastError,
        item.errorCode,
        item.serverId,
        item.createdAt,
        item.syncedAt,
      ],
    );
  }

  async listOutbox(): Promise<OutboxItem[]> {
    return this.listOutboxRows();
  }

  private async listOutboxRows(): Promise<OutboxItem[]> {
    const db = this.db as SqliteDatabase & {
      getAllAsync?: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    };
    if (typeof db.getAllAsync === 'function') {
      const rows = await db.getAllAsync('SELECT * FROM outbox ORDER BY createdAt ASC');
      return rows.map(rowToOutbox);
    }
    return [];
  }

  async dueOutbox(nowMs: number, limit: number): Promise<OutboxItem[]> {
    const db = this.db as SqliteDatabase & {
      getAllAsync?: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    };
    if (typeof db.getAllAsync !== 'function') return [];
    const rows = await db.getAllAsync(
      `SELECT * FROM outbox
       WHERE status = 'pending' AND attemptCount < ? AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?)
       ORDER BY createdAt ASC LIMIT ?`,
      [MAX_AUTO_ATTEMPTS, nowMs, limit],
    );
    return rows.map(rowToOutbox);
  }

  async clearDoneOutbox(): Promise<number> {
    const before = await this.listOutboxRows();
    const doneIds = before.filter((item) => item.status === 'done').map((item) => item.clientMutationId);
    if (doneIds.length === 0) return 0;
    await this.db.runAsync(
      `DELETE FROM outbox WHERE clientMutationId IN (${doneIds.map(() => '?').join(',')})`,
      doneIds,
    );
    return doneIds.length;
  }

  // ---------- cursor + meta ----------

  async getCursor(): Promise<number> {
    const row = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [
      'sync_cursor',
    ]);
    return row ? Number(row.value) : 0;
  }

  async setCursor(value: number): Promise<void> {
    await this.db.runAsync(
      'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['sync_cursor', String(value)],
    );
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  // ---------- local_entities ----------

  private async upsertEntity(row: LocalEntityRow): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO local_entities (entityType, entityId, projectId, updatedAt, data)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(entityType, entityId) DO UPDATE SET
         projectId = excluded.projectId, updatedAt = excluded.updatedAt, data = excluded.data`,
      [row.entityType, row.entityId, row.projectId, row.updatedAt, JSON.stringify(row.data)],
    );
  }

  async upsertEntities(rows: LocalEntityRow[]): Promise<void> {
    for (const row of rows) {
      await this.upsertEntity(row);
    }
  }

  async deleteEntities(entityType: string, entityIds: string[]): Promise<void> {
    for (const id of entityIds) {
      await this.db.runAsync('DELETE FROM local_entities WHERE entityType = ? AND entityId = ?', [entityType, id]);
    }
  }

  async listEntities(entityType: string, projectId?: string): Promise<LocalEntityRow[]> {
    const db = this.db as SqliteDatabase & {
      getAllAsync?: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    };
    if (typeof db.getAllAsync !== 'function') return [];
    const rows = projectId === undefined
      ? await db.getAllAsync('SELECT * FROM local_entities WHERE entityType = ?', [entityType])
      : await db.getAllAsync('SELECT * FROM local_entities WHERE entityType = ? AND projectId = ?', [entityType, projectId]);
    return rows.map((row) => ({
      entityType: String(row.entityType),
      entityId: String(row.entityId),
      projectId: (row.projectId as string | null) ?? null,
      updatedAt: String(row.updatedAt),
      data: JSON.parse(String(row.data)),
    }));
  }

  async clearProjectEntities(projectId: string): Promise<number> {
    const db = this.db as SqliteDatabase & {
      getAllAsync?: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    };
    if (typeof db.getAllAsync !== 'function') return 0;
    const rows = await db.getAllAsync(
      'SELECT entityType, entityId FROM local_entities WHERE projectId = ?',
      [projectId],
    );
    await this.db.runAsync('DELETE FROM local_entities WHERE projectId = ?', [projectId]);
    return rows.length;
  }

  // ---------- media_queue ----------

  async getMedia(clientMutationId: string): Promise<MediaQueueRow | null> {
    const row = await this.db.getFirstAsync<Record<string, unknown>>(
      'SELECT * FROM media_queue WHERE clientMutationId = ?',
      [clientMutationId],
    );
    return row ? rowToMedia(row) : null;
  }

  async putMedia(row: MediaQueueRow): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO media_queue (clientMutationId, localUri, targetReportId, localRef, projectId, mimeType, sizeBytes, status, attemptCount, lastError, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(clientMutationId) DO UPDATE SET
         localUri = excluded.localUri, targetReportId = excluded.targetReportId,
         localRef = excluded.localRef, projectId = excluded.projectId,
         mimeType = excluded.mimeType, sizeBytes = excluded.sizeBytes, status = excluded.status,
         attemptCount = excluded.attemptCount, lastError = excluded.lastError`,
      [
        row.clientMutationId,
        row.localUri,
        row.targetReportId,
        row.localRef,
        row.projectId,
        row.mimeType,
        row.sizeBytes,
        row.status,
        row.attemptCount,
        row.lastError,
        row.createdAt,
      ],
    );
  }

  async listMedia(status?: MediaQueueRow['status']): Promise<MediaQueueRow[]> {
    const db = this.db as SqliteDatabase & {
      getAllAsync?: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    };
    if (typeof db.getAllAsync !== 'function') return [];
    const rows = status
      ? await db.getAllAsync('SELECT * FROM media_queue WHERE status = ? ORDER BY createdAt ASC', [status])
      : await db.getAllAsync('SELECT * FROM media_queue ORDER BY createdAt ASC');
    return rows.map(rowToMedia);
  }

  async clearDoneMedia(): Promise<number> {
    const done = await this.listMedia('done');
    for (const row of done) {
      await this.db.runAsync('DELETE FROM media_queue WHERE clientMutationId = ?', [row.clientMutationId]);
    }
    return done.length;
  }
}
