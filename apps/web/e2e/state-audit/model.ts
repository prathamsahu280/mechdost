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
 *   auth      out | customer | shop | workshop | admin | agent | agentshop (demo session seeded directly;
 *             agent = delivery agent Sunil, agentshop = Gupta Lubes & Spares in agents mode, spec 24)
 *   world     empty | cart | busy | delivery (`fixtures/demo-world.ts`: orders, requests, quote, ticket, reviews;
 *             delivery = busy + `fixtures/delivery-world.ts`: agent jobs picked up, ready, returned)
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
 *   trust     default | override | long | hidden   (trust lines, design 2026-11-15: the locale-file text; a short
 *             admin wording; 140-character English/Hindi wording; every line hidden with "-". Seeds the demo site config)
 *   promise   off | on     (labour promise, Q105: off, or 30 days on workshop pages and the bill)
 *   data      empty | one | limit | long   (the signed-in customer's saved vehicles and addresses: none, one, the limit
 *             of 10, and one with very long Hindi text; account sections only)
 *
 * Pure data plus `.ts` imports only (Node runs it for the checklist writer).
 */
import type { Param, Row, Valid } from './pairwise.ts';

/** The content keys of the trust lines (`packages/shared/src/content.ts`; `test/state-audit-trust.test.ts` keeps them in sync). */
export const TRUST_KEYS = [
  'trust.homeGenuine',
  'trust.homeBill',
  'trust.homeEstimates',
  'trust.product',
  'trust.checkout',
  'trust.emailFooter',
  'trust.workshop',
  'trust.partner',
] as const;
export const TRUST_STATES = ['default', 'override', 'long', 'hidden'] as const;
export const PROMISE_STATES = ['off', 'on'] as const;

export const WIDTHS = [320, 390, 480, 768, 1024, 1280, 1440, 1920] as const;
export const PHONE_WIDTHS = [320, 390, 480, 768] as const;
export const THEMES = ['light', 'dark'] as const;
export const LOCALES = ['en', 'hi'] as const;

export type Check =
  | 'present'
  | 'inside'
  | 'overlap'
  | 'covered'
  | 'launcher'
  | 'clipped'
  | 'aligned'
  | 'tap'
  | 'hscroll'
  | 'offphoto'
  | 'scroll'
  | 'adminhead'
  | 'focus'
  | 'console'
  | 'sync'
  | 'axe'
  | 'hindi'
  | 'nav'
  | 'dismiss';

/** What each check asserts (checklist header and failure messages). */
export const CHECK_TEXT: Readonly<Record<Check, string>> = {
  present: 'the component and its must-show content render',
  inside: 'every control and text line stays inside its card or container',
  overlap: 'no two controls or text lines overlap, also while each control is hovered and focused',
  covered: 'no control or text is painted over by another control (hover backgrounds included)',
  launcher:
    'the floating assistant button never sits over a price or a control (it may cover plain text only)',
  clipped: 'no text is clipped; ellipsis only where designed and never on prices or button labels',
  aligned: 'cards in a row are equal height with aligned action rows; table cells line up across columns',
  tap: 'every target is at least 24 px (or spaced); under 44 px is noted',
  hscroll: 'the page does not scroll sideways',
  offphoto: 'the round buttons (info, save) of a card never sit on the product picture',
  scroll:
    'the page is the only vertical scroller (side bar and text boxes marked data-scroll excepted); the side bar stays in view under the header after scrolling; never two tall columns stuck at once',
  adminhead:
    'admin page pattern: one header (title = the current side bar item, one-line description), status badges 12 px or more and never clipped, empty states with at most one action, tables only scroll inside their own box',
  focus: 'a visible, unclipped focus ring on every control reached by Tab',
  console: 'no console error, page error or failed request to our server',
  sync: 'controls agree with the stored state (compare pressed = in list, stepper = in cart, tray count)',
  axe: 'axe WCAG 2.2 AA on the component',
  hindi: 'on /hi no English outside the allowlist (test/hindi-allowlist.ts)',
  dismiss:
    'every button-opened panel has a visible close control (44 px), Escape closes it and focus returns to the opener (e2e/state-audit/dismiss.ts)',
  nav: 'navigation: one current marker where the route is a nav target, the current item in view, and with walk=yes every item opens a page with its heading (no 404, no wrong landing)',
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
  'mrf-steel-muscle-1000r20-truck-tyre',
  'apollo-endurace-lt-700r16-tyre',
  'ceat-earthmax-175-25-otr-tyre',
  'exide-xpress-hd-180ah-truck-battery',
  'amaron-pro-tractor-88ah-battery',
  'servo-agri-super-15w40-7l',
  'exide-inva-master-150ah-inverter-battery',
] as const;

/** Cart contents by state value (`mechdost-cart` lines). */
/** Sizes of the demo tyre (user 2026-11-24): the first is in stock, the third has no stock (selectable, marked). */
export const TYRE_SIZES = {
  first: 'TYR-PC-1756514',
  second: 'TYR-PC-1856515',
  out: 'TYR-PC-1955516',
} as const;

