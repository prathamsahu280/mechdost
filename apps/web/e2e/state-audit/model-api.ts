/**
 * Components that exist only in a real-sign-in build (`NEXT_PUBLIC_AUTH_MODE=firebase`, `NEXT_PUBLIC_DATA_MODE=api`):
 * the screens that read the MechDost API. The demo harness cannot render them. They run under the API-mode audit
 * (`playwright.state-audit-api.config.ts`, runbook docs/runbooks/ui-test-catalogue.md § 9.7), which builds the web
 * in real mode and answers every `/v1` call from typed fixtures (`api-mode/fixtures.ts`).
 *
 * Same vocabulary as `model.ts`; the state keys below are the fixture shapes (`fixtures.ts` gives each value one
 * meaning) and the page set-up (`api-mode/prepare.ts`). Pure data plus `.ts` imports only.
 */
import {
  BASE_CHECKS,
  env,
  locale,
  TABLE_ALIGN,
  theme,
  WIDTHS,
  world2,
  type Check,
  type ComponentDef,
} from './model.ts';
import type { Param, Row } from './pairwise.ts';

/** Admin sections of a real-sign-in build, in menu order (`src/lib/sections.ts`; a unit test keeps them equal). */
export const REAL_ADMIN_SECTIONS = [
  'overview',
  'analytics',
  'orders',
  'refunds',
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
  'errors',
] as const;

