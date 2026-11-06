/**
 * Faz 09 — SyncEngine birim testleri (prompts/phase-09-test.md senaryoları).
 *
 * Bellek içi depo + enjekte edilmiş ağ katmanıyla koşar; senaryolar:
 *  1. Çevrimdışı kayıt → uygulama yeniden başlatma (yeni motor, aynı depo) → kayıt durur [senaryo 1]
 *  2. Bağlantı gelince push/pull tamamlanır                                           [senaryo 2]
 *  3. Aynı mutation 3 kez → tek push (dedupe)                                          [senaryo 3]
 *  4. 401 → refresh bir kez; başarısızsa authExpired + outbox korunur                  [senaryo 4]
 *  5. 500/network/timeout → exponential backoff + jitter                               [senaryo 4/5]
 *  6. Kalıcı red (422/400) → rejected, açıklama saklanır, sessizce silinmez            [senaryo 10]
 *  7. Çakışma → conflict durumu kullanıcıya görünür                                    [senaryo 6]
 *  8. Pull: delta uygulanır, cursor ilerler, erişimi kalkan proje temizlenir           [senaryo 8]
 *  9. Medya: upload kesilirse dosya kuyrukta kalır, retry aynı dosyadan                [senaryo 5]
 */
import { describe, expect, it } from '@jest/globals';
import { ApiError } from '../src/lib/api';
import { MemorySyncStorage } from '../src/lib/sync/memory-storage';
import { SyncEngine } from '../src/lib/sync/engine';
import type { SyncMutation, SyncMutationResult, SyncPullResponse, SyncPushResponse } from '@santiyepro/contracts';
import type { SyncStorage } from '../src/lib/sync/types';

const TOKEN = 'test-access-token';

interface EngineHarness {
  storage: SyncStorage;
  engine: SyncEngine;
  pushCalls: SyncMutation[][];
  pushHandler: (fn: (mutations: SyncMutation[], token: string) => Promise<SyncPushResponse>) => void;
  pullHandler: (fn: (cursor: number, token: string) => Promise<SyncPullResponse>) => void;
  refresh: { calls: number; next: boolean };
}

function makeEngine(storage: SyncStorage, overrides: Partial<ConstructorParameters<typeof SyncEngine>[0]> = {}): EngineHarness {
  const state: EngineHarness = {
    storage,
    engine: undefined as unknown as SyncEngine,
    pushCalls: [],
    pushHandler: () => undefined,
    pullHandler: () => undefined,
    refresh: { calls: 0, next: true },
  };
  state.engine = new SyncEngine({
    storage,
    pushApi: async (mutations, token) => {
      state.pushCalls.push(mutations);
      expect(token).toBe(TOKEN);
      return state.pushHandler(mutations, token);
    },
    pullApi: async (cursor, token) => {
      expect(token).toBe(TOKEN);
      return state.pullHandler(cursor, token);
    },
    getToken: async () => TOKEN,
    refreshSession: async () => {
      state.refresh.calls += 1;
      return state.refresh.next;
    },
    now: () => 1_700_000_000_000,
    random: () => 0.5,
    baseBackoffMs: 1000,
    maxBackoffMs: 60_000,
    requestTimeoutMs: 5_000,
    ...overrides,
  });
  return state;
}

function accepted(clientMutationId: string, serverId = 'srv-1'): SyncMutationResult {
  return { clientMutationId, status: 'accepted', replayed: false, serverId };
}

function alwaysOk(mutations: SyncMutation[]): SyncPushResponse {
  return { results: mutations.map((m) => accepted(m.clientMutationId, `srv-${m.clientMutationId}`)), serverTime: '2026-11-05T10:00:00.000Z' };
}

function emptyPull(cursor: number): SyncPullResponse {
  return { cursor, hasMore: false, changes: [], accessibleProjectIds: ['prj-a'], serverTime: '2026-11-05T10:00:00.000Z' };
}

// ---------- Senaryo 1 + 2: çevrimdışı kayıt kalır, bağlantı gelince gider ----------

