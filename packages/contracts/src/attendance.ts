/**
 * ŞantiyePro — Personel ve puantaj sözleşmeleri (Faz 06).
 *
 * Kurallar (prompts/phase-06-development.md, docs/04, docs/05, docs/06):
 * - Varsayılan devam durumları: PRESENT, HALF_DAY, ABSENT, LEAVE, SICK, HOLIDAY;
 *   kurum ayarıyla genişletilebilir (OrgSettings.attendanceCustomStatuses).
 * - Aynı personel/proje/tarih/vardiya için tek kayıt: DB unique constraint
 *   (personnelId, projectId, workDate, shiftKey) + servis kontrolü.
 * - Toplu işaretleme iki adımlıdır: önce önizleme, sonra onay (confirm: true).
 * - workDate timezone-safe YYYY-MM-DD (PostgreSQL DATE kolonu, docs/05).
 * - GPS varsayılan kapalı: bu sözleşmede konum alanı yoktur (docs/07).
 * - Personel verisi yetki scope'una göre gösterilir; pasife alma vardır,
 *   sert silme yoktur (append-only iş kayıtları, docs/02).
 */
import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

// ---------- Personel durumu ----------

export const PERSONNEL_STATUSES = ['ACTIVE', 'PASSIVE'] as const;
export type PersonnelStatus = (typeof PERSONNEL_STATUSES)[number];

export const PERSONNEL_STATUS_LABELS: Record<PersonnelStatus, string> = {
  ACTIVE: 'Aktif',
  PASSIVE: 'Pasif',
};

export const personnelStatusSchema = z.enum(PERSONNEL_STATUSES);

// ---------- Devam (puantaj) durumları ----------

/** Varsayılan devam durumları — kurum ayarıyla genişletilir (Faz 06 geliştirme promptu). */
export const DEFAULT_ATTENDANCE_STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'SICK', 'HOLIDAY'] as const;
export type DefaultAttendanceStatus = (typeof DEFAULT_ATTENDANCE_STATUSES)[number];

export const DEFAULT_ATTENDANCE_STATUS_LABELS: Record<DefaultAttendanceStatus, string> = {
  PRESENT: 'Tam Gün',
  HALF_DAY: 'Yarım Gün',
  ABSENT: 'Gelmedi',
  LEAVE: 'İzinli',
  SICK: 'Raporlu',
  HOLIDAY: 'Resmî Tatil',
};

/**
 * Devam durumu: varsayılanlar + kuruma özel anahtarlar.
 * `(string & {})` bileşiği otomatik tamamlamayı varsayılanlar üzerinde tutar.
 */
export type AttendanceStatus = DefaultAttendanceStatus | (string & {});

/** Kuruma özel durum anahtarı: BÜYÜK HARF/alt çizgi, varsayılanlarla çakışamaz. */
export const customStatusKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,31}$/, 'Özel durum anahtarı 2-32 karakter, BÜYÜK HARF/alt çizgi olmalıdır');

export const customAttendanceStatusSchema = z.object({
  key: customStatusKeySchema,
  label: z.string().min(2, 'Özel durum etiketi en az 2 karakter olmalıdır').max(40),
});
export type CustomAttendanceStatus = z.infer<typeof customAttendanceStatusSchema>;

/** Varsayılan + özel durumları sıralı ve tekrarsız birleştirir (API/UI ortak doğruluk kaynağı). */
export function availableAttendanceStatuses(custom: readonly CustomAttendanceStatus[]): AttendanceStatus[] {
  const merged: AttendanceStatus[] = [...DEFAULT_ATTENDANCE_STATUSES];
  for (const entry of custom) {
    if (!merged.includes(entry.key)) merged.push(entry.key);
  }
  return merged;
}

/** Özel durumların etiket haritası (UI gösterimi için). */
export function customAttendanceStatusLabels(custom: readonly CustomAttendanceStatus[]): Record<string, string> {
  return Object.fromEntries(custom.map((c) => [c.key, c.label]));
}

/** Varsayılan + özel etiketleri birleştirir. */
export function attendanceStatusLabels(custom: readonly CustomAttendanceStatus[]): Record<string, string> {
  return { ...DEFAULT_ATTENDANCE_STATUS_LABELS, ...customAttendanceStatusLabels(custom) };
}

