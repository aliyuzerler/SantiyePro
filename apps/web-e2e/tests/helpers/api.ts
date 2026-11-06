/**
 * ŞantiyePro e2e — API yardımcıları.
 * Testler gerçek API + gerçek PostgreSQL üzerinde koşar (canlı test standardı).
 */
import type { APIRequestContext } from '@playwright/test';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1';

export const E2E_ADMIN = {
  fullName: 'Kurulum Yöneticisi',
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin@santiyepro.test',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'GucluParola123',
};

export const E2E_SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN ?? 'dev-setup-token-yerel-0123456789abcdef';

/**
 * Sistemin kullanılabilir olmasını garantiler:
 * hiç kullanıcı yoksa güvenli bootstrap akışıyla ilk admin kurulur, ardından
 * gerçek giriş ucundan access token alınır. Her iki durumda da idempotenttir.
 */
export async function ensureAdminToken(request: APIRequestContext): Promise<string> {
  const statusRes = await request.get(`${API_URL}/auth/setup-status`);
  if (!statusRes.ok()) {
    throw new Error(`setup-status erişilemedi: HTTP ${statusRes.status()}`);
  }
  const { setupRequired } = (await statusRes.json()) as { setupRequired: boolean };

  if (setupRequired) {
    const bootRes = await request.post(`${API_URL}/auth/bootstrap`, {
      data: {
        setupToken: E2E_SETUP_TOKEN,
        fullName: E2E_ADMIN.fullName,
        email: E2E_ADMIN.email,
        password: E2E_ADMIN.password,
      },
    });
    if (!bootRes.ok()) {
      throw new Error(`Bootstrap başarısız (HTTP ${bootRes.status()}): ${await bootRes.text()}`);
    }
  }

  const loginRes = await request.post(`${API_URL}/auth/login`, {
    data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password },
  });
  if (!loginRes.ok()) {
    throw new Error(
      `E2E yönetici girişi başarısız (HTTP ${loginRes.status()}). E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD doğru mu?`,
    );
  }
  const body = (await loginRes.json()) as { accessToken: string };
  return body.accessToken;
}

/** Kimlik doğrulamalı API çağrısı. */
export async function apiGet(
  request: APIRequestContext,
  token: string,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await request.get(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok()) throw new Error(`GET ${path} → HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Kimlik doğrulamalı API yazma çağrısı. */
export async function apiSend(
  request: APIRequestContext,
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
): Promise<Record<string, unknown>> {
  const res = await request.fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: data === undefined ? {} : data,
  });
  if (!res.ok()) throw new Error(`${method} ${path} → HTTP ${res.status()}: ${await res.text()}`);
  return (res.status() === 204 ? {} : ((await res.json()) as Record<string, unknown>));
}
