/**
 * ŞantiyePro — Proje / Şantiye / Proje Üyesi sözleşmeleri (Faz 03).
 *
 * Kurallar (prompts/phase-03-development.md, docs/04, docs/06):
 * - Proje kodu kurulum içinde benzersizdir (DB unique + 409 CONFLICT).
 * - Silme yok: arşiv = status ARCHIVED; bağlı kayıtlara dokunulmaz.
 * - Tarihler timezone-safe: yalnızca tarih içeren alanlar YYYY-MM-DD taşınır,
 *   sunucuda PostgreSQL DATE kolonunda saklanır.
 * - Para alanları decimal string olarak taşınır (floating point yasak, docs/05).
 * - Kullanıcı yalnızca erişim kapsamındaki projeleri görür: FIRM_ADMIN tümü,
 *   diğer roller yalnızca ProjectMember olduğu projeler (kapsam dışı → 404).
 */
import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

// ---------- Proje durumu ----------

export const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: 'Planlanıyor',
  ACTIVE: 'Aktif',
  ON_HOLD: 'Beklemede',
  COMPLETED: 'Tamamlandı',
  ARCHIVED: 'Arşivlendi',
};

export const projectStatusSchema = z.enum(PROJECT_STATUSES);

/**
 * Durum geçiş matrisi — geçersiz geçiş 400 VALIDATION_ERROR döner.
 * COMPLETED yalnızca arşivlenebilir; ARCHIVED yalnızca yeniden aktifleşir.
 */
const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  PLANNING: ['ACTIVE', 'ON_HOLD', 'ARCHIVED'],
  ACTIVE: ['ON_HOLD', 'COMPLETED', 'ARCHIVED'],
  ON_HOLD: ['ACTIVE', 'COMPLETED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: ['ACTIVE'],
};

export function canTransitionProjectStatus(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return false;
  return PROJECT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------- Şantiye durumu ----------

export const SITE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  ACTIVE: 'Aktif',
  INACTIVE: 'Pasif',
};

export const siteStatusSchema = z.enum(SITE_STATUSES);

// ---------- Proje içi rol (scopeRole) ----------

export const PROJECT_SCOPE_ROLES = [
  'MANAGER',
  'CHIEF',
  'TECH_OFFICE',
  'WAREHOUSE',
  'ACCOUNTING',
  'WORKER',
] as const;
export type ProjectScopeRole = (typeof PROJECT_SCOPE_ROLES)[number];

export const PROJECT_SCOPE_ROLE_LABELS: Record<ProjectScopeRole, string> = {
  MANAGER: 'Proje Yöneticisi',
  CHIEF: 'Şantiye Şefi',
  TECH_OFFICE: 'Teknik Ofis',
  WAREHOUSE: 'Depo Sorumlusu',
  ACCOUNTING: 'Muhasebe',
  WORKER: 'Saha Personeli',
};

export const projectScopeRoleSchema = z.enum(PROJECT_SCOPE_ROLES);

// ---------- Ortak alan şemaları ----------

/** Yalnızca tarih (timezone-safe): YYYY-MM-DD. Saat/zaman dilimi bilgisi taşınmaz. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-MM-DD biçiminde olmalıdır');
export type DateOnly = z.infer<typeof dateOnlySchema>;

/** Decimal string: en fazla 16 hane + 2 ondalık (DB DECIMAL(18,2) ile uyumlu). */
export const decimalStringSchema = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, 'Tutar sayısal ve en fazla 2 ondalıklı olmalıdır');

export const currencySchema = z.string().length(3).regex(/^[A-Z]{3}$/, 'Para birimi 3 harfli ISO kodu olmalıdır');

// ---------- DTO'lar ----------

export const projectSummarySchema = z.object({
  id: z.string(),
  fullName: z.string(),
});

export const projectDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  clientName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  startDate: dateOnlySchema.nullable().optional(),
  plannedEndDate: dateOnlySchema.nullable().optional(),
  actualEndDate: dateOnlySchema.nullable().optional(),
  /** DECIMAL(18,2) → API'de daima string (docs/05). */
  contractAmount: z.string().nullable().optional(),
  currency: currencySchema,
  status: projectStatusSchema,
  manager: projectSummarySchema.nullable().optional(),
  siteCount: z.number().int().min(0),
  memberCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectDto = z.infer<typeof projectDtoSchema>;

