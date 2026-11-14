/**
 * Component state model of the UI state audit (2026-11-14, `docs/research/ui-testing-gap-2026-11-14.md`).
 *
 * Every interactive or visual component on the customer pages, the chrome and the partner/admin portals (demo
 * mode), with the dimensions that change how it renders and the values worth testing. `cases.ts` turns this into
 * checklist items (`docs/qa/ui-state-checklist.md`), one Playwright test each.
 *
 * Vocabulary the harness understands (`harness.ts` `setUp`): every state key below has a fixed meaning there.
 *   width     viewport width in CSS px (grid column counts change at 480/640/760/1024/1280)
 *   theme     light | dark (the system preference is set to the opposite, so a lost choice shows)
 *   locale    en | hi
 *   auth      out | customer | shop | workshop | admin (demo session seeded directly)
 *   world     empty | cart | busy (`fixtures/demo-world.ts`: orders, requests, quote, ticket, reviews)
 *   cart      none | c1 | c2 | c99 | mixed | many20 | below | max   (see CARTS)
 *   compare   none | lub-1 | lub-2 | lub-3 | lub-4 | bat-2 | bat-3 | tyr-2 | spa-2 | spa-3   (see COMPARES)
 *   stress    none | long-text | long-price | mixed-shape  (data-shape variants the demo catalogue lacks,
 *             applied to the rendered DOM: 70+ character names in en/hi, ₹1,00,000 prices, ratings and MRP
 *             removed from every other card)
 *   interaction  none | hover-dec | hover-inc | focus-dec | focus-inc | active-inc | disabled
 *   action    none | compare-other | start-new | add | inc | dec-remove  (clicked before measuring)
 *   consent   decided | open
 *   open      closed | first | all     (disclosures: FAQ, quick-details popover, assistant panel)
 *   form      clean | errors | filled  (submit empty to show every error; or fill every field)
 *   data      empty | one | limit | long   (the signed-in customer's saved vehicles and addresses: none, one, the limit
 *             of 10, and one with very long Hindi text; account sections only)
 *
 * Pure data plus `.ts` imports only (Node runs it for the checklist writer).
 */
import type { Param, Row, Valid } from './pairwise.ts';

export const WIDTHS = [320, 390, 480, 768, 1024, 1280, 1440, 1920] as const;
export const PHONE_WIDTHS = [320, 390, 480, 768] as const;
export const THEMES = ['light', 'dark'] as const;
export const LOCALES = ['en', 'hi'] as const;

export type Check =
  | 'present'
  | 'inside'
  | 'overlap'
  | 'covered'
  | 'clipped'
  | 'aligned'
  | 'tap'
  | 'hscroll'
  | 'focus'
  | 'console'
  | 'sync'
  | 'axe'
  | 'hindi';

/** What each check asserts (checklist header and failure messages). */
export const CHECK_TEXT: Readonly<Record<Check, string>> = {
  present: 'the component and its must-show content render',
  inside: 'every control and text line stays inside its card or container',
  overlap: 'no two controls or text lines overlap, also while each control is hovered and focused',
  covered: 'no control or text is painted over by another control (hover backgrounds included)',
  clipped: 'no text is clipped; ellipsis only where designed and never on prices or button labels',
  aligned: 'cards in a row are equal height with aligned action rows; table cells line up across columns',
  tap: 'every target is at least 24 px (or spaced); under 44 px is noted',
  hscroll: 'the page does not scroll sideways',
  focus: 'a visible, unclipped focus ring on every control reached by Tab',
  console: 'no console error, page error or failed request to our server',
  sync: 'controls agree with the stored state (compare pressed = in list, stepper = in cart, tray count)',
  axe: 'axe WCAG 2.2 AA on the component',
  hindi: 'on /hi no English outside the allowlist (test/hindi-allowlist.ts)',
};

export const BASE_CHECKS: readonly Check[] = [
  'present',
  'inside',
  'overlap',
  'covered',
  'clipped',
  'tap',
  'hscroll',
  'focus',
  'console',
];