export const CARTS: Readonly<Record<string, readonly { slug: string; qty: number; sku?: string }[]>> = {
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
  // Two sizes of one product are two lines (user 2026-11-24).
  sizes2: [
    { slug: PRODUCTS.carTyre, qty: 1, sku: TYRE_SIZES.first },
    { slug: PRODUCTS.carTyre, qty: 2, sku: TYRE_SIZES.second },
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
  /**
   * Rendered only with real sign-in and the API (no demo version): the demo harness cannot drive it, so its tests are
   * `test.fixme` until a real-API harness (mocked API answers) exists. The checklist still lists every combination.
   */
  readonly realApi?: boolean;
  /**
   * Navigation surface (check `nav`): `bar` = a nav bar whose current item carries aria-current; `links` = links
   * with no current marker (footer, filter chips), where only the walk (`walk=yes`) applies.
   */
  readonly nav?: 'bar' | 'links';
}

export const width: Param = { name: 'width', values: WIDTHS };
const phoneWidth: Param = { name: 'width', values: PHONE_WIDTHS };
export const theme: Param = { name: 'theme', values: THEMES };
export const locale: Param = { name: 'locale', values: LOCALES };
export const authOutIn: Param = { name: 'auth', values: ['out', 'customer'] };
const world3: Param = { name: 'world', values: ['empty', 'cart', 'busy'] };
export const world2: Param = { name: 'world', values: ['empty', 'busy'] };
export const env = [width, theme, locale];

export const coreAt =
  (widths: readonly number[], extra: (row: Row) => boolean = () => true) =>
  (row: Row) =>
    widths.includes(Number(row.width)) && extra(row);

const CARD_ALIGN: AlignSpec[] = [{ items: 'article' }];
export const TABLE_ALIGN: AlignSpec[] = [
  { items: '[role="cell"], [role="columnheader"]', row: '[role="row"]' },
  { items: 'td, th', row: 'tr' },
];

/** Portal and admin routes in demo mode (one component each: the section's main content). */
export const ADMIN_SECTIONS = [
  'overview',
  'orders',
  'services',
  'roadside',
  'delivery',
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

export const ACCOUNT_SECTIONS = [
  'overview',
  'orders',
  'refunds',
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

const walk: Param = { name: 'walk', values: ['no', 'yes'] };
const NAV_CHECKS: readonly Check[] = [...BASE_CHECKS, 'nav'];
/** Header and tab bar routes: the four primary destinations, a page that is not a nav target, and each portal. */
const PRIMARY_ROUTES = [
  '/',
  '/shop',
  '/workshops',
  '/account/vehicles',
  '/roadside',
  '/cart',
  '/policies/returns',
];
const roleRoute = (r: Row) =>
  (r.route !== '/account/vehicles' || r.auth === 'customer') &&
  (r.route !== '/partner/shop' || r.auth === 'shop') &&
  (r.route !== '/partner/workshop' || r.auth === 'workshop') &&
  (r.route !== '/admin' || r.auth === 'admin');

/**
 * Navigation (user 2026-11-15: "update the states render test for the navigation too"): every bar a visitor or a
 * partner uses to move between pages, per role, route, width, language and theme, with the walk (`walk=yes`: click
 * each item and check the page that opens). The admin and account lists follow `src/lib/sections.ts` for the demo
 * build (unit-tested); real-mode lists are the API rows `API-NAV-*` (`model-api.ts`).
 */
/** The delivery world's ids (copied from `fixtures/delivery-world.ts`, which imports the demo store and cannot load here). */
const DLV_PICKED_UP_JOB = '0193a5d0-0000-7000-8000-0000000b0005';
const DLV_PICKED_UP_ORDER = 'MD-RPR-2026-HND005';
const DLV_RETURNED_ORDER = 'MD-RPR-2026-HND007';
const deliveryWorldParam: Param = { name: 'world', values: ['delivery'] };
const agentEnv = [{ name: 'width', values: [320, 390, 480, 768, 1440] }, theme, locale];
const agentRow = (
  code: string,
  component: string,
  path: string,
  mustShow?: string,
  core = false,
): ComponentDef => ({
  code,
  page: `Delivery agent portal (${path})`,
  component,
  path,
  scope: 'main',
  checks: [...BASE_CHECKS, 'dismiss'],
  strategy: 'pairwise',
  params: [...agentEnv, { name: 'auth', values: ['agent'] }, deliveryWorldParam],
  sweep: 12,
  ...(mustShow ? { mustShow } : {}),
  // One per-push case for the whole feature (the job screen in Hindi at 390 px): the CI core subset stays small.
  ...(core ? { core: coreAt([390], (r) => r.locale === 'hi') } : {}),
});
const DELIVERY_COMPONENTS: readonly ComponentDef[] = [
  agentRow(
    'DLV-AGENT-OFFERS',
    'Agent offers: status strip (online switch, help call), tab bar, offers with countdown or the empty state',
    '/partner/delivery',
  ),
  agentRow('DLV-AGENT-JOBS', 'Agent jobs in hand (picked up)', '/partner/delivery/jobs', DLV_PICKED_UP_ORDER),
  agentRow(
    'DLV-AGENT-JOB',
    "Agent job in steps: customer revealed after pickup, call + maps, delivery code + photo, couldn't deliver",
    `/partner/delivery/jobs/${DLV_PICKED_UP_JOB}`,
    'Ravi Sahu',
    true,
  ),
  agentRow(
    'DLV-AGENT-HISTORY',
    'Agent history (returned job)',
    '/partner/delivery/history',
    DLV_RETURNED_ORDER,
  ),
  agentRow(
    'DLV-AGENT-PROFILE',
    'Agent profile: rating, documents with status, earnings (payouts)',
    '/partner/delivery/profile',
  ),
  {
    code: 'DLV-APPLY',
    page: 'Apply as a delivery agent (/partners/apply/delivery_agent)',
    component:
      'Delivery agent application: name, mobile, city, vehicle radios, consent (Turnstile on the API)',
    path: '/partners/apply/delivery_agent',
    scope: 'main',
    checks: [...BASE_CHECKS, 'dismiss'],
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['out'] }, { name: 'form', values: ['clean', 'errors'] }],
    sweep: 12,
  },
  {
    code: 'DLV-INVITE',
    page: 'Delivery agent invite (/partners/delivery-invite/{token})',
    component: 'Invite link that is not valid (expired, used or wrong): one sentence, no action',
    path: '/partners/delivery-invite/0000000000000000000000000000000000000000',
    scope: 'main',
    checks: BASE_CHECKS,
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['out', 'customer'] }],
  },
  {
    code: 'DLV-SHOP',
    page: 'Shop portal, agents mode (/partner/shop)',
    component:
      'Agent-mode shop: Mark ready for pickup, pickup code while an agent comes, agent first name + vehicle, delivery mode card',
    path: '/partner/shop',
    scope: 'main',
    checks: [...BASE_CHECKS, 'dismiss'],
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['agentshop'] }, deliveryWorldParam],
    sweep: 16,
    mustShow: 'MD-RPR-2026-HND006',
  },
  {
    code: 'DLV-CUSTOMER',
    page: 'Order page, agent delivery (/orders/{code})',
    component:
      'Customer delivery block: picked up by first name (vehicle), delivery code; never the shop or the agent phone',
    path: `/orders/${DLV_PICKED_UP_ORDER}`,
    scope: 'main',
    checks: BASE_CHECKS,
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['customer'] }, deliveryWorldParam],
    mustShow: 'Sunil',
  },
  {
    code: 'DLV-CUSTOMER-RETURNED',
    page: 'Order page, returned to the shop (/orders/{code})',
    component: 'Customer delivery block after a return: refund wording (parts only)',
    path: `/orders/${DLV_RETURNED_ORDER}`,
    scope: 'main',
    checks: BASE_CHECKS,
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['customer'] }, deliveryWorldParam],
  },
  {
    code: 'DLV-ADMIN',
    page: 'Admin → Delivery (/admin/delivery)',
    component:
      'Delivery section tabs (jobs, applications, agents, payouts, shop requests, settings) and the jobs queue table with waiting chips',
    path: '/admin/delivery',
    scope: 'main',
    checks: [...BASE_CHECKS, 'dismiss'],
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['admin'] }, deliveryWorldParam],
    sweep: 16,
    align: TABLE_ALIGN,
    mustShow: 'MD-RPR-2026-HND006',
    note: 'Tabs other than Jobs are client state of one route: opened by hand in the screenshots and the e2e.',
  },
];

