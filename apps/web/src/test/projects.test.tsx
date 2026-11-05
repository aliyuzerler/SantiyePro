import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

afterEach(() => cleanup());

// ---------- Mocks ----------

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'prj-1' }),
  usePathname: () => '/projeler',
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
  fullName: 'Saha İşçisi',
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

const projectListBody = {
  data: [
    {
      id: 'prj-1',
      code: 'PRJ-001',
      name: 'Atatürk Bulvarı Konut İnşaatı',
      clientName: 'Yapı A.Ş.',
      startDate: '2026-02-05',
      plannedEndDate: '2027-06-30',
      contractAmount: '1234567.89',
      currency: 'TRY',
      status: 'ACTIVE',
      manager: { id: 'u-pm', fullName: 'Proje Yöneticisi Ayşe' },
      siteCount: 2,
      memberCount: 3,
      createdAt: '2026-01-10T09:00:00.000Z',
      updatedAt: '2026-01-10T09:00:00.000Z',
    },
    {
      id: 'prj-2',
      code: 'PRJ-002',
      name: 'Köprü Bakım Onarım',
      status: 'PLANNING',
      manager: null,
      siteCount: 0,
      memberCount: 1,
      createdAt: '2026-01-11T09:00:00.000Z',
      updatedAt: '2026-01-11T09:00:00.000Z',
    },
  ],
  meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
};

// ---------- Liste sayfası ----------

import ProjectsPage from '@/app/(panel)/projeler/page';
import ProjectDetailPage from '@/app/(panel)/projeler/[id]/page';

describe('Projeler listesi', () => {
  it('proje kartlarını tabloda gösterir: kod, ad, sorumlu, durum', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, projectListBody));
    render(<ProjectsPage />);

    await waitFor(() => expect(screen.getByText('PRJ-001')).toBeTruthy());
    expect(screen.getByText('Atatürk Bulvarı Konut İnşaatı')).toBeTruthy();
    expect(screen.getByText('Proje Yöneticisi Ayşe')).toBeTruthy();
    expect(screen.getAllByText('Aktif').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Planlanıyor').length).toBeGreaterThan(0);
    // Toplam sayısı başlıkta
    expect(screen.getByText(/Proje Listesi \(2\)/)).toBeTruthy();
  });

  it('project.edit izni olmayan kullanıcı liste görür ama oluşturma butonu çizilmez', async () => {
    currentUser = workerUser;
    fetchMock.mockResolvedValueOnce(jsonResponse(200, projectListBody));
    render(<ProjectsPage />);

    await waitFor(() => expect(screen.getByText('PRJ-001')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Yeni Proje' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Arşivle' })).toBeNull();
  });

  it('API hatasında hata durumu ve tekrar dene gösterilir', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'Sunucu hatası' }, traceId: 't1' }),
    );
    render(<ProjectsPage />);
    await waitFor(() => expect(screen.getByText('Sunucu hatası')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeTruthy();
  });
});

// ---------- Detay sayfası ----------

const projectDetailBody = {
  ...projectListBody.data[0],
  description: '24 katlı konut projesi',
  sites: [
    { id: 'site-1', projectId: 'prj-1', name: 'Kazı Alanı', address: 'Blok A', status: 'ACTIVE', createdAt: '2026-01-12T00:00:00.000Z' },
    { id: 'site-2', projectId: 'prj-1', name: 'Şap Alanı', address: null, status: 'INACTIVE', createdAt: '2026-01-13T00:00:00.000Z' },
  ],
  members: [
    { id: 'm-1', userId: 'u-pm', fullName: 'Proje Yöneticisi Ayşe', email: 'pm@santiyepro.test', scopeRole: 'MANAGER', isManager: true, createdAt: '2026-01-10T09:00:00.000Z' },
    { id: 'm-2', userId: 'u-worker', fullName: 'Saha İşçisi Mehmet', email: 'isci@santiyepro.test', scopeRole: 'WORKER', isManager: false, createdAt: '2026-01-14T09:00:00.000Z' },
  ],
};

describe('Proje detayı', () => {
  it('aktif proje bağlamını (kod + ad + durum) başlıkta gösterir', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, projectDetailBody));
    render(<ProjectDetailPage />);

    await waitFor(() => expect(screen.getAllByText('PRJ-001').length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { name: 'Atatürk Bulvarı Konut İnşaatı' })).toBeTruthy();
    expect(screen.getAllByText('Aktif').length).toBeGreaterThan(0);
  });

  it('şantiyeleri ve üyeleri bölümlerde listeler', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, projectDetailBody));
    render(<ProjectDetailPage />);

    await waitFor(() => expect(screen.getByText('Kazı Alanı')).toBeTruthy());
    expect(screen.getByText('Şap Alanı')).toBeTruthy();
    expect(screen.getAllByText('Proje Yöneticisi Ayşe').length).toBeGreaterThan(0);
    expect(screen.getByText('Sorumlu', { selector: 'span' })).toBeTruthy(); // sorumlu rozeti
    expect(screen.getByText(/Şantiyeler \(2\)/)).toBeTruthy();
    expect(screen.getByText(/Proje Üyeleri \(2\)/)).toBeTruthy();
  });

  it('project.edit izni olmayan kullanıcıya düzenleme aksiyonları çizilmez', async () => {
    currentUser = workerUser;
    fetchMock.mockResolvedValueOnce(jsonResponse(200, projectDetailBody));
    render(<ProjectDetailPage />);

    await waitFor(() => expect(screen.getByText('Kazı Alanı')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Düzenle' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Şantiye Ekle' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Üye Ekle' })).toBeNull();
  });

  it('kapsam dışı proje (404) için anlamlı hata gösterir', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Proje bulunamadı' }, traceId: 't1' }),
    );
    render(<ProjectDetailPage />);
    await waitFor(() =>
      expect(screen.getByText('Proje bulunamadı veya erişim kapsamınızda değil.')).toBeTruthy(),
    );
  });
});
