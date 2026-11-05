/**
 * ŞantiyePro e2e — UI yardımcıları.
 */
import type { Page } from '@playwright/test';
import { E2E_ADMIN } from './api';

/**
 * Panel giriş ekranı üzerinden GERÇEK UI akışıyla oturum açar.
 * Doğrulama alanları (getByLabel) panelin erişilebilirlik etiketleridir.
 */
export async function uiLogin(page: Page): Promise<void> {
  await page.goto('/panel/giris');
  await page.getByLabel('E-posta').fill(E2E_ADMIN.email);
  await page.getByLabel('Parola').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Giriş Yap' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/giris'), { timeout: 20_000 });
  // AuthGate oturumu doğrulayıp panele çizene dek bekle
  await page.getByRole('heading', { name: 'Genel Bakış' }).waitFor({ timeout: 20_000 });
}
