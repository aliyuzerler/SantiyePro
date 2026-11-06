/**
 * Senkronizasyon sözleşmesi (Faz 09 — docs/09-offline-sync.md).
 *
 * Kurallar:
 * - Her mutation clientMutationId ile idempotenttir; tekrar gönderim aynı
 *   sonucu `replayed: true` ile döner (çift kayıt oluşmaz).
 * - Push sonucu her mutation için accepted/rejected/conflict ve açıklama taşır;
 *   reddedilen kayıt istemcide asla sessizce silinmez.
 * - Pull server sequence (SyncEvent.seq) cursor'ıyla delta döner; cihaz saati
 *   sıralama kaynağı DEĞİLDİR (docs/09 çakışma politikası).
 * - Yetkisiz / erişimi kaldırılmış proje verisi cihaza gönderilmez; erişimi
 *   kalkan projeler `accessibleProjectIds` snapshot'ından çıkarılır ve cihaz
 *   yerel verisini temizler (tombstone etkisi).
 */
import { z } from 'zod';

// ---------- Push: mutation zarfı ----------

/** Mobil outbox'un gönderebildiği mutation türleri (öncelikli çevrimdışı akışlar + kritik hareketler). */
export const SYNC_MUTATION_TYPES = [
  'attendance.mark',
  'task.update',
  'task.comment',
  'dailyReport.upsertDraft',
  'expense.create',
  'stock.movement',
] as const;

export const SyncMutationType = z.enum(SYNC_MUTATION_TYPES);
export type SyncMutationType = z.infer<typeof SyncMutationType>;

export const syncMutationSchema = z.object({
  /** İstemci üretili tekil anahtar — idempotency (min 8: rasgele çakışmayı engeller). */
  clientMutationId: z.string().min(8).max(64),
  type: SyncMutationType,
  /** Mutasyona özgü yük — sunucu tarafında tür bazlı şema ile doğrulanır. */
  payload: z.record(z.string(), z.unknown()),
  /** Cihaz saati yalnızca bilgidir; sunucu sıralaması sequence ile yapılır. */
  localCreatedAt: z.string().optional(),
});
export type SyncMutation = z.infer<typeof syncMutationSchema>;

export const syncPushRequestSchema = z.object({
  mutations: z.array(syncMutationSchema).min(1).max(50),
});
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

// ---------- Push: mutation sonucu ----------

export const SYNC_MUTATION_STATUSES = ['accepted', 'rejected', 'conflict'] as const;
export const SyncMutationStatus = z.enum(SYNC_MUTATION_STATUSES);
export type SyncMutationStatus = z.infer<typeof SyncMutationStatus>;

export const syncMutationResultSchema = z.object({
  clientMutationId: z.string(),
  status: SyncMutationStatus,
  /** true: aynı clientMutationId daha önce işlendi; kayıt tekrar oluşturulmadı. */
  replayed: z.boolean().default(false),
  /** Kabul edilen kaydın sunucu ID'si (istemci local_entities eşlemesi için). */
  serverId: z.string().nullable().optional(),
  /** Kabul edilen görev güncellemelerinde yeni sürüm (optimistic locking). */
  version: z.number().nullable().optional(),
  /** rejected/conflict için makine okunur kod + Türkçe açıklama. */
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable()
    .optional(),
});
export type SyncMutationResult = z.infer<typeof syncMutationResultSchema>;

export const syncPushResponseSchema = z.object({
  results: z.array(syncMutationResultSchema),
  serverTime: z.string(),
});
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

// ---------- Pull: delta değişiklikleri ----------

/** Cihaza delta olarak gönderilen entity türleri (docs/09 yerel veri modeli). */
export const SYNC_ENTITY_TYPES = [
  'project',
  'site',
  'task',
  'taskComment',
  'dailyReport',
  'attendanceRecord',
  'personnel',
] as const;

export const SyncEntityType = z.enum(SYNC_ENTITY_TYPES);
export type SyncEntityType = z.infer<typeof SyncEntityType>;

export const SYNC_CHANGE_OPERATIONS = ['upsert', 'delete'] as const;
export const SyncChangeOperation = z.enum(SYNC_CHANGE_OPERATIONS);
export type SyncChangeOperation = z.infer<typeof SyncChangeOperation>;

