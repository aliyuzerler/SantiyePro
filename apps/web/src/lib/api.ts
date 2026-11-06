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
import type {
  AuditFacets,
  AuditLogResponse,
  AttendanceReportResponse,
  BackupStatus,
  ClaimSummaryResponse,
  DailyReportSummaryResponse,
  ExpenseSummaryResponse,
  ProjectOverviewResponse,
  ReportExportFormat,
  ReportKey,
  StockBalanceResponse,
  StockMovementResponse,
  TaskStatusResponse,
} from '@santiyepro/contracts';

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
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
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
  pageSize?: number;
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
    qs.set('pageSize', String(params.pageSize ?? 20));
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


// ---------- Gider ve hakediş (Faz 08) ----------

import type {
  ClaimCalculationDto,
  ContractItemDto,
  ExpenseCategoryDto,
  ExpenseDto,
  ProgressClaimDto,
} from '@santiyepro/contracts';
export type {
  ClaimCalculationDto,
  ContractItemDto,
  ExpenseCategoryDto,
  ExpenseDto,
  ProgressClaimDto,
};

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ExpenseListParams {
  page?: number;
  pageSize?: number;
  projectId?: string;
  categoryId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  sort?: 'expenseDate' | 'createdAt' | 'amount';
  order?: 'asc' | 'desc';
}

export interface SaveExpenseInput {
  projectId: string;
  categoryId: string;
  vendorName?: string;
  description: string;
  amount: string;
  currency?: string;
  taxRate?: string | null;
  expenseDate: string;
  receiptMediaId?: string | null;
}

export interface ClaimLineInput {
  contractItemId: string;
  previousQuantity: string;
  periodQuantity: string;
}

export interface SaveClaimInput {
  projectId: string;
  claimNo: number;
  periodStart: string;
  periodEnd: string;
  notes?: string;
  deductionTotal?: string;
  lines: ClaimLineInput[];
}

