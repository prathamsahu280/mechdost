import { expect, test, type Page } from '@playwright/test';
import { DEMO_PRODUCTS } from '../src/demo/catalogue';
import type {
  CartLine,
  DemoApplication,
  DemoOrder,
  DemoQuote,
  DemoReview,
  DemoServiceRequest,
} from '../src/demo/store';
import { DEMO_WORKSHOPS } from '../src/demo/workshops';
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

const CODES = {
  routing: 'MD-RPR-2026-HND001',
  offered: 'MD-RPR-2026-HND002',
  shipped: 'MD-RPR-2026-HND003',
  fresh: 'SR-RPR-2026-HND101',
  proposed: 'SR-RPR-2026-HND102',
  declined: 'SR-RPR-2026-HND103',
  quote: 'QT-RPR-2026-HND201',
  application: 'PA-RPR-2026-HND301',
};

/** Representative records, stored exactly as the demo store writes them (English snapshots, typed text). */
function seedData(now: number) {
  const iso = (offsetMin: number) => new Date(now + offsetMin * 60_000).toISOString();
  const customer = {
    name: 'Ravi Sahu',
    phone: '9876543210',
    address: 'C-605 Salasar Greens, Sarona',
    pincode: '492099',
  };
  const line = (slug: string, qty: number) => {
    const p = DEMO_PRODUCTS.find((x) => x.slug === slug);
    if (!p) throw new Error(`unknown product ${slug}`);
    return { slug, name: p.name, brand: p.brand, qty, unitPaise: p.pricePaise };
  };
  const order = (code: string, lines: DemoOrder['lines'], extra: Partial<DemoOrder>): DemoOrder => {
    const subtotalPaise = lines.reduce((s, l) => s + l.unitPaise * l.qty, 0);
    return {
      code,
      createdAt: iso(-90),
      lines,
      subtotalPaise,
      deliveryPaise: 0,
      totalPaise: subtotalPaise,
      customer,
      payment: 'cod',
      stage: 1,
      ...extra,
    };
  };
  const orders: DemoOrder[] = [
    order(
      CODES.routing,
      [line('engine-oil-filter-petrol-car', 2), line('synthetic-engine-oil-5w30-3-5l', 1)],
      {
        declined: [{ slug: 'gupta-lubes-spares', reason: 'out_of_stock', at: iso(-60) }],
      },
    ),
    order(CODES.offered, [line('brake-pad-set-front', 1)], {
      shop: { slug: 'sharma-auto-parts', status: 'offered', offeredAt: iso(-5), expiresAt: iso(24 * 60) },
    }),
    order(CODES.shipped, [line('front-wheel-bearing-kit', 1), line('castrol-activ-4t-20w40-900ml', 2)], {
      stage: 4,
      shop: { slug: 'sharma-auto-parts', status: 'accepted', offeredAt: iso(-80), expiresAt: iso(-65) },
      delivery: { code: '4821', attempts: 0, confirmedAt: null, method: null },
    }),
  ];
  const workshop = DEMO_WORKSHOPS.find((w) => w.slug === 'telibandha-car-clinic');
  if (!workshop) throw new Error('missing workshop');
  const services = workshop.services
    .slice(0, 2)
    .map((s) => ({ key: s.key, name: s.name, minPaise: s.minPaise, maxPaise: s.maxPaise }));
  const request = (code: string, extra: Partial<DemoServiceRequest>): DemoServiceRequest => ({
    code,
    createdAt: iso(-120),
    workshopSlug: workshop.slug,
    workshopName: workshop.name,
    vehicleType: '4W',
    vehicle: 'Maruti Suzuki Swift VXi',
    services,
    date: iso(2 * 24 * 60).slice(0, 10),
    slot: 'morning',
    concern: 'Brakes squeal when I stop at signals.',
    customer: { name: customer.name, phone: customer.phone },
    stage: 0,
    ...extra,
  });
  const requests: DemoServiceRequest[] = [
    request(CODES.fresh, {}),
    request(CODES.proposed, {
      stage: 1,
      proposal: {
        date: iso(3 * 24 * 60).slice(0, 10),
        slot: 'afternoon',
        minPaise: 250_000,
        maxPaise: 400_000,
        note: 'Bring the service book, please.',
      },
    }),
    request(CODES.declined, { declinedBy: [workshop.slug] }),
  ];
  const quote: DemoQuote = {
    code: CODES.quote,
    createdAt: iso(-200),
    customer: { name: customer.name, phone: customer.phone },
    pincode: '492099',
    lines: [line('car-starter-battery-45ah', 12), line('engine-oil-filter-petrol-car', 20)].map((l) => ({
      slug: l.slug,
      name: l.name,
      brand: l.brand,
      qty: l.qty,
      listPaise: l.unitPaise,
    })),
    status: 'offered',
    messages: [
      { id: 'm1', from: 'customer', text: 'We run a fleet of taxis. Best price please.', at: iso(-200) },
      { id: 'm2', from: 'admin', text: 'Sure, sending an offer today.', at: iso(-150) },
    ],
    offers: [
      {
        version: 1,
        lines: [
          { slug: 'car-starter-battery-45ah', unitPaise: 490_000 },
          { slug: 'engine-oil-filter-petrol-car', unitPaise: 39_000 },
        ],
        deliveryPaise: 0,
        totalPaise: 12 * 490_000 + 20 * 39_000,
        validUntil: iso(3 * 24 * 60),
        note: 'Delivery in two batches.',
        at: iso(-140),
      },
    ],
    orderCode: null,
  };
  const application: DemoApplication = {
    code: CODES.application,
    createdAt: iso(-300),
    kind: 'seller',
    name: 'Rakesh Sharma',
    phone: '9000000001',
    business: 'Sharma Auto Parts',
    pincode: '492004',
    vehicles: ['2W', '4W'],
    details: 'Spare parts shop since 1998, two delivery bikes.',
    stage: 1,
    rejected: false,
  };
  const review: DemoReview = {
    id: 'rev-hindi-gate',
    createdAt: iso(-30),
    target: 'workshop',
    slug: 'telibandha-car-clinic',
    name: 'Ravi Sahu',
    rating: 4,
    title: 'Good work',
    body: 'Fixed the AC quickly and explained the bill.',
    status: 'pending',
  };
  const cart: CartLine[] = [
    { slug: 'exide-xltz4a-2w-battery', qty: 1 },
    { slug: 'scooter-tubeless-tyre-90-90-12', qty: 2 },
  ];
  return {
    'mechdost-demo-orders': orders,
    'mechdost-demo-requests': requests,
    'mechdost-demo-quotes': [quote],
    'mechdost-demo-applications': [application],
    'mechdost-demo-reviews': [review],
    'mechdost-cart': cart,
  };
}

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
    await page.getByRole('button', { name: 'Verify and continue' }).click();
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
  [`/orders/${CODES.shipped}`]: '4821',
  [`/service/${CODES.proposed}`]: 'तेलीबांधा कार क्लिनिक',
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
      // Open one workshop row (its expanded panel is text too), then its map popup via "show on map".
      await page.locator('article button[aria-expanded]').first().click();
      await page.locator('article [role="region"] button').first().click();
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
  '/shop?q=बैटरी',
  '/workshops',
  '/cart',
  '/checkout',
  '/login',
  '/quotes/new',
  '/policies/returns',
  '/policies/privacy',
  '/policies/delivery',
  '/policies/service-terms',
  '/policies/company',
  '/partners',
  '/partners/apply/seller',
  '/partners/apply/garage',
  '/partners/apply/mechanic',
  `/partners/applications/${CODES.application}`,
  '/account',
  '/admin',
  '/partner/shop',
  '/partner/workshop',
  '/no-such-page',
  ...DEMO_PRODUCTS.map((p) => `/shop/${p.slug}`),
  ...DEMO_WORKSHOPS.map((w) => `/workshops/${w.slug}`),
];

const CUSTOMER_PAGES = [
  ...ACCOUNT_SECTIONS.map((s) => (s === 'overview' ? '/account' : `/account/${s}`)),
  '/cart',
  '/checkout',
  `/orders/${CODES.shipped}`,
  `/orders/${CODES.routing}`,
  `/service/${CODES.proposed}`,
  `/quotes/${CODES.quote}`,
  '/quotes/new',
];

const ADMIN_PAGES = ADMIN_SECTIONS.map((s) => (s === 'overview' ? '/admin' : `/admin/${s}`));

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

  test('admin console', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, PHONES.admin);
    const failures = await audit(page, ADMIN_PAGES, true);
    expect(failures, report(failures)).toEqual([]);
  });
});
