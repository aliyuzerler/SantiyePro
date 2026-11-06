/**
 * ŞantiyePro e2e — Faz 08 kritik akış (GERÇEK API + GERÇEK PostgreSQL).
 *
 * Senaryo (docs/process/canli-test-standardi.md madde 3d):
 *  API ile test verisi kurulur (kategori + proje + sözleşme kalemleri),
 *  ardından GERÇEK tarayıcı akışıyla doğrulanır:
 *   1. UI girişi → /panel/giderler → gider oluştur (taslak) → gönder → onayla
 *   2. Vergi alanı boş bırakılır — uydurma vergi YOKTUR (satırda '—')
 *   3. /panel/hakedişler → hesap önizlemesi (formül + snapshot) → gönder → onayla
 *   4. API düzeyinde: kalem fiyatı değişir → onaylı hakediş snapshot'ı DEĞİŞMEZ
 *   5. API düzeyinde: kesinti brütü aşarsa 400 (sunucu kuralı UI'dan bağımsız)
 *   6. Ekran görüntüleri docs/screenshots/ altına yazılır
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiSend, ensureAdminToken } from './helpers/api';
import { uiLogin } from './helpers/ui';

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Faz 08 kritik akışı masaüstü projesinde koşar (mobil kritik akışı RNTL paketindedir).',
  );
});

interface SeedData {
  token: string;
  projectId: string;
  categoryId: string;
  item1Id: string;
  item2Id: string;
  /** Çalıştırmalar arası bağımsızlık: benzersiz açıklama/kodlar. */
  stamp: number;
}

async function seedFinanceData(request: APIRequestContext): Promise<SeedData> {
  const token = await ensureAdminToken(request);
  const stamp = Date.now();

  const project = await apiSend(request, token, 'POST', '/projects', {
    code: `E2E-FIN-${stamp % 1000000}`,
    name: `E2E Finans Projesi ${stamp}`,
    status: 'ACTIVE',
  });
  const category = await apiSend(request, token, 'POST', '/expenses/categories', {
    name: `E2E Yakıt ${stamp}`,
  });
  const item1 = await apiSend(request, token, 'POST', '/progress-claims/contract-items', {
    projectId: project.id,
    code: `E2E-A${stamp % 1000}`,
    description: 'Kaba inşaat beton işleri',
    unit: 'M3',
    contractQuantity: '1000',
    unitPrice: '245.75',
    sortOrder: 1,
  });
  const item2 = await apiSend(request, token, 'POST', '/progress-claims/contract-items', {
    projectId: project.id,
    code: `E2E-B${stamp % 1000}`,
    description: 'Demir işleri',
    unit: 'TON',
    contractQuantity: '100',
    unitPrice: '5000',
    sortOrder: 2,
  });

  return {
    token,
    projectId: project.id as string,
    categoryId: category.id as string,
    item1Id: item1.id as string,
    item2Id: item2.id as string,
    stamp,
  };
}

