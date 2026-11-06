/**
 * ŞantiyePro — Gider ve hakediş sözleşmeleri (Faz 08).
 *
 * Kurallar (prompts/phase-08-development.md, docs/04, docs/05, docs/06):
 * - Vergi/tevkifat oranı UYDURULMAZ: taxRate opsiyoneldir, varsayılan oran
 *   eklenmez; vergi tutarı yalnızca verilmişse türetilir (gösterim amaçlı).
 * - Hesaplamalar bu dosyadaki saf fonksiyonlarda, BigInt ölçekli aritmetikle
 *   yapılır (floating point hatası yoktur); yuvarlama politikası AÇIK:
 *   para 2 ondalık, YARIM YUKARI (HALF_UP) — 0.005 → 0.01.
 * - Hakediş satırında FİYAT SNAPSHOT'I saklanır: sözleşme kalemi fiyatı
 *   sonradan değişse bile onaylı/draft hakediş eski fiyatla durur.
 * - Onaylı hakediş değiştirilemez/silinemez (PATCH/DELETE yalnızca DRAFT);
 *   iptal yalnızca DRAFT/PENDING'dedir — onay SONRASI düzeltme, yeni
 *   (mahsup) hakedişle yapılır; geçmiş asla yeniden hesaplanmaz.
 * - claimNo proje başına benzersizdir; dönemler (REJECTED/CANCELLED hariç)
 *   üst üste binemez; satırın previousQuantity değeri, önceki hakedişteki
 *   kümülatif miktarla zincirlidir (uydurma geçmiş engellenir).
 * - Tutarlar API'de kanonik ondalık string taşınır; UI sağa hizalı gösterir
 *   ve para birimini açık yazar.
 */
import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';
import { currencySchema } from './projects.js';

export { currencySchema };

// ---------- Para ve oran şemaları ----------

/** Para tutarı: pozitif, en fazla 2 ondalık (DECIMAL(18,2)), 12 haneli tamsayı kısmı. */
export const moneyAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Tutar en fazla 2 ondalık basamaklı pozitif bir sayı olmalıdır (örn. 1250.50)')
  .refine((v) => parseMoney(v) > 0n, 'Tutar sıfırdan büyük olmalıdır');

/** Kesinti toplamı: 0 veya pozitif (DECIMAL(18,2)). */
export const nonNegativeMoneySchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,12})(\.\d{1,2})?$/, 'Kesinti 0 veya daha büyük, en fazla 2 ondalık basamaklı bir sayı olmalıdır');

/** Birim fiyat: pozitif, en fazla 4 ondalık (DECIMAL(18,4)). */
export const unitPriceSchema = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,4})?$/, 'Birim fiyat en fazla 4 ondalık basamaklı pozitif bir sayı olmalıdır')
  .refine((v) => parseUnitPrice(v) > 0n, 'Birim fiyat sıfırdan büyük olmalıdır');

/**
 * Vergi oranı: OPSİYONEL — verilmezse hiçbir varsayılan oran uygulanmaz
 * (uydurma yasal hesap yasak, prompts/phase-08). 0–100 arası, 2 ondalık.
 */
export const taxRateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Vergi oranı 0–100 arası, en fazla 2 ondalık basamaklı bir sayı olmalıdır')
  .refine((v) => Number.parseFloat(v) <= 100, 'Vergi oranı 100’ü geçemez');

/** Para birimi: ISO 4217 benzeri 3 büyük harf; varsayılan TRY (projects.ts'deki ortak şema). */

/** UI seçenekleri; API serbest ISO-4217 benzeri 3 harf kabul eder. */
export const DEFAULT_CURRENCIES = ['TRY', 'USD', 'EUR'] as const;

// ---------- Ondalık aritmetik (BigInt, floating point yok) ----------

const MONEY_SCALE = 100n; // 2 ondalık
const QTY_SCALE = 1_000n; // 3 ondalık (miktar)
const PRICE_SCALE = 10_000n; // 4 ondalık (birim fiyat)

