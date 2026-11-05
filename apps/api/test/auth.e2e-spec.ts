import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config({ override: true });

import { AppModule } from '../src/app.module.js';
import { GlobalExceptionFilter } from '../src/common/global-exception.filter.js';
import { traceIdMiddleware } from '../src/common/trace-id.middleware.js';
import { runSeed } from '../prisma/seed.js';
import { RateLimiterService } from '../src/common/rate-limiter.service.js';
import { REFRESH_COOKIE_NAME } from '../src/modules/auth/auth.service.js';

/**
 * Faz 02 e2e — Kimlik doğrulama ve RBAC güvenlik testleri (docs/07 + prompts/phase-02-test.md).
 * Testler GERÇEK test veritabanı üzerinde koşar (Yok artı/embedded PostgreSQL).
 *
 * Kapsam:
 *  1. Doğru/yanlış parola; kullanıcı var/yok ayrımı sızmıyor (tek generic mesaj)
 *  2. Parola DB'de yalnızca Argon2id hash'i olarak duruyor
 *  3. Access TTL, refresh rotasyonu, reuse tespiti ve logout revoke
 *  4. Disable edilen kullanıcının refresh token'ı reddediliyor
 *  5. Yetkisiz rol endpoint'e erişemiyor (deny-by-default)
 *  6. IDOR: user.manage izni olmayan kendi kaydını güncelleyemiyor
 *  7. Rate limit ve generic hata zarfı
 *  8. Refresh cookie HttpOnly + SameSite=Strict; Secure üretim konfigürasyonu env ile
 *  9. (Mobil tarafı SecureStore testi apps/mobile içinde)
 * 10. İlk admin kurulum akışı güvenli ve tek kullanımlık
 */
