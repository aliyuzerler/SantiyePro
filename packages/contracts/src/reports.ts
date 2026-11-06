/**
 * ŞantiyePro — Raporlama, dışa aktarma, denetim günlüğü ve yedekleme sözleşmeleri (Faz 10).
 *
 * Kurallar (prompts/phase-10-development.md, docs/05, docs/08, docs/10):
 * - Tüm raporlar GERÇEK DB verisinden üretilir; hiçbir sayı uydurulmaz.
 * - Filtreler (tarih aralığı, proje/şantiye, durum) hem ekranda hem dışa
 *   aktarmada AYNI şemayla uygulanır — ekran ile çıktı asla ayrışmaz.
 * - Yetki kapsamı: rapor yalnızca kullanıcının erişebildiği projeleri kapsar
 *   (FIRM_ADMIN tümü; diğer roller üyelik); alt veri izni her rapor için
 *   ayrıca zorunludur (bkz. reports/README notu, PermissionsGuard).
 * - Liste raporları sunucu tarafı sayfalama ile döner (docs/08 büyük tablo kuralı).
 * - Durum sabitleri tek doğruluk kaynağından alınır (dailyreports/finance/tasks).
 * - Tutarlar kanonik ondalık string; tarihler ISO; sayılar sayı tipindedir.
 * - XLSX hücreleri GERÇEK tiptedir (sayı/sayı, tarih/tarih); PDF Türkçe
 *   karakterli fontla (DejaVu) üretilir.
 * - Dışa aktarma her çağrıda audit log üretir (report.exported).
 * - Denetim günlüğü yalnızca audit.view izniyle okunur; önce/sonra gövdeleri
 *   yazım anında maskelendiği gibi OKUMA anında da yeniden maskelenir.
 */
import { z } from 'zod';
import { paginationQuerySchema, paginatedListResponseSchema } from './pagination.js';
import { DAILY_REPORT_STATUSES, reportDateSchema } from './dailyreports.js';
import { EXPENSE_STATUSES } from './finance.js';
import { TASK_STATUSES } from './tasks.js';

// ---------- Ortak filtre şeması ----------

/** Tarih (yalnız gün kesinliği) — YYYY-MM-DD (dailyreports.js'ten alınır). */
export type ReportDate = string;

/**
 * Tüm raporlarda ortak filtreler. page/pageSize liste raporlarında kullanılır;
 * export ucunda sayfalama YOKTUR (satır sınırı EXPORT_ROW_LIMIT ile korunur).
 */
export const reportFilterSchema = z.object({
  dateFrom: reportDateSchema.optional(),
  dateTo: reportDateSchema.optional(),
  projectId: z.string().trim().min(1).max(64).optional(),
  siteId: z.string().trim().min(1).max(64).optional(),
});

/** Liste raporu sorgusu: filtre + sayfalama. */
export const reportListQuerySchema = reportFilterSchema.merge(paginationQuerySchema);
export type ReportListQuery = z.infer<typeof reportListQuerySchema>;

// ---------- Rapor anahtarları ----------

