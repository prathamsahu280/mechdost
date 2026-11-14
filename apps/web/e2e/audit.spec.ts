import { expect, test, type Page } from '@playwright/test';
import { CATEGORY_KEYS, CATEGORY_SLUGS, DEMO_PRODUCTS } from '../src/demo/catalogue';
import { DEMO_WORKSHOPS } from '../src/demo/workshops';

/**
 * Exhaustive click-through audit (user, 2026-11-01: "test each and every button … and each and every render").
 * Every page in both languages: no console errors, no uncaught exceptions, no hydration mismatches; every
 * internal link resolves; every button can be clicked without breaking the page.
 */
const BASE_PAGES = [
  '/',
  '/shop',
  '/shop?category=batteries',
  '/workshops',
  '/cart',
  '/checkout',
  '/account',
  '/account/vehicles',
  '/account/profile',
  '/account/coins',
  '/policies/returns',
  '/policies/privacy',
  '/terms',
  '/policies/delivery',
  '/policies/service-terms',
  '/policies/company',
  '/admin/coins',
  '/login',
  '/quotes/new',
  '/admin',
  '/admin/orders',
  '/admin/notifications',
  '/admin/customers',
  '/admin/support',
  '/account/support',
  '/admin/layout',
  '/partner/shop',
  '/partner/workshop',
  '/partners',
  '/partners/apply/garage',
  ...DEMO_PRODUCTS.slice(0, 6).map((p) => `/shop/${p.slug}`),
  ...DEMO_WORKSHOPS.map((w) => `/workshops/${w.slug}`),
];
const PAGES = [...BASE_PAGES, ...BASE_PAGES.map((p) => (p === '/' ? '/hi' : `/hi${p}`))];

/**
 * Collects console errors, page errors and failed HTTP responses. Failed resources are reported once, from the
 * response (it carries the URL and headers); the browser's duplicate "Failed to load resource" console line is
 * skipped.
 *
 * Known framework noise, excluded on purpose: after an en → hi → en switch, Next 16's client segment cache can
 * prefetch the home page segment (`next-router-segment-prefetch: /$d$locale/__PAGE__`) against other
 * statically prerendered URLs, which 404s. Navigation is unaffected (verified in a trace, 2026-11-02;
 * docs/progress.md). Every other 404 — including any real navigation or RSC fetch — still fails the test.
 */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' || msg.text().startsWith('Failed to load resource')) return;
    errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() < 400) return;
    const segment = res.request().headers()['next-router-segment-prefetch'];
    if (res.status() === 404 && segment === '/$d$locale/__PAGE__') return;
    errors.push(`http ${res.status()}: ${res.url()}`);
  });
  return errors;
}

async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo(0, 0);
  });
}

test.describe('every page renders cleanly', () => {
  test.describe.configure({ mode: 'parallel' });
  for (const path of PAGES) {
    test(`no console errors, exceptions or hydration mismatches on ${path}`, async ({ page }) => {
      const errors = watchErrors(page);
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await page.waitForLoadState('networkidle');
      await scrollThrough(page);
      await expect(page.locator('h1').first()).toBeVisible();
      expect(errors, path).toEqual([]);
    });
  }
});

const MAP_ATTRIBUTION = new Set([
  'https://openfreemap.org',
  'https://www.openmaptiles.org/',
  'https://www.openstreetmap.org/copyright',
]);

test('every internal link on every page resolves', async ({ page, request }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, 'one crawl is enough (desktop)');
  test.setTimeout(180_000);
  const hrefs = new Set<string>();
  for (const path of PAGES) {
    await page.goto(path);
    const found = await page
      .locator('a[href]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    for (const h of found) hrefs.add(h);
  }
  const broken: string[] = [];
  for (const href of hrefs) {
    if (href.startsWith('/')) {
      const res = await request.get(href.split('#')[0] ?? href);
      if (res.status() >= 400) broken.push(`${href} → ${res.status()}`);
    } else if (href.startsWith('https://wa.me/')) {
      if (!/^https:\/\/wa\.me\/917978776551\?text=.+/.test(href)) broken.push(`bad WhatsApp link ${href}`);
    } else if (href.startsWith('https://www.google.com/maps/')) {
      if (
        !/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-?\d+\.\d{6},-?\d+\.\d{6}$/.test(href)
      )
        broken.push(`bad directions link ${href}`);
    } else if (MAP_ATTRIBUTION.has(href)) {
      // Licence-required map attribution; present only once the map has loaded, so the crawl sees it by timing.
    } else if (href.startsWith('tel:')) {
      if (href !== 'tel:+917978776551') broken.push(`bad phone link ${href}`);
    } else if (!href.startsWith('#')) {
      broken.push(`unexpected link ${href}`);
    }
  }
  expect(broken).toEqual([]);
  expect(hrefs.size).toBeGreaterThan(40);
});