const NAVIGATION: readonly ComponentDef[] = [
  {
    code: 'NAV-HEADER',
    page: 'Navigation',
    component: 'Header nav (1024 px and up): current item, hover, focus, every role and route',
    path: (r) => String(r.route),
    scope: 'header.sticky nav',
    strategy: 'cross',
    cross: ['width', 'auth'],
    params: [
      { name: 'width', values: [1024, 1280, 1440, 1920] },
      { name: 'auth', values: ['out', 'customer', 'shop', 'workshop', 'admin'] },
      theme,
      locale,
      { name: 'route', values: [...PRIMARY_ROUTES, '/partner/shop', '/partner/workshop', '/admin'] },
      walk,
    ],
    valid: roleRoute,
    checks: NAV_CHECKS,
    nav: 'bar',
    sweep: 6,
    core: (r) => Number(r.width) === 1024 && r.locale === 'hi' && r.walk === 'yes',
  },
  {
    code: 'NAV-TABBAR',
    page: 'Navigation',
    component: 'Floating dock (under 1024 px): current tab, long Hindi labels, every role, walk',
    path: (r) => String(r.route),
    scope: 'nav.fixed',
    strategy: 'cross',
    cross: ['width', 'locale'],
    params: [
      { name: 'width', values: [320, 390, 480, 768, 1023] },
      locale,
      theme,
      { name: 'auth', values: ['out', 'customer'] },
      { name: 'route', values: PRIMARY_ROUTES },
      { name: 'cart', values: ['none', 'many20'] },
      walk,
    ],
    valid: roleRoute,
    checks: NAV_CHECKS,
    nav: 'bar',
    sweep: 4,
    core: (r) => Number(r.width) === 320 && r.locale === 'hi' && r.walk === 'yes',
  },
  {
    code: 'NAV-ACCOUNT',
    page: 'Navigation',
    component: 'Account section bar: current section on each of the nine sections (scrolls on phones)',
    path: (r) => accountPath(String(r.section)),
    scope: 'main nav.overflow-x-auto',
    strategy: 'cross',
    cross: ['width', 'section'],
    params: [
      { name: 'width', values: WIDTHS },
      { name: 'section', values: ACCOUNT_SECTIONS },
      theme,
      locale,
      { name: 'auth', values: ['customer'] },
      world2,
      walk,
    ],
    checks: NAV_CHECKS,
    nav: 'bar',
    sweep: 6,
    core: (r) => Number(r.width) === 390 && r.locale === 'hi' && r.section === 'coins',
  },
  {
    code: 'NAV-ADMIN',
    page: 'Navigation',
    component:
      'Admin section bar: current section on each demo section (scrolls on phones, column from 1024 px)',
    path: (r) => adminPath(String(r.section)),
    scope: 'main nav.overflow-x-auto',
    strategy: 'cross',
    cross: ['width', 'section'],
    params: [
      { name: 'width', values: WIDTHS },
      { name: 'section', values: ADMIN_SECTIONS },
      theme,
      locale,
      { name: 'auth', values: ['admin'] },
      world2,
      walk,
    ],
    checks: NAV_CHECKS,
    nav: 'bar',
    sweep: 6,
  },
  {
    code: 'NAV-CATEGORY',
    page: 'Navigation',
    component: 'Shop category chips (scroll row): current chip, every chip applies its filter',
    path: (r) => String(r.route),
    scope: 'main nav.overflow-x-auto',
    strategy: 'pairwise',
    params: [
      ...env,
      authOutIn,
      { name: 'route', values: ['/shop', '/shop?category=batteries', '/shop?category=tyres'] },
      walk,
    ],
    checks: NAV_CHECKS,
    nav: 'links',
    sweep: 6,
  },
  {
    code: 'NAV-FOOTER',
    page: 'Navigation',
    component: 'Footer links: every link opens its page (help, policies, partners, support)',
    path: '/',
    scope: 'footer',
    strategy: 'pairwise',
    params: [...env, authOutIn, walk],
    checks: NAV_CHECKS,
    nav: 'links',
    sweep: 4,
  },
];

