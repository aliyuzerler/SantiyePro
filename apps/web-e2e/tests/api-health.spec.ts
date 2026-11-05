/**
 * ŞantiyePro e2e — API canlı sağlık kontrolü.
 * Standardın ilk maddesi: panel testlerinden önce API ve gerçek DB ayakta olmalı.
 */
import { expect, test } from '@playwright/test';
import { API_URL } from './helpers/api';

test.describe('API canlı sağlık', () => {
  test('liveness 200 — servis kimliği doğru', async ({ request }) => {
    const res = await request.get(`${API_URL}/health/live`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { status: string; service: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('santiyepro-api');
    expect(body.version).toBeTruthy();
  });

  test('readiness 200 — gerçek PostgreSQL bağlantısı sağlıklı', async ({ request }) => {
    const res = await request.get(`${API_URL}/health/ready`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { status: string; checks: { database: string } };
    expect(body.status).toBe('ok');
    expect(body.checks.database).toBe('ok');
  });
});
