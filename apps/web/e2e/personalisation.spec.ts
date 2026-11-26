import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Shopping personalisation phases 2 and 3 (design 2026-11-25, founder approval 2026-11-26), demo build:
 * recently viewed on the product page, cart, empty search and home (2+), Clear with focus on the heading, the list
 * survives blocked storage, Back to the shop list keeps the place, "Similar options" with the shared size, Hindi.
 */
const CASTROL = 'castrol-activ-4t-20w40-900ml';
const HP = 'hp-racer4-20w40-900ml';
const SLOW = { timeout: 15_000 };
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const recent = (page: Page) => page.getByRole('region', { name: /^(Recently viewed|हाल में देखे गए)$/ });

async function view(page: Page, slug: string, prefix = '') {
  await page.goto(`${prefix}/shop/${slug}`);
  await expect(page.locator('h1')).toBeVisible();
}

test.describe('recently viewed', () => {
  test('the product page lists the products seen before, never itself; Clear empties it and keeps focus', async ({
    page,
  }) => {
    await view(page, CASTROL);
    // First product ever: nothing to list yet.
    await expect(recent(page)).toHaveCount(0);
    await view(page, HP);
    const list = recent(page);
    await expect(list).toBeVisible(SLOW);
    await expect(list.getByRole('link', { name: /Activ 4T 20W40 900 ml/ })).toBeVisible();
    await expect(list.getByRole('link', { name: /Racer4/i })).toHaveCount(0);
    await list.getByRole('button', { name: 'Clear your recently viewed products' }).click();
    await expect(list.getByRole('link')).toHaveCount(0);
    await expect(list.getByRole('heading', { name: 'Recently viewed' })).toBeFocused();
    await expect(
      page.getByRole('status').filter({ hasText: 'Recently viewed products cleared.' }),
    ).toHaveCount(1);
  });

  test('cart, empty search and home (from two products) show the list', async ({ page }) => {
    await view(page, CASTROL);
    await page.goto('/');
    await expect(recent(page)).toHaveCount(0);
    await view(page, HP);
    await page.goto('/');
    await expect(recent(page)).toBeVisible(SLOW);
    await page.goto('/cart');
    await expect(recent(page)).toBeVisible(SLOW);
    await page.goto('/shop?q=zzqqxxnothing');
    await expect(recent(page)).toBeVisible(SLOW);
    expect(
      await new AxeBuilder({ page })
        .include('main')
        .withTags(WCAG)
        .analyze()
        .then((r) => r.violations),
    ).toEqual([]);
  });

  test('blocked storage: the product page works and shows no list or error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    await view(page, CASTROL);
    await view(page, HP);
    await expect(page.getByRole('heading', { name: 'Similar options' })).toBeVisible();
    await expect(recent(page)).toHaveCount(0);
    expect(errors.filter((m) => /recent|storage/i.test(m))).toEqual([]);
  });
});

test.describe('suggestions on the product page', () => {
  test('Similar options lists the same grade and pack of another brand, with the shared size, in Hindi too', async ({
    page,
  }) => {
    await view(page, CASTROL);
    const similar = page.getByRole('region', { name: 'Similar options' });
    await expect(similar).toBeVisible();
    await expect(similar.getByText('Same size: 900 ml')).toBeVisible();
    await expect(similar.locator(`a[href$="/shop/${HP}"]`).first()).toBeVisible();
    await expect(similar.locator(`a[href$="/shop/${CASTROL}"]`)).toHaveCount(0);
    await view(page, CASTROL, '/hi');
    await expect(page.getByRole('region', { name: 'मिलते-जुलते विकल्प' })).toBeVisible();
    await expect(page.getByText('वही साइज़: 900 ml')).toBeVisible();
  });

  test('a product with no size match keeps "More in this category"', async ({ page }) => {
    await view(page, 'brake-pad-set-front');
    await expect(page.getByRole('heading', { name: 'Similar options' })).toHaveCount(0);
    await expect(page.locator('#related')).toBeVisible();
  });
});

test.describe('Back keeps your place', () => {
  test('back to the shop list returns to where the shopper was', async ({ page }) => {
    await page.goto('/shop');
    const cards = page.locator('main article a[href*="/shop/"]');
    await expect(cards.first()).toBeVisible();
    const target = cards.nth(12);
    await target.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(400);
    await target.click();
    await expect(page.locator('h1')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/shop(\?|$)/);
    await expect.poll(() => page.evaluate(() => window.scrollY), SLOW).toBeGreaterThan(before - 150);
  });
});