export const REPORT_KEYS = [
  'project-overview',
  'daily-reports',
  'attendance',
  'stock-balance',
  'stock-movements',
  'expense-summary',
  'claim-summary',
  'task-status',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const reportKeySchema = z.enum(REPORT_KEYS);

/** UI ve PDF/XLSX başlıklarında kullanılan Türkçe rapor adları (tek doğruluk kaynağı). */
export const REPORT_KEY_LABELS: Record<ReportKey, string> = {
  'project-overview': 'Proje Genel Görünümü',
  'daily-reports': 'Günlük Rapor Özeti',
  attendance: 'Puantaj Özeti',
  'stock-balance': 'Stok Bakiyesi',
  'stock-movements': 'Stok Hareketleri',
  'expense-summary': 'Gider Özeti',
  'claim-summary': 'Hakediş Dönem Özeti',
  'task-status': 'Görev Durum / Termin',
};

/** Her raporun tabi olduğu alt veri izni — PermissionsGuard + servis kapsam kontrolü. */
export const REPORT_PERMISSIONS: Record<ReportKey, string> = {
  'project-overview': 'project.view',
  'daily-reports': 'dailyreport.view',
  attendance: 'attendance.view',
  'stock-balance': 'inventory.view',
  'stock-movements': 'inventory.view',
  'expense-summary': 'expense.create',
  'claim-summary': 'claim.prepare',
  'task-status': 'task.view',
};

// ---------- 1) Proje genel görünümü ----------

export const projectOverviewQuerySchema = reportListQuerySchema;
export type ProjectOverviewQuery = z.infer<typeof projectOverviewQuerySchema>;

export const projectOverviewRowSchema = z.object({
  projectId: z.string(),
  projectCode: z.string(),
  projectName: z.string(),
  projectStatus: z.string(),
  taskTotal: z.number().int().nonnegative(),
  taskDone: z.number().int().nonnegative(),
  taskActive: z.number().int().nonnegative(),
  taskOverdue: z.number().int().nonnegative(),
  dailyReportTotal: z.number().int().nonnegative(),
  dailyReportApproved: z.number().int().nonnegative(),
  dailyReportSubmitted: z.number().int().nonnegative(),
  attendanceRecordCount: z.number().int().nonnegative(),
  stockMovementCount: z.number().int().nonnegative(),
  expenseApprovedTotal: z.string().nullable(),
  expensePendingTotal: z.string().nullable(),
  expenseCurrency: z.string().nullable(),
  /** Birden fazla para birimi varsa toplamlar uydurulmaz: null + true döner. */
  expenseMixedCurrency: z.boolean(),
  claimApprovedNetTotal: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
});
export type ProjectOverviewRow = z.infer<typeof projectOverviewRowSchema>;
export const projectOverviewResponseSchema = paginatedListResponseSchema(projectOverviewRowSchema);
export type ProjectOverviewResponse = z.infer<typeof projectOverviewResponseSchema>;

// ---------- 2) Günlük rapor özeti (tarih/proje) ----------
// Durum değerleri dailyreports.js'ten alınır: DRAFT | SUBMITTED | APPROVED | REJECTED.
export const dailyReportSummaryQuerySchema = reportListQuerySchema.extend({
  status: z.enum(DAILY_REPORT_STATUSES).optional(),
});
export type DailyReportSummaryQuery = z.infer<typeof dailyReportSummaryQuerySchema>;

export const dailyReportSummaryRowSchema = z.object({
  reportDate: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  total: z.number().int().nonnegative(),
  draft: z.number().int().nonnegative(),
  submitted: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  revisionTotal: z.number().int().nonnegative(),
});
export type DailyReportSummaryRow = z.infer<typeof dailyReportSummaryRowSchema>;
export const dailyReportSummaryResponseSchema = paginatedListResponseSchema(dailyReportSummaryRowSchema);
export type DailyReportSummaryResponse = z.infer<typeof dailyReportSummaryResponseSchema>;

// ---------- 3) Puantaj özeti (tarih/proje) ----------
// Not: attendance.js'teki attendanceSummary* uçları PROJEYE ÖZEL Faz 06
// özetidir; buradaki attendanceReport* uçları çapraz-proje rapor yapısıdır.

export const attendanceReportQuerySchema = reportListQuerySchema.extend({
  /** Kayıt durumu serbest metindir (kurum tanımlı özel durumlar dâhil, docs/04). */
  status: z.string().trim().min(1).max(40).optional(),
});
export type AttendanceReportQuery = z.infer<typeof attendanceReportQuerySchema>;

export const attendanceReportRowSchema = z.object({
  workDate: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  recordCount: z.number().int().nonnegative(),
  workedMinutesTotal: z.number().int().nonnegative(),
  statusBreakdown: z.array(z.object({ status: z.string(), count: z.number().int().nonnegative() })),
});
export type AttendanceReportRow = z.infer<typeof attendanceReportRowSchema>;
export const attendanceReportResponseSchema = paginatedListResponseSchema(attendanceReportRowSchema);
export type AttendanceReportResponse = z.infer<typeof attendanceReportResponseSchema>;

// ---------- 4) Stok bakiyesi ----------

export const stockBalanceQuerySchema = reportListQuerySchema.extend({
  warehouseId: z.string().trim().min(1).max(64).optional(),
  materialId: z.string().trim().min(1).max(64).optional(),
  /** 'true' → yalnızca kritik stok altındaki kartlar (boolean'a serviste çevrilir). */
  belowMin: z.enum(['true', 'false']).optional(),
});
export type StockBalanceQuery = z.infer<typeof stockBalanceQuerySchema>;

export const stockBalanceRowSchema = z.object({
  materialId: z.string(),
  materialCode: z.string().nullable(),
  materialName: z.string(),
  unit: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  warehouseProjectId: z.string().nullable(),
  quantity: z.string(),
  minStock: z.string().nullable(),
  belowMin: z.boolean(),
  lastMovementAt: z.string(),
});
export type StockBalanceRow = z.infer<typeof stockBalanceRowSchema>;
export const stockBalanceResponseSchema = paginatedListResponseSchema(stockBalanceRowSchema);
export type StockBalanceResponse = z.infer<typeof stockBalanceResponseSchema>;

// ---------- 5) Stok hareketleri ----------

export const stockMovementQuerySchema = reportListQuerySchema.extend({
  warehouseId: z.string().trim().min(1).max(64).optional(),
  materialId: z.string().trim().min(1).max(64).optional(),
  type: z.string().trim().min(1).max(20).optional(),
});
export type StockMovementQuery = z.infer<typeof stockMovementQuerySchema>;

export const stockMovementRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  materialName: z.string(),
  materialCode: z.string().nullable(),
  unit: z.string(),
  warehouseName: z.string(),
  targetWarehouseName: z.string().nullable(),
  projectName: z.string().nullable(),
  quantity: z.string(),
  unitCost: z.string().nullable(),
  occurredAt: z.string(),
  note: z.string().nullable(),
  reversalOfId: z.string().nullable(),
});
export type StockMovementRow = z.infer<typeof stockMovementRowSchema>;
export const stockMovementResponseSchema = paginatedListResponseSchema(stockMovementRowSchema);
export type StockMovementResponse = z.infer<typeof stockMovementResponseSchema>;

