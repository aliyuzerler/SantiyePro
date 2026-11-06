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

export * from './pagination.js';
export * from './auth.js';
export * from './rbac.js';
export * from './projects.js';
export * from './tasks.js';
export * from './media.js';
export * from './dailyreports.js';
export * from './attendance.js';
export * from './inventory.js';
export * from './finance.js';
export * from './sync.js';

// ---------- Ortak alanlar ----------

/** Tüm kayıtlarda bulunan denetim alanları (docs/02 kabul kriterleri). */
export const auditFieldsSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AuditFields = z.infer<typeof auditFieldsSchema>;
