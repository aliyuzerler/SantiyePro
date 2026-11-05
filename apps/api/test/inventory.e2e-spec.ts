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
 * Faz 07 e2e — Depo, Malzeme ve Stok Hareketleri (prompts/phase-07-test.md).
 *
 * GERÇEK PostgreSQL üzerinde koşar; transaction mock'lanmaz.
 * Kapsam:
 *  1. Malzeme/depo CRUD, birim ve miktar validasyonu (3 ondalık sınırı, sıfır, kod 409)
 *  2. IN/OUT/TRANSFER/RETURN/ADJUSTMENT/REVERSAL iş kuralları
 *  3. Stoktan fazla çıkış engeli (409)
 *  4. İki eşzamanlı çıkışta negatif stok oluşmaması (koşullu atomik UPDATE)
 *  5. Transferin atomikliği: yetersiz kaynak stokta iki taraf da geri alınır
 *  6. Duplicate clientMutationId tekrar stok düşürmez (idempotency)
 *  7. Geçmiş hareket fiziksel silinemez/değiştirilemez (PATCH/DELETE 404)
 *  8. Proje kapsamı, depo yetkisi ve audit log
 *  9. Büyük hareket listesinde pagination
 */
describe('Inventory — Depo, Malzeme ve Stok Hareketleri (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN ?? 'dev-setup-token-yerel-0123456789abcdef';
  const ADMIN = { fullName: 'Kurulum Yöneticisi', email: 'admin@santiyepro.test', password: 'GucluParola123' };
  const PM = { fullName: 'Proje Yöneticisi Ayşe', email: 'pm@santiyepro.test', password: 'PmGucluParola123' };
  const WAREHOUSE_KEEPER = { fullName: 'Depocu Kamil', email: 'depocu@santiyepro.test', password: 'DpGucluParola123' };
  const WORKER = { fullName: 'Saha İşçisi Mehmet', email: 'isci@santiyepro.test', password: 'IsGucluParola123' };

  let adminToken = '';
  let pmToken = '';
  let whToken = '';
  let workerToken = '';
  let prj1 = '';
  let kurumWarehouse = '';
  let projectWarehouse = '';
  let cement = '';
  let rebar = '';

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.accessToken as string;
  }

  async function move(token: string, input: Record<string, unknown>, expectStatus?: number) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/inventory/movements')
      .set('Authorization', `Bearer ${token}`)
      .send(input);
    if (expectStatus !== undefined) expect(res.status).toBe(expectStatus);
    return res;
  }

  async function balance(token: string, warehouseId: string, materialId: string): Promise<{ quantity: string; isLow: boolean }> {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/inventory/balances?warehouseId=${warehouseId}&materialId=${materialId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const row = (res.body.data as Array<{ materialId: string; quantity: string; isLow: boolean }>).find(
      (r) => r.materialId === materialId,
    );
    return row ?? { quantity: '0', isLow: false };
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

    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...PM, roles: ['PROJECT_MANAGER'] })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...WAREHOUSE_KEEPER, roles: ['WAREHOUSE'] })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...WORKER, roles: ['FIELD_WORKER'] })
      .expect(201);

    pmToken = await login(PM.email, PM.password);
    whToken = await login(WAREHOUSE_KEEPER.email, WAREHOUSE_KEEPER.password);
    workerToken = await login(WORKER.email, WORKER.password);
    void pmToken; // PM kapsam senaryoları web-e2e'de; burada yalnızca oturum doğrulaması

    const p1 = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PRJ-INV', name: 'Stok Projesi', status: 'ACTIVE' })
      .expect(201);
    prj1 = p1.body.id;

    // PM'yi projeye üye yap (scope testleri için)
    const pmUser = await prisma.user.findUnique({ where: { email: PM.email }, select: { id: true } });
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${prj1}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: pmUser!.id, scopeRole: 'MANAGER' })
      .expect(201);

    const kw = await request(app.getHttpServer())
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Merkez Depo', location: 'Lokal' })
      .expect(201);
    kurumWarehouse = kw.body.id;

    const pw = await request(app.getHttpServer())
      .post('/api/v1/inventory/warehouses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId: prj1, name: 'Şantiye Deposu' })
      .expect(201);
    projectWarehouse = pw.body.id;

    const m1 = await request(app.getHttpServer())
      .post('/api/v1/inventory/materials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'CIM-425', name: 'Çimento CEM I 42,5', unit: 'TORBA', minStock: '10' })
      .expect(201);
    cement = m1.body.id;

    const m2 = await request(app.getHttpServer())
      .post('/api/v1/inventory/materials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'INB-12', name: 'İnşaat Demiri Ø12', unit: 'ADET' })
      .expect(201);
    rebar = m2.body.id;
  });

  afterAll(async () => {
    // Bu spec'in bıraktığı stok verisi, diğer e2e spec'lerinin kullanıcı
    // temizliğini FK ile bloklamasın (paylaşılan test veritabanı, sıralı koşum).
    await resetTransactionalData(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  // ---------- 1) Malzeme/depo CRUD ve validasyon ----------

  describe('Malzeme ve depo CRUD', () => {
    it('malzeme adı en az 2 karakter; miktar alanları 3 ondalık basamağı aşamaz', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/inventory/materials')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'A' })
        .expect(400);

      await request(app.getHttpServer())
        .post('/api/v1/inventory/materials')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Hatalı Malzeme', minStock: '1.0001' })
        .expect(400);

      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/materials')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Kum 0-5 mm', unit: 'TON', minStock: '2.5' })
        .expect(201);
      expect(res.body.minStock).toBe('2.5');
      expect(res.body.isActive).toBe(true);
    });

    it('malzeme kodu benzersiz: aynı kod 409 döner', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/materials')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'CIM-425', name: 'Yinelenen Kod' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('pasife alınan malzemeye yeni hareket girilemez', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/materials')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Kaldırılacak Malzeme' })
        .expect(201);
      const id = res.body.id as string;

      await request(app.getHttpServer())
        .patch(`/api/v1/inventory/materials/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);

      await move(adminToken, { type: 'IN', materialId: id, warehouseId: kurumWarehouse, quantity: '5' }, 400);
    });

    it('aynı kapsamda aynı isimde depo 409 döner', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/inventory/warehouses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Merkez Depo' });
      expect(res.status).toBe(409);
    });
  });

  // ---------- 2) Hareket iş kuralları ----------

  describe('IN / OUT / TRANSFER / RETURN / ADJUSTMENT iş kuralları', () => {
    it('IN bakiyeyi artırır; OUT azaltır; birim uyumsuzluğu 400 döner', async () => {
      await move(adminToken, { type: 'IN', materialId: cement, warehouseId: kurumWarehouse, quantity: '100.5', unitCost: '245.75' });
      expect((await balance(adminToken, kurumWarehouse, cement)).quantity).toBe('100.5');

      await move(adminToken, { type: 'OUT', materialId: cement, warehouseId: kurumWarehouse, quantity: '0.5', unit: 'TON' }, 400);

      await move(adminToken, { type: 'OUT', materialId: cement, warehouseId: kurumWarehouse, quantity: '0.5' });
      expect((await balance(adminToken, kurumWarehouse, cement)).quantity).toBe('100');
    });

    it('RETURN sahaya verilen malı depoya geri ekler', async () => {
      await move(adminToken, { type: 'RETURN', materialId: cement, warehouseId: kurumWarehouse, quantity: '2.5', note: 'Sahadan iade' });
      expect((await balance(adminToken, kurumWarehouse, cement)).quantity).toBe('102.5');
    });

    it('ADJUSTMENT işaretli miktar alır; açıklama zorunludur; negatif stok oluşamaz', async () => {
      await move(adminToken, { type: 'ADJUSTMENT', materialId: cement, warehouseId: kurumWarehouse, quantity: '-0.25' }, 400);
      await move(adminToken, {
        type: 'ADJUSTMENT',
        materialId: cement,
        warehouseId: kurumWarehouse,
        quantity: '-0.25',
        note: 'Nem kaybı sayım farkı',
      });
      expect((await balance(adminToken, kurumWarehouse, cement)).quantity).toBe('102.25');

      await move(
        adminToken,
        { type: 'ADJUSTMENT', materialId: cement, warehouseId: kurumWarehouse, quantity: '-500', note: 'Aşırı düşüş denemesi' },
        409,
      );
      expect((await balance(adminToken, kurumWarehouse, cement)).quantity).toBe('102.25');
    });

    it('TRANSFER kaynak çıkış + hedef giriştir; transfer sonrası iki bakiye doğru', async () => {
      await move(adminToken, { type: 'IN', materialId: rebar, warehouseId: kurumWarehouse, quantity: '12' });
      await move(adminToken, {
        type: 'TRANSFER',
        materialId: rebar,
        warehouseId: kurumWarehouse,
        targetWarehouseId: projectWarehouse,
        quantity: '12',
        note: 'Şantiyeye aktarım',
      });
      expect((await balance(adminToken, kurumWarehouse, rebar)).quantity).toBe('0');
      expect((await balance(adminToken, projectWarehouse, rebar)).quantity).toBe('12');
    });

    it('TRANSFER kaynak=hedef ve hedef yok: 400/404; bakiye değişmez', async () => {
      await move(
        adminToken,
        { type: 'TRANSFER', materialId: rebar, warehouseId: kurumWarehouse, targetWarehouseId: kurumWarehouse, quantity: '1' },
        400,
      );
      await move(
        adminToken,
        { type: 'TRANSFER', materialId: rebar, warehouseId: kurumWarehouse, targetWarehouseId: 'yok-depo', quantity: '1' },
        404,
      );
    });

    it('REVERSAL: hareket ters kaydedilir, bakiye geri alınır; ikinci ters kayıt 409; REVERSAL ters kaydedilemez', async () => {
      const before = (await balance(adminToken, kurumWarehouse, cement)).quantity;

      const res = await move(adminToken, { type: 'OUT', materialId: cement, warehouseId: kurumWarehouse, quantity: '5' });
      const movementId = res.body.movement.id as string;
      expect((await balance(adminToken, kurumWarehouse, cement)).quantity).toBe('97.25');

      const rev = await request(app.getHttpServer())
        .post(`/api/v1/inventory/movements/${movementId}/reverse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Yanlış depodan çıkış' })
        .expect(201);
      expect(rev.body.movement.type).toBe('REVERSAL');
      expect(rev.body.movement.reversesMovementId).toBe(movementId);
      expect((await balance(adminToken, kurumWarehouse, cement)).quantity).toBe(before);

      await request(app.getHttpServer())
        .post(`/api/v1/inventory/movements/${movementId}/reverse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Tekrar deneme' })
        .expect(409);

      const reversalId = rev.body.movement.id as string;
      await request(app.getHttpServer())
        .post(`/api/v1/inventory/movements/${reversalId}/reverse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Ters kaydın tersi' })
        .expect(409);
    });

    it('TRANSFER ters kaydı yönü değiştirir: hedeften düşer, kaynağa ekler', async () => {
      const srcBefore = (await balance(adminToken, projectWarehouse, rebar)).quantity;
      const dstBefore = (await balance(adminToken, kurumWarehouse, rebar)).quantity;

      const res = await move(adminToken, {
        type: 'TRANSFER',
        materialId: rebar,
        warehouseId: projectWarehouse,
        targetWarehouseId: kurumWarehouse,
        quantity: '3',
      });
      const transferId = res.body.movement.id as string;

      await request(app.getHttpServer())
        .post(`/api/v1/inventory/movements/${transferId}/reverse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Transfer iptali' })
        .expect(201);

      expect((await balance(adminToken, projectWarehouse, rebar)).quantity).toBe(srcBefore);
      expect((await balance(adminToken, kurumWarehouse, rebar)).quantity).toBe(dstBefore);
    });
  });

  // ---------- 3) + 4) Negatif stok ve eşzamanlılık ----------

  describe('Negatif stok engeli ve eşzamanlılık', () => {
    it('stoktan fazla çıkış 409 döner ve bakiye değişmez', async () => {
      const m = await request(app.getHttpServer())
        .post('/api/v1/inventory/materials')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Tuğla 8.5x19x19', unit: 'ADET' })
        .expect(201);
      const brick = m.body.id as string;

      await move(adminToken, { type: 'IN', materialId: brick, warehouseId: kurumWarehouse, quantity: '50' });

      const res = await move(adminToken, { type: 'OUT', materialId: brick, warehouseId: kurumWarehouse, quantity: '50.001' }, 409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect((await balance(adminToken, kurumWarehouse, brick)).quantity).toBe('50');
    });

    it('iki eşzamanlı çıkıştan yalnızca biri geçer; negatif stok oluşmaz', async () => {
      const m = await request(app.getHttpServer())
        .post('/api/v1/inventory/materials')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Çelik Hasır', unit: 'ADET' })
        .expect(201);
      const mesh = m.body.id as string;

      await move(adminToken, { type: 'IN', materialId: mesh, warehouseId: kurumWarehouse, quantity: '10' });

      // Bakiye 10; iki eşzamanlı 8'lik çıkış → en fazla biri başarılı.
      const [r1, r2] = await Promise.all([
        move(adminToken, { type: 'OUT', materialId: mesh, warehouseId: kurumWarehouse, quantity: '8' }),
        move(adminToken, { type: 'OUT', materialId: mesh, warehouseId: kurumWarehouse, quantity: '8' }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);
      expect((await balance(adminToken, kurumWarehouse, mesh)).quantity).toBe('2');
    });

    it('transferin atomikliği: yetersiz kaynak stokta iki taraf da geri alınır', async () => {
      // hedef depoda bakiye yok; kaynakta 2 var. Transfer 8: kaynak düşüşü başarısız
      // → hedef artışı da geri alınmalı (tek transaction).
      const res = await move(
        adminToken,
        {
          type: 'TRANSFER',
          materialId: rebar,
          warehouseId: kurumWarehouse,
          targetWarehouseId: projectWarehouse,
          quantity: '8',
        },
        409,
      );
      expect(res.body.error.code).toBe('CONFLICT');
      expect((await balance(adminToken, kurumWarehouse, rebar)).quantity).toBe('0');
      expect((await balance(adminToken, projectWarehouse, rebar)).quantity).toBe('12'); // 12 − 3 (ters kayıt sonrası)
    });
  });

  // ---------- 5) + 6) Idempotency ----------

  describe('clientMutationId idempotency', () => {
    it('duplicate clientMutationId tekrar stok düşürmez; aynı kayıt döner', async () => {
      const mutationId = 'offqueue-0001-abcdef12';
      const first = await move(adminToken, {
        type: 'OUT',
        materialId: cement,
        warehouseId: kurumWarehouse,
        quantity: '1',
        clientMutationId: mutationId,
      });
      expect(first.body.replayed).toBe(false);
      const afterFirst = (await balance(adminToken, kurumWarehouse, cement)).quantity;

      const second = await move(adminToken, {
        type: 'OUT',
        materialId: cement,
        warehouseId: kurumWarehouse,
        quantity: '1',
        clientMutationId: mutationId,
      });
      expect(second.status).toBe(201);
      expect(second.body.replayed).toBe(true);
      expect(second.body.movement.id).toBe(first.body.movement.id);
      expect((await balance(adminToken, kurumWarehouse, cement)).quantity).toBe(afterFirst);
    });
  });

  // ---------- 7) Append-only ----------

  describe('Append-only hareket kaydı', () => {
    it('geçmiş hareket PATCH ve DELETE ile değiştirilemez/silinemez (404)', async () => {
      const res = await move(adminToken, { type: 'IN', materialId: cement, warehouseId: kurumWarehouse, quantity: '1' });
      const id = res.body.movement.id as string;

      await request(app.getHttpServer())
        .patch(`/api/v1/inventory/movements/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: '99' })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/v1/inventory/movements/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  // ---------- 8) Kapsam, yetki ve audit ----------

  describe('Proje kapsamı, depo yetkisi ve audit log', () => {
    it('FIELD_WORKER stok uçlarına erişemez (403)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/inventory/materials')
        .set('Authorization', `Bearer ${workerToken}`)
        .expect(403);
      await move(workerToken, { type: 'IN', materialId: cement, warehouseId: kurumWarehouse, quantity: '1' }, 403);
    });

    it('proje üyesi olmayan depocu proje deposunu görmez; hareketi 404 olur', async () => {
      // Depocu WAREHOUSE rolü: proje üyesi değil → proje deposu kapsam dışı.
      const list = await request(app.getHttpServer())
        .get('/api/v1/inventory/warehouses')
        .set('Authorization', `Bearer ${whToken}`)
        .expect(200);
      const ids = (list.body.data as Array<{ id: string }>).map((w) => w.id);
      expect(ids).toContain(kurumWarehouse);
      expect(ids).not.toContain(projectWarehouse);

      await move(whToken, { type: 'OUT', materialId: cement, warehouseId: projectWarehouse, quantity: '1' }, 404);

      // Kurum deposunda hareket girebilir (inventory.move var).
      await move(whToken, { type: 'IN', materialId: cement, warehouseId: kurumWarehouse, quantity: '7' }, 201);
    });

    it('kapsam dışı proje filtresiyle hareket listesi boş döner (sızdırma yok)', async () => {
      // Depocu için prj1 kapsamı yok; proje filtresiyle boş liste döner.
      const res = await request(app.getHttpServer())
        .get(`/api/v1/inventory/movements?projectId=${prj1}&pageSize=10`)
        .set('Authorization', `Bearer ${whToken}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('hareket, depo ve malzeme işlemleri audit loga yazılır', async () => {
      const audits = await prisma.auditLog.findMany({
        where: { action: { in: ['stock.movement.created', 'stock.movement.reversed', 'warehouse.created', 'material.created'] } },
        select: { action: true, entityType: true },
      });
      const actions = new Set(audits.map((a) => a.action));
      expect(actions).toContain('stock.movement.created');
      expect(actions).toContain('warehouse.created');
      expect(actions).toContain('material.created');
    });
  });

  // ---------- 9) Pagination ----------

  describe('Büyük hareket listesinde pagination', () => {
    it('30 hareket 10\'luk sayfalara bölünür; sayfalar doğru gezilir', async () => {
      const m = await request(app.getHttpServer())
        .post('/api/v1/inventory/materials')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Pagination Test Malzemesi' })
        .expect(201);
      const pid = m.body.id as string;

      for (let i = 0; i < 30; i += 1) {
        await move(adminToken, { type: 'IN', materialId: pid, warehouseId: kurumWarehouse, quantity: '1' });
      }

      const page1 = await request(app.getHttpServer())
        .get(`/api/v1/inventory/movements?warehouseId=${kurumWarehouse}&materialId=${pid}&page=1&pageSize=10`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(page1.body.data).toHaveLength(10);
      expect(page1.body.meta.total).toBe(30);
      expect(page1.body.meta.totalPages).toBe(3);

      const page3 = await request(app.getHttpServer())
        .get(`/api/v1/inventory/movements?warehouseId=${kurumWarehouse}&materialId=${pid}&page=3&pageSize=10`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(page3.body.data).toHaveLength(10);

      // Sayfalarda tekrar yok (id benzersiz)
      const ids1 = (page1.body.data as Array<{ id: string }>).map((r) => r.id);
      const ids3 = (page3.body.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids1.some((id) => ids3.includes(id))).toBe(false);

      // Filtresiz liste reddedilir (en az bir filtre zorunlu)
      await request(app.getHttpServer())
        .get('/api/v1/inventory/movements?page=1&pageSize=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });
});
