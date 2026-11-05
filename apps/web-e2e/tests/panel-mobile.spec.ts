/**
 * ŞantiyePro e2e — panel kabuğu duman testi (mobil 390×844).
 * design/03: 768px altında sidebar drawer olur; hamburger "Menüyü aç" ile açılır.
 */
import { expect, test, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui';

test.describe('Panel kabuğu (mobil drawer)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-mobile',
      'Mobil kabuk testi yalnızca chromium-mobile projesinde koşar.',
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

  test('hamburger drawer açar ve menü öğesi sayfaya götürür', async () => {
    await expect(page.getByRole('heading', { name: 'Genel Bakış' })).toBeVisible();

    await page.getByRole('button', { name: 'Menüyü aç' }).click();
    const drawer = page.locator('[role="dialog"][aria-label="Menü"]');
    await expect(drawer).toBeVisible();

    await drawer.locator('nav[aria-label="Ana menü"]').getByText('Projeler').click();
    await expect(page.getByRole('heading', { name: 'Projeler', exact: true })).toBeVisible();
  });

  test('drawer dışına tıklama menüyü kapatır', async () => {
    await page.goto('/panel');
    await page.getByRole('button', { name: 'Menüyü aç' }).click();
    const drawer = page.locator('[role="dialog"][aria-label="Menü"]');
    await expect(drawer).toBeVisible();
    await page.mouse.click(20, 400); // drawer dışındaki overlay alanı
    await expect(drawer).toBeHidden();
  });
});
