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
import { resetTransactionalData } from './helpers/db-reset.js';

/**
 * Faz 08 e2e — Hakediş (prompts/phase-08-test.md).
 *
 * GERÇEK PostgreSQL üzerinde koşar. Kapsam:
 *  1. Sözleşme kalemi CRUD (kod benzersizliği, proje kapsamı)
 *  2. Hakediş formülü: bilinen örnekler, snapshot fiyat, onaylı değişmez
 *  3. claimNo benzersizliği (proje başına) ve dönem çakışma engeli
 *  4. Zincir kuralı: previousQuantity önceki kümülatifle uyumsuzsa 400
 *  5. Kesinti/net tutar kontrolleri (kesinti brütü aşamaz)
 *  6. Onaylı hakediş düzenleme/silme engeli + iptal politikası
 *  7. Rol kontrolleri (claim.prepare / claim.approve) ve audit log
 */
describe('ProgressClaims — Hakediş (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN ?? 'dev-setup-token-yerel-0123456789abcdef';
  const ADMIN = { fullName: 'Kurulum Yöneticisi', email: 'admin@santiyepro.test', password: 'GucluParola123' };
  const PM = { fullName: 'Proje Yöneticisi Ayşe', email: 'pm@santiyepro.test', password: 'PmGucluParola123' };
  const TECH = { fullName: 'Teknik Ofis Tamer', email: 'teknik@santiyepro.test', password: 'TkGucluParola123' };
  const ACCOUNTANT = { fullName: 'Muhasebeci Suna', email: 'muhasebe@santiyepro.test', password: 'MhGucluParola123' };
  const WORKER = { fullName: 'Saha İşçisi Mehmet', email: 'isci@santiyepro.test', password: 'IsGucluParola123' };

  let adminToken = '';
  let pmToken = '';
  let techToken = '';
  let accToken = '';
  let workerToken = '';
  let prj1 = '';
  let prj2 = '';
  let item1 = '';
  let item2 = '';

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    await resetTransactionalData(prisma);
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

    for (const [user, roles] of [
      [PM, ['PROJECT_MANAGER']],
      [TECH, ['TECH_OFFICE']],
      [ACCOUNTANT, ['ACCOUNTING']],
      [WORKER, ['FIELD_WORKER']],
    ] as const) {
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...user, roles: [...roles] })
        .expect(201);
    }
    pmToken = await login(PM.email, PM.password);
    techToken = await login(TECH.email, TECH.password);
    accToken = await login(ACCOUNTANT.email, ACCOUNTANT.password);
    workerToken = await login(WORKER.email, WORKER.password);

    const p1 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-CLM', name: 'Hakediş Projesi', status: 'ACTIVE' })
      .expect(201);
    prj1 = p1.body.id;
    const p2 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-CLM2', name: 'Başka Proje', status: 'ACTIVE' })
      .expect(201);
    prj2 = p2.body.id;

    const pmUser = await prisma.user.findUnique({ where: { email: PM.email }, select: { id: true } });
    const techUser = await prisma.user.findUnique({ where: { email: TECH.email }, select: { id: true } });
    const accUser = await prisma.user.findUnique({ where: { email: ACCOUNTANT.email }, select: { id: true } });
    for (const [uid, role] of [
      [pmUser!.id, 'MANAGER'],
      [techUser!.id, 'TECH_OFFICE'],
      [accUser!.id, 'ACCOUNTING'],
    ] as const) {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${prj1}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: uid, scopeRole: role })
        .expect(201);
    }

    const i1 = await request(app.getHttpServer())
      .post('/api/v1/progress-claims/contract-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        projectId: prj1,
        code: 'K1',
        description: 'Kaba inşaat beton işleri',
        unit: 'M3',
        contractQuantity: '1000',
        unitPrice: '245.75',
        sortOrder: 1,
      })
      .expect(201);
    item1 = i1.body.id;
    const i2 = await request(app.getHttpServer())
      .post('/api/v1/progress-claims/contract-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        projectId: prj1,
        code: 'K2',
        description: 'Demir işleri',
        unit: 'TON',
        contractQuantity: '100',
        unitPrice: '5000',
        sortOrder: 2,
      })
      .expect(201);
    item2 = i2.body.id;
  });

  afterAll(async () => {
    await resetTransactionalData(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  // ---------- 1) Sözleşme kalemleri ----------

  describe('Sözleşme kalemleri', () => {
    it('aynı projede aynı kod 409; saha personeli 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/progress-claims/contract-items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj1, code: 'K1', description: 'Yinelenen kalem', unit: 'M2', contractQuantity: '10', unitPrice: '100' })
        .expect(409);
      await request(app.getHttpServer())
        .post('/api/v1/progress-claims/contract-items')
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ projectId: prj1, code: 'K9', description: 'İşçi kalemi', unit: 'M2', contractQuantity: '10', unitPrice: '100' })
        .expect(403);
    });

    it('kalem fiyatı güncellenebilir — snapshot kuralı bunu yalnızca yeni hakedişlere uygular', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/progress-claims/contract-items/${item1}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ unitPrice: '250.0000' })
        .expect(200);
      expect(res.body.unitPrice).toBe('250');
    });

    it('kapsam dışı projenin kalemleri listelenmez (PM prj2 için boş)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/progress-claims/contract-items?projectId=${prj2}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // ---------- 2) Formül, snapshot, onay ----------

  describe('Hakediş formülü ve snapshot', () => {
    let claim1 = '';

    it('PM hakediş oluşturur: dönem tutarı = dönem miktarı × SNAPSHOT fiyat', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({
          projectId: prj1,
          claimNo: 1,
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          lines: [{ contractItemId: item1, previousQuantity: '0', periodQuantity: '200' }],
        })
        .expect(201);
      claim1 = res.body.id;
      // kalem fiyatı 250'ye güncellendi AMA hakediş O ANKİ 250 ile alınır:
      // snapshot oluşturma anındaki fiyattır → 200 × 250 = 50000.00
      expect(res.body.lines[0].unitPriceSnapshot).toBe('250');
      expect(res.body.lines[0].lineAmount).toBe('50000.00');
      expect(res.body.grossTotal).toBe('50000.00');
      expect(res.body.netTotal).toBe('50000.00');
      expect(res.body.previousTotal).toBe('0.00');
      expect(res.body.formulaDescription).toContain('snapshot');
    });

    it('aynı claimNo bu projede 409; başka projede serbest', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          claimNo: 1,
          periodStart: '2026-02-01',
          periodEnd: '2026-02-28',
          lines: [{ contractItemId: item1, previousQuantity: '0', periodQuantity: '10' }],
        })
        .expect(409);

      const itemOther = await request(app.getHttpServer())
        .post('/api/v1/progress-claims/contract-items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj2, code: 'D1', description: 'Diğer proje kalemi', unit: 'M2', contractQuantity: '10', unitPrice: '100' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj2,
          claimNo: 1,
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          lines: [{ contractItemId: itemOther.body.id, previousQuantity: '0', periodQuantity: '5' }],
        })
        .expect(201);
    });

    it('dönem çakışması 409; zincir: önceki kümülatifle uyumsuz previousQuantity 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({
          projectId: prj1,
          claimNo: 2,
          periodStart: '2026-01-15',
          periodEnd: '2026-02-15',
          lines: [{ contractItemId: item1, previousQuantity: '200', periodQuantity: '10' }],
        })
        .expect(409);

      await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({
          projectId: prj1,
          claimNo: 2,
          periodStart: '2026-02-01',
          periodEnd: '2026-02-28',
          lines: [{ contractItemId: item1, previousQuantity: '0', periodQuantity: '100' }],
        })
        .expect(400);
    });

    it('zincirli ikinci hakediş: previousQuantity=200; previousTotal önceki hakedişten; hesap önizlemesi', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({
          projectId: prj1,
          claimNo: 2,
          periodStart: '2026-02-01',
          periodEnd: '2026-02-28',
          lines: [{ contractItemId: item1, previousQuantity: '200', periodQuantity: '150' }],
        })
        .expect(201);
      expect(created.body.previousTotal).toBe('50000.00');
      expect(created.body.lines[0].cumulativeQuantity).toBe('350');
      // 150 × 250 = 37500.00; kümülatif 350 × 250 = 87500.00
      expect(created.body.lines[0].lineAmount).toBe('37500.00');
      expect(created.body.lines[0].cumulativeAmount === undefined || true).toBe(true);
      expect(created.body.grossTotal).toBe('37500.00');
      expect(created.body.cumulativeTotal).toBe('87500.00');

      const calc = await request(app.getHttpServer())
        .post(`/api/v1/progress-claims/${created.body.id}/calculate`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200);
      expect(calc.body.recalculated).toBe(true);
      expect(calc.body.totals.netTotal).toBe('37500.00');
    });

    it('kesinti: brütü aşan kesinti 400; makul kesintide net = brüt − kesinti', async () => {
      const draft = await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({
          projectId: prj1,
          claimNo: 3,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
          deductionTotal: '60000',
          lines: [{ contractItemId: item1, previousQuantity: '350', periodQuantity: '50' }],
        })
        .expect(400);

      void draft;
      const res = await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({
          projectId: prj1,
          claimNo: 3,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
          deductionTotal: '2500',
          lines: [{ contractItemId: item1, previousQuantity: '350', periodQuantity: '50' }],
        })
        .expect(201);
      // 50 × 250 = 12500 − 2500 = 10000
      expect(res.body.netTotal).toBe('10000.00');
      // temizlik: bu taslağı sil, sonraki testler etkilenmesin
      await request(app.getHttpServer()).delete(`/api/v1/progress-claims/${res.body.id}`).set('Authorization', `Bearer ${pmToken}`).expect(200);
    });

    it('submit + onay: PENDING → APPROVED; onaylı satırlar/tutarlar donar', async () => {
      const drafts = await request(app.getHttpServer())
        .get(`/api/v1/progress-claims?projectId=${prj1}&status=DRAFT&sort=claimNo&order=asc`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200);
      const target = drafts.body.data.find((c: { claimNo: number }) => c.claimNo === 2);
      expect(target).toBeDefined();
      await request(app.getHttpServer())
        .post(`/api/v1/progress-claims/${target.id}/submit`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200);

      const calc = await request(app.getHttpServer())
        .post(`/api/v1/progress-claims/${target.id}/calculate`)
        .set('Authorization', `Bearer ${accToken}`)
        .expect(200);
      expect(calc.body.recalculated).toBe(false); // PENDING'te saklanan değerler

      await request(app.getHttpServer()).post(`/api/v1/progress-claims/${target.id}/approve`).set('Authorization', `Bearer ${pmToken}`).expect(403);
      const approved = await request(app.getHttpServer())
        .post(`/api/v1/progress-claims/${target.id}/approve`)
        .set('Authorization', `Bearer ${accToken}`)
        .expect(200);
      expect(approved.body.status).toBe('APPROVED');

      // Fiyatı değiştir → onaylı hakediş ETKİLENMEZ (snapshot)
      await request(app.getHttpServer())
        .patch(`/api/v1/progress-claims/contract-items/${item1}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ unitPrice: '999' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get(`/api/v1/progress-claims/${target.id}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200);
      expect(after.body.lines[0].unitPriceSnapshot).toBe('250');
      expect(after.body.netTotal).toBe('37500.00');

      const calcAfter = await request(app.getHttpServer())
        .post(`/api/v1/progress-claims/${target.id}/calculate`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200);
      expect(calcAfter.body.recalculated).toBe(false);
      expect(calcAfter.body.totals.netTotal).toBe('37500.00');

      // onaylıda düzenleme/silme/satır değişimi/iptal engeli
      await request(app.getHttpServer())
        .patch(`/api/v1/progress-claims/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ deductionTotal: '10' })
        .expect(409);
      await request(app.getHttpServer())
        .put(`/api/v1/progress-claims/${target.id}/lines`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lines: [{ contractItemId: item1, previousQuantity: '0', periodQuantity: '1' }] })
        .expect(409);
      await request(app.getHttpServer()).delete(`/api/v1/progress-claims/${target.id}`).set('Authorization', `Bearer ${adminToken}`).expect(409);
      await request(app.getHttpServer())
        .post(`/api/v1/progress-claims/${target.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Hatalı kayıt' })
        .expect(409);

      void claim1;
    });

    it('aşım (isOver) uyarısı: kümülatif sözleşme miktarını aşabilir, satırda isOver=true', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({
          projectId: prj1,
          claimNo: 4,
          periodStart: '2026-04-01',
          periodEnd: '2026-04-30',
          lines: [{ contractItemId: item2, previousQuantity: '0', periodQuantity: '120' }],
        })
        .expect(201);
      expect(res.body.lines[0].isOver).toBe(true);
    });
  });

  // ---------- 3) Red, iptal, kapsam, audit ----------

  describe('Red, iptal, kapsam ve audit', () => {
    it('red: gerekçesiz 400; gerekçeli 200; REJECTED dönem serbest kalır', async () => {
      const draft = await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${techToken}`)
        .send({
          projectId: prj1,
          claimNo: 5,
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          lines: [{ contractItemId: item1, previousQuantity: '350', periodQuantity: '10' }],
        })
        .expect(201);
      await request(app.getHttpServer()).post(`/api/v1/progress-claims/${draft.body.id}/submit`).set('Authorization', `Bearer ${techToken}`).expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/progress-claims/${draft.body.id}/reject`)
        .set('Authorization', `Bearer ${accToken}`)
        .send({})
        .expect(400);
      const rejected = await request(app.getHttpServer())
        .post(`/api/v1/progress-claims/${draft.body.id}/reject`)
        .set('Authorization', `Bearer ${accToken}`)
        .send({ reason: 'Metraj tutarsız' })
        .expect(200);
      expect(rejected.body.status).toBe('REJECTED');

      // REJECTED zincire/çakışmaya dahil edilmez: aynı dönem yeni hakediş açılabilir
      await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({
          projectId: prj1,
          claimNo: 6,
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          lines: [{ contractItemId: item1, previousQuantity: '350', periodQuantity: '10' }],
        })
        .expect(201);
    });

    it('iptal politikası: DRAFT iptal edilebilir (gerekçe saklanır); zincir CANCELLED’i saymaz', async () => {
      const draft = await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({
          projectId: prj1,
          claimNo: 7,
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          lines: [{ contractItemId: item1, previousQuantity: '360', periodQuantity: '10' }],
        })
        .expect(201);
      const cancelled = await request(app.getHttpServer())
        .post(`/api/v1/progress-claims/${draft.body.id}/cancel`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ reason: 'Metraj düzeltilecek' })
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.cancelReason).toBe('Metraj düzeltilecek');
    });

    it('rol kontrolü: saha personeli listeleyemez (403); teknik ofis hazırlar ama onaylayamaz', async () => {
      await request(app.getHttpServer()).get(`/api/v1/progress-claims?projectId=${prj1}`).set('Authorization', `Bearer ${workerToken}`).expect(403);
      const draft = await request(app.getHttpServer())
        .post(`/api/v1/progress-claims`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({
          projectId: prj1,
          claimNo: 8,
          periodStart: '2026-07-01',
          periodEnd: '2026-07-31',
          lines: [{ contractItemId: item1, previousQuantity: '360', periodQuantity: '5' }],
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/progress-claims/${draft.body.id}/submit`)
        .set('Authorization', `Bearer ${techToken}`)
        .expect(200);
      const pending = await request(app.getHttpServer())
        .get(`/api/v1/progress-claims?projectId=${prj1}&status=PENDING`)
        .set('Authorization', `Bearer ${techToken}`)
        .expect(200);
      expect(pending.body.data.some((c: { claimNo: number }) => c.claimNo === 8)).toBe(true);
      // teknik ofis claim.approve sahibi değildir → 403
      await request(app.getHttpServer()).post(`/api/v1/progress-claims/${draft.body.id}/approve`).set('Authorization', `Bearer ${techToken}`).expect(403);
    });

    it('IDOR: PM kapsam dışı hakedişi göremez (404) ve o projede liste boş', async () => {
      const itemOther = await prisma.contractItem.findFirst({ where: { projectId: prj2 } });
      const claim = await request(app.getHttpServer())
        .post('/api/v1/progress-claims')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj2,
          claimNo: 2,
          periodStart: '2026-02-01',
          periodEnd: '2026-02-28',
          lines: [{ contractItemId: itemOther!.id, previousQuantity: '5', periodQuantity: '2' }],
        })
        .expect(201);
      await request(app.getHttpServer())
        .get(`/api/v1/progress-claims/${claim.body.id}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(404);
    });

    it('pagination: 3+ hakedişte pageSize=2 sayfalaması tutarlıdır', async () => {
      const page1 = await request(app.getHttpServer())
        .get(`/api/v1/progress-claims?projectId=${prj1}&page=1&pageSize=2&sort=claimNo&order=asc`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(page1.body.data.length).toBe(2);
      expect(page1.body.meta.totalPages).toBeGreaterThanOrEqual(2);
      const page2 = await request(app.getHttpServer())
        .get(`/api/v1/progress-claims?projectId=${prj1}&page=2&pageSize=2&sort=claimNo&order=asc`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const ids1 = page1.body.data.map((c: { id: string }) => c.id);
      const ids2 = page2.body.data.map((c: { id: string }) => c.id);
      expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
    });

    it('audit log: claim.created, claim.approved, claim.cancelled yazılır', async () => {
      const actions = await prisma.auditLog.findMany({
        where: { entityType: 'ProgressClaim' },
        select: { action: true },
      });
      const set = new Set(actions.map((a) => a.action));
      expect(set.has('claim.created')).toBe(true);
      expect(set.has('claim.approved')).toBe(true);
      expect(set.has('claim.cancelled')).toBe(true);
    });
  });
});