// ---------- Vardiya ----------

/** Vardiya anahtarı: aynı gün farklı vardiyalar ayrı kayıt tutabilir (docs/04 unique örneği). */
export const DEFAULT_SHIFT_KEYS = ['GUNDUZ', 'GECE'] as const;
export type DefaultShiftKey = (typeof DEFAULT_SHIFT_KEYS)[number];

export const DEFAULT_SHIFT_KEY_LABELS: Record<DefaultShiftKey, string> = {
  GUNDUZ: 'Gündüz',
  GECE: 'Gece',
};

export const shiftKeySchema = z
  .string()
  .trim()
  .min(1, 'Vardiya anahtarı boş olamaz')
  .max(32, 'Vardiya anahtarı en fazla 32 karakterdir')
  .regex(/^[A-ZÇĞİÖŞÜ0-9_]+$/i, 'Vardiya anahtarı harf/rakam/alt çizgi olmalıdır');
export type ShiftKey = string;

// ---------- Kayıt kaynağı ----------

export const ATTENDANCE_SOURCES = ['WEB', 'MOBILE', 'API'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const ATTENDANCE_SOURCE_LABELS: Record<AttendanceSource, string> = {
  WEB: 'Web Panel',
  MOBILE: 'Mobil',
  API: 'API',
};

// ---------- Ortak alan şemaları ----------

/** Yalnızca tarih: YYYY-MM-DD (puantaj günü — timezone-safe, docs/05). */
export const workDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Puantaj tarihi YYYY-MM-DD biçiminde olmalıdır');

/** ISO 8601 tarih-saat (giriş/çıkış anları timestamptz olarak taşınır). */
export const attendanceDateTimeSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Geçerli bir tarih-saat girilmelidir');

/** Çalışılan dakika: 0-1440 (bir günün tamamı). */
export const workedMinutesSchema = z
  .number()
  .int('Çalışılan dakika tam sayı olmalıdır')
  .min(0, 'Çalışılan dakika negatif olamaz')
  .max(1440, "Çalışılan dakika bir günü (1440 dk) aşamaz");

/**
 * Durum bazlı giriş/çıkış doğrulaması (test promptu: "Her devam durumu ve
 * giriş/çıkış validasyonu"):
 * - Gelmedi/İzinli/Raporlu/Resmî Tatil kayıtlarında giriş-çıkış ve çalışma
 *   süresi olamaz (sahada olmadıklarına dair işarettir).
 * - Çıkış, girişten sonra olmalıdır.
 */
export function validateAttendanceTimes(
  value: Pick<
    CreateAttendanceRequest | UpdateAttendanceRequest,
    'status' | 'checkInAt' | 'checkOutAt' | 'workedMinutes'
  >,
): { valid: true } | { valid: false; message: string } {
  const nonWorkStatuses = ['ABSENT', 'LEAVE', 'SICK', 'HOLIDAY'];
  if (value.status !== undefined && nonWorkStatuses.includes(value.status)) {
    if (value.checkInAt || value.checkOutAt || value.workedMinutes !== undefined) {
      return {
        valid: false,
        message: `${value.status} durumunda giriş-çıkış saati ve çalışma süresi girilemez`,
      };
    }
    return { valid: true };
  }
  if (value.checkOutAt && !value.checkInAt) {
    return { valid: false, message: 'Çıkış saati girmek için önce giriş saati gereklidir' };
  }
  if (value.checkInAt && value.checkOutAt) {
    const inMs = Date.parse(value.checkInAt);
    const outMs = Date.parse(value.checkOutAt);
    if (!(outMs > inMs)) {
      return { valid: false, message: 'Çıkış saati giriş saatinden sonra olmalıdır' };
    }
  }
  return { valid: true };
}

// ---------- Personel istekleri ----------

export const personnelCreateRequestSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .min(1, 'Sicil numarası boş olamaz')
    .max(32, 'Sicil numarası en fazla 32 karakterdir')
    .optional(),
  fullName: z.string().trim().min(3, 'Ad soyad en az 3 karakter olmalıdır').max(120),
  phone: z
    .string()
    .trim()
    .min(7, 'Telefon en az 7 karakter olmalıdır')
    .max(20, 'Telefon en fazla 20 karakterdir')
    .optional(),
  jobTitle: z.string().trim().min(2, 'İş unvanı en az 2 karakter olmalıdır').max(80).optional(),
  companyOrSubcontractor: z.string().trim().min(2, 'Firma/taşeron en az 2 karakter olmalıdır').max(120).optional(),
  status: personnelStatusSchema.default('ACTIVE'),
});
export type PersonnelCreateRequest = z.infer<typeof personnelCreateRequestSchema>;

