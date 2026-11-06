/**
 * Senkronizasyon motoru (Faz 09 — docs/09 sync akışı).
 *
 * flush (push):
 * 1. dueOutbox → küçük batch (varsayılan 10) → /sync/push.
 * 2. Kabul: kayıt done + serverId; red (kalıcı 4xx): rejected + açıklama
 *    (kayıt silinmez); çakışma: conflict; geçici hata (ağ/5xx/timeout):
 *    exponential backoff + jitter ile nextAttemptAt planlanır.
 * 3. 401: güvenli refresh BİR kez denenir; başarısızsa authExpired yayınlanır
 *    (UI login'e yönlendirir) ve outbox AYNEN KALIR — kayıp yok.
 *
 * pull:
 * 1. /sync/pull?cursor → local_entities'e yaz, cursor ilerlet.
 * 2. accessibleProjectIds snapshot'ında olmayan yerel projeler TEMİZLENİR
 *    (erişimi kaldırılan veri cihazdan gider — test senaryosu 8).
 *
 * Bağlantı: observeConnectivity (NetInfo) online olduğunda syncNow tetiklenir;
 * AppState foreground geçişinde de denenir. Tüm ağ hataları transiettir:
 * kayıt durur, sunucu onayı gelmeden "güncel" gösterilmez.
 */
import type { SyncMutation, SyncMutationResult, SyncPushResponse, SyncPullResponse, SyncMutationType } from '@santiyepro/contracts';
import { ApiError } from '../api.js';
import { MAX_AUTO_ATTEMPTS, MemorySyncStorage } from './memory-storage.js';
import { summarizeOutbox, type LocalEntityRow, type OutboxItem, type SyncSnapshot, type SyncStorage } from './types';

export interface SyncEngineOptions {
  storage: SyncStorage;
  /** Batch push çağrısı (ağ katmanı enjekte edilir — testlerde fake). */
  pushApi: (mutations: SyncMutation[], token: string) => Promise<SyncPushResponse>;
  /** Delta pull çağrısı. */
  pullApi: (cursor: number, token: string) => Promise<SyncPullResponse>;
  /** SecureStore'dan access token. */
  getToken: () => Promise<string | null>;
  /** 401 sonrası güvenli refresh; true = yeni token hazır. */
  refreshSession: () => Promise<boolean>;
  /** Refresh başarısız — UI login'e yönlendirir (outbox korunur). */
  onAuthExpired?: () => void;
  now?: () => number;
  /** Jitter kaynağı (0..1); testlerde deterministik verilebilir. */
  random?: () => number;
  batchSize?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Tek push isteği için ağ zaman aşımı (ms). */
  requestTimeoutMs?: number;
  /** Medya kuyruğunu boşaltır (upload + complete + rapora bağlama); flush sonrası çağrılır. */
  flushMedia?: (token: string) => Promise<{ uploaded: number; failed: number }>;
  logger?: (message: string) => void;
}

/** Geçici kabul edilen hata kodları — backoff ile yeniden denenir. */
const TRANSIENT_ERROR_CODES = new Set(['INTERNAL_ERROR', 'SERVICE_UNAVAILABLE', 'RATE_LIMITED', 'NETWORK_ERROR']);

export class SyncEngine {
  private readonly options: Required<Pick<SyncEngineOptions, 'now' | 'random' | 'batchSize' | 'baseBackoffMs' | 'maxBackoffMs' | 'requestTimeoutMs'>> &
    SyncEngineOptions;
  private snapshot: SyncSnapshot = {
    online: true,
    syncing: false,
    pendingCount: 0,
    failedCount: 0,
    conflictCount: 0,
    rejectedCount: 0,
    doneCount: 0,
    lastSyncAt: null,
    lastError: null,
    authExpired: false,
  };
  private listeners = new Set<(snapshot: SyncSnapshot) => void>();
  private flushInFlight = false;
  private pullInFlight = false;

  constructor(options: SyncEngineOptions) {
    this.options = {
      now: options.now ?? (() => Date.now()),
      random: options.random ?? Math.random,
      batchSize: options.batchSize ?? 10,
      baseBackoffMs: options.baseBackoffMs ?? 2_000,
      maxBackoffMs: options.maxBackoffMs ?? 60_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 20_000,
      ...options,
    };
  }

  // ---------- abonelik / snapshot ----------

