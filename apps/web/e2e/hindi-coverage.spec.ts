import { expect, test, type Page } from '@playwright/test';
import { DEMO_PRODUCTS } from '../src/demo/catalogue';
import { DEMO_WORKSHOPS } from '../src/demo/workshops';
import { CODES, seedData } from './fixtures/demo-world';
import { DELIVERY_CODES, DELIVERY_JOB_IDS, deliveryWorld } from './fixtures/delivery-world';
import { ACCOUNT_SECTIONS, ADMIN_SECTIONS } from '../src/lib/sections';
import { latinOffenders } from '../test/hindi-allowlist';

/**
 * HINDI COVERAGE GATE (CLAUDE.md hard rule 10; user 2026-11-02: "its in hindi but i still see quite some stuff in
 * english … it shouldnt happen anywhere … have it properly checked from now on").
 *
 * Every `/hi` page — public, customer, shop, workshop and admin — is rendered with representative demo data, and
 * every visible text node plus `aria-label`, `placeholder`, `title`, `alt`, `<option>` text and the document title
 * is checked: a Latin-script word of 3+ letters fails the page unless it is on the documented allowlist
 * (`test/hindi-allowlist.ts`: brands, models, units, technical tokens, codes, MechDost, people's names).
 * Text people typed is marked `data-user-content` and skipped, as is text declared in another language with
 * `lang` (the language switcher's "English", the English column of the admin's bilingual editor). Map tile labels are canvas pixels this test cannot
 * read; `test/map-styles.test.ts` gates them. External requests are blocked: no map tiles, no third parties.
 *
 * A failure lists each page and its English words, so the next person knows exactly what to translate.
 */

const DEMO_PASSWORD = 'Raipur@2026';
const PHONES = { customer: '9876543210', shop: '9000000001', workshop: '9000000002', admin: '9000000003' };

/** Collects what a person sees or hears on the page, minus user-typed text and licence credits. */
function collectVisibleText(): string[] {
  const skip = '[data-user-content], .maplibregl-ctrl-attrib, script, style, noscript, template';
  const visible = (el: Element) => el.checkVisibility({ visibilityProperty: true });
  // Text declared in another language (`lang="en"`): the language switcher's "English", the English column of
  // the admin's bilingual content editor. Everything else inherits `<html lang="hi">`.
  const foreign = (el: Element) => {
    const declared = el.closest('[lang]');
    return (
      declared !== null &&
      declared !== document.documentElement &&
      !declared.getAttribute('lang')?.startsWith('hi')
    );
  };
  const out: string[] = [document.title];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    const text = node.textContent?.trim();
    if (!el || !text || el.closest(skip) || foreign(el)) continue;
    const select = el.closest('select');
    if (select ? !visible(select) : !visible(el)) continue;
    out.push(text);
  }
  for (const el of document.body.querySelectorAll('[aria-label], [placeholder], [title], img[alt]')) {
    if (el.closest(skip) || foreign(el) || !visible(el)) continue;
    for (const attr of ['aria-label', 'placeholder', 'title', 'alt']) {
      const value = el.getAttribute(attr);
      if (value) out.push(value);
    }
  }
  return out;
}

async function prepare(page: Page) {
  // Never call external services (map styles/tiles, imagery, fonts from CDNs): only our own server.
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const data = seedData(Date.now());
  await page.addInitScript((seed: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(seed)) {
      if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, JSON.stringify(value));
    }
  }, data);
}

async function signIn(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (phone === PHONES.admin) {
    await page.getByLabel('One-time code').fill('123456');
  }
  await expect(page).not.toHaveURL(/\/login/);
}

const hi = (path: string) => (path === '/' ? '/hi' : `/hi${path}`);

/** Proof that the seeded records are on screen before the page is judged (an empty state proves nothing). */
const MUST_SHOW: Readonly<Record<string, string>> = {
  '/account/orders': CODES.shipped,
  '/account/services': CODES.proposed,
  '/account/quotes': CODES.quote,
  '/account/coins': '250',
  // Account → Refunds (spec 05, 2026-11-23): the demo's sample refunds, with a Razorpay reference.
  '/account/refunds': 'rfnd_DemoSent0001',
  [`/orders/${CODES.shipped}`]: '4821',
  [`/service/${CODES.proposed}`]: 'तेलीबांधा कार क्लिनिक',
  [`/service/${CODES.estimate}`]: 'मेरी पसंद पक्की करें',
  [`/service/${CODES.billed}`]: 'एसजीएसटी 9%',
  [`/quotes/${CODES.quote}`]: 'कार स्टार्टर बैटरी 45 Ah',
  '/cart': 'ट्यूबलेस स्कूटर टायर 90/90-12',
  '/partner/shop': CODES.offered,
  '/partner/workshop': CODES.fresh,
  '/admin/orders': CODES.routing,
  '/admin/services': CODES.declined,
  '/admin/quotes': CODES.quote,
  '/admin/applications': CODES.application,
  '/admin/reviews': 'Good work',
  '/admin/partners': 'शर्मा ऑटो पार्ट्स',
  '/ustaad/q/UQ-RPR-2026-K7QM2D': 'Splendor Plus',
  '/ustaad/jobs': 'शंकर नगर',
  '/ustaad/u/suresh_auto': 'सुरेश वर्मा',
  '/ustaad/tags/splendor': '#स्प्लेंडर',
  '/ustaad/messages': 'सुरेश वर्मा',
  '/ustaad/messages/0193a000-0000-7000-8000-000000000301': 'Splendor ka self',
  '/ustaad/network?tab=requests': 'राजू निषाद',
  '/ustaad/discover': 'तेलीबांधा',
  // Delivery agents (spec 24), with the delivery world seeded.
  '/partner/delivery/jobs': DELIVERY_CODES.pickedUp,
  [`/partner/delivery/jobs/${DELIVERY_JOB_IDS.pickedUp}`]: 'Ravi Sahu',
  '/partner/shop?mode=agents': DELIVERY_CODES.ready,
  [`/orders/${DELIVERY_CODES.pickedUp}`]: 'Sunil',
  [`/orders/${DELIVERY_CODES.returned}`]: DELIVERY_CODES.returned,
  '/admin/delivery?seeded=1': DELIVERY_CODES.ready,
};