export const personnelUpdateRequestSchema = z
  .object({
    employeeCode: z.string().trim().min(1).max(32).nullable().optional(),
    fullName: z.string().trim().min(3, 'Ad soyad en az 3 karakter olmalıdır').max(120).optional(),
    phone: z.string().trim().min(7).max(20).nullable().optional(),
    jobTitle: z.string().trim().min(2).max(80).nullable().optional(),
    companyOrSubcontractor: z.string().trim().min(2).max(120).nullable().optional(),
    status: personnelStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type PersonnelUpdateRequest = z.infer<typeof personnelUpdateRequestSchema>;

export const personnelSortFieldsSchema = z.enum(['fullName', 'createdAt', 'employeeCode']);

export const personnelListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  status: personnelStatusSchema.optional(),
  sort: personnelSortFieldsSchema.default('fullName'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type PersonnelListQuery = z.infer<typeof personnelListQuerySchema>;

// ---------- Personel DTO ----------

export const personnelDtoSchema = z.object({
  id: z.string(),
  employeeCode: z.string().nullable(),
  fullName: z.string(),
  phone: z.string().nullable(),
  jobTitle: z.string().nullable(),
  companyOrSubcontractor: z.string().nullable(),
  status: personnelStatusSchema,
  attendanceRecordCount: z.number().int().min(0),
  createdById: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersonnelDto = z.infer<typeof personnelDtoSchema>;

// ---------- Puantaj istekleri ----------

export const createAttendanceRequestSchema = z.object({
  projectId: z.string().min(1, 'Proje seçilmelidir').max(64),
  siteId: z.string().min(1).max(64).nullable().optional(),
  personnelId: z.string().min(1, 'Personel seçilmelidir').max(64),
  workDate: workDateSchema,
  shiftKey: shiftKeySchema.default('GUNDUZ'),
  status: z.string().min(1).max(32).default('PRESENT'),
  checkInAt: attendanceDateTimeSchema.nullable().optional(),
  checkOutAt: attendanceDateTimeSchema.nullable().optional(),
  workedMinutes: workedMinutesSchema.nullable().optional(),
  note: z.string().trim().max(500, 'Not en fazla 500 karakterdir').nullable().optional(),
  /** Çevrimdışı kuyruktan gelen kayıtlar için idempotency anahtarı (docs/09). */
  clientMutationId: z.string().min(8).max(64).optional(),
});
export type CreateAttendanceRequest = z.infer<typeof createAttendanceRequestSchema>;

export const updateAttendanceRequestSchema = z
  .object({
    siteId: z.string().min(1).max(64).nullable().optional(),
    status: z.string().min(1).max(32).optional(),
    checkInAt: attendanceDateTimeSchema.nullable().optional(),
    checkOutAt: attendanceDateTimeSchema.nullable().optional(),
    workedMinutes: workedMinutesSchema.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type UpdateAttendanceRequest = z.infer<typeof updateAttendanceRequestSchema>;

export const attendanceSortFieldsSchema = z.enum(['workDate', 'createdAt', 'fullName']);

export const attendanceListQuerySchema = paginationQuerySchema
  .extend({
    projectId: z.string().min(1).max(64).optional(),
    workDate: workDateSchema.optional(),
    /** Tarih aralığı (dahil) — workDate verilmediğinde özet/liste aralığı. */
    dateFrom: workDateSchema.optional(),
    dateTo: workDateSchema.optional(),
    personnelId: z.string().min(1).max(64).optional(),
    status: z.string().min(1).max(32).optional(),
    shiftKey: shiftKeySchema.optional(),
    sort: attendanceSortFieldsSchema.default('workDate'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((v) => Boolean(v.projectId || v.personnelId), {
    message: 'Liste en az projectId veya personnelId filtresiyle sınırlandırılmalıdır',
  });
export type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;

// ---------- Toplu işaretleme (önizleme + onay) ----------

export const bulkAttendanceBaseSchema = z.object({
  projectId: z.string().min(1, 'Proje seçilmelidir').max(64),
  siteId: z.string().min(1).max(64).nullable().optional(),
  workDate: workDateSchema,
  shiftKey: shiftKeySchema.default('GUNDUZ'),
  status: z.string().min(1).max(32),
  /** İşaretlenecek personel listesi — tek istekte en fazla 500 satır. */
  personnelIds: z
    .array(z.string().min(1).max(64))
    .min(1, 'En az bir personel seçilmelidir')
    .max(500, 'Tek istekte en fazla 500 personel işaretlenebilir'),
  checkInAt: attendanceDateTimeSchema.nullable().optional(),
  checkOutAt: attendanceDateTimeSchema.nullable().optional(),
  workedMinutes: workedMinutesSchema.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

/** Önizleme: hiçbir kayıt yazılmaz; uygulanacak ve atlanacak satırlar listelenir. */
export const bulkAttendancePreviewRequestSchema = bulkAttendanceBaseSchema;
export type BulkAttendancePreviewRequest = z.infer<typeof bulkAttendancePreviewRequestSchema>;

/** Onay: confirm: true olmadan uygulanmaz (Faz 06 geliştirme promptu). */
export const bulkAttendanceConfirmRequestSchema = bulkAttendanceBaseSchema.extend({
  confirm: z.literal(true, { message: 'Toplu işaretleme yalnızca önizleme onayıyla uygulanır (confirm: true)' }),
});
export type BulkAttendanceConfirmRequest = z.infer<typeof bulkAttendanceConfirmRequestSchema>;

export const BULK_ATTENDANCE_ACTIONS = ['CREATE', 'UPDATE', 'SKIP_DUPLICATE', 'SKIP_PASSIVE', 'SKIP_NOT_FOUND'] as const;
export type BulkAttendanceAction = (typeof BULK_ATTENDANCE_ACTIONS)[number];

export const BULK_ATTENDANCE_ACTION_LABELS: Record<BulkAttendanceAction, string> = {
  CREATE: 'Kayıt açılacak',
  UPDATE: 'Kayıt güncellenecek',
  SKIP_DUPLICATE: 'Zaten kayıtlı — atlanacak',
  SKIP_PASSIVE: 'Pasif personel — atlanacak',
  SKIP_NOT_FOUND: 'Personel bulunamadı — atlanacak',
};

export const bulkAttendanceEntrySchema = z.object({
  personnelId: z.string(),
  personnelName: z.string(),
  action: z.enum(BULK_ATTENDANCE_ACTIONS),
  detail: z.string(),
});
export type BulkAttendanceEntry = z.infer<typeof bulkAttendanceEntrySchema>;

export const bulkAttendancePreviewResponseSchema = z.object({
  projectId: z.string(),
  workDate: workDateSchema,
  shiftKey: shiftKeySchema,
  status: z.string(),
  createCount: z.number().int().min(0),
  updateCount: z.number().int().min(0),
  skipCount: z.number().int().min(0),
  entries: z.array(bulkAttendanceEntrySchema),
});
export type BulkAttendancePreviewResponse = z.infer<typeof bulkAttendancePreviewResponseSchema>;

export const bulkAttendanceResultSchema = bulkAttendancePreviewResponseSchema.extend({
  createdCount: z.number().int().min(0),
  updatedCount: z.number().int().min(0),
  skipCount: z.number().int().min(0),
});
export type BulkAttendanceResult = z.infer<typeof bulkAttendanceResultSchema>;

// ---------- Puantaj DTO ----------

export const attendanceUserSummarySchema = z.object({
  id: z.string(),
  fullName: z.string(),
});
export type AttendanceUserSummary = z.infer<typeof attendanceUserSummarySchema>;

export const attendanceRecordDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectCode: z.string().nullable(),
  projectName: z.string().nullable(),
  siteId: z.string().nullable(),
  siteName: z.string().nullable(),
  personnelId: z.string(),
  personnelName: z.string(),
  personnelEmployeeCode: z.string().nullable(),
  workDate: workDateSchema,
  shiftKey: shiftKeySchema,
  status: z.string(),
  checkInAt: z.string().nullable(),
  checkOutAt: z.string().nullable(),
  workedMinutes: z.number().int().min(0).nullable(),
  note: z.string().nullable(),
  recordedById: z.string(),
  recordedBy: attendanceUserSummarySchema,
  source: z.enum(ATTENDANCE_SOURCES),
  clientMutationId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AttendanceRecordDto = z.infer<typeof attendanceRecordDtoSchema>;

// ---------- Özet (raporlar) ----------

export const attendanceSummaryQuerySchema = z
  .object({
    projectId: z.string().min(1).max(64),
    dateFrom: workDateSchema,
    dateTo: workDateSchema,
  })
  .refine((v) => v.dateFrom <= v.dateTo, { message: 'Başlangıç tarihi bitişten sonra olamaz' });
export type AttendanceSummaryQuery = z.infer<typeof attendanceSummaryQuerySchema>;

export const attendanceSummaryDateRowSchema = z.object({
  date: workDateSchema,
  counts: z.record(z.string(), z.number().int().min(0)),
  workedMinutes: z.number().int().min(0),
});
export type AttendanceSummaryDateRow = z.infer<typeof attendanceSummaryDateRowSchema>;

export const attendanceSummaryResponseSchema = z.object({
  projectId: z.string(),
  dateFrom: workDateSchema,
  dateTo: workDateSchema,
  totalRecords: z.number().int().min(0),
  uniquePersonnelCount: z.number().int().min(0),
  totalWorkedMinutes: z.number().int().min(0),
  byStatus: z.record(z.string(), z.number().int().min(0)),
  byDate: z.array(attendanceSummaryDateRowSchema),
});
export type AttendanceSummaryResponse = z.infer<typeof attendanceSummaryResponseSchema>;

// ---------- Kurum ayarı (özel devam durumları) ----------

export const orgSettingsDtoSchema = z.object({
  attendanceCustomStatuses: z.array(customAttendanceStatusSchema).max(20, 'En fazla 20 özel durum eklenebilir'),
});
export type OrgSettingsDto = z.infer<typeof orgSettingsDtoSchema>;

export const updateOrgSettingsRequestSchema = orgSettingsDtoSchema
  .extend({})
  .refine(
    (v) => {
      const keys = v.attendanceCustomStatuses.map((c) => c.key);
      return new Set(keys).size === keys.length;
    },
    { message: 'Özel durum anahtarları tekrar edemez' },
  )
  .refine(
    (v) => {
      const defaults = DEFAULT_ATTENDANCE_STATUSES as readonly string[];
      return v.attendanceCustomStatuses.every((c) => !defaults.includes(c.key));
    },
    { message: 'Özel durum anahtarı varsayılan durumlarla çakışamaz' },
  );
export type UpdateOrgSettingsRequest = z.infer<typeof updateOrgSettingsRequestSchema>;

// ---------- Yardımcılar ----------

/** workDate (YYYY-MM-DD) → UTC gece yarısı Date'i (PostgreSQL DATE eşlemesi için). */
export function workDateToDate(workDate: string): Date {
  return new Date(`${workDate}T00:00:00.000Z`);
}

/** Date → YYYY-MM-DD (UTC takvim günü). */
export function dateToWorkDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** İki zaman alanı doluysa aradaki dakikayı hesaplar; aksi hâlde verilen değeri döner. */
export function resolveWorkedMinutes(input: {
  checkInAt?: string | null;
  checkOutAt?: string | null;
  workedMinutes?: number | null;
}): number | null {
  if (input.checkInAt && input.checkOutAt) {
    const diff = Math.round((Date.parse(input.checkOutAt) - Date.parse(input.checkInAt)) / 60_000);
    return diff >= 0 ? diff : null;
  }
  return input.workedMinutes ?? null;
}
