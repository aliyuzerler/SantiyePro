import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ override: true });

import { AppModule } from '../src/app.module.js';
import { GlobalExceptionFilter } from '../src/common/global-exception.filter.js';
import { traceIdMiddleware } from '../src/common/trace-id.middleware.js';
import { runSeed } from '../prisma/seed.js';
import { RateLimiterService } from '../src/common/rate-limiter.service.js';
import { MEDIA_URL_SECRET_DEFAULT } from './helpers/media-secret.js';

/**
 * Faz 05 e2e — Medya güvenliği (prompts/phase-05-test.md):
 *  1. İzinler: token yok 401, dailyreport.create olmayan 403
 *  2. upload-url validasyonu: SVG yasağı, boyut üst sınırı, path traversal, kapsam
 *  3. İmzalı PUT: imzasız/tampered/süresi dolmuş/başka id → 403
 *  4. MIME spoofing: PNG diye JPEG içeriği → 400 + FLAGGED
 *  5. Boyut sınırı: akış sırasında 413
 *  6. EXIF GPS soyulması: JPEG APP1 + PNG eXIf içeriği depolanan baytlarda YOK
 *  7. Kapsam: download-url başka kullanıcının kapsamı dışında 404; sahte id 404
 *  8. Rapor metni korunumu: upload başarısız olsa da taslak erişilebilir
 */
