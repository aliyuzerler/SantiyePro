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
 * Faz 08 e2e — Gider (prompts/phase-08-test.md).
 *
 * GERÇEK PostgreSQL üzerinde koşar. Kapsam:
 *  1. Gider CRUD, kategori, tutar/para birimi validasyonu
 *  2. Onay/red akışı ve rol kontrolleri (expense.create / expense.approve)
 *  3. Vergi: opsiyonel alan; verilmezse hesap UYDURULMAZ (taxAmount null)
 *  4. Durum makinesi: DRAFT dışı düzenleme/silme 409; onaylı değişmez
 *  5. Fiş eki: medya varlığı ve tarama durumu
 *  6. Proje kapsamı (IDOR) ve audit log
 */
describe('Expenses — Gider (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN ?? 'dev-setup-token-yerel-0123456789abcdef';
  const ADMIN = { fullName: 'Kurulum Yöneticisi', email: 'admin@santiyepro.test', password: 'GucluParola123' };
  const PM = { fullName: 'Proje Yöneticisi Ayşe', email: 'pm@santiyepro.test', password: 'PmGucluParola123' };
  const ACCOUNTANT = { fullName: 'Muhasebeci Suna', email: 'muhasebe@santiyepro.test', password: 'MhGucluParola123' };
  const WORKER = { fullName: 'Saha İşçisi Mehmet', email: 'isci@santiyepro.test', password: 'IsGucluParola123' };

  let adminToken = '';
  let pmToken = '';
  let accToken = '';
  let workerToken = '';
  let prj1 = '';
  let prj2 = '';
  let category = '';

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
    accToken = await login(ACCOUNTANT.email, ACCOUNTANT.password);
    workerToken = await login(WORKER.email, WORKER.password);

    const p1 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-EXP', name: 'Gider Projesi', status: 'ACTIVE' })
      .expect(201);
    prj1 = p1.body.id;
    const p2 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-EXP2', name: 'Diğer Proje', status: 'ACTIVE' })
      .expect(201);
    prj2 = p2.body.id;

    const pmUser = await prisma.user.findUnique({ where: { email: PM.email }, select: { id: true } });
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: pmUser!.id, scopeRole: 'MANAGER' })
      .expect(201);
    // Muhasebe onay kapsamı: proje üyesi olarak eklenir (docs/06 "atanmış")
    const accUser = await prisma.user.findUnique({ where: { email: ACCOUNTANT.email }, select: { id: true } });
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: accUser!.id, scopeRole: 'ACCOUNTING' })
      .expect(201);

    const cat = await request(app.getHttpServer())
      .post('/api/v1/expenses/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Yakıt' })
      .expect(201);
    category = cat.body.id;
  });

  afterAll(async () => {
    await resetTransactionalData(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  // ---------- 1) Kategoriler ----------

  describe('Kategori yönetimi', () => {
    it('aynı adla kategori 409 döner; kısa ad 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/expenses/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Yakıt' })
        .expect(409);
      await request(app.getHttpServer())
        .post('/api/v1/expenses/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'A' })
        .expect(400);
    });

    it('kategori yönetimi firm.settings.manage ister: PM 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/expenses/categories')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ name: 'Malzeme' })
        .expect(403);
    });

    it('pasife alınan kategori yeni giderde kullanılamaz (400)', async () => {
      const cat = await request(app.getHttpServer())
        .post('/api/v1/expenses/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Kırtasiye' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/expenses/categories/${cat.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          categoryId: cat.body.id,
          description: 'Kırtasiye alımı',
          amount: '50',
          expenseDate: '2026-01-10',
        })
        .expect(400);
    });
  });

  // ---------- 2) Gider CRUD ve validasyon ----------

  describe('Gider oluşturma ve validasyon', () => {
    it('admin gider oluşturur: DRAFT, TRY varsayılan; taxRate verilmezse vergi UYDURULMAZ', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          categoryId: category,
          vendorName: 'Petrol Ofisi',
          description: 'Dizel alımı',
          amount: '1250.50',
          expenseDate: '2026-01-15',
        })
        .expect(201);
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.currency).toBe('TRY');
      expect(res.body.taxRate).toBeNull();
      expect(res.body.taxAmount).toBeNull();
      expect(res.body.totalWithTax).toBeNull();
      expect(res.body.amount).toBe('1250.50');
    });

    it('tutar validasyonu: 3 ondalık 400, sıfır 400, harf 400', async () => {
      for (const amount of ['10.505', '0', 'abc', '-5']) {
        await request(app.getHttpServer())
          .post('/api/v1/expenses')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ projectId: prj1, categoryId: category, description: 'Test', amount, expenseDate: '2026-01-15' })
          .expect(400);
      }
    });

    it('para birimi 3 harf olmalıdır; opsiyonel vergi verilirse türetilir (uydurma yok)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj1, categoryId: category, description: 'Test', amount: '10', currency: 'TR', expenseDate: '2026-01-15' })
        .expect(400);

      const res = await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          categoryId: category,
          description: 'KDV’li alım',
          amount: '1000.00',
          taxRate: '20',
          expenseDate: '2026-01-16',
        })
        .expect(201);
      expect(res.body.taxRate).toBe('20.00');
      expect(res.body.taxAmount).toBe('200.00');
      expect(res.body.totalWithTax).toBe('1200.00');
    });

    it('rol kontrolü: saha personeli oluşturamaz (403); PM kendi projesinde oluşturur', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${workerToken}`)
        .send({ projectId: prj1, categoryId: category, description: 'İşçi gideri', amount: '10', expenseDate: '2026-01-15' })
        .expect(403);

      const res = await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ projectId: prj1, categoryId: category, vendorName: 'Yerel Tedarik', description: 'İnşaat malzemesi', amount: '300', expenseDate: '2026-01-17' })
        .expect(201);
      expect(res.body.createdBy.fullName).toContain('Ayşe');
    });

    it('IDOR: PM kapsam dışı projeye gider yazamaz (404), kapsam dışı gideri göremez (404)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ projectId: prj2, categoryId: category, description: 'Diğer proje gideri', amount: '10', expenseDate: '2026-01-15' })
        .expect(404);

      const adminExpense = await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ projectId: prj2, categoryId: category, description: 'Diğer proje gideri', amount: '20', expenseDate: '2026-01-15' })
        .expect(201);
      await request(app.getHttpServer())
        .get(`/api/v1/expenses/${adminExpense.body.id}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(404);
    });

    it('fiş eki: olmayan medya 404; taranmamış (PENDING) medya 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          categoryId: category,
          description: 'Fişli alım',
          amount: '10',
          expenseDate: '2026-01-15',
          receiptMediaId: 'clmayokbirmedya0000000',
        })
        .expect(404);

      const media = await prisma.mediaFile.create({
        data: {
          storageKey: `receipts/test/${Date.now()}-fis.pdf`,
          originalName: 'fis.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          scanStatus: 'PENDING',
          uploadedById: (await prisma.user.findUnique({ where: { email: ADMIN.email }, select: { id: true } }))!.id,
        },
      });
      await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectId: prj1,
          categoryId: category,
          description: 'Fişli alım',
          amount: '10',
          expenseDate: '2026-01-15',
          receiptMediaId: media.id,
        })
        .expect(400);
    });
  });

  // ---------- 3) Durum makinesi ve onay akışı ----------

  describe('Onay/red akışı', () => {
    let draftId = '';

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ projectId: prj1, categoryId: category, description: 'Kiralık vinç', amount: '8500', expenseDate: '2026-02-01' })
        .expect(201);
      draftId = res.body.id;
    });

    it('taslak düzenlenir ve silinebilir', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/expenses/${draftId}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ amount: '9000.00', vendorName: 'Vinç A.Ş.' })
        .expect(200);
      const draft2 = await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ projectId: prj1, categoryId: category, description: 'İptal edilecek', amount: '10', expenseDate: '2026-02-01' })
        .expect(201);
      await request(app.getHttpServer()).delete(`/api/v1/expenses/${draft2.body.id}`).set('Authorization', `Bearer ${pmToken}`).expect(200);
      await request(app.getHttpServer()).get(`/api/v1/expenses/${draft2.body.id}`).set('Authorization', `Bearer ${pmToken}`).expect(404);
    });

    it('submit: DRAFT → PENDING; tekrar submit 409; PM onaylayamaz (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/expenses/${draftId}/submit`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200);
      expect(res.body.status).toBe('PENDING');

      await request(app.getHttpServer()).post(`/api/v1/expenses/${draftId}/submit`).set('Authorization', `Bearer ${pmToken}`).expect(409);
      await request(app.getHttpServer())
        .patch(`/api/v1/expenses/${draftId}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ amount: '1' })
        .expect(409);

      await request(app.getHttpServer()).post(`/api/v1/expenses/${draftId}/approve`).set('Authorization', `Bearer ${pmToken}`).expect(403);
    });

    it('muhasebe onaylar: APPROVED; onaylı gider PATCH/DELETE 409 ve değişmez', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/expenses/${draftId}/approve`)
        .set('Authorization', `Bearer ${accToken}`)
        .expect(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.approvedBy.fullName).toContain('Suna');
      expect(res.body.amount).toBe('9000.00');

      await request(app.getHttpServer())
        .patch(`/api/v1/expenses/${draftId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: '1' })
        .expect(409);
      await request(app.getHttpServer()).delete(`/api/v1/expenses/${draftId}`).set('Authorization', `Bearer ${adminToken}`).expect(409);
      await request(app.getHttpServer()).post(`/api/v1/expenses/${draftId}/approve`).set('Authorization', `Bearer ${accToken}`).expect(409);
    });

    it('red: gerekçesiz 400; gerekçeli 200 REJECTED; red sonrası değişmez', async () => {
      const res0 = await request(app.getHttpServer())
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ projectId: prj1, categoryId: category, description: 'Red edilecek alım', amount: '100', expenseDate: '2026-02-02' })
        .expect(201);
      await request(app.getHttpServer()).post(`/api/v1/expenses/${res0.body.id}/submit`).set('Authorization', `Bearer ${pmToken}`).expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/expenses/${res0.body.id}/reject`)
        .set('Authorization', `Bearer ${accToken}`)
        .send({})
        .expect(400);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/expenses/${res0.body.id}/reject`)
        .set('Authorization', `Bearer ${accToken}`)
        .send({ reason: 'Fatura kurumsal değil' })
        .expect(200);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.rejectionReason).toBe('Fatura kurumsal değil');
    });
  });

  // ---------- 4) Liste, kapsam, audit ----------

  describe('Liste, filtre şartı ve audit log', () => {
    it('filtresiz liste 400 (finans verisi koruması); status filtresiyle sayfalanır', async () => {
      await request(app.getHttpServer()).get('/api/v1/expenses').set('Authorization', `Bearer ${adminToken}`).expect(400);
      const res = await request(app.getHttpServer())
        .get('/api/v1/expenses?status=APPROVED&page=1&pageSize=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.meta).toHaveProperty('totalPages');
    });

    it('tarih aralığı filtresi çalışır; saha personeli listeleyemez (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/expenses?dateFrom=2026-02-01&dateTo=2026-02-28')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.data.every((e: { expenseDate: string }) => e.expenseDate >= '2026-02-01' && e.expenseDate <= '2026-02-28')).toBe(true);

      await request(app.getHttpServer()).get('/api/v1/expenses?status=DRAFT').set('Authorization', `Bearer ${workerToken}`).expect(403);
    });

    it('audit log: expense.created ve expense.approved yazılır', async () => {
      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'Expense', action: { in: ['expense.created', 'expense.approved'] } },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => l.action)).toContain('expense.created');
      expect(logs.map((l) => l.action)).toContain('expense.approved');
    });
  });
});