/** "1234.56" → 123456n; "-12.5" → -1250n. Geçersiz girdi 0n döner. */
export function parseMoney(v: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return 0n;
  const [, sign, int = '0', frac = ''] = m;
  const scaled = BigInt(int) * MONEY_SCALE + BigInt((frac + '00').slice(0, 2));
  return (sign === '-' ? -1n : 1n) * scaled;
}

/** BigInt (2 ondalık ölçekli) → kanonik para string ("1234.5"→"1234.50"). */
export function formatMoney(scaled: bigint): string {
  const sign = scaled < 0n ? '-' : '';
  const abs = scaled < 0n ? -scaled : scaled;
  const int = abs / MONEY_SCALE;
  const frac = (abs % MONEY_SCALE).toString().padStart(2, '0');
  return `${sign}${int}.${frac}`;
}

/** "245.7500" → 2457500n (4 ondalık ölçekli). Geçersiz girdi 0n. */
export function parseUnitPrice(v: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(v.trim());
  if (!m) return 0n;
  const [, int = '0', frac = ''] = m;
  return BigInt(int) * PRICE_SCALE + BigInt((frac + '0000').slice(0, 4));
}

/** 4 ondalık ölçekli BigInt → kanonik birim fiyat string; sondaki sıfırlar budanır. */
export function formatUnitPrice(scaled: bigint): string {
  const int = scaled / PRICE_SCALE;
  const frac = (scaled % PRICE_SCALE).toString().padStart(4, '0').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : `${int}`;
}

/** Miktar × birim fiyat → para (2 ondalık, YARIM YUKARI). 250 x "245.75" → "61437.50". */
export function multiplyQtyPrice(quantity: string, unitPrice: string): string {
  const q = parseQuantityScaled(quantity);
  const p = parseUnitPrice(unitPrice);
  // Ölçekler: 1e3 × 1e4 = 1e7; para ölçeği 1e2 → 1e5'e böl, yarım yukarı.
  const product = q * p; // işaret: miktar pozitifse pozitif
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + 50_000n) / 100_000n;
  return formatMoney(negative ? -rounded : rounded);
}

/** Miktar (3 ondalık) → ölçekli BigInt; parseQuantity ile aynı semantik. */
function parseQuantityScaled(v: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(v.trim());
  if (!m) return 0n;
  const [, sign, int = '0', frac = ''] = m;
  const scaled = BigInt(int) * QTY_SCALE + BigInt((frac + '000').slice(0, 3));
  return (sign === '-' ? -1n : 1n) * scaled;
}

/**
 * Vergi tutarı = tutar × oran / 100 (2 ondalık, YARIM YUKARI).
 * Ölçek analizi: a (1e2) × r (1e2) = 1e4 ölçekli çarpım; formüldeki /100 ve
 * para ölçeğine (1e2) iniş birlikte /1e4 eder → tek adımda yarım yukarı bölme.
 * Örn: 1000.00 × %20 → 200.00; 0.01 × %50 → 0.005 → 0.01 (yarım yukarı).
 */
export function expenseTaxAmount(amount: string, taxRate: string): string {
  const a = parseMoney(amount);
  const r = parseMoney(taxRate);
  const product = a * r;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + 5_000n) / 10_000n;
  return formatMoney(negative ? -rounded : rounded);
}

// ---------- Hakediş hesaplama (domain, saf fonksiyonlar) ----------

export interface ClaimLineInput {
  /** Önceki hakedişlerden gelen kümülatif miktar (zincir doğrulaması serviste). */
  previousQuantity: string;
  /** Bu dönemin miktarı (>0). */
  periodQuantity: string;
  /** Kalem fiyatı snapshot'ı (4 ondalık). */
  unitPrice: string;
}

export interface ClaimLineComputed {
  previousQuantity: string;
  periodQuantity: string;
  cumulativeQuantity: string;
  unitPriceSnapshot: string;
  previousAmount: string;
  lineAmount: string;
  cumulativeAmount: string;
}

