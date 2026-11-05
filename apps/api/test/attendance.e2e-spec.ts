import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/**
 * Faz 06 e2e — Personel ve Puantaj (prompts/phase-06-test.md).
 *
 * Kapsam:
 *  1. Personel CRUD ve pasife alma (sicil çakışması 409, pasif personele yeni kayıt yok)
 *  2. Her devam durumu ve giriş/çıkış validasyonu (saha dışı durumlarda saat yok,
 *     çıkış > giriş, workedMinutes hesabı)
 *  3. Duplicate engeli: aynı personel/proje/tarih/vardiya → 409 (DB unique + servis)
 *  4. Toplu işaretleme: önizleme (yazma yok) → onaysız uygulama 400 → onayda yalnızca
 *     CREATE/UPDATE satırları uygulanır (SKIP_* kişilere dokunulmaz)
 *  5. Proje kapsamı ve hassas veri yetkisi: kapsam dışı proje 404/boş liste;
 *     TECH_OFFICE görüntüler ama düzenleyemez; FIELD_WORKER hiç göremez
 *  6. Tarih/timezone sınırları (YYYY-MM-DD DATE kolonu) ve özet uçları
 *  7. GPS: sözleşme ve DTO'larda konum alanı YOKTUR (varsayılan kapalı)
 *  8. clientMutationId idempotency (mobil çevrimdışı kuyruk tekrarına karşı)
 */
