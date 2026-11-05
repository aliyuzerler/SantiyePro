import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider } from '../src/lib/auth-context';
import { ProjectsScreen } from '../src/screens/ProjectsScreen';

/**
 * Faz 03 mobil testleri — Proje listesi:
 * 1. Proje kartları gerçek API yanıtından çizilir (kod, ad, durum, sorumlu).
 * 2. Durum filtresi ve arama sunucuya iletilir.
 * 3. project.edit izni olmayan kullanıcıda oluşturma butonu çizilmez.
 * 4. Hata/boş durumları dürüst gösterilir.
 */

const PM_USER = {
  id: 'u-pm',
  fullName: 'Proje Yöneticisi Ayşe',
  email: 'pm@santiyepro.test',
  status: 'ACTIVE',
  roles: ['PROJECT_MANAGER'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const WORKER_USER = {
  id: 'u-worker',
  fullName: 'Saha İşçisi Mehmet',
  email: 'isci@santiyepro.test',
  status: 'ACTIVE',
  roles: ['FIELD_WORKER'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

let meUser: Record<string, unknown> = PM_USER;
const fetchMock = jest.fn();

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

function mockFetch(): void {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(200, meUser));
    if (url.includes('/projects')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: [
            {
              id: 'prj-1',
              code: 'PRJ-001',
              name: 'Atatürk Bulvarı Konut İnşaatı',
              status: 'ACTIVE',
              manager: { id: 'u-pm', fullName: 'Proje Yöneticisi Ayşe' },
              startDate: '2026-02-05',
              plannedEndDate: '2027-06-30',
              siteCount: 2,
              memberCount: 3,
              currency: 'TRY',
              createdAt: '2026-01-10T00:00:00.000Z',
              updatedAt: '2026-01-10T00:00:00.000Z',
            },
            {
              id: 'prj-2',
              code: 'PRJ-002',
              name: 'Köprü Bakım Onarım',
              status: 'PLANNING',
              manager: null,
              siteCount: 0,
              memberCount: 1,
              currency: 'TRY',
              createdAt: '2026-01-11T00:00:00.000Z',
              updatedAt: '2026-01-11T00:00:00.000Z',
            },
          ],
          meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        }),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Bilinmeyen uç' } }));
  });
  global.fetch = fetchMock as unknown as typeof global.fetch;
}

beforeEach(async () => {
  meUser = PM_USER;
  mockFetch();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('at-1');
});

afterEach(async () => {
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
});

describe('ProjectsScreen (Faz 03)', () => {
  it('proje kartlarını çizer: kod, ad, durum, sorumlu', async () => {
    await render(
      <AuthProvider>
        <ProjectsScreen />
      </AuthProvider>,
    );

    expect(await screen.findByText('PRJ-001')).toBeTruthy();
    expect(screen.getByText('Atatürk Bulvarı Konut İnşaatı')).toBeTruthy();
    expect(screen.getByText('Köprü Bakım Onarım')).toBeTruthy();
    expect(screen.getByText(/Sorumlu: Proje Yöneticisi Ayşe/)).toBeTruthy();
    expect(screen.getByText('2 proje')).toBeTruthy();
  });

  it('project.edit izni olan kullanıcıda Yeni Proje butonu vardır', async () => {
    await render(
      <AuthProvider>
        <ProjectsScreen />
      </AuthProvider>,
    );
    await screen.findByText('PRJ-001');
    expect(screen.getByText('Yeni Proje')).toBeTruthy();
  });

  it('project.edit izni olmayan işçide Yeni Proje butonu çizilmez', async () => {
    meUser = WORKER_USER;
    await render(
      <AuthProvider>
        <ProjectsScreen />
      </AuthProvider>,
    );
    await screen.findByText('PRJ-001');
    expect(screen.queryByText('Yeni Proje')).toBeNull();
  });

  it('durum filtresi seçimi sunucu isteğine yansır', async () => {
    await render(
      <AuthProvider>
        <ProjectsScreen />
      </AuthProvider>,
    );
    await screen.findByText('PRJ-001');

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Durum filtresi: Aktif'));

    await waitFor(
      () => {
        const calls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(calls.some((u) => u.includes('status=ACTIVE'))).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  it('arama girdisi sunucuya search parametresiyle gönderilir', async () => {
    await render(
      <AuthProvider>
        <ProjectsScreen />
      </AuthProvider>,
    );
    await screen.findByText('PRJ-001');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Proje ara'), 'Köprü');

    await waitFor(
      () => {
        const calls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(calls.some((u) => u.includes('search=K'))).toBe(true);
      },
      { timeout: 4000 },
    );
  });

  it('API hatasında dürüst hata durumu ve tekrar dene görünür', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(200, PM_USER));
      return Promise.resolve(
        jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Sunucu hatası' }, traceId: 't1' }),
      );
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await render(
      <AuthProvider>
        <ProjectsScreen />
      </AuthProvider>,
    );

    expect(await screen.findByText('Sunucu hatası')).toBeTruthy();
    expect(screen.getByText('Tekrar dene')).toBeTruthy();
  });
});
