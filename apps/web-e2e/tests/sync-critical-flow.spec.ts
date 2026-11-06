/**
 * ŞantiyePro e2e — Faz 09 kritik akış (GERÇEK API + GERÇEK PostgreSQL).
 *
 * Faz 09 (offline-first sync) ürün yüzü mobil uygulamadır; canlı E2E bu fazın
 * SUNUCU tarafını gerçek API üzerinde uçtan uca doğrular (mobil tarafın motor
 * testleri jest paketindedir):
 *
 *  1. /sync/push aynı clientMutationId ile 3 kez → tek puantaj kaydı
 *     (SyncMutationLog replay'i gerçek DB'de doğrulanır)
 *  2. /sync/push görev yorumu → kabul; /sync/pull delta'sı yorumu seq ile getirir
 *  3. stale version görev güncellemesi → conflict (otomatik üzerine yazma yok)
 *  4. geçersiz gider push'u → rejected + açıklama; tekrarı replayed aynı sonuç
 *  5. üye olmayan kullanıcı kapsam dışı projeye push → rejected NOT_FOUND
 *  6. pull accessibleProjectIds snapshot'ı üyelik kaldırılmasını yansıtır
 *  7. Swagger belgesinde sync uçları görünür (sözleşme yüzeyi)
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, apiSend, ensureAdminToken } from './helpers/api';
interface SyncResult {
  clientMutationId: string;
  status: 'accepted' | 'rejected' | 'conflict';
  replayed: boolean;
  serverId?: string | null;
  version?: number | null;
  error?: { code: string; message: string } | null;
}

interface PushEnvelope {
  results: SyncResult[];
  serverTime: string;
}

interface PullEnvelope {
  cursor: number;
  hasMore: boolean;
  changes: Array<{ seq: number; entityType: string; operation: string; entityId: string; projectId: string | null; updatedAt: string; data?: unknown }>;
  accessibleProjectIds: string[];
  serverTime: string;
}

async function pushMutations(request: APIRequestContext, token: string, mutations: unknown[]): Promise<PushEnvelope> {
  const res = await request.post(`${API_URL}/sync/push`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { mutations },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as PushEnvelope;
}

async function pullChanges(request: APIRequestContext, token: string, query: string): Promise<PullEnvelope> {
  const res = await request.get(`${API_URL}/sync/pull?${query}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as PullEnvelope;
}


test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Faz 09 kritik akışı masaüstü projesinde koşar (mobil kritik akışı RNTL paketindedir).',
  );
});

interface SyncSeed {
  token: string;
  projectId: string;
  projectName: string;
  personnelId: string;
  taskId: string;
}

async function seedSyncData(request: APIRequestContext): Promise<SyncSeed> {
  const token = await ensureAdminToken(request);
  const stamp = Date.now();
  const projectName = `E2E Senkron Proje ${stamp}`;

  const project = await apiSend(request, token, 'POST', '/projects', {
    code: `E2E-SY${stamp % 100000}`,
    name: projectName,
    status: 'ACTIVE',
  });
  const personnel = await apiSend(request, token, 'POST', '/personnel', {
    fullName: `E2E Senkron İşçisi ${stamp}`,
    employeeCode: `E2E-SY-${stamp % 100000}`,
  });
  const task = await apiSend(request, token, 'POST', '/tasks', {
    projectId: project.id,
    title: `E2E Senkron görevi ${stamp}`,
  });

  return { token, projectId: project.id as string, projectName, personnelId: personnel.id as string, taskId: task.id as string };
}

test.describe('Faz 09 — Offline-first sync kritik akış', () => {
  let seeded: SyncSeed;

  test.beforeAll(async ({ request }) => {
    seeded = await seedSyncData(request);
  });

  test('push×3 idempotent → pull delta → conflict → rejected → kapsam', async ({ request }) => {
    test.setTimeout(120_000);

    // ---------- 1) Aynı mutation 3 kez → tek kayıt ----------
    const mutation = {
      clientMutationId: `e2e-syn-att-${Date.now()}`,
      type: 'attendance.mark',
      payload: {
        projectId: seeded.projectId,
        personnelId: seeded.personnelId,
        workDate: '2026-11-05',
        shiftKey: 'GUNDUZ',
        status: 'PRESENT',
      },
      localCreatedAt: '2026-11-05T06:00:00.000Z',
    };

    const first = await pushMutations(request, seeded.token, [mutation]);
    expect(first.results[0]!.status).toBe('accepted');
    expect(first.results[0]!.replayed).toBe(false);
    const serverId = first.results[0]!.serverId as string;
    expect(serverId).toBeTruthy();

    for (let i = 0; i < 2; i += 1) {
      const replay = await pushMutations(request, seeded.token, [mutation]);
      expect(replay.results[0]!.status).toBe('accepted');
      expect(replay.results[0]!.replayed).toBe(true);
      expect(replay.results[0]!.serverId).toBe(serverId);
    }

    const attendance = (await apiSend(
      request,
      seeded.token,
      'GET',
      `/attendance?projectId=${seeded.projectId}&workDate=2026-11-05`,
    )) as { data: Array<{ id: string }> };
    const records = attendance.data.filter((r) => r.id === serverId);
    expect(records).toHaveLength(1); // çift kayıt yok

    // ---------- 2) Görev yorumu push → pull delta ----------
    const commentMutation = {
      clientMutationId: `e2e-syn-cmt-${Date.now()}`,
      type: 'task.comment',
      payload: { taskId: seeded.taskId, body: 'Çevrimdışı eklenen canlı yorum' },
    };
    const commentPush = await pushMutations(request, seeded.token, [commentMutation]);
    expect(commentPush.results[0]!.status).toBe('accepted');

    const pull = await pullChanges(request, seeded.token, 'cursor=0&limit=200');
    expect(pull.accessibleProjectIds).toContain(seeded.projectId);
    const change = pull.changes.find(
      (c: { entityType: string; entityId: string }) =>
        c.entityType === 'taskComment' && c.entityId === commentPush.results[0]!.serverId,
    );
    expect(change).toBeTruthy();
    expect(change!.operation).toBe('upsert');
    expect((change!.data as { body: string }).body).toBe('Çevrimdışı eklenen canlı yorum');

    // ---------- 3) Stale version → conflict ----------
    const stale = await pushMutations(request, seeded.token, [
      {
        clientMutationId: `e2e-syn-tsk-${Date.now()}`,
        type: 'task.update',
        payload: { taskId: seeded.taskId, title: 'Canlı çakışma başlığı', version: 999 },
      },
    ]);
    expect(stale.results[0]!.status).toBe('conflict');
    expect(stale.results[0]!.error?.code).toBe('CONFLICT');

    // ---------- 4) Geçersiz gider → rejected + replay aynı sonuç ----------
    const badExpense = {
      clientMutationId: `e2e-syn-exp-${Date.now()}`,
      type: 'expense.create',
      payload: {
        projectId: seeded.projectId,
        categoryId: 'olmayan-kategori',
        description: 'Kısa',
        amount: '10',
        currency: 'TRY',
        expenseDate: '2026-11-05',
      },
    };
    const badFirst = await pushMutations(request, seeded.token, [badExpense]);
    expect(badFirst.results[0]!.status).toBe('rejected');
    expect(badFirst.results[0]!.error?.code).toBe('NOT_FOUND');
    const badReplay = await pushMutations(request, seeded.token, [badExpense]);
    expect(badReplay.results[0]!.replayed).toBe(true);
    expect(badReplay.results[0]!.error?.message).toBe(badFirst.results[0]!.error?.message);
  });

  test('üyelik kaldırımı accessibleProjectIds\u2019e yansır; kapsam dışı push veri sızdırmaz', async ({ request }) => {
    test.setTimeout(120_000);

    // Kapsam-dışı bir PM kullanıcısı kur (gerçek API üzerinden).
    const stamp = Date.now();
    const outsiderEmail = `e2e-sync-out-${stamp}@santiyepro.test`;
    const outsider = await apiSend(request, seeded.token, 'POST', '/users', {
      fullName: 'E2E Kapsam Dışı',
      email: outsiderEmail,
      password: 'OsGucluParola123',
      roles: ['PROJECT_MANAGER'],
    });
    const outsiderToken = await (async () => {
      const res = await request.post(`${process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1'}/auth/login`, {
        data: { email: outsiderEmail, password: 'OsGucluParola123' },
      });
      expect(res.status()).toBe(200);
      return ((await res.json()) as { accessToken: string }).accessToken;
    })();
    void outsider;

    // Kapsam dışı proje push'u → rejected NOT_FOUND (kayıt varmış gibi davranılmaz).
    const rejected = await request.post(`${process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1'}/sync/push`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
      data: {
        mutations: [
          {
            clientMutationId: `e2e-syn-scp-${stamp}`,
            type: 'attendance.mark',
            payload: {
              projectId: seeded.projectId,
              personnelId: seeded.personnelId,
              workDate: '2026-11-05',
              shiftKey: 'GUNDUZ',
              status: 'PRESENT',
            },
          },
        ],
      },
    });
    expect(rejected.status()).toBe(201);
    const rejectedBody = (await rejected.json()) as { results: Array<{ status: string; error?: { code: string } }> };
    expect(rejectedBody.results[0]!.status).toBe('rejected');
    expect(rejectedBody.results[0]!.error?.code).toBe('NOT_FOUND');

    // Outsider pull'unda proje verisi YOK; admin pull'unda VAR.
    const outsiderPull = await request.get(
      `${process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1'}/sync/pull?cursor=0&limit=200`,
      { headers: { Authorization: `Bearer ${outsiderToken}` } },
    );
    const outsiderPullBody = (await outsiderPull.json()) as { accessibleProjectIds: string[]; changes: Array<{ projectId: string | null }> };
    expect(outsiderPullBody.accessibleProjectIds).not.toContain(seeded.projectId);
    expect(outsiderPullBody.changes.every((c) => c.projectId !== seeded.projectId)).toBe(true);

    const adminPull = await request.get(
      `${process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1'}/sync/pull?cursor=0&limit=200`,
      { headers: { Authorization: `Bearer ${seeded.token}` } },
    );
    const adminPullBody = (await adminPull.json()) as { accessibleProjectIds: string[] };
    expect(adminPullBody.accessibleProjectIds).toContain(seeded.projectId);
  });

  test('Swagger belgesi sync uçlarını açıklar', async ({ request }) => {
    const res = await request.get(`${process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1'}/docs-json`);
    expect(res.ok()).toBeTruthy();
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toContain('/api/v1/sync/push');
    expect(Object.keys(doc.paths)).toContain('/api/v1/sync/pull');
  });
});