export const syncChangeSchema = z.object({
  /** Sunucu monotonik sırası — cursor bunun üzerine kurulur. */
  seq: z.number(),
  entityType: SyncEntityType,
  operation: SyncChangeOperation,
  entityId: z.string(),
  /** Proje bağlantılı kayıtlarda sahiplik; personnel gibi kurum verisinde null. */
  projectId: z.string().nullable(),
  /** Kaydın sunucu güncelleme zamanı (bilgi amaçlı; sıralama seq iledir). */
  updatedAt: z.string(),
  /** upsert için tam anlık görüntü; delete (tombstone) için yoktur. */
  data: z.unknown().optional(),
});
export type SyncChange = z.infer<typeof syncChangeSchema>;

export const syncPullQuerySchema = z.object({
  /** Son başarılı pull cursor'ı; 0 = ilk senkronizasyon. */
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

export const syncPullResponseSchema = z.object({
  cursor: z.number(),
  hasMore: z.boolean(),
  changes: z.array(syncChangeSchema),
  /** Güncel kapsam snapshot'ı — cihaz, listede olmayan yerel proje verisini temizler. */
  accessibleProjectIds: z.array(z.string()),
  serverTime: z.string(),
});
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;

// ---------- Push yük şemaları (mutation türüne göre) ----------

export const pushAttendancePayloadSchema = z.object({
  projectId: z.string().min(1),
  personnelId: z.string().min(1),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftKey: z.string().min(1).default('GUNDUZ'),
  status: z.string().min(1),
  note: z.string().nullish(),
  checkInAt: z.string().nullish(),
  checkOutAt: z.string().nullish(),
});
export type PushAttendancePayload = z.infer<typeof pushAttendancePayloadSchema>;

export const pushTaskUpdatePayloadSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1).max(160).optional(),
  description: z.string().nullish(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeId: z.string().nullish(),
  dueAt: z.string().nullish(),
  checklist: z
    .array(z.object({ id: z.string(), label: z.string().min(1), done: z.boolean() }))
    .max(50)
    .optional(),
  /** İyimser eşzamanlılık: verilmemesi çakışma denetimini atlar (docs/04). */
  version: z.number().int().positive().optional(),
});
export type PushTaskUpdatePayload = z.infer<typeof pushTaskUpdatePayloadSchema>;

export const pushTaskCommentPayloadSchema = z.object({
  taskId: z.string().min(1),
  body: z.string().min(1).max(4000),
});
export type PushTaskCommentPayload = z.infer<typeof pushTaskCommentPayloadSchema>;

export const pushDailyReportPayloadSchema = z.object({
  /** Sunucu ID'si biliniyorsa güncelleme, yoksa taslak oluşturma. */
  reportId: z.string().nullish(),
  projectId: z.string().min(1),
  siteId: z.string().nullish(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weather: z.string().nullish(),
  workSummary: z.string().min(1),
  workforceSummary: z.string().nullish(),
  equipmentSummary: z.string().nullish(),
  issues: z.string().nullish(),
  safetyNotes: z.string().nullish(),
  nextDayPlan: z.string().nullish(),
  workers: z
    .array(
      z.object({
        name: z.string().min(1),
        jobTitle: z.string().nullish(),
        workerCount: z.number().int().min(0),
        hours: z.string(),
      }),
    )
    .max(100)
    .optional(),
});
export type PushDailyReportPayload = z.infer<typeof pushDailyReportPayloadSchema>;

export const pushExpensePayloadSchema = z.object({
  projectId: z.string().min(1),
  categoryId: z.string().min(1),
  vendorName: z.string().nullish(),
  description: z.string().min(1),
  /** Kanonik para string — 2 ondalık, BigInt matematiği sunucuda (docs/04). */
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3).default('TRY'),
  taxRate: z.string().nullish(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type PushExpensePayload = z.infer<typeof pushExpensePayloadSchema>;

export const pushStockMovementPayloadSchema = z.object({
  type: z.enum(['IN', 'OUT', 'TRANSFER', 'RETURN', 'ADJUSTMENT']),
  materialId: z.string().min(1),
  warehouseId: z.string().min(1),
  targetWarehouseId: z.string().nullish(),
  projectId: z.string().nullish(),
  /** 3 ondalık hassasiyet — DECIMAL(18,3) (docs/04). */
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  unit: z.string().nullish(),
  unitCost: z.string().nullish(),
  referenceType: z.enum(['PURCHASE', 'DAILY_REPORT', 'TASK', 'OTHER']).optional(),
  referenceId: z.string().nullish(),
  note: z.string().nullish(),
  occurredAt: z.string().optional(),
});
export type PushStockMovementPayload = z.infer<typeof pushStockMovementPayloadSchema>;