export const COMPONENTS: readonly ComponentDef[] = [
  // ───────────────────────────── Chrome (every page) ─────────────────────────────
  {
    code: 'CHR-HEADER',
    page: 'Chrome',
    component:
      'Header (v4: logo, segmented nav, search pill, bell, account avatar, cart button; compact bar and search bar on phones)',
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
    code: 'CHR-ACCOUNT-MENU',
    page: 'Chrome',
    component:
      'Account menu behind the header avatar (v4): open, every row, dark-mode switch, language, Sign out in the error colour; portal roles get their portal link',
    path: '/',
    scope: 'header [role="menu"]',
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['customer', 'shop'] }, { name: 'open', values: ['first'] }],
    sweep: 8,
  },
  {
    code: 'CHR-SEARCH',
    page: 'Chrome',
    component:
      'Search palette behind the header search pill (v4): popular searches and categories, close button, Escape, focus trap',
    path: '/',
    scope: '[role="dialog"][aria-modal="true"]',
    strategy: 'pairwise',
    params: [...env, authOutIn, { name: 'open', values: ['first'] }],
    sweep: 8,
  },
  {
    code: 'CHR-SEARCH-ROADSIDE',
    page: 'Chrome',
    component:
      'Search palette with "puncture" typed: the "Roadside help" suggestion on top (spec 22, 2026-11-24), then the usual rows',
    path: '/',
    scope: '[role="dialog"][aria-modal="true"]',
    strategy: 'pairwise',
    params: [...env, { name: 'open', values: ['first'] }],
    sweep: 8,
  },
  {
    code: 'CHR-HEADER-ROADSIDE',
    page: 'Chrome',
    component:
      'Header "Roadside help" item (spec 22, 2026-11-24): the siren icon in the accent colour next to the other destinations, no wrapping at 1024, 1280 and 1440 px; current on the roadside page',
    path: (r) => String(r.route),
    scope: 'header.sticky nav',
    strategy: 'cross',
    cross: ['width'],
    params: [
      { name: 'width', values: [1024, 1280, 1440, 1920] },
      theme,
      locale,
      { name: 'route', values: ['/', '/roadside'] },
    ],
    sweep: 12,
    core: coreAt([1024], (r) => r.locale === 'hi' && r.theme === 'dark'),
  },
  {
    code: 'CHR-TABBAR-5',
    page: 'Chrome',
    component:
      'Floating dock with five tabs (spec 22, 2026-11-24): the SOS tab last in the accent colour, labels on one line down to 320 px, current on the roadside page',
    path: (r) => String(r.route),
    scope: 'nav.fixed',
    strategy: 'cross',
    cross: ['width'],
    params: [phoneWidth, theme, locale, { name: 'route', values: ['/', '/roadside'] }],
    sweep: 12,
    core: coreAt([320], (r) => r.locale === 'hi' && r.theme === 'dark'),
  },
  {
    code: 'CHR-TABBAR',
    page: 'Chrome',
    component: 'Floating dock (v4, under 1024 px)',
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
      [
        'HOME-ROADSIDE',
        'Roadside help band ("Stuck on the road?", one button; spec 22, 2026-11-24)',
        'section[aria-labelledby="roadside-band-title"]',
      ],
      ['HOME-AUDIENCES', 'Audience band (three entry cards)', 'section[aria-labelledby="audiences-title"]'],
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
    params: [
      ...env,
      authOutIn,
      world3,
      { name: 'stress', values: ['none', 'long-text', 'long-price'] },
      ...(code === 'HOME-HERO' ? [{ name: 'trust', values: [...TRUST_STATES] }] : []),
    ],
    align: code === 'HOME-RANGE' ? CARD_ALIGN : undefined,
    sweep: 10,
    core:
      code === 'HOME-RANGE'
        ? coreAt([390, 1440])
        : code === 'HOME-AUDIENCES'
          ? coreAt([390], (r) => r.locale === 'hi' && r.theme === 'dark')
          : undefined,
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
  {
    // User report 2026-11-15 (screenshot of this grid): prices and "In stock" sat at different heights when one name
    // took two lines or one card had a unit price; the card rows carry `data-align` and the aligned check compares them.
    code: 'HOME-PRODUCTS',
    page: 'Home',
    component:
      'Browse our product range: product cards in a row (name, rating, price, unit price, stock, button)',
    path: '/',
    scope: 'section[aria-labelledby="range-title"]',
    strategy: 'pairwise',
    params: [...env],
    checks: [...BASE_CHECKS, 'aligned', 'offphoto'],
    align: CARD_ALIGN,
    sweep: 8,
    core: coreAt([390, 1440]),
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
    checks: [...BASE_CHECKS, 'aligned', 'sync', 'offphoto'],
    align: CARD_ALIGN,
    sweep: 12,
    core: coreAt([390, 1440], (r) => r.compare === 'bat-2' || r.cart === 'mixed'),
    note: 'bat-2 on the all-products listing = mixed categories (user bug 1: category-B cards when the tray holds A).',
  },
  {
    code: 'SHOP-CARD-ADMIN',
    page: 'Shop (/shop)',
    component:
      'Product card as catalogue staff (storefront Edit shortcut on the picture): nothing overlaps or covers the ⓘ and ♡ buttons, everything stays inside the card',
    path: '/shop',
    scope: 'main article',
    strategy: 'pairwise',
    params: [
      width,
      theme,
      locale,
      { name: 'auth', values: ['admin'] },
      { name: 'stress', values: ['none', 'long-text', 'mixed-shape'] },
    ],
    checks: [...BASE_CHECKS, 'aligned', 'offphoto'],
    align: CARD_ALIGN,
    sweep: 8,
    core: coreAt([390], (r) => r.theme === 'light' && r.locale === 'en'),
    note: 'Admin login in the demo = the staff session that shows the shortcut (user 2026-11-25).',
  },
  {
    code: 'SHOP-ADMIN-EDIT',
    page: 'Shop (/shop)',
    component:
      'Storefront Edit shortcut (pencil link) on a card: shows for catalogue staff, at least 24 px, inside its card, no overlap',
    path: '/shop',
    scope: 'main article [data-slot="admin-edit"]',
    strategy: 'cross',
    cross: ['width', 'theme'],
    params: [width, theme, locale, { name: 'auth', values: ['admin'] }],
    checks: ['present', 'inside', 'overlap', 'covered', 'tap', 'hscroll', 'focus', 'console'],
    sweep: 6,
  },
  {
    // Design 2026-11-25: the vehicle-type chips above the results (multi-select, counts, 44 px, scroll inside their box).
    code: 'SHOP-SEGMENT-CHIPS',
    page: 'Shop (/shop)',
    component:
      'Vehicle-type chips with counts (several on at once): at least 44 px, inside the page, no overlap, the row scrolls inside its own box (never the page), focus ring visible',
    path: (r) => String(r.route),
    scope: 'main [data-slot="segment-chips"]',
    strategy: 'pairwise',
    params: [
      ...env,
      {
        name: 'route',
        values: ['/shop', '/shop?segment=truck_bus', '/shop?segment=truck_bus,tractor_farm,construction_otr'],
      },
    ],
    checks: ['present', 'inside', 'overlap', 'covered', 'tap', 'hscroll', 'focus', 'console'],
    sweep: 8,
    core: coreAt(
      [390],
      (r) => r.theme === 'light' && r.locale === 'en' && String(r.route).includes('construction'),
    ),
  },
  {
    code: 'SHOP-SEGMENT-TAG',
    page: 'Shop (/shop)',
    component:
      'Vehicle-type tag on a product card (one, the first segment): at least 24 px, inside its card, never overlapping the info, save or edit buttons or the other badges',
    path: '/shop?segment=truck_bus',
    scope: 'main article',
    strategy: 'pairwise',
    params: [...env, { name: 'stress', values: ['none', 'long-text', 'mixed-shape'] }],
    checks: [...BASE_CHECKS, 'aligned', 'offphoto'],
    align: CARD_ALIGN,
    sweep: 6,
  },
  {
    code: 'HOME-VEHICLE-TILES',
    page: 'Home',
    component: 'Shop by vehicle: Truck & bus, Tractor & farm and Construction & OTR tiles',
    path: '/',
    scope: 'section[aria-labelledby="vehicles-title"]',
    strategy: 'pairwise',
    params: [...env],
    checks: ['present', 'inside', 'overlap', 'covered', 'clipped', 'tap', 'hscroll', 'focus', 'console'],
    sweep: 4,
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
    checks: [...BASE_CHECKS, 'aligned', 'sync', 'offphoto'],
    align: CARD_ALIGN,
    sweep: 6,
    core: coreAt([390], (r) => r.action === 'start-new' || r.action === 'compare-other'),
    note: 'compare-other: press Compare on a lubricant while the list holds batteries; start-new: then "Start a new comparison" (user bug 2).',
  },
  {
    code: 'SHOP-FILTERS',
    page: 'Shop (/shop)',
    component:
      'Search, category chips, Kind of vehicle chips (no vehicle-type select since 2026-11-26), sort, results count, empty result',
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
          '/shop?segment=two_wheeler&sort=price_asc',
          '/shop?q=battery&segment=car_suv',
          '/shop?segment=truck_bus',
          '/shop?segment=truck_bus,tractor_farm&category=tyres',
          '/shop?q=zzzz-no-match',
        ],
      },
      { name: 'compare', values: ['none', 'lub-2'] },
    ],
    checks: [...BASE_CHECKS, 'aligned', 'offphoto'],
    align: CARD_ALIGN,
    sweep: 14,
    core: coreAt([320]),
  },
  {
    code: 'SHOP-SEARCH',
    page: 'Shop (/shop)',
    component:
      'Search box with suggestions (combobox): focus loads the list, keyboard and pointer, empty and filled',
    path: (r) => String(r.route),
    scope: 'form[role="search"]',
    strategy: 'pairwise',
    params: [...env, { name: 'route', values: ['/shop', '/shop?q=castrol%20900ml'] }],
    checks: ['present', 'inside', 'overlap', 'clipped', 'tap', 'hscroll', 'focus', 'console'],
    sweep: 6,
    note: 'Sweep only (the core subset is full). Focus arms the lazy suggestion panel; typing is covered by the unit and e2e tests.',
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
    // One product: no tray yet, the "pick one more" line stands in (tray-visible.ts, batch 2B); two or more: the tray.
    scope: '[data-compare-tray], [data-compare-hint]',
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
    path: (r) =>
      `/shop/${String(r.product)}${r.size === 'default' ? '' : `?size=${TYRE_SIZES[r.size as keyof typeof TYRE_SIZES]}`}`,
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      {
        name: 'product',
        values: [PRODUCTS.castrol, PRODUCTS.hd90, PRODUCTS.carTyre, PRODUCTS.evCharger, PRODUCTS.bearing6301],
      },
      // The demo tyre has three sizes: the picker opens on the default, a linked size, or the one with no stock.
      { name: 'size', values: ['default', 'first', 'out'] },
      { name: 'cart', values: ['none', 'c1', 'c99'] },
      { name: 'compare', values: ['none', 'lub-2', 'bat-3'] },
      { name: 'stress', values: ['none', 'long-text', 'long-price'] },
      { name: 'trust', values: [...TRUST_STATES] },
    ],
    checks: [...BASE_CHECKS, 'sync'],
    sweep: 12,
    core: coreAt([390, 1440], (r) => r.product === PRODUCTS.castrol),
    note: 'Products: in stock + MRP, confirmed on request without MRP, low stock, highest price (₹12,500), lowest (₹180). The tyre has three sizes (size picker; ?size= opens a size; the third has no stock).',
  },
  {
    code: 'PDP-ADMIN-EDIT',
    page: 'Product page (/shop/[slug])',
    component:
      'Storefront Edit shortcut beside the title for catalogue staff: at least 24 px, inside the page, no overlap with the title',
    path: `/shop/${PRODUCTS.castrol}`,
    scope: 'main [data-slot="admin-edit"], main h1',
    strategy: 'cross',
    cross: ['width', 'theme'],
    params: [width, theme, locale, { name: 'auth', values: ['admin'] }],
    checks: ['present', 'inside', 'overlap', 'covered', 'tap', 'hscroll', 'focus', 'console'],
    sweep: 6,
  },
  {
    code: 'PDP-REVIEWS',
    page: 'Product page (/shop/[slug])',
    component: 'Ratings summary, review list, write-a-review entry',
    path: (r) => `/shop/${String(r.product)}`,
    scope: 'section[aria-labelledby^="reviews-"]',
    checks: [...BASE_CHECKS, 'dismiss'],
    strategy: 'pairwise',
    params: [...env, authOutIn, world2, { name: 'product', values: [PRODUCTS.castrol, PRODUCTS.spark] }],
    sweep: 8,
  },
  {
    code: 'PDP-SIMILAR',
    page: 'Product page (/shop/[slug])',
    component: 'Similar options row (same size and segment, other brands; cards with the shared size line)',
    path: `/shop/${PRODUCTS.castrol}`,
    scope: 'section[aria-labelledby="similar"]',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'cart', values: ['none', 'mixed'] },
      { name: 'compare', values: ['none', 'lub-2'] },
    ],
    checks: [...BASE_CHECKS, 'aligned', 'sync', 'offphoto'],
    align: CARD_ALIGN,
    sweep: 8,
    note: 'Personalisation phase 3 (2026-11-26). "More in this category" shows only when nothing matches the size, so PDP-RELATED uses the spark plug.',
  },
  {
    code: 'PDP-RELATED',
    page: 'Product page (/shop/[slug])',
    component: 'Related products row (cards)',
    path: `/shop/${PRODUCTS.spark}`,
    scope: 'section[aria-labelledby="related"]',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'cart', values: ['none', 'mixed'] },
      { name: 'compare', values: ['none', 'bat-2'] },
    ],
    checks: [...BASE_CHECKS, 'aligned', 'sync', 'offphoto'],
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
      { name: 'cart', values: ['c1', 'mixed', 'many20', 'below', 'max', 'sizes2'] },
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
    params: [
      ...env,
      authOutIn,
      { name: 'cart', values: ['none'] },
      { name: 'trust', values: [...TRUST_STATES] },
    ],
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
      { name: 'trust', values: [...TRUST_STATES] },
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
    checks: [...BASE_CHECKS, 'dismiss'],
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
    code: 'ORD-AGAIN',
    page: 'Order (/orders/[code], delivered)',
    component: 'Order again button, result panel and Go to cart',
    path: (r) => `/orders/${String(r.order)}`,
    scope: 'main',
    checks: [...BASE_CHECKS, 'dismiss'],
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'order', values: ['MD-RPR-2026-HND004'] },
      { name: 'auth', values: ['customer'] },
      { name: 'world', values: ['busy'] },
    ],
    mustShow: 'MD-RPR-2026-HND004',
    sweep: 8,
  },
  {
    code: 'SR-VIEW',
    page: 'Service request (/service/[code])',
    component: 'Request status, proposal, itemised estimate (per-line approval), bill',
    path: (r) => `/service/${String(r.request)}`,
    scope: 'main',
    checks: [...BASE_CHECKS, 'dismiss'],
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
      { name: 'promise', values: [...PROMISE_STATES] },
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
    code: 'WS-ROADSIDE-CARD',
    page: 'Workshops (/workshops)',
    component:
      'Highlighted roadside card at the top of the page (spec 22, 2026-11-24): accent border, siren, one outlined link to /roadside',
    path: '/workshops',
    scope: 'aside[aria-labelledby="workshops_roadside-title"]',
    strategy: 'pairwise',
    params: [...env, authOutIn],
    sweep: 10,
    core: coreAt([390], (r) => r.locale === 'hi' && r.theme === 'dark'),
  },
  {
    code: 'OFFERS-PAGE',
    page: 'Offers (/offers)',
    component:
      'Public offers list (2026-11-16): offer cards with conditions, IST end time and copy-code button; the demo build has no offers, so it shows the empty state with one next action',
    path: '/offers',
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, authOutIn],
    checks: [...BASE_CHECKS],
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
      { name: 'trust', values: [...TRUST_STATES] },
      { name: 'promise', values: [...PROMISE_STATES] },
    ],
    sweep: 16,
    core: coreAt([390], (r) => r.form === 'errors'),
  },
  {
    code: 'WS-BOOK-FLOAT',
    page: 'Workshop page (/workshops/[slug])',
    component:
      'Booking form with the floating assistant button: scanned top to bottom, the button never covers a price or a control (it steps aside while the form is on the page; QA V5)',
    path: '/workshops/telibandha-car-clinic',
    scope: 'main',
    strategy: 'cross',
    cross: ['width', 'theme', 'locale'],
    params: [{ name: 'width', values: [320, 390, 480, 1440] }, theme, locale],
    checks: ['present', 'covered', 'launcher', 'hscroll', 'console'],
    sweep: 0,
    // One case per push (CI budget, core <= 100); the nightly full audit runs all 16.
    core: coreAt([390], (r) => r.locale === 'hi' && r.theme === 'dark'),
  },

  // ───────────────────────────── Partners, support, login, policies ─────────────────────────────
  {
    code: 'PTN-LANDING',
    page: 'Partners (/partners)',
    component: 'Partner landing (kinds, benefits, apply links)',
    path: '/partners',
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, authOutIn, { name: 'trust', values: [...TRUST_STATES] }],
    sweep: 10,
  },
  {
    code: 'BIZ-GARAGES',
    page: 'Business (/business/garages)',
    component: 'Garages landing (four benefits with status labels, one primary action)',
    path: '/business/garages',
    scope: 'main',
    strategy: 'pairwise',
    params: [...env, authOutIn],
    sweep: 10,
  },
  {
    code: 'BIZ-FLEETS',
    page: 'Business (/business/fleets)',
    component: 'Fleets landing, MechDost Uptime (five programme points, one primary action)',
    path: '/business/fleets',
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
      { name: 'promise', values: [...PROMISE_STATES] },
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
    checks: [...BASE_CHECKS, 'dismiss'],
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
    checks: [...BASE_CHECKS, 'dismiss'],
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['workshop'] }, world2],
    sweep: 16,
  },
  // Roadside help (spec 22, 2026-11-24): the customer's request form (location, vehicle, problem, review). The tracking
  // page needs a request seeded in this browser's demo store, which the harness cannot do yet: its rows are listed and
  // parked as `test.fixme` (`realApi`), like the other pages that need a seeded world.
  {
    code: 'RSA-REQUEST',
    page: 'Roadside help (/roadside)',
    component: 'Roadside request: PIN code, vehicle types offered, problem choices, review and advance',
    path: '/roadside',
    scope: 'main',
    checks: [...BASE_CHECKS, 'dismiss'],
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['customer'] }],
    sweep: 16,
  },
  {
    code: 'RSA-FLOAT',
    page: 'Roadside help (/roadside)',
    component:
      'Roadside request with the floating assistant button at 390 px: the button never overlaps a focusable element in main (it steps aside on this form; QA 2026-11-24, "Car / SUV" card)',
    path: '/roadside',
    scope: 'main',
    strategy: 'cross',
    cross: ['width', 'theme', 'locale'],
    params: [
      { name: 'width', values: [320, 390, 480, 1440] },
      theme,
      locale,
      { name: 'auth', values: ['customer'] },
    ],
    checks: ['present', 'covered', 'launcher', 'hscroll', 'console'],
    sweep: 0,
    core: coreAt([390], (r) => r.locale === 'hi' && r.theme === 'dark'),
  },
  {
    code: 'RSA-TRACK',
    page: 'Roadside request (/roadside/{code})',
    component:
      'Roadside tracking: steps, responder, arrival code, bill with advance and balance, refund note',
    path: '/roadside/RSA-RPR-2026-DEMO10',
    scope: 'main',
    checks: [...BASE_CHECKS],
    strategy: 'pairwise',
    params: [...env, { name: 'auth', values: ['customer'] }],
    realApi: true,
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

  // Scroll geometry of the admin frame (design 2026-11-24, user: "sometimes the sidebar goes down, sometimes the main
  // content ... in settings there are two of them"): the page is the only vertical scroller, the side bar stays in
  // view under the header after scrolling, and never two tall columns are stuck at once.
  {
    code: 'ADM-SCROLL',
    page: 'Admin console (/admin)',
    component:
      'Scroll geometry: one page scroller, side bar in view after scrolling, no second scroller (overview, orders, catalogue, content, settings, notifications)',
    path: (r) => adminPath(String(r.section)),
    scope: 'main',
    strategy: 'cross',
    cross: ['width', 'section'],
    params: [
      { name: 'width', values: [390, 1024, 1280, 1440, 1920] },
      {
        name: 'section',
        values: ['overview', 'orders', 'catalogue', 'content', 'settings', 'notifications'].filter((s) =>
          (ADMIN_SECTIONS as readonly string[]).includes(s),
        ),
      },
      theme,
      locale,
      { name: 'auth', values: ['admin'] },
      { name: 'world', values: ['busy'] },
    ],
    checks: ['present', 'scroll', 'hscroll', 'console'],
  },

  // Admin page pattern (design 2026-11-25, admin round 2): one header, badges, empty states and tables in the same
  // shape on every section, at every width from 320 to 1920 px, in both themes and languages.
  {
    code: 'ADM-HEADER',
    page: 'Admin console (/admin)',
    component:
      'Page pattern: one header per section (title = side bar item, one-line description, primary action on the right), status badges, empty states, table boxes; 320 to 1920 px, both themes, English and Hindi',
    path: (r) => adminPath(String(r.section)),
    scope: 'main',
    strategy: 'pairwise',
    params: [
      { name: 'width', values: [320, 390, 768, 1024, 1440, 1920] },
      { name: 'section', values: [...ADMIN_SECTIONS] },
      theme,
      locale,
      { name: 'auth', values: ['admin'] },
      { name: 'world', values: ['busy'] },
    ],
    checks: ['present', 'adminhead', 'hscroll', 'console'],
    sweep: 0,
  },

  ...NAVIGATION,

  // Seller onboarding and partner management on the admin Partners page (2026-11-13/15): invites, price requests, the
  // agreement card, then the shop / workshop / mechanic tabs with pause and suspend prompts.
  {
    code: 'ADM-PARTNERS-TABS',
    page: 'Admin console (/admin/partners)',
    component:
      'Partners: invites, price requests, agreement card, shop / workshop / mechanic tabs, pause prompt',
    path: '/admin/partners',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['admin'] },
      world2,
      { name: 'tab', values: ['shop', 'workshop', 'mechanic'] },
      { name: 'form', values: ['clean', 'errors', 'filled'] },
      { name: 'stress', values: ['none', 'long-text'] },
    ],
    checks: [...BASE_CHECKS, 'aligned'],
    align: TABLE_ALIGN,
    sweep: 16,
  },
  // Delivery agents (spec 24, 2026-11-27), demo store + `fixtures/delivery-world.ts` (world `delivery`); last, so
  // the regenerated checklist keeps every earlier line in place.
  ...DELIVERY_COMPONENTS,
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