// ---------- 6) Gider özeti (kategori × durum) ----------

// Durum değerleri finance.js'ten alınır: DRAFT | PENDING | APPROVED | REJECTED.
export const expenseSummaryQuerySchema = reportListQuerySchema.extend({
  status: z.enum(EXPENSE_STATUSES).optional(),
  categoryId: z.string().trim().min(1).max(64).optional(),
});
export type ExpenseSummaryQuery = z.infer<typeof expenseSummaryQuerySchema>;

export const expenseSummaryRowSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  currency: z.string(),
  draftCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  approvedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  draftTotal: z.string(),
  pendingTotal: z.string(),
  approvedTotal: z.string(),
  rejectedTotal: z.string(),
  grandTotal: z.string(),
});
export type ExpenseSummaryRow = z.infer<typeof expenseSummaryRowSchema>;
export const expenseSummaryResponseSchema = paginatedListResponseSchema(expenseSummaryRowSchema);
export type ExpenseSummaryResponse = z.infer<typeof expenseSummaryResponseSchema>;

// ---------- 7) Hakediş dönem özeti ----------

export const CLAIM_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ClaimStatusKey = (typeof CLAIM_STATUSES)[number];
// finance.js'de claim durum sabiti yoktur; hakediş durumu burada tanımlı kalır.
export const CLAIM_STATUS_LABELS: Record<ClaimStatusKey, string> = {
  DRAFT: 'Taslak',
  PENDING: 'Onay Bekliyor',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  CANCELLED: 'İptal',
};

export const claimSummaryQuerySchema = reportListQuerySchema.extend({
  status: z.enum(CLAIM_STATUSES).optional(),
});
export type ClaimSummaryQuery = z.infer<typeof claimSummaryQuerySchema>;

