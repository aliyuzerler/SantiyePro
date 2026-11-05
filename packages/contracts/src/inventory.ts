/**
 * ŞantiyePro — Depo, malzeme ve stok hareketi sözleşmeleri (Faz 07).
 *
 * Kurallar (prompts/phase-07-development.md, docs/04, docs/05):
 * - Hareket append-only: API'de hareket update/delete ucu YOKTUR; düzeltme
 *   yalnızca ters kayıt (REVERSAL) ile yapılır.
 * - Transfer, kaynak çıkış + hedef giriş olarak tek DB transaction'dadır.
 * - Negatif stok oluşamaz: bakiye düşüşü koşullu atomik UPDATE ile yapılır
 *   (WHERE quantity >= miktar) — iki eşzamanlı çıkışta en fazla biri geçer.
 * - Miktar politikası: DECIMAL(18,3); API'de ondalık string taşınır; 3
 *   basamaktan fazla ondalık GİRİŞ REDDEDİLİR (sessiz yuvarlama yoktur —
 *   yuvarlama politikası: istemcinin gönderdiği değer birebir saklanır).
 * - ADJUSTMENT işaretli miktardır (+/− sayım düzeltmesi); diğer tipler pozitiftir.
 * - REVERSAL istemciden doğrudan oluşturulamaz; yalnızca
 *   POST /inventory/movements/:id/reverse ile, tek seferlik (unique
 *   reversesMovementId) ve orijinali REVERSAL olmayan kayıtlara uygulanır.
 * - clientMutationId unique'tur: çevrimdışı kuyruk tekrarı aynı kaydı döner,
 *   stok ikinci kez düşmez (idempotency, docs/09).
 * - Her hareket aktör, zaman, proje/depo, açıklama ve opsiyonel belge
 *   referansı taşır (referenceType/referenceId).
 */
import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

// ---------- Hareket tipleri ----------

/** clientMutationId ile yaratılabilir tipler: REVERSAL hariç (ters kayıt özel uçtan). */
export const CREATABLE_MOVEMENT_TYPES = ['IN', 'OUT', 'TRANSFER', 'RETURN', 'ADJUSTMENT'] as const;
export type CreatableMovementType = (typeof CREATABLE_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_TYPES = [...CREATABLE_MOVEMENT_TYPES, 'REVERSAL'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  IN: 'Giriş',
  OUT: 'Çıkış',
  TRANSFER: 'Transfer',
  RETURN: 'İade',
  ADJUSTMENT: 'Düzeltme',
  REVERSAL: 'Ters Kayıt',
};

/** Kayıt içi kısa işaret (UI tabloları): IN ▲, OUT ▼, TRANSFER ⇄, RETURN ↩, ADJUSTMENT ±, REVERSAL ↺ */
export const STOCK_MOVEMENT_TYPE_SIGNS: Record<StockMovementType, string> = {
  IN: '▲',
  OUT: '▼',
  TRANSFER: '⇄',
  RETURN: '↩',
  ADJUSTMENT: '±',
  REVERSAL: '↺',
};

// ---------- Birim ----------

/** Varsayılan birimler; kuruma özel birim serbest metin olarak eklenebilir. */
export const DEFAULT_MATERIAL_UNITS = ['ADET', 'KG', 'TON', 'LT', 'M2', 'M3', 'METRE', 'PAKET', 'TAKIM', 'TORBA'] as const;
export type DefaultMaterialUnit = (typeof DEFAULT_MATERIAL_UNITS)[number];

export const unitSchema = z
  .string()
  .trim()
  .min(1, 'Birim boş olamaz')
  .max(16, 'Birim en fazla 16 karakterdir')
  .regex(/^[A-ZÇĞİÖŞÜ0-9.]+$/i, 'Birim yalnızca harf/rakam/nokta içerebilir');
export type MaterialUnit = string;

// ---------- Miktar ve para ----------

/** Pozitif miktar (IN/OUT/TRANSFER/RETURN). */
export const positiveQuantitySchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/, 'Miktar en fazla 3 ondalık basamaklı bir sayı olmalıdır (örn. 12.5)')
  .refine((v) => Number.parseFloat(v) > 0, 'Miktar sıfırdan büyük olmalıdır');

/** İşaretli miktar (yalnızca ADJUSTMENT): +/− izinli, sıfır geçersiz. */
export const signedQuantitySchema = z
  .string()
  .trim()
  .regex(/^-?(0|[1-9]\d{0,11})(\.\d{1,3})?$/, 'Düzeltme miktarı en fazla 3 ondalık basamaklı işaretli bir sayı olmalıdır')
  .refine((v) => Number.parseFloat(v) !== 0, 'Düzeltme miktarı sıfır olamaz');

