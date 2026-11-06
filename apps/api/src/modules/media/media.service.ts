import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import {
  MEDIA_MAX_SIZE_BYTES,
  MEDIA_MIME_ALLOWLIST,
  type MediaDownloadUrlResponse,
  type MediaMimeType,
  type MediaUploadUrlResponse,
  type RequestMediaUploadUrl,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';
import { MediaStorageService, assertAllowedMime } from '../../common/media/media-storage.service.js';
import { buildMediaUrl, verifyMediaSignature } from '../../common/media/signed-url.js';
import { sniffMimeType, stripImageMetadata } from '../../common/media/exif.js';

/**
 * Medya servisi (Faz 05) — iki fazlı yükleme akışı (docs/05):
 *   1. POST /media/upload-url  → izin/boyut/allowlist denetimi, PENDING kayıt,
 *      kısa ömürlü imzalı PUT URL'i döner.
 *   2. PUT  /media/:id/content → imzalı uç (auth header gerektirmez); magic-byte
 *      sniffing, boyut sınırı, EXIF soyulması, checksum → CLEAN.
 *   3. POST /media/complete    → yükleme doğrulanır, imzalı indirme URL'i döner.
 *   4. GET  /media/:id/download-url → kapsam denetimli taze imzalı URL.
 *
 * storageKey asla istemciye dönmez; dosyalar private depoda tutulur (docs/07).
 */

interface Actor {
  userId: string;
  roles: string[];
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: MediaStorageService,
  ) {}

  private async getActor(userId: string): Promise<Actor> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { roles: { select: { role: { select: { key: true } } } } },
    });
    return { userId, roles: user?.roles.map((r) => r.role.key) ?? [] };
  }

  private isAdmin(actor: Actor): boolean {
    return actor.roles.includes('FIRM_ADMIN');
  }

  /** Medyayı proje kapsamıyla bulur: kapsam dışı/olmayan ayırt edilemez → 404. */
  private async getMediaInScope(actor: Actor, mediaId: string) {
    const media = await this.prisma.mediaFile.findUnique({ where: { id: mediaId } });
    if (!media || !media.projectId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Medya bulunamadı' });
    }
    if (!this.isAdmin(actor)) {
      const membership = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: media.projectId, userId: actor.userId } },
        select: { id: true },
      });
      if (!membership) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Medya bulunamadı' });
      }
    }
    return media;
  }

  // ---------- 1) upload-url ----------

  async requestUploadUrl(
    actorUserId: string,
    input: RequestMediaUploadUrl,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<MediaUploadUrlResponse> {
    const actor = await this.getActor(actorUserId);

    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      include: { members: { where: { userId: actor.userId }, select: { id: true } } },
    });
    if (!project || (!this.isAdmin(actor) && project.members.length === 0)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });
    }

    assertAllowedMime(input.mimeType);

    const storageKey = this.storage.buildStorageKey(project.id, input.mimeType);
    const media = await this.prisma.mediaFile.create({
      data: {
        projectId: project.id,
        storageKey,
        originalName: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedById: actor.userId,
        scanStatus: 'PENDING',
      },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'media.upload_requested',
      entityType: 'MediaFile',
      entityId: media.id,
      after: { projectId: project.id, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
      ...meta,
    });

    const signed = buildMediaUrl(media.id, 'write');
    return { mediaId: media.id, uploadUrl: signed.url, method: 'PUT', expiresAt: signed.expiresAt };
  }

  // ---------- 2) imzalı PUT — içerik alımı ----------

  /**
   * İmzalı PUT gövdesini toplar: magic-byte sniffing → boyut sınırı → EXIF
   * soyulması → checksum → private depo. Hata durumunda kayıt FLAGGED olur;
   * daha önce depolanmış dosya yoksa diske hiçbir şey yazılmaz (rapor metni
   * istemcide zaten ayrı kaydedildiği için etkilenmez).
   */
  async saveContent(mediaId: string, exp: string | undefined, sig: string | undefined, req: Request): Promise<void> {
    if (!verifyMediaSignature(mediaId, 'write', exp, sig)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Yükleme bağlantısı geçersiz veya süresi dolmuş' });
    }

    const media = await this.prisma.mediaFile.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Medya bulunamadı' });
    if (media.scanStatus !== 'PENDING') {
      throw new BadRequestException({ code: 'CONFLICT', message: 'Bu medya için yükleme zaten tamamlandı' });
    }
    const declaredMime = media.mimeType as MediaMimeType;

    const chunks: Buffer[] = [];
    let total = 0;
    let firstChunk: Buffer | null = null;
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (!firstChunk) firstChunk = chunk;
        if (total > MEDIA_MAX_SIZE_BYTES) {
          req.removeAllListeners('data');
          req.removeAllListeners('end');
          // Erken 413: istemci gövdeyi tamamlamadan yanıt döner. Gövde
          // tüketilmezse istemcinin yazma tarafı kilitlenebilir (backpressure);
          // akışı boşalt (resume) — diskte hiçbir şey birikmez.
          req.resume();
          req.on('error', () => undefined);
          reject(new PayloadTooLargeException({
            code: 'VALIDATION_ERROR',
            message: `Dosya en fazla ${Math.floor(MEDIA_MAX_SIZE_BYTES / (1024 * 1024))} MB olabilir`,
          }));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve());
      req.on('error', (err) => reject(err));
    });

    const raw = Buffer.concat(chunks);
    if (raw.length === 0) {
      await this.prisma.mediaFile.update({ where: { id: media.id }, data: { scanStatus: 'FLAGGED' } });
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Boş dosya yüklenemez' });
    }

    // MIME spoofing koruması: bildirilen tür ile içerik imzası eşleşmeli (docs/07)
    const sniffed = sniffMimeType(firstChunk ?? raw);
    if (sniffed !== declaredMime || !(MEDIA_MIME_ALLOWLIST as readonly string[]).includes(sniffed ?? '')) {
      await this.prisma.mediaFile.update({ where: { id: media.id }, data: { scanStatus: 'FLAGGED' } });
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Dosya içeriği bildirilen türle uyumsuz',
      });
    }

    // EXIF/XMP/GPS soyulması (ürün kararı: tüm metadata soyulur)
    const stripped = stripImageMetadata(raw, declaredMime);
    if (stripped.length === 0) {
      await this.prisma.mediaFile.update({ where: { id: media.id }, data: { scanStatus: 'FLAGGED' } });
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Dosya işlenemedi' });
    }

    const checksum = createHash('sha256').update(stripped).digest('hex');
    await this.storage.write(media.storageKey, stripped);
    await this.prisma.mediaFile.update({
      where: { id: media.id },
      data: { sizeBytes: stripped.length, checksum, scanStatus: 'CLEAN' },
    });

    await this.audit.record({
      actorUserId: media.uploadedById,
      action: 'media.uploaded',
      entityType: 'MediaFile',
      entityId: media.id,
      after: { sizeBytes: stripped.length, mimeType: declaredMime, metadataStripped: true },
    });
  }

  // ---------- 3) complete ----------

  async complete(actorUserId: string, mediaId: string, meta: { ip: string; userAgent: string; traceId?: string }): Promise<MediaDownloadUrlResponse> {
    const actor = await this.getActor(actorUserId);
    const media = await this.getMediaInScope(actor, mediaId);

    // Sahiplik: yalnızca yükleyen (veya firma yöneticisi) tamamlayabilir.
    if (media.uploadedById !== actor.userId && !this.isAdmin(actor)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Bu medyayı yalnızca yükleyen tamamlayabilir' });
    }
    if (media.scanStatus !== 'CLEAN') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Yükleme henüz tamamlanmadı' });
    }
    if (!(await this.storage.exists(media.storageKey))) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Yükleme henüz tamamlanmadı' });
    }

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'media.completed',
      entityType: 'MediaFile',
      entityId: media.id,
      after: { projectId: media.projectId },
      ...meta,
    });

    const signed = buildMediaUrl(media.id, 'read');
    return { mediaId: media.id, url: signed.url, expiresAt: signed.expiresAt };
  }

  // ---------- 4) download-url ----------

  async getDownloadUrl(actorUserId: string, mediaId: string): Promise<MediaDownloadUrlResponse> {
    const actor = await this.getActor(actorUserId);
    const media = await this.getMediaInScope(actor, mediaId);
    const signed = buildMediaUrl(media.id, 'read');
    return { mediaId: media.id, url: signed.url, expiresAt: signed.expiresAt };
  }

  // ---------- imzalı okuma ----------

  async readContent(mediaId: string, exp: string | undefined, sig: string | undefined): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!verifyMediaSignature(mediaId, 'read', exp, sig)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Bağlantı geçersiz veya süresi dolmuş' });
    }
    const media = await this.prisma.mediaFile.findUnique({ where: { id: mediaId } });
    if (!media || media.scanStatus !== 'CLEAN') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Medya bulunamadı' });
    }
    const buffer = await this.storage.read(media.storageKey);
    return { buffer, mimeType: media.mimeType };
  }

  // ---------- rapor ekleri için ----------

  /** Rapora eklenecek medyaları doğrular: aynı proje, CLEAN, sahiplik. */
  async assertAttachable(actor: Actor, mediaId: string, projectId: string): Promise<void> {
    const media = await this.prisma.mediaFile.findUnique({ where: { id: mediaId } });
    if (!media || media.projectId !== projectId || media.scanStatus !== 'CLEAN') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Ek dosyası bulunamadı veya bu projeye ait değil' });
    }
    if (media.uploadedById !== actor.userId && !this.isAdmin(actor)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Yalnızca kendi yüklediğin dosyaları ekleyebilirsin' });
    }
  }
}
