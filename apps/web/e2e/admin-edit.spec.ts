import { expect, test, type Page } from '@playwright/test';

/**
 * Storefront "Edit" shortcut for catalogue staff (user 2026-11-25; spec 08, spec 13). Demo build: the demo admin
 * login is the staff session. Visitors, customers and shops get nothing, and the shared server HTML carries nothing
 * staff-only (the button appears after hydration, only for the staff session).
 */
const PASSWORD = 'Raipur@2026';
const SLUG = 'castrol-activ-4t-20w40-900ml';
const EDIT = '[data-slot="admin-edit"]';

async function signIn(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (phone === '9000000003') {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
}

test.describe('storefront edit shortcut', () => {
  test('the server HTML of the shared pages has nothing staff-only', async ({ request }) => {
    for (const path of ['/shop', `/shop/${SLUG}`, '/hi/shop']) {
      const html = await (await request.get(path)).text();
      expect(html, path).not.toContain('data-slot="admin-edit"');
      // No rendered link to the editor; the page's inert props (slug, label, address) are public text, never staff data.
      expect(html, path).not.toMatch(/<a[^>]+href="[^"]*\/admin\/catalogue/);
    }
  });

  for (const [who, phone] of [
    ['a customer', '9876543210'],
    ['a shop', '9000000001'],
    ['a workshop', '9000000002'],
  ] as const) {
    test(`${who} sees no edit button on cards or the product page`, async ({ page }) => {
      await signIn(page, phone);
      await page.goto('/shop');
      await expect(page.locator('main article').first()).toBeVisible();
      await page.waitForTimeout(800);
      await expect(page.locator(EDIT)).toHaveCount(0);
      await page.goto(`/shop/${SLUG}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForTimeout(800);
      await expect(page.locator(EDIT)).toHaveCount(0);
    });
  }

  test('a signed-out visitor sees none', async ({ page }) => {
    await page.goto('/shop');
    await expect(page.locator('main article').first()).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator(EDIT)).toHaveCount(0);
  });

  test('staff get a link on every card and beside the product title, never nested in another link', async ({
    page,
  }) => {
    await signIn(page, '9000000003');
    await page.goto('/shop');
    const cards = page.locator('main article');
    await expect(cards.first()).toBeVisible();
    await expect(page.locator(EDIT)).toHaveCount(await cards.count());
    const first = page.locator(`main article ${EDIT}`).first();
    await expect(first).toHaveAttribute('href', /\/admin\/catalogue\?product=[a-z0-9-]+$/);
    await expect(first).toHaveAccessibleName(/^Edit .+/);
    expect(await first.evaluate((el) => el.parentElement?.closest('a') ?? null)).toBeNull();

    await page.goto(`/shop/${SLUG}`);
    const onPage = page.locator(`main ${EDIT}`).first();
    await expect(onPage).toBeVisible();
    await expect(onPage).toHaveAttribute('href', `/admin/catalogue?product=${SLUG}`);
    const box = await onPage.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(32);
    await onPage.click();
    await expect(page).toHaveURL(new RegExp(`/admin/catalogue\\?product=${SLUG}$`));
  });

  test('the link keeps the Hindi prefix and the label is in Hindi', async ({ page }) => {
    await signIn(page, '9000000003');
    await page.goto(`/hi/shop/${SLUG}`);
    const button = page.locator(`main ${EDIT}`).first();
    await expect(button).toHaveAttribute('href', `/hi/admin/catalogue?product=${SLUG}`);
    await expect(button).toHaveAccessibleName(/बदलें$/);
  });
});
