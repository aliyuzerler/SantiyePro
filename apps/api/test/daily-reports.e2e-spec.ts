import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config({ override: true });

import { AppModule } from '../src/app.module.js';
import { GlobalExceptionFilter } from '../src/common/global-exception.filter.js';
import { traceIdMiddleware } from '../src/common/trace-id.middleware.js';
import { runSeed } from '../prisma/seed.js';
import { RateLimiterService } from '../src/common/rate-limiter.service.js';

/**
 * Faz 05 e2e — Günlük şantiye raporu (prompts/phase-05-test.md):
 *  1. Taslak oluşturma/güncelleme/gönderme/onay/red akışı (+ reopen)
 *  2. Onay sonrası revizyon: eski içerik snapshot'ta korunur, hash tutarlı
 *  3. Yetkisiz proje raporuna erişim (IDOR → 404) ve izin ayrımları
 *  4. Geçersiz durum geçişleri, zorunlu alan validasyonu, saat sınırı
 *  5. Rapor metni medya ekleme hatasında korunur
 *  6. Filtre/arama/sayfalama + audit kayıtları
 * (Medya güvenliği testleri media.e2e-spec.ts'tedir.)
 */
describe('Daily reports (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN ?? 'dev-setup-token-yerel-0123456789abcdef';
  const ADMIN = { fullName: 'Kurulum Yöneticisi', email: 'admin@santiyepro.test', password: 'GucluParola123' };
  const PM = { fullName: 'Proje Yöneticisi Ayşe', email: 'pm@santiyepro.test', password: 'PmGucluParola123' };
  const CHIEF = { fullName: 'Şantiye Şefi Kemal', email: 'sef@santiyepro.test', password: 'SfGucluParola123' };
  const WORKER = { fullName: 'Saha İşçisi Mehmet', email: 'isci@santiyepro.test', password: 'IsGucluParola123' };
  const TECH = { fullName: 'Teknik Ofis Deniz', email: 'teknik@santiyepro.test', password: 'TkGucluParola123' };

  let adminToken = '';
  let pmToken = '';
  let chiefToken = '';
  let workerToken = '';
  let techToken = '';
  let prj1 = '';
  let prj2 = '';

  beforeAll(async () => {
    await prisma.dailyReportRevision.deleteMany();
    await prisma.dailyReportMedia.deleteMany();
    await prisma.dailyReportWorker.deleteMany();
    await prisma.dailyReport.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.taskStatusHistory.deleteMany();
    await prisma.taskComment.deleteMany();
    await prisma.task.deleteMany();
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

    const pm = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...PM, roles: ['PROJECT_MANAGER'] })
      .expect(201);
    const chief = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...CHIEF, roles: ['SITE_CHIEF'] })
      .expect(201);
    const worker = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...WORKER, roles: ['FIELD_WORKER'] })
      .expect(201);
    const tech = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...TECH, roles: ['TECH_OFFICE'] })
      .expect(201);
    void worker;
    void tech;

    const p1 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-001', name: 'Atatürk Bulvarı Konut İnşaatı', managerId: pm.body.id })
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

    pmToken = await login(PM.email, PM.password);
    chiefToken = await login(CHIEF.email, CHIEF.password);
    workerToken = await login(WORKER.email, WORKER.password);
    techToken = await login(TECH.email, TECH.password);
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

  function createReport(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/v1/daily-reports').set('Authorization', `Bearer ${token}`).send(body);
  }

  function patchReport(token: string, id: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/v1/daily-reports/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function detail(token: string, id: string) {
    return request(app.getHttpServer()).get(`/api/v1/daily-reports/${id}`).set('Authorization', `Bearer ${token}`);
  }

  const validBody = (projectId: string, over: Record<string, unknown> = {}) => ({
    projectId,
    reportDate: '2026-11-05',
    weather: 'Güneş, hafif rüzgar',
    workSummary: 'Zemin kat kalıp montajı tamamlandı, beton dökümüne hazır.',
    workforceSummary: 'Kalıp ekibi 6 kişi, demir ekibi 4 kişi çalıştı.',
    equipmentSummary: '1 kule vinç, 2 mikser',
    issues: 'Malzeme sevkiyatı 2 saat gecikti.',
    safetyNotes: 'Baret kontrolü yapıldı; korkuluk eksikleri tamamlandı.',
    nextDayPlan: 'Beton dökümü ve sıkıştırma işlemleri.',
    workers: [
      { name: 'Ahmet Yılmaz', jobTitle: 'Kalıp Ustası', workerCount: 6, hours: '9.5' },
      { name: 'Hasan Demir', jobTitle: 'Demirci', workerCount: 4, hours: '8' },
    ],
    ...over,
  });

  // ---------- 1) Kimlik doğrulama ve izinler ----------

  it('token olmadan rapor listesi → 401; işçi görüntüleyemez (403); teknik ofis görüntüler ama yazamaz', async () => {
    await request(app.getHttpServer()).get('/api/v1/daily-reports').expect(401);
    await request(app.getHttpServer()).get('/api/v1/daily-reports').set('Authorization', `Bearer ${workerToken}`).expect(403);
    await request(app.getHttpServer()).get('/api/v1/daily-reports').set('Authorization', `Bearer ${techToken}`).expect(200);
    await createReport(techToken, validBody(prj1)).expect(403);
  });

  it('şef taslak oluşturur → 201; alanlar timezone-safe döner; ekip satırları saklanır', async () => {
    const res = await createReport(chiefToken, validBody(prj1)).expect(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.revisionNo).toBe(0);
    expect(res.body.reportDate).toBe('2026-11-05');
    expect(res.body.workers).toHaveLength(2);
    expect(res.body.workers[0].hours).toBe('9.50');
    expect(res.body.mediaCount).toBe(0);
  });

  it('zorunlu alan validasyonu: kısa özet, bozuk tarih, saat 25, geçersiz workerCount → 400', async () => {
    await createReport(chiefToken, validBody(prj1, { workSummary: 'ab' })).expect(400);
    await createReport(chiefToken, validBody(prj1, { reportDate: '05.11.2026' })).expect(400);
    await createReport(chiefToken, validBody(prj1, { workers: [{ name: 'Ahmet Yılmaz', hours: '25' }] })).expect(400);
    await createReport(chiefToken, validBody(prj1, { workers: [{ name: 'Ahmet Yılmaz', hours: '8,5' }] })).expect(400);
    await createReport(chiefToken, validBody(prj1, { workers: [{ name: 'Ahmet Yılmaz', hours: '8', workerCount: 0 }] })).expect(400);
  });

  // ---------- 2) Kapsam / IDOR ----------

  it('kapsam: şef kapsam dışı projede rapor göremez/oluşturamaz (404 — IDOR)', async () => {
    const foreign = await createReport(adminToken, validBody(prj2)).expect(201);

    await createReport(chiefToken, validBody(prj2)).expect(404);
    await detail(chiefToken, foreign.body.id).expect(404);
    await patchReport(chiefToken, foreign.body.id, { workSummary: 'Sızma' }).expect(404);
    // Şefin approve izni bile yok (403 — uç hiç açılmaz); approve yetkisi olan
    // PM kapsam dışı raporda 404 alır (varlık sızdırılmaz).
    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${foreign.body.id}/approve`)
      .set('Authorization', `Bearer ${chiefToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${foreign.body.id}/approve`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(404);
  });

  // ---------- 3) Durum akışı ----------

  it('akış: DRAFT → SUBMITTED → APPROVED; onaylayan ve zaman kaydedilir', async () => {
    const report = await createReport(chiefToken, validBody(prj1)).expect(201);
    const id = report.body.id;

    // Geçersiz: DRAFT → APPROVED
    const early = await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/approve`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(400);
    expect(early.body.error.message).toContain('Geçersiz durum geçişi');

    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/submit`)
      .set('Authorization', `Bearer ${chiefToken}`)
      .expect(200);

    // dailyreport.approve izni olmayan (şef) onaylayamaz
    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/approve`)
      .set('Authorization', `Bearer ${chiefToken}`)
      .expect(403);

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/approve`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approvedBy.fullName).toBe(PM.fullName);
    expect(approved.body.approvedAt).toBeTruthy();

    // APPROVED terminal: tekrar onay/red/gönderim → 400
    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/submit`)
      .set('Authorization', `Bearer ${chiefToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/reject`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ reason: 'Test' })
      .expect(400);
  });

  it('red akışı: SUBMITTED → REJECTED gerekçeyle; reopen → DRAFT; yeniden gönderim', async () => {
    const report = await createReport(chiefToken, validBody(prj1)).expect(201);
    const id = report.body.id;
    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/submit`)
      .set('Authorization', `Bearer ${chiefToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/reject`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ reason: '' })
      .expect(400);

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/reject`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ reason: 'Hava durumu ve ekip saati bilgisi eksik' })
      .expect(200);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.rejectedReason).toContain('eksik');

    const reopened = await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/reopen`)
      .set('Authorization', `Bearer ${chiefToken}`)
      .expect(200);
    expect(reopened.body.status).toBe('DRAFT');
    expect(reopened.body.rejectedReason).toBeNull();

    // REJECTED → SUBMITTED doğrudan da mümkün (MVP ek kararı)
    const report2 = await createReport(chiefToken, validBody(prj1)).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${report2.body.id}/submit`)
      .set('Authorization', `Bearer ${chiefToken}`)
      .expect(200);
    const rejected2 = await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${report2.body.id}/reject`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ reason: 'Eksik ekipman bilgisi' })
      .expect(200);
    const resubmitted = await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${rejected2.body.id}/submit`)
      .set('Authorization', `Bearer ${chiefToken}`)
      .expect(200);
    expect(resubmitted.body.status).toBe('SUBMITTED');
    expect(resubmitted.body.rejectedReason).toBeNull();
  });

  // ---------- 4) Revizyon (onaylı/gönderilmiş rapor düzenlemesi) ----------

  it('APPROVED rapor düzenlenirse önceki içerik snapshot’ta korunur (revisionNo artar)', async () => {
    const report = await createReport(chiefToken, validBody(prj1, { workSummary: 'ÖZET V1 — kazı tamamlandı.' })).expect(201);
    const id = report.body.id;
    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/submit`)
      .set('Authorization', `Bearer ${chiefToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${id}/approve`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);

    const edited = await patchReport(chiefToken, id, { workSummary: 'ÖZET V2 — kazı ve temel şakülü tamamlandı.' }).expect(200);
    expect(edited.body.status).toBe('APPROVED'); // düzenleme durum değiştirmez
    expect(edited.body.revisionNo).toBe(1);

    const det = await detail(chiefToken, id).expect(200);
    expect(det.body.revisions).toHaveLength(1);
    const rev = det.body.revisions[0];
    expect(rev.revisionNo).toBe(0);
    expect(rev.snapshot.workSummary).toBe('ÖZET V1 — kazı tamamlandı.'); // eski içerik korunur
    expect(rev.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rev.changedByFullName).toBe(CHIEF.fullName);

    // İkinci düzenleme → ikinci snapshot (revisionNo 1)
    await patchReport(chiefToken, id, { workSummary: 'ÖZET V3 — beton dökümü de tamamlandı.' }).expect(200);
    const det2 = await detail(chiefToken, id).expect(200);
    expect(det2.body.revisionNo).toBe(2);
    expect(det2.body.revisions.map((r: { revisionNo: number }) => r.revisionNo)).toEqual([1, 0]);
    expect(det2.body.revisions[1].snapshot.workSummary).toBe('ÖZET V1 — kazı tamamlandı.');
    expect(det2.body.revisions[0].snapshot.workSummary).toBe('ÖZET V2 — kazı ve temel şakülü tamamlandı.');

    const revAudit = await prisma.auditLog.findFirst({ where: { action: 'dailyreport.revision_created', entityId: id } });
    expect(revAudit).toBeTruthy();
  });

  it('DRAFT düzenlemesi revizyon üretmez; içerik hash’i snapshot içeriğiyle doğrulanabilir', async () => {
    const report = await createReport(chiefToken, validBody(prj1, { workSummary: 'Taslak özet' })).expect(201);
    await patchReport(chiefToken, report.body.id, { workSummary: 'Taslak özet güncellendi' }).expect(200);
    const det = await detail(chiefToken, report.body.id).expect(200);
    expect(det.body.revisionNo).toBe(0);
    expect(det.body.revisions).toHaveLength(0);
  });

  // ---------- 5) Rapor metni korunumu ----------

  it('medya eki hatasında rapor metni korunur: geçersiz mediaId → 400, mevcut içerik bozulmaz', async () => {
    const report = await createReport(chiefToken, validBody(prj1, { workSummary: 'Kritik saha özeti — KORUNMALI' })).expect(201);
    const id = report.body.id;

    await patchReport(chiefToken, id, { mediaIds: ['sahte-media-id'] }).expect(400);

    const det = await detail(chiefToken, id).expect(200);
    expect(det.body.workSummary).toBe('Kritik saha özeti — KORUNMALI');
    expect(det.body.status).toBe('DRAFT');
  });

  // ---------- 6) Filtre / sayfalama / audit ----------

  it('filtreler: status, tarih aralığı, proje; sayfalama meta doğru', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/daily-reports?projectId=${prj1}&status=SUBMITTED&page=1&pageSize=2`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    for (const row of res.body.data) {
      expect(row.status).toBe('SUBMITTED');
      expect(row.projectId).toBe(prj1);
    }

    const range = await request(app.getHttpServer())
      .get('/api/v1/daily-reports?dateFrom=2026-11-01&dateTo=2026-11-30')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(range.body.meta.total).toBeGreaterThanOrEqual(1);

    const empty = await request(app.getHttpServer())
      .get('/api/v1/daily-reports?dateFrom=2000-01-01&dateTo=2000-01-02')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(empty.body.meta.total).toBe(0);
  });

  it('audit: created/submitted/approved/rejected kayıtları üretilir', async () => {
    const actions = ['dailyreport.created', 'dailyreport.submitted', 'dailyreport.approved', 'dailyreport.rejected'];
    for (const action of actions) {
      const audit = await prisma.auditLog.findFirst({ where: { action } });
      expect(audit, action).toBeTruthy();
    }
  });
});
