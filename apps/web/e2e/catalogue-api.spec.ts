/**
 * Shop listing, search and product pages on the catalogue API (data mode `api`, plan 2026-11-10). Skipped unless
 * the web was built with NEXT_PUBLIC_DATA_MODE=api and E2E_DATA_MODE=api is set; needs the API on
 * NEXT_PUBLIC_API_URL with the Raipur demo catalogue (`pnpm db:seed:demo`) and CATALOGUE_PAGE_SIZE=8 so the
 * 20 demo products span pages. Steps: docs/runbooks/demo.md § Catalogue on the API.
 * The API-down run (E2E_API_DOWN=1) starts the web with the API stopped and checks the retry message.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const SLOW = { timeout: 15_000 };
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function axe(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.skip(process.env.E2E_DATA_MODE !== 'api', 'needs a data-mode api build and the API');

test.describe('catalogue on the API', () => {
  test.skip(process.env.E2E_API_DOWN === '1', 'API-down run checks only the retry message');

  test('listing shows the API cards with prices for Raipur', async ({ page, request }) => {
    const res = await request.get(`${API}/v1/catalogue/products?locale=en&city=RPR&limit=8`);
    const body = (await res.json()) as { items: { name: string; brand: { name: string } }[] };
    const first = body.items[0];
    expect(first).toBeDefined();
    await page.goto('/shop');
    await expect(page.getByRole('link', { name: `${first?.brand.name} ${first?.name}` })).toBeVisible(SLOW);
    await expect(page.getByText('Showing 8 products')).toBeVisible();
    // Products with a buyable offer show a price (the newest may be on request).
    await expect(page.locator('article').getByText(/₹/).filter({ visible: true }).first()).toBeVisible();
  });

  test('search "castrl" finds Castrol (typo tolerant)', async ({ page }) => {
    await page.goto('/shop?q=castrl');
    await expect(page.getByRole('link', { name: /^Castrol / }).first()).toBeVisible(SLOW);
  });

  test('a category chip filters on the server and keeps the URL shareable', async ({ page }) => {
    await page.goto('/shop');
    await page.getByRole('link', { name: 'Batteries' }).first().click();
    await expect(page).toHaveURL(/category=batteries/, SLOW);
    await expect(page.getByText('3 products')).toBeVisible(SLOW);
    await page.reload();
    await expect(page.getByText('3 products')).toBeVisible(SLOW);
  });

  test('load more appends the next page, moves focus to it and announces it', async ({ page }) => {
    await page.goto('/shop');
    await expect(page.locator('article')).toHaveCount(8, SLOW);
    await page.getByRole('button', { name: 'Load more products' }).click();
    await expect(page.locator('article')).toHaveCount(16, SLOW);
    await expect(page.getByRole('status').filter({ hasText: '8 more products loaded' })).toBeAttached();
    await expect(page.locator('li:focus')).toHaveCount(1);
    await page.getByRole('button', { name: 'Load more products' }).click();
    await expect(page.locator('article')).toHaveCount(20, SLOW);
    await expect(page.getByRole('button', { name: 'Load more products' })).toHaveCount(0);
    await expect(page.getByText('20 products', { exact: true })).toBeVisible();
  });

  test('quick details on a card added by Load more open that card (unique ids)', async ({ page }) => {
    await page.goto('/shop');
    await page.getByRole('button', { name: 'Load more products' }).click();
    await expect(page.locator('article')).toHaveCount(16, SLOW);
    const ninth = page.locator('article').nth(8);
    const name = (await ninth.getByRole('heading', { level: 3 }).innerText()).trim();
    await ninth.getByRole('button', { name: /^More details about / }).click();
    await expect(page.getByRole('dialog', { name })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await axe(page)).toEqual([]);
  });

  test('leaving a category through the main shop link resets the filters; Load more continues that list', async ({
    page,
  }) => {
    await page.goto('/shop?category=batteries');
    await expect(page.getByText('3 products')).toBeVisible(SLOW);
    // The header link on desktop, the bottom tab bar on phones: whichever main link to the shop is visible.
    await page.locator('a[href="/shop"]').filter({ visible: true }).first().click();
    await expect(page.getByText('Showing 8 products')).toBeVisible(SLOW);
    await expect(page.getByRole('link', { name: /All categories/ })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Load more products' }).click();
    await expect(page.locator('article')).toHaveCount(16, SLOW);
  });

  test('pages added by Load more are still there after opening a product and going Back', async ({
    page,
  }) => {
    await page.goto('/shop');
    await page.getByRole('button', { name: 'Load more products' }).click();
    await expect(page.locator('article')).toHaveCount(16, SLOW);
    await page.locator('article').nth(12).getByRole('heading', { level: 3 }).getByRole('link').click();
    await expect(page).toHaveURL(/\/shop\/[a-z0-9-]+$/, SLOW);
    await page.goBack();
    await expect(page.locator('article')).toHaveCount(16, SLOW);
  });

  test('a malformed product URL is a 404 page', async ({ page }) => {
    const res = await page.goto('/shop/Not_A_Slug');
    expect(res?.status()).toBe(404);
  });

  test('product page shows the seller and the country of origin', async ({ page }) => {
    await page.goto('/shop/castrol-activ-4t-20w40-900ml');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible(SLOW);
    // The page's own facts table (the related cards' quick-details popovers hold hidden lists too).
    const fact = (term: string) =>
      page.locator('dt', { hasText: term }).locator('xpath=following-sibling::dd');
    await expect(fact('Sold by')).toHaveText('Sharma Auto Parts');
    await expect(fact('Country of origin')).toHaveText('India');
  });

  test('an unknown product is a 404 page, not an error', async ({ page }) => {
    const res = await page.goto('/shop/no-such-product-here');
    expect(res?.status()).toBe(404);
  });

  test('/hi/shop shows Hindi names and Hindi country of origin', async ({ page }) => {
    await page.goto('/hi/shop?category=batteries');
    await expect(page.getByText('3 प्रोडक्ट')).toBeVisible(SLOW);
    await page.goto('/hi/shop/castrol-activ-4t-20w40-900ml');
    await expect(
      page.locator('dt', { hasText: 'मूल देश' }).locator('xpath=following-sibling::dd'),
    ).toHaveText('भारत', SLOW);
  });
});

test.describe('catalogue on the API: accessibility', () => {
  test.skip(process.env.E2E_API_DOWN === '1', 'API-down run checks only the retry message');
  // Includes the states only API data has: cards without a price or rating, a product on request.
  for (const path of ['/shop', '/shop/ev-portable-charger-15a', '/hi/shop/castrol-activ-4t-20w40-900ml']) {
    test(`no WCAG 2.2 AA violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible(SLOW);
      expect(await axe(page)).toEqual([]);
    });
  }
});

test('API down → the shop shows the retry message, not an empty catalogue', async ({ page }) => {
  test.skip(process.env.E2E_API_DOWN !== '1', 'run with the API stopped');
  await page.goto('/shop?q=api-down-check');
  const message = page.getByRole('heading', { name: /Unable to load the product catalogue/ });
  await expect(message).toBeVisible(SLOW);
  await expect(message).toBeFocused();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.locator('article')).toHaveCount(0);
});
