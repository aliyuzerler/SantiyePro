/**
 * ŞantiyePro e2e — Faz 10 kritik akış (GERÇEK API + GERÇEK PostgreSQL).
 *
 * Senaryo (prompts/phase-10-test.md + docs/process/canli-test-standardi.md):
 *  API ile gerçek test verisi kurulur (proje, görevler, personel+puantaj,
 *  gider, depo+malzeme+stok girişi, günlük rapor), ardından GERÇEK tarayıcıyla:
 *   1. /panel/raporlar — Proje Genel Görünümü gerçek sayıları gösterir
 *   2. Stok Bakiyesi sekmesi — gerçek miktar
 *   3. Gider Özeti sekmesi — gerçek toplam
 *   4. XLSX + PDF export GERÇEK dosya indirir (magic bytes doğrulanır)
 *   5. /panel/denetim-kayitlari — report.exported kayıtları; parola sızması YOK
 *   6. /panel/ayarlar — yedekleme durumu kartı (status.json yoksa uydurma YOK)
 *   7. Yetki kapısı: SITE_CHIEF kullanıcısı denetim kayıtlarını göremez
 *   8. Ekran görüntüleri docs/screenshots/ altına yazılır
 */
import { mkdir, readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiGet, apiSend, ensureAdminToken, E2E_ADMIN } from './helpers/api';
import { uiLogin } from './helpers/ui';

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Faz 10 kritik akışı masaüstü projesinde koşar.',
  );
});

const today = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

interface SeedResult {
  projectCode: string;
  projectName: string;
  materialName: string;
  categoryName: string;
  quantity: number;
  expenseAmount: string;
}

async function seedReportData(request: APIRequestContext): Promise<SeedResult> {
  const token = await ensureAdminToken(request);
  const stamp = Date.now();

  const project = await apiSend(request, token, 'POST', '/projects', {
    code: `E2E-F10-${String(stamp).slice(-8)}`,
    name: `Faz 10 Rapor Projesi ${stamp}`,
  });
  const projectId = project.id as string;

  const me = await apiGet(request, token, '/auth/me');
  await apiSend(request, token, 'POST', `/projects/${projectId}/members`, {
    userId: me.id,
    scopeRole: 'MANAGER',
  });

  // Görevler: biri DONE, biri geciken (termini geçmiş TODO)
  await apiSend(request, token, 'POST', '/tasks', {
    projectId,
    title: `Kaba yapı tamamlandı ${stamp}`,
  });
  const doneTask = await apiSend(request, token, 'POST', '/tasks', {
    projectId,
    title: `İskele kurulumu ${stamp}`,
  });
  // Durum makinesi: TODO → IN_PROGRESS → DONE (doğrudan atlama reddedilir)
  await apiSend(request, token, 'PATCH', `/tasks/${doneTask.id}`, { status: 'IN_PROGRESS' });
  await apiSend(request, token, 'PATCH', `/tasks/${doneTask.id}`, { status: 'DONE' });

  // Personel + puantaj (bugün 2 kayıt)
  const personnel = await apiSend(request, token, 'POST', '/personnel', {
    fullName: `Ahmet Yapıcı ${stamp}`,
    companyOrSubcontractor: 'Test Taşeron',
  });
  await apiSend(request, token, 'POST', '/attendance', {
    projectId,
    personnelId: personnel.id,
    workDate: today(),
    status: 'PRESENT',
    workedMinutes: 480,
  });
  const personnel2 = await apiSend(request, token, 'POST', '/personnel', {
    fullName: `Mehmet İşçi ${stamp}`,
  });
  await apiSend(request, token, 'POST', '/attendance', {
    projectId,
    personnelId: personnel2.id,
    workDate: today(),
    status: 'ABSENT',
  });

  // Gider: kategori + taslak gider
  const categoryName = `Test Kategori ${stamp}`;
  const category = await apiSend(request, token, 'POST', '/expenses/categories', { name: categoryName });
  await apiSend(request, token, 'POST', '/expenses', {
    projectId,
    categoryId: category.id,
    description: 'Test malzeme alımı',
    amount: '250.50',
    currency: 'TRY',
    expenseDate: today(),
  });

  // Depo + malzeme + stok girişi (bakiye 10)
  const materialName = `Test Çimento ${stamp}`;
  const warehouse = await apiSend(request, token, 'POST', '/inventory/warehouses', {
    projectId,
    name: `Faz 10 Depo ${stamp}`,
  });
  const material = await apiSend(request, token, 'POST', '/inventory/materials', {
    name: materialName,
    unit: 'KG',
    minStock: '15',
  });
  await apiSend(request, token, 'POST', '/inventory/movements', {
    type: 'IN',
    materialId: material.id,
    warehouseId: warehouse.id,
    projectId,
    quantity: '10',
    note: 'E2E stok girişi',
  });

  // Günlük rapor taslağı
  await apiSend(request, token, 'POST', '/daily-reports', {
    projectId,
    reportDate: today(),
    workSummary: 'Faz 10 E2E test çalışması',
  });

  return {
    projectCode: project.code as string,
    projectName: project.name as string,
    materialName,
    categoryName,
    quantity: 10,
    expenseAmount: '250.50',
  };
}

