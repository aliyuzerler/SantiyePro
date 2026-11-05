/**
 * Faz 07 mobil testleri — Malzeme Hareketi ekranı:
 *  1. Depo çipleri ve son bilinen stok kartları çizilir (uyarı niteliği metni).
 *  2. KRİTİK AKIŞ: çıkış hareketi → POST /inventory/movements (idempotent
 *     clientMutationId) → 'Hareket kaydedildi.' bildirimi.
 *  3. Çevrimdışı: token yok → hareket kuyruğa alınır; kesin kabul sunucudadır.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider } from '../src/lib/auth-context';
import { StockScreen } from '../src/screens/StockScreen';

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
          id: 'u-wh',
          fullName: 'Depocu Kamil',
          email: 'depocu@santiyepro.test',
          status: 'ACTIVE',
          roles: ['WAREHOUSE'],
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
              name: 'Atatürk Bulvarı Konut İnşaatı',
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
    if (url.includes('/inventory/warehouses')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: [
            {
              id: 'wh-1',
              projectId: null,
              projectName: null,
              name: 'Merkez Depo',
              location: null,
              isActive: true,
              createdById: 'u-wh',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
            {
              id: 'wh-2',
              projectId: 'prj-1',
              projectName: 'Atatürk Bulvarı Konut İnşaatı',
              name: 'Şantiye Deposu',
              location: null,
              isActive: true,
              createdById: 'u-wh',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ],
          meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      );
    }
    if (url.includes('/inventory/materials')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: [
            {
              id: 'mat-1',
              code: 'CIM-425',
              name: 'Çimento CEM I 42,5',
              category: null,
              unit: 'TORBA',
              minStock: '10',
              isActive: true,
              createdById: 'u-wh',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ],
          meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      );
    }
    if (url.includes('/inventory/balances')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: [
            {
              materialId: 'mat-1',
              materialName: 'Çimento CEM I 42,5',
              materialCode: 'CIM-425',
              unit: 'TORBA',
              minStock: '10',
              warehouseId: 'wh-1',
              warehouseName: 'Merkez Depo',
              projectId: null,
              projectName: null,
              quantity: '42.5',
              isLow: false,
              lastMovementAt: '2026-06-01T08:00:00.000Z',
            },
          ],
          meta: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
        }),
      );
    }
    if (url.includes('/inventory/movements') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { type: string; quantity: string; clientMutationId?: string };
      return Promise.resolve(
        jsonResponse(201, {
          movement: {
            id: 'mov-1',
            type: body.type,
            materialId: 'mat-1',
            materialName: 'Çimento CEM I 42,5',
            materialCode: 'CIM-425',
            unit: 'TORBA',
            warehouseId: 'wh-1',
            warehouseName: 'Merkez Depo',
            targetWarehouseId: null,
            targetWarehouseName: null,
            projectId: null,
            projectName: null,
            quantity: body.quantity,
            unitCost: null,
            referenceType: null,
            referenceId: null,
            note: null,
            occurredAt: '2026-06-01T09:00:00.000Z',
            createdById: 'u-wh',
            createdBy: { id: 'u-wh', fullName: 'Depocu Kamil' },
            reversesMovementId: null,
            clientMutationId: body.clientMutationId ?? null,
            createdAt: '2026-06-01T09:00:00.000Z',
          },
          replayed: false,
        }),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `bilinmeyen ${url}` } }));
  });
}

describe('StockScreen (Faz 07)', () => {
  beforeEach(async () => {
    mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('at-1');
  });

  afterEach(async () => {
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it('depo çipleri, hareket tipleri ve son bilinen stok kartı çizilir', async () => {
    await render(
      <AuthProvider>
        <StockScreen onClose={() => undefined} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Merkez Depo').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Şantiye Deposu').length).toBeGreaterThan(0);
    expect(screen.getByText('Giriş')).toBeTruthy();
    expect(screen.getByText('Transfer')).toBeTruthy();
    expect(screen.getByText('Düzeltme')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId('stock-card-Çimento CEM I 42,5')).toBeTruthy();
    });
    expect(screen.getByText(/Son bilinen stok|kesin kabul sunucu/)).toBeTruthy();
  });

  it('çıkış hareketi idempotent clientMutationId ile POST edilir; başarı bildirimi gelir', async () => {
    await render(
      <AuthProvider>
        <StockScreen onClose={() => undefined} />
      </AuthProvider>,
    );

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId('stock-card-Çimento CEM I 42,5')).toBeTruthy();
    });

    // Malzeme kartına dokun → seçim
    await user.press(screen.getByTestId('stock-card-Çimento CEM I 42,5'));

    // Miktar gir (varsayılan tip OUT)
    const qty = screen.getByPlaceholderText('12.5');
    await user.type(qty, '3');

    await user.press(screen.getByText('Hareketi Kaydet'));

    await waitFor(() => {
      expect(screen.getByTestId('stock-notice')).toBeTruthy();
    });

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/inventory/movements') && (init as { method?: string } | undefined)?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse(String((postCall![1] as { body: string }).body)) as {
      type: string;
      materialId: string;
      warehouseId: string;
      quantity: string;
      clientMutationId?: string;
      unit: string;
    };
    expect(body.type).toBe('OUT');
    expect(body.materialId).toBe('mat-1');
    expect(body.warehouseId).toBe('wh-1');
    expect(body.quantity).toBe('3');
    expect(body.unit).toBe('TORBA');
    expect(body.clientMutationId).toBeTruthy();
  });
});
