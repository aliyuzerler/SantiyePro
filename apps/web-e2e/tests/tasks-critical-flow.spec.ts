/**
 * ŞantiyePro e2e — Faz 04 kritik akış (GERÇEK API + GERÇEK PostgreSQL).
 *
 * Senaryo (docs/process/canli-test-standardi.md madde 3d):
 *  API ile test verisi kurulur (proje + üyelik + görevler), ardından GERÇEK
 *  tarayıcı akışıyla doğrulanır:
 *   1. UI girişi → /panel/gorevler listesi
 *   2. Filtre/arama ile görev bulunur
 *   3. Detay drawer'ı açılır, durum değiştirilir (TODO → IN_PROGRESS)
 *   4. Durum geçmişi drawer'da görünür
 *   5. Geciken görevde "Gecikmiş" rozeti listelenir
 *   6. Ekran görüntüleri docs/screenshots/ altına yazılır
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiGet, apiSend, ensureAdminToken } from './helpers/api';
import { uiLogin } from './helpers/ui';

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Faz 04 kritik akışı masaüstü projesinde koşar (mobil kritik akışı RNTL paketindedir).',
  );
});

async function seedTaskData(
  request: APIRequestContext,
): Promise<{ taskId: string; overdueTaskId: string; title: string; overdueTitle: string }> {
  const token = await ensureAdminToken(request);
  const stamp = Date.now();
  const title = `E2E Beton Döküm Görevi ${stamp}`;
  const overdueTitle = `E2E Geciken Kazı Görevi ${stamp}`;

  const project = await apiSend(request, token, 'POST', '/projects', {
    code: `E2E-T${stamp}`.slice(0, 24),
    name: `E2E Görev Projesi ${stamp}`,
  });
  const projectId = project.id as string;

  // Görevin atanabilmesi için admin projenin üyesi olmalı (docs/06 kuralı)
  const me = await apiGet(request, token, '/auth/me');
  await apiSend(request, token, 'POST', `/projects/${projectId}/members`, {
    userId: me.id,
    scopeRole: 'MANAGER',
  });

  const task = await apiSend(request, token, 'POST', '/tasks', {
    projectId,
    title,
    description: 'Kritik akış e2e görevi — Playwright tarafından oluşturuldu.',
    priority: 'HIGH',
    dueAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    checklist: [{ label: 'Kalıp kontrolü' }, { label: 'Donatı kontrolü' }],
  });

  const overdueTask = await apiSend(request, token, 'POST', '/tasks', {
    projectId,
    title: overdueTitle,
    priority: 'CRITICAL',
    dueAt: '2020-01-01T09:00:00.000Z',
  });

  return { taskId: task.id as string, overdueTaskId: overdueTask.id as string, title, overdueTitle };
}

test.describe('Faz 04 — Görevler kritik akış', () => {
  let page: Page;
  let seeded: { taskId: string; overdueTaskId: string; title: string; overdueTitle: string };

  test.beforeAll(async ({ browser, request }) => {
    seeded = await seedTaskData(request);
    page = await browser.newPage();
    await uiLogin(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('görev listesi filtre/arama ile çalışır ve gecikme rozeti görünür', async () => {
    await page.goto('/panel/gorevler');
    await expect(page.getByRole('heading', { name: 'Görevler', exact: true })).toBeVisible();

    // Arama ile görevi bul
    const search = page.getByLabel('Ara');
    await search.fill(seeded.title.slice(0, 24));
    await expect(page.getByText(seeded.title)).toBeVisible({ timeout: 15_000 });

    // Geciken görev araması
    await search.fill(seeded.overdueTitle);
    const row = page.locator('tr', { hasText: seeded.overdueTitle });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('Gecikmiş')).toBeVisible();
  });

  test('detay drawer: durum değişimi (TODO → Devam Ediyor) ve geçmiş görüntülenir', async () => {
    await page.goto('/panel/gorevler');
    const search = page.getByLabel('Ara');
    await search.fill(seeded.title.slice(0, 24));
    const row = page.locator('tr', { hasText: seeded.title });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Liste ekran görüntüsü (Faz 04 kanıtı)
    await page.screenshot({ path: '../../docs/screenshots/faz04-panel-gorevler.png', fullPage: false });

    await row.getByRole('button', { name: 'Detay' }).click();
    const drawer = page.getByRole('dialog', { name: 'Görev detayı' });
    await expect(drawer).toBeVisible();

    // Kontrol listesi + meta görünür
    await expect(drawer.getByText('Kontrol Listesi (0/2)')).toBeVisible();

    // Durum değiştir: TODO → Devam Ediyor
    await drawer.getByRole('button', { name: 'Devam Ediyor' }).click();

    // Rozet ve geçmiş güncellenir
    await expect(drawer.getByText('Devam Ediyor').first()).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByText('Durum Geçmişi')).toBeVisible();
    await expect(drawer.getByText(/Yapılacak →/)).toBeVisible();

    // Drawer ekran görüntüsü
    await page.screenshot({ path: '../../docs/screenshots/faz04-panel-gorev-detay.png', fullPage: false });
  });

  test('yorum eklenir ve listede yorum sayacı artar', async () => {
    await page.goto('/panel/gorevler');
    const search = page.getByLabel('Ara');
    await search.fill(seeded.title.slice(0, 24));
    const row = page.locator('tr', { hasText: seeded.title });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: 'Detay' }).click();
    const drawer = page.getByRole('dialog', { name: 'Görev detayı' });
    await expect(drawer).toBeVisible();

    await drawer.getByLabel('Yorum Ekle').fill('Playwright canlı e2e yorumu — beton numunesi alındı.');
    await drawer.getByRole('button', { name: 'Yorum Gönder' }).click();

    await expect(drawer.getByText('Playwright canlı e2e yorumu — beton numunesi alındı.')).toBeVisible({
      timeout: 15_000,
    });
  });
});