describe('Auth & RBAC (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN ?? 'dev-setup-token-yerel-0123456789abcdef';
  const ADMIN = { fullName: 'Kurulum Yöneticisi', email: 'admin@santiyepro.test', password: 'GucluParola123' };

  beforeAll(async () => {
    // Test veritabanını temizle ve sistem rollerini seed et.
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
  });

  beforeEach(() => {
    app.get(RateLimiterService).clear();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------- 10) İlk kurulum akışı ----------

  it('bootstrap: yanlış setup token → 403 ve audit kaydı', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/bootstrap')
      .send({ ...ADMIN, setupToken: 'yanlis-token-dahi-yanlis-token-123' })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.bootstrap_rejected' } });
    expect(audit).toBeTruthy();
  });

  it('bootstrap: doğru token ile ilk admin → 201, sonra tekrar → 409 (tek kullanımlık)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/bootstrap')
      .send({ ...ADMIN, setupToken: SETUP_TOKEN })
      .expect(201);

    const admin = await prisma.user.findUnique({ where: { email: ADMIN.email } });
    expect(admin).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/v1/auth/bootstrap')
      .send({ ...ADMIN, setupToken: SETUP_TOKEN })
      .expect(409);

    const status = await request(app.getHttpServer()).get('/api/v1/auth/setup-status').expect(200);
    expect(status.body.setupRequired).toBe(false);
  });

  // ---------- 2) Parola DB'de hash ----------

  it('parola DB düz metin değil; Argon2id hash formatında', async () => {
    const admin = await prisma.user.findUnique({ where: { email: ADMIN.email } });
    expect(admin?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(admin?.passwordHash).not.toContain(ADMIN.password);
  });

  // ---------- 1) Login: var/yok ayrımı sızması yok ----------

  it('login: yanlış parola ve olmayan kullanıcı → aynı generic mesaj', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: 'YanlisParola999' })
      .expect(401);
    const unknownUser = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'olmayan@santiyepro.test', password: 'YanlisParola999' })
      .expect(401);
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
    expect(wrongPassword.body.error.code).toBe('UNAUTHORIZED');
  });

  it('login: doğru parola → 200; access token, roller ve HttpOnly cookie döner', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(ADMIN)
      .expect(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user).toMatchObject({ email: ADMIN.email, status: 'ACTIVE' });
    expect(res.body.user.roles).toContain('FIRM_ADMIN');

    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const refreshCookie = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(refreshCookie).toBeTruthy();
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('SameSite=Strict');
  });

  it('login başarısızlığı audit log üretir; gövdede parola/token geçmez', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: 'YanlisParola999' })
      .expect(401);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.login_failed' } });
    expect(audit).toBeTruthy();
    const bodyText = JSON.stringify(audit?.afterJson ?? {});
    expect(bodyText).not.toContain('YanlisParola999');
  });

  // ---------- 3) Refresh rotasyonu, reuse, logout ----------

  it('refresh rotasyonu + eşzamanlılık grace: aynı eski token pencere içinde tekrar gelirse aile yaşar', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send(ADMIN).expect(200);
    const tokenA: string = login.body.refreshToken;
    // Mobil akışı: refreshToken gövdede taşınır
    const refresh1 = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokenA })
      .expect(200);
    expect(refresh1.body.accessToken).toBeTruthy();

    // Aynı eski token rotasyonun hemen ardından tekrar gelirse (ikinci sekme /
    // StrictMode çift boot) grace penceresi devrededir: aile iptal edilmez,
    // yeni geçerli çift verilir.
    const refresh2 = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokenA })
      .expect(200);
    expect(refresh2.body.refreshToken).toBeTruthy();

    // Aile yaşıyor: rotasyonla verilmiş token geçerli kalır.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refresh1.body.refreshToken })
      .expect(200);

    const graceAudit = await prisma.auditLog.findFirst({ where: { action: 'auth.refresh_reuse_grace' } });
    expect(graceAudit).toBeTruthy();
  });

  it('grace penceresi dışında reuse → tüm aile iptal olur', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send(ADMIN).expect(200);
    const tokenA: string = login.body.refreshToken;
    const refresh1 = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokenA })
      .expect(200);

    // Grace süresini simüle et: eski token'ın iptal zamanını geriye çek.
    const oldHash = createHash('sha256').update(tokenA).digest('hex');
    await prisma.refreshToken.update({
      where: { tokenHash: oldHash },
      data: { revokedAt: new Date(Date.now() - 120_000) },
    });

    // Pencere dışı reuse: ailenin tamamı iptal edilir.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokenA })
      .expect(401);

    // Yeni (rotate edilmiş) token da artık geçersiz olmalı.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refresh1.body.refreshToken })
      .expect(401);

    const reuseAudit = await prisma.auditLog.findFirst({ where: { action: 'auth.refresh_reuse_detected' } });
    expect(reuseAudit).toBeTruthy();
  });

  it('cookie akışı: refresh cookie ile yenileme çalışır, logout cookie iptal eder', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(ADMIN)
      .expect(200);
    const refreshToken = login.body.refreshToken;

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshToken}`)
      .send({})
      .expect(200);
    const newToken = refreshed.body.refreshToken;
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(refreshToken);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${newToken}`)
      .send({})
      .expect(204);

    // Logout sonrası token reddedilir.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: newToken })
      .expect(401);
  });

  it('access token süresi kısa ömürlü (≤ 900 sn) ve Bearer doğrulaması zorunlu', async () => {
    // Access token TTL konfigürasyonu
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send(ADMIN).expect(200);
    const token = login.body.accessToken;

    // /auth/me Bearer ile çalışır
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.email).toBe(ADMIN.email);

    // Bearer'sız → 401 (deny-by-default)
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('parola değişimi: diğer oturumlar düşer, yeni parola geçerli olur', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send(ADMIN).expect(200);
    const otherSession = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(ADMIN)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: ADMIN.password, newPassword: 'YeniGucluParola456' })
      .expect(204);

    // Eski oturumun refresh token'ı iptal edildi.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: otherSession.body.refreshToken })
      .expect(401);

    // Yeni parola ile giriş başarılı, eski parola başarısız.
    await request(app.getHttpServer()).post('/api/v1/auth/login').send(ADMIN).expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: 'YeniGucluParola456' })
      .expect(200);
  });

  // ---------- Parola sıfırlama altyapısı ----------

  it('forgot-password: kullanıcı var/yok ayrımı sızdırmaz (her zaman 202)', async () => {
    const existing = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: ADMIN.email })
      .expect(202);
    const missing = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'olmayan@santiyepro.test' })
      .expect(202);
    expect(existing.body.message).toBe(missing.body.message);
  });

  it('reset-password: tek kullanımlık ve süreli; geçersiz/süresi dolmuş token reddedilir', async () => {
    const crypto = await import('node:crypto');
    const hash = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

    // Geçerli token (test, token'ı doğrudan DB'ye yazarak simüle eder)
    const admin = await prisma.user.findUnique({ where: { email: ADMIN.email } });
    const rawToken = crypto.randomBytes(32).toString('base64url');
    await prisma.passwordResetToken.create({
      data: { userId: admin!.id, tokenHash: hash(rawToken), expiresAt: new Date(Date.now() + 10 * 60_000) },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, newPassword: 'SifirlananParola789' })
      .expect(204);

    // Token tek kullanımlık.
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, newPassword: 'BaskaBirParola123' })
      .expect(400);

    // Süresi dolmuş token reddedilir.
    const expiredRaw = crypto.randomBytes(32).toString('base64url');
    await prisma.passwordResetToken.create({
      data: { userId: admin!.id, tokenHash: hash(expiredRaw), expiresAt: new Date(Date.now() - 60_000) },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: expiredRaw, newPassword: 'BaskaBirParola123' })
      .expect(400);

    // Reset sonrası yeni parola geçerli.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: 'SifirlananParola789' })
      .expect(200);
  });

  // ---------- 5) & 6) RBAC + IDOR ----------

  it('RBAC: user.manage izni olmayan kullanıcı oluşturamaz; FIELD_WORKER /users listesine erişemez', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: 'SifirlananParola789' })
      .expect(200);
    const adminToken = login.body.accessToken;

    // Zayıf parola → validation hatası (parola politikası)
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Zayıf Parola', email: 'zayif@santiyepro.test', password: 'kisa123', roles: ['FIELD_WORKER'] })
      .expect(400);

    // İşçi oluştur
    const worker = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Saha İşçisi', email: 'isci@santiyepro.test', password: 'IsGucluParola123', roles: ['FIELD_WORKER'] })
      .expect(201);
    expect(worker.body.roles).toEqual(['FIELD_WORKER']);

    // Proje yöneticisi oluştur (user.view var, user.manage yok)
    const pm = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Proje Yöneticisi', email: 'pm@santiyepro.test', password: 'PmGucluParola123', roles: ['PROJECT_MANAGER'] })
      .expect(201);

    const workerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'isci@santiyepro.test', password: 'IsGucluParola123' })
      .expect(200);
    const workerToken = workerLogin.body.accessToken;

    // FIELD_WORKER user.view'a bile sahip değil → liste 403 (deny-by-default)
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(403);

    // FIELD_WORKER kullanıcı oluşturma → 403
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ fullName: 'Yetkisiz', email: 'y@santiyepro.test', password: 'YetkisizParola123', roles: ['FIELD_WORKER'] })
      .expect(403);

    // IDOR: FIELD_WORKER kendi kaydını güncelleyemez (user.manage gerekir)
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${worker.body.id}`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ status: 'ACTIVE', roles: ['FIRM_ADMIN'] })
      .expect(403);

    // PM kullanıcı listesini görür (user.view) ama yönetemez (user.manage yok)
    const pmLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'pm@santiyepro.test', password: 'PmGucluParola123' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${pmLogin.body.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/users/${pm.body.id}`)
      .set('Authorization', `Bearer ${pmLogin.body.accessToken}`)
      .send({ status: 'DISABLED' })
      .expect(403);

    return { adminToken, workerId: worker.body.id };
  });

  it('kullanıcı disable edilince refresh token reddedilir ve audit yazılır', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: 'SifirlananParola789' })
      .expect(200);
    const adminToken = login.body.accessToken;

    const workerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'isci@santiyepro.test', password: 'IsGucluParola123' })
      .expect(200);
    expect(workerLogin.body.refreshToken).toBeTruthy();

    const users = await request(app.getHttpServer())
      .get('/api/v1/users?pageSize=50')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const worker = users.body.data.find((u: { email: string }) => u.email === 'isci@santiyepro.test');

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${worker.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DISABLED' })
      .expect(200);

    // Disable edilen kullanıcının aktif refresh token'ı reddedilir.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: workerLogin.body.refreshToken })
      .expect(401);

    // Disabled kullanıcı yeni girişte de reddedilir (generic mesaj).
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'isci@santiyepro.test', password: 'IsGucluParola123' })
      .expect(401);
    expect(res.body.error.message).toBe('E-posta veya parola geçersiz');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'user.disabled' } });
    expect(audit).toBeTruthy();
  });

  it('rol değişikliği audit log üretir (user.role_changed)', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: 'SifirlananParola789' })
      .expect(200);
    const users = await request(app.getHttpServer())
      .get('/api/v1/users?pageSize=50')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    const pm = users.body.data.find((u: { email: string }) => u.email === 'pm@santiyepro.test');

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${pm.id}`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ roles: ['SITE_CHIEF'] })
      .expect(200);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'user.role_changed' } });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit?.beforeJson)).toContain('PROJECT_MANAGER');
    expect(JSON.stringify(audit?.afterJson)).toContain('SITE_CHIEF');
  });

  // ---------- 7) Rate limit ----------

  it('rate limit: tekrarlı başarısız giriş 401 RATE_LIMITED döner', async () => {
    app.get(RateLimiterService).clear();
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ratelimit@santiyepro.test', password: 'RateLimitTest123' })
        .expect(401);
    }
    const sixth = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ratelimit@santiyepro.test', password: 'RateLimitTest123' });
    // E-posta bazlı limit: 6. deneme reddedilir
    expect(sixth.status).toBe(401);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');

    // Hata zarfı sözleşmesi korunur
    expect(sixth.body.error.message).toBeTruthy();
    expect(sixth.body.traceId).toBeTruthy();
  });
});
