/**
 * ŞantiyePro e2e — Faz 07 kritik akış (GERÇEK API + GERÇEK PostgreSQL).
 *
 * Senaryo (docs/process/canli-test-standardi.md madde 3d):
 *  API ile test verisi kurulur (depo + malzeme), ardından GERÇEK tarayıcı
 *  akışıyla doğrulanır:
 *   1. UI girişi → /panel/depo depolar sekmesi
 *   2. UI'dan stok hareketi: GİRİŞ 100 → stok kartı bakiyesi güncellenir
 *   3. UI'dan ÇIKIŞ 30 → bakiye 70; hareket geçmişinde kayıtlar görünür
 *   4. API düzeyinde stoktan fazla çıkış → 409 (sunucu kuralı UI'dan bağımsız)
 *   5. UI'dan ters kayıt (gerekçe zorunlu) → bakiye geri alınır
 *   6. Hareket listesinde REVERSAL rozeti görünür
 *   7. Ekran görüntüleri docs/screenshots/ altına yazılır
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiSend, ensureAdminToken } from './helpers/api';
import { uiLogin } from './helpers/ui';

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Faz 07 kritik akışı masaüstü projesinde koşar (mobil kritik akışı RNTL paketindedir).',
  );
});

interface SeedData {
  warehouseId: string;
  materialId: string;
  materialCode: string;
  warehouseName: string;
  token: string;
}

async function seedInventoryData(request: APIRequestContext): Promise<SeedData> {
  const token = await ensureAdminToken(request);
  const stamp = Date.now();
  const warehouseName = `E2E Merkez Depo ${stamp}`;

  const warehouse = await apiSend(request, token, 'POST', '/inventory/warehouses', {
    name: warehouseName,
    location: 'E2E yerleşkesi',
  });
  const material = await apiSend(request, token, 'POST', '/inventory/materials', {
    code: `E2E-M${stamp % 100000}`,
    name: `E2E Çimento ${stamp}`,
    unit: 'TORBA',
    minStock: '10',
  });

  return {
    warehouseId: warehouse.id as string,
    materialId: material.id as string,
    materialCode: material.code as string,
    warehouseName,
    token,
  };
}

test.describe('Faz 07 — Depo & Stok kritik akış', () => {
  let page: Page;
  let seeded: SeedData;

  test.beforeAll(async ({ browser, request }) => {
    seeded = await seedInventoryData(request);
    page = await browser.newPage();
    await uiLogin(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('UI girişi ile stok hareketi: giriş → çıkış → fazla çıkışta 409 → ters kayıt', async () => {
    test.setTimeout(120_000);

    // 1) Depo sekmesi: kurulan depo listelenir
    await page.goto('/panel/depo');
    await page.getByRole('tab', { name: 'Depolar' }).click();
    await expect(page.getByTestId('warehouses-table')).toBeVisible();
    await expect(page.getByText(seeded.warehouseName)).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/phase-07-depo-depolar.png', fullPage: true });

    // 2) GİRİŞ 100 (dialog ile)
    await page.getByRole('button', { name: '+ Stok Hareketi' }).click();
    const dialog = page.getByRole('dialog', { name: 'Stok hareketi' });
    await dialog.getByLabel('Hareket Tipi').selectOption('IN');
    await dialog.getByLabel(/^Depo/).selectOption(seeded.warehouseId);
    await dialog.getByLabel(/^Malzeme/).selectOption(seeded.materialId);
    await dialog.getByLabel(/Miktar/).fill('100');
    await dialog.getByLabel(/Açıklama/).fill('E2E satın alma girişi');
    await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
    await expect(page.getByTestId('movement-form-error')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Stok hareketi' })).toBeHidden({ timeout: 15_000 });

    // Stok kartında bakiye 100 (filtreyi kurulan depoya sabitle)
    await page.getByRole('tab', { name: 'Stok Kartları' }).click();
    await page.getByLabel('Depo filtresi').selectOption(seeded.warehouseId);
    await expect(page.getByTestId('balances-table')).toBeVisible();
    await expect(page.getByTestId(`balance-row-${seeded.materialCode}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('balances-table').getByText('100 TORBA')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/phase-07-depo-stok-kartlari.png', fullPage: true });

    // 3) ÇIKIŞ 30 → bakiye 70
    await page.getByRole('button', { name: '+ Stok Hareketi' }).click();
    const outDialog = page.getByRole('dialog', { name: 'Stok hareketi' });
    await outDialog.getByLabel('Hareket Tipi').selectOption('OUT');
    await outDialog.getByLabel(/^Depo/).selectOption(seeded.warehouseId);
    await outDialog.getByLabel(/^Malzeme/).selectOption(seeded.materialId);
    await outDialog.getByLabel(/Miktar/).fill('30');
    await outDialog.getByLabel(/Açıklama/).fill('E2E saha çıkışı');
    await outDialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Stok hareketi' })).toBeHidden({ timeout: 15_000 });

    await expect(page.getByTestId('balances-table').getByText('70 TORBA')).toBeVisible({ timeout: 15_000 });

    // Hareket geçmişinde kayıtlar (filtreyi kurulan depoya sabitle)
    await page.getByRole('tab', { name: 'Hareketler' }).click();
    await page.getByLabel('Depo filtresi').selectOption(seeded.warehouseId);
    await expect(page.getByTestId('movements-table')).toBeVisible();
    await expect(page.getByTestId('movement-row').first()).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/phase-07-depo-hareketler.png', fullPage: true });

    // 4) API düzeyinde stoktan fazla çıkış → 409 (sunucu kuralı UI'dan bağımsız)
    const overRes = await page.request.post('http://localhost:4000/api/v1/inventory/movements', {
      headers: { Authorization: `Bearer ${seeded.token}` },
      data: {
        type: 'OUT',
        materialId: seeded.materialId,
        warehouseId: seeded.warehouseId,
        quantity: '999',
        note: 'E2E fazla çıkış denemesi',
      },
    });
    expect(overRes.status()).toBe(409);
    const overBody = (await overRes.json()) as { error: { code: string; message: string } };
    expect(overBody.error.code).toBe('CONFLICT');

    // Bakiye 70'te kalır
    await page.getByRole('tab', { name: 'Stok Kartları' }).click();
    await expect(page.getByTestId('balances-table').getByText('70 TORBA')).toBeVisible({ timeout: 15_000 });

    // 5) Hareket geçmişinden en yeni (ÇIKIŞ) hareketi ters kaydet (gerekçe zorunlu)
    await page.getByRole('tab', { name: 'Hareketler' }).click();
    await page.getByLabel('Depo filtresi').selectOption(seeded.warehouseId);
    await expect(page.getByTestId('movements-table')).toBeVisible();
    // ÇIKIŞ hareketini notundan hedefle (aynı dakikada giriş/çıkış olabilir;
    // ters kayıt sırası karışmasın — ayrıca sunucu negatif bakiyeyi 409 ile reddeder).
    const outRow = page.getByTestId('movement-row').filter({ hasText: 'E2E saha çıkışı' }).first();
    await expect(outRow).toBeVisible();
    await outRow.getByRole('button', { name: 'Ters Kayıt' }).click();
    await page.getByLabel('Gerekçe (zorunlu)').fill('E2E: yanlış depodan çıkış');
    await page.getByRole('button', { name: 'Ters Kaydet' }).click();

    // Ters kayıt sonrası bakiye 100'e döner
    await page.getByRole('tab', { name: 'Stok Kartları' }).click();
    await expect(page.getByTestId('balances-table').getByText('100 TORBA')).toBeVisible({ timeout: 15_000 });

    // 6) Hareket listesinde REVERSAL rozeti görünür
    await page.getByRole('tab', { name: 'Hareketler' }).click();
    await expect(page.getByText('Ters Kayıt').first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: 'docs/screenshots/phase-07-depo-ters-kayit.png', fullPage: true });
  });
});