/** Visits each page and returns "page: words" for every page with English left on it. */
async function audit(page: Page, paths: readonly string[], signedIn: boolean): Promise<string[]> {
  const failures: string[] = [];
  for (const path of paths) {
    const url = hi(path);
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1').first(), url).toBeVisible();
    if (signedIn) await expect(page.locator('header [data-user-content]').first(), url).toBeAttached();
    const proof = MUST_SHOW[path];
    if (signedIn && proof) await expect(page.getByText(proof).first(), url).toBeVisible();
    if (path === '/workshops') {
      // Open one map popup (its title, rating, detail and buttons are text too).
      await page.locator('article button[aria-pressed]').first().click();
      await expect(page.locator('.maplibregl-popup').first(), url).toBeVisible();
    }
    const words = latinOffenders((await page.evaluate(collectVisibleText)).join('\n'));
    if (words.length > 0) failures.push(`${url}: ${words.join(', ')}`);
  }
  return failures;
}

const PUBLIC_PAGES = [
  '/',
  '/shop',
  '/shop?category=batteries',
  '/shop?segment=two_wheeler', // the Kind of vehicle chips, the shop's only vehicle filter (2026-11-26)
  '/shop?q=बैटरी',
  '/workshops',
  '/offers',
  '/cart',
  '/checkout',
  '/login',
  '/auth/action',
  '/quotes/new',
  '/policies/returns',
  '/policies/privacy',
  '/terms',
  '/policies/delivery',
  '/policies/community-rules',
  '/policies/service-terms',
  '/policies/company',
  '/partners',
  '/partners/apply/seller',
  '/partners/apply/garage',
  '/partners/apply/mechanic',
  '/partners/invite/not-a-real-invite',
  // Delivery agents (spec 24): the short apply form and an invite link that is not valid.
  '/partners/apply/delivery_agent',
  '/partners/delivery-invite/0000000000000000000000000000000000000000',
  `/partners/applications/${CODES.application}`,
  '/account',
  '/admin',
  '/partner/shop',
  '/partner/workshop',
  '/no-such-page',
  // Comparisons with products (design 2026-11-13): attribute labels and translated values are on screen.
  '/compare',
  '/compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,hp-racer4-20w40-900ml',
  '/compare?p=exide-xltz4a-2w-battery,car-starter-battery-45ah',
  '/compare?p=scooter-tubeless-tyre-90-90-12,car-tyre-185-65-r15',
  ...DEMO_PRODUCTS.map((p) => `/shop/${p.slug}`),
  ...DEMO_WORKSHOPS.map((w) => `/workshops/${w.slug}`),
];

const CUSTOMER_PAGES = [
  ...ACCOUNT_SECTIONS.map((s) => (s === 'overview' ? '/account' : `/account/${s}`)),
  '/cart',
  '/checkout',
  '/roadside',
  `/orders/${CODES.shipped}`,
  `/orders/${CODES.routing}`,
  `/service/${CODES.proposed}`,
  `/service/${CODES.estimate}`,
  `/service/${CODES.billed}`,
  `/quotes/${CODES.quote}`,
  '/quotes/new',
];

