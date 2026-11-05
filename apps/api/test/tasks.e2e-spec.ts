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
 * Faz 04 e2e — Görev yönetimi (prompts/phase-04-test.md).
 *
 * Kapsam:
 *  1. CRUD ve zorunlu alan validasyonu (başlık, proje, dueAt ISO 8601, öncelik)
 *  2. Geçerli/geçersiz durum geçişleri (TODO→DONE 400, terminal durumdan çıkış yok)
 *  3. Proje kapsamı ve assignee yetkisi (task.edit / task.assign ayrımı; atanan kişi kendi durumu)
 *  4. Başka projedeki göreve erişim IDOR → 404
 *  5. Checklist (tam liste değişimi) ve yorum kaydı
 *  6. Status history doğru sırada (autoincrement id, from→to zinciri)
 *  7. Due date/timezone sınırları + gecikme (overdue) hesabı
 *  8. Sayfalama/filtreleme/arama/sıralama + version (iyimser eşzamanlılık) 409
 *  9. Atama bildirimi event'i (Notification) + audit kayıtları
 */
describe('Tasks (e2e)', () => {
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
  let techToken = '';
  let pmUserId = '';
  let workerUserId = '';
  let techUserId = '';
  let prj1 = '';
  let prj2 = '';

  beforeAll(async () => {
    await prisma.notification.deleteMany();
    await prisma.taskStatusHistory.deleteMany();
    await prisma.taskComment.deleteMany();
    await prisma.task.deleteMany();
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
    techToken = await login(TECH.email, TECH.password);

    // PRJ-001: sorumlu PM (otomatik üye); işçi eklenir
    const p1 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-001', name: 'Atatürk Bulvarı Konut İnşaatı', managerId: pmUserId, status: 'ACTIVE' })
      .expect(201);
    prj1 = p1.body.id;

    // PM sorumlu olarak eklendi; proje oluşturma PLANNING açar, ACTIVE'e çek
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj1}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: workerUserId, scopeRole: 'WORKER' })
      .expect(201);

    // Teknik ofis de üye (görev oluşturabilir, atayamaz — docs/06 "sınırlı")
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: techUserId, scopeRole: 'TECH_OFFICE' })
      .expect(201);

    // PRJ-002: PM üye değil (IDOR senaryosu)
    const p2 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-002', name: 'Köprü Bakım Onarım' })
      .expect(201);
    prj2 = p2.body.id;
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${prj2}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
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

  function createTask(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/v1/tasks').set('Authorization', `Bearer ${token}`).send(body);
  }

  function patchTask(token: string, id: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).patch(`/api/v1/tasks/${id}`).set('Authorization', `Bearer ${token}`).send(body);
  }

  // ---------- 1) Kimlik doğrulama, CRUD, validasyon ----------

  it('token olmadan görev listesi → 401 (deny-by-default)', async () => {
    await request(app.getHttpServer()).get('/api/v1/tasks').expect(401);
  });

  it('admin görev oluşturur → 201; TODO başlar, ilk geçmiş kaydı null→TODO, version 1', async () => {
    const res = await createTask(adminToken, {
      projectId: prj1,
      title: 'Beton dökümünü planla',
      description: 'Zemin kat perde betonu',
      priority: 'HIGH',
      assigneeId: pmUserId,
      dueAt: '2030-06-30T09:00:00.000Z',
      checklist: [{ label: 'Kalıp kontrolü' }, { label: 'Donatı kontrolü' }],
      fileRefs: [{ id: 'file-1', name: 'plano.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }],
    }).expect(201);

    expect(res.body.status).toBe('TODO');
    expect(res.body.priority).toBe('HIGH');
    expect(res.body.version).toBe(1);
    expect(res.body.overdue).toBe(false);
    expect(res.body.assignee?.id).toBe(pmUserId);
    expect(res.body.checklist).toHaveLength(2);
    expect(res.body.checklist[0].id).toBeTruthy();
    expect(res.body.checklist[0].done).toBe(false);
    expect(res.body.fileRefs[0].name).toBe('plano.pdf');

    const history = await prisma.taskStatusHistory.findMany({ where: { taskId: res.body.id }, orderBy: { id: 'asc' } });
    expect(history).toHaveLength(1);
    expect(history[0]!.fromStatus).toBeNull();
    expect(history[0]!.toStatus).toBe('TODO');
  });

  it('zorunlu alan validasyonu: kısa başlık, bozuk dueAt, geçersiz öncelik → 400', async () => {
    await createTask(adminToken, { projectId: prj1, title: 'ab' }).expect(400);
    await createTask(adminToken, { projectId: prj1, title: 'Geçerli başlık', dueAt: '30.06.2030' }).expect(400);
    await createTask(adminToken, { projectId: prj1, title: 'Geçerli başlık', dueAt: '2030-06-30' }).expect(400);
    await createTask(adminToken, { projectId: prj1, title: 'Geçerli başlık', priority: 'ACIL' }).expect(400);
    await createTask(adminToken, { title: 'Projesiz görev' }).expect(400);
  });

  it('oluşturma izinleri: işçi (task.edit yok) 403; teknik ofis atayamaz (403) ama atamadan oluşturur', async () => {
    await createTask(workerToken, { projectId: prj1, title: 'İşçinin görevi' }).expect(403);

    await createTask(techToken, {
      projectId: prj1,
      title: 'Teknik ofis görevi',
      assigneeId: workerUserId,
    }).expect(403); // task.assign yok — docs/06 "sınırlı" hücresi

    await createTask(techToken, { projectId: prj1, title: 'Teknik ofis görevi (atamasız)' }).expect(201);
  });

  it('atanacak kullanıcı projenin üyesi değilse → 400', async () => {
    // Üye olmayan aktif kullanıcı oluştur
    const outsider = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Dışarıdan Uzman', email: 'dis@santiyepro.test', password: 'DisGucluParola123', roles: ['FIELD_WORKER'] })
      .expect(201);
    await createTask(adminToken, {
      projectId: prj1,
      title: 'Üye olmayana atama',
      assigneeId: outsider.body.id,
    }).expect(400);
  });

  // ---------- 2) Durum geçişleri ----------

  it('geçersiz durum geçişi → 400 (TODO→DONE)', async () => {
    const task = await createTask(adminToken, { projectId: prj1, title: 'Geçiş testi' }).expect(201);
    const res = await patchTask(adminToken, task.body.id, { status: 'DONE' }).expect(400);
    expect(res.body.error.message).toContain('Geçersiz durum geçişi');
  });

  it('geçerli zincir TODO→IN_PROGRESS→DONE; completedAt dolar; terminal durumdan çıkış 400', async () => {
    const task = await createTask(adminToken, { projectId: prj1, title: 'Zincir testi' }).expect(201);
    const id = task.body.id;

    await patchTask(adminToken, id, { status: 'IN_PROGRESS' }).expect(200);
    const done = await patchTask(adminToken, id, { status: 'DONE' }).expect(200);
    expect(done.body.status).toBe('DONE');
    expect(done.body.completedAt).toBeTruthy();
    expect(done.body.version).toBe(3);

    await patchTask(adminToken, id, { status: 'TODO' }).expect(400);
    await patchTask(adminToken, id, { status: 'CANCELLED' }).expect(400);

    const history = await prisma.taskStatusHistory.findMany({ where: { taskId: id }, orderBy: { id: 'asc' } });
    expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([
      [null, 'TODO'],
      ['TODO', 'IN_PROGRESS'],
      ['IN_PROGRESS', 'DONE'],
    ]);
  });

  it('atanan kişi kendi görevinin durumunu değiştirir ama başlığını düzenleyemez', async () => {
    const task = await createTask(adminToken, {
      projectId: prj1,
      title: 'Saha görevi',
      assigneeId: workerUserId,
    }).expect(201);

    // FIELD_WORKER task.edit yok → başlık değişikliği 403
    await patchTask(workerToken, task.body.id, { title: 'İşçinin başlığı' }).expect(403);

    // Ama kendi görevinin DURUMUNU değiştirebilir (saha akışı)
    await patchTask(workerToken, task.body.id, { status: 'IN_PROGRESS' }).expect(200);
    await patchTask(workerToken, task.body.id, { status: 'BLOCKED' }).expect(200);
  });

  it('atanan olmayan işçi başka görevin durumunu değiştiremez (403)', async () => {
    const task = await createTask(adminToken, {
      projectId: prj1,
      title: 'PM görevi',
      assigneeId: pmUserId,
    }).expect(201);
    await patchTask(workerToken, task.body.id, { status: 'IN_PROGRESS' }).expect(403);
  });

  it('atama değişikliği task.assign ister; teknik ofis atama değiştiremez (403)', async () => {
    const task = await createTask(adminToken, { projectId: prj1, title: 'Atama testi' }).expect(201);
    await patchTask(techToken, task.body.id, { assigneeId: workerUserId }).expect(403);
    await patchTask(pmToken, task.body.id, { assigneeId: workerUserId }).expect(200);
    expect(task.body.assignee).toBeNull();
  });

  // ---------- 3) Kapsam ve IDOR ----------

  it('kapsam: PM yalnızca kendi projesinin görevlerini görür; diğer projedeki görev 404 (IDOR)', async () => {
    const inScope = await createTask(adminToken, { projectId: prj1, title: 'Kapsam içi görev' }).expect(201);
    const outScope = await createTask(adminToken, { projectId: prj2, title: 'Kapsam dışı görev' }).expect(201);

    const pmList = await request(app.getHttpServer())
      .get('/api/v1/tasks')
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    expect(pmList.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(pmList.body.data.find((t: { id: string }) => t.id === outScope.body.id)).toBeUndefined();
    expect(pmList.body.data.find((t: { id: string }) => t.id === inScope.body.id)).toBeTruthy();

    await request(app.getHttpServer())
      .get(`/api/v1/tasks/${outScope.body.id}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(404);
    await patchTask(pmToken, outScope.body.id, { title: 'Sızma' }).expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/tasks/${outScope.body.id}/comments`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ body: 'Yetkisiz yorum' })
      .expect(404);
  });

  it("assigneeId=me yalnızca atanan görevleri döner ('Bana Atananlar')", async () => {
    const mine = await createTask(adminToken, {
      projectId: prj1,
      title: 'BanaAtanan tesisat bağlantısı',
      assigneeId: workerUserId,
    }).expect(201);
    await createTask(adminToken, {
      projectId: prj1,
      title: 'BanaAtanan başkasına kalan',
      assigneeId: pmUserId,
    }).expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/v1/tasks?assigneeId=me&search=BanaAtanan')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].id).toBe(mine.body.id);
    expect(res.body.data[0].assignee.id).toBe(workerUserId);
  });

  // ---------- 4) Checklist ve yorumlar ----------

  it('checklist tam liste değişimiyle güncellenir ve DB JSON olarak saklanır', async () => {
    const task = await createTask(adminToken, {
      projectId: prj1,
      title: 'Checklist testi',
      checklist: [{ label: 'Kalıp kontrolü' }, { label: 'Donatı kontrolü' }],
    }).expect(201);

    const items = task.body.checklist.map((c: { id: string; label: string; done: boolean }, i: number) => ({
      id: c.id,
      label: c.label,
      done: i === 0,
    }));
    const updated = await patchTask(adminToken, task.body.id, { checklist: items }).expect(200);
    expect(updated.body.checklist[0].done).toBe(true);
    expect(updated.body.checklist[1].done).toBe(false);
    expect(updated.body.version).toBe(2);

    const row = await prisma.task.findUnique({ where: { id: task.body.id } });
    expect(Array.isArray(row?.checklist)).toBe(true);
  });

  it('yorum eklenir, sayfa metası güncellenir; boş yorum → 400; audit yazılır', async () => {
    const task = await createTask(adminToken, { projectId: prj1, title: 'Yorum testi' }).expect(201);
    const id = task.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/tasks/${id}/comments`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ body: 'Malzeme yolunda' })
      .expect(201);
    // İşçi de yorum yapabilir (task.view + kapsam)
    await request(app.getHttpServer())
      .post(`/api/v1/tasks/${id}/comments`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ body: 'Sahada kaldırım hazır' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/tasks/${id}/comments`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ body: '' })
      .expect(400);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/tasks/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.commentCount).toBe(2);
    expect(detail.body.comments).toHaveLength(2);
    expect(detail.body.comments[0].userFullName).toBe(PM.fullName);

    const comments = await request(app.getHttpServer())
      .get(`/api/v1/tasks/${id}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(comments.body.data).toHaveLength(2);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'task.commented', entityId: id } });
    expect(audit).toBeTruthy();
  });

  // ---------- 5) Status history sırası + audit ----------

  it('durum geçmişi katı sırada tutulur (BLOCKED turu dahil) ve audit üretilir', async () => {
    const task = await createTask(adminToken, { projectId: prj1, title: 'Geçmiş sırası testi' }).expect(201);
    const id = task.body.id;

    await patchTask(adminToken, id, { status: 'IN_PROGRESS' }).expect(200);
    await patchTask(adminToken, id, { status: 'BLOCKED' }).expect(200);
    await patchTask(adminToken, id, { status: 'IN_PROGRESS' }).expect(200);
    await patchTask(adminToken, id, { status: 'DONE' }).expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/tasks/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const chain = detail.body.statusHistory.map((h: { fromStatus: string | null; toStatus: string }) => `${h.fromStatus}→${h.toStatus}`);
    expect(chain).toEqual([
      'null→TODO',
      'TODO→IN_PROGRESS',
      'IN_PROGRESS→BLOCKED',
      'BLOCKED→IN_PROGRESS',
      'IN_PROGRESS→DONE',
    ]);
    // id artan sıra = koşum sırası
    const ids: number[] = detail.body.statusHistory.map((h: { id: number }) => h.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);

    const statusAudit = await prisma.auditLog.findFirst({ where: { action: 'task.status_changed', entityId: id } });
    expect(statusAudit).toBeTruthy();
    const createdAudit = await prisma.auditLog.findFirst({ where: { action: 'task.created', entityId: id } });
    expect(createdAudit).toBeTruthy();
  });

  // ---------- 6) Due date / timezone + overdue ----------

  it('dueAt ISO 8601 saklanır ve timezone kayması olmadan döner; geçmiş termin overdue üretir', async () => {
    const task = await createTask(adminToken, {
      projectId: prj1,
      title: 'Termin testi',
      dueAt: '2020-01-15T10:00:00.000Z',
    }).expect(201);
    expect(task.body.dueAt).toBe('2020-01-15T10:00:00.000Z');
    expect(task.body.overdue).toBe(true);

    // overdue filtresi yakalar; DONE sonrası gecikme kalkar
    const overdueList = await request(app.getHttpServer())
      .get('/api/v1/tasks?overdue=true&projectId=' + prj1)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(overdueList.body.data.find((t: { id: string }) => t.id === task.body.id)).toBeTruthy();

    await patchTask(adminToken, task.body.id, { status: 'IN_PROGRESS' }).expect(200);
    const done = await patchTask(adminToken, task.body.id, { status: 'DONE' }).expect(200);
    expect(done.body.overdue).toBe(false);
  });

  it('ofsetli dueAt kabul edilir ve UTC’ye normalize döner', async () => {
    const task = await createTask(adminToken, {
      projectId: prj1,
      title: 'Ofsetli termin',
      dueAt: '2030-03-01T12:00:00+03:00',
    }).expect(201);
    expect(task.body.dueAt).toBe('2030-03-01T09:00:00.000Z');
  });

  // ---------- 7) Filtre, arama, sıralama, sayfalama, version ----------

  it('filtreleme + arama + sıralama + pagination meta doğru', async () => {
    await createTask(adminToken, { projectId: prj1, title: 'Elektrik tesisatı', priority: 'CRITICAL' }).expect(201);
    await createTask(adminToken, { projectId: prj1, title: 'Sıva işleri', priority: 'LOW' }).expect(201);
    await createTask(adminToken, { projectId: prj1, title: 'Boya işleri', priority: 'LOW' }).expect(201);

    const search = await request(app.getHttpServer())
      .get('/api/v1/tasks?search=elektrik')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(search.body.meta.total).toBe(1);
    expect(search.body.data[0].title).toBe('Elektrik tesisatı');

    const byPriority = await request(app.getHttpServer())
      .get('/api/v1/tasks?sort=priority&order=desc&projectId=' + prj1)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(byPriority.body.data[0].priority).toBe('CRITICAL');

    const page1 = await request(app.getHttpServer())
      .get('/api/v1/tasks?page=1&pageSize=2&projectId=' + prj1)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta.totalPages).toBeGreaterThanOrEqual(2);

    const statusFilter = await request(app.getHttpServer())
      .get('/api/v1/tasks?status=CANCELLED&projectId=' + prj1)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(statusFilter.body.meta.total).toBe(0);
  });

  it('iyimser eşzamanlılık: eski version ile güncelleme → 409 CONFLICT', async () => {
    const task = await createTask(adminToken, { projectId: prj1, title: 'Version testi' }).expect(201);
    await patchTask(adminToken, task.body.id, { title: 'Version testi v2' }).expect(200);
    const res = await patchTask(adminToken, task.body.id, { title: 'Eskimiş güncelleme', version: 1 }).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  // ---------- 8) Atama bildirimi event'i ----------

  it('görev atandığında Notification event\'i üretilir; kendine atamada üretilmez', async () => {
    const task = await createTask(adminToken, { projectId: prj1, title: 'Bildirim testi' }).expect(201);

    // PM'e atama → bildirim
    await patchTask(adminToken, task.body.id, { assigneeId: pmUserId }).expect(200);
    const notif = await prisma.notification.findFirst({
      where: { userId: pmUserId, type: 'task.assigned' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notif).toBeTruthy();
    expect((notif?.payload as { taskId?: string })?.taskId).toBe(task.body.id);

    const countBefore = await prisma.notification.count({ where: { userId: pmUserId } });
    // PM kendi kendine yeniden atama → yeni bildirim yok
    await patchTask(pmToken, task.body.id, { assigneeId: pmUserId }).expect(200);
    const countAfter = await prisma.notification.count({ where: { userId: pmUserId } });
    expect(countAfter).toBe(countBefore);
  });

  it('arşivlenmiş projeye görev eklenemez (400)', async () => {
    const p = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-ARS', name: 'Arşiv Projesi' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${p.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ARCHIVED' })
      .expect(200);

    const res = await createTask(adminToken, { projectId: p.body.id, title: 'Arşive görev' }).expect(400);
    expect(res.body.error.message).toContain('Arşivlenmiş proje');
  });
});
