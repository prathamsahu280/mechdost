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
      // Bring the button into view the way keyboard focus does (honours the page's bottom scroll padding, which
      // reserves the open banner). Scrolling to the page end would put the footer on screen and the button above it.
      await checkout.evaluate((el) => {
        el.scrollIntoView({ block: 'end' });
      });
      const [b, c] = await Promise.all([banner.boundingBox(), checkout.boundingBox()]);
      expect(c?.y ?? -1, 'the button is on screen').toBeGreaterThanOrEqual(0);
      expect((c?.y ?? 0) + (c?.height ?? 0), 'button bottom above banner top').toBeLessThanOrEqual(b?.y ?? 0);
      const l = await page.locator('.assistant-launcher').boundingBox();
      if (l)
        expect(l.y + l.height, 'the assistant button sits above the banner').toBeLessThanOrEqual(b?.y ?? 0);
    });
});

// Signed-in header (audit 2026-11-16): the bell makes the row wider; it must fit from 320 to 1280 px for every role.
// Portals hide the cart pill, so there the check is the sideways scroll and the right-most header control.
const SIGNED_IN_ROLES = [
  { role: 'customer', phone: '9876543210', home: '/account', cart: true },
  { role: 'shop', phone: '9000000001', home: '/partner/shop', cart: false },
  { role: 'workshop', phone: '9000000002', home: '/partner/workshop', cart: false },
] as const;

test.describe('signed-in header fits at phone, tablet and desktop widths', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(({ isMobile }) => isMobile, 'sets its own widths');

  for (const { role, phone, home, cart } of SIGNED_IN_ROLES)
    for (const prefix of ['', '/hi'])
      for (const width of [320, 390, 480, 768, 1024, 1280])
        test(`${role}, ${prefix || '/'} at ${String(width)} px${cart ? ', cart 99' : ''}`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${prefix}/login?next=${encodeURIComponent(`${prefix}${home}`)}`);
          await page.locator('input[name="identifier"], input[autocomplete="username"]').first().fill(phone);
          await page.locator('input[type="password"]').first().fill('Raipur@2026');
          await page.locator('form button[type="submit"]').first().click();
          await expect(page).toHaveURL(new RegExp(home));
          if (cart) await seedCart(page, 99);
          await page.goto(prefix || '/');
          // The signed-in entry replaces the sign-in link after the session loads; measure only that header.
          await expect(
            page.locator('[data-track="header_account"]'),
            'the account entry is in the header',
          ).toBeAttached();
          await page.evaluate(() => document.fonts.ready);
          const m = await page.evaluate(() => {
            const right = [...document.querySelectorAll('header a, header button')]
              .map((el) => el.getBoundingClientRect())
              .filter((r) => r.width > 0)
              .reduce((max, r) => Math.max(max, r.right), 0);
            return {
              overflow: document.documentElement.scrollWidth - window.innerWidth,
              right,
              width: window.innerWidth,
              account: !!document.querySelector('[data-track="header_account"]'),
            };
          });
          expect(m.account, 'the account entry is in the header').toBe(true);
          expect(m.overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
          expect(m.right, 'a header control sticks out').toBeLessThanOrEqual(m.width);
        });
});

// Account section menu (audit 2026-11-16, API-NAV-ACCOUNT): the strip scrolls itself; the page never scrolls sideways.
test.describe('account menu stays inside the page', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(({ isMobile }) => isMobile, 'sets its own widths');

  for (const prefix of ['', '/hi'])
    for (const width of [320, 390, 480, 768])
      test(`/account, ${prefix || '/'} at ${String(width)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${prefix}/login?next=${encodeURIComponent(`${prefix}/account`)}`);
        await page
          .locator('input[name="identifier"], input[autocomplete="username"]')
          .first()
          .fill('9876543210');
        await page.locator('input[type="password"]').first().fill('Raipur@2026');
        await page.locator('form button[type="submit"]').first().click();
        await expect(page).toHaveURL(/\/account/);
        await page.evaluate(() => document.fonts.ready);
        const m = await page.evaluate(() => {
          const nav = document.querySelector<HTMLElement>('main nav[aria-label]');
          const cs = nav ? getComputedStyle(nav) : null;
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            navScrolls: cs?.overflowX === 'auto' || cs?.overflowX === 'scroll',
            navRight: nav?.getBoundingClientRect().right ?? 0,
            width: window.innerWidth,
          };
        });
        expect(m.overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
        expect(m.navScrolls, 'the menu is its own scroll box').toBe(true);
        expect(m.navRight, 'the menu box sticks out of the page').toBeLessThanOrEqual(m.width);
      });
});