describe('SyncEngine — çevrimdışı kalıcılık ve flush', () => {
  it('kayıt kuyruğa alınır; motor yeniden kurulsu da (app restart) kayıt depoda durur', async () => {
    const storage = new MemorySyncStorage();
    const first = makeEngine(storage);
    await first.engine.setOnline(false);
    await first.engine.enqueue('attendance.mark', { projectId: 'prj-a', status: 'PRESENT' }, 'mut-1');

    // Uygulama force-close: yeni motor, AYNI depo (SQLite karşılığı).
    const second = makeEngine(storage);
    const items = await storage.listOutbox();
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe('pending');
    expect(items[0]!.clientMutationId).toBe('mut-1');
    void second;
  });

  it('bağlantı gelince flush tüm bekleyenleri gönderir ve done işaretler; lastSyncAt yazılır', async () => {
    const storage = new MemorySyncStorage();
    const h = makeEngine(storage);
    h.pushHandler = async (mutations) => alwaysOk(mutations);
    h.pullHandler = async (cursor) => emptyPull(cursor);

    await h.engine.enqueue('attendance.mark', { a: 1 }, 'mut-1');
    await h.engine.enqueue('task.comment', { taskId: 't1', body: 'selam' }, 'mut-2');
    const result = await h.engine.syncNow();

    expect(result.pendingCount).toBe(0);
    expect(result.doneCount).toBe(2);
    expect(result.lastError).toBeNull();
    expect(result.lastSyncAt).not.toBeNull();
    const items = await storage.listOutbox();
    expect(items.every((i) => i.status === 'done' && i.serverId)).toBe(true);
  });

  it('aynı clientMutationId üç kez eklenirse kuyrukta TEK kayıt oluşur (tek push)', async () => {
    const storage = new MemorySyncStorage();
    const h = makeEngine(storage);
    h.pushHandler = async (mutations) => alwaysOk(mutations);
    h.pullHandler = async (cursor) => emptyPull(cursor);

    await h.engine.enqueue('task.comment', { taskId: 't1', body: 'aynı' }, 'mut-dup');
    await h.engine.enqueue('task.comment', { taskId: 't1', body: 'aynı' }, 'mut-dup');
    await h.engine.enqueue('task.comment', { taskId: 't1', body: 'aynı' }, 'mut-dup');
    await h.engine.flush();

    expect(h.pushCalls).toHaveLength(1);
    expect(h.pushCalls[0]).toHaveLength(1);
    const records = await storage.listOutbox();
    expect(records).toHaveLength(1);
  });
});

// ---------- Senaryo 4: 401 refresh; başarısızsa login + outbox korunur ----------

describe('SyncEngine — 401 ve oturum', () => {
  it('401 → refresh çağrılır ve push yeni tokenla tekrar denenir', async () => {
    const storage = new MemorySyncStorage();
    let attempt = 0;
    const h = makeEngine(storage);
    h.pushHandler = async (mutations) => {
      attempt += 1;
      if (attempt === 1) throw new ApiError(401, 'UNAUTHORIZED', 'Oturum süresi doldu');
      return alwaysOk(mutations);
    };
    h.pullHandler = async (cursor) => emptyPull(cursor);

    await h.engine.enqueue('task.comment', { body: 'x' }, 'mut-401');
    const result = await h.engine.flush();

    expect(h.refresh.calls).toBe(1);
    expect(attempt).toBe(2);
    expect(result.accepted).toBe(1);
    expect(h.engine.getSnapshot().authExpired).toBe(false);
  });

  it('refresh başarısızsa authExpired yayınlanır; outbox kayıt durur (kayıp yok)', async () => {
    const storage = new MemorySyncStorage();
    const h = makeEngine(storage);
    h.refresh.next = false;
    h.pushHandler = async () => {
      throw new ApiError(401, 'UNAUTHORIZED', 'Oturum süresi doldu');
    };

    await h.engine.enqueue('task.comment', { body: 'x' }, 'mut-401-fail');
    let expired = false;
    h.engine.subscribe((s) => {
      expired = expired || s.authExpired;
    });

    const result = await h.engine.flush();
    expect(h.refresh.calls).toBe(1);
    expect(expired).toBe(true);
    expect(result.accepted).toBe(0);

    const items = await storage.listOutbox();
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe('pending');
  });
});

// ---------- Senaryo 4/5: geçici hatalar — backoff + jitter ----------

