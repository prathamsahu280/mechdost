/**
 * Visual review capture, real-mode edition (user 2026-11-16: "real-mode render screenshots too"): the same matrix as
 * `e2e/visual-review.spec.ts` (390 and 1440 px, light and dark, English and Hindi, every role) but against the
 * real-sign-in build with the chunk-G mocked API (`api-mode/`), so the screens render with API data and the
 * real-mode-only states appear. Two parts:
 *
 *  1. Pages: every plain page per role (guest, customer, shop, workshop, admin) answered by the quiet baseline mocks,
 *     plus the sign-in page (empty, with errors) and, for a signed-in customer, the "already signed in" banner.
 *  2. Scenes: every distinct state of the real-sign-in cases (API-… ids: orders, service requests, quotes, portals,
 *     admin queues, cancel help, rejected totals, job card per-line status, …), with the case's own fixtures and the
 *     page set-up the audit does (open the refund, the shop panel, the form …).
 *
 * Opt-in: runs only with `VISUAL_SHOTS=<dir>` (workflow `visual-review.yml`, `mode: api`, sharded); no assertions
 * beyond "the page loaded". Config: `playwright.visual-review-api.config.ts`.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { ACCOUNT_SECTIONS, ADMIN_SECTIONS } from '../../src/lib/sections';
import { buildCases, type AuditCase, type Role } from './cases.ts';
import { apiHooks } from './api-mode/hooks.ts';
import { localised, prepare, seedFor, settle } from './harness.ts';

const SHOTS = process.env.VISUAL_SHOTS ?? '';
const CASTROL = 'castrol-activ-4t-20w40-900ml';
const MOTUL = 'motul-3100-4t-10w30-1l';
/** Most scenes kept per component (`VISUAL_SCENES_PER_CODE`; the whole list for a component with fewer). */
const PER_CODE = Number(process.env.VISUAL_SCENES_PER_CODE ?? 10);
const WIDTHS = [390, 1440] as const;
const THEMES = ['light', 'dark'] as const;
const LOCALES = ['en', 'hi'] as const;

const GUEST_PAGES = [
  '/',
  '/shop',
  '/shop?category=lubricants',
  `/shop/${CASTROL}`,
  `/compare?p=${CASTROL},${MOTUL}`,
  '/cart',
  '/checkout',
  '/offers',
  '/workshops',
  '/workshops/home-garage-1',
  '/partners',
  '/partners/apply/seller',
  '/support',
  '/support/guest',
  '/quotes/new',
  '/policies/returns',
  '/policies/privacy',
  '/policies/company',
  '/terms',
  '/login',
  '/no-such-page',
];
const CUSTOMER_PAGES = [
  '/account',
  ...ACCOUNT_SECTIONS.filter((s) => s !== 'overview').map((s) => `/account/${s}`),
  '/notifications',
  '/login',
];
const ROLES = [
  { role: 'guest', auth: 'out' as const, pages: GUEST_PAGES },
  { role: 'customer', auth: 'customer', pages: CUSTOMER_PAGES },
  { role: 'shop', auth: 'shop', pages: ['/partner/shop'] },
  { role: 'workshop', auth: 'workshop', pages: ['/partner/workshop'] },
  {
    role: 'admin',
    auth: 'admin',
    pages: ['/admin', ...ADMIN_SECTIONS.filter((s) => s !== 'overview').map((s) => `/admin/${s}`)],
  },
] as const;

/** State dimensions that only change what the audit measures (hover, focus, data stress), not what a person sees. */
const NOT_VISUAL = new Set(['interaction', 'stress']);

const slug = (s: string) => s.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '_') || 'home';
const hash = (s: string) => {
  let h = 5381;
  for (const ch of s) h = (h * 33) ^ ch.charCodeAt(0);
  return (h >>> 0).toString(36);
};

/** A plain page as an audit case, so the audit's mocks, session and seed apply to it unchanged. */
function pageCase(auth: Role, width: number, theme: 'light' | 'dark', locale: 'en' | 'hi'): AuditCase {
  return {
    id: `VISUAL-${auth}`,
    code: 'VISUAL',
    page: 'visual',
    component: 'visual',
    strategy: 'cross',
    path: '/',
    scope: 'main',
    width,
    theme,
    locale,
    auth,
    world: 'empty',
    state: {},
    checks: [],
    align: [],
    sweep: 0,
    mustShow: null,
    tier: 'full',
    realApi: true,
    nav: null,
  };
}

