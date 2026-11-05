/**
 * ŞantiyePro web — API istemcisi.
 *
 * Kurallar (docs/07):
 * - Refresh token HttpOnly cookie'de taşınır → credentials: 'include' zorunlu.
 * - Access token yalnızca bellekte tutulur; kalıcı depolamada saklanmaz.
 * - Hata yanıtları contracts zarfından çözülür: { error: { code, message, details? }, traceId }.
 */
import type { UserDto } from '@santiyepro/contracts';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly traceId?: string;

  constructor(status: number, code: string, message: string, details?: unknown, traceId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.traceId = traceId;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
  traceId?: string;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (res.status === 204) return undefined as T;

  const payload = (await res.json().catch(() => ({}))) as (T & ErrorEnvelope) | ErrorEnvelope;
  if (!res.ok) {
    const envelope = payload as ErrorEnvelope;
    throw new ApiError(
      res.status,
      envelope.error?.code ?? 'INTERNAL_ERROR',
      envelope.error?.message ?? 'Beklenmeyen bir hata oluştu',
      envelope.error?.details,
      envelope.traceId,
    );
  }
  return payload as T;
}

// ---------- Auth uçları ----------

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  user: UserDto;
}

export const authApi = {
  setupStatus: () => apiFetch<{ setupRequired: boolean }>('/auth/setup-status'),
  bootstrap: (input: { setupToken: string; fullName: string; email: string; password: string; phone?: string }) =>
    apiFetch<{ message: string }>('/auth/bootstrap', { method: 'POST', body: input }),
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } }),
  /** Cookie tabanlı yenileme — başarısızsa 401 (oturum kapalı). */
  refresh: () => apiFetch<{ accessToken: string; user: UserDto }>('/auth/refresh', { method: 'POST', body: {} }),
  logout: (token: string) => apiFetch<void>('/auth/logout', { method: 'POST', body: {}, token }),
  me: (token: string) => apiFetch<UserDto>('/auth/me', { token }),
};

// ---------- Kullanıcı yönetimi ----------

export interface UsersListResponse {
  data: UserDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface RoleDto {
  key: string;
  label: string;
  isSystem: boolean;
}

export const usersApi = {
  list: (token: string, page = 1) => apiFetch<UsersListResponse>(`/users?page=${page}&pageSize=20`, { token }),
  roles: (token: string) => apiFetch<{ data: RoleDto[] }>('/roles', { token }),
  create: (
    token: string,
    input: { fullName: string; email: string; password: string; roles: string[]; phone?: string },
  ) => apiFetch<UserDto>('/users', { method: 'POST', body: input, token }),
  update: (token: string, id: string, patch: { status?: 'ACTIVE' | 'DISABLED'; roles?: string[]; fullName?: string }) =>
    apiFetch<UserDto>(`/users/${id}`, { method: 'PATCH', body: patch, token }),
};