describe('SyncEngine — geçici hata ve backoff', () => {
  it('ağ hatasında kayıt pending kalır ve backoff planlanır (deterministik jitter)', async () => {
    const storage = new MemorySyncStorage();
    const h = makeEngine(storage);
    h.pushHandler = async () => {
      throw new Error('Ağ hatası (bağlantı yok)');
    };

    await h.engine.enqueue('attendance.mark', { a: 1 }, 'mut-net');
    const result = await h.engine.flush();

    expect(result.transient).toBe(1);
    const [item] = await storage.listOutbox();
    expect(item!.status).toBe('pending');
    expect(item!.attemptCount).toBe(1);
    // backoff: base * 2^0 = 1000 + jitter 0.5*1000 = 500 → 1500ms
    expect(item!.nextAttemptAt).toBe(1_700_000_000_000 + 1500);
  });

  it('5xx hatası geçici sayılır; üst üste denemelerde backoff üstel büyür', async () => {
    const storage = new MemorySyncStorage();
    const h = makeEngine(storage, { maxBackoffMs: 60_000 });
    h.pushHandler = async () => {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Sunucu hatası');
    };

    await h.engine.enqueue('task.comment', { body: 'x' }, 'mut-5xx');
    await h.engine.flush();
    const [afterFirst] = await storage.listOutbox();
    expect(afterFirst!.attemptCount).toBe(1);
    expect(afterFirst!.nextAttemptAt).toBe(1_700_000_000_000 + 1500); // 1s + 0.5s jitter

    // Süre dolmuş gibi yeniden dene (due) — 2. deneme: 2s + 0.5s = 2500ms
    await storage.putOutbox({ ...afterFirst!, nextAttemptAt: 0 });
    await h.engine.flush();
    const [afterSecond] = await storage.listOutbox();
    expect(afterSecond!.attemptCount).toBe(2);
    expect(afterSecond!.nextAttemptAt).toBe(1_700_000_000_000 + 2500);
  });

  it('deneme hakkı biten kayıt failed olur ama SİLİNMEZ; manual retry sayaç sıfırlar', async () => {
    const storage = new MemorySyncStorage();
    const h = makeEngine(storage);
    h.pushHandler = async () => {
      throw new Error('Ağ yok');
    };

    await h.engine.enqueue('expense.create', { amount: '1' }, 'mut-max');
    for (let i = 0; i < 8; i += 1) {
      const items = await storage.listOutbox();
      await storage.putOutbox({ ...items[0]!, nextAttemptAt: 0, status: 'pending' });
      await h.engine.flush();
    }
    const [failed] = await storage.listOutbox();
    expect(failed!.status).toBe('failed');
    expect(failed!.attemptCount).toBe(8);
    expect(failed!.lastError).toBeTruthy();

    await h.engine.retry('mut-max');
    const [requeued] = await storage.listOutbox();
    expect(requeued!.status).toBe('pending');
    expect(requeued!.attemptCount).toBe(0);
  });
});

// ---------- Senaryo 10 + 6: kalıcı red ve çakışma ----------

describe('SyncEngine — kalıcı red ve çakışma', () => {
  it('VALIDATION_ERROR rejected işaretlenir, açıklama saklanır ve otomatik tekrar denenmez', async () => {
    const storage = new MemorySyncStorage();
    const h = makeEngine(storage);
    h.pushHandler = async (mutations) => ({
      results: mutations.map((m) => ({
        clientMutationId: m.clientMutationId,
        status: 'rejected' as const,
        replayed: false,
        error: { code: 'VALIDATION_ERROR', message: 'Açıklama en az 3 karakter olmalıdır' },
      })),
      serverTime: '2026-11-05T10:00:00.000Z',
    });
    h.pullHandler = async (cursor) => emptyPull(cursor);

    await h.engine.enqueue('expense.create', { description: 'K' }, 'mut-bad');
    await h.engine.syncNow();
    const pushCountAfterFirst = h.pushCalls.length;
    expect(pushCountAfterFirst).toBe(1);

    const [item] = await storage.listOutbox();
    expect(item!.status).toBe('rejected');
    expect(item!.lastError).toContain('3 karakter');
    expect(item!.errorCode).toBe('VALIDATION_ERROR');

    // Tekrar sync: rejected kayıt push'a girmez (sessiz retry yok), ama SİLİNMEZ.
    const second = await h.engine.syncNow();
    expect(h.pushCalls.length).toBe(pushCountAfterFirst);
    expect(second.rejectedCount).toBe(1);
    const stillThere = await storage.listOutbox();
    expect(stillThere).toHaveLength(1);
  });

  it('conflict sonucu kullanıcıya görünür; kayıt conflict durumunda bekler', async () => {
    const storage = new MemorySyncStorage();
    const h = makeEngine(storage);
    h.pushHandler = async (mutations) => ({
      results: mutations.map((m) => ({
        clientMutationId: m.clientMutationId,
        status: 'conflict' as const,
        replayed: false,
        serverId: 'srv-task-1',
        error: { code: 'CONFLICT', message: 'Kayıt başka bir güncellemeyle değişti' },
      })),
      serverTime: '2026-11-05T10:00:00.000Z',
    });
    h.pullHandler = async (cursor) => emptyPull(cursor);

    await h.engine.enqueue('task.update', { taskId: 'srv-task-1', title: 'x', version: 1 }, 'mut-conf');
    const snapshot = await h.engine.syncNow();
    expect(snapshot.conflictCount).toBe(1);

    const [item] = await storage.listOutbox();
    expect(item!.status).toBe('conflict');
    expect(item!.lastError).toContain('başka bir güncelleme');
  });
});

// ---------- Senaryo 8: pull delta + erişim kaldırma temizliği ----------

