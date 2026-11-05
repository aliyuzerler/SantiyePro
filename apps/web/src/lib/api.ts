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
import type { TaskDto, TaskDetailDto, TaskCommentDto } from '@santiyepro/contracts';

export type { UserDto, ProjectDto, ProjectDetailDto, SiteDto, ProjectMemberDto, TaskDto, TaskDetailDto, TaskCommentDto };

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

// ---------- Görevler (Faz 04) ----------

export interface TasksListResponse {
  data: TaskDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface TaskListParams {
  page?: number;
  projectId?: string;
  assigneeId?: string;
  status?: string;
  priority?: string;
  overdue?: boolean;
  search?: string;
  sort?: 'createdAt' | 'dueAt' | 'priority' | 'title';
  order?: 'asc' | 'desc';
}

export interface CreateTaskInput {
  projectId: string;
  siteId?: string;
  title: string;
  description?: string;
  priority?: string;
  assigneeId?: string;
  dueAt?: string;
  checklist?: Array<{ label: string; done?: boolean }>;
  fileRefs?: Array<{ id: string; name: string; mimeType?: string; sizeBytes?: number }>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  siteId?: string | null;
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  dueAt?: string | null;
  checklist?: Array<{ id: string; label: string; done: boolean }>;
  fileRefs?: Array<{ id: string; name: string; mimeType?: string; sizeBytes?: number }>;
  version?: number;
}

export const tasksApi = {
  list: (token: string, params: TaskListParams = {}) => {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', '20');
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.assigneeId) qs.set('assigneeId', params.assigneeId);
    if (params.status) qs.set('status', params.status);
    if (params.priority) qs.set('priority', params.priority);
    if (params.overdue) qs.set('overdue', 'true');
    if (params.search) qs.set('search', params.search);
    if (params.sort) qs.set('sort', params.sort);
    if (params.order) qs.set('order', params.order);
    return apiFetch<TasksListResponse>(`/tasks?${qs.toString()}`, { token });
  },
  get: (token: string, id: string) => apiFetch<TaskDetailDto>(`/tasks/${id}`, { token }),
  create: (token: string, input: CreateTaskInput) =>
    apiFetch<TaskDto>('/tasks', { method: 'POST', body: input, token }),
  update: (token: string, id: string, patch: UpdateTaskInput) =>
    apiFetch<TaskDto>(`/tasks/${id}`, { method: 'PATCH', body: patch, token }),
  comments: (token: string, id: string) =>
    apiFetch<{ data: TaskCommentDto[] }>(`/tasks/${id}/comments`, { token }),
  addComment: (token: string, id: string, body: string) =>
    apiFetch<TaskCommentDto>(`/tasks/${id}/comments`, { method: 'POST', body: { body }, token }),
};

// ---------- Günlük raporlar ve medya (Faz 05) ----------

import type { DailyReportDto, DailyReportDetailDto, MediaUploadUrlResponse, MediaDownloadUrlResponse } from '@santiyepro/contracts';
export type { DailyReportDto, DailyReportDetailDto, MediaUploadUrlResponse, MediaDownloadUrlResponse };

export interface DailyReportsListResponse {
  data: DailyReportDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface DailyReportListParams {
  page?: number;
  projectId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: 'createdAt' | 'reportDate';
  order?: 'asc' | 'desc';
}

/** API'den dönen göreli medya URL'ini API köküne çözer (tarayıcı için). */
export function resolveMediaUrl(relativePath: string): string {
  if (/^https?:\/\//.test(relativePath)) return relativePath;
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
  return `${origin}${relativePath}`;
}

export const mediaApi = {
  requestUploadUrl: (
    token: string,
    input: { filename: string; mimeType: string; sizeBytes: number; projectId: string },
  ) => apiFetch<MediaUploadUrlResponse>('/media/upload-url', { method: 'POST', body: input, token }),
  /** İmzalı PUT URL'ine ikili gövde yükler (auth header taşınmaz — imza yeterlidir). */
  uploadBinary: async (uploadUrl: string, file: Blob): Promise<void> => {
    const res = await fetch(resolveMediaUrl(uploadUrl), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new ApiError(res.status, 'VALIDATION_ERROR', payload.error?.message ?? 'Dosya yüklenemedi');
    }
  },
  complete: (token: string, mediaId: string) =>
    apiFetch<MediaDownloadUrlResponse>('/media/complete', { method: 'POST', body: { mediaId }, token }),
  downloadUrl: (token: string, mediaId: string) =>
    apiFetch<MediaDownloadUrlResponse>(`/media/${mediaId}/download-url`, { token }),
};

export interface WorkerRowInput {
  name: string;
  jobTitle?: string;
  workerCount: number;
  hours: string;
}

export interface SaveDailyReportInput {
  projectId: string;
  siteId?: string;
  reportDate: string;
  weather?: string;
  workSummary: string;
  workforceSummary?: string;
  equipmentSummary?: string;
  issues?: string;
  safetyNotes?: string;
  nextDayPlan?: string;
  workers?: WorkerRowInput[];
  mediaIds?: string[];
}

export const dailyReportsApi = {
  list: (token: string, params: DailyReportListParams = {}) => {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', '20');
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.status) qs.set('status', params.status);
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    if (params.sort) qs.set('sort', params.sort);
    if (params.order) qs.set('order', params.order);
    return apiFetch<DailyReportsListResponse>(`/daily-reports?${qs.toString()}`, { token });
  },
  get: (token: string, id: string) => apiFetch<DailyReportDetailDto>(`/daily-reports/${id}`, { token }),
  create: (token: string, input: SaveDailyReportInput) =>
    apiFetch<DailyReportDto>('/daily-reports', { method: 'POST', body: input, token }),
  update: (token: string, id: string, patch: Partial<SaveDailyReportInput>) =>
    apiFetch<DailyReportDto>(`/daily-reports/${id}`, { method: 'PATCH', body: patch, token }),
  submit: (token: string, id: string) =>
    apiFetch<DailyReportDto>(`/daily-reports/${id}/submit`, { method: 'POST', body: {}, token }),
  approve: (token: string, id: string) =>
    apiFetch<DailyReportDto>(`/daily-reports/${id}/approve`, { method: 'POST', body: {}, token }),
  reject: (token: string, id: string, reason: string) =>
    apiFetch<DailyReportDto>(`/daily-reports/${id}/reject`, { method: 'POST', body: { reason }, token }),
  reopen: (token: string, id: string) =>
    apiFetch<DailyReportDto>(`/daily-reports/${id}/reopen`, { method: 'POST', body: {}, token }),
};