// The Ustaad Network shell is shown to staff during the preview (spec 23, 2026-11-26).
const ADMIN_PAGES = [
  ...ADMIN_SECTIONS.map((s) => (s === 'overview' ? '/admin' : `/admin/${s}`)),
  '/ustaad',
  '/ustaad/me',
  '/ustaad/welcome',
  '/ustaad/join',
];
// Ustaad Q&A, Learn and local screens (workstreams C and E) with the browser demo's sample data.
const USTAAD_PAGES = [
  '/ustaad/ask',
  '/ustaad/ask?filter=mine',
  '/ustaad/ask/new',
  '/ustaad/q/UQ-RPR-2026-K7QM2D',
  '/ustaad/learn',
  '/ustaad/me/location',
  // QA batch A (SIM-P19): the member's standing page (demo member is in good standing).
  '/ustaad/me/standing',
  '/ustaad/area',
  '/ustaad/jobs',
  '/ustaad/jobs/UJ-RPR-2026-Q4MZ7A',
  '/ustaad/jobs/new',
  // Feed and social screens (workstream D web).
  '/ustaad?tab=following',
  '/ustaad/create',
  '/ustaad/create?story=1',
  '/ustaad/p/0193a000-0000-7000-8000-000000001001',
  '/ustaad/saved',
  '/ustaad/tags/splendor',
  '/ustaad/u/suresh_auto',
  '/ustaad/s/aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb',
];
// Ustaad messages, My network and Discover (workstream D2 web) with the browser demo's sample data.
const USTAAD_DM_PAGES = [
  '/ustaad/messages',
  '/ustaad/messages?box=requests',
  '/ustaad/messages?box=sent',
  '/ustaad/messages/0193a000-0000-7000-8000-000000000301',
  '/ustaad/messages/0193a000-0000-7000-8000-000000000303',
  '/ustaad/messages?to=raju_chhotu',
  '/ustaad/network',
  '/ustaad/network?tab=requests',
  '/ustaad/network?tab=blocked',
  '/ustaad/discover',
  '/ustaad/discover?work=ac',
];

/** Delivery agents (spec 24): the delivery world on top of the busy world (orders merged once per browser). */
async function prepareDelivery(page: Page) {
  const world = deliveryWorld(Date.now());
  await page.addInitScript((data: Record<string, unknown>) => {
    if (window.localStorage.getItem('mechdost-demo-delivery') !== null) return;
    for (const [key, value] of Object.entries(data)) window.localStorage.setItem(key, JSON.stringify(value));
  }, world);
}
const AGENT_PAGES = [
  '/partner/delivery',
  '/partner/delivery/jobs',
  `/partner/delivery/jobs/${DELIVERY_JOB_IDS.pickedUp}`,
  `/partner/delivery/jobs/${DELIVERY_JOB_IDS.returned}`,
  '/partner/delivery/history',
  '/partner/delivery/profile',
];

const report = (failures: string[]) =>
  `English text on Hindi pages — translate it (or mark user-typed text with data-user-content):\n${failures.join('\n')}`;

test.describe('Hindi pages have no English left (hard rule 10)', () => {
  test.describe.configure({ mode: 'parallel' });
  test.beforeEach(async ({ page }) => {
    await prepare(page);
  });

  test('public pages', async ({ page }) => {
    test.setTimeout(300_000);
    const failures = await audit(page, PUBLIC_PAGES, false);
    expect(failures, report(failures)).toEqual([]);
  });

  test('customer pages', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, PHONES.customer);
    const failures = await audit(page, CUSTOMER_PAGES, true);
    expect(failures, report(failures)).toEqual([]);
  });

  test('shop portal', async ({ page }) => {
    await signIn(page, PHONES.shop);
    const failures = await audit(page, ['/partner/shop'], true);
    expect(failures, report(failures)).toEqual([]);
  });

  test('workshop portal', async ({ page }) => {
    await signIn(page, PHONES.workshop);
    const failures = await audit(page, ['/partner/workshop'], true);
    expect(failures, report(failures)).toEqual([]);
  });

  test('Ustaad Q&A, Learn, pin, area and jobs (staff preview)', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, PHONES.admin);
    const failures = await audit(page, USTAAD_PAGES, true);
    expect(failures, report(failures)).toEqual([]);
  });

  test('Ustaad messages, My network and Discover (staff preview)', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, PHONES.admin);
    const failures = await audit(page, USTAAD_DM_PAGES, true);
    expect(failures, report(failures)).toEqual([]);
  });

  test('delivery agent portal', async ({ page }) => {
    test.setTimeout(180_000);
    await prepareDelivery(page);
    await signIn(page, '9000000005');
    const failures = await audit(page, AGENT_PAGES, true);
    expect(failures, report(failures)).toEqual([]);
  });

  test('delivery: agent-mode shop, customer and admin screens', async ({ page }) => {
    test.setTimeout(180_000);
    await prepareDelivery(page);
    await signIn(page, '9000000006');
    const shop = await audit(page, ['/partner/shop?mode=agents'], true);
    await page.evaluate(() => {
      window.localStorage.setItem(
        'mechdost-demo-session',
        JSON.stringify([{ accountId: 'demo-customer', signedInAt: new Date().toISOString() }]),
      );
    });
    const customer = await audit(
      page,
      [`/orders/${DELIVERY_CODES.pickedUp}`, `/orders/${DELIVERY_CODES.returned}`],
      true,
    );
    await page.evaluate(() => {
      window.localStorage.setItem(
        'mechdost-demo-session',
        JSON.stringify([{ accountId: 'demo-admin', signedInAt: new Date().toISOString() }]),
      );
    });
    const admin = await audit(page, ['/admin/delivery?seeded=1'], true);
    const failures = [...shop, ...customer, ...admin];
    expect(failures, report(failures)).toEqual([]);
  });

  test('admin console', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, PHONES.admin);
    const failures = await audit(page, ADMIN_PAGES, true);
    expect(failures, report(failures)).toEqual([]);
  });
});
