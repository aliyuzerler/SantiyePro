import type { NextFunction, Request, Response } from 'express';

/**
 * Güvenlik yanıt başlıkları (Faz 11 sertleştirmesi, docs/07).
 *
 * Helmet bağımlılığı eklemek yerine eşdeğer minimum başlık seti uygulanır:
 * - X-Content-Type-Options: nosniff  → MIME sniffing kapalı
 * - X-Frame-Options: DENY            → API yanıtları iframe'e gömülemez (clickjacking)
 * - Referrer-Policy                  → hassas query parametreleri dışarı sızmaz
 * - X-DNS-Prefetch-Control           → DNS sızıntı yüzeyini daraltır
 * - Permissions-Policy               → tarayıcı güçlü API'leri devre dışı bırak
 * - Cross-Origin-Resource-Policy     → kaynakların cross-origin okunmasını engelle
 *
 * CSP API'de zorunlu değildir (yanıt gövdesi HTML değil JSON); web paneline
 * ayrıca uygulanır (apps/web/next.config.ts). TLS sonlandırma Caddy'dedir
 * (docs/10); HSTS orada verilir.
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
}
