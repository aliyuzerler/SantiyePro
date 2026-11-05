import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

afterEach(() => cleanup());

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'rep-1' }),
  usePathname: () => '/gunluk-raporlar',
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

function reportDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rep-1',
    projectId: 'prj-1',
    projectCode: 'PRJ-001',
    projectName: 'Atatürk Bulvarı Konut İnşaatı',
    siteId: null,
    siteName: null,
    reportDate: '2026-11-05',
    weather: 'Güneş',
    workSummary: 'Zemin kat kalıp montajı tamamlandı.',
    workforceSummary: 'Kalıp ekibi 6 kişi.',
    equipmentSummary: '1 kule vinç',
    issues: null,
    safetyNotes: 'Baret kontrolü yapıldı.',
    nextDayPlan: 'Beton dökümü.',
    status: 'SUBMITTED',
    revisionNo: 0,
    workers: [{ id: 'w1', name: 'Ahmet Yılmaz', jobTitle: 'Kalıp Ustası', workerCount: 6, hours: '9.50' }],
    media: [],
    createdById: 'u-chief',
    createdBy: { id: 'u-chief', fullName: 'Şantiye Şefi Kemal' },
    submittedAt: '2026-11-05T17:00:00.000Z',
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: '2026-11-05T16:00:00.000Z',
    updatedAt: '2026-11-05T16:00:00.000Z',
    revisions: [],
    ...overrides,
  };
}

const projectListBody = {
  data: [
    {
      id: 'prj-1',
      code: 'PRJ-001',
      name: 'Atatürk Bulvarı Konut İnşaatı',
      status: 'ACTIVE',
      siteCount: 0,
      memberCount: 2,
      currency: 'TRY',
      createdAt: '2026-01-10T09:00:00.000Z',
      updatedAt: '2026-01-10T09:00:00.000Z',
    },
  ],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
};

describe('Günlük Raporlar listesi (Faz 05)', () => {
  it('rapor satırlarını tarih, proje, durum rozeti ve ek sayısıyla render eder', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/projects')) return Promise.resolve(jsonResponse(200, projectListBody));
      if (String(url).includes('/daily-reports')) {
        return Promise.resolve(
          jsonResponse(200, { data: [reportDto({ mediaCount: 2 })], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const { default: DailyReportsPage } = await import('@/app/(panel)/gunluk-raporlar/page');
    render(<DailyReportsPage />);

    await waitFor(() => expect(screen.getByText('2026-11-05')).toBeTruthy());
    expect(screen.getByText(/Zemin kat kalıp montajı tamamlandı/)).toBeTruthy();
    expect(screen.getAllByText('Gönderildi').length).toBeGreaterThan(0); // durum rozeti + filtre seçeneği
    expect(screen.getByText('📷 2')).toBeTruthy();
    expect(screen.getByText('Rapor Listesi (1)')).toBeTruthy();
  });

  it('durum filtresi sorguya yansır', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/projects')) return Promise.resolve(jsonResponse(200, projectListBody));
      if (String(url).includes('/daily-reports')) {
        return Promise.resolve(jsonResponse(200, { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const { default: DailyReportsPage } = await import('@/app/(panel)/gunluk-raporlar/page');
    render(<DailyReportsPage />);

    await waitFor(() => expect(screen.getByLabelText('Durum')).toBeTruthy());
    await userEvent.selectOptions(screen.getByLabelText('Durum'), 'SUBMITTED');

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('status=SUBMITTED'))).toBe(true);
    });
  });

  it('dailyreport.view izni olmayan kullanıcıya yetkisiz durumu gösterilir', async () => {
    currentUser = workerUser;
    const { default: DailyReportsPage } = await import('@/app/(panel)/gunluk-raporlar/page');
    render(<DailyReportsPage />);
    await waitFor(() => expect(screen.getByText('Yetkisiz erişim')).toBeTruthy());
  });
});

describe('Günlük rapor detayı (Faz 05)', () => {
  it('meta, ekip tablosu, durum aksiyonları ve galeri/revizyon boş durumu render edilir', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/daily-reports/rep-1')) {
        return Promise.resolve(jsonResponse(200, reportDto()));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const { default: DetailPage } = await import('@/app/(panel)/gunluk-raporlar/[id]/page');
    render(<DetailPage />);

    expect(await screen.findByText('Zemin kat kalıp montajı tamamlandı.')).toBeTruthy();
    expect(screen.getByText('Ahmet Yılmaz')).toBeTruthy();
    expect(screen.getByText('Onayla')).toBeTruthy(); // SUBMITTED → APPROVED aksiyonu (admin)
    expect(screen.getByText('Reddet')).toBeTruthy();
    expect(screen.getByText(/revizyon kaydı yok/)).toBeTruthy();
  });

  it('galerideki görsel imzalı URL ile çözümlenir (resolveMediaUrl)', async () => {
    const media = [
      {
        id: 'm-1',
        originalName: 'saha.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
        url: '/api/v1/media/m-1/content?exp=1&sig=abc',
        createdAt: '2026-11-05T16:00:00.000Z',
      },
    ];
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/daily-reports/rep-1')) {
        return Promise.resolve(jsonResponse(200, reportDto({ media })));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const { default: DetailPage } = await import('@/app/(panel)/gunluk-raporlar/[id]/page');
    render(<DetailPage />);

    const img = (await screen.findByAltText('saha.png')) as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('http://');
    expect(img.getAttribute('src')).toContain('/api/v1/media/m-1/content');
  });

  it('onay aksiyonu POST /approve isteğini atar', async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      const u = String(url);
      if (u.includes('/daily-reports/rep-1') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, reportDto()));
      }
      if (u.includes('/daily-reports/rep-1/approve')) {
        return Promise.resolve(jsonResponse(200, reportDto({ status: 'APPROVED' })));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    const { default: DetailPage } = await import('@/app/(panel)/gunluk-raporlar/[id]/page');
    render(<DetailPage />);

    await userEvent.click(await screen.findByText('Onayla'));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes('/approve') && (c[1] as { method?: string })?.method === 'POST',
      );
      expect(calls).toHaveLength(1);
    });
  });
});