export const REAL_ACCOUNT_SECTIONS = [
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

const adminPath = (s: string) => (s === 'overview' ? '/admin' : `/admin/${s}`);
const accountPath = (s: string) => (s === 'overview' ? '/account' : `/account/${s}`);
const stress: Param = { name: 'stress', values: ['none', 'long-text'] };
const walk: Param = { name: 'walk', values: ['no', 'yes'] };
const NAV: readonly Check[] = [...BASE_CHECKS, 'nav'];
const API_NOTE = 'API mode only (mocked API, runbook § 9.7).';

export const REFUND_VARIANTS = [
  'requested',
  'requested-own',
  'overdue',
  'approved-razorpay',
  'approved-cod',
  'processed',
  'failed',
  'needs-reconciliation',
] as const;

export const API_COMPONENTS: readonly ComponentDef[] = [
  // ─────────────── Refunds (2026-11-15, spec 05) ───────────────
  {
    code: 'API-ADM-REFUNDQ',
    page: 'Admin console (/admin/refunds)',
    component:
      'Refund queue: view buttons, list rows, detail (approve / decline with reason / pay by hand with UTR), alerts',
    path: '/admin/refunds',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['admin'] },
      world2,
      { name: 'view', values: ['waiting', 'overdue', 'in_progress', 'attention', 'closed'] },
      { name: 'refund', values: REFUND_VARIANTS },
      { name: 'detail', values: ['closed', 'open'] },
      { name: 'form', values: ['clean', 'errors', 'filled'] },
    ],
    checks: [...BASE_CHECKS, 'aligned'],
    align: [{ items: 'main ul > li' }],
    sweep: 16,
    note: API_NOTE,
    realApi: true,
  },
  {
    code: 'API-ORD-REFUNDLINE',
    page: 'Order page (/orders/{code})',
    component:
      'Refund status line under a part: under review, processing, refunded, declined, failed (+ support link)',
    path: '/orders/MD-RPR-2026-HND301',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['customer'] },
      { name: 'world', values: ['busy'] },
      {
        name: 'refund',
        values: ['under_review', 'processing', 'refunded', 'declined', 'failed', 'two-refunds'],
      },
      stress,
    ],
    sweep: 10,
    note: API_NOTE,
    realApi: true,
  },

  // ─────────────── Shop portal on the API (give-up, warnings, hours, agreement; specs 04, 07) ───────────────
  {
    code: 'API-SHOP-PORTAL',
    page: 'Shop portal (/partner/shop), real sign-in',
    component:
      "Orders from the API with the give-up form, the shop's warnings, its hours and standing, its agreement",
    path: '/partner/shop',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['shop'] },
      { name: 'shop', values: ['open', 'paused', 'suspended', 'closed-hours'] },
      {
        name: 'orders',
        values: ['none', 'offer', 'confirmed', 'packed', 'given-up-history', 'many'],
      },
      { name: 'warnings', values: ['none', 'one', 'threshold', 'withdrawn', 'long-note', 'error'] },
      { name: 'giveup', values: ['closed', 'open', 'empty-submit', 'filled'] },
      { name: 'agreement', values: ['accepted', 'new-version'] },
      stress,
    ],
    valid: (r: Row) =>
      r.giveup === undefined ||
      r.orders === undefined ||
      r.giveup === 'closed' ||
      r.orders === 'confirmed' ||
      r.orders === 'many',
    checks: [...BASE_CHECKS, 'aligned'],
    align: [{ items: 'main ul > li' }],
    sweep: 16,
    core: undefined,
    note: `${API_NOTE} The give-up button is on a confirmed order only (spec 04).`,
    realApi: true,
  },

  // ─────────────── Admin → Partners → Shops (management, hours, warnings; specs 07, 08) ───────────────
  {
    code: 'API-ADM-SHOPS',
    page: 'Admin → Partners → Shops, real sign-in',
    component:
      'Shop list with status filter and one shop open: profile (hours), PIN codes, products, standing, warnings (pause prompt), access',
    path: '/admin/partners',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['admin'] },
      { name: 'shops', values: ['none', 'one', 'many', 'mixed-status', 'error'] },
      {
        name: 'panel',
        values: ['closed', 'profile', 'coverage', 'products', 'standing', 'warnings', 'members'],
      },
      { name: 'warn', values: ['empty', 'issued', 'prompt', 'withdrawn'] },
      { name: 'form', values: ['clean', 'errors', 'filled'] },
      stress,
    ],
    valid: (r: Row) =>
      r.panel !== 'closed' ||
      ((r.warn === undefined || r.warn === 'empty') && (r.form === undefined || r.form === 'clean')),
    sweep: 16,
    note: API_NOTE,
    realApi: true,
  },

  // ─────────────── Admin → Orders: the reroute queue (spec 04) ───────────────
  {
    code: 'API-ADM-QUEUE',
    page: 'Admin → Orders (needs routing), real sign-in',
    component: 'Reroute queue card with the shop\'s give-up reason and the "gave this order up before" tag',
    path: '/admin/orders',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['admin'] },
      {
        name: 'queue',
        values: ['empty', 'reason-line', 'tag-on-suggestion', 'both', 'neither', 'many', 'error'],
      },
      stress,
    ],
    checks: [...BASE_CHECKS, 'aligned'],
    align: TABLE_ALIGN,
    sweep: 12,
    note: API_NOTE,
    realApi: true,
  },

  // ─────────────── Admin → Errors (Sentry through the API; decision 2026-11-14) ───────────────
  {
    code: 'API-ADM-ERRORS',
    page: 'Admin → Errors, real sign-in',
    component: 'Sentry issues of the website and the API: not connected, none, many, one project down',
    path: '/admin/errors',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['admin'] },
      { name: 'errors', values: ['not-connected', 'none', 'issues', 'one-down', 'many-long', 'error'] },
    ],
    sweep: 12,
    note: API_NOTE,
    realApi: true,
  },

  // ─────────────── Admin: Analytics, Coins, Reviews, Bulk quotes (2026-11-14/15) ───────────────
  {
    code: 'API-ADM-ANALYTICS',
    page: 'Admin → Analytics, real sign-in',
    component:
      'Dashboard: KPI tiles, daily chart, funnel, top lists, areas, shop and workshop tables, range and city',
    path: '/admin/analytics',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['admin'] },
      { name: 'analytics', values: ['empty', 'full', 'long-text', 'city-scoped', 'error'] },
    ],
    checks: [...BASE_CHECKS, 'aligned'],
    align: TABLE_ALIGN,
    sweep: 14,
    note: API_NOTE + ' Chart canvases are measured as boxes only.',
    realApi: true,
  },
  {
    code: 'API-ADM-COINS',
    page: 'Admin → Coins, real sign-in',
    component: 'Coin activity list (earn, redeem, adjust, expire, restore), account look-up and adjust form',
    path: '/admin/coins',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['admin'] },
      { name: 'coins', values: ['none', 'few', 'many', 'long-text', 'error'] },
      { name: 'form', values: ['clean', 'errors', 'filled'] },
    ],
    sweep: 12,
    note: API_NOTE,
    realApi: true,
  },
  {
    code: 'API-ADM-REVIEWS',
    page: 'Admin → Reviews, real sign-in',
    component: 'Review moderation queue: pending / approved / hidden, long text, hide reasons',
    path: '/admin/reviews',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['admin'] },
      { name: 'reviews', values: ['none', 'pending', 'many', 'long-text', 'error'] },
    ],
    sweep: 12,
    note: API_NOTE,
    realApi: true,
  },
  {
    code: 'API-ADM-QUOTES',
    page: 'Admin → Bulk quotes, real sign-in',
    component: 'Quote desk: queue views, every quote status, offer and order chips',
    path: '/admin/quotes',
    scope: 'main',
    strategy: 'pairwise',
    params: [
      ...env,
      { name: 'auth', values: ['admin'] },
      { name: 'quotes', values: ['none', 'one', 'mixed', 'error'] },
    ],
    sweep: 12,
    note: API_NOTE,
    realApi: true,
  },

  // ─────────────── Navigation in a real-sign-in build ───────────────
  {
    code: 'API-NAV-ADMIN',
    page: 'Navigation, real sign-in',
    component:
      'Admin section bar with every real-mode section (Analytics, Refunds, Errors included): current item, scroll, walk',
    path: (r) => adminPath(String(r.section)),
    scope: 'main nav.overflow-x-auto',
    strategy: 'cross',
    cross: ['width', 'section'],
    params: [
      { name: 'width', values: WIDTHS },
      { name: 'section', values: REAL_ADMIN_SECTIONS },
      theme,
      locale,
      { name: 'auth', values: ['admin'] },
      walk,
    ],
    checks: NAV,
    nav: 'bar',
    sweep: 6,
    core: undefined,
    note: `${API_NOTE} On a walk, screens other than the one under test may answer "not mocked" (their own rows cover them).`,
    realApi: true,
  },
  {
    code: 'API-NAV-ACCOUNT',
    page: 'Navigation, real sign-in',
    component: 'Account section bar in a real-sign-in build: current item, scroll, walk',
    path: (r) => accountPath(String(r.section)),
    scope: 'main nav.overflow-x-auto',
    strategy: 'cross',
    cross: ['width', 'section'],
    params: [
      { name: 'width', values: WIDTHS },
      { name: 'section', values: REAL_ACCOUNT_SECTIONS },
      theme,
      locale,
      { name: 'auth', values: ['customer'] },
      walk,
    ],
    checks: NAV,
    nav: 'bar',
    sweep: 6,
    note: API_NOTE,
    realApi: true,
  },
];