export const PRODUCTS = {
  castrol: 'castrol-activ-4t-20w40-900ml',
  motul: 'motul-3100-4t-10w30-1l',
  shell: 'shell-advance-ax7-10w30-1l',
  hp: 'hp-racer4-20w40-900ml',
  synthetic: 'synthetic-engine-oil-5w30-3-5l',
  exide: 'exide-xltz4a-2w-battery',
  car45: 'car-starter-battery-45ah',
  hd90: 'heavy-duty-battery-90ah',
  scooterTyre: 'scooter-tubeless-tyre-90-90-12',
  carTyre: 'car-tyre-185-65-r15',
  brake: 'brake-pad-set-front',
  chain: 'chain-sprocket-kit-150cc',
  spark: 'spark-plug-iridium',
  evCharger: 'ev-portable-charger-15a',
  bearing6301: 'motorcycle-wheel-bearing-6301',
} as const;

/** Every demo product slug in catalogue order (`many20` cart; cross-checked by the unit test). */
export const ALL_PRODUCTS = [
  'castrol-activ-4t-20w40-900ml',
  'motul-3100-4t-10w30-1l',
  'shell-advance-ax7-10w30-1l',
  'hp-racer4-20w40-900ml',
  'exide-xltz4a-2w-battery',
  'scooter-tubeless-tyre-90-90-12',
  'car-tyre-185-65-r15',
  'car-starter-battery-45ah',
  'heavy-duty-battery-90ah',
  'synthetic-engine-oil-5w30-3-5l',
  'engine-oil-filter-petrol-car',
  'diesel-fuel-filter',
  'front-wheel-bearing-kit',
  'motorcycle-wheel-bearing-6301',
  'brake-pad-set-front',
  'chain-sprocket-kit-150cc',
  'spark-plug-iridium',
  'all-weather-car-floor-mats',
  'two-wheeler-body-cover',
  'socket-tool-set-46pc',
  'digital-tyre-pressure-gauge',
  'ev-12v-auxiliary-battery',
  'ev-portable-charger-15a',
] as const;

/** Cart contents by state value (`mechdost-cart` lines). */
export const CARTS: Readonly<Record<string, readonly { slug: string; qty: number }[]>> = {
  none: [],
  c1: [{ slug: PRODUCTS.castrol, qty: 1 }],
  c2: [{ slug: PRODUCTS.castrol, qty: 2 }],
  c99: [{ slug: PRODUCTS.castrol, qty: 99 }],
  // Partial in-cart: some cards show the stepper, their neighbours "Add to cart" (row alignment).
  mixed: [
    { slug: PRODUCTS.castrol, qty: 1 },
    { slug: PRODUCTS.motul, qty: 99 },
    { slug: PRODUCTS.exide, qty: 2 },
  ],
  many20: ALL_PRODUCTS.slice(0, 20).map((slug, i) => ({ slug, qty: (i % 3) + 1 })),
  // Below the free-delivery threshold (₹999): delivery fee line shows.
  below: [{ slug: PRODUCTS.bearing6301, qty: 1 }],
  // The largest totals the demo allows (99 × ₹12,500 = ₹12,37,500).
  max: [
    { slug: PRODUCTS.evCharger, qty: 99 },
    { slug: PRODUCTS.hd90, qty: 99 },
  ],
};

/** Compare list contents by state value (`mechdost-compare`). */
export const COMPARES: Readonly<Record<string, { category: string; slugs: readonly string[] } | null>> = {
  none: null,
  'lub-1': { category: 'lubricants', slugs: [PRODUCTS.castrol] },
  'lub-2': { category: 'lubricants', slugs: [PRODUCTS.castrol, PRODUCTS.motul] },
  'lub-3': { category: 'lubricants', slugs: [PRODUCTS.castrol, PRODUCTS.motul, PRODUCTS.synthetic] },
  'lub-4': {
    category: 'lubricants',
    slugs: [PRODUCTS.castrol, PRODUCTS.motul, PRODUCTS.shell, PRODUCTS.synthetic],
  },
  // Mixed shapes: Exide has an MRP and a saving; the 45 Ah has none; the 90 Ah is "confirmed on request".
  'bat-2': { category: 'batteries', slugs: [PRODUCTS.exide, PRODUCTS.car45] },
  'bat-3': { category: 'batteries', slugs: [PRODUCTS.exide, PRODUCTS.car45, PRODUCTS.hd90] },
  // Tyres: one with MRP + low stock, one without MRP.
  'tyr-2': { category: 'tyres', slugs: [PRODUCTS.carTyre, PRODUCTS.scooterTyre] },
  // Spare parts: no MRP anywhere.
  'spa-2': { category: 'spare-parts', slugs: [PRODUCTS.brake, PRODUCTS.chain] },
  'spa-3': { category: 'spare-parts', slugs: [PRODUCTS.brake, PRODUCTS.chain, PRODUCTS.spark] },
};

