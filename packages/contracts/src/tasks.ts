/**
 * ŞantiyePro — Görev sözleşmeleri (Faz 04).
 *
 * Kurallar (prompts/phase-04-development.md, docs/04, docs/06):
 * - Durum akışı kurallıdır: TODO, IN_PROGRESS, BLOCKED, DONE, CANCELLED.
 *   Geçersiz geçiş 400 VALIDATION_ERROR döner (servis katmanı, contracts matrisi).
 * - DONE ve CANCELLED terminaldir; yeniden açma MVP kapsamı dışındadır.
 * - Termin (dueAt) timezone'lu ISO 8601 datetime olarak taşınır; gecikme
 *   hesabı contracts'taki tek doğruluk kaynağından (isTaskOverdue) yapılır.
 * - Checklist ve dosya referansları tam liste değişimiyle güncellenir
 *   (offline-first sync Faz 09'da item-level operasyonlara genişleyebilir).
 * - Sürüm (version) alanı iyimser eşzamanlılık içindir: eski sürümle güncelleme
 *   409 CONFLICT döner.
 */
import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

/** Sıralama yönü (public tanım projects.ts'te export edilir; burada lokal kullanılır). */
const sortDirectionSchema = z.enum(['asc', 'desc']);

// ---------- Görev durumu ----------

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'Yapılacak',
  IN_PROGRESS: 'Devam Ediyor',
  BLOCKED: 'Engelli',
  DONE: 'Tamamlandı',
  CANCELLED: 'İptal Edildi',
};

export const taskStatusSchema = z.enum(TASK_STATUSES);

/**
 * Görev durum geçiş matrisi — geçersiz geçiş 400 VALIDATION_ERROR döner.
 * DONE / CANCELLED terminaldir.
 */
const TASK_STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['TODO', 'BLOCKED', 'DONE', 'CANCELLED'],
  BLOCKED: ['TODO', 'IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  return TASK_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Bir durumdan çıkılabilecek hedef durumlar (UI butonları için). */
export function nextTaskStatuses(from: TaskStatus): readonly TaskStatus[] {
  return TASK_STATUS_TRANSITIONS[from] ?? [];
}

// ---------- Öncelik ----------

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'Düşük',
  MEDIUM: 'Orta',
  HIGH: 'Yüksek',
  CRITICAL: 'Kritik',
};

export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

// ---------- Checklist / dosya referansı ----------

export const taskChecklistItemSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1, 'Kontrol listesi kalemi boş olamaz').max(240),
  done: z.boolean().default(false),
});
export type TaskChecklistItem = z.infer<typeof taskChecklistItemSchema>;

/** Yeni checklist kalemi — id sunucu/istemci tarafından üretilir. */
export const taskChecklistItemInputSchema = z.object({
  label: z.string().min(1, 'Kontrol listesi kalemi boş olamaz').max(240),
  done: z.boolean().default(false),
});

export const taskFileRefSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(240),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().min(0).optional(),
});
export type TaskFileRef = z.infer<typeof taskFileRefSchema>;

// ---------- Ortak özetler ----------

export const taskUserSummarySchema = z.object({
  id: z.string(),
  fullName: z.string(),
});
export type TaskUserSummary = z.infer<typeof taskUserSummarySchema>;

// ---------- Gecikme hesabı (tek doğruluk kaynağı) ----------

/** Termin geçti mi? DONE / CANCELLED görevler gecikmiş sayılmaz. */
export function isTaskOverdue(
  task: { dueAt: string | null; status: TaskStatus },
  now: Date = new Date(),
): boolean {
  if (!task.dueAt) return false;
  if (task.status === 'DONE' || task.status === 'CANCELLED') return false;
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}

// ---------- DTO'lar ----------