/** Birim maliyet: para formatı, en fazla 4 ondalık (DECIMAL(18,4)). */
export const unitCostSchema = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,4})?$/, 'Birim maliyeti en fazla 4 ondalık basamaklı pozitif bir sayı olmalıdır');

// ---------- Ondalık aritmetik (3 basamak ölçek, BigInt) ----------

const Q_SCALE = 1_000n;

/** "12.345" → 12345n; "-12.5" → -12500n. Geçersiz girdi 0 döner (şemalar önceden doğrular). */
export function parseQuantity(q: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(q.trim());
  if (!m) return 0n;
  const [, sign, int = '0', frac = ''] = m;
  const scaled = BigInt(int) * Q_SCALE + BigInt((frac + '000').slice(0, 3));
  return (sign === '-' ? -1n : 1n) * scaled;
}

/** BigInt (ölçekli) → kanonik ondalık string; sondaki sıfırlar budanır ("12.500"→"12.5", "5000"→"5"). */
export function formatQuantity(scaled: bigint): string {
  const sign = scaled < 0n ? '-' : '';
  const abs = scaled < 0n ? -scaled : scaled;
  const int = abs / Q_SCALE;
  const frac = (abs % Q_SCALE).toString().padStart(3, '0').replace(/0+$/, '');
  return frac ? `${sign}${int}.${frac}` : `${sign}${int}`;
}

/** Kanonik ondalık string → kanonik ondalık string (normalize). */
export function normalizeQuantity(q: string): string {
  return formatQuantity(parseQuantity(q));
}

/** Ölçekli BigInt toplama. */
export function addQuantity(a: bigint, b: bigint): bigint {
  return a + b;
}

/** Kanonik ondalık string tersi ("-12.5"). */
export function negateQuantity(q: string): string {
  return formatQuantity(-parseQuantity(q));
}

export interface MovementSide {
  warehouseId: string;
  /** Bakiye değişimi: giriş +, çıkış −; kanonik ondalık string. */
  delta: string;
}

/**
 * Bir hareketin deponun bakiyesine etkisini hesaplar (test promptu:
 * "IN/OUT/TRANSFER/RETURN/ADJUSTMENT/REVERSAL iş kuralları" tek doğruluk kaynağı).
 * - IN / RETURN: tek depoya +q
 * - OUT: tek depoya −q
 * - ADJUSTMENT: tek depoya işaretli q
 * - TRANSFER: hedef depoya +q, kaynak depoya −q (tek transaction iki taraf)
 * - REVERSAL: bu fonksiyonla hesaplanmaz; orijinalin yanıtının tersi
 *   (`reverseDeltas`) kullanılır.
 */
export function movementDeltas(input: {
  type: StockMovementType;
  quantity: string;
  warehouseId: string;
  targetWarehouseId?: string | null;
}): MovementSide[] {
  const q = parseQuantity(input.quantity);
  switch (input.type) {
    case 'IN':
    case 'RETURN':
      return [{ warehouseId: input.warehouseId, delta: formatQuantity(q) }];
    case 'OUT':
      return [{ warehouseId: input.warehouseId, delta: formatQuantity(-q) }];
    case 'ADJUSTMENT':
      return [{ warehouseId: input.warehouseId, delta: formatQuantity(q) }];
    case 'TRANSFER':
      return [
        { warehouseId: input.targetWarehouseId ?? '', delta: formatQuantity(q) },
        { warehouseId: input.warehouseId, delta: formatQuantity(-q) },
      ];
    case 'REVERSAL':
      // REVERSAL doğrudan oluşturulamaz; ters çevirme servis katmanında
      // orijinal hareket üzerinden reverseDeltas() ile hesaplanır.
      return [];
    default:
      return [];
  }
}

/** Bir hareket grubunun toplam etkisi (aynı depo için birleşik). */
export function mergeDeltas(sides: MovementSide[]): MovementSide[] {
  const acc = new Map<string, bigint>();
  for (const side of sides) {
    const cur = acc.get(side.warehouseId) ?? 0n;
    acc.set(side.warehouseId, cur + parseQuantity(side.delta));
  }
  return [...acc.entries()].map(([warehouseId, value]) => ({ warehouseId, delta: formatQuantity(value) }));
}

/** Ters kaydın bakiye etkisi: orijinalin etkisinin birebir tersi (transferde taraf değişimi korunur). */
export function reverseDeltas(original: {
  type: StockMovementType;
  quantity: string;
  warehouseId: string;
  targetWarehouseId?: string | null;
}): MovementSide[] {
  return mergeDeltas(movementDeltas(original).map((s) => ({ warehouseId: s.warehouseId, delta: negateQuantity(s.delta) })));
}

