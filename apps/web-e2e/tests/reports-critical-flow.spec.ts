/**
 * ŞantiyePro e2e — Faz 05 kritik akış (GERÇEK API + GERÇEK PostgreSQL).
 *
 * Senaryo (docs/process/canli-test-standardi.md):
 *  API ile test verisi kurulur (proje + PNG yükleme + rapor taslağı → gönderim),
 *  ardından GERÇEK tarayıcı akışıyla doğrulanır:
 *   1. UI girişi → /panel/gunluk-raporlar listesi
 *   2. Detay: meta + ekip + fotoğraf galerisi (imzalı URL ile <img> yüklenir)
 *   3. Onay → rozet Onaylandı
 *   4. Düzenle → revizyon geçmişi büyür
 *   5. Ekran görüntüleri docs/screenshots/ altına yazılır
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiGet, apiSend, ensureAdminToken } from './helpers/api';
import { uiLogin } from './helpers/ui';

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Faz 05 kritik akışı masaüstü projesinde koşar.',
  );
});

/** 1×1 şeffaf PNG — gerçek baytlarla medya akışını kurar. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function seedReportData(
  request: APIRequestContext,
): Promise<{ reportId: string; mediaId: string; reportDate: string; projectCode: string }> {
  const token = await ensureAdminToken(request);
  const stamp = Date.now();

  const project = await apiSend(request, token, 'POST', '/projects', {
    code: `E2E-R${stamp}`.slice(0, 24),
    name: `E2E Rapor Projesi ${stamp}`,
  });
  const projectId = project.id as string;
  const projectCode = project.code as string;

  const me = await apiGet(request, token, '/auth/me');
  await apiSend(request, token, 'POST', `/projects/${projectId}/members`, {
    userId: me.id,
    scopeRole: 'MANAGER',
  });

  // Medya akışı: upload-url → imzalı PUT → complete
  const uploadUrlRes = await apiSend(request, token, 'POST', '/media/upload-url', {
    filename: `saha-${stamp}.png`,
    mimeType: 'image/png',
    sizeBytes: PNG_BYTES.length,
    projectId,
  });
  const mediaId = uploadUrlRes.mediaId as string;
  const mediaOrigin = (process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1$/, '');
  const putRes = await request.put(`${mediaOrigin}${uploadUrlRes.uploadUrl}`, {
    data: PNG_BYTES,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  if (!putRes.ok()) throw new Error(`Medya PUT başarısız: ${putRes.status()}`);
  await apiSend(request, token, 'POST', '/media/complete', { mediaId });

  // Rapor taslağı → medya ekle → gönder
  const reportDate = '2026-11-05';
  const report = await apiSend(request, token, 'POST', '/daily-reports', {
    projectId,
    reportDate,
    weather: 'Güneş, rüzgarlı',
    workSummary: `E2E günlük rapor ${stamp}: kazı ve kalıp işleri.`,
    safetyNotes: 'Baret kontrolü yapıldı.',
    workers: [{ name: 'Ahmet Yılmaz', jobTitle: 'Kalıp Ustası', workerCount: 5, hours: '9' }],
    mediaIds: [mediaId],
  });
  const reportId = report.id as string;
  await apiSend(request, token, 'POST', `/daily-reports/${reportId}/submit`, {});

  return { reportId, mediaId, reportDate, projectCode };
}

test.describe('Faz 05 — Günlük rapor kritik akış', () => {
  let page: Page;
  let seeded: { reportId: string; mediaId: string; reportDate: string; projectCode: string } | null = null;

  test.beforeAll(async ({ browser, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Faz 05 kritik akışı yalnızca masaüstünde koşar.');
    seeded = await seedReportData(request);
    page = await browser.newPage();
    await uiLogin(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('rapor listesi filtrelerle çalışır ve satır detaya götürür', async () => {
    test.skip(!seeded, 'Yalnızca masaüstü projesinde koşar.');
    await page.goto('/panel/gunluk-raporlar');
    await expect(page.getByRole('heading', { name: 'Günlük Raporlar', exact: true })).toBeVisible();

    await page.getByLabel('Başlangıç').fill('2026-11-01');
    await page.getByLabel('Bitiş').fill('2026-11-30');

    const row = page.locator('tr', { hasText: seeded!.projectCode });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('Gönderildi')).toBeVisible();

    await page.screenshot({ path: '../../docs/screenshots/faz05-panel-raporlar.png', fullPage: false });

    await row.getByRole('link', { name: 'Detay' }).click();
    await expect(page.getByRole('heading', { name: 'Rapor İçeriği' })).toBeVisible({ timeout: 15_000 });
  });

  test('fotoğraf galerisi imzalı URL ile yüklenir (private depo)', async () => {
    test.skip(!seeded, 'Yalnızca masaüstü projesinde koşar.');
    await page.goto(`/panel/gunluk-raporlar/${seeded!.reportId}`);
    const img = page.locator('img[alt]');
    await expect(img).toBeVisible({ timeout: 20_000 });

    // <img> gerçekten baytları indirdi mi? (imzalı URL + private depo)
    const src = await img.getAttribute('src');
    expect(src).toContain('/api/v1/media/');
    const response = await page.request.get(src!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');

    // Ekip satırı + İSG notu görünür
    await expect(page.getByText('Ahmet Yılmaz')).toBeVisible();
    await expect(page.getByText(/Baret kontrolü yapıldı/)).toBeVisible();
  });

  test('onay akışı ve revizyon: onayla → düzenle → geçmiş büyür', async () => {
    test.skip(!seeded, 'Yalnızca masaüstü projesinde koşar.');
    await page.goto(`/panel/gunluk-raporlar/${seeded!.reportId}`);
    await expect(page.getByRole('heading', { name: 'Rapor İçeriği' })).toBeVisible({ timeout: 15_000 });

    // Onayla (admin günlük admin approve iznine sahip)
    await page.getByRole('button', { name: 'Onayla' }).click();
    await expect(page.getByText('Onaylandı').first()).toBeVisible({ timeout: 15_000 });

    // Düzenle → revizyon oluşur
    await page.getByRole('button', { name: /Düzenle/ }).click();
    const summaryBox = page.locator('form textarea').first();
    await summaryBox.fill('E2E günlük rapor düzenlendi: beton dökümü tamamlandı.');
    await page.getByRole('button', { name: 'Değişiklikleri Kaydet' }).click();

    await expect(page.getByRole('heading', { name: /Revizyon Geçmişi \(1\)/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Revizyon 0/)).toBeVisible();

    await page.screenshot({ path: '../../docs/screenshots/faz05-panel-rapor-detay.png', fullPage: false });
  });
});
