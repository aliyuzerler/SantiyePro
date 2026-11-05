import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { MediaMimeType } from '@santiyepro/contracts';
import { MEDIA_MIME_ALLOWLIST } from '@santiyepro/contracts';

/**
 * Medya depolama servisi — private disk sağlayıcısı (Faz 05).
 *
 * Güvenlik kuralları (docs/07):
 * - storageKey TAMAMEN sunucu üretimi: `{projectId}/{yyyyMM}/{uuid}.{ext}` —
 *   kullanıcı girdisi yolda yer almaz (path traversal yüzeyi yok).
 * - Private bucket eşdeğeri: dosyalar API kökü altındaki .media-storage/ klasöründe;
 *   web üzerinden erişilemez, yalnızca imzalı içerik ucuyla okunur.
 * - Okuma/yazma öncesi storageKey yeniden doğrulanır (savunma derinliği).
 *
 * S3/MinIO'ya geçiş (Faz 10 kurulum) bu servisin arkasından yapılabilir:
 * arayüz write/read/exists/size biçimindedir.
 */

const EXTENSION_BY_MIME: Record<MediaMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

@Injectable()
export class MediaStorageService {
  private readonly root = process.env.MEDIA_STORAGE_ROOT ?? join(process.cwd(), '.media-storage');

  /** Sunucu üretimi depolama anahtarı — kullanıcı girdisi içermez. */
  buildStorageKey(projectId: string, mimeType: MediaMimeType): string {
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Geçersiz proje' });
    }
    const now = new Date();
    const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const ext = EXTENSION_BY_MIME[mimeType];
    return `${projectId}/${month}/${randomUUID()}.${ext}`;
  }

  /** storageKey → mutlak yol; anahtar biçimi segment segment doğrulanır (savunma derinliği). */
  private resolve(storageKey: string): string {
    const parts = storageKey.split('/');
    if (parts.length !== 3) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Geçersiz depolama anahtarı' });
    }
    const [projectId, month, file] = parts;
    if (
      !projectId ||
      !PROJECT_ID_PATTERN.test(projectId) ||
      !month ||
      !/^\d{6}$/.test(month) ||
      !file ||
      file.includes('..') ||
      !/^[a-f0-9-]+\.[a-z0-9]+$/.test(file)
    ) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Geçersiz depolama anahtarı' });
    }
    return join(this.root, projectId, month, file);
  }

  async write(storageKey: string, data: Buffer): Promise<void> {
    const absolute = this.resolve(storageKey);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, data);
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolve(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await this.read(storageKey);
      return true;
    } catch {
      return false;
    }
  }
}

/** Allowlist'te olmayan MIME asla depolanamaz (tip seviyesinde garanti). */
export function assertAllowedMime(mimeType: string): asserts mimeType is MediaMimeType {
  if (!(MEDIA_MIME_ALLOWLIST as readonly string[]).includes(mimeType)) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Dosya türü izin listesinde değil' });
  }
}
