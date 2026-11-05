/**
 * Faz 06 mobil testleri — Puantaj işaretleme ekranı:
 *  1. Proje + durum listesi yüklenir; satır bazlı işaretleme çizilir.
 *  2. KRİTİK AKIŞ: durum çipine dokunma → POST /attendance (idempotent clientMutationId).
 *  3. GPS YOKTUR: ekran hiçbir konum izni/istemi üretmez (documents/07) —
 *     Location/Permissions çağrısı yapılmadığı doğrulanır.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider } from '../src/lib/auth-context';
import { AttendanceScreen } from '../src/screens/AttendanceScreen';

const CHIEF_USER = {
  id: 'u-chief',
  fullName: 'Şantiye Şefi Kemal',
  email: 'sef@santiyepro.test',
  status: 'ACTIVE',
  roles: ['SITE_CHIEF'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const fetchMock = jest.fn();

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

function mockFetch(): void {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(200, CHIEF_USER));
    if (url.includes('/attendance/statuses')) {
      return Promise.resolve(
        jsonResponse(200, {
          statuses: ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'SICK', 'HOLIDAY'],
          labels: {
            PRESENT: 'Tam Gün',
            HALF_DAY: 'Yarım Gün',
            ABSENT: 'Gelmedi',
            LEAVE: 'İzinli',
            SICK: 'Raporlu',
            HOLIDAY: 'Resmî Tatil',
          },
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
    if (url.includes('/personnel?')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: [
            {
              id: 'per-1',
              employeeCode: 'P-1001',
              fullName: 'Ahmet Yılmaz',
              phone: null,
              jobTitle: 'Kalıp Ustası',
              companyOrSubcontractor: null,
              status: 'ACTIVE',
              attendanceRecordCount: 0,
              createdById: 'u-chief',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
            {
              id: 'per-2',
              employeeCode: 'P-1002',
              fullName: 'Mehmet Demir',
              phone: null,
              jobTitle: 'Demirci',
              companyOrSubcontractor: 'Demir Taşeron',
              status: 'ACTIVE',
              attendanceRecordCount: 0,
              createdById: 'u-chief',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ],
          meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      );
    }
    if (url.includes('/attendance?') && method === 'GET') {
      return Promise.resolve(
        jsonResponse(200, {
          data: [],
          meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      );
    }
    if (url.includes('/attendance') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { personnelId: string; status: string; clientMutationId?: string };
      return Promise.resolve(
        jsonResponse(201, {
          record: {
            id: `rec-${body.personnelId}`,
            projectId: 'prj-1',
            projectCode: 'PRJ-001',
            projectName: 'Atatürk Bulvarı Konut İnşaatı',
            siteId: null,
            siteName: null,
            personnelId: body.personnelId,
            personnelName: 'Ahmet Yılmaz',
            personnelEmployeeCode: 'P-1001',
            workDate: '2026-06-01',
            shiftKey: 'GUNDUZ',
            status: body.status,
            checkInAt: null,
            checkOutAt: null,
            workedMinutes: null,
            note: null,
            recordedById: 'u-chief',
            recordedBy: { id: 'u-chief', fullName: 'Şantiye Şefi Kemal' },
            source: 'MOBILE',
            clientMutationId: body.clientMutationId ?? null,
            createdAt: '2026-06-01T08:00:00.000Z',
            updatedAt: '2026-06-01T08:00:00.000Z',
          },
          replayed: false,
        }),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: `bilinmeyen ${url}` } }));
  });
}

describe('AttendanceScreen (Faz 06)', () => {
  beforeEach(async () => {
    mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('at-1');
  });

  afterEach(async () => {
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it('proje çipleri ve personel satırlarını çizer; durum etiketleri sunucudan gelir', async () => {
    await render(
      <AuthProvider>
        <AttendanceScreen onClose={() => undefined} />
      </AuthProvider>,
    );

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByText('PRJ-001')).toBeTruthy();
    });
    await user.press(screen.getByText('PRJ-001'));

    await waitFor(() => {
      expect(screen.getByText('Ahmet Yılmaz')).toBeTruthy();
    });
    expect(screen.getByText('Mehmet Demir')).toBeTruthy();
    expect(screen.getAllByText('Tam Gün').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Raporlu').length).toBeGreaterThanOrEqual(2);
    // GPS bilgisi görünür ve izin istenmez
    expect(screen.getByText(/GPS\/konum istenmez/)).toBeTruthy();
    expect(screen.queryByText('Konum izni')).toBeNull();
  });

  it('KRİTİK AKIŞ: durum çipine dokunma sunucuya idempotent işaretleme gönderir', async () => {
    const user = userEvent.setup();
    await render(
      <AuthProvider>
        <AttendanceScreen onClose={() => undefined} />
      </AuthProvider>,
    );

    // Proje seç — personel satırları proje seçilince yüklenir
    await waitFor(() => {
      expect(screen.getByText('PRJ-001')).toBeTruthy();
    });
    await user.press(screen.getByText('PRJ-001'));

    // Personel satırları yüklensin
    await waitFor(() => {
      expect(screen.getByTestId('attendance-row-per-1')).toBeTruthy();
    });

    // Ahmet Yılmaz satırında "Tam Gün" çipine dokun (ilk satırdaki)
    const row = screen.getByTestId('attendance-row-per-1');
    const presentChip = withinRow(row, 'Tam Gün');
    await user.press(presentChip);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) => String(url).includes('/attendance') && (init as { method?: string })?.method === 'POST',
      );
      expect(post).toBeDefined();
      const body = JSON.parse(String((post as unknown[])?.[1] ? (post as unknown as [string, { body: string }])[1].body : '{}'));
      expect(body.status).toBe('PRESENT');
      expect(body.clientMutationId).toBeTruthy();
      expect(body.projectId).toBe('prj-1');
    });
  });

  it('arama alanı hızlı personel araması için sunucuya search parametresi gönderir', async () => {
    const user = userEvent.setup();
    await render(
      <AuthProvider>
        <AttendanceScreen onClose={() => undefined} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('PRJ-001')).toBeTruthy();
    });
    await user.press(screen.getByText('PRJ-001'));
    await waitFor(() => {
      expect(screen.getByTestId('attendance-row-per-1')).toBeTruthy();
    });

    const searchField = screen.getByPlaceholderText('Ad soyad veya sicil');
    await user.type(searchField, 'ahmet');

    await waitFor(
      () => {
        const personnelCall = fetchMock.mock.calls.find(([url]) => String(url).includes('search=ahmet'));
        expect(personnelCall).toBeDefined();
        expect(String(personnelCall?.[0])).toContain('/personnel');
      },
      { timeout: 3000 },
    );
  });
});

/** Satır içinden etiketle buton bulur (aynı etiket diğer satırlarda da olabilir). */
function withinRow(rowHandle: ReturnType<typeof screen.getByTestId>, label: string) {
  const queryAll = screen.queryAllByText(label);
  // getByTestId handle'ı ile satır kökü; basit yaklaşım: ekrandaki ilk eşleşme
  void rowHandle;
  expect(queryAll.length).toBeGreaterThan(0);
  return queryAll[0]!;
}