/**
 * Views that exist only with real sign-in (API mode): the demo harness cannot render them, so they are not in
 * `COMPONENTS` (they would fail `present`). Each lists the states an API-mode audit must render, in the same
 * vocabulary (width, theme and locale are crossed as for any component) and the navigation that reaches it.
 * `test/state-audit-real-views.test.ts` keeps the component files and the states honest; the runnable matrix
 * is the API-mode audit (model-api.ts; runbook § 9.7): its rows are API-SHOP-PORTAL, API-ADM-SHOPS, API-ADM-QUEUE.
 */
export const REAL_MODE_VIEWS = [
  {
    code: 'API-SHOP-GIVEUP',
    page: 'Shop portal (/partner/shop), real sign-in',
    component: "Can't fulfil this order: button on a confirmed order, inline reason form (spec 04)",
    file: 'src/components/portal/shop-give-up.tsx',
    reach: 'sign in as shop owner → /partner/shop → Orders in progress → a confirmed order',
    states: [
      'closed',
      'open-empty',
      'open-reason-missing',
      'open-filled',
      'busy',
      'error-stale',
      'error-reason',
    ],
    notShownFor: ['packed', 'shipped', 'out_for_delivery'],
  },
  {
    code: 'API-SHOP-WARNINGS',
    page: 'Shop portal (/partner/shop), real sign-in',
    component: "Notes from MechDost: the shop's warnings (spec 07)",
    file: 'src/components/portal/shop-warnings-api.tsx',
    reach: 'sign in as shop owner → /partner/shop → "Notes from MechDost" section (#warnings)',
    states: ['loading', 'empty', 'one', 'at-threshold', 'withdrawn-row', 'note-long', 'error-retry'],
    notShownFor: [],
  },
  {
    code: 'API-ADMIN-WARNINGS',
    page: 'Admin → Partners → Shops, real sign-in',
    component: 'Warnings tab and the pause prompt on a shop (spec 08)',
    file: 'src/components/portal/admin-shop-warnings.tsx',
    reach: 'sign in as ops manager → /admin → Partners → Shops → open a shop → Warnings tab',
    states: [
      'empty',
      'form-invalid',
      'issued',
      'prompt-visible',
      'withdraw-open',
      'withdraw-invalid',
      'error',
    ],
    notShownFor: [],
  },
  {
    code: 'API-ADMIN-GIVEUP-QUEUE',
    page: 'Admin → Orders (needs routing), real sign-in',
    component: 'Reroute queue card with the shop\'s give-up reason and the "gave this order up before" tag',
    file: 'src/components/portal/admin-orders-api.tsx',
    reach: 'sign in as ops manager → /admin → Orders → Needs routing → an order a shop gave up',
    states: ['reason-line', 'tag-on-suggestion', 'both', 'neither'],
    notShownFor: [],
  },
  {
    code: 'API-ADMIN-EMAILS',
    page: 'Admin → Notifications → Emails tab, real sign-in',
    component:
      'Email templates: list, per-language text editor, live preview, test send, reset, on/off switch (spec 10)',
    file: 'src/components/portal/admin-emails-api.tsx',
    reach: 'sign in as marketing or super admin → /admin → Notifications → Emails tab → Edit on a template',
    states: [
      'loading',
      'list-default',
      'list-edited',
      'list-off',
      'editor-en',
      'editor-hi',
      'editor-problem-placeholder',
      'editor-no-button',
      'off-confirm',
      'saved',
      'reset-done',
      'test-queued',
      'error-stale',
      'error-retry',
    ],
    notShownFor: [],
  },
  {
    code: 'API-BELL',
    page: 'Header (every page), real sign-in',
    component:
      'Notification bell: badge and live count, dropdown with the latest ten (unread urgent first, then unread, then read), a priority bar + icon + label on each, remove, clear all read with Undo toast, empty state, error, mark all as read (spec 10)',
    file: 'src/components/notices/bell-controller.tsx',
    reach:
      'sign in as any role → the bell in the header (hidden under 380 px; the centre page is in the account menu)',
    states: [
      'closed-0',
      'closed-1',
      'closed-99',
      'closed-99-plus',
      'open-loading',
      'open-list-unread-and-read',
      'open-every-priority-urgent-action-info-success',
      'open-unread-urgent-first',
      'open-long-hindi-titles',
      'open-empty-all-caught-up',
      'open-error-retry',
      'open-mark-all',
      'open-remove-one-undo-toast',
      'open-clear-all-read-undo-toast',
      'open-toast-error',
    ],
    notShownFor: ['signed-out', 'browser demo'],
  },
  {
    code: 'API-NOTICE-CENTRE',
    page: 'Notification centre (/notifications), real sign-in',
    component:
      'Notification centre: inbox order (unread urgent, unread, read), priority styles, remove, clear all read with Undo toast, show older, mark all as read, push card and choices',
    file: 'src/components/notices/notice-centre.tsx',
    reach: 'sign in → bell → See all notifications (or /notifications)',
    states: [
      'signed-out-card',
      'loading',
      'list-with-more',
      'list-last-page',
      'list-every-priority-unread-and-read',
      'list-long-hindi-titles',
      'empty-customer-all-caught-up',
      'empty-portal-all-caught-up',
      'error-retry',
      'item-without-link',
      'remove-one-undo-toast',
      'clear-all-read-undo-toast',
      'toast-error',
    ],
    notShownFor: ['browser demo'],
  },
  {
    code: 'API-PUSH-PROMPT',
    page: 'Account, shop, workshop and admin home, and the centre, real sign-in',
    component:
      'Card "Get order and booking updates on this device": Turn on / Not now, iPhone Home Screen variant, denied',
    file: 'src/components/notices/push-card.tsx',
    reach:
      'sign in with NEXT_PUBLIC_FIREBASE_VAPID_KEY and NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID set → account home / /partner/shop',
    states: [
      'hidden-no-key',
      'normal',
      'normal-partner-title',
      'busy',
      'error-failed',
      'ios-add-to-home-screen',
      'snoozed-hidden',
      'enabled-hidden',
      'settings-on',
      'settings-off',
      'settings-denied',
      'settings-unsupported',
    ],
    notShownFor: ['browser demo'],
  },
  {
    code: 'API-NOTICE-PREFS',
    page: 'Account → Notifications and the centre, real sign-in',
    component:
      'Notification choices: push for updates, offers and promotions (customers only), saved and error lines',
    file: 'src/components/notices/notice-prefs.tsx',
    reach: 'sign in as customer → Account → Notifications; as shop → bell → See all',
    states: [
      'loading',
      'customer-both-off',
      'customer-promotions-on',
      'partner-one-choice',
      'saved',
      'error-save',
      'error-load',
    ],
    notShownFor: ['browser demo'],
  },
  {
    code: 'API-ADMIN-NOTICES',
    page: 'Admin → Notifications → Messages tab, real sign-in',
    component:
      'Bell and push message texts: list by audience, per-channel and per-language editor, reset, on/off (spec 10)',
    file: 'src/components/portal/admin-notices-api.tsx',
    reach: 'sign in as marketing or super admin → /admin → Notifications → Messages tab → Edit on a message',
    states: [
      'loading',
      'list-default',
      'list-edited',
      'editor-inapp-en',
      'editor-push-hi',
      'editor-problem-placeholder',
      'editor-no-placeholders',
      'saved',
      'reset-done',
      'error-stale',
      'error-retry',
    ],
    notShownFor: [],
  },
  // ─────────────── Home servicing (2026-11-15, spec 06) ───────────────
  {
    code: 'API-HOME-MODE',
    page: 'Workshop finder and booking form, real sign-in',
    component:
      'Mode switch "At the workshop / At my home", saved-address picker, visit-fee line before booking',
    file: 'src/components/workshops/home-mode-fields.tsx',
    reach: 'sign in as customer → /workshops/{slug} (a workshop that does home visits) → "At my home"',
    states: [
      'workshop-default',
      'home-signed-out',
      'home-loading',
      'home-no-address',
      'home-no-pinned-address',
      'home-address-picked',
      'fee-with-gst',
      'fee-free',
      'error-fee-changed',
      'error-out-of-radius',
    ],
    notShownFor: ['workshops that do not do home visits'],
  },
  {
    code: 'API-HOME-LISTING',
    page: 'Workshop finder (/workshops), real sign-in',
    component:
      'Home listing: workshops whose own radius covers the pinned address, with the visit fee on each card',
    file: 'src/components/workshops/workshop-finder-api.tsx',
    reach: 'sign in as customer → /workshops → "At my home" → choose a pinned address',
    states: ['idle', 'loading', 'none', 'some', 'edge-of-radius', 'error-retry'],
    notShownFor: [],
  },
  {
    code: 'API-HOME-ARRIVAL',
    page: 'Workshop portal (/partner/workshop) and request page, real sign-in',
    component:
      'Arrival code: customer sees it; the workshop enters it with the odometer (right, wrong, locked)',
    file: 'src/components/portal/home-visit-portal-api.tsx',
    reach: 'sign in as workshop owner → /partner/workshop → a confirmed home job → "Mechanic arrived"',
    states: ['empty', 'wrong-code', 'locked', 'format-error', 'odometer-error', 'busy', 'arrived'],
    notShownFor: ['jobs booked at the workshop'],
  },
  {
    code: 'API-HOME-FEE-LINE',
    page: 'Service request (/service/{code}) bill, real sign-in',
    component: 'Visit-fee line on the bill (with GST, waived at 0, fee only after a declined move)',
    file: 'src/components/workshops/service-estimate.tsx',
    reach: 'sign in as customer → a home request that is billed',
    states: ['with-gst', 'no-gst', 'waived', 'fee-only'],
    notShownFor: ['jobs booked at the workshop'],
  },
  {
    code: 'API-HOME-MOVE',
    page: 'Service request (/service/{code}) and workshop portal, real sign-in',
    component:
      'Offer to move the job to the workshop: workshop form, customer card (accept / decline), outcome',
    file: 'src/components/workshops/home-visit-api.tsx',
    reach:
      'sign in as workshop owner → an arrived home job → "Offer to move to workshop"; then as the customer → /service/{code}',
    states: ['closed', 'open-empty', 'open-missing', 'waiting', 'accepted', 'declined', 'error'],
    notShownFor: ['jobs booked at the workshop', 'before arrival'],
  },
] as const;
