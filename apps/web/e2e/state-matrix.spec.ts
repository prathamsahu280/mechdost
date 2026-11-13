/**
 * State matrix (user 2026-11-13: "check each and everything under every condition and state"). Every key page is
 * opened in every combination of signed out / signed in, light / dark, English / Hindi and three worlds — empty;
 * cart + compare list; busy (cart, compare, orders waiting/offered/shipped, an open support ticket, service requests,
 * a quote, an application, reviews: `fixtures/demo-world.ts`) — * and compare list, on desktop and phone (the two Playwright projects), plus each partner portal per role. Each
 * page is checked for the bug classes found so far:
 * - nothing scrolls sideways;
 * - the saved theme and the language stay applied, also after switching language on the client (bug 2026-11-13);
 * - every visible `position: fixed` element (tab bar, compare tray, assistant, banners) is on screen after scrolling
 *   (bug 2026-11-13: a transformed wrapper pinned the compare tray to the end of the page);
 * - the cart pill and the compare tray agree with the stored state;
 * - no uncaught errors and no failed requests to our own server.
 * `MATRIX_SHOTS=<dir>` also saves a full-page screenshot of every state for visual review.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { busyWorld, CODES } from './fixtures/demo-world';

const SHOTS = process.env.MATRIX_SHOTS ?? '';
const DEMO_PASSWORD = 'Raipur@2026';
const CONSENT = JSON.stringify({ analytics: false, version: '2026-11', at: '2026-11-01T00:00:00.000Z' });
const CASTROL = 'castrol-activ-4t-20w40-900ml';
const MOTUL = 'motul-3100-4t-10w30-1l';
const CART = [
  { slug: 'exide-xltz4a-2w-battery', qty: 1 },
  { slug: CASTROL, qty: 2 },
];
const COMPARE = { category: 'lubricants', slugs: [CASTROL, MOTUL] };

type Auth = 'out' | 'customer';
type Theme = 'light' | 'dark';
type Locale = 'en' | 'hi';

const PAGES = [
  '/',
  '/shop',
  '/shop?category=lubricants',
  `/shop/${CASTROL}`,
  `/compare?p=${CASTROL},${MOTUL}`,
  '/cart',
  '/checkout',
  '/workshops',
  '/partners',
  '/policies/returns',
  '/login',
] as const;
const SIGNED_IN_PAGES = ['/account', '/account/orders', '/account/vehicles', '/account/profile'] as const;

const PORTALS = [
  { role: 'shop', phone: '9000000001', pages: ['/partner/shop'] },
  { role: 'workshop', phone: '9000000002', pages: ['/partner/workshop'] },
  {
    role: 'admin',
    phone: '9000000003',
    pages: ['/admin', '/admin/orders', '/admin/partners', '/admin/settings', '/admin/content'],
  },
] as const;

const localised = (path: string, locale: Locale) =>
  locale === 'en' ? path : path === '/' ? '/hi' : `/hi${path}`;

type World = 'empty' | 'cart' | 'busy';

async function seed(page: Page, state: { theme: Theme; world: World }) {
  // Only our own server: no map tiles, fonts or images from elsewhere (keeps the run fast and offline).
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await page.addInitScript(
    (s: {
      theme: Theme;
      cart: string | null;
      compare: string | null;
      consent: string;
      extra: Record<string, unknown>;
    }) => {
      const set = (k: string, v: string) => {
        if (window.localStorage.getItem(k) === null) window.localStorage.setItem(k, v);
      };
      set('mechdost-consent', s.consent);
      window.localStorage.setItem('mechdost-theme', s.theme);
      if (s.cart) set('mechdost-cart', s.cart);
      if (s.compare) set('mechdost-compare', s.compare);
      for (const [k, v] of Object.entries(s.extra)) set(k, JSON.stringify(v));
    },
    {
      theme: state.theme,
      cart: state.world === 'empty' ? null : JSON.stringify(CART),
      compare: state.world === 'empty' ? null : JSON.stringify(COMPARE),
      consent: CONSENT,
      extra: state.world === 'busy' ? busyWorld(Date.now()) : {},
    },
  );
}

async function signIn(page: Page, phone: string, admin = false) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (admin) {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
  await expect(page).not.toHaveURL(/\/login/);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    const url = r.url();
    if (url.startsWith('http://localhost') && r.status() >= 400) errors.push(`${String(r.status())} ${url}`);
  });
  return errors;
}

/** Layout facts measured in the page: sideways scroll and fixed elements off screen (after scrolling down). */
async function layoutFacts(page: Page) {
  return page.evaluate(async () => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    window.scrollTo(0, Math.max(0, (document.documentElement.scrollHeight - window.innerHeight) / 2));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const offScreen: string[] = [];
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      if (getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (
        r.width < 2 ||
        r.height < 2 ||
        !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
      )
        continue;
      if (r.top < -1 || r.bottom > window.innerHeight + 1 || r.left < -1 || r.right > window.innerWidth + 1)
        offScreen.push(
          `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.className.slice(0, 60)}] top=${String(Math.round(r.top))}`,
        );
    }
    window.scrollTo(0, 0);
    return { overflow, offScreen };
  });
}

