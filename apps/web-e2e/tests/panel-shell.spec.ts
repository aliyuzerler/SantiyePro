/**
 * ŞantiyePro e2e — panel kabuğu duman testi (masaüstü).
 * Gerçek UI girişi ile panel açılır; menüdeki her modül sayfası erişilebilir
 * olmalı ve başlığını göstermelidir (design/03 menü listesi).
 */
import { expect, test, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui';

/** Menü listesi — design/03. Başlıklar gerçek PageHeader metinleridir. */
const PAGES: Array<[href: string, heading: string]> = [
  ['/', 'Genel Bakış'],
  ['/projeler', 'Projeler'],
  ['/gorevler', 'Görevler'],
  ['/gunluk-raporlar', 'Günlük Raporlar'],
  ['/puantaj', 'Personel & Puantaj'],
  ['/depo', 'Depo & Malzemeler'],
  ['/giderler', 'Giderler'],
  ['/hakedisler', 'Hakedişler'],
  ['/raporlar', 'Raporlar'],
  ['/kullanicilar', 'Kullanıcılar & Yetkiler'],
  ['/ayarlar', 'Ayarlar'],
];

test.describe('Panel kabuğu (masaüstü)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-desktop',
      'Masaüstü kabuk testi yalnızca chromium-desktop projesinde koşar.',
    );
  });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await uiLogin(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('giriş akışı panele ulaştırır ve marka görünür', async () => {
    await expect(page.getByText('ŞantiyePro').first()).toBeVisible();
  });

  test('menüdeki 11 modül sayfası erişilebilir ve başlıklı', async () => {
    for (const [href, heading] of PAGES) {
      await page.goto(`/panel${href === '/' ? '' : href}`);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test('panel oturumla açılır: ana menü ve oturum menüsü mevcut', async () => {
    await page.goto('/panel');
    await expect(page.locator('nav[aria-label="Ana menü"]')).toBeVisible();
    await expect(page.locator('[aria-label^="Oturum:"]')).toBeVisible();
  });
});
