/**
 * Medya güvenliği yardımcıları (Faz 05) — saf fonksiyonlar, birim testlidir.
 *
 * EXIF politikası (docs/07 + ürün kararı): görsellerden TÜM metadata soyulur
 * (EXIF/XMP/ICC) — kullanıcı konumu (GPS) asla sunucuya girdiği haliyle saklanmaz.
 * JPEG/PNG akış yapısı bozulmadan yalnızca metadata segmentleri çıkarılır
 * (görüntü pikselleri korunur). PDF/WebP bu fazda soyulmaz (belgelenmiş karar).
 */

/** JPEG'den APP1+ segmentlerini (EXIF/XMP) ve APP2'yi (ICC) soyar; APP0 (JFIF) korunur. */
export function stripJpegMetadata(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return input;
  const parts: Buffer[] = [input.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= input.length) {
    // Dolgu 0xFF baytlarını atla
    while (i < input.length - 1 && input[i] === 0xff && input[i + 1] === 0xff) i += 1;
    if (input[i] !== 0xff) return input;
    const marker = input[i + 1];
    if (marker === undefined) return input;
    if (marker === 0xd9) {
      // EOI — kalan her şeyi (normalde yalnızca EOI) aynen kopyala
      parts.push(input.subarray(i));
      return Buffer.concat(parts);
    }
    if (marker === 0xda) {
      // SOS — entropi kodlu görüntü verisi başlar; sonrasına dokunulmaz
      parts.push(input.subarray(i));
      return Buffer.concat(parts);
    }
    const length = input.readUInt16BE(i + 2);
    const segmentEnd = i + 2 + length;
    if (segmentEnd > input.length || length < 2) return input;
    const isAppSegment = marker >= 0xe0 && marker <= 0xef;
    if (isAppSegment && marker !== 0xe0) {
      // APP1 (EXIF/XMP), APP2 (ICC) … soyulur
      i = segmentEnd;
      continue;
    }
    parts.push(input.subarray(i, segmentEnd));
    i = segmentEnd;
  }
  return input;
}

/** PNG'den eXIf chunk'larını soyar; diğer chunk'lara dokunmaz. */
export function stripPngMetadata(input: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (input.length < 8 || !input.subarray(0, 8).equals(signature)) return input;
  const chunks: Buffer[] = [];
  let i = 8;
  let changed = false;
  while (i + 12 <= input.length) {
    const length = input.readUInt32BE(i);
    const type = input.toString('latin1', i + 4, i + 8);
    const chunkEnd = i + 12 + length;
    if (chunkEnd > input.length) return input;
    if (type === 'eXIf') {
      changed = true;
    } else {
      chunks.push(input.subarray(i, chunkEnd));
    }
    i = chunkEnd;
  }
  return changed ? Buffer.concat([signature, ...chunks]) : input;
}

/** MIME türüne göre metadata soyan tek giriş noktası. */
export function stripImageMetadata(input: Buffer, mimeType: string): Buffer {
  if (mimeType === 'image/jpeg') return stripJpegMetadata(input);
  if (mimeType === 'image/png') return stripPngMetadata(input);
  return input;
}

/**
 * Magic-byte sniffing — bildirilen MIME ile dosya içeriğini karşılaştırır
 * (uzantıya/content-type'a güvenilmez, docs/07).
 */
export function sniffMimeType(input: Buffer): string | null {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return 'image/jpeg';
  if (
    input.length >= 8 &&
    input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (input.length >= 12 && input.toString('latin1', 0, 4) === 'RIFF' && input.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (input.length >= 5 && input.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/** Görüntü türü metadata soyulabilir mi? (webp/pdf bu fazda soyulmaz — belgelenmiş karar) */
export function isMetadataStrippingSupported(mimeType: string): boolean {
  return mimeType === 'image/jpeg' || mimeType === 'image/png';
}
