/**
 * ŞantiyePro — Günlük şantiye raporu sözleşmeleri (Faz 05).
 *
 * Kurallar (prompts/phase-05-development.md, docs/02, docs/04, docs/05):
 * - Durum akışı (docs/05): DRAFT → SUBMITTED → APPROVED, ya da SUBMITTED → REJECTED.
 *   REJECTED → DRAFT (tekrar düzenleme) ve REJECTED → SUBMITTED (doğrudan yeniden
 *   gönderim, MVP ek kararı) geçişleri desteklenir. APPROVED terminaldir; düzenleme
 *   revizyon üretir.
 * - Rapor tarihi timezone-safe: YYYY-MM-DD (PostgreSQL DATE kolonu).
 * - Gönderilmiş/onaylı rapor düzenlenirse önceki içerik DailyReportRevision
 *   snapshot'ına alınır (append-only denetim izi, docs/02).
 * - Ekip/personel satırları saat ondalıklı decimal string olarak taşınır.
 */
import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

// ---------- Durum ----------

export const DAILY_REPORT_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type DailyReportStatus = (typeof DAILY_REPORT_STATUSES)[number];

export const DAILY_REPORT_STATUS_LABELS: Record<DailyReportStatus, string> = {
  DRAFT: 'Taslak',
  SUBMITTED: 'Gönderildi',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
};

export const dailyReportStatusSchema = z.enum(DAILY_REPORT_STATUSES);

/**
 * Günlük rapor durum geçiş matrisi — geçersiz geçiş 400 VALIDATION_ERROR döner.
 * APPROVED terminaldir; onaylı raporun düzenlenmesi revizyon yoluyla izlenir.
 */
const DAILY_REPORT_TRANSITIONS: Record<DailyReportStatus, readonly DailyReportStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  REJECTED: ['DRAFT', 'SUBMITTED'],
  APPROVED: [],
};

export function canTransitionDailyReportStatus(from: DailyReportStatus, to: DailyReportStatus): boolean {
  if (from === to) return false;
  return DAILY_REPORT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextDailyReportStatuses(from: DailyReportStatus): readonly DailyReportStatus[] {
  return DAILY_REPORT_TRANSITIONS[from] ?? [];
}

// ---------- Ortak alan şemaları ----------

/** Yalnızca tarih: YYYY-MM-DD (rapor tarihi — timezone-safe). */
export const reportDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Rapor tarihi YYYY-MM-DD biçiminde olmalıdır');

/** Ekip satırındaki saat: 0-24 arası en fazla 2 ondalık decimal string. */
export const workHoursSchema = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, 'Saat sayısal ve en fazla 2 ondalıklı olmalıdır')
  .refine((v) => Number(v) <= 24, "Günlük çalışma saati 24'ü aşamaz");

export const dailyReportWorkerInputSchema = z.object({
  name: z.string().min(2, 'Personel adı en az 2 karakter olmalıdır').max(120),
  jobTitle: z.string().max(120).optional(),
  workerCount: z.number().int().min(1).max(500).default(1),
  hours: workHoursSchema,
});
export type DailyReportWorkerInput = z.infer<typeof dailyReportWorkerInputSchema>;

const summaryTextSchema = z.string().max(4000);

// ---------- İstekler ----------

export const createDailyReportRequestSchema = z.object({
  projectId: z.string().min(1, 'Proje seçilmelidir').max(64),
  siteId: z.string().min(1).max(64).nullable().optional(),
  reportDate: reportDateSchema,
  weather: z.string().max(40).optional(),
  workSummary: z.string().min(3, 'Yapılan işler en az 3 karakter olmalıdır').max(4000),
  workforceSummary: summaryTextSchema.optional(),
  equipmentSummary: summaryTextSchema.optional(),
  issues: summaryTextSchema.optional(),
  safetyNotes: summaryTextSchema.optional(),
  nextDayPlan: summaryTextSchema.optional(),
  workers: z.array(dailyReportWorkerInputSchema).max(50).optional(),
  mediaIds: z.array(z.string().min(1).max(64)).max(20).optional(),
});
export type CreateDailyReportRequest = z.infer<typeof createDailyReportRequestSchema>;

