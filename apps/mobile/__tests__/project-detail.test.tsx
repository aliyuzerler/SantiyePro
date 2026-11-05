import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider } from '../src/lib/auth-context';
import { ProjectDetailScreen } from '../src/screens/ProjectDetailScreen';

/**
 * Faz 03 mobil testleri — Proje detayı:
 * 1. Aktif proje bağlamı (kod + ad + durum) başlıkta görünür.
 * 2. Sekmeler arası geçiş: Genel / Şantiyeler / Üyeler.
 * 3. Şantiye ve üye verileri çizilir.
 */

const PM_USER = {
  id: 'u-pm',
  fullName: 'Proje Yöneticisi Ayşe',
  email: 'pm@santiyepro.test',
  status: 'ACTIVE',
  roles: ['PROJECT_MANAGER'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const DETAIL = {
  id: 'prj-1',
  code: 'PRJ-001',
  name: 'Atatürk Bulvarı Konut İnşaatı',
  clientName: 'Yapı A.Ş.',
  address: 'Ankara',
  description: null,
  startDate: '2026-02-05',
  plannedEndDate: '2027-06-30',
  actualEndDate: null,
  contractAmount: '1234567.89',
  currency: 'TRY',
  status: 'ACTIVE',
  manager: { id: 'u-pm', fullName: 'Proje Yöneticisi Ayşe' },
  siteCount: 2,
  memberCount: 2,
  createdAt: '2026-01-10T00:00:00.000Z',
  updatedAt: '2026-01-10T00:00:00.000Z',
  sites: [
    { id: 'site-1', projectId: 'prj-1', name: 'Kazı Alanı', address: 'Blok A', status: 'ACTIVE', createdAt: '2026-01-12T00:00:00.000Z' },
    { id: 'site-2', projectId: 'prj-1', name: 'Şap Alanı', address: null, status: 'INACTIVE', createdAt: '2026-01-13T00:00:00.000Z' },
  ],
  members: [
    { id: 'm-1', userId: 'u-pm', fullName: 'Proje Yöneticisi Ayşe', email: 'pm@santiyepro.test', scopeRole: 'MANAGER', isManager: true, createdAt: '2026-01-10T00:00:00.000Z' },
    { id: 'm-2', userId: 'u-2', fullName: 'Saha İşçisi Mehmet', email: 'isci@santiyepro.test', scopeRole: 'WORKER', isManager: false, createdAt: '2026-01-14T00:00:00.000Z' },
  ],
};

const fetchMock = jest.fn();

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(200, PM_USER));
    if (url.includes('/projects/prj-1')) return Promise.resolve(jsonResponse(200, DETAIL));
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Bilinmeyen uç' } }));
  });
  global.fetch = fetchMock as unknown as typeof global.fetch;
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('at-1');
});

afterEach(() => {
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
});

describe('ProjectDetailScreen (Faz 03)', () => {
  it('aktif proje bağlamı başlıkta: kod + ad + durum', async () => {
    await render(
      <AuthProvider>
        <ProjectDetailScreen projectId="prj-1" onBack={() => {}} />
      </AuthProvider>,
    );

    expect(await screen.findByText('PRJ-001')).toBeTruthy();
    expect(screen.getByText('Atatürk Bulvarı Konut İnşaatı')).toBeTruthy();
    expect(screen.getByText('Aktif')).toBeTruthy();
  });

  it('Genel sekmesinde bilgi alanları çizilir', async () => {
    await render(
      <AuthProvider>
        <ProjectDetailScreen projectId="prj-1" onBack={() => {}} />
      </AuthProvider>,
    );
    await screen.findByText('PRJ-001');

    expect(screen.getByText(/İşveren: Yapı A\.Ş\./)).toBeTruthy();
    expect(screen.getByText(/Sorumlu: Proje Yöneticisi Ayşe/)).toBeTruthy();
    expect(screen.getByText(/Sözleşme: 1234567\.89 TRY/)).toBeTruthy();
  });

  it('Şantiyeler sekmesinde şantiye listesi görünür', async () => {
    await render(
      <AuthProvider>
        <ProjectDetailScreen projectId="prj-1" onBack={() => {}} />
      </AuthProvider>,
    );
    await screen.findByText('PRJ-001');

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Şantiyeler sekmesi'));

    expect(await screen.findByText('Kazı Alanı')).toBeTruthy();
    expect(screen.getByText('Şap Alanı')).toBeTruthy();
    expect(screen.getByText('Pasife Al')).toBeTruthy(); // ACTIVE şantiye için aksiyon
  });

  it('Üyeler sekmesinde üye listesi ve sorumlu işareti görünür', async () => {
    await render(
      <AuthProvider>
        <ProjectDetailScreen projectId="prj-1" onBack={() => {}} />
      </AuthProvider>,
    );
    await screen.findByText('PRJ-001');

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Üyeler sekmesi'));

    expect(await screen.findByText(/Proje Yöneticisi Ayşe · Sorumlu/)).toBeTruthy();
    expect(screen.getByText(/Saha İşçisi Mehmet/)).toBeTruthy();
    // project.edit izniyle çıkarma aksiyonu çizilir (sorumlu hariç)
    expect(screen.getByText('Çıkar')).toBeTruthy();
  });

  it('kapsam dışı proje 404 → dürüst hata mesajı', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(200, PM_USER));
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Proje bulunamadı' }, traceId: 't1' }),
      );
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await render(
      <AuthProvider>
        <ProjectDetailScreen projectId="prj-9" onBack={() => {}} />
      </AuthProvider>,
    );

    expect(await screen.findByText('Proje bulunamadı veya erişim kapsamınızda değil.')).toBeTruthy();
  });
});
