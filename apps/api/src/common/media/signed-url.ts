/**
 * Kısa ömürlü imzalı medya URL'leri (docs/07: "İmzalı indirme bağlantıları
 * kısa ömürlü olmalı"). HMAC-SHA256(mediaId.action.exp) — gizli anahtar ortam
 * değişkeninden; sızma anında döndürülebilir (MEDIA_URL_SECRET).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MEDIA_URL_TTL_MS } from '@santiyepro/contracts';

export type MediaUrlAction = 'read' | 'write';

export function mediaUrlSecret(): string {
  return process.env.MEDIA_URL_SECRET ?? process.env.JWT_ACCESS_SECRET ?? 'santiyepro-yerel-medya-gizli-anahtari';
}

export function signMediaId(mediaId: string, action: MediaUrlAction, exp: number): string {
  return createHmac('sha256', mediaUrlSecret()).update(`${mediaId}.${action}.${exp}`).digest('hex');
}

export interface SignedMediaUrl {
  url: string;
  expiresAt: string;
}

/** İmzalı içerik URL'i üretir (göreli yol — aynı API kökü üzerinden çözülür). */
export function buildMediaUrl(
  mediaId: string,
  action: MediaUrlAction,
  ttlMs: number = MEDIA_URL_TTL_MS,
): SignedMediaUrl {
  const exp = Date.now() + ttlMs;
  const sig = signMediaId(mediaId, action, exp);
  return {
    url: `/api/v1/media/${mediaId}/content?exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

/** İmza + süre doğrulaması — geçersiz/süresi dolmuş imzada false döner. */
export function verifyMediaSignature(
  mediaId: string,
  action: MediaUrlAction,
  exp: string | undefined,
  sig: string | undefined,
): boolean {
  if (!exp || !sig) return false;
  const expNumber = Number(exp);
  if (!Number.isSafeInteger(expNumber) || expNumber <= Date.now()) return false;
  const expected = Buffer.from(signMediaId(mediaId, action, expNumber), 'hex');
  const received = Buffer.from(sig, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