export const updateDailyReportRequestSchema = z
  .object({
    siteId: z.string().min(1).max(64).nullable().optional(),
    reportDate: reportDateSchema.optional(),
    weather: z.string().max(40).nullable().optional(),
    workSummary: z.string().min(3).max(4000).optional(),
    workforceSummary: summaryTextSchema.nullable().optional(),
    equipmentSummary: summaryTextSchema.nullable().optional(),
    issues: summaryTextSchema.nullable().optional(),
    safetyNotes: summaryTextSchema.nullable().optional(),
    nextDayPlan: summaryTextSchema.nullable().optional(),
    workers: z.array(dailyReportWorkerInputSchema).max(50).optional(),
    mediaIds: z.array(z.string().min(1).max(64)).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type UpdateDailyReportRequest = z.infer<typeof updateDailyReportRequestSchema>;

export const rejectDailyReportRequestSchema = z.object({
  reason: z.string().min(3, 'Red gerekçesi en az 3 karakter olmalıdır').max(1000),
});
export type RejectDailyReportRequest = z.infer<typeof rejectDailyReportRequestSchema>;

// ---------- Liste sorgusu ----------

export const dailyReportSortFieldsSchema = z.enum(['createdAt', 'reportDate']);

export const dailyReportListQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().min(1).max(64).optional(),
  siteId: z.string().min(1).max(64).optional(),
  status: dailyReportStatusSchema.optional(),
  /** Tarih aralığı (dahil) — YYYY-MM-DD. */
  dateFrom: reportDateSchema.optional(),
  dateTo: reportDateSchema.optional(),
  sort: dailyReportSortFieldsSchema.default('reportDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type DailyReportListQuery = z.infer<typeof dailyReportListQuerySchema>;

// ---------- DTO'lar ----------

export const dailyReportWorkerDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  jobTitle: z.string().nullable().optional(),
  workerCount: z.number().int().min(1),
  hours: z.string(),
});
export type DailyReportWorkerDto = z.infer<typeof dailyReportWorkerDtoSchema>;

export const dailyReportMediaDtoSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  sizeBytes: z.number().int().min(0),
  /** Kısa ömürlü imzalı içerik URL'i (galeri <img> için). */
  url: z.string(),
  createdAt: z.string(),
});
export type DailyReportMediaDto = z.infer<typeof dailyReportMediaDtoSchema>;

export const dailyReportRevisionDtoSchema = z.object({
  id: z.string(),
  revisionNo: z.number().int().min(0),
  /** Önceki içeriğin tam snapshot'ı (denetim için korunur). */
  snapshot: z.record(z.string(), z.unknown()),
  contentHash: z.string(),
  changedByFullName: z.string(),
  createdAt: z.string(),
});
export type DailyReportRevisionDto = z.infer<typeof dailyReportRevisionDtoSchema>;

export const dailyReportDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectCode: z.string().optional(),
  projectName: z.string().optional(),
  siteId: z.string().nullable().optional(),
  siteName: z.string().nullable().optional(),
  reportDate: reportDateSchema,
  weather: z.string().nullable().optional(),
  workSummary: z.string(),
  workforceSummary: z.string().nullable().optional(),
  equipmentSummary: z.string().nullable().optional(),
  issues: z.string().nullable().optional(),
  safetyNotes: z.string().nullable().optional(),
  nextDayPlan: z.string().nullable().optional(),
  status: dailyReportStatusSchema,
  revisionNo: z.number().int().min(0),
  workers: z.array(dailyReportWorkerDtoSchema),
  media: z.array(dailyReportMediaDtoSchema),
  /** Liste görünümünde sayı; detayda media dizisi dolu gelir. */
  mediaCount: z.number().int().min(0).optional(),
  createdById: z.string(),
  createdBy: z.object({ id: z.string(), fullName: z.string() }).nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  approvedBy: z.object({ id: z.string(), fullName: z.string() }).nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  rejectedReason: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DailyReportDto = z.infer<typeof dailyReportDtoSchema>;

export const dailyReportDetailDtoSchema = dailyReportDtoSchema.extend({
  revisions: z.array(dailyReportRevisionDtoSchema),
});
export type DailyReportDetailDto = z.infer<typeof dailyReportDetailDtoSchema>;
