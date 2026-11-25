import { expect, test, type Page } from '@playwright/test';

/**
 * Bug 2026-11-25: on /shop the suggestion list stayed open over the results after a pick or Enter. Roadside page for a
 * signed-in non-customer said "Sign in". Demo mode, English and Hindi.
 */
const DEMO_PASSWORD = 'Raipur@2026';

async function signIn(page: Page, phone: string, next: string, staff = false) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (staff) await page.getByLabel('One-time code').fill('123456');
}

for (const [path, label] of [
  ['/shop', 'Search products'],
  ['/hi/shop', ''],
] as const) {
  test(`the shop suggestion list closes after Enter and after a pick (${path})`, async ({ page }) => {
    await page.goto(path);
    const box = label ? page.getByLabel(label) : page.locator('#shop-q');
    await box.click();
    await box.fill('exide');
    const list = page.getByRole('listbox');
    await expect(list).toBeVisible();
    await expect(box).toHaveAttribute('aria-expanded', 'true');

    await box.press('Enter');
    await expect(page).toHaveURL(/q=exide/i);
    await expect(list).toBeHidden();
    await expect(box).toHaveAttribute('aria-expanded', 'false');

    // Typing again opens it; picking a non-product row closes it over the updated results.
    await box.fill('');
    await box.fill('exide');
    await expect(list).toBeVisible();
    const row = list
      .getByRole('option')
      .filter({ hasNotText: /Product|उत्पाद/ })
      .first();
    await expect(row).toBeVisible();
    {
      await row.click();
      await expect(list).toBeHidden();
      await expect(box).toHaveAttribute('aria-expanded', 'false');
      // Settle: the list must not come back once the results arrive.
      await page.waitForTimeout(600);
      await expect(list).toBeHidden();
    }
  });
}

test('roadside: guest sees the sign-in prompt without the verified-email line', async ({ page }) => {
  await page.goto('/roadside');
  await expect(page.getByText('Sign in with your phone number to ask for roadside help.')).toBeVisible();
  await expect(page.getByText(/verified email/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in' }).last()).toBeVisible();
});

test('roadside: a customer gets the form', async ({ page }) => {
  await signIn(page, '9876543210', '/roadside');
  await expect(page.getByLabel('PIN code')).toBeVisible();
});

test('roadside: staff are told it is a customer service, with a link to the queue and no Sign in button', async ({
  page,
}) => {
  await signIn(page, '9000000003', '/roadside', true);
  await expect(page.getByText(/signed in as staff/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the roadside help queue' })).toHaveAttribute(
    'href',
    '/admin/roadside',
  );
  await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toHaveCount(0);
});

for (const [who, phone] of [
  ['shop', '9000000001'],
  ['workshop', '9000000002'],
] as const) {
  test(`roadside: a ${who} account gets the honest message and no admin link`, async ({ page }) => {
    await signIn(page, phone, '/roadside');
    await expect(page.getByText(/signed in as a partner account/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the roadside help queue' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  });
}
