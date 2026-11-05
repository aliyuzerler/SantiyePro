/**
 * ŞantiyePro — Medya sözleşmeleri (Faz 05).
 *
 * Kurallar (prompts/phase-05-development.md, docs/07-security-rules.md):
 * - MIME/boyut allowlist sunucu tarafında zorunludur; dosya uzantısına güvenilmez,
 *   içerik magic-byte ile doğrulanır (MIME spoofing 400 döner).
 * - SVG ve çalıştırılabilir türler yasaklıdır.
 * - storageKey ASLA DTO'da taşınmaz: sunucu üretir, yalnızca sunucu bilir
 *   (path traversal yüzeyi kapanır).
 * - İmzalı URL'ler kısa ömürlüdür (varsayılan 10 dk) ve private depoya işaret eder.
 * - Görsellerden EXIF metadata (özellikle GPS) sunucuda soyulur: kullanıcıya
 *   konum sızdırılmaz (ürün kararı: tüm EXIF/XMP soyulur).
 */
import { z } from 'zod';

/** Yüklenebilecek MIME türleri — SVG/executable dahil değil (docs/07). */
export const MEDIA_MIME_ALLOWLIST = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type MediaMimeType = (typeof MEDIA_MIME_ALLOWLIST)[number];

export const MEDIA_MIME_LABELS: Record<MediaMimeType, string> = {
  'image/jpeg': 'JPEG görsel',
  'image/png': 'PNG görsel',
  'image/webp': 'WebP görsel',
  'application/pdf': 'PDF belge',
};

/** Varsayılan en büyük dosya boyutu: 10 MB. */
export const MEDIA_MAX_SIZE_BYTES = 10 * 1024 * 1024;

/** İmzalı URL yaşam süresi (ms) — kısa ömürlü (docs/07). */
export const MEDIA_URL_TTL_MS = 10 * 60 * 1000;

export const MEDIA_SCAN_STATUSES = ['PENDING', 'CLEAN', 'FLAGGED'] as const;
export type MediaScanStatus = (typeof MEDIA_SCAN_STATUSES)[number];

export const MEDIA_SCAN_STATUS_LABELS: Record<MediaScanStatus, string> = {
  PENDING: 'Yükleme bekleniyor',
  CLEAN: 'Hazır',
  FLAGGED: 'Reddedildi',
};

// ---------- Şemalar ----------

export const requestMediaUploadUrlSchema = z.object({
  filename: z
    .string()
    .min(1, 'Dosya adı gereklidir')
    .max(200)
    .refine((v) => !v.includes('/') && !v.includes('\\') && !v.includes('..'), 'Geçersiz dosya adı'),
  mimeType: z.enum(MEDIA_MIME_ALLOWLIST, { message: 'Dosya türü izin listesinde değil' }),
  sizeBytes: z
    .number()
    .int()
    .min(1, 'Boş dosya yüklenemez')
    .max(MEDIA_MAX_SIZE_BYTES, `Dosya en fazla ${Math.floor(MEDIA_MAX_SIZE_BYTES / (1024 * 1024))} MB olabilir`),
  /** Medya bir proje bağlamına ait olmak zorundadır (kapsam denetimi bunun üzerinden yapılır). */
  projectId: z.string().min(1).max(64),
});
export type RequestMediaUploadUrl = z.infer<typeof requestMediaUploadUrlSchema>;

export const completeMediaUploadSchema = z.object({
  mediaId: z.string().min(1).max(64),
});
export type CompleteMediaUpload = z.infer<typeof completeMediaUploadSchema>;

// ---------- DTO'lar ----------

export const mediaDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  originalName: z.string(),
  mimeType: z.enum(MEDIA_MIME_ALLOWLIST),
  sizeBytes: z.number().int().min(0),
  status: z.enum(MEDIA_SCAN_STATUSES),
  /** Kısa ömürlü imzalı içerik URL'i (yalnızca yetkili isteklerde üretilir). */
  url: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type MediaDto = z.infer<typeof mediaDtoSchema>;

export const mediaUploadUrlResponseSchema = z.object({
  mediaId: z.string(),
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  expiresAt: z.string(),
});
export type MediaUploadUrlResponse = z.infer<typeof mediaUploadUrlResponseSchema>;

export const mediaDownloadUrlResponseSchema = z.object({
  mediaId: z.string(),
  url: z.string(),
  expiresAt: z.string(),
});
export type MediaDownloadUrlResponse = z.infer<typeof mediaDownloadUrlResponseSchema>;
