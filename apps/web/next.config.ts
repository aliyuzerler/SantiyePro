import type { NextConfig } from 'next';

/**
 * Web paneli güvenlik başlıkları (Faz 11 sertleştirmesi, docs/07).
 * - CSP: Next.js hidrasyonu inline script gerektirdiğinden script-src
 *   'unsafe-inline' içerir; dış kaynak yok — tüm kaynaklar 'self' + data/blob.
 * - Frame klikjacking, MIME sniffing, referrer sızıntısı başlıkları API
 *   tarafındaki set ile uyumludur.
 */

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace'teki TS kaynaklı paketler Next.js tarafından derlenir
  transpilePackages: ['@santiyepro/contracts'],
  // Sandbox önizleme proxy'si /panel önekiyle servis eder; üretimde boş bırakılabilir
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  async headers() {
    return [{ source: '/:path*', headers: buildSecurityHeaders() }];
  },
};

function buildSecurityHeaders(): { key: string; value: string }[] {
  // API origin'i connect-src'ye eklenir: geliştirmede panel :3100'den :4000'e
  // cross-origin çağrı yapar; compose üretiminde API aynı origin'dedir (/api/v1)
  // ve zaten 'self' kapsamındadır. Mutlak URL verilmediyse yalnızca 'self'.
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  let apiOrigin = '';
  try {
    if (/^https?:\/\//.test(apiBase)) apiOrigin = new URL(apiBase).origin;
  } catch {
    apiOrigin = '';
  }
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
}


export default nextConfig;