// ---------- Belge referansı ----------

export const MOVEMENT_REFERENCE_TYPES = ['PURCHASE', 'DAILY_REPORT', 'TASK', 'OTHER'] as const;
export type MovementReferenceType = (typeof MOVEMENT_REFERENCE_TYPES)[number];

export const MOVEMENT_REFERENCE_TYPE_LABELS: Record<MovementReferenceType, string> = {
  PURCHASE: 'Satın Alma',
  DAILY_REPORT: 'Günlük Rapor',
  TASK: 'Görev',
  OTHER: 'Diğer',
};

// ---------- Malzeme ----------

export const materialCreateRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Malzeme kodu boş olamaz')
    .max(32, 'Malzeme kodu en fazla 32 karakterdir')
    .optional(),
  name: z.string().trim().min(2, 'Malzeme adı en az 2 karakter olmalıdır').max(120),
  category: z.string().trim().min(2, 'Kategori en az 2 karakter olmalıdır').max(40).optional(),
  unit: unitSchema.default('ADET'),
  minStock: z
    .string()
    .trim()
    .regex(/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/, 'Minimum stok en fazla 3 ondalık basamaklı bir sayı olmalıdır')
    .optional(),
});
export type MaterialCreateRequest = z.infer<typeof materialCreateRequestSchema>;

export const materialUpdateRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(32).nullable().optional(),
    name: z.string().trim().min(2, 'Malzeme adı en az 2 karakter olmalıdır').max(120).optional(),
    category: z.string().trim().min(2).max(40).nullable().optional(),
    unit: unitSchema.optional(),
    minStock: z
      .string()
      .trim()
      .regex(/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/, 'Minimum stok en fazla 3 ondalık basamaklı bir sayı olmalıdır')
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type MaterialUpdateRequest = z.infer<typeof materialUpdateRequestSchema>;

export const materialSortFieldsSchema = z.enum(['name', 'code', 'createdAt']);

export const materialListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  sort: materialSortFieldsSchema.default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type MaterialListQuery = z.infer<typeof materialListQuerySchema>;