export type Strategy = 'cross' | 'pairwise';

export interface AlignSpec {
  /** Items whose rows must line up (cards in a grid, cells of a table row). */
  readonly items: string;
  /** Rows: siblings with the same top (cards) or the given row container (tables). */
  readonly row?: string;
}

export interface ComponentDef {
  /** Id prefix, e.g. `SHOP-CARD` → `SHOP-CARD-001`. */
  readonly code: string;
  readonly page: string;
  readonly component: string;
  /** Route in English (the harness adds `/hi`). May use `{compare}` (slugs of the compare state). */
  readonly path: string | ((row: Row) => string);
  /** CSS selector of the component root(s): the checks run inside it. */
  readonly scope: string;
  readonly strategy: Strategy;
  /** Parameters crossed in full (strategy `cross`); every other parameter is pairwise against them. */
  readonly cross?: readonly string[];
  readonly params: readonly Param[];
  readonly valid?: Valid;
  readonly checks?: readonly Check[];
  readonly align?: readonly AlignSpec[];
  /** Hover and focus every control in scope (up to this many) and re-run overlap/cover/inside each time. */
  readonly sweep?: number;
  /** Text that must be visible in the scope (empty pages pass every layout check). */
  readonly mustShow?: string;
  /** Rows that also run in the per-push CI subset. */
  readonly core?: (row: Row) => boolean;
  readonly note?: string;
}

const width: Param = { name: 'width', values: WIDTHS };
const phoneWidth: Param = { name: 'width', values: PHONE_WIDTHS };
const theme: Param = { name: 'theme', values: THEMES };
const locale: Param = { name: 'locale', values: LOCALES };
const authOutIn: Param = { name: 'auth', values: ['out', 'customer'] };
const world3: Param = { name: 'world', values: ['empty', 'cart', 'busy'] };
const world2: Param = { name: 'world', values: ['empty', 'busy'] };
const env = [width, theme, locale];

const coreAt =
  (widths: readonly number[], extra: (row: Row) => boolean = () => true) =>
  (row: Row) =>
    widths.includes(Number(row.width)) && extra(row);

const CARD_ALIGN: AlignSpec[] = [{ items: 'article' }];
const TABLE_ALIGN: AlignSpec[] = [
  { items: '[role="cell"], [role="columnheader"]', row: '[role="row"]' },
  { items: 'td, th', row: 'tr' },
];

/** Portal and admin routes in demo mode (one component each: the section's main content). */
const ADMIN_SECTIONS = [
  'overview',
  'orders',
  'services',
  'quotes',
  'applications',
  'partners',
  'catalogue',
  'customers',
  'reviews',
  'support',
  'coins',
  'content',
  'layout',
  'settings',
  'notifications',
] as const;

const ACCOUNT_SECTIONS = [
  'overview',
  'orders',
  'services',
  'quotes',
  'support',
  'coins',
  'vehicles',
  'addresses',
  'profile',
] as const;

const accountPath = (s: string) => (s === 'overview' ? '/account' : `/account/${s}`);
const adminPath = (s: string) => (s === 'overview' ? '/admin' : `/admin/${s}`);