/**
 * Tek satır hakediş hesabı — formül (UI'da aynen gösterilir):
 *   Kümülatif = Önceki + Dönem
 *   Dönem tutarı = Dönem miktarı × Birim fiyat(snapshot), 2 ondalık yarım yukarı
 *   Kümülatif tutarı = Kümülatif miktar × Birim fiyat(snapshot)
 *   Önceki tutarı = Kümülatif tutarı − Dönem tutarı (kimlik bozulmaz)
 */
export function computeClaimLine(input: ClaimLineInput): ClaimLineComputed {
  const prev = parseQuantityScaled(input.previousQuantity);
  const period = parseQuantityScaled(input.periodQuantity);
  const cumulative = prev + period;
  const price = formatUnitPrice(parseUnitPrice(input.unitPrice));
  const lineAmount = multiplyQtyPrice(formatQuantityScaled(period), price);
  const cumulativeAmount = multiplyQtyPrice(formatQuantityScaled(cumulative), price);
  const previousAmount = formatMoney(parseMoney(cumulativeAmount) - parseMoney(lineAmount));
  return {
    previousQuantity: formatQuantityScaled(prev),
    periodQuantity: formatQuantityScaled(period),
    cumulativeQuantity: formatQuantityScaled(cumulative),
    unitPriceSnapshot: price,
    previousAmount,
    lineAmount,
    cumulativeAmount,
  };
}

export interface ClaimTotalsInput {
  lines: Array<Pick<ClaimLineComputed, 'lineAmount' | 'previousAmount'>>;
  /** Kesinti toplamı (≥0); brütü aşamaz (servis 400 ile reddeder). */
  deductionTotal: string;
  /** Zincirin önceki hakedişinin kümülatif toplamı (yoksa 0). */
  previousTotal: string;
}

export interface ClaimTotals {
  previousTotal: string;
  grossTotal: string;
  cumulativeTotal: string;
  deductionTotal: string;
  netTotal: string;
}

/**
 * Hakediş toplamları:
 *   Brüt = Σ dönem tutarı
 *   Kümülatif = Önceki toplam (zincirden) + Brüt
 *   Net = Brüt − Kesinti
 */
export function computeClaimTotals(input: ClaimTotalsInput): ClaimTotals {
  let gross = 0n;
  for (const line of input.lines) gross += parseMoney(line.lineAmount);
  const deduction = parseMoney(input.deductionTotal);
  const previous = parseMoney(input.previousTotal);
  return {
    previousTotal: formatMoney(previous),
    grossTotal: formatMoney(gross),
    cumulativeTotal: formatMoney(previous + gross),
    deductionTotal: formatMoney(deduction),
    netTotal: formatMoney(gross - deduction),
  };
}

/** Formül açıklaması — onay önizlemesinde ve hakediş detayında aynen gösterilir. */
export const CLAIM_FORMULA_DESCRIPTION =
  'Dönem tutarı = Dönem miktarı × Birim fiyat (hakediş anındaki snapshot). ' +
  'Brüt toplam = Σ dönem tutarları. Kümülatif = Önceki hakediş toplamı + Brüt. ' +
  'Net tutar = Brüt − Kesintiler. Onaydan sonra değerler dondurulur; sözleşme fiyatı değişse bile eski hakediş değişmez.';

function formatQuantityScaled(scaled: bigint): string {
  const sign = scaled < 0n ? '-' : '';
  const abs = scaled < 0n ? -scaled : scaled;
  const int = abs / QTY_SCALE;
  const frac = (abs % QTY_SCALE).toString().padStart(3, '0').replace(/0+$/, '');
  return frac ? `${sign}${int}.${frac}` : `${sign}${int}`;
}

// ---------- Gider kategorisi ----------

export const expenseCategoryCreateRequestSchema = z.object({
  name: z.string().trim().min(2, 'Kategori adı en az 2 karakter olmalıdır').max(60),
});
export type ExpenseCategoryCreateRequest = z.infer<typeof expenseCategoryCreateRequestSchema>;

export const expenseCategoryUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(2, 'Kategori adı en az 2 karakter olmalıdır').max(60).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type ExpenseCategoryUpdateRequest = z.infer<typeof expenseCategoryUpdateRequestSchema>;