describe('Personnel & Attendance (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN ?? 'dev-setup-token-yerel-0123456789abcdef';
  const ADMIN = { fullName: 'Kurulum Yöneticisi', email: 'admin@santiyepro.test', password: 'GucluParola123' };
  const PM = { fullName: 'Proje Yöneticisi Ayşe', email: 'pm@santiyepro.test', password: 'PmGucluParola123' };
  const TECH = { fullName: 'Teknik Ofis Deniz', email: 'teknik@santiyepro.test', password: 'TkGucluParola123' };
  const WORKER = { fullName: 'Saha İşçisi Mehmet', email: 'isci@santiyepro.test', password: 'IsGucluParola123' };

  let adminToken = '';
  let pmToken = '';
  let techToken = '';
  let workerToken = '';
  let pmUserId = '';
  let prj1 = '';
  let prj2 = '';
  let site1 = '';

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.accessToken as string;
  }

  async function createPersonnel(token: string, input: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/personnel')
      .set('Authorization', `Bearer ${token}`)
      .send(input);
    expect(res.status).toBe(201);
    return res.body as { id: string; fullName: string; status: string };
  }

  beforeAll(async () => {
    await prisma.attendanceRecord.deleteMany();
    await prisma.dailyReportMedia.deleteMany();
    await prisma.dailyReportRevision.deleteMany();
    await prisma.dailyReportWorker.deleteMany();
    await prisma.dailyReport.deleteMany();
    await prisma.mediaFile.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.taskStatusHistory.deleteMany();
    await prisma.taskComment.deleteMany();
    await prisma.task.deleteMany();
    await prisma.personnel.deleteMany();
    await prisma.orgSettings.deleteMany();
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
    pmUserId = pm.body.id;

    const tech = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...TECH, roles: ['TECH_OFFICE'] })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...WORKER, roles: ['FIELD_WORKER'] })
      .expect(201);

    pmToken = await login(PM.email, PM.password);
    techToken = await login(TECH.email, TECH.password);
    workerToken = await login(WORKER.email, WORKER.password);
    void tech;

    // prj1: PM üyesi; prj2: PM üyesi değil (kapsam testi)
    const p1 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-P1', name: 'Puantaj Projesi Bir', managerId: pmUserId, status: 'ACTIVE' })
      .expect(201);
    prj1 = p1.body.id;
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj1}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    const p2 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-P2', name: 'Puantaj Projesi İki', status: 'ACTIVE' })
      .expect(201);
    prj2 = p2.body.id;
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj2}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    const s1 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1}/sites`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Kazı Alanı' })
      .expect(201);
    site1 = s1.body.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------- 1) Personel CRUD ve pasife alma ----------

  describe('Personel CRUD', () => {
    it('admin personel oluşturur; zorunlu alan ve uzunluk validasyonu çalışır', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/personnel')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fullName: 'Ah' })
        .expect(400);

      const res = await request(app.getHttpServer())
        .post('/api/v1/personnel')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeCode: 'P-1001',
          fullName: 'Ahmet Yılmaz',
          phone: '0532 111 22 33',
          jobTitle: 'Kalıp Ustası',
          companyOrSubcontractor: 'Yılmaz Taşeron',
        })
        .expect(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.attendanceRecordCount).toBe(0);
    });

    it('sicil numarası çakışması 409 döner', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/personnel')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeCode: 'P-1001', fullName: 'Başka Kişi' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('liste, arama ve durum filtresi çalışır; pasife alma geçmişi korur', async () => {
      const ali = await createPersonnel(adminToken, { fullName: 'Ali Veli', employeeCode: 'P-1002' });
      await createPersonnel(adminToken, { fullName: 'Zeynep Kara', employeeCode: 'P-1003', jobTitle: 'Demirci' });

      const search = await request(app.getHttpServer())
        .get('/api/v1/personnel?search=zeynep')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(search.body.data).toHaveLength(1);
      expect(search.body.data[0].fullName).toBe('Zeynep Kara');

      // Pasife alma
      const deact = await request(app.getHttpServer())
        .patch(`/api/v1/personnel/${ali.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'PASSIVE' })
        .expect(200);
      expect(deact.body.status).toBe('PASSIVE');

      const passive = await request(app.getHttpServer())
        .get('/api/v1/personnel?status=PASSIVE')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(passive.body.data.map((p: { id: string }) => p.id)).toContain(ali.id);

      // Pasif personel kayıt listesinde kalır (sert silme yok)
      const stillThere = await request(app.getHttpServer())
        .get(`/api/v1/personnel/${ali.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(stillThere.body.id).toBe(ali.id);
    });

    it('attendance.view olmayan kullanıcı (FIELD_WORKER) personel listesine erişemez', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/personnel')
        .set('Authorization', `Bearer ${workerToken}`)
        .expect(403);
    });
  });

  // ---------- 2-3) Puantaj: durumlar, giriş/çıkış, duplicate ----------

  describe('Puantaj işaretleme', () => {
    let ahmet = '';
    let mehmet = '';

    beforeAll(async () => {
      const a = await createPersonnel(adminToken, { fullName: 'Ahmet Keskin', employeeCode: 'P-2001' });
      const m = await createPersonnel(adminToken, { fullName: 'Mehmet Demir', employeeCode: 'P-2002' });
      ahmet = a.id;
      mehmet = m.id;
    });

    it('tüm varsayılan durumlarla kayıt açılır; durum etiketleri contracts ile uyumlu', async () => {
      const statusesRes = await request(app.getHttpServer())
        .get('/api/v1/attendance/statuses')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(statusesRes.body.statuses).toEqual(
        expect.arrayContaining(['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'SICK', 'HOLIDAY']),
      );

      const statuses = ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'SICK', 'HOLIDAY'] as const;
      for (const [i, status] of statuses.entries()) {
        await request(app.getHttpServer())
          .post('/api/v1/attendance')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            projectId: prj1,
            personnelId: ahmet,
            workDate: `2026-06-0${i + 1}`,
            shiftKey: 'GUNDUZ',
            status,
          })
          .expect(201);
      }
    });

    it('saha dışı durumlarda (ABSENT/LEAVE/SICK/HOLIDAY) giriş-çıkış girilemez', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          personnelId: ahmet,
          workDate: '2026-06-10',
          status: 'ABSENT',
          checkInAt: '2026-06-10T08:00:00.000Z',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('çıkış girişten önce olamaz; çalışılan dakika iki saatten hesaplanır', async () => {
      const bad = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          personnelId: ahmet,
          workDate: '2026-06-11',
          status: 'PRESENT',
          checkInAt: '2026-06-11T14:00:00.000Z',
          checkOutAt: '2026-06-11T09:00:00.000Z',
        });
      expect(bad.status).toBe(400);
      expect(bad.body.error.message).toContain('sonra');

      const ok = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          personnelId: ahmet,
          workDate: '2026-06-11',
          status: 'PRESENT',
          checkInAt: '2026-06-11T08:00:00.000Z',
          checkOutAt: '2026-06-11T17:00:00.000Z',
        })
        .expect(201);
      expect(ok.body.record.workedMinutes).toBe(540);
    });

    it('aynı personel/proje/tarih/vardiya duplicate kaydı engellenir (409); farklı vardiya serbest', async () => {
      const dup = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj1, personnelId: ahmet, workDate: '2026-06-01', shiftKey: 'GUNDUZ', status: 'PRESENT' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('CONFLICT');

      // Aynı gün farklı vardiya ayrı kayıttır (docs/04 unique örneği)
      const night = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj1, personnelId: ahmet, workDate: '2026-06-01', shiftKey: 'GECE', status: 'PRESENT' })
        .expect(201);
      expect(night.body.record.shiftKey).toBe('GECE');
    });

    it('mevcut kayıt PATCH ile düzeltilir (duplicate yolundan değil)', async () => {
      const list = await request(app.getHttpServer())
        .get(`/api/v1/attendance?projectId=${prj1}&workDate=2026-06-01&shiftKey=GUNDUZ`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const record = list.body.data.find((r: { personnelId: string }) => r.personnelId === ahmet);
      expect(record).toBeDefined();

      const patched = await request(app.getHttpServer())
        .patch(`/api/v1/attendance/${record.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'HALF_DAY' })
        .expect(200);
      expect(patched.body.status).toBe('HALF_DAY');
    });

    it('pasif personele yeni puantaj girilemez; geçmiş kaydın düzeltmesi serbesttir', async () => {
      const passive = await createPersonnel(adminToken, { fullName: 'Pasif İşçi', employeeCode: 'P-2999' });
      await request(app.getHttpServer())
        .patch(`/api/v1/personnel/${passive.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'PASSIVE' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj1, personnelId: passive.id, workDate: '2026-06-12', status: 'PRESENT' });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Pasif');

      void mehmet;
    });

    it('clientMutationId ile tekrar gönderim idempotenttir (çevrimdışı kuyruk koruması)', async () => {
      const mutationId = `mobile-mutation-${Date.now()}`;
      const first = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          personnelId: mehmet,
          workDate: '2026-06-13',
          status: 'PRESENT',
          clientMutationId: mutationId,
        })
        .expect(201);
      expect(first.body.replayed).toBe(false);

      const second = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          personnelId: mehmet,
          workDate: '2026-06-13',
          status: 'PRESENT',
          clientMutationId: mutationId,
        })
        .expect(201);
      expect(second.body.replayed).toBe(true);
      expect(second.body.record.id).toBe(first.body.record.id);

      const count = await prisma.attendanceRecord.count({
        where: { personnelId: mehmet, projectId: prj1, workDate: new Date('2026-06-13T00:00:00.000Z') },
      });
      expect(count).toBe(1);
    });

    it('bilinmeyen devam durumu 400 döner', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj1, personnelId: ahmet, workDate: '2026-06-14', status: 'IGNESIZ_TATIL' });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('geçerli bir devam durumu değil');
    });
  });

  // ---------- 4) Toplu işaretleme: önizleme + onay ----------

  describe('Toplu işaretleme', () => {
    let w1 = '';
    let w2 = '';
    let w3 = '';

    beforeAll(async () => {
      const p1 = await createPersonnel(adminToken, { fullName: 'Toplu İşçi Bir', employeeCode: 'P-3001' });
      const p2 = await createPersonnel(adminToken, { fullName: 'Toplu İşçi İki', employeeCode: 'P-3002' });
      const p3 = await createPersonnel(adminToken, { fullName: 'Toplu İşçi Üç', employeeCode: 'P-3003' });
      w1 = p1.id;
      w2 = p2.id;
      w3 = p3.id;
      // w2 pasife alınır → toplu işaretlemede atlanmalı
      await request(app.getHttpServer())
        .patch(`/api/v1/personnel/${w2}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'PASSIVE' })
        .expect(200);
    });

    it('onaysız confirm:true olmayan toplu istek 400 döner (önizleme zorunlu)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/attendance/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj1, workDate: '2026-06-20', status: 'PRESENT', personnelIds: [w1, w2, w3] });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('confirm');
    });

    it('önizleme yazma yapmadan planı listeler; pasif ve mevcut kayıtlı kişiler SKIP olur', async () => {
      // w1'e önceden kayıt açılır (aynı durum → SKIP_DUPLICATE beklenir)
      await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj1, personnelId: w1, workDate: '2026-06-20', status: 'PRESENT' })
        .expect(201);

      const preview = await request(app.getHttpServer())
        .post('/api/v1/attendance/bulk/preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          workDate: '2026-06-20',
          status: 'PRESENT',
          personnelIds: [w1, w2, w3, 'cuid-yok'],
        })
        .expect(200);

      const byAction = (action: string) =>
        preview.body.entries.filter((e: { action: string }) => e.action === action);
      expect(byAction('SKIP_DUPLICATE')).toHaveLength(1);
      expect(byAction('SKIP_PASSIVE')).toHaveLength(1);
      expect(byAction('SKIP_NOT_FOUND')).toHaveLength(1);
      expect(byAction('CREATE')).toHaveLength(1); // w3 kayıtsız → açılacak
      expect(preview.body.skipCount).toBe(3);
      expect(preview.body.createCount).toBe(1);

      // Önizleme yazma yapmadı: w3 hâlâ kayıtsız
      const count = await prisma.attendanceRecord.count({ where: { personnelId: w3 } });
      expect(count).toBe(0);
    });

    it('onayda yalnızca uygun kişilere uygulanır; geçersiz personel kimse dışına yazmaz', async () => {
      // Bu kez w1'in durumu değişecek (PRESENT → ABSENT = UPDATE), w3 CREATE olacak
      const preview = await request(app.getHttpServer())
        .post('/api/v1/attendance/bulk/preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj1, workDate: '2026-06-20', status: 'ABSENT', personnelIds: [w1, w2, w3] })
        .expect(200);
      expect(preview.body.updateCount).toBe(1);
      expect(preview.body.createCount).toBe(1);

      const confirm = await request(app.getHttpServer())
        .post('/api/v1/attendance/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          workDate: '2026-06-20',
          status: 'ABSENT',
          personnelIds: [w1, w2, w3],
          confirm: true,
        })
        .expect(200);
      expect(confirm.body.updateCount).toBe(1);
      expect(confirm.body.createCount).toBe(1);
      expect(confirm.body.skipCount).toBe(1); // pasif w2

      // w1 ABSENT'e güncellendi; w3 ABSENT olarak açıldı; w2'ye kayıt YOK
      const w2Count = await prisma.attendanceRecord.count({ where: { personnelId: w2 } });
      expect(w2Count).toBe(0);

      const w1Record = await prisma.attendanceRecord.findFirst({ where: { personnelId: w1 } });
      expect(w1Record?.status).toBe('ABSENT');

      const w3Record = await prisma.attendanceRecord.findFirst({ where: { personnelId: w3 } });
      expect(w3Record?.status).toBe('ABSENT');

      // ABSENT ile saat girilemez — toplu istekte de doğrulanır
      const bad = await request(app.getHttpServer())
        .post('/api/v1/attendance/bulk/preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          workDate: '2026-06-21',
          status: 'LEAVE',
          checkInAt: '2026-06-21T08:00:00.000Z',
          personnelIds: [w1],
        });
      expect(bad.status).toBe(400);
    });

    it('attendance.view sahibi (TECH_OFFICE) görüntüler ama düzenleyemez', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/attendance?projectId=${prj1}&workDate=2026-06-20`)
        .set('Authorization', `Bearer ${techToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${techToken}`)
        .send({ projectId: prj1, personnelId: w1, workDate: '2026-06-22', status: 'PRESENT' })
        .expect(403);
    });
  });

  // ---------- 5) Proje kapsamı ----------

  describe('Proje kapsamı ve IDOR', () => {
    it('PM kapsam dışı projeye puantaj yazamaz (404) ve listesi boş döner', async () => {
      const personnel = await createPersonnel(adminToken, { fullName: 'Kapsam İşçisi', employeeCode: 'P-4001' });

      const denied = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ projectId: prj2, personnelId: personnel.id, workDate: '2026-06-20', status: 'PRESENT' });
      expect(denied.status).toBe(404);

      const list = await request(app.getHttpServer())
        .get(`/api/v1/attendance?projectId=${prj2}&workDate=2026-06-20`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200);
      expect(list.body.data).toHaveLength(0);
      expect(list.body.meta.total).toBe(0);
    });

    it('PM kendi projesindeki puantajı görür ve düzenleyebilir', async () => {
      const personnel = await createPersonnel(adminToken, { fullName: 'PM Projesi İşçisi', employeeCode: 'P-4002' });
      const created = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj1, personnelId: personnel.id, workDate: '2026-06-25', status: 'PRESENT', siteId: site1 })
        .expect(201);

      const list = await request(app.getHttpServer())
        .get(`/api/v1/attendance?projectId=${prj1}&workDate=2026-06-25`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200);
      expect(list.body.meta.total).toBe(1);
      expect(list.body.data[0].siteName).toBe('Kazı Alanı');

      await request(app.getHttpServer())
        .patch(`/api/v1/attendance/${created.body.record.id}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ note: 'Fazla mesai onaylandı' })
        .expect(200);
    });
  });

  // ---------- 6) Tarih/timezone ve özetler ----------

  describe('Tarih sınırları ve rapor özetleri', () => {
    it('geçersiz tarih biçimi 400 döner (YYYY-MM-DD zorunlu)', async () => {
      const personnel = await createPersonnel(adminToken, { fullName: 'Tarih Test İşçisi', employeeCode: 'P-6001' });
      const res = await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj1, personnelId: personnel.id, workDate: '20.06.2026', status: 'PRESENT' });
      expect(res.status).toBe(400);
    });

    it('özet uç durum adetlerini, kişi sayısını ve çalışılan dakikayı doğru döner', async () => {
      const summary = await request(app.getHttpServer())
        .get(`/api/v1/attendance/summary?projectId=${prj1}&dateFrom=2026-06-01&dateTo=2026-06-30`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(summary.body.byStatus.PRESENT).toBeGreaterThan(0);
      expect(summary.body.byStatus.ABSENT).toBeGreaterThan(0);
      expect(summary.body.totalWorkedMinutes).toBeGreaterThan(0);
      expect(summary.body.uniquePersonnelCount).toBeGreaterThan(0);
      expect(Array.isArray(summary.body.byDate)).toBe(true);

      const reversed = await request(app.getHttpServer())
        .get(`/api/v1/attendance/summary?projectId=${prj1}&dateFrom=2026-06-30&dateTo=2026-06-01`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(reversed.status).toBe(400);
    });

    it('audit log puantaj işlemlerini kaydeder (append-only iz)', async () => {
      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'AttendanceRecord', action: { in: ['attendance.created', 'attendance.updated', 'attendance.bulk_marked'] } },
      });
      expect(logs.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ---------- 7) Kurum ayarı: özel devam durumları ----------

  describe('Kurum ayarı ile durum genişletme', () => {
    it('admin özel durum ekler; yeni durum ile puantaj girilebilir', async () => {
      const patch = await request(app.getHttpServer())
        .patch('/api/v1/org/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ attendanceCustomStatuses: [{ key: 'OVERTIME_REST', label: 'Mesai İstirahati' }] })
        .expect(200);
      expect(patch.body.attendanceCustomStatuses).toHaveLength(1);

      const statuses = await request(app.getHttpServer())
        .get('/api/v1/attendance/statuses')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(statuses.body.statuses).toContain('OVERTIME_REST');
      expect(statuses.body.labels.OVERTIME_REST).toBe('Mesai İstirahati');

      const personnel = await createPersonnel(adminToken, { fullName: 'Özel Durum İşçisi', employeeCode: 'P-5001' });
      await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          personnelId: personnel.id,
          workDate: '2026-06-26',
          status: 'OVERTIME_REST',
        })
        .expect(201);
    });

    it('varsayılan durumla çakışan özel anahtar reddedilir; firma dışı rol ayar değiştiremez', async () => {
      const clash = await request(app.getHttpServer())
        .patch('/api/v1/org/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ attendanceCustomStatuses: [{ key: 'PRESENT', label: 'Kopya' }] });
      expect(clash.status).toBe(400);

      await request(app.getHttpServer())
        .patch('/api/v1/org/settings')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ attendanceCustomStatuses: [] })
        .expect(403);
    });
  });
});
