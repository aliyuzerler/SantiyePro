import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import * as SecureStore from 'expo-secure-store';
import { AuthProvider } from '../src/lib/auth-context';
import { TasksScreen } from '../src/screens/TasksScreen';

/**
 * Faz 04 mobil testleri — Görevler (prompts/phase-04-test.md):
 *  1. "Bana Atananlar" listesi gerçek API yanıtından çizilir; gecikme işareti görünür.
 *  2. "Proje Görevleri" sekmesi proje seçimiyle doğru sorguyu atar.
 *  3. KRİTİK AKIŞ: kart → detay → durum değiştir (TODO→IN_PROGRESS) → PATCH + geçmiş.
 *  4. Kontrol listesi işaretleme → PATCH checklist.
 *  5. Yorum ekleme → POST comments.
 *  6. Boş/hata durumları dürüst gösterilir.
 */

const WORKER_USER = {
  id: 'u-worker',
  fullName: 'Saha İşçisi Mehmet',
  email: 'isci@santiyepro.test',
  status: 'ACTIVE',
  roles: ['FIELD_WORKER'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

let meUser: Record<string, unknown> = WORKER_USER;
const fetchMock = jest.fn();
const user = userEvent.setup();

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

function taskDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    projectId: 'prj-1',
    projectCode: 'PRJ-001',
    projectName: 'Atatürk Bulvarı Konut İnşaatı',
    siteId: null,
    siteName: null,
    title: 'Beton dökümünü planla',
    description: 'Zemin kat perde betonu',
    status: 'TODO',
    priority: 'HIGH',
    assigneeId: 'u-worker',
    assignee: { id: 'u-worker', fullName: 'Saha İşçisi Mehmet' },
    dueAt: '2030-06-30T09:00:00.000Z',
    completedAt: null,
    checklist: [{ id: 'c1', label: 'Kalıp kontrolü', done: false }],
    fileRefs: [],
    commentCount: 0,
    version: 1,
    overdue: false,
    createdById: 'u-admin',
    createdBy: { id: 'u-admin', fullName: 'Firma Yöneticisi' },
    createdAt: '2026-11-05T09:00:00.000Z',
    updatedAt: '2026-11-05T09:00:00.000Z',
    ...overrides,
  };
}

function detailBody(overrides: Record<string, unknown> = {}) {
  return {
    ...taskDto(overrides),
    comments: [],
    statusHistory: [
      {
        id: 1,
        fromStatus: null,
        toStatus: 'TODO',
        changedById: 'u-admin',
        changedByFullName: 'Firma Yöneticisi',
        changedAt: '2026-11-05T09:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

let listResponse: unknown = { data: [taskDto()], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } };

function mockFetch(): void {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(200, meUser));
    if (url.includes('/tasks?')) return Promise.resolve(jsonResponse(200, listResponse));
    if (url.includes('/projects?')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: [
            {
              id: 'prj-1',
              code: 'PRJ-001',
              name: 'Atatürk Bulvarı Konut İnşaatı',
              status: 'ACTIVE',
              manager: null,
              siteCount: 0,
              memberCount: 2,
              currency: 'TRY',
              createdAt: '2026-01-10T00:00:00.000Z',
              updatedAt: '2026-01-10T00:00:00.000Z',
            },
          ],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      );
    }
    if (url.includes('/tasks/task-1/comments') && method === 'POST') {
      return Promise.resolve(
        jsonResponse(201, {
          id: 'cm-1',
          taskId: 'task-1',
          userId: 'u-worker',
          userFullName: 'Saha İşçisi Mehmet',
          body: JSON.parse(init?.body ?? '{}').body,
          createdAt: '2026-11-05T10:00:00.000Z',
        }),
      );
    }
    if (url.includes('/tasks/task-1') && method === 'PATCH') {
      const patch = JSON.parse(init?.body ?? '{}');
      return Promise.resolve(jsonResponse(200, taskDto({ ...patch, version: 2 })));
    }
    if (url.includes('/tasks/task-1')) {
      return Promise.resolve(jsonResponse(200, detailBody()));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Bilinmeyen uç' } }));
  });
  global.fetch = fetchMock as unknown as typeof global.fetch;
}

beforeEach(async () => {
  meUser = WORKER_USER;
  listResponse = { data: [taskDto()], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } };
  mockFetch();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('at-1');
});

afterEach(async () => {
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
});