export const expenseCategoryListQuerySchema = z.object({
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
export type ExpenseCategoryListQuery = z.infer<typeof expenseCategoryListQuerySchema>;

export const expenseCategoryDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExpenseCategoryDto = z.infer<typeof expenseCategoryDtoSchema>;

// ---------- Gider ----------

export const EXPENSE_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  DRAFT: 'Taslak',
  PENDING: 'Onay Bekliyor',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
};

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-MM-DD biçiminde olmalıdır');

export const expenseCreateRequestSchema = z.object({
  projectId: z.string().min(1, 'Proje seçilmelidir').max(64),
  categoryId: z.string().min(1, 'Kategori seçilmelidir').max(64),
  vendorName: z.string().trim().min(2, 'Tedarikçi en az 2 karakter olmalıdır').max(120).optional(),
  description: z.string().trim().min(3, 'Açıklama en az 3 karakter olmalıdır').max(500),
  amount: moneyAmountSchema,
  currency: currencySchema.default('TRY'),
  /** OPSİYONEL: verilmezse vergi hesaplanmaz, varsayılan oran eklenmez. */
  taxRate: taxRateSchema.nullable().optional(),
  expenseDate: dateStringSchema,
  /** Fiş/fatura eki (Faz 05 medya deposu; scan CLEAN olan dosyalar). */
  receiptMediaId: z.string().min(1).max(64).nullable().optional(),
});
export type ExpenseCreateRequest = z.infer<typeof expenseCreateRequestSchema>;

export const expenseUpdateRequestSchema = z
  .object({
    categoryId: z.string().min(1).max(64).optional(),
    vendorName: z.string().trim().min(2).max(120).nullable().optional(),
    description: z.string().trim().min(3, 'Açıklama en az 3 karakter olmalıdır').max(500).optional(),
    amount: moneyAmountSchema.optional(),
    currency: currencySchema.optional(),
    taxRate: taxRateSchema.nullable().optional(),
    expenseDate: dateStringSchema.optional(),
    receiptMediaId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type ExpenseUpdateRequest = z.infer<typeof expenseUpdateRequestSchema>;

export const expenseSortFieldsSchema = z.enum(['expenseDate', 'createdAt', 'amount']);

/**
 * Finansal veri koruması: liste en az bir filtreyle sınırlandırılır
 * (stok hareketi kuralıyla aynı aile, docs/08 performans kuralı).
 */
export const expenseListQuerySchema = paginationQuerySchema
  .extend({
    projectId: z.string().min(1).max(64).optional(),
    categoryId: z.string().min(1).max(64).optional(),
    status: z.enum(EXPENSE_STATUSES).optional(),
    dateFrom: dateStringSchema.optional(),
    dateTo: dateStringSchema.optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: expenseSortFieldsSchema.default('expenseDate'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine(
    (v) => Boolean(v.projectId || v.categoryId || v.status || v.dateFrom || v.dateTo || v.search),
    { message: 'Gider listesi en az proje, kategori, durum veya tarih filtresiyle sınırlandırılmalıdır' },
  );
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;

export const expenseUserSummarySchema = z.object({
  id: z.string(),
  fullName: z.string(),
});
export type ExpenseUserSummary = z.infer<typeof expenseUserSummarySchema>;

export const expenseDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  vendorName: z.string().nullable(),
  description: z.string(),
  /** Kanonik para string (2 ondalık). */
  amount: z.string(),
  currency: z.string(),
  taxRate: z.string().nullable(),
  /** taxRate verilmişse türetilen vergi tutarı; aksi halde null (uydurma yok). */
  taxAmount: z.string().nullable(),
  totalWithTax: z.string().nullable(),
  expenseDate: z.string(),
  status: z.enum(EXPENSE_STATUSES),
  receiptMediaId: z.string().nullable(),
  submittedAt: z.string().nullable(),
  approvedById: z.string().nullable(),
  approvedBy: expenseUserSummarySchema.nullable(),
  approvedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  createdById: z.string(),
  createdBy: expenseUserSummarySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExpenseDto = z.infer<typeof expenseDtoSchema>;

export const expenseDecisionRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Red gerekçesi en az 3 karakter olmalıdır').max(500),
});
export type ExpenseDecisionRequest = z.infer<typeof expenseDecisionRequestSchema>;

// ---------- Sözleşme kalemi ----------

export const contractItemCreateRequestSchema = z.object({
  projectId: z.string().min(1, 'Proje seçilmelidir').max(64),
  code: z.string().trim().min(1, 'Kalem kodu boş olamaz').max(32).optional(),
  description: z.string().trim().min(3, 'Kalem açıklaması en az 3 karakter olmalıdır').max(200),
  unit: z
    .string()
    .trim()
    .min(1, 'Birim boş olamaz')
    .max(16, 'Birim en fazla 16 karakterdir'),
  contractQuantity: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,3})?$/, 'Sözleşme miktarı en fazla 3 ondalık basamaklı bir sayı olmalıdır')
    .refine((v) => Number.parseFloat(v) > 0, 'Sözleşme miktarı sıfırdan büyük olmalıdır'),
  unitPrice: unitPriceSchema,
  currency: currencySchema.default('TRY'),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type ContractItemCreateRequest = z.infer<typeof contractItemCreateRequestSchema>;

export const contractItemUpdateRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(32).nullable().optional(),
    description: z.string().trim().min(3).max(200).optional(),
    unit: z.string().trim().min(1).max(16).optional(),
    contractQuantity: z
      .string()
      .trim()
      .regex(/^\d{1,9}(\.\d{1,3})?$/, 'Sözleşme miktarı en fazla 3 ondalık basamaklı bir sayı olmalıdır')
      .optional(),
    /** Fiyat değişikliği yalnızca YENİ hakedişleri etkiler (snapshot koruması). */
    unitPrice: unitPriceSchema.optional(),
    currency: currencySchema.optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type ContractItemUpdateRequest = z.infer<typeof contractItemUpdateRequestSchema>;

export const contractItemListQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().min(1, 'Sözleşme kalemleri proje kapsamında listelenir').max(64),
  search: z.string().trim().min(1).max(120).optional(),
});
export type ContractItemListQuery = z.infer<typeof contractItemListQuerySchema>;

export const contractItemDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  code: z.string().nullable(),
  description: z.string(),
  unit: z.string(),
  contractQuantity: z.string(),
  unitPrice: z.string(),
  currency: z.string(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContractItemDto = z.infer<typeof contractItemDtoSchema>;

// ---------- Hakediş ----------

export const PROGRESS_CLAIM_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ProgressClaimStatus = (typeof PROGRESS_CLAIM_STATUSES)[number];

export const PROGRESS_CLAIM_STATUS_LABELS: Record<ProgressClaimStatus, string> = {
  DRAFT: 'Taslak',
  PENDING: 'Onay Bekliyor',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  CANCELLED: 'İptal',
};

export const claimNoSchema = z
  .number()
  .int('Hakediş numarası tam sayı olmalıdır')
  .min(1, 'Hakediş numarası 1’den başlar')
  .max(9999, 'Hakediş numarası en fazla 9999’dur');

export const claimLineInputSchema = z.object({
  contractItemId: z.string().min(1, 'Sözleşme kalemi seçilmelidir').max(64),
  /** Zincir kuralı: önceki hakedişteki kümülatif miktarla aynı olmalıdır (servis 400). */
  previousQuantity: z
    .string()
    .trim()
    .regex(/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/, 'Önceki miktar en fazla 3 ondalık basamaklı bir sayı olmalıdır'),
  periodQuantity: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,3})?$/, 'Dönem miktarı en fazla 3 ondalık basamaklı bir sayı olmalıdır')
    .refine((v) => Number.parseFloat(v) > 0, 'Dönem miktarı sıfırdan büyük olmalıdır'),
});
export type ClaimLineInput2 = z.infer<typeof claimLineInputSchema>;

