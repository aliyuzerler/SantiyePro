import { describe, expect, it } from 'vitest';
import { HealthService } from './health.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { errorEnvelopeSchema, healthResponseSchema, readinessResponseSchema } from '@santiyepro/contracts';

describe('HealthService', () => {
  const makePrismaStub = (pingImpl: () => Promise<void>) =>
    ({ ping: pingImpl }) as unknown as PrismaService;

  it('liveness sözleşme şemasına uyan yanıt döndürür', () => {
    const service = new HealthService(makePrismaStub(async () => undefined));
    const parsed = healthResponseSchema.parse(service.liveness());
    expect(parsed.service).toBe('santiyepro-api');
  });

  it('DB erişilebilirken readiness 200 + ok döner', async () => {
    const service = new HealthService(makePrismaStub(async () => undefined));
    const result = await service.readiness();
    expect(result.httpStatus).toBe(200);
    expect(readinessResponseSchema.parse(result.response).status).toBe('ok');
  });

  it('DB erişilemezken readiness 503 + unavailable döner', async () => {
    const service = new HealthService(
      makePrismaStub(async () => {
        throw new Error('bağlantı yok');
      }),
    );
    const result = await service.readiness();
    expect(result.httpStatus).toBe(503);
    const parsed = readinessResponseSchema.parse(result.response);
    expect(parsed.status).toBe('unavailable');
    expect(parsed.checks.database).toBe('unavailable');
  });

  it('hata zarfı şeması tanımlı kodlardan birini zorunlu kılar', () => {
    const parsed = errorEnvelopeSchema.safeParse({
      error: { code: 'INTERNAL_ERROR', message: 'x' },
      traceId: 't1',
    });
    expect(parsed.success).toBe(true);
  });
});
