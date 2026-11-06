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
 * Faz 09 e2e — Offline-First Sync (prompts/phase-09-test.md senaryoları).
 *
 *  1. Aynı mutation 3 kez → tek kayıt (SyncMutationLog replay)          [senaryo 3]
 *  2. Push/pull döngüsü: kabul → pull delta (seq cursor)                [senaryo 2]
 *  3. Çakışma: stale version task update → conflict; submit edilmiş
 *     rapora taslak push → conflict (otomatik üzerine yazma YOK)        [senaryo 6]
 *  4. Kalıcı red: VALIDATION_ERROR → rejected + açıklama; replay aynı
 *     sonucu replayed:true ile döner — outbox sessizce silinmez         [senaryo 10]
 *  5. Kapsam: üye olmayan kullanıcının push'u rejected NOT_FOUND,
 *     pull'da kapsam dışı veri GELMEZ                                   [senaryo 8 kısmen]
 *  6. Erişim kaldırma: üyelik silinince accessibleProjectIds dışında    [senaryo 8]
 *  7. Cihaz saati: localCreatedAt saçma değerle sıralama seq'e göre     [senaryo 9]
 *  8. Kritik hareketler: stok/gider push'u sunucu doğrulamasıyla        [senaryo 7 kısmen]
 */
describe('Sync push/pull (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN ?? 'dev-setup-token-yerel-0123456789abcdef';
  const ADMIN = { fullName: 'Kurulum Yöneticisi', email: 'admin@santiyepro.test', password: 'GucluParola123' };
  const PM = { fullName: 'Proje Yöneticisi Senkron', email: 'sync-pm@santiyepro.test', password: 'PmGucluParola123' };
  const OUTSIDER = { fullName: 'Kapsam Dışı Kullanıcı', email: 'sync-out@santiyepro.test', password: 'OsGucluParola123' };

  let adminToken = '';
  let pmToken = '';
  let outsiderToken = '';
  void outsiderToken; // kapsam-dışı kullanıcının token'ı ileride IDOR testlerinde
  let pmUserId = '';
  let prj1 = '';
  let prj2 = '';

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.accessToken as string;
  }

  function push(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function pull(token: string, cursor = 0) {
    return request(app.getHttpServer())
      .get(`/api/v1/sync/pull?cursor=${cursor}`)
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    await prisma.syncMutationLog.deleteMany();
    await prisma.syncEvent.deleteMany();
    await prisma.stockBalance.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.expenseCategory.deleteMany();
    await prisma.progressClaimLine.deleteMany();
    await prisma.progressClaim.deleteMany();
    await prisma.contractItem.deleteMany();
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
    await prisma.material.deleteMany();
    await prisma.warehouse.deleteMany();
    await prisma.site.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.project.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.refreshToken.deleteMany();
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

    const outsider = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...OUTSIDER, roles: ['PROJECT_MANAGER'] })
      .expect(201);
    void outsider;

    pmToken = await login(PM.email, PM.password);
    outsiderToken = await login(OUTSIDER.email, OUTSIDER.password);

    const p1 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-S1', name: 'Senkron Proje Bir', managerId: pmUserId, status: 'ACTIVE' })
      .expect(201);
    prj1 = p1.body.id;

    const p2 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-S2', name: 'Senkron Proje İki', status: 'ACTIVE' })
      .expect(201);
    prj2 = p2.body.id;

    // PM yalnızca prj1 üyesi (prj2 kapsam dışı): managerId ataması ile otomatik üyelik.
    void prj2;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------- Senaryo 3: aynı mutation 3 kez → tek kayıt ----------

  it('aynı clientMutationId ile 3 kez gönderilen puantaj tek kayıt oluşturur ve replayed döner', async () => {
    const personnel = await request(app.getHttpServer())
      .post('/api/v1/personnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Senkron İşçisi', employeeCode: 'SYN-001' })
      .expect(201);

    const mutation = {
      clientMutationId: 'syn-att-0001-2026',
      type: 'attendance.mark',
      payload: {
        projectId: prj1,
        personnelId: personnel.body.id,
        workDate: '2026-11-05',
        shiftKey: 'GUNDUZ',
        status: 'PRESENT',
      },
      localCreatedAt: '2026-11-05T08:00:00.000Z',
    };

    const first = await push(pmToken, { mutations: [mutation] }).expect(201);
    expect(first.body.results[0].status).toBe('accepted');
    expect(first.body.results[0].replayed).toBe(false);
    expect(first.body.results[0].serverId).toBeTruthy();

    for (let i = 0; i < 2; i += 1) {
      const replay = await push(pmToken, { mutations: [mutation] }).expect(201);
      expect(replay.body.results[0].status).toBe('accepted');
      expect(replay.body.results[0].replayed).toBe(true);
      expect(replay.body.results[0].serverId).toBe(first.body.results[0].serverId);
    }

    const records = await prisma.attendanceRecord.count({ where: { projectId: prj1, workDate: new Date('2026-11-05') } });
    expect(records).toBe(1);
  });

  // ---------- Senaryo 2: push → pull delta (seq cursor) ----------

  it('push edilen görev yorumu pull deltasında seq sırasıyla gelir; cursor ilerler', async () => {
    const task = await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId: prj1, title: 'Senkron görev kabası' })
      .expect(201);

    const firstPull = await pull(pmToken, 0).expect(200);
    expect(firstPull.body.cursor).toBeGreaterThan(0);
    expect(Array.isArray(firstPull.body.accessibleProjectIds)).toBe(true);
    expect(firstPull.body.accessibleProjectIds).toContain(prj1);
    const cursorAfterFirst = firstPull.body.cursor as number;

    const commentPush = await push(pmToken, {
      mutations: [
        { clientMutationId: 'syn-cmt-0001-2026', type: 'task.comment', payload: { taskId: task.body.id, body: 'Çevrimdışı yazıldı' } },
      ],
    }).expect(201);
    expect(commentPush.body.results[0].status).toBe('accepted');

    const delta = await pull(pmToken, cursorAfterFirst).expect(200);
    const commentChange = delta.body.changes.find(
      (c: { entityType: string; entityId: string }) => c.entityType === 'taskComment' && c.entityId === commentPush.body.results[0].serverId,
    );
    expect(commentChange).toBeTruthy();
    expect(commentChange.operation).toBe('upsert');
    expect(commentChange.data.body).toBe('Çevrimdışı yazıldı');
    expect(delta.body.hasMore).toBe(false);

    // Cursor'a kadar tekrar çekim boş döner (delta tekrar gönderilmez).
    const empty = await pull(pmToken, delta.body.cursor).expect(200);
    expect(empty.body.changes).toHaveLength(0);
  });

  // ---------- Senaryo 6: çakışma — otomatik üzerine yazma yok ----------

  it('stale version ile görev güncellemesi conflict döner; güncel version kabul edilir', async () => {
    const task = await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId: prj1, title: 'Çakışma görevi' })
      .expect(201);

    const stale = await push(pmToken, {
      mutations: [
        { clientMutationId: 'syn-tsk-0001-2026', type: 'task.update', payload: { taskId: task.body.id, title: 'Cihaz A başlığı', version: 99 } },
      ],
    }).expect(201);
    expect(stale.body.results[0].status).toBe('conflict');
    expect(stale.body.results[0].error?.code).toBe('CONFLICT');

    const fresh = await push(pmToken, {
      mutations: [
        { clientMutationId: 'syn-tsk-0002-2026', type: 'task.update', payload: { taskId: task.body.id, status: 'IN_PROGRESS' } },
      ],
    }).expect(201);
    expect(fresh.body.results[0].status).toBe('accepted');
    expect(fresh.body.results[0].version).toBe(2);
  });

  it('gönderilmiş rapora çevrimdışı taslak push edilirse conflict döner; içerik değişmez', async () => {
    const report = await request(app.getHttpServer())
      .post('/api/v1/daily-reports')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ projectId: prj1, reportDate: '2026-11-05', workSummary: 'Ofisten açılan rapor' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/daily-reports/${report.body.id}/submit`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);

    const offline = await push(pmToken, {
      mutations: [
        {
          clientMutationId: 'syn-rpt-0001-2026',
          type: 'dailyReport.upsertDraft',
          payload: {
            reportId: report.body.id,
            projectId: prj1,
            reportDate: '2026-11-05',
            workSummary: 'Cihazdan değiştirilmiş özet',
          },
        },
      ],
    }).expect(201);
    expect(offline.body.results[0].status).toBe('conflict');
    expect(offline.body.results[0].error?.message).toContain('SUBMITTED');

    const after = await request(app.getHttpServer())
      .get(`/api/v1/daily-reports/${report.body.id}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    expect(after.body.workSummary).toBe('Ofisten açılan rapor');
  });

  // ---------- Senaryo 10: kalıcı red — outbox sessizce silinmez ----------

  it('geçersiz gider push\'u rejected döner; tekrarı aynı sonucu replayed ile döndürür', async () => {
    const mutation = {
      clientMutationId: 'syn-exp-0001-2026',
      type: 'expense.create',
      payload: {
        projectId: prj1,
        categoryId: 'olmayan-kategori',
        description: 'Kısa',
        amount: '100',
        currency: 'TRY',
        expenseDate: '2026-11-05',
      },
    };

    const first = await push(pmToken, { mutations: [mutation] }).expect(201);
    expect(first.body.results[0].status).toBe('rejected');
    expect(first.body.results[0].error?.code).toBe('NOT_FOUND');
    expect(first.body.results[0].error?.message).toBeTruthy();

    const replay = await push(pmToken, { mutations: [mutation] }).expect(201);
    expect(replay.body.results[0].status).toBe('rejected');
    expect(replay.body.results[0].replayed).toBe(true);
    expect(replay.body.results[0].error?.message).toBe(first.body.results[0].error?.message);

    // Defterde saklanır — hata kaydı kaybolmaz.
    const logCount = await prisma.syncMutationLog.count({ where: { clientMutationId: 'syn-exp-0001-2026' } });
    expect(logCount).toBe(1);
  });

  it('geçersiz stok hareketi sunucu doğrulamasıyla rejected olur (kritik hareket otomatik kabul edilmez)', async () => {
    const result = await push(pmToken, {
      mutations: [
        {
          clientMutationId: 'syn-stk-0001-2026',
          type: 'stock.movement',
          payload: {
            type: 'OUT',
            materialId: 'olmayan-malzeme',
            warehouseId: 'olmayan-depo',
            quantity: '5',
          },
        },
      ],
    }).expect(201);
    expect(result.body.results[0].status).toBe('rejected');
    expect(['NOT_FOUND', 'VALIDATION_ERROR']).toContain(result.body.results[0].error?.code);
  });

  // ---------- Senaryo 5: 422/400 doğrulama davranışı ----------

  it('bilinmeyen mutation türü sözleşme seviyesinde 400; geçersiz yük rejected olarak açıklanır', async () => {
    // Bilinmeyen tür zod şemasında reddedilir: tüm batch 400 (sözleşme katılığı).
    await push(pmToken, {
      mutations: [{ clientMutationId: 'syn-bad-0001-2026', type: 'unknown.kind', payload: {} }],
    }).expect(400);

    // Türü geçerli ama yükü eksik mutation → batch içinde rejected + açıklama.
    const result = await push(pmToken, {
      mutations: [{ clientMutationId: 'syn-bad-0002-2026', type: 'attendance.mark', payload: { projectId: prj1 } }],
    }).expect(201);
    expect(result.body.results[0].status).toBe('rejected');
    expect(result.body.results[0].error?.code).toBe('VALIDATION_ERROR');
  });

  // ---------- Senaryo 8: kapsam + erişim kaldırma ----------

  it('üye olunmayan projeye push rejected NOT_FOUND ile döner (veri sızmaz)', async () => {
    const result = await push(pmToken, {
      mutations: [
        {
          clientMutationId: 'syn-scp-0001-2026',
          type: 'attendance.mark',
          payload: { projectId: prj2, personnelId: 'herhangi', workDate: '2026-11-05', shiftKey: 'GUNDUZ', status: 'PRESENT' },
        },
      ],
    }).expect(201);
    expect(result.body.results[0].status).toBe('rejected');
    expect(result.body.results[0].error?.code).toBe('NOT_FOUND');
  });

  it('üyelik kaldırılınca accessibleProjectIds snapshot\'ı projeyi düşürür', async () => {
    const before = await pull(pmToken, 0).expect(200);
    expect(before.body.accessibleProjectIds).toContain(prj1);

    const memberships = await prisma.projectMember.findMany({ where: { projectId: prj1, userId: pmUserId } });
    expect(memberships).toHaveLength(1);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${prj1}/members/${memberships[0]!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const after = await pull(pmToken, before.body.cursor).expect(200);
    expect(after.body.accessibleProjectIds).not.toContain(prj1);

    // Kapsam geri ver (sonraki testler bu üyeliği varsayar).
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: pmUserId, scopeRole: 'MANAGER' })
      .expect(201);
  });

  // ---------- Senaryo 9: cihaz saati sıralamayı bozmaz ----------

  it('localCreatedAt saçma değerlerle gelirse pull sıralaması yine sunucu seq\'ine göre kurulur', async () => {
    const task = await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId: prj1, title: 'Saat kayması görevi' })
      .expect(201);

    const pushRes = await push(pmToken, {
      mutations: [
        {
          clientMutationId: 'syn-skw-0001-2026',
          type: 'task.comment',
          payload: { taskId: task.body.id, body: 'Saat 2030 görünüyor' },
          localCreatedAt: '2030-01-01T00:00:00.000Z', // cihaz saati ileri
        },
        {
          clientMutationId: 'syn-skw-0002-2026',
          type: 'task.comment',
          payload: { taskId: task.body.id, body: 'Saat 1999 görünüyor' },
          localCreatedAt: '1999-01-01T00:00:00.000Z', // cihaz saati geri
        },
      ],
    }).expect(201);
    if (process.env.SYNC_DEBUG) console.log(JSON.stringify(pushRes.body, null, 2));
    expect(pushRes.body.results.every((r: { status: string }) => r.status === 'accepted')).toBe(true);

    const delta = await pull(pmToken, 0).expect(200);
    const seqs = delta.body.changes.map((c: { seq: number }) => c.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    // Cihaz saati ne olursa olsun push sırası seq'e yansır.
    const first = delta.body.changes.find((c: { entityId: string }) => c.entityId === pushRes.body.results[0].serverId);
    const second = delta.body.changes.find((c: { entityId: string }) => c.entityId === pushRes.body.results[1].serverId);
    expect(first.seq).toBeLessThan(second.seq);
  });

  // ---------- Kimlik doğrulama ----------

  it('token olmadan push/pull 401 döner', async () => {
    await request(app.getHttpServer()).post('/api/v1/sync/push').send({ mutations: [] }).expect(401);
    await request(app.getHttpServer()).get('/api/v1/sync/pull?cursor=0').expect(401);
  });

  it('geçersiz batch boyutu 400 döner (zod sözleşmesi)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ mutations: [] })
      .expect(400);
  });
});
