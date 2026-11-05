/**
 * ŞantiyePro — Playwright canlı E2E yapılandırması.
 *
 * Standart (docs/process/canli-test-standardi.md): her faz kapanmadan bu paket
 * GERÇEK API + GERÇEK PostgreSQL + panel geliştirme sunucusu üzerinde koşar.
 * Birim testlerinin yerini tutmaz; canlı davranışı doğrular.
 *
 * Ortam değişkenleri (varsayılanlar yerel geliştirme içindir):
 *  - E2E_WEB_URL       panel kökü   (varsayılan http://localhost:3100/panel)
 *  - E2E_API_URL       API kökü     (varsayılan http://localhost:4000/api/v1)
 */
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3100';
const PANEL_URL = `${WEB_URL}/panel`;
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1';

const config: PlaywrightTestConfig = {
  testDir: './tests',
  // Paylaşılan gerçek veritabanı kullanıldığı için koşum sıralıdır.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    // baseURL kök kaynak (origin) — panel basePath'i (/panel) speslerde açık yazılır.
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: [
    {
      url: `${API_URL}/health/live`,
      command: 'pnpm --filter @santiyepro/api exec node dist/main.js',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      url: PANEL_URL,
      command: 'pnpm --filter @santiyepro/web exec next dev -p 3100',
      env: { NEXT_PUBLIC_BASE_PATH: '/panel' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
};

export default defineConfig(config);