export const progressClaimCreateRequestSchema = z
  .object({
    projectId: z.string().min(1, 'Proje seçilmelidir').max(64),
    claimNo: claimNoSchema,
    periodStart: dateStringSchema,
    periodEnd: dateStringSchema,
    notes: z.string().trim().max(500, 'Not en fazla 500 karakterdir').optional(),
    /** Kesinti: 0 veya pozitif; brütü aşamaz (servis 400). */
    deductionTotal: nonNegativeMoneySchema.default('0'),
    lines: z.array(claimLineInputSchema).min(1, 'En az bir hakediş satırı girilmelidir').max(200),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: 'Dönem bitişi başlangıçtan önce olamaz',
    path: ['periodEnd'],
  });
export type ProgressClaimCreateRequest = z.infer<typeof progressClaimCreateRequestSchema>;

export const progressClaimUpdateRequestSchema = z
  .object({
    periodStart: dateStringSchema.optional(),
    periodEnd: dateStringSchema.optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    deductionTotal: nonNegativeMoneySchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Güncellenecek alan belirtilmelidir' });
export type ProgressClaimUpdateRequest = z.infer<typeof progressClaimUpdateRequestSchema>;

export const progressClaimLineReplaceSchema = z.object({
  lines: z.array(claimLineInputSchema).min(1, 'En az bir hakediş satırı girilmelidir').max(200),
});
export type ProgressClaimLineReplace = z.infer<typeof progressClaimLineReplaceSchema>;

export const progressClaimListQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().min(1, 'Hakediş listesi proje kapsamında istenmelidir').max(64),
  status: z.enum(PROGRESS_CLAIM_STATUSES).optional(),
  sort: z.enum(['periodStart', 'claimNo', 'createdAt']).default('periodStart'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ProgressClaimListQuery = z.infer<typeof progressClaimListQuerySchema>;

export const claimCancelRequestSchema = z.object({
  reason: z.string().trim().min(3, 'İptal gerekçesi en az 3 karakter olmalıdır').max(500),
});
export type ClaimCancelRequest = z.infer<typeof claimCancelRequestSchema>;

export const claimLineDtoSchema = z.object({
  id: z.string(),
  contractItemId: z.string(),
  code: z.string().nullable(),
  description: z.string(),
  unit: z.string(),
  contractQuantity: z.string(),
  previousQuantity: z.string(),
  periodQuantity: z.string(),
  cumulativeQuantity: z.string(),
  unitPriceSnapshot: z.string(),
  lineAmount: z.string(),
  /** Kümülatif > sözleşme miktarı (aşım) — uyarı göstergesi; engellenmez. */
  isOver: z.boolean(),
});
export type ClaimLineDto = z.infer<typeof claimLineDtoSchema>;

export const progressClaimDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  claimNo: z.number(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.enum(PROGRESS_CLAIM_STATUSES),
  previousTotal: z.string(),
  grossTotal: z.string(),
  cumulativeTotal: z.string(),
  deductionTotal: z.string(),
  netTotal: z.string(),
  notes: z.string().nullable(),
  formulaDescription: z.string(),
  lines: z.array(claimLineDtoSchema),
  createdById: z.string(),
  createdBy: expenseUserSummarySchema,
  approvedById: z.string().nullable(),
  approvedBy: expenseUserSummarySchema.nullable(),
  approvedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProgressClaimDto = z.infer<typeof progressClaimDtoSchema>;

/**
 * Hesaplama önizlemesi (POST /progress-claims/:id/calculate):
 * PERSIST ETMEZ; formül açıklaması + satır ve toplam önizlemesi döner.
 */
export const claimCalculationDtoSchema = z.object({
  claimId: z.string(),
  status: z.enum(PROGRESS_CLAIM_STATUSES),
  /** true: önizleme yeniden hesaplandı (yalnızca DRAFT); false: saklanan değerler. */
  recalculated: z.boolean(),
  formulaDescription: z.string(),
  lines: z.array(claimLineDtoSchema),
  totals: z.object({
    previousTotal: z.string(),
    grossTotal: z.string(),
    cumulativeTotal: z.string(),
    deductionTotal: z.string(),
    netTotal: z.string(),
  }),
});
export type ClaimCalculationDto = z.infer<typeof claimCalculationDtoSchema>;