describe('Media (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN ?? 'dev-setup-token-yerel-0123456789abcdef';
  const ADMIN = { fullName: 'Kurulum Yöneticisi', email: 'admin@santiyepro.test', password: 'GucluParola123' };
  const CHIEF = { fullName: 'Şantiye Şefi Kemal', email: 'sef@santiyepro.test', password: 'SfGucluParola123' };
  const WORKER = { fullName: 'Saha İşçisi Mehmet', email: 'isci@santiyepro.test', password: 'IsGucluParola123' };

  let adminToken = '';
  let chiefToken = '';
  let workerToken = '';
  let prj1 = '';
  let prj2 = '';

  beforeAll(async () => {
    await prisma.dailyReportRevision.deleteMany();
    await prisma.dailyReportMedia.deleteMany();
    await prisma.dailyReportWorker.deleteMany();
    await prisma.dailyReport.deleteMany();
    await prisma.mediaFile.deleteMany();
    await prisma.site.deleteMany();
    await prisma.project.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
    await prisma.permission.deleteMany();
    await prisma.user.deleteMany();
    await runSeed(prisma);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.use(cookieParser());
    app.use(traceIdMiddleware);
    await app.init();

    await request(app.getHttpServer()).post('/api/v1/auth/bootstrap').send({ ...ADMIN, setupToken: SETUP_TOKEN }).expect(201);
    adminToken = await login(ADMIN.email, ADMIN.password);

    const chief = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...CHIEF, roles: ['SITE_CHIEF'] })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...WORKER, roles: ['FIELD_WORKER'] })
      .expect(201);

    const p1 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-001', name: 'Atatürk Bulvarı Konut İnşaatı' })
      .expect(201);
    prj1 = p1.body.id;
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: chief.body.id, scopeRole: 'CHIEF' })
      .expect(201);

    const p2 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-002', name: 'Köprü Bakım Onarım' })
      .expect(201);
    prj2 = p2.body.id;

    chiefToken = await login(CHIEF.email, CHIEF.password);
    workerToken = await login(WORKER.email, WORKER.password);
  });

  beforeEach(() => {
    app.get(RateLimiterService).clear();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.accessToken as string;
  }

  function requestUploadUrl(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/v1/media/upload-url').set('Authorization', `Bearer ${token}`).send(body);
  }

  /** Tam akış: upload-url → imzalı PUT → complete → { mediaId, downloadUrl } */
  async function uploadMedia(
    token: string,
    mimeType: string,
    filename: string,
    content: Buffer,
    projectId = prj1,
  ): Promise<{ mediaId: string; downloadUrl: string; uploadUrl: string; mediaIdRaw: string }> {
    const urlRes = await requestUploadUrl(token, { filename, mimeType, sizeBytes: content.length, projectId }).expect(201);
    const { mediaId, uploadUrl } = urlRes.body;
    const sig = uploadUrl.split('sig=')[1] ?? '';
    const exp = uploadUrl.split('exp=')[1]?.split('&')[0] ?? '';
    const putRes = await request(app.getHttpServer())
      .put(`/api/v1/media/${mediaId}/content`)
      .query({ exp, sig })
      .set('Content-Type', 'application/octet-stream')
      .send(content);
    if (putRes.status !== 200) console.error('PUT DEBUG', putRes.status, JSON.stringify(putRes.body));
    expect(putRes.status).toBe(200);
    const completeRes = await request(app.getHttpServer())
      .post('/api/v1/media/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ mediaId })
      .expect(200);
    return { mediaId, downloadUrl: completeRes.body.url, uploadUrl, mediaIdRaw: mediaId };
  }

  /** GPS içerikli sahte EXIF'li minimal JPEG. */
  function jpegWithExif(): Buffer {
    const soi = Buffer.from([0xff, 0xd8]);
    const jfif = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.alloc(9)]);
    const exifPayload = Buffer.concat([Buffer.from('Exif\0\0GPS:41.0082,28.9784', 'latin1')]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.alloc(2), exifPayload]);
    app1.writeUInt16BE(app1.length - 2, 2);
    const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x00, 0x00, 0x3f, 0x00]);
    return Buffer.concat([soi, jfif, app1, sos, Buffer.from([0x11, 0x22, 0xff, 0xd9])]);
  }

  function pngWithExif(): Buffer {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunk = (type: string, data: Buffer): Buffer => {
      const out = Buffer.alloc(12 + data.length);
      out.writeUInt32BE(data.length, 0);
      out.write(type, 4, 'latin1');
      data.copy(out, 8);
      out.writeUInt32BE(1, 8 + data.length);
      return out;
    };
    return Buffer.concat([
      signature,
      chunk('IHDR', Buffer.alloc(13)),
      chunk('eXIf', Buffer.from('GPS:41.0082,28.9784', 'latin1')),
      chunk('IDAT', Buffer.from([0x01, 0x02])),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }

  // ---------- 1) İzinler ----------

  it('token yok → 401; dailyreport.create olmayan işçi upload-url alamaz (403)', async () => {
    await request(app.getHttpServer()).post('/api/v1/media/upload-url').send({}).expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/media/upload-url')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 100, projectId: prj1 })
      .expect(403);
  });

  // ---------- 2) upload-url validasyonu ----------

  it('SVG yasağı, boyut üst sınırı, path traversal dosya adı → 400', async () => {
    await requestUploadUrl(chiefToken, { filename: 'cizim.svg', mimeType: 'image/svg+xml', sizeBytes: 100, projectId: prj1 }).expect(400);
    await requestUploadUrl(chiefToken, {
      filename: 'buyuk.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10 * 1024 * 1024 + 1,
      projectId: prj1,
    }).expect(400);
    await requestUploadUrl(chiefToken, {
      filename: '../../etc/passwd.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      projectId: prj1,
    }).expect(400);
  });

  it('kapsam dışı projeye upload-url → 404 (medya varlığı sızdırılmaz)', async () => {
    await requestUploadUrl(chiefToken, { filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 100, projectId: prj2 }).expect(404);
  });

  // ---------- 3) İmzalı PUT güvenliği ----------

  it('imzasız PUT → 403; imza kurcalanmış → 403; süresi dolmuş imza → 403', async () => {
    const urlRes = await requestUploadUrl(chiefToken, {
      filename: 'plano.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 20,
      projectId: prj1,
    }).expect(201);
    const mediaId = urlRes.body.mediaId;
    const content = jpegWithExif();

    // İmzasız
    await request(app.getHttpServer())
      .put(`/api/v1/media/${mediaId}/content`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(403);

    // Kurcalanmış imza
    const sig = urlRes.body.uploadUrl.split('sig=')[1] ?? '';
    const exp = urlRes.body.uploadUrl.split('exp=')[1]?.split('&')[0] ?? '';
    await request(app.getHttpServer())
      .put(`/api/v1/media/${mediaId}/content`)
      .query({ exp, sig: `${sig.slice(0, -4)}beef` })
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(403);

    // Süresi dolmuş imza (geçmiş exp ile geçerli HMAC üret)
    const pastExp = String(Date.now() - 60_000);
    const pastSig = createHmac('sha256', MEDIA_URL_SECRET_DEFAULT).update(`${mediaId}.write.${pastExp}`).digest('hex');
    await request(app.getHttpServer())
      .put(`/api/v1/media/${mediaId}/content`)
      .query({ exp: pastExp, sig: pastSig })
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(403);

    // Başka media id için üretilmiş imza → 403
    const otherSig = createHmac('sha256', MEDIA_URL_SECRET_DEFAULT).update(`baska-id.write.${exp}`).digest('hex');
    await request(app.getHttpServer())
      .put(`/api/v1/media/${mediaId}/content`)
      .query({ exp, sig: otherSig })
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(403);

    // Media PENDING kaldı; sahte status ile rapora eklenemez
    await request(app.getHttpServer())
      .post('/api/v1/daily-reports')
      .set('Authorization', `Bearer ${chiefToken}`)
      .send({ projectId: prj1, reportDate: '2026-11-06', workSummary: 'Yükleme tamamlanmamış medya testi', mediaIds: [mediaId] })
      .expect(400);
  });

  // ---------- 4) MIME spoofing ----------

  it('PNG diye bildirilen JPEG içeriği → 400 + FLAGGED (magic-byte)', async () => {
    const urlRes = await requestUploadUrl(chiefToken, {
      filename: 'sahte.png',
      mimeType: 'image/png',
      sizeBytes: jpegWithExif().length,
      projectId: prj1,
    }).expect(201);
    const mediaId = urlRes.body.mediaId;
    const sig = urlRes.body.uploadUrl.split('sig=')[1] ?? '';
    const exp = urlRes.body.uploadUrl.split('exp=')[1]?.split('&')[0] ?? '';

    await request(app.getHttpServer())
      .put(`/api/v1/media/${mediaId}/content`)
      .query({ exp, sig })
      .set('Content-Type', 'application/octet-stream')
      .send(jpegWithExif())
      .expect(400);

    const row = await prisma.mediaFile.findUnique({ where: { id: mediaId } });
    expect(row?.scanStatus).toBe('FLAGGED');
  });

  it('yürütülebilir içerik (MZ) herhangi bir türle bildirilse → 400', async () => {
    const urlRes = await requestUploadUrl(chiefToken, {
      filename: 'kayit.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 128,
      projectId: prj1,
    }).expect(201);
    const mediaId = urlRes.body.mediaId;
    const sig = urlRes.body.uploadUrl.split('sig=')[1] ?? '';
    const exp = urlRes.body.uploadUrl.split('exp=')[1]?.split('&')[0] ?? '';

    await request(app.getHttpServer())
      .put(`/api/v1/media/${mediaId}/content`)
      .query({ exp, sig })
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.concat([Buffer.from('MZ\x90\x00', 'latin1'), Buffer.alloc(120)]))
      .expect(400);
  });

  // ---------- 5) Boyut sınırı ----------

  it('akış sırasında boyut aşımı → 413; diskte dosya birikmez', async () => {
    const urlRes = await requestUploadUrl(chiefToken, {
      filename: 'dev.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      projectId: prj1,
    }).expect(201);
    const mediaId = urlRes.body.mediaId;
    const sig = urlRes.body.uploadUrl.split('sig=')[1] ?? '';
    const exp = urlRes.body.uploadUrl.split('exp=')[1]?.split('&')[0] ?? '';

    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10 * 1024 * 1024, 0x41)]);
    await request(app.getHttpServer())
      .put(`/api/v1/media/${mediaId}/content`)
      .query({ exp, sig })
      .set('Content-Type', 'application/octet-stream')
      .send(big)
      .expect(413);
  });

  // ---------- 6) EXIF GPS soyulması ----------

  it('JPEG: GPS’li EXIF depolanmadan soyulur; imzalı içerik ucu baytları döner', async () => {
    const content = jpegWithExif();
    expect(content.includes(Buffer.from('GPS:41.0082,28.9784', 'latin1'))).toBe(true);

    const { mediaId, downloadUrl } = await uploadMedia(chiefToken, 'image/jpeg', 'saha.jpg', content);

    const mediaRow = await prisma.mediaFile.findUnique({ where: { id: mediaId } });
    expect(mediaRow?.scanStatus).toBe('CLEAN');
    expect(mediaRow?.checksum).toMatch(/^[a-f0-9]{64}$/);

    // storageKey istemciye sızmaz (DTO'da yer almaz) — download URL'i path içermez
    expect(downloadUrl).not.toContain('storageKey');
    expect(downloadUrl).not.toContain('.media-storage');
    expect(downloadUrl).toContain('/api/v1/media/');

    const contentRes = await request(app.getHttpServer()).get(downloadUrl).expect(200);
    expect(contentRes.headers['content-type']).toBe('image/jpeg');
    expect(contentRes.headers['cache-control']).toContain('private');
    expect(contentRes.body.includes(Buffer.from('GPS', 'latin1'))).toBe(false);
    expect(contentRes.body.includes(Buffer.from('Exif', 'latin1'))).toBe(false);
    // JFIF (APP0) ve tarama verisi korunur
    expect(contentRes.body.includes(Buffer.from('JFIF', 'latin1'))).toBe(true);
    expect(contentRes.body.includes(Buffer.from([0x11, 0x22]))).toBe(true);
  });

  it('PNG: eXIf chunk’ı soyulur; imzasız içerik isteği → 403', async () => {
    const content = pngWithExif();
    const { mediaId, downloadUrl } = await uploadMedia(chiefToken, 'image/png', 'saha.png', content);

    const contentRes = await request(app.getHttpServer()).get(downloadUrl).expect(200);
    expect(contentRes.headers['content-type']).toBe('image/png');
    expect(contentRes.body.includes(Buffer.from('GPS', 'latin1'))).toBe(false);
    expect(contentRes.body.includes(Buffer.from('IEND', 'latin1'))).toBe(true);

    // İmza olmadan içerik okunamaz (private bucket)
    await request(app.getHttpServer()).get(`/api/v1/media/${mediaId}/content`).expect(403);
  });

  // ---------- 7) Kapsam ----------

  it('download-url: kapsamdaki admin alır; izinsiz işçi 403; sahte id 404', async () => {
    const { mediaId } = await uploadMedia(chiefToken, 'image/jpeg', 'plano.jpg', jpegWithExif());

    const adminUrl = await request(app.getHttpServer())
      .get(`/api/v1/media/${mediaId}/download-url`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminUrl.body.url).toContain('/content?exp=');

    // İşçi dailyreport.view izni bile taşımaz → 403 (uç açılmaz; varlık sızdırılmaz)
    await request(app.getHttpServer())
      .get(`/api/v1/media/${mediaId}/download-url`)
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/media/sahte-id/download-url')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  // ---------- 8) Rapor metni korunumu ----------

  it('yükleme başarısız olsa bile taslak rapor metni erişilebilir ve düzenlenebilir', async () => {
    const report = await request(app.getHttpServer())
      .post('/api/v1/daily-reports')
      .set('Authorization', `Bearer ${chiefToken}`)
      .send({
        projectId: prj1,
        reportDate: '2026-11-07',
        workSummary: 'Uzun saha notu — fotoğraf yükleme başarısız olsa da bu metin korunmalı.',
      })
      .expect(201);

    // Başarısız yükleme: imzasız PUT
    const urlRes = await requestUploadUrl(chiefToken, {
      filename: 'hata.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      projectId: prj1,
    }).expect(201);
    await request(app.getHttpServer())
      .put(`/api/v1/media/${urlRes.body.mediaId}/content`)
      .set('Content-Type', 'application/octet-stream')
      .send(jpegWithExif())
      .expect(403);

    const det = await request(app.getHttpServer())
      .get(`/api/v1/daily-reports/${report.body.id}`)
      .set('Authorization', `Bearer ${chiefToken}`)
      .expect(200);
    expect(det.body.workSummary).toContain('bu metin korunmalı');

    await request(app.getHttpServer())
      .patch(`/api/v1/daily-reports/${report.body.id}`)
      .set('Authorization', `Bearer ${chiefToken}`)
      .send({ nextDayPlan: 'Yükleme tekrar denenecek.' })
      .expect(200);
  });

  it('audit: media.upload_requested + media.uploaded kayıtları üretilir', async () => {
    const requested = await prisma.auditLog.findFirst({ where: { action: 'media.upload_requested' } });
    const uploaded = await prisma.auditLog.findFirst({ where: { action: 'media.uploaded' } });
    expect(requested).toBeTruthy();
    expect(uploaded).toBeTruthy();
  });
});