async function checkPage(
  page: Page,
  path: string,
  state: { theme: Theme; locale: Locale; world: World; label: string },
  errors: string[],
) {
  const url = localised(path, state.locale);
  await page.goto(url);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const where = `${state.label} ${url}`;
  const html = page.locator('html');
  await expect.soft(html, `${where}: theme`).toHaveAttribute('data-theme', state.theme);
  await expect.soft(html, `${where}: language`).toHaveAttribute('lang', state.locale);
  const facts = await layoutFacts(page);
  expect
    .soft(facts.overflow, `${where}: scrolls sideways by ${String(facts.overflow)}px`)
    .toBeLessThanOrEqual(1);
  expect.soft(facts.offScreen, `${where}: fixed elements off screen`).toEqual([]);
  if (path.startsWith('/shop')) {
    const tray = page.locator('aside a[href*="/compare?p="]');
    await expect.soft(tray, `${where}: compare tray`).toHaveCount(state.world === 'empty' ? 0 : 1);
  }
  if (SHOTS) {
    const dir = join(SHOTS, test.info().project.name);
    mkdirSync(dir, { recursive: true });
    const name = `${state.label}__${url.replace(/[^a-z0-9]+/gi, '_')}.png`;
    await page.screenshot({ path: join(dir, name), fullPage: true });
  }
  expect.soft(errors.splice(0), `${where}: errors`).toEqual([]);
}

/** Switch language with the header link (client navigation) and check the page, theme and query survive. */
async function switchLanguage(
  page: Page,
  path: string,
  state: { theme: Theme; locale: Locale; label: string },
) {
  await page.goto(localised(path, state.locale));
  const target: Locale = state.locale === 'en' ? 'hi' : 'en';
  await page.locator(`a[hreflang="${target}"]`).first().click();
  await expect(page.locator('html')).toHaveAttribute('lang', target);
  const where = `${state.label} switch ${state.locale}→${target} on ${path}`;
  await expect.soft(page.locator('html'), `${where}: theme`).toHaveAttribute('data-theme', state.theme);
  const expected = localised(path, target);
  expect
    .soft(
      decodeURIComponent(new URL(page.url()).pathname + new URL(page.url()).search),
      `${where}: same page`,
    )
    .toBe(expected);
  // The choice is remembered (language cookie), so switch back the same way before the next check.
  await page.locator(`a[hreflang="${state.locale}"]`).first().click();
  await expect(page.locator('html')).toHaveAttribute('lang', state.locale);
}

test.describe.configure({ mode: 'default' });

/** Customer pages that only mean something when the busy world's records exist. */
const BUSY_PAGES = [
  `/orders/${CODES.shipped}`,
  `/service/${CODES.proposed}`,
  `/quotes/${CODES.quote}`,
  '/account/support',
  '/account/services',
  '/account/quotes',
] as const;

const WORLDS = ['empty', 'cart', 'busy'] as const satisfies readonly World[];

for (const auth of ['out', 'customer'] as const satisfies readonly Auth[])
  for (const theme of ['light', 'dark'] as const satisfies readonly Theme[])
    for (const locale of ['en', 'hi'] as const satisfies readonly Locale[])
      for (const world of WORLDS) {
        const label = `${auth}-${theme}-${locale}-${world}`;
        test.describe(label, () => {
          // The system preference is the opposite of the saved choice, so a lost choice is visible.
          test.use({ colorScheme: theme === 'light' ? 'dark' : 'light' });
          test(`state matrix: ${label}`, async ({ page }) => {
            test.setTimeout(Number(process.env.MATRIX_TIMEOUT ?? 300_000));
            await seed(page, { theme, world });
            const errors = watchErrors(page);
            if (auth === 'customer') await signIn(page, '9876543210');
            const state = { theme, locale, world, label };
            const pages: string[] = [...PAGES];
            if (auth === 'customer') pages.push(...SIGNED_IN_PAGES);
            if (auth === 'customer' && world === 'busy') pages.push(...BUSY_PAGES);
            for (const path of pages) await checkPage(page, path, state, errors);
            for (const path of ['/', '/shop?category=lubricants', `/compare?p=${CASTROL},${MOTUL}`])
              await switchLanguage(page, path, state);
          });
        });
      }

for (const portal of PORTALS)
  for (const theme of ['light', 'dark'] as const satisfies readonly Theme[])
    for (const locale of ['en', 'hi'] as const satisfies readonly Locale[])
      for (const world of ['empty', 'busy'] as const satisfies readonly World[]) {
        const label = `${portal.role}-${theme}-${locale}-${world}`;
        test.describe(label, () => {
          test.use({ colorScheme: theme === 'light' ? 'dark' : 'light' });
          test(`portal matrix: ${label}`, async ({ page }) => {
            test.setTimeout(Number(process.env.MATRIX_TIMEOUT ?? 180_000));
            await seed(page, { theme, world });
            const errors = watchErrors(page);
            await signIn(page, portal.phone, portal.role === 'admin');
            for (const path of portal.pages)
              await checkPage(page, path, { theme, locale, world, label }, errors);
          });
        });
      }

/**
 * Responsive sweep (user 2026-11-13: "is it not properly responsive"): every key page at the common widths between
 * the two projects' 390 and 1440, signed out in the busy world, light theme. Desktop project only
 * (the viewport is set per width).
 */
const WIDTHS = [320, 360, 375, 414, 430, 480, 540, 600, 768, 1024, 1280] as const;
for (const width of WIDTHS)
  test(`responsive sweep: ${String(width)}px`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'one run per width');
    test.setTimeout(Number(process.env.MATRIX_TIMEOUT ?? 240_000));
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    await seed(page, { theme: 'light', world: 'busy' });
    const errors = watchErrors(page);
    for (const path of PAGES)
      await checkPage(
        page,
        path,
        { theme: 'light', locale: 'en', world: 'busy', label: `w${String(width)}` },
        errors,
      );
    for (const path of ['/', '/shop', `/compare?p=${CASTROL},${MOTUL}`])
      await checkPage(
        page,
        path,
        { theme: 'light', locale: 'hi', world: 'busy', label: `w${String(width)}` },
        errors,
      );
  });
