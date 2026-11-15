import { expect, test, type Page } from '@playwright/test';

/**
 * Site chrome fit (audit 2026-11-15, items 2 and 8; docs/qa/state-audit-run-2026-11-15.md).
 * - The header at 1024-1100 px with a two-digit cart count, signed out and in, English and Hindi: no sideways scroll,
 *   the cart button inside the viewport.
 * - The open privacy banner never covers a control on phones: the page reserves its height, so the cart's checkout
 *   button scrolls fully above it, and the assistant button sits above the banner.
 */
const CART_SLUG = 'castrol-activ-4t-20w40-900ml';

const seedCart = (page: Page, qty: number) =>
  page.addInitScript(
    ([slug, q]) => {
      window.localStorage.setItem('mechdost-cart', JSON.stringify([{ slug, qty: q }]));
    },
    [CART_SLUG, qty] as const,
  );

async function expectHeaderFits(page: Page, what: string) {
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(() => {
    const cart = document.querySelector('[data-track="header_cart"]');
    if (!cart) return null;
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      cartRight: cart.getBoundingClientRect().right,
      width: window.innerWidth,
    };
  });
  expect(m, `${what}: the cart button exists`).not.toBeNull();
  expect(m?.overflow, `${what}: the page scrolls sideways`).toBeLessThanOrEqual(0);
  expect(m?.cartRight ?? 0, `${what}: the cart button sticks out`).toBeLessThanOrEqual(m?.width ?? 0);
}

test.describe('header fit at the nav breakpoint', () => {
  test.skip(({ isMobile }) => isMobile, 'sets its own widths');

  for (const width of [1024, 1060, 1100])
    for (const path of ['/', '/hi'])
      for (const qty of [0, 9, 99])
        test(`signed out, ${path}, cart ${String(qty)} at ${String(width)} px`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await seedCart(page, qty);
          await page.goto(path);
          await expectHeaderFits(page, `${String(width)} px ${path} cart ${String(qty)}`);
        });

  for (const width of [1024, 1100])
    for (const prefix of ['', '/hi'])
      test(`signed in, ${prefix || '/'}, cart 99 at ${String(width)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${prefix}/login?next=${encodeURIComponent(`${prefix}/account`)}`);
        await page
          .locator('input[name="identifier"], input[autocomplete="username"]')
          .first()
          .fill('9876543210');
        await page.locator('input[type="password"]').first().fill('Raipur@2026');
        await page.locator('form button[type="submit"]').first().click();
        await expect(page).toHaveURL(/\/account/);
        await seedCart(page, 99);
        await page.goto(prefix || '/');
        await expectHeaderFits(page, `signed in ${String(width)} px ${prefix}`);
      });
});

test.describe('privacy banner leaves the last controls reachable', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(({ isMobile }) => isMobile, 'sets its own widths');

  for (const width of [320, 390])
    test(`the cart's checkout button scrolls clear of the banner at ${String(width)} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 700 });
      await seedCart(page, 2);
      await page.goto('/cart');
      const banner = page.getByTestId('consent-banner');
      await expect(banner).toBeVisible();
      const checkout = page.getByText('Proceed to checkout').first();
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      const [b, c] = await Promise.all([banner.boundingBox(), checkout.boundingBox()]);
      expect(c?.y ?? -1, 'the button is on screen').toBeGreaterThanOrEqual(0);
      expect((c?.y ?? 0) + (c?.height ?? 0), 'button bottom above banner top').toBeLessThanOrEqual(b?.y ?? 0);
      const l = await page.locator('.assistant-launcher').boundingBox();
      if (l)
        expect(l.y + l.height, 'the assistant button sits above the banner').toBeLessThanOrEqual(b?.y ?? 0);
    });
});
