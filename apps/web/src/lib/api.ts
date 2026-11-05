/**
 * ŞantiyePro web — API istemcisi.
 *
 * Kurallar (docs/07):
 * - Refresh token HttpOnly cookie'de taşınır → credentials: 'include' zorunlu.
 * - Access token yalnızca bellekte tutulur; kalıcı depolamada saklanmaz.
 * - Hata yanıtları contracts zarfından çözülür: { error: { code, message, details? }, traceId }.
 */
import type { UserDto } from '@santiyepro/contracts';
import type { ProjectDto, ProjectDetailDto, SiteDto, ProjectMemberDto } from '@santiyepro/contracts';

export type { UserDto, ProjectDto, ProjectDetailDto, SiteDto, ProjectMemberDto };

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
  list: (token: string, page = 1) => apiFetch<UsersListResponse>(`/users?page=${page}&pageSize=100`, { token }),
  roles: (token: string) => apiFetch<{ data: RoleDto[] }>('/roles', { token }),
  create: (
    token: string,
    input: { fullName: string; email: string; password: string; roles: string[]; phone?: string },
  ) => apiFetch<UserDto>('/users', { method: 'POST', body: input, token }),
  update: (token: string, id: string, patch: { status?: 'ACTIVE' | 'DISABLED'; roles?: string[]; fullName?: string }) =>
    apiFetch<UserDto>(`/users/${id}`, { method: 'PATCH', body: patch, token }),
};

// ---------- Projeler ve şantiyeler (Faz 03) ----------

export interface ProjectsListResponse {
  data: ProjectDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ProjectListParams {
  page?: number;
  search?: string;
  status?: string;
  sort?: 'createdAt' | 'name' | 'code';
  order?: 'asc' | 'desc';
}

export interface MemberInput {
  userId: string;
  scopeRole: string;
}

export const projectsApi = {
  list: (token: string, params: ProjectListParams = {}) => {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', '20');
    if (params.search) qs.set('search', params.search);
    if (params.status) qs.set('status', params.status);
    if (params.sort) qs.set('sort', params.sort);
    if (params.order) qs.set('order', params.order);
    return apiFetch<ProjectsListResponse>(`/projects?${qs.toString()}`, { token });
  },
  get: (token: string, id: string) => apiFetch<ProjectDetailDto>(`/projects/${id}`, { token }),
  create: (
    token: string,
    input: {
      code: string;
      name: string;
      clientName?: string;
      description?: string;
      address?: string;
      startDate?: string;
      plannedEndDate?: string;
      contractAmount?: string;
      managerId?: string;
    },
  ) => apiFetch<ProjectDto>('/projects', { method: 'POST', body: input, token }),
  update: (
    token: string,
    id: string,
    patch: {
      name?: string;
      clientName?: string | null;
      description?: string | null;
      address?: string | null;
      startDate?: string | null;
      plannedEndDate?: string | null;
      actualEndDate?: string | null;
      contractAmount?: string | null;
      status?: string;
      managerId?: string | null;
    },
  ) => apiFetch<ProjectDto>(`/projects/${id}`, { method: 'PATCH', body: patch, token }),
  sites: (token: string, projectId: string) => apiFetch<{ data: SiteDto[] }>(`/projects/${projectId}/sites`, { token }),
  createSite: (token: string, projectId: string, input: { name: string; address?: string }) =>
    apiFetch<SiteDto>(`/projects/${projectId}/sites`, { method: 'POST', body: input, token }),
  updateSite: (token: string, projectId: string, siteId: string, patch: { status?: string; name?: string }) =>
    apiFetch<SiteDto>(`/projects/${projectId}/sites/${siteId}`, { method: 'PATCH', body: patch, token }),
  members: (token: string, projectId: string) =>
    apiFetch<{ data: ProjectMemberDto[] }>(`/projects/${projectId}/members`, { token }),
  addMember: (token: string, projectId: string, input: MemberInput) =>
    apiFetch<ProjectMemberDto>(`/projects/${projectId}/members`, { method: 'POST', body: input, token }),
  updateMember: (token: string, projectId: string, memberId: string, patch: { scopeRole: string }) =>
    apiFetch<ProjectMemberDto>(`/projects/${projectId}/members/${memberId}`, { method: 'PATCH', body: patch, token }),
  removeMember: (token: string, projectId: string, memberId: string) =>
    apiFetch<void>(`/projects/${projectId}/members/${memberId}`, { method: 'DELETE', token }),
};