export const COMPONENTS: readonly ComponentDef[] = [
  // ───────────────────────────── Chrome (every page) ─────────────────────────────
  {
    code: 'CHR-HEADER',
    page: 'Chrome',
    component: 'Header (brand, nav, search, language, theme, account, cart pill)',
    path: (r) => String(r.route),
    scope: 'header.sticky',
    strategy: 'cross',
    cross: ['width', 'auth'],
    params: [
      width,
      authOutIn,
      theme,
      locale,
      { name: 'cart', values: ['none', 'c1', 'many20'] },
      { name: 'route', values: ['/', '/shop', '/account'] },
    ],
    valid: (r) => !(r.route === '/account' && r.auth === 'out'),
    sweep: 16,
    core: coreAt([320, 390, 1024]),
  },
  {
    code: 'CHR-TABBAR',
    page: 'Chrome',
    component: 'Bottom tab bar (under 1024 px)',
    path: (r) => String(r.route),
    scope: 'nav.fixed',
    strategy: 'pairwise',
    params: [
      phoneWidth,
      theme,
      locale,
      authOutIn,
      { name: 'route', values: ['/', '/shop', '/workshops', '/account', '/cart'] },
      { name: 'cart', values: ['none', 'c1', 'many20'] },
    ],
    valid: (r) => !(r.route === '/account' && r.auth === 'out'),
    sweep: 8,
    core: coreAt([390]),
  },
  {
    code: 'CHR-FOOTER',
    page: 'Chrome',
    component: 'Footer (help, columns, privacy choices, theme)',
    path: '/',
    scope: 'footer',
    strategy: 'pairwise',
    params: [...env, authOutIn],
    sweep: 10,
  },
  {
    code: 'CHR-FLOAT',
    page: 'Chrome',
    component: 'Floating stack: assistant launcher, compare tray, consent banner, tab bar together',
    path: (r) => String(r.route),
    scope: 'body',
    strategy: 'cross',
    cross: ['width', 'consent'],
    params: [
      width,
      { name: 'consent', values: ['decided', 'open'] },
      { name: 'compare', values: ['none', 'lub-1', 'lub-4'] },
      { name: 'route', values: ['/shop', '/', `/shop/${PRODUCTS.castrol}`] },
      theme,
      locale,
    ],
    checks: ['present', 'overlap', 'covered', 'tap', 'hscroll', 'console'],
    sweep: 0,
    core: coreAt([320, 390], (r) => r.consent === 'open'),
    note: 'Fixed elements may cover page content; two fixed elements must never overlap each other.',
  },
  {
    code: 'CHR-ASSIST',
    page: 'Chrome',
    component: 'Assistant launcher and panel',
    path: '/',
    scope: '.assistant-launcher, [role="dialog"]',
    strategy: 'pairwise',
    params: [...env, { name: 'open', values: ['closed', 'first'] }],
    sweep: 8,
  },
  {
    code: 'CHR-CONSENT',
    page: 'Chrome',
    component: 'Cookie and consent banner',
    path: '/',
    scope: '[data-testid="consent-banner"]',
    strategy: 'pairwise',
    params: [...env, { name: 'consent', values: ['open'] }],
    sweep: 6,
    checks: [...BASE_CHECKS, 'axe'],
  },

  // ───────────────────────────── Home ─────────────────────────────
  ...(
    [
      ['HOME-HERO', 'Hero with search', 'section[aria-labelledby="hero-title"]'],
      ['HOME-TRUST', 'Trust strip', 'main section[aria-label]:not([aria-labelledby])'],
      ['HOME-CATS', 'Category tiles', 'section[aria-labelledby="categories-title"]'],
      ['HOME-RANGE', 'Product range (cards without compare)', 'section[aria-labelledby="range-title"]'],
      ['HOME-ROUTE', 'How an order travels (order route)', 'section[aria-labelledby="route-title"]'],
      ['HOME-SERVICE', 'Workshop service section', 'section[aria-labelledby="service-title"]'],
      ['HOME-WORKSHOPS', 'Top workshops', 'section[aria-labelledby="top-workshops"]'],
      ['HOME-PARTNER', 'Partner teaser', 'section[aria-labelledby="partners-teaser"]'],
    ] as const
  ).map(([code, component, scope]): ComponentDef => ({
    code,
    page: 'Home',
    component,
    path: '/',
    scope,
    strategy: 'pairwise',
    params: [...env, authOutIn, world3, { name: 'stress', values: ['none', 'long-text', 'long-price'] }],
    align: code === 'HOME-RANGE' ? CARD_ALIGN : undefined,
    sweep: 10,
    core: code === 'HOME-RANGE' ? coreAt([390, 1440]) : undefined,
  })),
  {
    code: 'HOME-FAQ',
    page: 'Home',
    component: 'FAQ (details/summary accordion)',
    path: '/',
    scope: 'section[aria-labelledby="faq-title"]',
    strategy: 'pairwise',
    params: [...env, { name: 'open', values: ['closed', 'first', 'all'] }],
    sweep: 8,
  },

  // ───────────────────────────── Shop listing ─────────────────────────────
  {
    code: 'SHOP-CARD',
    page: 'Shop (/shop)',
    component: 'Product card × compare list × cart (full cross)',
    path: '/shop',
    scope: 'main article',
    strategy: 'cross',
    cross: ['width', 'compare', 'cart'],
    params: [
      width,
      { name: 'compare', values: ['none', 'lub-1', 'lub-4', 'bat-2'] },
      { name: 'cart', values: ['none', 'c1', 'mixed', 'c99'] },
      theme,
      locale,
      authOutIn,
      { name: 'stress', values: ['none', 'long-text', 'long-price', 'mixed-shape'] },
    ],
    checks: [...BASE_CHECKS, 'aligned', 'sync'],
    align: CARD_ALIGN,
    sweep: 12,
    core: coreAt([390, 1440], (r) => r.compare === 'bat-2' || r.cart === 'mixed'),
    note: 'bat-2 on the all-products listing = mixed categories (user bug 1: category-B cards when the tray holds A).',
  },
  {
    code: 'SHOP-ACTION',
    page: 'Shop (/shop)',
    component: 'Card actions clicked, then every card re-checked (cross-entity sync)',
    path: '/shop',
    scope: 'main article',
    strategy: 'cross',
    cross: ['width', 'action'],
    params: [
      width,
      { name: 'action', values: ['compare-other', 'start-new', 'add', 'inc', 'dec-remove'] },
      { name: 'compare', values: ['bat-2'] },
      { name: 'cart', values: ['c2'] },
      theme,
      locale,
    ],
    checks: [...BASE_CHECKS, 'aligned', 'sync'],
    align: CARD_ALIGN,
    sweep: 6,
    core: coreAt([390], (r) => r.action === 'start-new' || r.action === 'compare-other'),
    note: 'compare-other: press Compare on a lubricant while the list holds batteries; start-new: then "Start a new comparison" (user bug 2).',
  },
  {
    code: 'SHOP-FILTERS',
    page: 'Shop (/shop)',
    component: 'Search, category chips, vehicle chips, sort, results count, empty result',
    path: (r) => String(r.route),
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      {
        name: 'route',
        values: [
          '/shop',
          '/shop?category=lubricants',
          '/shop?category=ev-essentials&sort=price_desc',
          '/shop?vehicle=2W&sort=price_asc',
          '/shop?q=battery&vehicle=4W',
          '/shop?q=zzzz-no-match',
        ],
      },
      { name: 'compare', values: ['none', 'lub-2'] },
    ],
    checks: [...BASE_CHECKS, 'aligned'],
    align: CARD_ALIGN,
    sweep: 14,
    core: coreAt([320]),
  },
  {
    code: 'SHOP-POPOVER',
    page: 'Shop (/shop)',
    component: 'Quick-details popover (ⓘ) on the first and the last card of a row',
    path: '/shop',
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, { name: 'open', values: ['first', 'last'] }],
    checks: ['present', 'inside', 'overlap', 'clipped', 'tap', 'hscroll', 'focus', 'console'],
    sweep: 4,
  },
  {
    code: 'SHOP-TRAY',
    page: 'Shop (/shop)',
    component: 'Compare tray (count, open, clear) over the listing',
    path: '/shop',
    scope: '[data-compare-tray]',
    strategy: 'cross',
    cross: ['width', 'compare'],
    params: [
      width,
      { name: 'compare', values: ['lub-1', 'lub-2', 'lub-4', 'spa-3'] },
      theme,
      locale,
      { name: 'consent', values: ['decided', 'open'] },
    ],
    checks: [...BASE_CHECKS, 'sync'],
    sweep: 6,
    core: coreAt([320, 1440], (r) => r.compare === 'lub-4'),
  },

  // ───────────────────────────── Product page ─────────────────────────────
  {
    code: 'PDP-BUYBOX',
    page: 'Product page (/shop/[slug])',
    component: 'Buy box: price, MRP and saving, stock, add to cart / stepper, compare',
    path: (r) => `/shop/${String(r.product)}`,
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      {
        name: 'product',
        values: [PRODUCTS.castrol, PRODUCTS.hd90, PRODUCTS.carTyre, PRODUCTS.evCharger, PRODUCTS.bearing6301],
      },
      { name: 'cart', values: ['none', 'c1', 'c99'] },
      { name: 'compare', values: ['none', 'lub-2', 'bat-3'] },
      { name: 'stress', values: ['none', 'long-text', 'long-price'] },
    ],
    checks: [...BASE_CHECKS, 'sync'],
    sweep: 12,
    core: coreAt([390, 1440], (r) => r.product === PRODUCTS.castrol),
    note: 'Products: in stock + MRP, confirmed on request without MRP, low stock, highest price (₹12,500), lowest (₹180).',
  },
  {
    code: 'PDP-REVIEWS',
    page: 'Product page (/shop/[slug])',
    component: 'Ratings summary, review list, write-a-review entry',
    path: (r) => `/shop/${String(r.product)}`,
    scope: 'section[aria-labelledby^="reviews-"]',
    strategy: 'pairwise',
    params: [...env, authOutIn, world2, { name: 'product', values: [PRODUCTS.castrol, PRODUCTS.spark] }],
    sweep: 8,
  },
  {
    code: 'PDP-RELATED',
    page: 'Product page (/shop/[slug])',
    component: 'Related products row (cards)',
    path: `/shop/${PRODUCTS.motul}`,
    scope: 'section[aria-labelledby="related"]',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'cart', values: ['none', 'mixed'] },
      { name: 'compare', values: ['none', 'bat-2'] },
    ],
    checks: [...BASE_CHECKS, 'aligned', 'sync'],
    align: CARD_ALIGN,
    sweep: 8,
  },

  // ───────────────────────────── Compare ─────────────────────────────
  {
    code: 'CMP-TABLE',
    page: 'Compare (/compare)',
    component: 'Comparison table × column count × badges × partial in-cart (full cross)',
    path: '/compare?p={compare}',
    scope: 'main',
    strategy: 'cross',
    cross: ['compare', 'cart', 'width'],
    params: [
      { name: 'compare', values: ['lub-2', 'lub-3', 'lub-4', 'bat-2', 'bat-3', 'tyr-2', 'spa-3'] },
      { name: 'cart', values: ['none', 'c1', 'mixed'] },
      { name: 'width', values: [320, 390, 768, 1024, 1440, 1920] },
      theme,
      locale,
      { name: 'stress', values: ['none', 'long-text'] },
    ],
    checks: [...BASE_CHECKS, 'aligned', 'sync'],
    align: TABLE_ALIGN,
    sweep: 10,
    core: coreAt([390, 1440], (r) => r.compare === 'bat-3' && r.cart === 'c1'),
    note: 'Only one column with a "Save" badge or in the cart is the user-reported misalignment (bug 4).',
  },
  {
    code: 'CMP-EMPTY',
    page: 'Compare (/compare)',
    component: 'Compare with one or no product (empty state and next action)',
    path: (r) => String(r.route),
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, { name: 'route', values: ['/compare', `/compare?p=${PRODUCTS.castrol}`] }],
  },

  // ───────────────────────────── Cart and checkout ─────────────────────────────
  {
    code: 'CART-LINES',
    page: 'Cart (/cart)',
    component: 'Cart lines (stepper, remove, line total) and summary',
    path: '/cart',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      authOutIn,
      { name: 'cart', values: ['c1', 'mixed', 'many20', 'below', 'max'] },
      { name: 'stress', values: ['none', 'long-text', 'long-price'] },
    ],
    checks: [...BASE_CHECKS, 'sync'],
    sweep: 14,
    core: coreAt([320, 1440]),
  },
  {
    code: 'CART-EMPTY',
    page: 'Cart (/cart)',
    component: 'Empty cart (one next action, category shortcuts)',
    path: '/cart',
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, authOutIn, { name: 'cart', values: ['none'] }],
    sweep: 8,
  },
  {
    code: 'CHK-FORM',
    page: 'Checkout (/checkout)',
    component: 'Checkout form (contact, address, business GSTIN, payment) and summary',
    path: '/checkout',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      authOutIn,
      { name: 'cart', values: ['c1', 'mixed', 'max'] },
      { name: 'form', values: ['clean', 'errors', 'filled'] },
    ],
    sweep: 16,
    core: coreAt([390], (r) => r.form === 'errors'),
  },

  // ───────────────────────────── Orders, service, quotes (customer, busy world) ─────────────────────────────
  {
    code: 'ORD-VIEW',
    page: 'Order (/orders/[code])',
    component: 'Order status, timeline, lines, delivery code, cancel/rate/support',
    path: (r) => `/orders/${String(r.order)}`,
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'order', values: ['MD-RPR-2026-HND001', 'MD-RPR-2026-HND002', 'MD-RPR-2026-HND003'] },
      { name: 'auth', values: ['customer'] },
      { name: 'world', values: ['busy'] },
    ],
    mustShow: 'MD-RPR-2026-HND',
    sweep: 12,
    core: coreAt([390], (r) => r.order === 'MD-RPR-2026-HND003'),
  },
  {
    code: 'SR-VIEW',
    page: 'Service request (/service/[code])',
    component: 'Request status, proposal, itemised estimate (per-line approval), bill',
    path: (r) => `/service/${String(r.request)}`,
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      {
        name: 'request',
        values: [
          'SR-RPR-2026-HND101',
          'SR-RPR-2026-HND102',
          'SR-RPR-2026-HND103',
          'SR-RPR-2026-HND104',
          'SR-RPR-2026-HND105',
        ],
      },
      { name: 'auth', values: ['customer'] },
      { name: 'world', values: ['busy'] },
    ],
    mustShow: 'SR-RPR-2026-HND',
    sweep: 14,
    core: coreAt([390], (r) => r.request === 'SR-RPR-2026-HND104'),
  },
  {
    code: 'QT-PAGES',
    page: 'Bulk quotes (/quotes)',
    component: 'Quote request form and quote thread',
    path: (r) => String(r.route),
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'route', values: ['/quotes/new', '/quotes/QT-RPR-2026-HND201'] },
      { name: 'auth', values: ['customer'] },
      { name: 'world', values: ['busy'] },
      { name: 'form', values: ['clean', 'errors'] },
    ],
    sweep: 12,
  },

  // ───────────────────────────── Account ─────────────────────────────
  ...ACCOUNT_SECTIONS.map((section): ComponentDef => ({
    code: `ACC-${section.toUpperCase()}`,
    page: 'Account (/account)',
    component: `Account section: ${section} (section bar + content)`,
    path: accountPath(section),
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['customer'] }, world2],
    sweep: 12,
    core: section === 'overview' || section === 'orders' ? coreAt([390]) : undefined,
  })),

  // Saved vehicles and addresses (design 2026-11-15): the lists at none / one / the limit of 10 / long Hindi text.
  ...(['vehicles', 'addresses'] as const).map((section): ComponentDef => ({
    code: `ACC-${section.toUpperCase()}-DATA`,
    page: 'Account (/account)',
    component: `Account ${section}: empty, one, at the limit of 10, long Hindi text`,
    path: accountPath(section),
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['customer'] },
      { name: 'data', values: ['empty', 'one', 'limit', 'long'] },
    ],
    sweep: 12,
    core: coreAt([390], (r) => r.data === 'limit' || r.data === 'long'),
  })),

  // ───────────────────────────── Workshops ─────────────────────────────
  {
    code: 'WS-FINDER',
    page: 'Workshops (/workshops)',
    component: 'Finder: PIN, vehicle, use my location, list cards, map toggle (map canvas excluded)',
    path: '/workshops',
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, authOutIn, { name: 'form', values: ['clean', 'filled'] }],
    checks: [...BASE_CHECKS, 'aligned'],
    align: [{ items: 'main ul > li' }],
    sweep: 14,
    core: coreAt([390]),
  },
  {
    code: 'WS-PROFILE',
    page: 'Workshop page (/workshops/[slug])',
    component: 'Workshop profile: services menu, reviews, booking form',
    path: (r) => `/workshops/${String(r.workshop)}`,
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      authOutIn,
      {
        name: 'workshop',
        values: ['telibandha-car-clinic', 'mowa-ev-and-bike-point', 'pachpedi-naka-two-wheeler-care'],
      },
      { name: 'form', values: ['clean', 'errors', 'filled'] },
    ],
    sweep: 16,
    core: coreAt([390], (r) => r.form === 'errors'),
  },

  // ───────────────────────────── Partners, support, login, policies ─────────────────────────────
  {
    code: 'PTN-LANDING',
    page: 'Partners (/partners)',
    component: 'Partner landing (kinds, benefits, apply links)',
    path: '/partners',
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, authOutIn],
    sweep: 10,
  },
  {
    code: 'PTN-APPLY',
    page: 'Partners (/partners/apply/[kind])',
    component: 'Application form (GSTIN, tick lists, location picker; map canvas excluded)',
    path: (r) => `/partners/apply/${String(r.kind)}`,
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'kind', values: ['seller', 'garage', 'mechanic'] },
      { name: 'form', values: ['clean', 'errors'] },
    ],
    sweep: 16,
    core: coreAt([390], (r) => r.kind === 'seller' && r.form === 'errors'),
  },
  {
    code: 'SUP-PAGE',
    page: 'Support (/support)',
    component: 'Support page and request form',
    path: '/support',
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, authOutIn, world2, { name: 'form', values: ['clean', 'errors'] }],
    sweep: 12,
  },
  {
    code: 'LOGIN-FORM',
    page: 'Sign in (/login)',
    component: 'Sign-in form (password, errors, show password)',
    path: '/login',
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, { name: 'form', values: ['clean', 'errors'] }],
    sweep: 10,
    checks: [...BASE_CHECKS, 'axe'],
  },
  {
    code: 'POL-PAGE',
    page: 'Policies',
    component: 'Policy pages (sections, anchors)',
    path: (r) => String(r.route),
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      {
        name: 'route',
        values: [
          '/policies/returns',
          '/policies/privacy',
          '/policies/delivery',
          '/terms',
          '/policies/company',
        ],
      },
    ],
    sweep: 6,
  },

  // ───────────────────────────── Partner portals and admin (demo) ─────────────────────────────
  {
    code: 'PRT-SHOP',
    page: 'Shop portal (/partner/shop)',
    component: 'Shop portal: offers with timer, accept/decline, orders, prices',
    path: '/partner/shop',
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['shop'] }, world2],
    sweep: 16,
    core: coreAt([390], (r) => r.world === 'busy'),
  },
  {
    code: 'PRT-WORKSHOP',
    page: 'Workshop portal (/partner/workshop)',
    component: 'Workshop portal: requests, proposal, estimate lines, bill',
    path: '/partner/workshop',
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['workshop'] }, world2],
    sweep: 16,
  },
  ...ADMIN_SECTIONS.map((section): ComponentDef => ({
    code: `ADM-${section.toUpperCase()}`,
    page: 'Admin console (/admin)',
    component: `Admin section: ${section} (section bar, tables, actions)`,
    path: adminPath(section),
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['admin'] }, world2],
    checks: [...BASE_CHECKS, 'aligned'],
    align: TABLE_ALIGN,
    sweep: 16,
    core: section === 'orders' ? coreAt([1440], (r) => r.world === 'busy') : undefined,
  })),
];