  subscribe(listener: (snapshot: SyncSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener({ ...this.snapshot });
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): SyncSnapshot {
    return { ...this.snapshot };
  }

  setOnline(online: boolean): void {
    if (this.snapshot.online !== online) {
      this.publish({ online });
    }
  }

  private publish(partial: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private async refreshSnapshot(): Promise<void> {
    const [items, lastSyncAt] = await Promise.all([
      this.options.storage.listOutbox(),
      this.options.storage.getMeta('lastSyncAt'),
    ]);
    this.publish({ ...summarizeOutbox(items), lastSyncAt });
  }

  // ---------- outbox yazma ----------

  /** Yeni mutation kuyruğa alınır; aynı clientMutationId tekrar eklenmez. */
  async enqueue(type: SyncMutationType, payload: Record<string, unknown>, clientMutationId: string): Promise<OutboxItem> {
    const existing = await this.options.storage.getOutbox(clientMutationId);
    if (existing) return existing;

    const item: OutboxItem = {
      clientMutationId,
      type,
      payload,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      errorCode: null,
      serverId: null,
      createdAt: new Date(this.options.now()).toISOString(),
      syncedAt: null,
    };
    await this.options.storage.putOutbox(item);
    await this.refreshSnapshot();
    return item;
  }

  /** Çevrimdışı fotoğraf — rapor mutation'ının clientMutationId'sine bağlanır (docs/09). */
  async enqueueMedia(
    file: { uri: string; mimeType: string; sizeBytes: number },
    localRef: string,
    projectId: string,
  ): Promise<void> {
    const clientMutationId = `media-${localRef}-${await nextMediaSuffix(this.options.storage, localRef)}`;
    await this.options.storage.putMedia({
      clientMutationId,
      localUri: file.uri,
      targetReportId: null,
      localRef,
      projectId,
      mimeType: file.mimeType,
      sizeBytes: Math.max(1, file.sizeBytes),
      status: 'pending',
      attemptCount: 0,
      lastError: null,
      createdAt: new Date(this.options.now()).toISOString(),
    });
  }

  /** Kullanıcının açık retry'ı: sayaç sıfırlanır, kayıt pending'e döner. */
  async retry(clientMutationId: string): Promise<void> {
    const item = await this.options.storage.getOutbox(clientMutationId);
    if (!item) return;
    await this.options.storage.putOutbox({
      ...item,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      errorCode: null,
    });
    await this.refreshSnapshot();
  }

  /** Tüm failed/rejected/conflict kayıtları yeniden kuyruğa alınır (kuyruk ekranı butonu). */
  async retryAll(): Promise<number> {
    const items = await this.options.storage.listOutbox();
    let requeued = 0;
    for (const item of items) {
      if (item.status === 'failed' || item.status === 'rejected' || item.status === 'conflict') {
        await this.options.storage.putOutbox({
          ...item,
          status: 'pending',
          attemptCount: 0,
          nextAttemptAt: null,
          lastError: null,
          errorCode: null,
        });
        requeued += 1;
      }
    }
    await this.refreshSnapshot();
    return requeued;
  }

  /** Tamamlanan kayıtların temizliği — hatalı kayıtlar asla silinmez. */
  async clearDone(): Promise<number> {
    const removed = await this.options.storage.clearDoneOutbox();
    await this.refreshSnapshot();
    return removed;
  }

  // ---------- push ----------

  /**
   * Kuyruğu boşaltır. Dönüş: gönderilen kabul sayısı. Geçici ağ hatasında
   * kalan kayıtlar durur ve backoff planlanır — flush güvenle tekrar çağrılabilir
   * (single-flight: aynı anda iki flush koşmaz).
   */
  async flush(): Promise<{ accepted: number; transient: number; permanent: number; conflicts: number }> {
    if (this.flushInFlight) {
      return { accepted: 0, transient: 0, permanent: 0, conflicts: 0 };
    }
    this.flushInFlight = true;
    this.publish({ syncing: true });
    try {
      return await this.flushInner();
    } finally {
      this.flushInFlight = false;
      this.publish({ syncing: false });
      await this.refreshSnapshot();
    }
  }

  private async flushInner(): Promise<{ accepted: number; transient: number; permanent: number; conflicts: number }> {
    const token = await this.options.getToken();
    if (!token) {
      // Oturum yok: outbox durur (kayıp yok); authExpired zaten işaretliyse UI login'dedir.
      return { accepted: 0, transient: 0, permanent: 0, conflicts: 0 };
    }

    let accepted = 0;
    let transient = 0;
    let permanent = 0;
    let conflicts = 0;

    for (;;) {
      const batch = await this.options.storage.dueOutbox(this.options.now(), this.options.batchSize);
      if (batch.length === 0) break;

      let response: SyncPushResponse | null = null;
      try {
        response = await this.withTimeout(this.options.pushApi(this.toMutations(batch), token));
      } catch (error) {
        // 401: güvenli refresh — başarılıysa aynı batch yeni tokenla yeniden denenir;
        // başarısızsa authExpired yayınlanır ve outbox AYNEN KALIR (docs/09).
        if (error instanceof ApiError && error.status === 401) {
          const refreshed = await this.options.refreshSession();
          if (refreshed) continue;
          this.publish({ authExpired: true, lastError: 'Oturum süresi doldu — giriş yapın' });
          this.options.onAuthExpired?.();
          break;
        }
        // Ağ hatası / 5xx / zaman aşımı: batch'tekiler backoff ile bekler, döngü biter.
        for (const item of batch) {
          await this.scheduleTransientRetry(
            item,
            error instanceof Error ? error.message : 'Ağ hatası',
            error instanceof ApiError && error.status >= 500 ? 'INTERNAL_ERROR' : 'NETWORK_ERROR',
          );
        }
        transient += batch.length;
        this.publish({ lastError: 'Bağlantı yok — kayıtlar bu cihazda saklanıyor' });
        break;
      }

      let sawTransient = false;
      for (const result of response.results) {
        const item = batch.find((b) => b.clientMutationId === result.clientMutationId);
        if (!item) continue;
        const outcome = await this.applyResult(item, result);
        if (outcome === 'accepted') accepted += 1;
        else if (outcome === 'conflict') conflicts += 1;
        else if (outcome === 'transient') {
          transient += 1;
          sawTransient = true;
        } else permanent += 1;
      }
      if (sawTransient) break; // transient batch'te kaldıysa backoff zaten planlandı

      if (response.results.length === 0) break; // savunmacı: boş yanıt sonsuz döngüye girmez
    }

    if (transient === 0) {
      await this.options.storage.setMeta('lastSyncAt', new Date(this.options.now()).toISOString());
      this.publish({ lastError: null });
    }
    return { accepted, transient, permanent, conflicts };
  }

  private toMutations(batch: OutboxItem[]): SyncMutation[] {
    return batch.map((item) => ({
      clientMutationId: item.clientMutationId,
      type: item.type,
      payload: item.payload,
    }));
  }

  private async applyResult(item: OutboxItem, result: SyncMutationResult): Promise<'accepted' | 'rejected' | 'conflict' | 'transient'> {
    if (result.status === 'accepted') {
      await this.options.storage.putOutbox({
        ...item,
        status: 'done',
        serverId: result.serverId ?? item.serverId,
        lastError: null,
        errorCode: null,
        nextAttemptAt: null,
        syncedAt: new Date(this.options.now()).toISOString(),
      });
      // Rapor kabul edildi → medya kuyruğundaki bağlı dosyalar sunucu raporuna eşlenir.
      if (item.type === 'dailyReport.upsertDraft' && result.serverId) {
        for (const row of await this.options.storage.listMedia()) {
          if (row.localRef === item.clientMutationId && row.targetReportId !== result.serverId) {
            await this.options.storage.putMedia({
              ...row,
              targetReportId: result.serverId,
              status: row.status === 'uploading' ? 'pending' : row.status,
            });
          }
        }
      }
      return 'accepted';
    }
    if (result.status === 'conflict') {
      await this.options.storage.putOutbox({
        ...item,
        status: 'conflict',
        lastError: result.error?.message ?? 'Sunucuda çakışma',
        errorCode: result.error?.code ?? 'CONFLICT',
        nextAttemptAt: null,
      });
      return 'conflict';
    }
    // rejected
    const code = result.error?.code ?? 'VALIDATION_ERROR';
    if (TRANSIENT_ERROR_CODES.has(code)) {
      await this.scheduleTransientRetry(item, result.error?.message ?? 'Geçici sunucu hatası', code);
      return 'transient';
    }
    // Kalıcı red: açıklamayla saklanır — SESSİZCE SİLİNMEZ (docs/09).
    await this.options.storage.putOutbox({
      ...item,
      status: 'rejected',
      lastError: result.error?.message ?? 'Sunucu kaydı kabul etmedi',
      errorCode: code,
      nextAttemptAt: null,
    });
    return 'rejected';
  }

  /** Geçici hata: exponential backoff + jitter; MAX'a ulaşan 'failed' olur (kayıt durur). */
  private async scheduleTransientRetry(item: OutboxItem, message: string, code: string = 'NETWORK_ERROR'): Promise<void> {
    const attemptCount = item.attemptCount + 1;
    if (attemptCount >= MAX_AUTO_ATTEMPTS) {
      await this.options.storage.putOutbox({
        ...item,
        status: 'failed',
        attemptCount,
        lastError: message,
        errorCode: code,
        nextAttemptAt: null,
      });
      return;
    }
    const exp = Math.min(this.options.maxBackoffMs, this.options.baseBackoffMs * 2 ** (attemptCount - 1));
    const jitter = Math.floor(this.options.random() * this.options.baseBackoffMs);
    await this.options.storage.putOutbox({
      ...item,
      status: 'pending',
      attemptCount,
      lastError: message,
      errorCode: code,
      nextAttemptAt: this.options.now() + exp + jitter,
    });
  }

  // ---------- pull ----------

  async pull(): Promise<{ applied: number; clearedProjects: string[] }> {
    if (this.pullInFlight) return { applied: 0, clearedProjects: [] };
    this.pullInFlight = true;
    try {
      const token = await this.options.getToken();
      if (!token) return { applied: 0, clearedProjects: [] };

      let cursor = await this.options.storage.getCursor();
      let applied = 0;
      const clearedProjects: string[] = [];
      for (;;) {
        const response = await this.withTimeout(this.options.pullApi(cursor, token));
        const rows: LocalEntityRow[] = [];
        for (const change of response.changes) {
          if (change.operation === 'upsert' && change.data !== undefined) {
            rows.push({
              entityType: change.entityType,
              entityId: change.entityId,
              projectId: change.projectId,
              updatedAt: change.updatedAt,
              data: change.data,
            });
          } else if (change.operation === 'delete') {
            await this.options.storage.deleteEntities(change.entityType, [change.entityId]);
          }
        }
        if (rows.length > 0) {
          await this.options.storage.upsertEntities(rows);
          applied += rows.length;
        }
        cursor = response.cursor;
        await this.options.storage.setCursor(cursor);
        await this.options.storage.setMeta('lastSyncAt', new Date(this.options.now()).toISOString());
        if (!response.hasMore) {
          clearedProjects.push(...(await this.applyAccessSnapshot(response.accessibleProjectIds)));
          break;
        }
      }
      this.publish({ lastError: null });
      return { applied, clearedProjects };
    } finally {
      this.pullInFlight = false;
    }
  }

  /** Kapsam snapshot'ı: cihazda tutulan ama artık erişilemeyen projeler temizlenir. */
  private async applyAccessSnapshot(accessibleProjectIds: string[]): Promise<string[]> {
    const accessible = new Set(accessibleProjectIds);
    const localProjects = new Set<string>();
    for (const entityType of ['project', 'site', 'task', 'taskComment', 'dailyReport', 'attendanceRecord']) {
      for (const row of await this.options.storage.listEntities(entityType)) {
        if (row.projectId) localProjects.add(row.projectId);
      }
    }
    const cleared: string[] = [];
    for (const projectId of localProjects) {
      if (!accessible.has(projectId)) {
        await this.options.storage.clearProjectEntities(projectId);
        cleared.push(projectId);
      }
    }
    return cleared;
  }

  // ---------- birleşik akış ----------

  /** Birleşik akış: flush → medya → pull; bağlantı geri geldiğinde çağrılır. */
  async syncNow(): Promise<SyncSnapshot> {
    const result = await this.flush();
    if (result.transient === 0 && !this.getSnapshot().authExpired) {
      try {
        const token = await this.options.getToken();
        if (token && this.options.flushMedia) {
          await this.options.flushMedia(token);
        }
        await this.pull();
      } catch (error) {
        this.publish({ lastError: error instanceof Error ? error.message : 'Senkronizasyon hatası' });
      }
    }
    await this.refreshSnapshot();
    return this.getSnapshot();
  }

  /** Yeni oturum: authExpired bayrağı düşürülür, senkron denenir. */
  async onLoggedIn(): Promise<void> {
    this.publish({ authExpired: false, lastError: null });
    await this.refreshSnapshot();
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    // Ağ zaman aşımı: istek requestTimeoutMs içinde dolmazsa sentetik hata —
    // flush bunu geçici hata sayar ve backoff planlar.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('İstek zaman aşımına uğradı'));
      }, this.options.requestTimeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}

/** Test/Storybook için bellek içi motor üreticisi. */
export function createMemoryEngine(options: Omit<SyncEngineOptions, 'storage'>): SyncEngine {
  return new SyncEngine({ ...options, storage: new MemorySyncStorage() });
}

/** Aynı rapora bağlı medya satırlarını sayar — clientMutationId benzersizliği için. */
async function nextMediaSuffix(storage: SyncStorage, localRef: string): Promise<number> {
  const rows = await storage.listMedia();
  return rows.filter((row) => row.localRef === localRef).length + 1;
}
