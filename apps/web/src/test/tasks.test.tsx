import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

afterEach(() => cleanup());

// ---------- Mocks ----------

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/gorevler',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const adminUser = {
  id: 'u-admin',
  fullName: 'Firma Yöneticisi',
  email: 'admin@santiyepro.test',
  status: 'ACTIVE',
  roles: ['FIRM_ADMIN'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const workerUser = {
  id: 'u-worker',
  fullName: 'Saha İşçisi Mehmet',
  email: 'isci@santiyepro.test',
  status: 'ACTIVE',
  roles: ['FIELD_WORKER'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

let currentUser = adminUser;

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: currentUser,
    loading: false,
    getToken: () => 'test-token',
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  currentUser = adminUser;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
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
    description: null,
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

function listBody(tasks: unknown[]) {
  return { data: tasks, meta: { page: 1, pageSize: 20, total: tasks.length, totalPages: 1 } };
}

const projectListBody = {
  data: [
    {
      id: 'prj-1',
      code: 'PRJ-001',
      name: 'Atatürk Bulvarı Konut İnşaatı',
      clientName: null,
      description: null,
      address: null,
      startDate: null,
      plannedEndDate: null,
      actualEndDate: null,
      contractAmount: null,
      currency: 'TRY',
      status: 'ACTIVE',
      manager: null,
      siteCount: 0,
      memberCount: 2,
      createdAt: '2026-01-10T09:00:00.000Z',
      updatedAt: '2026-01-10T09:00:00.000Z',
    },
  ],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
};

// ---------- Tests ----------

describe('Görevler sayfası (Faz 04)', () => {
  it('görev listesini başlık, atanan, öncelik ve durum rozetleriyle render eder', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/projects')) return Promise.resolve(jsonResponse(200, projectListBody));
      if (String(url).includes('/tasks')) return Promise.resolve(jsonResponse(200, listBody([taskDto()])));
      return Promise.resolve(jsonResponse(404, {}));
    });

    const { default: TasksPage } = await import('@/app/(panel)/gorevler/page');
    render(<TasksPage />);

    await waitFor(() => expect(screen.getByText('Beton dökümünü planla')).toBeTruthy());
    expect(screen.getByText('Saha İşçisi Mehmet')).toBeTruthy();
    expect(screen.getAllByText('Yüksek').length).toBeGreaterThan(0); // öncelik rozeti + filtre seçeneği
    expect(screen.getAllByText('Yapılacak').length).toBeGreaterThan(0); // durum rozeti + filtre seçeneği
    expect(screen.getByText('Görev Listesi (1)')).toBeTruthy();
  });

  it('geciken görevde Gecikmiş rozeti gösterilir', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/projects')) return Promise.resolve(jsonResponse(200, projectListBody));
      if (String(url).includes('/tasks')) {
        return Promise.resolve(jsonResponse(200, listBody([taskDto({ overdue: true })])));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const { default: TasksPage } = await import('@/app/(panel)/gorevler/page');
    render(<TasksPage />);

    await waitFor(() => expect(screen.getByText('Gecikmiş')).toBeTruthy());
  });

  it('task.edit izni olmayan işçiye Yeni Görev butonu çizilmez', async () => {
    currentUser = workerUser;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/projects')) return Promise.resolve(jsonResponse(200, projectListBody));
      if (String(url).includes('/tasks')) return Promise.resolve(jsonResponse(200, listBody([taskDto()])));
      return Promise.resolve(jsonResponse(404, {}));
    });

    const { default: TasksPage } = await import('@/app/(panel)/gorevler/page');
    render(<TasksPage />);

    await waitFor(() => expect(screen.getByText('Beton dökümünü planla')).toBeTruthy());
    expect(screen.queryByText('Yeni Görev')).toBeNull();
  });

  it('durum filtresi sorguya yansır (status=TODO)', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/projects')) return Promise.resolve(jsonResponse(200, projectListBody));
      if (String(url).includes('/tasks')) return Promise.resolve(jsonResponse(200, listBody([])));
      return Promise.resolve(jsonResponse(404, {}));
    });

    const { default: TasksPage } = await import('@/app/(panel)/gorevler/page');
    render(<TasksPage />);

    await waitFor(() => expect(screen.getByLabelText('Durum')).toBeTruthy());
    await userEvent.selectOptions(screen.getByLabelText('Durum'), 'TODO');

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('status=TODO'))).toBe(true);
    });
  });

  it('boş liste EmptyState, hata ErrorState gösterir', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/projects')) return Promise.resolve(jsonResponse(200, projectListBody));
      if (String(url).includes('/tasks')) return Promise.resolve(jsonResponse(200, listBody([])));
      return Promise.resolve(jsonResponse(404, {}));
    });

    const { default: TasksPage } = await import('@/app/(panel)/gorevler/page');
    render(<TasksPage />);
    await waitFor(() => expect(screen.getByText('Görüntülenecek görev yok')).toBeTruthy());
  });

  it('API hatasında tekrar deneme ile ErrorState gösterilir', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/projects')) return Promise.resolve(jsonResponse(200, projectListBody));
      return Promise.resolve(jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Sunucu hatası' } }));
    });

    const { default: TasksPage } = await import('@/app/(panel)/gorevler/page');
    render(<TasksPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('detay drawer durum geçiş butonlarını sunar ve PATCH isteği atar', async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      const u = String(url);
      const isGet = !init?.method || init.method === 'GET';
      if (u.includes('/projects') && isGet) return Promise.resolve(jsonResponse(200, projectListBody));
      if (u.includes('/tasks?') && isGet) return Promise.resolve(jsonResponse(200, listBody([taskDto()])));
      if (u.includes('/tasks/task-1') && isGet) {
        return Promise.resolve(
          jsonResponse(200, {
            ...taskDto(),
            comments: [],
            statusHistory: [{ id: 1, fromStatus: null, toStatus: 'TODO', changedById: 'u-admin', changedByFullName: 'Firma Yöneticisi', changedAt: '2026-11-05T09:00:00.000Z' }],
          }),
        );
      }
      if (u.includes('/tasks/task-1') && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse(200, taskDto({ status: 'IN_PROGRESS', version: 2 })));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const { default: TasksPage } = await import('@/app/(panel)/gorevler/page');
    render(<TasksPage />);

    await waitFor(() => expect(screen.getAllByText('Detay').length).toBeGreaterThan(0));
    await userEvent.click(screen.getAllByText('Detay')[0]!);

    // Drawer açılır; durum geçiş butonları çıkar (TODO → Devam Ediyor/Engelli/İptal)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Görev detayı' })).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Devam Ediyor' })).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Devam Ediyor' }));

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes('/tasks/task-1') && (c[1] as { method?: string })?.method === 'PATCH',
      );
      expect(patches.length).toBeGreaterThan(0);
    });
  });
});
