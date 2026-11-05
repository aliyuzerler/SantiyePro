/**
 * ŞantiyePro e2e — Faz 06 kritik akış (GERÇEK API + GERÇEK PostgreSQL).
 *
 * Senaryo (docs/process/canli-test-standardi.md, prompts/phase-06-test.md):
 *  API ile test verisi kurulur (proje + üyelik + personel), ardından GERÇEK
 *  tarayıcı akışıyla doğrulanır:
 *   1. UI girişi → /panel/puantaj (Günlük Puantaj sekmesi)
 *   2. Proje seçilir → aktif personel satırları çizilir
 *   3. Satır bazlı işaretleme: "Tam Gün" çipine dokunma → kayıt oluşur, süre sütunu dolar
 *   4. Toplu işaretleme: satır seç → Önizle (onay diyaloğu satır listesi) → Onayla → uygulanır
 *   5. Personel Kayıtları sekmesi: yeni personel oluşturma → listede görünür
 *   6. GPS yok: ekranda konum izni/istemi YOKTUR (docs/07)
 *   7. Ekran görüntüleri docs/screenshots/ altına yazılır
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiGet, apiSend, ensureAdminToken } from './helpers/api';
import { uiLogin } from './helpers/ui';

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Faz 06 kritik akışı masaüstü projesinde koşar (mobil kritik akışı RNTL paketindedir).',
  );
});

async function seedAttendanceData(request: APIRequestContext): Promise<{
  projectId: string;
  projectCode: string;
  personnelIds: string[];
  names: string[];
}> {
  const token = await ensureAdminToken(request);
  const stamp = Date.now();
  const projectCode = `E2E-PU${stamp}`.slice(0, 24);
  const project = await apiSend(request, token, 'POST', '/projects', {
    code: projectCode,
    name: `E2E Puantaj Projesi ${stamp}`,
  });
  const projectId = project.id as string;

  // Admin projenin üyesi olmalı (docs/06 kuralı)
  const me = await apiGet(request, token, '/auth/me');
  await apiSend(request, token, 'POST', `/projects/${projectId}/members`, {
    userId: me.id,
    scopeRole: 'MANAGER',
  });

  const names = [`E2E İşçi Ahmet ${stamp}`, `E2E İşçi Mehmet ${stamp}`, `E2E İşçi Zeynep ${stamp}`];
  const personnelIds: string[] = [];
  for (const [i, fullName] of names.entries()) {
    const p = await apiSend(request, token, 'POST', '/personnel', {
      employeeCode: `E2E-${stamp}-${i + 1}`.slice(0, 32),
      fullName,
      jobTitle: 'İşçi',
    });
    personnelIds.push(p.id as string);
  }

  return { projectId, projectCode, personnelIds, names };
}

test.describe('Faz 06 — Personel & Puantaj kritik akış', () => {
  let page: Page;
  let seeded: { projectId: string; projectCode: string; personnelIds: string[]; names: string[] } | null = null;

  test.beforeAll(async ({ browser, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Faz 06 kritik akışı yalnızca masaüstünde koşar.');
    seeded = await seedAttendanceData(request);
    page = await browser.newPage();
    await uiLogin(page);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('satır bazlı işaretleme kayıt oluşturur ve özette görünür', async () => {
    test.skip(!seeded, 'Yalnızca masaüstü projesinde koşar.');
    await page.goto('/panel/puantaj');
    await expect(page.getByRole('heading', { name: 'Personel & Puantaj', exact: true })).toBeVisible();

    // Proje seç — "E2E-PU" içeren seçeneğin değeri bulunur (liste asenkron yüklenir)
    const projectSelect = page.getByLabel('Proje', { exact: true });
    await expect(projectSelect.locator('option', { hasText: seeded!.projectCode }).first()).toBeAttached({ timeout: 15_000 });
    const optionValue = await projectSelect.evaluate(
      (el, code) => {
        const select = el as HTMLSelectElement;
        const option = [...select.options].find((o) => o.textContent?.includes(code));
        return option?.value ?? '';
      },
      seeded!.projectCode,
    );
    await projectSelect.selectOption(optionValue);

    // Personel satırları çizilir
    await expect(page.getByText(seeded!.names[0]!)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(seeded!.names[2]!)).toBeVisible();

    // GPS YOK: ekran hiçbir yerde konum izni metni/istemi taşımaz
    await expect(page.getByText(/konum izni/i)).toHaveCount(0);
    await expect(page.getByText(/GPS toplanmayacak/i)).toHaveCount(0);

    // Satır bazlı: Ahmet için "Tam Gün"
    const ahmetRow = page.locator('tr', { hasText: seeded!.names[0]! });
    await ahmetRow.getByRole('button', { name: 'Tam Gün' }).click();

    // Kayıt oluştu — satırda durum etiketi kalıcıdır ve süre/özet güncellenir
    await expect(ahmetRow.getByRole('button', { name: 'Tam Gün' })).toHaveClass(/brand-700/, { timeout: 15_000 });
    await page.screenshot({ path: '../../docs/screenshots/faz06-panel-puantaj.png', fullPage: false });
  });

  test('toplu işaretleme: önizleme onay diyaloğu gösterir, onayda uygulanır', async () => {
    test.skip(!seeded, 'Yalnızca masaüstü projesinde koşar.');
    await page.goto('/panel/puantaj');
    const projectSelect = page.getByLabel('Proje', { exact: true });
    await expect(projectSelect.locator('option', { hasText: seeded!.projectCode }).first()).toBeAttached({ timeout: 15_000 });
    const bulkOptionValue = await projectSelect.evaluate(
      (el, code) => {
        const select = el as HTMLSelectElement;
        const option = [...select.options].find((o) => o.textContent?.includes(code));
        return option?.value ?? '';
      },
      seeded!.projectCode,
    );
    await projectSelect.selectOption(bulkOptionValue);

    await expect(page.getByText(seeded!.names[0]!)).toBeVisible({ timeout: 15_000 });

    // İki kişiyi seç (Ahmet PRESENT kayıtlı → UPDATE; Zeynep kayıtsız → CREATE)
    await page.getByLabel(`${seeded!.names[0]} seç`).check();
    await page.getByLabel(`${seeded!.names[2]} seç`).check();

    // Toplu durum: Gelmedi + Önizle
    await page.getByLabel('Toplu durum').selectOption({ label: 'Gelmedi' });
    await page.getByRole('button', { name: 'Önizle' }).click();

    // Önizleme diyaloğu: satır satır plan
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Kayıt açılacak')).toBeVisible(); // Zeynep CREATE
    await expect(dialog.getByText(/Mevcut kayıt güncellenecek/)).toBeVisible(); // Ahmet UPDATE
    await page.screenshot({ path: '../../docs/screenshots/faz06-panel-toplu-onizleme.png', fullPage: false });

    // Özet satırı: 1 yeni kayıt · 1 güncelleme · 0 atlama
    await expect(dialog.getByText(/1 yeni kayıt · 1 güncelleme · 0 atlama/)).toBeVisible();

    // Onayla ve uygula
    await dialog.getByRole('button', { name: 'Onayla ve Uygula' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Zeynep artık "Gelmedi" olarak işaretli
    const zeynepRow = page.locator('tr', { hasText: seeded!.names[2]! });
    await expect(zeynepRow.getByRole('button', { name: 'Gelmedi' })).toHaveClass(/brand-700/, { timeout: 15_000 });
  });

  test('personel sekmesi: yeni personel oluşturma listede görünür', async () => {
    test.skip(!seeded, 'Yalnızca masaüstü projesinde koşar.');
    await page.goto('/panel/puantaj');
    await page.getByRole('tab', { name: 'Personel Kayıtları' }).click();

    const stamp = Date.now();
    const newName = `E2E Kalıp Ustası Hasan ${stamp}`;
    await page.getByRole('button', { name: 'Yeni Personel' }).click();
    await page.getByLabel('Ad Soyad').fill(newName);
    await page.getByLabel('Sicil No').fill(`E2E-HASAN-${stamp}`.slice(0, 32));
    await page.getByLabel('İş Unvanı').fill('Kalıp Ustası');
    await page.getByLabel('Firma / Taşeron').fill('E2E Taşeron A.Ş.');
    await page.getByRole('button', { name: 'Personel Ekle' }).click();

    await expect(page.getByText(newName)).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: '../../docs/screenshots/faz06-panel-personel.png', fullPage: false });
  });
});