/**
 * The high-risk interaction cross: the quantity stepper on each surface × quantity × pointer/keyboard state ×
 * width. Kept apart from COMPONENTS because its rows are built from two crossed lists.
 */
export const STEPPER: ComponentDef = {
  code: 'STEP',
  page: 'Quantity stepper (card, product page, cart)',
  component: 'Stepper − / count / + × quantity × hover/focus/active/disabled (full cross)',
  path: (r) =>
    r.surface === 'card'
      ? '/shop?category=lubricants'
      : r.surface === 'pdp'
        ? `/shop/${PRODUCTS.castrol}`
        : '/cart',
  scope: 'main',
  strategy: 'cross',
  cross: ['surface', 'qty', 'interaction', 'width'],
  params: [
    { name: 'surface', values: ['card', 'pdp', 'cart'] },
    { name: 'qty', values: [1, 2, 99] },
    { name: 'interaction', values: ['hover-dec', 'hover-inc', 'focus-dec', 'focus-inc', 'active-inc'] },
    { name: 'width', values: [320, 390, 768, 1440] },
    theme,
    locale,
    { name: 'stress', values: ['none', 'long-price'] },
  ],
  checks: [
    'present',
    'inside',
    'overlap',
    'covered',
    'clipped',
    'tap',
    'hscroll',
    'focus',
    'console',
    'sync',
  ],
  sweep: 0,
  core: (r) =>
    Number(r.width) === 390 &&
    r.qty === 99 &&
    (r.interaction === 'hover-inc' || r.interaction === 'focus-dec'),
  note: 'User bug 3: the "+" hover background covered the count.',
};