describe('TasksScreen (Faz 04)', () => {
  it('"Bana Atananlar" listesi kartları çizer: başlık, durum, termin, gecikme işareti', async () => {
    listResponse = {
      data: [
        taskDto(),
        taskDto({
          id: 'task-2',
          title: 'Kalıp sökümü',
          dueAt: '2020-01-01T09:00:00.000Z',
          overdue: true,
        }),
      ],
      meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
    };

    await render(
      <AuthProvider>
        <TasksScreen />
      </AuthProvider>,
    );

    expect(await screen.findByText('Beton dökümünü planla')).toBeTruthy();
    expect(screen.getByText('Kalıp sökümü')).toBeTruthy();
    expect(screen.getAllByText('Yapılacak').length).toBeGreaterThan(0);
    expect(screen.getByText('Gecikmiş')).toBeTruthy();
    expect(screen.getByText(/Termin: 2020-01-01/)).toBeTruthy();
  });

  it('"Proje Görevleri" sekmesinde proje seçimi sorguya projectId olarak yansır', async () => {
    await render(
      <AuthProvider>
        <TasksScreen />
      </AuthProvider>,
    );
    await screen.findByText('Beton dökümünü planla');

    await user.press(screen.getByLabelText('Proje Görevleri'));
    await user.press(await screen.findByLabelText('Proje filtresi: Atatürk Bulvarı Konut İnşaatı'));

    await waitFor(() => {
      const listCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/tasks?'));
      const last = listCalls[listCalls.length - 1]![0] as string;
      expect(last).toContain('projectId=prj-1');
      expect(last).not.toContain('assigneeId=me');
    });
  });

  it('KRİTİK AKIŞ: kart → detay → durum değiştirme PATCH atar ve geçmiş güncellenir', async () => {
    // Detay yanıtı: ikinci çağrıda IN_PROGRESS + 2 geçmiş kaydı
    let detailCalls = 0;
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(200, meUser));
      if (url.includes('/tasks?')) return Promise.resolve(jsonResponse(200, listResponse));
      if (url.includes('/tasks/task-1') && method === 'PATCH') {
        return Promise.resolve(jsonResponse(200, taskDto({ status: 'IN_PROGRESS', version: 2 })));
      }
      if (url.includes('/tasks/task-1')) {
        detailCalls += 1;
        return Promise.resolve(
          jsonResponse(
            200,
            detailCalls === 1
              ? detailBody()
              : detailBody({
                  status: 'IN_PROGRESS',
                  statusHistory: [
                    {
                      id: 1,
                      fromStatus: null,
                      toStatus: 'TODO',
                      changedById: 'u-admin',
                      changedByFullName: 'Firma Yöneticisi',
                      changedAt: '2026-11-05T09:00:00.000Z',
                    },
                    {
                      id: 2,
                      fromStatus: 'TODO',
                      toStatus: 'IN_PROGRESS',
                      changedById: 'u-worker',
                      changedByFullName: 'Saha İşçisi Mehmet',
                      changedAt: '2026-11-05T10:00:00.000Z',
                    },
                  ],
                }),
          ),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Bilinmeyen uç' } }));
    });

    await render(
      <AuthProvider>
        <TasksScreen />
      </AuthProvider>,
    );

    await user.press(await screen.findByLabelText('Beton dökümünü planla görev detayını aç'));

    // Detay ekranı: meta + durum butonları
    expect(await screen.findByText('Zemin kat perde betonu')).toBeTruthy();
    expect(screen.getByText('Durumu Değiştir')).toBeTruthy();

    await user.press(screen.getByText('Devam Ediyor'));

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes('/tasks/task-1') && (c[1] as { method?: string })?.method === 'PATCH',
      );
      expect(patches).toHaveLength(1);
      expect(JSON.parse((patches[0]![1] as { body: string }).body).status).toBe('IN_PROGRESS');
    });

    // Yenilenen detayda yeni geçmiş kaydı görünür
    expect(await screen.findByText(/Yapılacak → /)).toBeTruthy();
  });

  it('kontrol listesi maddesi işaretlenince checklist PATCH ile gönderilir', async () => {
    await render(
      <AuthProvider>
        <TasksScreen />
      </AuthProvider>,
    );
    await user.press(await screen.findByLabelText('Beton dökümünü planla görev detayını aç'));

    await user.press(await screen.findByLabelText('Kontrol: Kalıp kontrolü'));

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes('/tasks/task-1') && (c[1] as { method?: string })?.method === 'PATCH',
      );
      expect(patches).toHaveLength(1);
      const body = JSON.parse((patches[0]![1] as { body: string }).body);
      expect(body.checklist[0].done).toBe(true);
      expect(body.version).toBe(1);
    });
  });

  it('yorum eklenir: POST comments gövdesi doğru, liste yenilenir', async () => {
    await render(
      <AuthProvider>
        <TasksScreen />
      </AuthProvider>,
    );
    await user.press(await screen.findByLabelText('Beton dökümünü planla görev detayını aç'));

    const input = await screen.findByLabelText('Yorum metni');
    await user.type(input, 'Saha hazır, döküm yarın');
    await user.press(screen.getByText('Yorum Gönder'));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes('/comments') && (c[1] as { method?: string })?.method === 'POST',
      );
      expect(posts).toHaveLength(1);
      expect(JSON.parse((posts[0]![1] as { body: string }).body).body).toBe('Saha hazır, döküm yarın');
    });
  });

  it('atanan görev yoksa dürüst boş durum gösterilir', async () => {
    listResponse = { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } };
    await render(
      <AuthProvider>
        <TasksScreen />
      </AuthProvider>,
    );
    expect(await screen.findByText('Sana atanan görev yok')).toBeTruthy();
  });

  it('API hatasında ErrorState ve tekrar deneme sunulur', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(200, meUser));
      if (url.includes('/tasks?')) {
        return Promise.resolve(
          jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Görevler yüklenemedi' } }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Bilinmeyen uç' } }));
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await render(
      <AuthProvider>
        <TasksScreen />
      </AuthProvider>,
    );
    expect(await screen.findByText('Görevler yüklenemedi')).toBeTruthy();
    expect(screen.getByText('Tekrar dene')).toBeTruthy();
  });
});