/** One case per distinct look: width, theme and language are replayed over it. */
function scenes(): AuditCase[] {
  const seen = new Map<string, AuditCase>();
  for (const c of buildCases()) {
    if (!c.realApi) continue;
    const state = Object.entries(c.state)
      .filter(([k]) => !NOT_VISUAL.has(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([c.code, c.auth, c.path, c.world, state]);
    if (!seen.has(key)) seen.set(key, c);
  }
  // The navigation walks show pages the page set already captures; a component with many pairwise states keeps an
  // evenly spaced sample (the list runs through its states in order), so the run stays within a few shards.
  const byCode = new Map<string, AuditCase[]>();
  for (const c of seen.values()) {
    if (c.code.startsWith('API-NAV-')) continue;
    byCode.set(c.code, [...(byCode.get(c.code) ?? []), c]);
  }
  return [...byCode.values()].flatMap((list) => {
    const keep = new Set(
      Array.from({ length: PER_CODE }, (_, i) => Math.floor((i * list.length) / PER_CODE)),
    );
    return list.length <= PER_CODE ? list : list.filter((_, i) => keep.has(i));
  });
}

async function seedAndInstall(page: Page, c: AuditCase) {
  const now = Date.now();
  await page.setViewportSize({ width: c.width, height: c.width < 768 ? 844 : 900 });
  await page.emulateMedia({ colorScheme: c.theme });
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await apiHooks.install(page, c, now);
  await page.addInitScript(
    (seed: Record<string, string>) => {
      if (window.localStorage.getItem('mechdost-visual-seeded') === '1') return;
      window.localStorage.setItem('mechdost-visual-seeded', '1');
      for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    },
    { ...seedFor(c, now), ...apiHooks.seed(c, now) },
  );
}

async function shoot(page: Page, file: string) {
  await settle(page);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
}

test.describe('visual review capture (real mode)', () => {
  test.skip(!SHOTS, 'set VISUAL_SHOTS=<dir> to capture');

  for (const { role, auth, pages } of ROLES)
    for (const width of WIDTHS)
      for (const theme of THEMES)
        for (const locale of LOCALES)
          test(`pages · ${role} · ${String(width)} · ${theme} · ${locale}`, async ({ page }) => {
            test.setTimeout(20 * 60_000);
            const c = pageCase(auth, width, theme, locale);
            await seedAndInstall(page, c);
            const dir = join(SHOTS, 'pages', role);
            mkdirSync(dir, { recursive: true });
            const tail = `${String(width)}-${theme}-${locale}`;
            for (const path of pages) {
              await page.goto(localised(path, locale));
              await shoot(page, join(dir, `${slug(path)}__${tail}.png`));
              // The sign-in page with its errors showing (submitted empty): the real-mode form states.
              if (path === '/login' && role === 'guest') {
                await page
                  .locator('main form button[type="submit"]')
                  .first()
                  .click({ timeout: 3_000 })
                  .catch(() => undefined);
                await page.waitForTimeout(300);
                await shoot(page, join(dir, `login-errors__${tail}.png`));
              }
            }
          });

  for (const scene of scenes()) {
    const state = Object.entries(scene.state)
      .filter(([k]) => !NOT_VISUAL.has(k))
      .map(([k, v]) => `${k}-${v}`)
      .join('_');
    const name = `${scene.code}__${scene.auth}__${slug(state).slice(0, 60)}__${hash(`${scene.path}|${state}`)}`;
    for (const width of WIDTHS)
      for (const theme of THEMES)
        for (const locale of LOCALES)
          test(`scene · ${scene.id} · ${String(width)} · ${theme} · ${locale}`, async ({ page }) => {
            test.setTimeout(3 * 60_000);
            const c: AuditCase = { ...scene, width, theme, locale };
            await seedAndInstall(page, c);
            await page.goto(localised(c.path, locale));
            await settle(page);
            await apiHooks.prepare(page, c);
            await prepare(page, c).catch(() => undefined);
            const dir = join(SHOTS, 'scenes', scene.code);
            mkdirSync(dir, { recursive: true });
            await shoot(page, join(dir, `${name}__${String(width)}-${theme}-${locale}.png`));
          });
  }
});