export const materialDtoSchema = z.object({
  id: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  category: z.string().nullable(),
  unit: z.string(),
  minStock: z.string().nullable(),
  isActive: z.boolean(),
  createdById: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MaterialDto = z.infer<typeof materialDtoSchema>;

// ---------- Depo ----------

export const warehouseCreateRequestSchema = z.object({
  /** Boş/null = kurum genel merkezi deposu (proje kapsamı yok). */
  projectId: z.string().min(1).max(64).nullable().optional(),
  name: z.string().trim().min(2, 'Depo adı en az 2 karakter olmalıdır').max(80),
  location: z.string().trim().min(2, 'Konum en az 2 karakter olmalıdır').max(120).optional(),
});
export type WarehouseCreateRequest = z.infer<typeof warehouseCreateRequestSchema>;

export const warehouseUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(2, 'Depo adı en az 2 karakter olmalıdır').max(80).optional(),
    location: z.string().trim().min(2).max(120).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type WarehouseUpdateRequest = z.infer<typeof warehouseUpdateRequestSchema>;

export const warehouseListQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().min(1).max(64).optional(),
  /** 'true' yalnızca kurum deposu (projectId null); 'false' yalnızca proje deposu. */
  kurumOnly: z.enum(['true', 'false']).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  sort: z.enum(['name', 'createdAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type WarehouseListQuery = z.infer<typeof warehouseListQuerySchema>;

export const warehouseDtoSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  name: z.string(),
  location: z.string().nullable(),
  isActive: z.boolean(),
  createdById: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WarehouseDto = z.infer<typeof warehouseDtoSchema>;

// ---------- Hareket istekleri ----------

export const createMovementBaseSchema = z.object({
  type: z.enum(CREATABLE_MOVEMENT_TYPES),
  materialId: z.string().min(1, 'Malzeme seçilmelidir').max(64),
  warehouseId: z.string().min(1, 'Depo seçilmelidir').max(64),
  /** TRANSFER için zorunlu; kaynak ile aynı olamaz (refine). */
  targetWarehouseId: z.string().min(1).max(64).nullable().optional(),
  projectId: z.string().min(1).max(64).nullable().optional(),
  quantity: signedQuantitySchema,
  /** Birim uyumu: verilirse malzemenin birimiyle aynı olmalıdır (servis doğrular). */
  unit: unitSchema.optional(),
  unitCost: unitCostSchema.nullable().optional(),
  referenceType: z.enum(MOVEMENT_REFERENCE_TYPES).optional(),
  referenceId: z.string().min(1).max(64).optional(),
  note: z.string().trim().max(500, 'Açıklama en fazla 500 karakterdir').optional(),
  occurredAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Geçerli bir tarih-saat girilmelidir')
    .optional(),
  /** Çevrimdışı kuyruk idempotency anahtarı (docs/09) — unique. */
  clientMutationId: z.string().min(8).max(64).optional(),
});

export const createMovementRequestSchema = createMovementBaseSchema
  .refine((v) => v.type !== 'TRANSFER' || Boolean(v.targetWarehouseId), {
    message: 'Transfer için hedef depo seçilmelidir',
    path: ['targetWarehouseId'],
  })
  .refine((v) => v.type !== 'TRANSFER' || v.targetWarehouseId !== v.warehouseId, {
    message: 'Transfer kaynak ve hedef depo aynı olamaz',
    path: ['targetWarehouseId'],
  })
  .refine((v) => v.type === 'ADJUSTMENT' || parseQuantity(v.quantity) > 0n, {
    message: 'Yalnızca düzeltme hareketi negatif miktar alabilir',
    path: ['quantity'],
  })
  .refine((v) => v.type !== 'ADJUSTMENT' || Boolean(v.note && v.note.length >= 3), {
    message: 'Düzeltme hareketi için en az 3 karakterlik açıklama zorunludur',
    path: ['note'],
  });
export type CreateMovementRequest = z.infer<typeof createMovementRequestSchema>;

export const movementSortFieldsSchema = z.enum(['occurredAt', 'createdAt']);

export const movementListQuerySchema = paginationQuerySchema
  .extend({
    projectId: z.string().min(1).max(64).optional(),
    warehouseId: z.string().min(1).max(64).optional(),
    materialId: z.string().min(1).max(64).optional(),
    type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-MM-DD biçiminde olmalıdır')
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-MM-DD biçiminde olmalıdır')
      .optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: movementSortFieldsSchema.default('occurredAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((v) => Boolean(v.projectId || v.warehouseId || v.materialId), {
    message: 'Hareket listesi en az proje, depo veya malzeme filtresiyle sınırlandırılmalıdır',
  });
export type MovementListQuery = z.infer<typeof movementListQuerySchema>;

// ---------- Ters kayıt ----------

export const reverseMovementRequestSchema = z.object({
  /** Ters kayıt gerekçesi — hareketin notuna eklenir; denetlenebilirlik için zorunlu. */
  reason: z.string().trim().min(3, 'Ters kayıt gerekçesi en az 3 karakter olmalıdır').max(500),
});
export type ReverseMovementRequest = z.infer<typeof reverseMovementRequestSchema>;

// ---------- Bakiye ----------

export const balanceListQuerySchema = z
  .object({
    warehouseId: z.string().min(1).max(64).optional(),
    materialId: z.string().min(1).max(64).optional(),
    projectId: z.string().min(1).max(64).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    /** true: yalnızca minimum stok altındaki kartlar. */
    lowStock: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .refine((v) => Boolean(v.warehouseId || v.materialId || v.projectId), {
    message: 'Bakiye listesi en az depo, malzeme veya proje filtresiyle sınırlandırılmalıdır',
  });
export type BalanceListQuery = z.infer<typeof balanceListQuerySchema>;

// ---------- DTO'lar ----------

export const stockBalanceDtoSchema = z.object({
  materialId: z.string(),
  materialName: z.string(),
  materialCode: z.string().nullable(),
  unit: z.string(),
  minStock: z.string().nullable(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  quantity: z.string(),
  isLow: z.boolean(),
  lastMovementAt: z.string(),
});
export type StockBalanceDto = z.infer<typeof stockBalanceDtoSchema>;

export const stockUserSummarySchema = z.object({
  id: z.string(),
  fullName: z.string(),
});
export type StockUserSummary = z.infer<typeof stockUserSummarySchema>;

export const stockMovementDtoSchema = z.object({
  id: z.string(),
  type: z.enum(STOCK_MOVEMENT_TYPES),
  materialId: z.string(),
  materialName: z.string(),
  materialCode: z.string().nullable(),
  unit: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  targetWarehouseId: z.string().nullable(),
  targetWarehouseName: z.string().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  /** Kanonik ondalık string; ADJUSTMENT işaretli olabilir, diğerleri pozitiftir. */
  quantity: z.string(),
  unitCost: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  note: z.string().nullable(),
  occurredAt: z.string(),
  createdById: z.string(),
  createdBy: stockUserSummarySchema,
  reversesMovementId: z.string().nullable(),
  clientMutationId: z.string().nullable(),
  createdAt: z.string(),
});
export type StockMovementDto = z.infer<typeof stockMovementDtoSchema>;