export const siteDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  address: z.string().nullable().optional(),
  status: siteStatusSchema,
  createdAt: z.string(),
});
export type SiteDto = z.infer<typeof siteDtoSchema>;

export const projectMemberDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  fullName: z.string(),
  email: z.string(),
  scopeRole: projectScopeRoleSchema,
  isManager: z.boolean(),
  createdAt: z.string(),
});
export type ProjectMemberDto = z.infer<typeof projectMemberDtoSchema>;

export const projectDetailDtoSchema = projectDtoSchema.extend({
  sites: z.array(siteDtoSchema),
  members: z.array(projectMemberDtoSchema),
});
export type ProjectDetailDto = z.infer<typeof projectDetailDtoSchema>;

// ---------- Liste sorgusu ----------

export const projectSortFieldsSchema = z.enum(['createdAt', 'name', 'code']);
export const sortDirectionSchema = z.enum(['asc', 'desc']);

export const projectListQuerySchema = paginationQuerySchema.extend({
  search: z.string().max(120).optional(),
  status: projectStatusSchema.optional(),
  managerId: z.string().min(1).max(64).optional(),
  sort: projectSortFieldsSchema.default('createdAt'),
  order: sortDirectionSchema.default('desc'),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

// ---------- Oluşturma / güncelleme ----------

export const createProjectRequestSchema = z
  .object({
    code: z
      .string()
      .min(2, 'Proje kodu en az 2 karakter olmalıdır')
      .max(32)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Proje kodu harf, rakam, nokta, alt çizgi ve tire içerebilir'),
    name: z.string().min(2, 'Proje adı en az 2 karakter olmalıdır').max(160),
    clientName: z.string().max(160).optional(),
    description: z.string().max(2000).optional(),
    address: z.string().max(240).optional(),
    startDate: dateOnlySchema.optional(),
    plannedEndDate: dateOnlySchema.optional(),
    actualEndDate: dateOnlySchema.optional(),
    contractAmount: decimalStringSchema.optional(),
    currency: currencySchema.default('TRY'),
    managerId: z.string().min(1).max(64).optional(),
  })
  .refine(
    (v) => !v.startDate || !v.plannedEndDate || v.startDate <= v.plannedEndDate,
    { message: 'Planlanan bitiş tarihi başlangıçtan önce olamaz', path: ['plannedEndDate'] },
  );
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z
  .object({
    name: z.string().min(2).max(160).optional(),
    clientName: z.string().max(160).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    address: z.string().max(240).nullable().optional(),
    startDate: dateOnlySchema.nullable().optional(),
    plannedEndDate: dateOnlySchema.nullable().optional(),
    actualEndDate: dateOnlySchema.nullable().optional(),
    contractAmount: decimalStringSchema.nullable().optional(),
    currency: currencySchema.optional(),
    status: projectStatusSchema.optional(),
    managerId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

// ---------- Şantiye istekleri ----------

export const createSiteRequestSchema = z.object({
  name: z.string().min(1, 'Şantiye adı gereklidir').max(120),
  address: z.string().max(240).optional(),
});
export type CreateSiteRequest = z.infer<typeof createSiteRequestSchema>;

export const updateSiteRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    address: z.string().max(240).nullable().optional(),
    status: siteStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type UpdateSiteRequest = z.infer<typeof updateSiteRequestSchema>;

// ---------- Üye istekleri ----------

export const addProjectMemberRequestSchema = z.object({
  userId: z.string().min(1, 'Kullanıcı seçilmelidir').max(64),
  scopeRole: projectScopeRoleSchema.default('WORKER'),
});
export type AddProjectMemberRequest = z.infer<typeof addProjectMemberRequestSchema>;

export const updateProjectMemberRequestSchema = z.object({
  scopeRole: projectScopeRoleSchema,
});
export type UpdateProjectMemberRequest = z.infer<typeof updateProjectMemberRequestSchema>;