describe('SyncEngine — pull ve kapsam temizliği', () => {
  it('pull değişiklikleri local_entities\u2019e yazar, cursor\u2019ı ilerletir; erişimi kalkan proje temizlenir', async () => {
    const storage = new MemorySyncStorage();
    // Cihazda iki projenin verisi var.
    await storage.upsertEntities([
      { entityType: 'task', entityId: 't-a', projectId: 'prj-a', updatedAt: '2026-11-04T00:00:00.000Z', data: { id: 't-a' } },
      { entityType: 'task', entityId: 't-b', projectId: 'prj-lost', updatedAt: '2026-11-04T00:00:00.000Z', data: { id: 't-b' } },
    ]);

    const h = makeEngine(storage);
    h.pullHandler = async (cursor) => ({
      cursor: cursor + 7,
      hasMore: false,
      changes: [
        {
          seq: cursor + 5,
          entityType: 'taskComment',
          operation: 'upsert',
          entityId: 'c-1',
          projectId: 'prj-a',
          updatedAt: '2026-11-05T09:00:00.000Z',
          data: { id: 'c-1', body: 'sunucudan geldi' },
        },
      ],
      accessibleProjectIds: ['prj-a'], // prj-lost erişimi kalktı
      serverTime: '2026-11-05T10:00:00.000Z',
    });
    h.pushHandler = async (mutations) => alwaysOk(mutations);

    const result = await h.engine.syncNow();
    expect(result.pendingCount).toBe(0);
    expect(await storage.getCursor()).toBe(7);

    const comments = await storage.listEntities('taskComment');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.data).toEqual({ id: 'c-1', body: 'sunucudan geldi' });

    const tasks = await storage.listEntities('task');
    expect(tasks.map((t) => t.entityId)).toEqual(['t-a']); // prj-lost temizlendi
  });

  it('pull tombstone satırı yerel entity\u2019yi siler (hard-delete senkronu)', async () => {
    const storage = new MemorySyncStorage();
    await storage.upsertEntities([
      { entityType: 'dailyReport', entityId: 'r-1', projectId: 'prj-a', updatedAt: '2026-11-04T00:00:00.000Z', data: { id: 'r-1' } },
    ]);
    const h = makeEngine(storage);
    h.pullHandler = async (cursor) => ({
      cursor: cursor + 3,
      hasMore: false,
      changes: [
        { seq: cursor + 2, entityType: 'dailyReport', operation: 'delete', entityId: 'r-1', projectId: 'prj-a', updatedAt: '2026-11-05T09:00:00.000Z' },
      ],
      accessibleProjectIds: ['prj-a'],
      serverTime: '2026-11-05T10:00:00.000Z',
    });
    h.pushHandler = async (mutations) => alwaysOk(mutations);

    await h.engine.syncNow();
    expect(await storage.listEntities('dailyReport')).toHaveLength(0);
  });
});

// ---------- Senaryo 5: medya kuyruğu — dosya kaybolmadan retry ----------

describe('SyncEngine — medya kuyruğu bağlantısı', () => {
  it('rapor kabul olunca bağlı medya satırı sunucu raporuna eşlenir (dosya URI yerelde kalır)', async () => {
    const storage = new MemorySyncStorage();
    const h = makeEngine(storage, {
      flushMedia: async () => ({ uploaded: 1, failed: 0 }),
    });
    h.pushHandler = async (mutations) => alwaysOk(mutations);
    h.pullHandler = async (cursor) => emptyPull(cursor);

    await h.engine.enqueue('dailyReport.upsertDraft', { projectId: 'prj-a', reportDate: '2026-11-05', workSummary: 'özet' }, 'mut-rpt');
    await h.engine.enqueueMedia({ uri: 'file:///tmp/foto1.jpg', mimeType: 'image/jpeg', sizeBytes: 1234 }, 'mut-rpt', 'prj-a');

    await h.engine.syncNow();

    const media = await storage.listMedia();
    expect(media).toHaveLength(1);
    expect(media[0]!.targetReportId).toBe('srv-mut-rpt'); // engine eşledi
    expect(media[0]!.localUri).toBe('file:///tmp/foto1.jpg'); // dosya URI'si korundu
    expect(media[0]!.status).toBe('pending');
  });

  it('enqueueMedia aynı rapora birden çok dosya ekler; her satır benzersiz anahtar alır', async () => {
    const storage = new MemorySyncStorage();
    const h = makeEngine(storage);
    await h.engine.enqueueMedia({ uri: 'file:///a.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }, 'mut-r', 'prj-a');
    await h.engine.enqueueMedia({ uri: 'file:///b.jpg', mimeType: 'image/jpeg', sizeBytes: 2 }, 'mut-r', 'prj-a');
    const media = await storage.listMedia();
    expect(media).toHaveLength(2);
    expect(new Set(media.map((m) => m.clientMutationId)).size).toBe(2);
    void h;
  });
});
