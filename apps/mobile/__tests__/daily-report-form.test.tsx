/**
 * Faz 05 mobil testleri — günlük rapor formu (mobil öncelikli):
 *  1. Form bölümleri + proje seçimi çizer; proje seçilmeden taslak alınamaz.
 *  2. KRİTİK AKIŞ: metin → taslak kaydet (POST /daily-reports) → gönder (POST submit).
 *  3. Metin korunumu: fotoğraf yükleme başarısız olursa dosya kuyruğa alınır,
 *     uyarı gösterilir; rapor metni sunucuda kaydedilmiş olur.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider } from '../src/lib/auth-context';
import { DailyReportFormScreen } from '../src/screens/DailyReportFormScreen';
import { offlineMediaQueue } from '../src/lib/offline-media-queue';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: async () => ({
    canceled: false,
    assets: [{ uri: 'file:///tmp/saha-foto.jpg', mimeType: 'image/jpeg', fileSize: 2048 }],
  }),
}));

jest.mock('expo-file-system', () => ({
  UploadType: { BINARY_CONTENT: 0 },
  File: class {
    constructor(uri: string) {
      void uri;
    }
    async upload(): Promise<{ status: number }> {
      throw new Error('ağ yok — yükleme başarısız');
    }
  },
}));

const CHIEF_USER = {
  id: 'u-chief',
  fullName: 'Şantiye Şefi Kemal',
  email: 'sef@santiyepro.test',
  status: 'ACTIVE',
  roles: ['SITE_CHIEF'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

let meUser: Record<string, unknown> = CHIEF_USER;
const fetchMock = jest.fn();

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

function mockFetch(): void {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(200, meUser));
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
              siteCount: 1,
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
    if (url.includes('/projects/prj-1')) {
      return Promise.resolve(
        jsonResponse(200, {
          id: 'prj-1',
          code: 'PRJ-001',
          name: 'Atatürk Bulvarı Konut İnşaatı',
          status: 'ACTIVE',
          sites: [{ id: 'site-1', name: 'Kazı Alanı', status: 'ACTIVE', projectId: 'prj-1', createdAt: '2026-01-11T00:00:00.000Z' }],
          members: [],
          currency: 'TRY',
          createdAt: '2026-01-10T00:00:00.000Z',
          updatedAt: '2026-01-10T00:00:00.000Z',
        }),
      );
    }
    if (url.includes('/daily-reports') && method === 'POST') {
      return Promise.resolve(
        jsonResponse(201, {
          id: 'rep-9',
          projectId: 'prj-1',
          reportDate: '2026-11-05',
          workSummary: '',
          status: 'DRAFT',
          revisionNo: 0,
          workers: [],
          media: [],
          createdAt: '2026-11-05T09:00:00.000Z',
          updatedAt: '2026-11-05T09:00:00.000Z',
        }),
      );
    }
    if (url.includes('/daily-reports/rep-9/submit')) {
      return Promise.resolve(jsonResponse(200, { id: 'rep-9', status: 'SUBMITTED' }));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Bilinmeyen uç' } }));
  });
  global.fetch = fetchMock as unknown as typeof global.fetch;
}

beforeEach(async () => {
  meUser = CHIEF_USER;
  mockFetch();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('at-1');
});

afterEach(async () => {
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
});

describe('DailyReportFormScreen (Faz 05)', () => {
  it('form bölümlerini çizer; proje seçilmeden taslak alınamaz', async () => {
    await render(
      <AuthProvider>
        <DailyReportFormScreen onClose={() => {}} />
      </AuthProvider>,
    );

    expect(await screen.findByText('Yapılan İşler')).toBeTruthy();
    expect(screen.getByText('İş Güvenliği Notu')).toBeTruthy();
    expect(screen.getByText('Ertesi Gün Planı')).toBeTruthy();

    const saveButton = screen.getByRole('button', { name: 'Taslağı Kaydet' });
    expect(saveButton.props.accessibilityState.disabled).toBe(true);

    await userEvent.press(screen.getByLabelText('Proje: Atatürk Bulvarı Konut İnşaatı'));
    await waitFor(() => expect(saveButton.props.accessibilityState.disabled).toBe(false));
  });

  it('KRİTİK AKIŞ: metin girilir, taslak kaydedilir, gönderime alınır (POST gövdeleri doğru)', async () => {
    await render(
      <AuthProvider>
        <DailyReportFormScreen onClose={() => {}} />
      </AuthProvider>,
    );

    await userEvent.press(await screen.findByLabelText('Proje: Atatürk Bulvarı Konut İnşaatı'));
    await userEvent.type(await screen.findByLabelText('Yapılan işler'), 'Zemin kat kalıp montajı bitti.');
    await userEvent.type(await screen.findByLabelText('Hava durumu'), 'Güneş');
    await userEvent.press(screen.getByRole('button', { name: 'Taslağı Kaydet' }));

    await waitFor(() => {
      const creates = fetchMock.mock.calls.filter(
        (c) => String(c[0]).endsWith('/daily-reports') && (c[1] as { method?: string })?.method === 'POST',
      );
      expect(creates).toHaveLength(1);
      const body = JSON.parse((creates[0]![1] as { body: string }).body);
      expect(body.projectId).toBe('prj-1');
      expect(body.workSummary).toBe('Zemin kat kalıp montajı bitti.');
    });

    expect(await screen.findByText(/Taslak kaydedildi/)).toBeTruthy();
    await userEvent.press(screen.getByRole('button', { name: 'Gönderime Al' }));

    await waitFor(() => {
      const submits = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/submit'));
      expect(submits).toHaveLength(1);
    });
  });

  it('METİN KORUNUMU: fotoğraf yükleme başarısızsa kuyruğa alınır, taslak metni sunucudadır', async () => {
    const before = offlineMediaQueue.pendingCount();

    await render(
      <AuthProvider>
        <DailyReportFormScreen onClose={() => {}} />
      </AuthProvider>,
    );

    await userEvent.press(await screen.findByLabelText('Proje: Atatürk Bulvarı Konut İnşaatı'));
    await userEvent.type(await screen.findByLabelText('Yapılan işler'), 'Bu metin yükleme hatasında da korunmalı.');

    // Fotoğraf seç (mock) — yükleme mock'u hata fırlatır
    await userEvent.press(screen.getByRole('button', { name: 'Fotoğraf Seç' }));
    await waitFor(() => expect(screen.getByText(/Fotoğraflar \(1\)/)).toBeTruthy());

    await userEvent.press(screen.getByRole('button', { name: 'Taslağı Kaydet' }));

    // Uyarı gösterilir ve dosya kuyruğa alınır; taslak metni zaten POST edildi
    expect(await screen.findByText(/çevrimdışı kuyruğa alındı/)).toBeTruthy();
    await waitFor(() => expect(offlineMediaQueue.pendingCount()).toBeGreaterThan(before));

    const creates = fetchMock.mock.calls.filter(
      (c) => String(c[0]).endsWith('/daily-reports') && (c[1] as { method?: string })?.method === 'POST',
    );
    expect(creates).toHaveLength(1);
    const body = JSON.parse((creates[0]![1] as { body: string }).body);
    expect(body.workSummary).toContain('korunmalı');
  });
});