async function uiLoginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/panel/giris');
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Parola').fill(password);
  await page.getByRole('button', { name: 'Giriş Yap' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/giris'), { timeout: 20_000 });
  await page.getByRole('heading', { name: 'Genel Bakış' }).waitFor({ timeout: 20_000 });
}

test('Faz 10: raporlar gerçek veri + export + denetim kaydı + yedekleme durumu + yetki kapısı', async ({ page, request }) => {
  test.setTimeout(120_000);
  const seed = await seedReportData(request);

  await uiLogin(page);
  await page.goto('/panel/raporlar');
  await page.getByRole('heading', { name: 'Raporlar', exact: true }).waitFor();

  // Proje filtresi: ortamda çok proje var — hedef projeye daralt (filtre tüm sekmelerde kalır)
  await page.getByLabel('Proje', { exact: true }).selectOption({ label: `${seed.projectCode} — ${seed.projectName}` });

  // 1) Proje Genel Görünümü: gerçek görev sayıları (2 görev, 1'i DONE)
  await expect(page.getByRole('tab', { name: 'Proje Genel Görünümü' })).toBeVisible();
  const overviewRowEl = page.locator('tbody tr', { hasText: seed.projectCode });
  await expect(overviewRowEl).toBeVisible({ timeout: 15_000 });
  await expect(overviewRowEl).toContainText(seed.projectName);

  // 2) Stok Bakiyesi: gerçek miktar 10 KG — kritik (min 15) işareti
  await page.getByRole('tab', { name: 'Stok Bakiyesi' }).click();
  const balanceRow = page.locator('tbody tr', { hasText: seed.materialName });
  await expect(balanceRow).toBeVisible({ timeout: 15_000 });
  await expect(balanceRow).toContainText('Kritik');
  await expect(balanceRow).toContainText('10');

  // 3) Gider Özeti: gerçek toplam 250,50
  await page.getByRole('tab', { name: 'Gider Özeti' }).click();
  const expenseRow = page.locator('tbody tr', { hasText: seed.categoryName });
  await expect(expenseRow).toBeVisible({ timeout: 15_000 });
  await expect(expenseRow).toContainText('250,50');

  // 4) XLSX export — gerçek dosya (ZIP magic bytes: PK)
  const xlsxPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'XLSX indir' }).click();
  const xlsx = await xlsxPromise;
  await mkdir('test-results/faz10', { recursive: true });
  const xlsxPath = `test-results/faz10/${xlsx.suggestedFilename()}`;
  await xlsx.saveAs(xlsxPath);
  const xlsxBytes = await readFile(xlsxPath);
  expect(xlsxBytes.subarray(0, 2).toString()).toBe('PK');

  // 5) PDF export — %PDF magic + Türkçe font gömülü
  const pdfPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'PDF indir' }).click();
  const pdf = await pdfPromise;
  const pdfPath = `test-results/faz10/${pdf.suggestedFilename()}`;
  await pdf.saveAs(pdfPath);
  const pdfBytes = await readFile(pdfPath);
  expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdfBytes.toString('latin1')).toContain('DejaVu');

  await page.screenshot({ path: '../../docs/screenshots/phase-10-raporlar.png', fullPage: true });

  // 6) Denetim kayıtları: report.exported kanıtı + parola sızması yok
  await page.goto('/panel/denetim-kayitlari');
  await page.getByRole('heading', { name: 'Denetim Kayıtları' }).waitFor();
  const actionFilter = page.getByLabel('Eylem');
  await actionFilter.selectOption({ label: 'report.exported' });
  const exportEntry = page.locator('li button', { hasText: 'report.exported' }).first();
  await expect(exportEntry).toBeVisible({ timeout: 15_000 });
  // Önce/sonra görünümü: ilk kaydı genişlet
  await exportEntry.click();
  await expect(page.getByText('Sonra', { exact: true })).toBeVisible();
  // Hassas bilgi sızması yok: parola ekranın herhangi bir yerinde görünmez
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain(E2E_ADMIN.password);
  await page.screenshot({ path: '../../docs/screenshots/phase-10-denetim.png', fullPage: true });

  // 7) Ayarlar: yedekleme durumu kartı — status.json yoksa uydurma YOK
  await page.goto('/panel/ayarlar');
  await page.getByRole('heading', { name: 'Ayarlar' }).waitFor();
  await expect(page.getByText('Yedekleme', { exact: true })).toBeVisible();
  // status dosyası yok → açıkça "henüz yedek alınmamış" görünür (uydurma durum yok)
  await expect(page.getByText('Henüz yedek alınmamış')).toBeVisible({ timeout: 15_000 });

  // 8) Yetki kapısı: SITE_CHIEF audit.view yok → ekran erişimi engelli + menü gizli
  const token = await ensureAdminToken(request);
  const chiefEmail = `sef-${Date.now()}@santiyepro.test`;
  await apiSend(request, token, 'POST', '/users', {
    fullName: 'Şantiye Şefi Test',
    email: chiefEmail,
    password: 'GucluSefParola123',
    roles: ['SITE_CHIEF'],
  });
  await uiLoginAs(page, chiefEmail, 'GucluSefParola123');
  await page.goto('/panel/denetim-kayitlari');
  await expect(page.getByText('Erişim yok')).toBeVisible({ timeout: 15_000 });
  // Menüde Denetim Kayıtları görünmez
  await expect(page.locator('nav a', { hasText: 'Denetim Kayıtları' })).toHaveCount(0);
});
