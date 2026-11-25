import { expect, test, type Page } from '@playwright/test';

/**
 * Admin → Catalogue (plan 2026-11-13 admin catalogue + PIN prices, Task 5). The editor talks to the real API only;
 * in the browser demo the section says so and makes no API calls. The Hindi crawl covers `/hi/admin/catalogue`
 * (ADMIN_SECTIONS).
 */
async function signInAdmin(page: Page) {
  await page.goto(`/login?next=${encodeURIComponent('/admin')}`);
  await page.getByLabel('Mobile number or email').fill('9000000003');
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('One-time code').fill('123456');
  await expect(page).toHaveURL(/\/admin$/);
}

test('demo mode: the catalogue section explains it needs the real backend and calls no API', async ({
  page,
}) => {
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/v1/admin/')) apiCalls.push(r.url());
  });
  await signInAdmin(page);
  await page.getByRole('link', { name: 'Catalogue' }).first().click();
  await expect(page).toHaveURL(/\/admin\/catalogue$/);
  await expect(page.getByRole('heading', { name: 'Catalogue', level: 2 })).toBeVisible();
  await expect(
    page.getByText('Catalogue editing uses the real backend: available after the switch to real sign-in.'),
  ).toBeVisible();
  expect(apiCalls).toEqual([]);
});