export const taskDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectCode: z.string().optional(),
  projectName: z.string().optional(),
  siteId: z.string().nullable().optional(),
  siteName: z.string().nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assigneeId: z.string().nullable().optional(),
  assignee: taskUserSummarySchema.nullable().optional(),
  /** Timezone'lu ISO 8601; timezone-safe termin karşılaştırması için. */
  dueAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  checklist: z.array(taskChecklistItemSchema),
  fileRefs: z.array(taskFileRefSchema),
  commentCount: z.number().int().min(0),
  /** İyimser eşzamanlılık: her güncellemede +1 artar (docs/04). */
  version: z.number().int().min(1),
  /** Sunucuda hesaplanmış gecikme bayrağı (isTaskOverdue). */
  overdue: z.boolean(),
  createdById: z.string(),
  createdBy: taskUserSummarySchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskDto = z.infer<typeof taskDtoSchema>;

export const taskCommentDtoSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string(),
  userFullName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type TaskCommentDto = z.infer<typeof taskCommentDtoSchema>;

export const taskStatusHistoryEntrySchema = z.object({
  id: z.number().int(),
  fromStatus: taskStatusSchema.nullable(),
  toStatus: taskStatusSchema,
  changedById: z.string(),
  changedByFullName: z.string(),
  changedAt: z.string(),
});
export type TaskStatusHistoryEntry = z.infer<typeof taskStatusHistoryEntrySchema>;

export const taskDetailDtoSchema = taskDtoSchema.extend({
  comments: z.array(taskCommentDtoSchema),
  statusHistory: z.array(taskStatusHistoryEntrySchema),
});
export type TaskDetailDto = z.infer<typeof taskDetailDtoSchema>;

// ---------- Liste sorgusu ----------

export const taskSortFieldsSchema = z.enum(['createdAt', 'dueAt', 'priority', 'title']);

export const taskListQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().min(1).max(64).optional(),
  siteId: z.string().min(1).max(64).optional(),
  /** 'me' → oturum sahibine atanan görevler (Bana Atananlar). */
  assigneeId: z.string().min(1).max(64).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  /** 'true' → termin geçmiş ve hâlâ açık görevler. */
  overdue: z.enum(['true', 'false']).optional(),
  search: z.string().max(160).optional(),
  sort: taskSortFieldsSchema.default('createdAt'),
  order: sortDirectionSchema.default('desc'),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

// ---------- Oluşturma / güncelleme ----------

/** Timezone'lu ISO 8601 datetime (Z veya ofsetli). */
export const isoDateTimeSchema = z
  .string()
  .min(1, 'Termin gereklidir')
  .refine(
    (v) => !Number.isNaN(new Date(v).getTime()) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v),
    'Termin ISO 8601 tarih-saat biçiminde olmalıdır',
  );

export const createTaskRequestSchema = z.object({
  projectId: z.string().min(1, 'Proje seçilmelidir').max(64),
  siteId: z.string().min(1).max(64).nullable().optional(),
  title: z.string().min(3, 'Görev başlığı en az 3 karakter olmalıdır').max(200),
  description: z.string().max(4000).optional(),
  priority: taskPrioritySchema.default('MEDIUM'),
  assigneeId: z.string().min(1).max(64).nullable().optional(),
  dueAt: isoDateTimeSchema.nullable().optional(),
  checklist: z.array(taskChecklistItemInputSchema).max(50).optional(),
  fileRefs: z.array(taskFileRefSchema).max(20).optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z
  .object({
    title: z.string().min(3).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    siteId: z.string().min(1).max(64).nullable().optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeId: z.string().min(1).max(64).nullable().optional(),
    dueAt: isoDateTimeSchema.nullable().optional(),
    checklist: z.array(taskChecklistItemSchema).max(50).optional(),
    fileRefs: z.array(taskFileRefSchema).max(20).optional(),
    /** İyimser eşzamanlılık: gönderilirse sunucudaki sürümle eşleşmelidir. */
    version: z.number().int().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

export const addTaskCommentRequestSchema = z.object({
  body: z.string().min(1, 'Yorum boş olamaz').max(4000),
});
export type AddTaskCommentRequest = z.infer<typeof addTaskCommentRequestSchema>;
