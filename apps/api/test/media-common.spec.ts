/**
 * Faz 05 birim testleri — medya güvenliği yardımcıları:
 * EXIF/metadata soyulması, magic-byte sniffing, imzalı URL üretim/doğrulama.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  sniffMimeType,
  stripImageMetadata,
  stripJpegMetadata,
  stripPngMetadata,
} from '../src/common/media/exif.js';
import { buildMediaUrl, verifyMediaSignature } from '../src/common/media/signed-url.js';

/** EXIF (GPS içerikli) APP1 segmenti taşıyan minimal JPEG üretir. */
function buildJpegWithExif(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const jfifPayload = Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.alloc(9)]);
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), Buffer.alloc(2), jfifPayload]);
  app0.writeUInt16BE(app0.length - 2, 2);

  const tiff = Buffer.concat([Buffer.from('MM\0*\0\0\0\0', 'latin1'), Buffer.from('GPSLATLONDATA123456', 'latin1')]);
  const exifPayload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.alloc(2), exifPayload]);
  app1.writeUInt16BE(app1.length - 2, 2);

  const dqt = Buffer.concat([Buffer.from([0xff, 0xdb]), Buffer.alloc(2), Buffer.alloc(65, 0x10)]);
  dqt.writeUInt16BE(dqt.length - 2, 2);

  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const scan = Buffer.from([0xab, 0xcd, 0xef, 0x12]);
  const eoi = Buffer.from([0xff, 0xd9]);

  return Buffer.concat([soi, app0, app1, dqt, sos, scan, eoi]);
}

function buildPngWithExif(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(0xdeadbeef, 8 + data.length); // CRC — ayrıştırıcı doğrulamaz
    return out;
  };
  return Buffer.concat([
    signature,
    chunk('IHDR', Buffer.alloc(13)),
    chunk('eXIf', Buffer.from('GPSDATA', 'latin1')),
    chunk('IDAT', Buffer.from([0x01, 0x02, 0x03])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('EXIF / metadata soyulması', () => {
  it('JPEG: APP1 (EXIF) segmenti tamamen çıkarılır; JFIF ve görüntü verisi korunur', () => {
    const input = buildJpegWithExif();
    expect(input.includes(Buffer.from('GPSLATLONDATA123456', 'latin1'))).toBe(true);
    expect(input.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(true);

    const output = stripJpegMetadata(input);

    expect(output.includes(Buffer.from('GPSLATLONDATA123456', 'latin1'))).toBe(false);
    expect(output.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
    expect(output.includes(Buffer.from('JFIF\0', 'latin1'))).toBe(true); // APP0 korunur
    expect(output[0]).toBe(0xff);
    expect(output[1]).toBe(0xd8);
    // SOS sonrası tarama verisi ve EOI aynen korunur
    expect(output.includes(Buffer.from([0xab, 0xcd, 0xef, 0x12]))).toBe(true);
    expect(output.subarray(output.length - 2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it('PNG: eXIf chunk’ı çıkarılır; IHDR/IDAT/IEND korunur', () => {
    const input = buildPngWithExif();
    const output = stripPngMetadata(input);

    expect(output.includes(Buffer.from('GPSDATA', 'latin1'))).toBe(false);
    expect(output.includes(Buffer.from('IDAT', 'latin1'))).toBe(true);
    expect(output.includes(Buffer.from('IEND', 'latin1'))).toBe(true);
    expect(output.subarray(0, 8)).toEqual(input.subarray(0, 8)); // imza aynı
  });

  it('PDF/WebP için metadata soyulmaz (belgelenmiş karar) — girdi aynen döner', () => {
    const pdf = Buffer.from('%PDF-1.7 fake', 'latin1');
    expect(stripImageMetadata(pdf, 'application/pdf')).toBe(pdf);
  });

  it('bozuk JPEG yapısında girdi aynen döner (çökmez, piksel kaybı olmaz)', () => {
    const broken = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x02]); // uzunluk geçersiz
    expect(stripJpegMetadata(broken)).toBe(broken);
  });
});

describe('magic-byte sniffing (MIME spoofing koruması)', () => {
  it('JPEG / PNG / WebP / PDF doğru tanınır', () => {
    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMimeType(Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'latin1'))).toBe('image/webp');
    expect(sniffMimeType(Buffer.from('%PDF-1.7', 'latin1'))).toBe('application/pdf');
    expect(sniffMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'latin1'))).toBeNull();
    expect(sniffMimeType(Buffer.from('MZ\x90\x00', 'latin1'))).toBeNull(); // executable
  });
});

describe('imzalı medya URL’i', () => {
  it('üretilen URL kendi imzasıyla doğrulanır; süre gelecektedir', () => {
    const { url, expiresAt } = buildMediaUrl('media-1', 'read');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(verifyMediaSignature('media-1', 'read', params.get('exp') ?? '', params.get('sig') ?? '')).toBe(true);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(url).toContain('/api/v1/media/media-1/content');
  });

  it('imza değiştirilirse / süresi dolarsa / action uyuşmazsa reddedilir', () => {
    const { url } = buildMediaUrl('media-1', 'read');
    const params = new URLSearchParams(url.split('?')[1]);
    const exp = params.get('exp') ?? '';
    const sig = params.get('sig') ?? '';

    expect(verifyMediaSignature('media-1', 'read', exp, `${sig.slice(0, -2)}00`)).toBe(false);
    expect(verifyMediaSignature('media-2', 'read', exp, sig)).toBe(false);
    expect(verifyMediaSignature('media-1', 'write', exp, sig)).toBe(false);
    expect(verifyMediaSignature('media-1', 'read', String(Date.now() - 1000), signFor('media-1', 'read', Date.now() - 1000))).toBe(false);
    expect(verifyMediaSignature('media-1', 'read', undefined, sig)).toBe(false);
  });
});

function signFor(mediaId: string, action: 'read' | 'write', exp: number): string {
  // Testte imzayı yeniden üretmek için aynı algoritma (MEDIA_URL_SECRET default ile).
  // buildMediaUrl yerine burada imzalanır: süresi geçmiş URL senaryosu için.
  const secret =
    process.env.MEDIA_URL_SECRET ?? process.env.JWT_ACCESS_SECRET ?? 'santiyepro-yerel-medya-gizli-anahtari';
  return createHmac('sha256', secret).update(`${mediaId}.${action}.${exp}`).digest('hex');
}