export const financeApi = {
  // Kategoriler
  listCategories: (token: string, params: { isActive?: 'true' | 'false' } = {}) => {
    const qs = new URLSearchParams();
    if (params.isActive) qs.set('isActive', params.isActive);
    const query = qs.toString();
    return apiFetch<{ data: ExpenseCategoryDto[] }>(`/expenses/categories${query ? `?${query}` : ''}`, { token });
  },
  createCategory: (token: string, name: string) =>
    apiFetch<ExpenseCategoryDto>('/expenses/categories', { method: 'POST', body: { name }, token }),

  // Giderler
  listExpenses: (token: string, params: ExpenseListParams) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return apiFetch<PaginatedResponse<ExpenseDto>>(`/expenses?${qs.toString()}`, { token });
  },
  createExpense: (token: string, input: SaveExpenseInput) =>
    apiFetch<ExpenseDto>('/expenses', { method: 'POST', body: input, token }),
  updateExpense: (token: string, id: string, input: Partial<SaveExpenseInput>) =>
    apiFetch<ExpenseDto>(`/expenses/${id}`, { method: 'PATCH', body: input, token }),
  deleteExpense: (token: string, id: string) =>
    apiFetch<{ id: string; deleted: true }>(`/expenses/${id}`, { method: 'DELETE', token }),
  submitExpense: (token: string, id: string) =>
    apiFetch<ExpenseDto>(`/expenses/${id}/submit`, { method: 'POST', token }),
  approveExpense: (token: string, id: string) =>
    apiFetch<ExpenseDto>(`/expenses/${id}/approve`, { method: 'POST', token }),
  rejectExpense: (token: string, id: string, reason: string) =>
    apiFetch<ExpenseDto>(`/expenses/${id}/reject`, { method: 'POST', body: { reason }, token }),

  // Sözleşme kalemleri
  listContractItems: (token: string, projectId: string, params: { page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams({ projectId });
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    return apiFetch<PaginatedResponse<ContractItemDto>>(`/progress-claims/contract-items?${qs.toString()}`, { token });
  },
  createContractItem: (
    token: string,
    input: { projectId: string; code?: string; description: string; unit: string; contractQuantity: string; unitPrice: string; currency?: string; sortOrder?: number },
  ) => apiFetch<ContractItemDto>('/progress-claims/contract-items', { method: 'POST', body: input, token }),
  updateContractItem: (token: string, id: string, input: { unitPrice?: string; description?: string; contractQuantity?: string }) =>
    apiFetch<ContractItemDto>(`/progress-claims/contract-items/${id}`, { method: 'PATCH', body: input, token }),

  // Hakedişler
  listClaims: (token: string, projectId: string, params: { status?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams({ projectId });
    if (params.status) qs.set('status', params.status);
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    return apiFetch<PaginatedResponse<ProgressClaimDto>>(`/progress-claims?${qs.toString()}`, { token });
  },
  getClaim: (token: string, id: string) =>
    apiFetch<ProgressClaimDto>(`/progress-claims/${id}`, { token }),
  createClaim: (token: string, input: SaveClaimInput) =>
    apiFetch<ProgressClaimDto>('/progress-claims', { method: 'POST', body: input, token }),
  replaceClaimLines: (token: string, id: string, lines: ClaimLineInput[]) =>
    apiFetch<ProgressClaimDto>(`/progress-claims/${id}/lines`, { method: 'PUT', body: { lines }, token }),
  deleteClaim: (token: string, id: string) =>
    apiFetch<{ id: string; deleted: true }>(`/progress-claims/${id}`, { method: 'DELETE', token }),
  calculateClaim: (token: string, id: string) =>
    apiFetch<ClaimCalculationDto>(`/progress-claims/${id}/calculate`, { method: 'POST', token }),
  submitClaim: (token: string, id: string) =>
    apiFetch<ProgressClaimDto>(`/progress-claims/${id}/submit`, { method: 'POST', token }),
  approveClaim: (token: string, id: string) =>
    apiFetch<ProgressClaimDto>(`/progress-claims/${id}/approve`, { method: 'POST', token }),
  rejectClaim: (token: string, id: string, reason: string) =>
    apiFetch<ProgressClaimDto>(`/progress-claims/${id}/reject`, { method: 'POST', body: { reason }, token }),
  cancelClaim: (token: string, id: string, reason: string) =>
    apiFetch<ProgressClaimDto>(`/progress-claims/${id}/cancel`, { method: 'POST', body: { reason }, token }),
};

// ---------- Hakediş uçları sonu ----------

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

// ---------- Personel ve puantaj (Faz 06) ----------

import type {
  AttendanceRecordDto,
  AttendanceSummaryResponse,
  BulkAttendancePreviewResponse,
  OrgSettingsDto,
  PersonnelDto,
} from '@santiyepro/contracts';
export type {
  AttendanceRecordDto,
  AttendanceSummaryResponse,
  BulkAttendancePreviewResponse,
  OrgSettingsDto,
  PersonnelDto,
};

export interface PersonnelListResponse {
  data: PersonnelDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export const personnelApi = {
  list: (token: string, params: { page?: number; search?: string; status?: string } = {}) => {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', '100');
    if (params.search) qs.set('search', params.search);
    if (params.status) qs.set('status', params.status);
    return apiFetch<PersonnelListResponse>(`/personnel?${qs.toString()}`, { token });
  },
  create: (
    token: string,
    input: {
      employeeCode?: string;
      fullName: string;
      phone?: string;
      jobTitle?: string;
      companyOrSubcontractor?: string;
    },
  ) => apiFetch<PersonnelDto>('/personnel', { method: 'POST', body: input, token }),
  update: (
    token: string,
    id: string,
    patch: {
      employeeCode?: string | null;
      fullName?: string;
      phone?: string | null;
      jobTitle?: string | null;
      companyOrSubcontractor?: string | null;
      status?: 'ACTIVE' | 'PASSIVE';
    },
  ) => apiFetch<PersonnelDto>(`/personnel/${id}`, { method: 'PATCH', body: patch, token }),
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
  statuses: (token: string) => apiFetch<AttendanceStatusesResponse>('/attendance/statuses', { token }),
  orgSettings: (token: string) => apiFetch<OrgSettingsDto>('/org/settings', { token }),
  list: (
    token: string,
    params: { projectId?: string; workDate?: string; personnelId?: string; shiftKey?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    qs.set('page', '1');
    qs.set('pageSize', '100');
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.workDate) qs.set('workDate', params.workDate);
    if (params.personnelId) qs.set('personnelId', params.personnelId);
    if (params.shiftKey) qs.set('shiftKey', params.shiftKey);
    return apiFetch<AttendanceListResponse>(`/attendance?${qs.toString()}`, { token });
  },
  create: (
    token: string,
    input: {
      projectId: string;
      siteId?: string | null;
      personnelId: string;
      workDate: string;
      shiftKey?: string;
      status: string;
      checkInAt?: string | null;
      checkOutAt?: string | null;
      workedMinutes?: number | null;
      note?: string | null;
    },
  ) => apiFetch<{ record: AttendanceRecordDto; replayed: boolean }>('/attendance', { method: 'POST', body: input, token }),
  update: (
    token: string,
    id: string,
    patch: {
      siteId?: string | null;
      status?: string;
      checkInAt?: string | null;
      checkOutAt?: string | null;
      workedMinutes?: number | null;
      note?: string | null;
    },
  ) => apiFetch<AttendanceRecordDto>(`/attendance/${id}`, { method: 'PATCH', body: patch, token }),
  bulkPreview: (
    token: string,
    input: {
      projectId: string;
      workDate: string;
      shiftKey?: string;
      status: string;
      personnelIds: string[];
      note?: string | null;
    },
  ) => apiFetch<BulkAttendancePreviewResponse>('/attendance/bulk/preview', { method: 'POST', body: input, token }),
  bulkConfirm: (
    token: string,
    input: {
      projectId: string;
      workDate: string;
      shiftKey?: string;
      status: string;
      personnelIds: string[];
      note?: string | null;
      confirm: true;
    },
  ) => apiFetch<BulkAttendancePreviewResponse>('/attendance/bulk', { method: 'POST', body: input, token }),
  summary: (token: string, projectId: string, dateFrom: string, dateTo: string) =>
    apiFetch<AttendanceSummaryResponse>(
      `/attendance/summary?projectId=${projectId}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      { token },
    ),
};

// ---------- Depo, malzeme ve stok hareketleri (Faz 07) ----------

import type {
  MaterialDto,
  StockBalanceDto,
  StockMovementDto,
  WarehouseDto,
} from '@santiyepro/contracts';
export type { MaterialDto, StockBalanceDto, StockMovementDto, WarehouseDto };

export interface InventoryListResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface CreateMovementInput {
  type: 'IN' | 'OUT' | 'TRANSFER' | 'RETURN' | 'ADJUSTMENT';
  materialId: string;
  warehouseId: string;
  targetWarehouseId?: string | null;
  projectId?: string | null;
  quantity: string;
  unit?: string;
  unitCost?: string | null;
  referenceType?: 'PURCHASE' | 'DAILY_REPORT' | 'TASK' | 'OTHER';
  referenceId?: string;
  note?: string;
  occurredAt?: string;
  clientMutationId?: string;
}

export interface MovementListParams {
  projectId?: string;
  warehouseId?: string;
  materialId?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export const inventoryApi = {
  // Depolar
  warehouses: (token: string, params: { projectId?: string; kurumOnly?: string; search?: string } = {}) => {
    const qs = new URLSearchParams();
    qs.set('page', '1');
    qs.set('pageSize', '100');
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.kurumOnly) qs.set('kurumOnly', params.kurumOnly);
    if (params.search) qs.set('search', params.search);
    return apiFetch<InventoryListResponse<WarehouseDto>>(`/inventory/warehouses?${qs.toString()}`, { token });
  },
  createWarehouse: (
    token: string,
    input: { projectId?: string | null; name: string; location?: string },
  ) => apiFetch<WarehouseDto>('/inventory/warehouses', { method: 'POST', body: input, token }),
  updateWarehouse: (token: string, id: string, patch: { name?: string; location?: string | null; isActive?: boolean }) =>
    apiFetch<WarehouseDto>(`/inventory/warehouses/${id}`, { method: 'PATCH', body: patch, token }),

  // Malzemeler
  materials: (token: string, params: { search?: string; isActive?: string } = {}) => {
    const qs = new URLSearchParams();
    qs.set('page', '1');
    qs.set('pageSize', '100');
    if (params.search) qs.set('search', params.search);
    if (params.isActive) qs.set('isActive', params.isActive);
    return apiFetch<InventoryListResponse<MaterialDto>>(`/inventory/materials?${qs.toString()}`, { token });
  },
  createMaterial: (
    token: string,
    input: { code?: string; name: string; category?: string; unit?: string; minStock?: string },
  ) => apiFetch<MaterialDto>('/inventory/materials', { method: 'POST', body: input, token }),
  updateMaterial: (
    token: string,
    id: string,
    patch: { code?: string | null; name?: string; category?: string | null; unit?: string; minStock?: string | null; isActive?: boolean },
  ) => apiFetch<MaterialDto>(`/inventory/materials/${id}`, { method: 'PATCH', body: patch, token }),

  // Bakiye (stok kartları)
  balances: (
    token: string,
    params: { warehouseId?: string; materialId?: string; projectId?: string; search?: string; lowStock?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.warehouseId) qs.set('warehouseId', params.warehouseId);
    if (params.materialId) qs.set('materialId', params.materialId);
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.search) qs.set('search', params.search);
    if (params.lowStock) qs.set('lowStock', params.lowStock);
    return apiFetch<InventoryListResponse<StockBalanceDto>>(`/inventory/balances?${qs.toString()}`, { token });
  },

  // Hareketler
  movements: (token: string, params: MovementListParams = {}) => {
    const qs = new URLSearchParams();
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', String(params.pageSize ?? 20));
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.warehouseId) qs.set('warehouseId', params.warehouseId);
    if (params.materialId) qs.set('materialId', params.materialId);
    if (params.type) qs.set('type', params.type);
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    if (params.search) qs.set('search', params.search);
    return apiFetch<InventoryListResponse<StockMovementDto>>(`/inventory/movements?${qs.toString()}`, { token });
  },
  createMovement: (token: string, input: CreateMovementInput) =>
    apiFetch<{ movement: StockMovementDto; replayed: boolean }>('/inventory/movements', {
      method: 'POST',
      body: input,
      token,
    }),
  reverseMovement: (token: string, id: string, reason: string) =>
    apiFetch<{ movement: StockMovementDto }>(`/inventory/movements/${id}/reverse`, {
      method: 'POST',
      body: { reason },
      token,
    }),
};

// ---------- Raporlar, denetim günlüğü ve yedekleme (Faz 10) ----------

export type PaginatedReportResponse<T> = {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
};

export interface ReportFilterParams {
  dateFrom?: string;
  dateTo?: string;
  projectId?: string;
  siteId?: string;
  status?: string;
  /** Yalnızca stok bakiyesi raporu: 'true' → kritik altı kartlar. */
  belowMin?: string;
  /** Yalnızca stok hareketleri raporu: hareket tipi (IN/OUT/TRANSFER/...). */
  type?: string;
  page?: number;
  pageSize?: number;
}

function reportQueryString(params: ReportFilterParams): string {
  const qs = new URLSearchParams();
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  if (params.projectId) qs.set('projectId', params.projectId);
  if (params.siteId) qs.set('siteId', params.siteId);
  if (params.status) qs.set('status', params.status);
  if (params.belowMin) qs.set('belowMin', params.belowMin);
  if (params.type) qs.set('type', params.type);
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  return qs.toString();
}

export const reportsApi = {
  overview: (token: string, params: ReportFilterParams = {}) =>
    apiFetch<ProjectOverviewResponse>(`/reports/project-overview?${reportQueryString(params)}`, { token }),
  dailyReports: (token: string, params: ReportFilterParams = {}) =>
    apiFetch<DailyReportSummaryResponse>(`/reports/daily-reports?${reportQueryString(params)}`, { token }),
  attendance: (token: string, params: ReportFilterParams = {}) =>
    apiFetch<AttendanceReportResponse>(`/reports/attendance?${reportQueryString(params)}`, { token }),
  stockBalance: (token: string, params: ReportFilterParams = {}) =>
    apiFetch<StockBalanceResponse>(`/reports/stock/balance?${reportQueryString(params)}`, { token }),
  stockMovements: (token: string, params: ReportFilterParams = {}) =>
    apiFetch<StockMovementResponse>(`/reports/stock/movements?${reportQueryString(params)}`, { token }),
  expenseSummary: (token: string, params: ReportFilterParams = {}) =>
    apiFetch<ExpenseSummaryResponse>(`/reports/expenses?${reportQueryString(params)}`, { token }),
  claimSummary: (token: string, params: ReportFilterParams = {}) =>
    apiFetch<ClaimSummaryResponse>(`/reports/claims?${reportQueryString(params)}`, { token }),
  taskStatus: (token: string, params: ReportFilterParams = {}) =>
    apiFetch<TaskStatusResponse>(`/reports/tasks?${reportQueryString(params)}`, { token }),

  /**
   * Rapor dosyasını indirir (PDF/XLSX). Binary yanıt olduğu için apiFetch
   * yerine doğrudan fetch kullanır; hata zarfı yine contracts'tan çözülür.
   * Sunucu her export için audit log üretir (X-Audit-Log-Id başlığı).
   */
  exportReport: async (
    token: string,
    key: ReportKey,
    format: ReportExportFormat,
    params: Omit<ReportFilterParams, 'page' | 'pageSize'> = {},
  ): Promise<{ blob: Blob; filename: string; auditLogId: string; rowCount: number }> => {
    const qs = new URLSearchParams();
    qs.set('format', format);
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.siteId) qs.set('siteId', params.siteId);
    if (params.status) qs.set('status', params.status);

    const res = await fetch(`${API_BASE_URL}/reports/${key}/export?${qs.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
    if (!res.ok) {
      const envelope = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      throw new ApiError(res.status, envelope.error?.code ?? 'INTERNAL_ERROR', envelope.error?.message ?? 'Dışa aktarma başarısız');
    }
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    return {
      blob: await res.blob(),
      filename: match?.[1] ?? `santiyepro-${key}.${format}`,
      auditLogId: res.headers.get('X-Audit-Log-Id') ?? '',
      rowCount: Number(res.headers.get('X-Row-Count') ?? '0'),
    };
  },
};

export interface AuditLogListParams {
  entityType?: string;
  action?: string;
  actorUserId?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export const auditApi = {
  logs: (token: string, params: AuditLogListParams = {}) => {
    const qs = new URLSearchParams();
    if (params.entityType) qs.set('entityType', params.entityType);
    if (params.action) qs.set('action', params.action);
    if (params.actorUserId) qs.set('actorUserId', params.actorUserId);
    if (params.entityId) qs.set('entityId', params.entityId);
    if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params.dateTo) qs.set('dateTo', params.dateTo);
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', String(params.pageSize ?? 20));
    return apiFetch<AuditLogResponse>(`/audit/logs?${qs.toString()}`, { token });
  },
  facets: (token: string) => apiFetch<AuditFacets>('/audit/facets', { token }),
};

export const orgApi = {
  settings: (token: string) => apiFetch<{ attendanceCustomStatuses: { key: string; label: string }[] }>('/org/settings', { token }),
  updateSettings: (
    token: string,
    body: { attendanceCustomStatuses: { key: string; label: string }[] },
  ) => apiFetch<{ attendanceCustomStatuses: { key: string; label: string }[] }>('/org/settings', { method: 'PATCH', body, token }),
  /** Yedekleme durumu — backup script status.json (salt okunur, docs/10). */
  backupStatus: (token: string) => apiFetch<BackupStatus>('/org/backup-status', { token }),
};
