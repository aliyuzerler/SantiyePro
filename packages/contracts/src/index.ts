/**
 * ŞantiyePro API sözleşmesi — paylaşılan tipler ve şemalar.
 * docs/05-api-contracts.md kurallarına göre:
 * - Liste yanıtı: { data, meta: { page, pageSize, total, totalPages } }
 * - Hata yanıtı: { error: { code, message, details? }, traceId }
 */
import { z } from 'zod';

// ---------- Hata zarfı ----------

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export const ApiErrorCode = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
  traceId: z.string(),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

// ---------- Sayfalama ----------

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export function paginatedListResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: paginationMetaSchema,
  });
}

/** Sunucu tarafı sayfalama meta hesabı (tek doğruluk kaynağı). */
export function buildPaginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

// ---------- Health / sistem ----------

export const healthResponseSchema = z.object({
  status: z.enum(['ok']),
  service: z.literal('santiyepro-api'),
  version: z.string(),
  timestamp: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.object({
    database: z.enum(['ok', 'unavailable']),
  }),
  timestamp: z.string(),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

// ---------- Ortak alanlar ----------

/** Tüm kayıtlarda bulunan denetim alanları (docs/02 kabul kriterleri). */
export const auditFieldsSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AuditFields = z.infer<typeof auditFieldsSchema>;