export const claimSummaryRowSchema = z.object({
  claimId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  claimNo: z.number().int().positive(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.string(),
  /** Satır para birimi: hakediş satırlarının kalem para birimleri tutarlıysa o, değilse null. */
  currency: z.string().nullable(),
  grossTotal: z.string(),
  deductionTotal: z.string(),
  netTotal: z.string(),
  previousTotal: z.string(),
  cumulativeTotal: z.string(),
});
export type ClaimSummaryRow = z.infer<typeof claimSummaryRowSchema>;
export const claimSummaryResponseSchema = paginatedListResponseSchema(claimSummaryRowSchema);
export type ClaimSummaryResponse = z.infer<typeof claimSummaryResponseSchema>;

// ---------- 8) Görev durum / termin ----------

// Durum değerleri tasks.js'ten alınır: TODO | IN_PROGRESS | BLOCKED | DONE | CANCELLED.
export const taskStatusQuerySchema = reportListQuerySchema;
export type TaskStatusQuery = z.infer<typeof taskStatusQuerySchema>;

export const taskStatusRowSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  todo: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  dueSoon: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type TaskStatusRow = z.infer<typeof taskStatusRowSchema>;
export const taskStatusResponseSchema = paginatedListResponseSchema(taskStatusRowSchema);
export type TaskStatusResponse = z.infer<typeof taskStatusResponseSchema>;

// ---------- Dışa aktarma ----------

export const REPORT_EXPORT_FORMATS = ['pdf', 'xlsx'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

/**
 * Export sorgusu: filtreler ekranla AYNI şemadan türetilir (page/pageSize yok —
 * export tamamı üretir; satır sınırı API'de EXPORT_ROW_LIMIT ile korunur).
 * status alanı rapora göre yorumlanır: desteklemeyen raporda gönderilirse 400.
 */
export const reportExportQuerySchema = reportFilterSchema.extend({
  format: z.enum(REPORT_EXPORT_FORMATS),
  status: z.string().trim().min(1).max(40).optional(),
  warehouseId: z.string().trim().min(1).max(64).optional(),
  materialId: z.string().trim().min(1).max(64).optional(),
  categoryId: z.string().trim().min(1).max(64).optional(),
  belowMin: z.enum(['true', 'false']).optional(),
  type: z.string().trim().min(1).max(20).optional(),
});
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;

/** Export yanıtı (JSON bilgi zarfı) — dosya kendisi binary akış olarak döner. */
export const reportExportAcceptedSchema = z.object({
  key: z.string(),
  format: z.string(),
  rowCount: z.number().int().nonnegative(),
  auditLogId: z.string(),
});
export type ReportExportAccepted = z.infer<typeof reportExportAcceptedSchema>;

// ---------- Denetim günlüğü (audit log) ----------

export const auditLogQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(64).optional(),
  actorUserId: z.string().trim().min(1).max(64).optional(),
  entityId: z.string().trim().min(1).max(64).optional(),
  dateFrom: reportDateSchema.optional(),
  dateTo: reportDateSchema.optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actor: z.object({ id: z.string(), fullName: z.string() }).nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  traceId: z.string().nullable(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export const auditLogResponseSchema = paginatedListResponseSchema(auditLogEntrySchema);
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;

/** Filtre açılır listeleri için ayrık değerler (sınırlı: son N benzersiz). */
export const auditFacetSchema = z.object({
  entityTypes: z.array(z.string()),
  actions: z.array(z.string()),
});
export type AuditFacets = z.infer<typeof auditFacetSchema>;

// ---------- Yedekleme durumu (docs/10) ----------

/**
 * Backup script'i (infra/scripts/backup.sh) status.json yazar; API yalnızca
 * OKUR ve gösterir. Uygulama içinden restore BAŞLATILMAZ (docs/10: kontrollü
 * operasyon script'i zorunludur).
 */
export const backupStatusSchema = z.object({
  statusFileFound: z.boolean(),
  lastRunAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  lastDbBackupFile: z.string().nullable(),
  lastDbBackupSizeBytes: z.number().int().nonnegative().nullable(),
  lastStorageBackupFile: z.string().nullable(),
  lastStorageBackupSizeBytes: z.number().int().nonnegative().nullable(),
  retentionDays: z.number().int().nonnegative().nullable(),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

/** Backup script'inin status.json içeriği — statusFileFound API tarafından türetilir. */
export const backupStatusFileSchema = backupStatusSchema.omit({ statusFileFound: true });
export type BackupStatusFile = z.infer<typeof backupStatusFileSchema>;

// ---------- Yardımcılar ----------

