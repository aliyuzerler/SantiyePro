/**
 * Faz 08 mobil testleri — Hızlı Gider Kaydı ekranı:
 *  1. Proje/kategori çipleri ve para birimi seçimi çizilir.
 *  2. KRİTİK AKIŞ: gider kaydı → POST /expenses (idempotent clientMutationId,
 *     taxRate verilmezse null — uydurma vergi yok) → 'Gider kaydedildi.'.
 *  3. Doğrulama: 3 ondalıklı tutar istemcide reddedilir, istek gitmez.
 *  4. Çevrimdışı: token yok → kuyruğa alınır; kesin kabul sunucudadır.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider } from '../src/lib/auth-context';
import { ExpenseScreen } from '../src/screens/ExpenseScreen';
import { offlineExpenseQueue } from '../src/lib/offline-expense-queue';

const fetchMock = jest.fn();

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

function mockFetch(): void {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/auth/me')) {
      return Promise.resolve(
        jsonResponse(200, {
          id: 'u-admin',
          fullName: 'Kurulum Yöneticisi',
          email: 'admin@santiyepro.test',
          status: 'ACTIVE',
          roles: ['FIRM_ADMIN'],
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      );
    }
    if (url.includes('/projects?')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: [
            {
              id: 'prj-1',
              code: 'PRJ-001',
              name: 'Köprü Bakım Onarım',
              status: 'ACTIVE',
              manager: null,
              siteCount: 0,
              memberCount: 1,
              currency: 'TRY',
              createdAt: '2026-01-10T00:00:00.000Z',
              updatedAt: '2026-01-10T00:00:00.000Z',
            },
          ],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      );
    }
    if (url.includes('/expenses/categories')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: [
            { id: 'cat-1', name: 'Yakıt', isActive: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
            { id: 'cat-2', name: 'Kırtasiye', isActive: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
          ],
        }),
      );
    }
    if (url.includes('/expenses') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        amount: string;
        taxRate: string | null;
        clientMutationId?: string;
        description: string;
      };
      return Promise.resolve(
        jsonResponse(201, {
          id: 'exp-1',
          projectId: 'prj-1',
          projectName: 'Köprü Bakım Onarım',
          categoryId: 'cat-1',
          categoryName: 'Yakıt',
          vendorName: null,
          description: body.description,
          amount: body.amount,
          currency: 'TRY',
          taxRate: body.taxRate,
          taxAmount: null,
          totalWithTax: null,
          expenseDate: '2026-01-15',
          status: 'DRAFT',
          receiptMediaId: null,
          submittedAt: null,
          approvedById: null,
          approvedBy: null,
          approvedAt: null,
          rejectionReason: null,
          createdById: 'u-admin',
          createdBy: { id: 'u-admin', fullName: 'Kurulum Yöneticisi' },
          createdAt: '2026-01-15T09:00:00.000Z',
          updatedAt: '2026-01-15T09:00:00.000Z',
        }),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `bilinmeyen ${url}` } }));
  });
}

/** mockFetch'in GET kısımlarını yeniden kurar (POST'u reddetmek için sarmalanır). */
function jsonResponseFactory(url: string, init?: { method?: string }) {
  if (String(url).includes('/auth/me')) {
    return jsonResponse(200, {
      id: 'u-admin',
      fullName: 'Kurulum Yöneticisi',
      email: 'admin@santiyepro.test',
      status: 'ACTIVE',
      roles: ['FIRM_ADMIN'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  }
  if (String(url).includes('/projects?')) {
    return jsonResponse(200, {
      data: [
        {
          id: 'prj-1',
          code: 'PRJ-001',
          name: 'Köprü Bakım Onarım',
          status: 'ACTIVE',
          manager: null,
          siteCount: 0,
          memberCount: 1,
          currency: 'TRY',
          createdAt: '2026-01-10T00:00:00.000Z',
          updatedAt: '2026-01-10T00:00:00.000Z',
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
  }
  if (String(url).includes('/expenses/categories')) {
    return jsonResponse(200, {
      data: [
        { id: 'cat-1', name: 'Yakıt', isActive: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
  }
  return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `bilinmeyen ${url}` } });
}

describe('ExpenseScreen (Faz 08)', () => {
  beforeEach(async () => {
    mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('at-1');
    await offlineExpenseQueue.hydrate();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it('proje/kategori çipleri, para birimi ve opsiyonel vergi alanı çizilir', async () => {
    await render(
      <AuthProvider>
        <ExpenseScreen onClose={() => undefined} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Köprü Bakım Onarım').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Yakıt')).toBeOnTheScreen();
    expect(screen.getByText('TRY')).toBeOnTheScreen();
    expect(screen.getByText('Para Birimi')).toBeOnTheScreen();
    expect(screen.getByText('Vergi Oranı (%)')).toBeOnTheScreen();
  });

  it('KRİTİK AKIŞ: gider kaydı → POST /expenses idempotent clientMutationId + taxRate null', async () => {
    const user = userEvent.setup();
    await render(
      <AuthProvider>
        <ExpenseScreen onClose={() => undefined} />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Proje Köprü Bakım Onarım')).toBeOnTheScreen();
    });

    await user.type(screen.getByLabelText('Açıklama'), 'Dizel alımı');
    await user.type(screen.getByLabelText('Tutar'), '1250.50');
    await user.press(screen.getByText('Gider Kaydet'));

    await waitFor(() => {
      expect(screen.getByText('Gider kaydedildi.')).toBeOnTheScreen();
    });

    const post = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/expenses') && init?.method === 'POST');
    expect(post).toBeDefined();
    const body = JSON.parse(String(post![1].body)) as { taxRate: string | null; clientMutationId?: string; amount: string };
    expect(body.amount).toBe('1250.50');
    expect(body.taxRate).toBeNull(); // uydurma vergi yok
    expect(body.clientMutationId).toBeTruthy();
  });

  it('doğrulama: 3 ondalıklı tutar istemcide reddedilir, istek gitmez', async () => {
    const user = userEvent.setup();
    await render(
      <AuthProvider>
        <ExpenseScreen onClose={() => undefined} />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Proje Köprü Bakım Onarım')).toBeOnTheScreen();
    });

    const before = fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/expenses') && init?.method === 'POST').length;
    await user.type(screen.getByLabelText('Açıklama'), 'Hatalı tutar');
    await user.type(screen.getByLabelText('Tutar'), '10.505');
    await user.press(screen.getByText('Gider Kaydet'));

    expect(await screen.findByText('Tutar 2 ondalıktan fazla olamaz (örn. 1250.50)')).toBeOnTheScreen();
    const after = fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/expenses') && init?.method === 'POST').length;
    expect(after).toBe(before);
  });

  it('çevrimdışı: sunucuya gönderim ağ hatasında gider kuyruğa alınır; kesin kabul sunucudadır', async () => {
    // POST /expenses ağı reddetsin (çevrimdışı simülasyonu) — kayıt kuyrukta bekler.
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (String(url).includes('/expenses') && (init?.method ?? 'GET') === 'POST') {
        return Promise.reject(new Error('network down'));
      }
      const okMock = fetchMock.mockImplementation;
      void okMock;
      return jsonResponseFactory(url, init);
    });
    const user = userEvent.setup();
    await render(
      <AuthProvider>
        <ExpenseScreen onClose={() => undefined} />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Proje Köprü Bakım Onarım')).toBeOnTheScreen();
    });

    await user.type(screen.getByLabelText('Açıklama'), 'Kuyruk gideri');
    await user.type(screen.getByLabelText('Tutar'), '300');
    await user.press(screen.getByText('Gider Kaydet'));

    await waitFor(() => {
      expect(screen.getByText('Çevrimdışı: gider kuyruğa alındı (kesin kabul sunucu doğrulamasına bağlıdır).')).toBeOnTheScreen();
    });
    expect(offlineExpenseQueue.pendingCount()).toBe(1);
  });
});