test.describe('Faz 08 — Gider & Hakediş kritik akış', () => {
  let page: Page;
  let seeded: SeedData;

  test.beforeAll(async ({ browser, request }) => {
    seeded = await seedFinanceData(request);
    page = await browser.newPage();
    await uiLogin(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('UI gider akışı: taslak → gönder → onay; uydurma vergi yok', async () => {
    test.setTimeout(120_000);

    // 1) Giderler sayfası — filtre yokken istek atılmaz, bilgi gösterilir
    await page.goto('/panel/giderler');
    await expect(page.getByRole('heading', { name: 'Giderler' })).toBeVisible();

    // 2) Yeni gider diyaloğu: vergi oranı BOŞ bırakılır
    await page.getByRole('button', { name: '+ Yeni Gider' }).click();
    const dialog = page.getByRole('dialog', { name: 'Yeni gider' });
    await dialog.getByLabel('Proje').selectOption(seeded.projectId);
    await dialog.getByLabel('Kategori').selectOption(seeded.categoryId);
    await dialog.getByLabel('Tedarikçi').fill('E2E Petrol');
    await dialog.getByLabel('Açıklama').fill(`E2E dizel alımı ${seeded.stamp}`);
    await dialog.getByLabel('Tutar').fill('1250.50');
    await dialog.getByLabel('Para birimi').selectOption('TRY');
    await dialog.getByRole('button', { name: 'Taslak Kaydet' }).click();
    await expect(page.getByTestId('expense-notice')).toContainText('taslak');

    // 3) Durum filtresiyle taslağı bul: SAĞA HİZALI tutar + para birimi açık + vergi '—'
    await page.getByLabel('Durum').selectOption('DRAFT');
    await expect(page.getByTestId('expenses-table')).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(`E2E dizel alımı ${seeded.stamp}`) });
    await expect(row).toBeVisible();
    await expect(row.getByText('₺1.250,50')).toBeVisible();
    await expect(row.getByText('—')).toBeVisible();
    await page.screenshot({ path: '/home/z/my-project/santiyepro/docs/screenshots/phase-08-giderler-taslak.png', fullPage: true });

    // 4) Gönder → PENDING → Onayla → APPROVED
    await row.getByRole('button', { name: 'Gönder' }).click();
    await page.getByLabel('Durum').selectOption('PENDING');
    const pendingRow = page.getByRole('row', { name: new RegExp(`E2E dizel alımı ${seeded.stamp}`) });
    await expect(pendingRow.getByText('Onay Bekliyor')).toBeVisible();
    await pendingRow.getByRole('button', { name: 'Onayla' }).click();
    await page.getByLabel('Durum').selectOption('APPROVED');
    await expect(page.getByRole('row', { name: new RegExp(`E2E dizel alımı ${seeded.stamp}`) }).getByText('Onaylandı')).toBeVisible();
    await page.screenshot({ path: '/home/z/my-project/santiyepro/docs/screenshots/phase-08-giderler-onayli.png', fullPage: true });
  });

  test('UI hakediş akışı: önizleme (formül + snapshot) → gönder → onay; API düzeyinde snapshot koruması', async () => {
    test.setTimeout(180_000);

    // API ile 1. hakediş onaylı duruma getirilir (zincir kökü)
    const claim1 = await apiSend(page.request, seeded.token, 'POST', '/progress-claims', {
      projectId: seeded.projectId,
      claimNo: 1,
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      lines: [{ contractItemId: seeded.item1Id, previousQuantity: '0', periodQuantity: '200' }],
    });
    expect(claim1.grossTotal).toBe('49150.00'); // 200 × 245.75 (snapshot, onay anındaki fiyat)
    await apiSend(page.request, seeded.token, 'POST', `/progress-claims/${claim1.id}/submit`, {});
    await apiSend(page.request, seeded.token, 'POST', `/progress-claims/${claim1.id}/approve`, {});

    // UI: 2. hakediş taslağı OLUŞTURULUR (zincir: önceki 200)
    await page.goto('/panel/hakedisler');
    // Proje listesi async yüklenir: seçenek görünene dek bekle
    const projectSelect = page.getByLabel('Proje', { exact: true });
    await expect(projectSelect.locator(`option[value="${seeded.projectId}"]`)).toHaveCount(1, { timeout: 15_000 });
    await projectSelect.selectOption(seeded.projectId);
    await page.getByRole('button', { name: '+ Yeni Hakediş' }).click();
    const dialog = page.getByRole('dialog', { name: 'Yeni hakediş' });
    await dialog.getByLabel('Dönem Başlangıcı').fill('2026-02-01');
    await dialog.getByLabel('Dönem Bitişi').fill('2026-02-28');
    await dialog.getByLabel('Kalem 1').selectOption(seeded.item1Id);
    await dialog.getByLabel('Önceki Miktar 1').fill('200');
    await dialog.getByLabel('Dönem Miktarı 1').fill('150');
    await dialog.getByLabel('Kesinti Toplamı').fill('2500');
    await dialog.getByRole('button', { name: 'Taslak Oluştur' }).click();
    await expect(page.getByTestId('claim-notice')).toContainText('taslak');

    // Satır: brüt 37500.00, kesinti 2500.00, net 35000.00
    const row2 = page.getByTestId('claim-row-2');
    await expect(row2).toBeVisible();
    await expect(row2.getByText('₺34.362,50')).toBeVisible();

    // Önizle: formül açıklaması + snapshot fiyat + dondurma notu
    await row2.getByRole('button', { name: 'Önizle' }).click();
    const calc = page.getByTestId('claim-calculation');
    await expect(calc).toBeVisible();
    await expect(calc.getByText(/Dönem tutarı = Dönem miktarı × Birim fiyat/)).toBeVisible();
    await expect(calc.getByText('₺34.362,50')).toBeVisible(); // NET (brüt − kesinti)
    await calc.getByRole('button', { name: 'Kapat' }).click();
    await page.screenshot({ path: '/home/z/my-project/santiyepro/docs/screenshots/phase-08-hakedisler.png', fullPage: true });

    // Gönder → Onayla (UI)
    await row2.getByRole('button', { name: 'Gönder' }).click();
    await expect(row2.getByText('Onay Bekliyor')).toBeVisible();
    await row2.getByRole('button', { name: 'Onayla' }).click();
    await expect(row2.getByText('Onaylandı')).toBeVisible();

    // API düzeyinde: kalem fiyatı değişir → ONAYLI hakediş snapshot'ı değişmez
    await apiSend(page.request, seeded.token, 'PATCH', `/progress-claims/contract-items/${seeded.item1Id}`, {
      unitPrice: '999',
    });
    const after = (await page.request.get(
      `${process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1'}/progress-claims/${claim1.id}`,
      { headers: { Authorization: `Bearer ${seeded.token}` } },
    ).then((r) => r.json())) as { lines: Array<{ unitPriceSnapshot: string; lineAmount: string }>; netTotal: string };
    expect(after.lines[0].unitPriceSnapshot).toBe('245.75');
    expect(after.lines[0].lineAmount).toBe('49150.00');
    expect(after.netTotal).toBe('49150.00');

    // API düzeyinde: kesinti brütü aşarsa 400
    const res = await page.request.post(
      `${process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1'}/progress-claims`,
      {
        headers: { Authorization: `Bearer ${seeded.token}`, 'Content-Type': 'application/json' },
        data: {
          projectId: seeded.projectId,
          claimNo: 3,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
          deductionTotal: '999999',
          lines: [{ contractItemId: seeded.item1Id, previousQuantity: '350', periodQuantity: '10' }],
        },
      },
    );
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain('Kesinti toplamı brüt tutarı aşamaz');
  });
});
