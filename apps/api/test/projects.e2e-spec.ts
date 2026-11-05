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
 * Faz 03 e2e — Projeler ve şantiyeler (prompts/phase-03-test.md).
 *
 * Kapsam:
 *  1. Proje oluşturma, benzersiz kod (409), doğrulama hataları
 *  2. Decimal tutar string olarak taşınır; tarihler timezone-safe (YYYY-MM-DD)
 *  3. Sorumlu atama → otomatik MANAGER üyeliği
 *  4. Liste: pagination, arama, durum filtresi, sıralama
 *  5. Kapsam: kullanıcı yalnızca üyesi olduğu projeleri görür; kapsam dışı → 404 (IDOR)
 *  6. Üye yönetimi: ekleme/çıkarma/rol değişimi + audit
 *  7. Şantiye: doğru projeye bağlanma, benzersiz ad, yanlış proje → 404
 *  8. Arşivleme: bağlı veriler korunur, liste varsayılanında gizlenir, reaktivasyon
 *  9. Yetki: project.edit olmayan üye yazamaz (403); kimlik doğrulamasız 401
 */
describe('Projects & Sites (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN ?? 'dev-setup-token-yerel-0123456789abcdef';
  const ADMIN = { fullName: 'Kurulum Yöneticisi', email: 'admin@santiyepro.test', password: 'GucluParola123' };
  const PM = { fullName: 'Proje Yöneticisi Ayşe', email: 'pm@santiyepro.test', password: 'PmGucluParola123' };
  const WORKER = { fullName: 'Saha İşçisi Mehmet', email: 'isci@santiyepro.test', password: 'IsGucluParola123' };
  const TECH = { fullName: 'Teknik Ofis Deniz', email: 'teknik@santiyepro.test', password: 'TkGucluParola123' };

  let adminToken = '';
  let pmToken = '';
  let workerToken = '';
  let pmUserId = '';
  let workerUserId = '';
  let techUserId = '';

  beforeAll(async () => {
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

    // İlk admin + test kullanıcıları
    await request(app.getHttpServer()).post('/api/v1/auth/bootstrap').send({ ...ADMIN, setupToken: SETUP_TOKEN }).expect(201);
    adminToken = await login(ADMIN.email, ADMIN.password);

    const pm = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...PM, roles: ['PROJECT_MANAGER'] })
      .expect(201);
    pmUserId = pm.body.id;

    const worker = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...WORKER, roles: ['FIELD_WORKER'] })
      .expect(201);
    workerUserId = worker.body.id;

    const tech = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...TECH, roles: ['TECH_OFFICE'] })
      .expect(201);
    techUserId = tech.body.id;

    pmToken = await login(PM.email, PM.password);
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

  function createProject(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  // ---------- 1) Kimlik doğrulama ve oluşturma ----------

  it('token olmadan proje listesi → 401 (deny-by-default)', async () => {
    await request(app.getHttpServer()).get('/api/v1/projects').expect(401);
  });

  it('admin proje oluşturur → 201; varsayılan PLANNING; audit yazılır', async () => {
    const res = await createProject(adminToken, {
      code: 'PRJ-001',
      name: 'Atatürk Bulvarı Konut İnşaatı',
      clientName: 'Yapı A.Ş.',
      startDate: '2026-02-05',
      plannedEndDate: '2027-06-30',
      contractAmount: '1234567.89',
      managerId: pmUserId,
    }).expect(201);

    expect(res.body.status).toBe('PLANNING');
    expect(res.body.code).toBe('PRJ-001');
    expect(res.body.manager.id).toBe(pmUserId);
    expect(res.body.memberCount).toBe(1); // sorumlu otomatik üye

    const audit = await prisma.auditLog.findFirst({ where: { action: 'project.created' } });
    expect(audit?.entityId).toBe(res.body.id);
  });

  it('mükerrer proje kodu → 409 CONFLICT', async () => {
    const res = await createProject(adminToken, { code: 'PRJ-001', name: 'Aynı Kodlu Proje' }).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('doğrulama: geçersiz tarih biçimi, tutarsız tarih aralığı ve kod → 400', async () => {
    await createProject(adminToken, { code: 'PRJ-X1', name: 'X', startDate: '05.02.2026' }).expect(400);
    await createProject(adminToken, {
      code: 'PRJ-X2',
      name: 'X',
      startDate: '2026-03-01',
      plannedEndDate: '2026-02-01',
    }).expect(400);
    await createProject(adminToken, { code: 'geçersiz kod!', name: 'X' }).expect(400);
    await createProject(adminToken, { code: 'PRJ-X3', name: 'X', contractAmount: '12,50' }).expect(400);
  });

  // ---------- 2) Decimal + timezone-safe tarih ----------

  it('decimal tutar string döner; tarihler YYYY-MM-DD korunur (timezone-safe)', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/projects?search=PRJ-001')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const project = list.body.data[0];
    expect(project.contractAmount).toBe('1234567.89');
    expect(project.startDate).toBe('2026-02-05');
    expect(project.plannedEndDate).toBe('2027-06-30');

    // DB'de DECIMAL ve DATE kolonları
    const row = await prisma.project.findUnique({ where: { code: 'PRJ-001' } });
    expect(row?.contractAmount?.toFixed(2)).toBe('1234567.89');
    expect(row?.startDate).toBeInstanceOf(Date);
  });

  it('tamsayı tutar 2 ondalığa normalize edilir ("1500000" → "1500000.00")', async () => {
    const res = await createProject(adminToken, { code: 'PRJ-002', name: 'Köprü Bakım Onarım', contractAmount: '1500000' }).expect(201);
    expect(res.body.contractAmount).toBe('1500000.00');
  });

  // ---------- 3) Kapsamlı liste: pagination, arama, filtre, sıralama ----------

  it('liste pagination meta doğru; arama ve durum filtresi çalışır', async () => {
    await createProject(adminToken, { code: 'PRJ-003', name: 'Çelik Yapı Montajı' }).expect(201);

    const page1 = await request(app.getHttpServer())
      .get('/api/v1/projects?page=1&pageSize=2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

    const page2 = await request(app.getHttpServer())
      .get('/api/v1/projects?page=2&pageSize=2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page2.body.data).toHaveLength(1);

    const search = await request(app.getHttpServer())
      .get('/api/v1/projects?search=köprü')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].code).toBe('PRJ-002');

    // Durum filtresi: PRJ-002 aktive edilir, PLANNING kalanlar (PRJ-001, PRJ-003)
    const prj2 = await prisma.project.findUnique({ where: { code: 'PRJ-002' } });
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj2!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    const planning = await request(app.getHttpServer())
      .get('/api/v1/projects?status=PLANNING')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(planning.body.meta.total).toBe(2);

    const active = await request(app.getHttpServer())
      .get('/api/v1/projects?status=ACTIVE')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(active.body.meta.total).toBe(1);
    expect(active.body.data[0].code).toBe('PRJ-002');

    // Sıralama: isme göre artan (DB collation'ı C; kod birimi sırasıyla doğrulanır)
    const sorted = await request(app.getHttpServer())
      .get('/api/v1/projects?sort=name&order=asc')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const names: string[] = sorted.body.data.map((p: { name: string }) => p.name);
    const ascending = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(names).toEqual(ascending);
  });

  // ---------- 4) Kapsam + IDOR ----------

  it('kapsam: PM yalnızca üyesi olduğu projeyi görür; kapsam dışı proje 404 (IDOR)', async () => {
    const pmList = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    expect(pmList.body.meta.total).toBe(1);
    expect(pmList.body.data[0].code).toBe('PRJ-001');

    const prj2 = await prisma.project.findUnique({ where: { code: 'PRJ-002' } });
    const prj3 = await prisma.project.findUnique({ where: { code: 'PRJ-003' } });

    // PM, PRJ-002'nin varlığını bile öğrenemez → 404 (okuma ve yazma)
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${prj2!.id}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj2!.id}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ name: 'Sızma Denemesi' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj2!.id}/sites`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ name: 'Yetkisiz Şantiye' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${prj3!.id}/members`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(404);

    // FIELD_WORKER henüz hiçbir projenin üyesi değil → boş liste
    const workerList = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    expect(workerList.body.meta.total).toBe(0);
  });

  it('üye eklenen işçi projeyi görür ama project.edit izni olmadan yazamaz (403)', async () => {
    const prj1 = await prisma.project.findUnique({ where: { code: 'PRJ-001' } });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1!.id}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: workerUserId, scopeRole: 'WORKER' })
      .expect(201);

    const workerList = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    expect(workerList.body.meta.total).toBe(1);
    expect(workerList.body.data[0].code).toBe('PRJ-001');

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${prj1!.id}`)
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);

    // İzin yok: project.edit FIELD_WORKER'da bulunmaz (global guard)
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj1!.id}`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ name: 'İşçinin Değişikliği' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1!.id}/sites`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ name: 'Kaçak Şantiye' })
      .expect(403);
  });

  // ---------- 5) Üye yönetimi ----------

  it('üye yönetimi: ekleme, mükerrer 409, rol değişimi, çıkarma + audit', async () => {
    const prj1 = await prisma.project.findUnique({ where: { code: 'PRJ-001' } });

    // PM (üye + project.edit) teknik ofisi ekler
    const added = await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1!.id}/members`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ userId: techUserId, scopeRole: 'TECH_OFFICE' })
      .expect(201);
    expect(added.body.scopeRole).toBe('TECH_OFFICE');

    // Mükerrer üyelik
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1!.id}/members`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ userId: techUserId })
      .expect(409);

    // Aktif olmayan/olmayan kullanıcı → 400
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1!.id}/members`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ userId: 'olmayan-kullanici-id' })
      .expect(400);

    // Rol değişimi
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj1!.id}/members/${added.body.id}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ scopeRole: 'CHIEF' })
      .expect(200);

    // Üye listesi
    const members = await request(app.getHttpServer())
      .get(`/api/v1/projects/${prj1!.id}/members`)
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    expect(members.body.data.length).toBe(3); // PM (manager) + işçi + teknik ofis
    const pmMember = members.body.data.find((m: { userId: string }) => m.userId === pmUserId);
    expect(pmMember.isManager).toBe(true);

    // Çıkarma + audit
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${prj1!.id}/members/${added.body.id}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(204);

    const addedAudit = await prisma.auditLog.findFirst({ where: { action: 'project.member_added' } });
    expect(addedAudit).toBeTruthy();
    const removedAudit = await prisma.auditLog.findFirst({ where: { action: 'project.member_removed' } });
    expect(removedAudit).toBeTruthy();
  });

  it('sorumlu üyelikten çıkarılırsa proje sorumluluğu boşalır', async () => {
    // Yeni proje: sorumlu = PM
    const proj = await createProject(adminToken, { code: 'PRJ-M01', name: 'Sorumluluk Testi', managerId: pmUserId }).expect(201);
    const member = await request(app.getHttpServer())
      .get(`/api/v1/projects/${proj.body.id}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const pmMember = member.body.data.find((m: { userId: string }) => m.userId === pmUserId);
    expect(pmMember).toBeTruthy();

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${proj.body.id}/members/${pmMember.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/projects/${proj.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.manager).toBeNull();
  });

  // ---------- 6) Şantiyeler ----------

  it('şantiye yalnızca doğru projeye bağlanır; ad proje içinde benzersiz; yanlış proje → 404', async () => {
    const prj1 = await prisma.project.findUnique({ where: { code: 'PRJ-001' } });
    const prj2 = await prisma.project.findUnique({ where: { code: 'PRJ-002' } });

    const site1 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1!.id}/sites`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Kazı Alanı', address: 'Blok A cephesi' })
      .expect(201);
    expect(site1.body.status).toBe('ACTIVE');

    // Aynı isim aynı projede → 409
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1!.id}/sites`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Kazı Alanı' })
      .expect(409);

    // Aynı isim başka projede serbest
    const site2 = await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj2!.id}/sites`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Kazı Alanı' })
      .expect(201);

    // Şantiyeyi yanlış projeden güncelleme → 404 (karışmış kayıt açılamaz)
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj1!.id}/sites/${site2.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INACTIVE' })
      .expect(404);

    // Doğru projeden güncelleme
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj1!.id}/sites/${site1.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INACTIVE' })
      .expect(200);

    // Liste
    const sites = await request(app.getHttpServer())
      .get(`/api/v1/projects/${prj1!.id}/sites`)
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    expect(sites.body.data).toHaveLength(1);

    const siteAudit = await prisma.auditLog.findFirst({ where: { action: 'site.created' } });
    expect(siteAudit).toBeTruthy();
  });

  // ---------- 7) Durum yönetimi ve arşivleme ----------

  it('geçersiz durum geçişi → 400 (PLANNING → COMPLETED)', async () => {
    const prj1 = await prisma.project.findUnique({ where: { code: 'PRJ-001' } });
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj1!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'COMPLETED' })
      .expect(400);
    expect(res.body.error.message).toContain('Geçersiz durum geçişi');
  });

  it('arşivleme: bağlı şantiye ve üyeler korunur; varsayılan listede gizlenir; filtreyle görünür', async () => {
    const prj3 = await prisma.project.findUnique({ where: { code: 'PRJ-003' } });

    // Arşiv öncesi bağlı kayıtlar: şantiye + üye
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj3!.id}/sites`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Montaj Sahası' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj3!.id}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: workerUserId })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj3!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ARCHIVED' })
      .expect(200);

    // Bağlı kayıtlar SİLİNMEDİ (arşiv ≠ silme)
    const siteCount = await prisma.site.count({ where: { projectId: prj3!.id } });
    const memberCount = await prisma.projectMember.count({ where: { projectId: prj3!.id } });
    expect(siteCount).toBe(1);
    expect(memberCount).toBe(1);

    // Varsayılan liste arşivi gizler
    const list = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.data.find((p: { code: string }) => p.code === 'PRJ-003')).toBeUndefined();

    // İşçi iki proje üyesi ama biri arşivli → görünür liste yine 1
    const workerList = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    expect(workerList.body.meta.total).toBe(1);

    // Filtreyle arşivler görünür
    const archived = await request(app.getHttpServer())
      .get('/api/v1/projects?status=ARCHIVED')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(archived.body.meta.total).toBe(1);
    expect(archived.body.data[0].code).toBe('PRJ-003');

    const archiveAudit = await prisma.auditLog.findFirst({ where: { action: 'project.archived' } });
    expect(archiveAudit).toBeTruthy();

    // Detay erişilebilir kalır (bağlı veriler görüntülenebilir)
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${prj3!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('reaktivasyon: ARCHIVED → ACTIVE geçişi çalışır', async () => {
    const prj3 = await prisma.project.findUnique({ where: { code: 'PRJ-003' } });
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj3!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    const row = await prisma.project.findUnique({ where: { code: 'PRJ-003' } });
    expect(row?.status).toBe('ACTIVE');
  });

  it('PM üye olarak proje güncelleyebilir ve durum yönetebilir (PROJECT_MANAGER akışı)', async () => {
    const prj1 = await prisma.project.findUnique({ where: { code: 'PRJ-001' } });
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj1!.id}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    const statusAudit = await prisma.auditLog.findFirst({ where: { action: 'project.status_changed' } });
    expect(statusAudit).toBeTruthy();
    expect(JSON.stringify(statusAudit?.afterJson)).toContain('ACTIVE');
  });
});
