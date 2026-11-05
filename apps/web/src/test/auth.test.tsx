import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

afterEach(() => cleanup());

// ---------- api.ts ----------

import { ApiError, apiFetch, usersApi } from '@/lib/api';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('apiFetch', () => {
  it("hata zarfını ApiError'a çevirir (code, message, traceId)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'E-posta veya parola geçersiz' }, traceId: 't-1' }),
    );
    const err = await apiFetch('/auth/login', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(401);
    expect(apiErr.code).toBe('UNAUTHORIZED');
    expect(apiErr.message).toBe('E-posta veya parola geçersiz');
    expect(apiErr.traceId).toBe('t-1');
  });

  it('credentials: include gönderir ve Bearer başlığı ekler', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    await apiFetch('/users', { token: 'abc' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });

  it('204 gövdesiz yanıtı çözer', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 } as unknown as Response);
    await expect(usersApi.update('t', '1', { status: 'DISABLED' })).resolves.toBeUndefined();
  });
});

// ---------- AuthProvider (lib/auth.tsx) ----------

import { AuthProvider, useAuth } from '@/lib/auth';

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/panel',
}));

function Probe() {
  const { user, loading, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.email ?? 'none'}</span>
      <button type="button" data-testid="login" onClick={() => void login('a@b.com', 'x')}>
        login
      </button>
      <button type="button" data-testid="logout" onClick={() => void logout()}>
        logout
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  it('açılışta refresh ile oturumu yeniler; başarısızsa kullanıcı yok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('login başarılıysa kullanıcıyı ayarlar', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } })); // boot
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { accessToken: 't1', user: { id: 'u1', email: 'a@b.com', fullName: 'A B', status: 'ACTIVE', roles: ['FIRM_ADMIN'], createdAt: '2026-01-01T00:00:00.000Z' } }),
    );
    await userEvent.click(screen.getByTestId('login'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('a@b.com'));
  });

  it('logout oturumu temizler ve /giris sayfasına yönlendirir', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } })); // boot
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    // state'i doldurmak için login
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { accessToken: 't2', user: { id: 'u1', email: 'a@b.com', fullName: 'A B', status: 'ACTIVE', roles: [], createdAt: '2026-01-01T00:00:00.000Z' } }),
    );
    await userEvent.click(screen.getByTestId('login'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('a@b.com'));
    fetchMock.mockResolvedValueOnce(jsonResponse(204, undefined)); // logout
    await userEvent.click(screen.getByTestId('logout'));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/giris'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });
});

// ---------- Giriş sayfası ----------

import LoginPage from '@/app/giris/page';

describe('Giriş sayfası', () => {
  it('sistemde kullanıcı yoksa ilk kurulum formunu gösterir', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { setupRequired: true }));
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByText('İlk Kurulum')).toBeTruthy());
    expect(screen.getByLabelText(/Kurulum Anahtarı/)).toBeTruthy();
    expect(screen.getByLabelText(/Parola/)).toBeTruthy();
  });

  it('kullanıcı varsa giriş formunu gösterir ve hatalı girişte mesajı yazar', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { setupRequired: false }));
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByLabelText(/E-posta/)).toBeTruthy());
    await userEvent.type(screen.getByLabelText(/E-posta/), 'a@b.com');
    await userEvent.type(screen.getByLabelText(/Parola/), 'yanlis');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'E-posta veya parola geçersiz' } }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Giriş Yap' }));
    await waitFor(() => expect(screen.getByText('E-posta veya parola geçersiz')).toBeTruthy());
  });
});

// ---------- Kullanıcılar sayfası ----------

import UsersPage from '@/app/(panel)/kullanicilar/page';

const adminUser = { id: 'u1', fullName: 'Firma Yöneticisi', email: 'admin@b.com', status: 'ACTIVE' as const, roles: ['FIRM_ADMIN'], createdAt: '2026-01-01T00:00:00.000Z' };
const workerUser = { id: 'u2', fullName: 'Saha İşçisi', email: 'isci@b.com', status: 'ACTIVE' as const, roles: ['FIELD_WORKER'], createdAt: '2026-01-02T00:00:00.000Z' };

describe('Kullanıcılar sayfası', () => {
  it('user.view izni olmayan kullanıcıya yetkisiz mesajı gösterir', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }));
    render(
      <AuthProvider>
        <UsersPage />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('Yetkisiz erişim')).toBeTruthy());
  });

  it('FIRM_ADMIN kullanıcı listesini ve yönetim aksiyonlarını görür', async () => {
    // boot: refresh
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { accessToken: 'tok', user: adminUser }),
    );
    // users list + roles (Promise.all)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { data: [adminUser, workerUser], meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 } }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: [
          { key: 'FIRM_ADMIN', label: 'Firma Yöneticisi', isSystem: true },
          { key: 'FIELD_WORKER', label: 'Saha Personeli', isSystem: true },
        ],
      }),
    );

    render(
      <AuthProvider>
        <UsersPage />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Saha İşçisi')).toBeTruthy());
    expect(screen.getByText('Firma Yöneticisi', { selector: 'td *' }) || screen.getByText('Firma Yöneticisi')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yeni Kullanıcı' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Devre Dışı Bırak' }).length).toBeGreaterThan(0);
  });
});