test.describe('every button can be clicked', () => {
  for (const path of [
    '/',
    '/shop',
    '/shop/castrol-activ-4t-20w40-900ml',
    '/workshops',
    '/workshops/shankar-nagar-auto-hub',
    '/cart',
    '/checkout',
    '/hi/workshops',
  ]) {
    test(`buttons on ${path}`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page);
      // Reduced motion: map camera moves and popover exit transitions finish instantly, so the next button is
      // stable when clicked (users with motion get the same end states).
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path);
      await page.waitForLoadState('load');
      await page.waitForTimeout(1_000);
      // Map pins are covered by the dedicated map test (demo-flows): after one pin zooms the map, the others sit
      // outside the map's clipped area and cannot be hit, exactly as for a user.
      const BUTTONS = 'button:visible:not(.md-map-pin)';
      const count = await page.locator(BUTTONS).count();
      for (let i = 0; i < count; i++) {
        const button = page.locator(BUTTONS).nth(i);
        if (!(await button.count())) continue;
        if (await button.isDisabled()) continue;
        const label = ((await button.getAttribute('aria-label')) ?? (await button.innerText())).trim();
        await button.click({ trial: false, timeout: 5_000 }).catch((e: unknown) => {
          errors.push(`could not click "${label}": ${String(e).slice(0, 120)}`);
        });
        await page.waitForTimeout(150);
        // A click that navigated (e.g. a submit) is fine — return to the page under test.
        if (!page.url().includes(path.split('?')[0] ?? path)) await page.goto(path);
        await page.keyboard.press('Escape');
        // The map's full-screen button covers the page; leave full screen before the next button.
        await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
      }
      expect(errors, path).toEqual([]);
      expect(count, `${path} should have buttons`).toBeGreaterThan(0);
    });
  }
});

test.describe('shop filters stay in sync and never jump', () => {
  test('chips, dropdown, URL and results always agree, without scrolling or reloading', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/shop');
    await page.waitForLoadState('networkidle');
    const chips = page.getByRole('navigation', { name: 'Category' });
    await chips.scrollIntoViewIfNeeded();
    // Marker survives only if the page is not reloaded.
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    for (const key of CATEGORY_KEYS) {
      const slug = CATEGORY_SLUGS[key];
      const name = await page
        .locator('#shop-category option')
        .filter({ hasText: /./ })
        .nth(CATEGORY_KEYS.indexOf(key) + 1)
        .innerText();
      const chip = chips.getByRole('link', { name, exact: true });
      // Measure from where a real user taps: the chip fully on screen (not under the fixed mobile tab bar).
      await chip.evaluate((el) => {
        el.scrollIntoView({ block: 'center' });
      });
      const before = await page.evaluate(() => window.scrollY);
      await chip.click();
      await expect(page).toHaveURL(new RegExp(`category=${slug}$`));
      await expect(page.locator('#shop-category')).toHaveValue(slug);
      await expect(chips.locator('[aria-current="page"]')).toHaveAccessibleName(name);
      const expected = DEMO_PRODUCTS.filter((p) => p.category === key).length;
      await expect(page.getByRole('article')).toHaveCount(expected);
      expect(
        Math.abs((await page.evaluate(() => window.scrollY)) - before),
        `scroll jumped on ${slug}`,
      ).toBeLessThan(2);
    }

    // Dropdown drives the chips too.
    await page.locator('#shop-category').selectOption('tyres');
    await expect(chips.locator('[aria-current="page"]')).toHaveAccessibleName('Tyres');
    await expect(page).toHaveURL(/category=tyres$/);

    // Sort reorders, search narrows, Back restores, Clear resets.
    await page.locator('#shop-sort').selectOption('price_asc');
    const prices = await page.getByRole('article').locator('.font-heading.text-\\[22px\\]').allInnerTexts();
    const values = prices.map((p) => Number(p.replace(/[^\d]/g, '')));
    expect(values).toEqual([...values].sort((a, b) => a - b));
    await page.locator('#shop-category').selectOption('');
    await page.getByLabel('Search products').fill('exide');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(3);
    await expect(page).toHaveURL(/q=exide/);
    await page.goBack();
    await expect(page.getByRole('article')).not.toHaveCount(3);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(page.getByRole('article')).toHaveCount(DEMO_PRODUCTS.length);
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('a shared filtered link opens with matching controls', async ({ page }) => {
    await page.goto('/hi/shop?category=filters&sort=price_desc&q=filter');
    await expect(page.locator('#shop-category')).toHaveValue('filters');
    await expect(page.locator('#shop-sort')).toHaveValue('price_desc');
    await expect(page.getByLabel('प्रोडक्ट खोजें')).toHaveValue('filter');
    await expect(page.getByRole('article')).toHaveCount(2);
  });
});

test.describe('header controls work on every page type', () => {
  for (const path of [
    '/shop/exide-xltz4a-2w-battery',
    '/workshops/sarona-car-care',
    '/cart',
    '/account/vehicles',
  ]) {
    test(`language and theme on ${path}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto(path);
      await page.getByRole('link', { name: 'हिंदी' }).click();
      await expect(page).toHaveURL(new RegExp(`/hi${path}$`));
      await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
      await page.getByRole('link', { name: 'English' }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      if ((page.viewportSize()?.width ?? 0) >= 400) {
        await page.getByRole('button', { name: 'Dark mode' }).first().click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.getByRole('button', { name: 'Dark mode' }).first().click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      }
      expect(errors).toEqual([]);
    });
  }
});
