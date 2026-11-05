/**
 * ŞantiyePro mobil — API istemcisi (Faz 02).
 *
 * Kurallar (docs/07):
 * - Refresh token SecureStore'da tutulur; istek gövdesiyle taşınır (mobilde cookie yok).
 * - Hata zarfı contracts sözleşmesiyle çözülür: { error: { code, message, details? }, traceId }.
 * - Loglarda token/parola bulunmaz.
 */
import { tokenStorage } from './secure-store';
import type { ProjectDto, ProjectDetailDto, SiteDto, ProjectMemberDto, UserDto } from '@santiyepro/contracts';

export type { ProjectDto, ProjectDetailDto, SiteDto, ProjectMemberDto, UserDto };

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

async function request<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers['Authorization'] = `Bearer ${init.token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const payload = (await res.json().catch(() => ({}))) as T & ErrorEnvelope;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      payload.error?.code ?? 'INTERNAL_ERROR',
      payload.error?.message ?? 'Beklenmeyen bir hata oluştu',
      payload.error?.details,
    );
  }
  return payload;
}

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  phone?: string | null;
  status: 'ACTIVE' | 'DISABLED';
  roles: string[];
  createdAt: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken?: string;
  user: AuthUser;
}

export const authApi = {
  /** Giriş — başarılıysa token'lar SecureStore'a yazılır (AsyncStorage/SQLite kullanılmaz). */
  async login(email: string, password: string): Promise<LoginResult> {
    const result = await request<LoginResult>('/auth/login', { method: 'POST', body: { email, password } });
    if (result.refreshToken) {
      await tokenStorage.save({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    }
    return result;
  },

  /** Saklı access token ile /me doğrulaması. */
  async me(): Promise<AuthUser | null> {
    const token = await tokenStorage.loadAccessToken();
    if (!token) return null;
    try {
      return await request<AuthUser>('/auth/me', { token });
    } catch {
      return null;
    }
  },

  /** Refresh rotasyonu — gövdeyle taşınır, yeni çift SecureStore'a yazılır. */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const result = await request<LoginResult>('/auth/refresh', { method: 'POST', body: { refreshToken } });
    if (result.refreshToken) {
      await tokenStorage.save({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    }
    return result;
  },

  async logout(token?: string): Promise<void> {
    const stored = token ?? (await tokenStorage.loadAccessToken());
    if (stored) {
      // Sunucu tarafında refresh token iptali; hata olsa bile yerel oturum temizlenir.
      try {
        await request<void>('/auth/logout', { method: 'POST', body: {}, token: stored });
      } catch {
        // sessiz — logout uçları idempotent davranır
      }
    }
    await tokenStorage.clear();
  },
};

// ---------- Projeler ve şantiyeler (Faz 03) ----------

export interface ProjectsListResponse {
  data: ProjectDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ProjectListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  sort?: 'createdAt' | 'name' | 'code';
  order?: 'asc' | 'desc';
}

export const projectsApi = {
  /** Kapsamlı proje listesi — sunucu yalnızca erişim yetkisi olan projeleri döner. */
  list: async (token: string, params: ProjectListParams = {}): Promise<ProjectsListResponse> => {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', String(params.pageSize ?? 20));
    if (params.search) qs.set('search', params.search);
    if (params.status) qs.set('status', params.status);
    if (params.sort) qs.set('sort', params.sort);
    if (params.order) qs.set('order', params.order);
    return request<ProjectsListResponse>(`/projects?${qs.toString()}`, { token });
  },

  get: (token: string, id: string) => request<ProjectDetailDto>(`/projects/${id}`, { token }),

  create: (
    token: string,
    input: { code: string; name: string; clientName?: string; startDate?: string; plannedEndDate?: string; contractAmount?: string },
  ) => request<ProjectDto>('/projects', { method: 'POST', body: input, token }),

  update: (token: string, id: string, patch: Record<string, unknown>) =>
    request<ProjectDto>(`/projects/${id}`, { method: 'PATCH', body: patch, token }),

  createSite: (token: string, projectId: string, input: { name: string; address?: string }) =>
    request<SiteDto>(`/projects/${projectId}/sites`, { method: 'POST', body: input, token }),

  updateSite: (token: string, projectId: string, siteId: string, patch: Record<string, unknown>) =>
    request<SiteDto>(`/projects/${projectId}/sites/${siteId}`, { method: 'PATCH', body: patch, token }),

  addMember: (token: string, projectId: string, input: { userId: string; scopeRole: string }) =>
    request<ProjectMemberDto>(`/projects/${projectId}/members`, { method: 'POST', body: input, token }),

  updateMember: (token: string, projectId: string, memberId: string, patch: { scopeRole: string }) =>
    request<ProjectMemberDto>(`/projects/${projectId}/members/${memberId}`, { method: 'PATCH', body: patch, token }),

  removeMember: (token: string, projectId: string, memberId: string) =>
    request<void>(`/projects/${projectId}/members/${memberId}`, { method: 'DELETE', token }),
};

/** Üye ekleme diyaloğu için kullanıcı listesi (user.view izni gerektirir). */
export const usersApi = {
  list: (token: string) => request<{ data: UserDto[] }>('/users?page=1&pageSize=100', { token }),
};

// ---------- Görevler (Faz 04) ----------

import type { TaskDto, TaskDetailDto, TaskCommentDto } from '@santiyepro/contracts';
export type { TaskDto, TaskDetailDto, TaskCommentDto };

export interface TasksListResponse {
  data: TaskDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface TaskListParams {
  page?: number;
  pageSize?: number;
  projectId?: string;
  assigneeId?: string;
  status?: string;
  priority?: string;
  overdue?: boolean;
  search?: string;
  sort?: 'createdAt' | 'dueAt' | 'priority' | 'title';
  order?: 'asc' | 'desc';
}

export const tasksApi = {
  /** Kapsamlı görev listesi — 'me' oturum sahibine atananlar (Bana Atananlar). */
  list: async (token: string, params: TaskListParams = {}): Promise<TasksListResponse> => {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', String(params.pageSize ?? 20));
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.assigneeId) qs.set('assigneeId', params.assigneeId);
    if (params.status) qs.set('status', params.status);
    if (params.priority) qs.set('priority', params.priority);
    if (params.overdue) qs.set('overdue', 'true');
    if (params.search) qs.set('search', params.search);
    if (params.sort) qs.set('sort', params.sort);
    if (params.order) qs.set('order', params.order);
    return request<TasksListResponse>(`/tasks?${qs.toString()}`, { token });
  },

  get: (token: string, id: string) => request<TaskDetailDto>(`/tasks/${id}`, { token }),

  update: (
    token: string,
    id: string,
    patch: {
      title?: string;
      status?: string;
      priority?: string;
      assigneeId?: string | null;
      dueAt?: string | null;
      checklist?: Array<{ id: string; label: string; done: boolean }>;
      version?: number;
    },
  ) => request<TaskDto>(`/tasks/${id}`, { method: 'PATCH', body: patch, token }),

  addComment: (token: string, taskId: string, body: string) =>
    request<TaskCommentDto>(`/tasks/${taskId}/comments`, { method: 'POST', body: { body }, token }),
};

// ---------- Günlük raporlar ve medya (Faz 05) ----------

import type { DailyReportDto, DailyReportDetailDto, MediaUploadUrlResponse, MediaDownloadUrlResponse } from '@santiyepro/contracts';
export type { DailyReportDto, DailyReportDetailDto, MediaUploadUrlResponse, MediaDownloadUrlResponse };

/** API'den dönen göreli medya URL'ini API köküne çözer. */
export function resolveMediaUrl(relativePath: string): string {
  if (/^https?:\/\//.test(relativePath)) return relativePath;
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
  return `${origin}${relativePath}`;
}

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
  list: async (token: string, params: { projectId?: string; status?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', String(params.pageSize ?? 20));
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.status) qs.set('status', params.status);
    return request<{ data: DailyReportDto[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>(
      `/daily-reports?${qs.toString()}`,
      { token },
    );
  },
  get: (token: string, id: string) => request<DailyReportDetailDto>(`/daily-reports/${id}`, { token }),
  create: (token: string, input: SaveDailyReportInput) =>
    request<DailyReportDto>('/daily-reports', { method: 'POST', body: input, token }),
  update: (token: string, id: string, patch: Partial<SaveDailyReportInput>) =>
    request<DailyReportDto>(`/daily-reports/${id}`, { method: 'PATCH', body: patch, token }),
  submit: (token: string, id: string) =>
    request<DailyReportDto>(`/daily-reports/${id}/submit`, { method: 'POST', body: {}, token }),
  reopen: (token: string, id: string) =>
    request<DailyReportDto>(`/daily-reports/${id}/reopen`, { method: 'POST', body: {}, token }),
};

export const mediaApi = {
  requestUploadUrl: (
    token: string,
    input: { filename: string; mimeType: string; sizeBytes: number; projectId: string },
  ) => request<MediaUploadUrlResponse>('/media/upload-url', { method: 'POST', body: input, token }),

  /**
   * İmzalı PUT URL'ine yerel dosyayı ikili yükler (expo-file-system uploadAsync —
   * auth header gerekmez; imza yeterlidir). Başarısızlıkta hata fırlatır; kuyruk
   * çağıran tarafta işlenir (rapor metni sunucuda zaten taslak olarak güvende).
   */
  uploadBinary: async (uploadUrl: string, fileUri: string): Promise<void> => {
    const FileSystem = await import('expo-file-system');
    // SDK 58 yeni API: File sınıfı + upload() (legacy top-level uploadAsync kaldırıldı).
    const file = new FileSystem.File(fileUri);
    const res = await file.upload(resolveMediaUrl(uploadUrl), {
      httpMethod: 'PUT',
      uploadType: FileSystem.UploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    if (res.status >= 400) {
      throw new ApiError(res.status, 'VALIDATION_ERROR', 'Dosya yüklenemedi (kuyruğa alındı)');
    }
  },

  complete: (token: string, mediaId: string) =>
    request<MediaDownloadUrlResponse>('/media/complete', { method: 'POST', body: { mediaId }, token }),
};

// ---------- Personel ve puantaj (Faz 06) ----------

import type {
  AttendanceRecordDto,
  BulkAttendancePreviewResponse,
  PersonnelDto,
} from '@santiyepro/contracts';
export type { AttendanceRecordDto, BulkAttendancePreviewResponse, PersonnelDto };

export interface PersonnelListResponse {
  data: PersonnelDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export const personnelApi = {
  list: (token: string, params: { search?: string; status?: string } = {}) => {
    const qs = new URLSearchParams();
    qs.set('page', '1');
    qs.set('pageSize', '100');
    if (params.search) qs.set('search', params.search);
    if (params.status) qs.set('status', params.status);
    return request<PersonnelListResponse>(`/personnel?${qs.toString()}`, { token });
  },
};

export interface AttendanceListResponse {
  data: AttendanceRecordDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface AttendanceStatusesResponse {
  statuses: string[];
  labels: Record<string, string>;
}

export const attendanceApi = {
  statuses: (token: string) => request<AttendanceStatusesResponse>('/attendance/statuses', { token }),
  list: (token: string, params: { projectId?: string; workDate?: string; personnelId?: string; shiftKey?: string } = {}) => {
    const qs = new URLSearchParams();
    qs.set('page', '1');
    qs.set('pageSize', '100');
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.workDate) qs.set('workDate', params.workDate);
    if (params.personnelId) qs.set('personnelId', params.personnelId);
    if (params.shiftKey) qs.set('shiftKey', params.shiftKey);
    return request<AttendanceListResponse>(`/attendance?${qs.toString()}`, { token });
  },
  create: (
    token: string,
    input: {
      projectId: string;
      personnelId: string;
      workDate: string;
      shiftKey?: string;
      status: string;
      note?: string | null;
      clientMutationId?: string;
    },
  ) => request<{ record: AttendanceRecordDto; replayed: boolean }>('/attendance', { method: 'POST', body: input, token }),
  update: (token: string, id: string, patch: { status?: string; note?: string | null }) =>
    request<AttendanceRecordDto>(`/attendance/${id}`, { method: 'PATCH', body: patch, token }),
  bulkPreview: (
    token: string,
    input: { projectId: string; workDate: string; shiftKey?: string; status: string; personnelIds: string[] },
  ) => request<BulkAttendancePreviewResponse>('/attendance/bulk/preview', { method: 'POST', body: input, token }),
  bulkConfirm: (
    token: string,
    input: { projectId: string; workDate: string; shiftKey?: string; status: string; personnelIds: string[]; confirm: true },
  ) => request<BulkAttendancePreviewResponse>('/attendance/bulk', { method: 'POST', body: input, token }),
};
