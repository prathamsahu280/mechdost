/**
 * Section bars on phones (UI review 2026-11-14): the admin and account section lists scroll sideways; the current
 * section is brought into view, so people can see where they are (it was cut off or off screen).
 */
import { expect, test, type Page } from '@playwright/test';
import { CONSENT_DECIDED } from './fixtures/consent';

test.use({ storageState: CONSENT_DECIDED });

async function signIn(page: Page, phone: string, admin = false) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (admin) {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
  await expect(page).not.toHaveURL(/\/login/);
}

async function expectCurrentInView(page: Page, navName: string) {
  const current = page.getByRole('navigation', { name: navName }).locator('[aria-current="page"]');
  await expect(current).toBeVisible();
  await expect
    .poll(async () => {
      const box = await current.boundingBox();
      const width = page.viewportSize()?.width ?? 0;
      return box ? box.x >= 0 && box.x + box.width <= width : false;
    })
    .toBe(true);
}

test('the current admin section is in view on a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the bar scrolls sideways only on phones');
  await signIn(page, '9000000003', true);
  await page.goto('/admin/notifications');
  await expectCurrentInView(page, 'Console sections');
});

test('the current account section is in view on a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the bar scrolls sideways only on phones');
  await signIn(page, '9876543210');
  await page.goto('/account/profile');
  await expectCurrentInView(page, 'Account sections');
});

test('/support leads to the support section in both languages', async ({ page }) => {
  await page.goto('/support');
  await expect(page).toHaveURL(/\/account\/support$/);
  await page.goto('/hi/support');
  await expect(page).toHaveURL(/\/hi\/account\/support$/);
});
