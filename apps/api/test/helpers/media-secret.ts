/**
 * Test yardımcıları — imzalı URL secret'ı (signed-url.ts ile aynı çözümleme).
 */
export const MEDIA_URL_SECRET_DEFAULT =
  process.env.MEDIA_URL_SECRET ?? process.env.JWT_ACCESS_SECRET ?? 'santiyepro-yerel-medya-gizli-anahtari';
