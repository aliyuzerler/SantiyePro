import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { GlobalExceptionFilter } from '../src/common/global-exception.filter.js';
import { traceIdMiddleware } from '../src/common/trace-id.middleware.js';

/**
 * Faz 00 e2e: health uçları ve hata zarfı sözleşmesi.
 * Bu testler yerel/CI ortamında DB olmadan da koşabilir;
 * readiness davranışı health.service.spec.ts'te DB stub'ıyla test edilir.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.use(traceIdMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health -> 200 ve sözleşme gövdesi', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'santiyepro-api' });
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.timestamp).toBe('string');
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  it('GET /api/v1/health/live -> 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/v1/health/ready -> DB durumuna göre 200/503; gövde sözleşmeye uygun', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect([200, 503]).toContain(res.status);
    expect(['ok', 'unavailable']).toContain(res.body.status);
    expect(['ok', 'unavailable']).toContain(res.body.checks.database);
  });

  it('bilinmeyen uç -> 404 ve merkezi hata zarfı', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/olmayan-uc');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.traceId).toBeDefined();
  });

  it('yanıt X-Trace-Id başlığı taşır ve zarf traceId ile eşleşir', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/olmayan-uc');
    const traceId = res.headers['x-trace-id'] as string;
    expect(traceId).toBeTruthy();
    expect(res.body.traceId).toBe(traceId);
  });
});
