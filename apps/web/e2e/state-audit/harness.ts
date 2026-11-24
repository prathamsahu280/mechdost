/**
 * Runs one audit case (`cases.ts`) in Playwright: seeds the demo store, opens the page at the case's width,
 * theme and language, performs the case's interaction or action, applies data-shape stress, then measures
 * (`geometry.ts`), sweeps hover and keyboard focus over the component's controls, runs axe and the Hindi gate,
 * and fails with a screenshot (offending boxes outlined) and the state description.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { CONSENT_NOTICE_VERSION } from '@mechdost/shared/privacy';
import { latinOffenders } from '../../test/hindi-allowlist';
import { busyWorld } from '../fixtures/demo-world';
import { describeCase, type AuditCase } from './cases.ts';
import {
  applyStress,
  auditDom,
  behindOpenLayer,
  centre,
  compareFacts,
  compareProblems,
  trayHiddenByBanner,
  focusFacts,
  markControls,
  markStepper,
  paintFindings,
  rememberShadows,
  scopeText,
  syncFacts,
  type Box,
  type Finding,
} from './geometry.ts';
import { isBlockedOriginNoise } from './console-noise.ts';
import { dismissCheck } from './dismiss.ts';
import { filledFieldValue } from './fill-values.ts';
import { echoedWords, withoutEcho } from './hindi-echo.ts';
import { knownIssueFor } from './known-issues.ts';
import { navCheck } from './nav-run.ts';
import { CARTS, COMPARES, PRODUCTS, TRUST_KEYS } from './model.ts';

/** Never measured: the map canvas, its controls and pins (dedicated map tests cover them, T10). */
const IGNORE =
  '.maplibregl-map, .maplibregl-canvas-container, .maplibregl-control-container, [data-sa-paint]';
/** "Essential only" answered on the current notice: a stale version would show the banner again over the row. */
const CONSENT = JSON.stringify({
  analytics: false,
  version: CONSENT_NOTICE_VERSION,
  at: '2026-11-01T00:00:00.000Z',
});
const ACCOUNTS: Readonly<Record<string, string | null>> = {
  out: null,
  customer: 'demo-customer',
  shop: 'demo-shop',
  workshop: 'demo-workshop',
  admin: 'demo-admin',
};
/** The state matrix's "cart" world: a battery and two engine oils in the cart, two oils in the compare list. */
const CART_WORLD = {
  cart: [
    { slug: PRODUCTS.exide, qty: 1 },
    { slug: PRODUCTS.castrol, qty: 2 },
  ],
  compare: { category: 'lubricants', slugs: [PRODUCTS.castrol, PRODUCTS.motul] },
};

const LONG_HI =
  'महात्मा गांधी मार्ग, शंकर नगर, पुरानी बस्ती के पास, रायपुर छत्तीसगढ़ की सबसे लंबी गली संख्या बयालीस';

/**
 * The signed-in demo customer with saved vehicles and addresses at a given size (state `data`): none, one, the
 * limit of 10, or one of each with very long Hindi text. Same shape as `DemoAccount` (`src/demo/session-state.ts`).
 */
function customerWithSavedData(kind: string) {
  const count = kind === 'empty' ? 0 : kind === 'limit' ? 10 : 1;
  const long = kind === 'long';
  const types = ['2W', '3W', '4W'] as const;
  return {
    id: 'demo-customer',
    phone: '9876543210',
    name: 'Ravi Sahu',
    email: 'ravi.sahu@example.com',
    role: 'customer',
    partner: null,
    language: 'en',
    createdAt: '2026-09-12T10:00:00.000Z',
    vehicles: Array.from({ length: count }, (_, i) => ({
      id: `veh-audit-${String(i)}`,
      type: types[i % 3],
      make: long ? LONG_HI.slice(0, 40) : 'Honda',
      model: long ? LONG_HI.slice(0, 60) : `Activa ${String(i + 1)}`,
      year: 2015 + (i % 10),
      fuel: 'petrol',
      registration: `CG04 MK 22${String(i).padStart(2, '0')}`,
      odometerKm: 10_000 * (i + 1),
    })),
    addresses: Array.from({ length: count }, (_, i) => ({
      id: `addr-audit-${String(i)}`,
      label: long ? LONG_HI.slice(0, 30) : '',
      line1: long ? LONG_HI : `C-${String(605 + i)} Salasar Greens, Sarona`,
      landmark: long ? LONG_HI.slice(0, 100) : 'Near Tatibandh chowk',
      pincode: '492099',
      isDefault: i === 0,
    })),
  };
}

const LONG_TRUST = {
  en: 'Only original parts from verified shops, with a bill for every order. Ask us anything on WhatsApp before you buy, in English or Hindi.',
  hi: 'केवल असली पार्ट्स, सत्यापित दुकानों से, हर ऑर्डर के साथ बिल। ख़रीदने से पहले WhatsApp पर हमसे कुछ भी पूछें, हिंदी या अंग्रेज़ी में, हम तुरंत जवाब देते हैं।',
} as const;
const SHORT_TRUST = { en: 'Genuine parts, bill included.', hi: 'असली पार्ट्स, बिल सहित।' } as const;

/**
 * The demo site config the case seeds for the `trust` and `promise` states (design 2026-11-15): trust lines as the
 * locale-file default, a short admin wording, a 140-character wording, or hidden with "-"; the labour promise off or on
 * for 30 days (on the bill of the busy world's billed request too).
 */
function trustSeed(c: AuditCase, now: number): Record<string, string> {
  const { trust, promise } = c.state;
  if (trust === undefined && promise === undefined) return {};
  const text = (locale: 'en' | 'hi') =>
    trust === 'override'
      ? SHORT_TRUST[locale]
      : trust === 'long'
        ? LONG_TRUST[locale]
        : trust === 'hidden'
          ? '-'
          : '';
  const content: Record<string, Record<string, string>> = {};
  if (trust !== undefined && trust !== 'default')
    for (const key of TRUST_KEYS) content[key] = { en: text('en'), hi: text('hi') };
  const out: Record<string, string> = {
    'mechdost-demo-site': JSON.stringify({
      content,
      settings: { labourPromiseDays: promise === 'on' ? 30 : 0 },
    }),
  };
  if (promise === 'on' && c.world === 'busy') {
    // the billed request of the busy world carries the promise frozen on its bill
    const seeded = busyWorld(now)['mechdost-demo-requests'];
    const requests = Array.isArray(seeded) ? (seeded as { bill?: object }[]) : [];
    out['mechdost-demo-requests'] = JSON.stringify(
      requests.map((r) => (r.bill ? { ...r, bill: { ...r.bill, labourPromiseDays: 30 } } : r)),
    );
  }
  return out;
}

export const localised = (path: string, locale: string) =>
  locale === 'en' ? path : path === '/' ? '/hi' : `/hi${path}`;

/** What the case stores before the first page load (once per test; later loads keep what the app changed). */
export function seedFor(c: AuditCase, now: number): Record<string, string> {
  const seed: Record<string, string> = { 'mechdost-theme': c.theme };
  if (c.state.consent !== 'open') seed['mechdost-consent'] = CONSENT;
  const account = ACCOUNTS[c.auth];
  if (account)
    seed['mechdost-demo-session'] = JSON.stringify([
      { accountId: account, signedInAt: new Date(now).toISOString() },
    ]);
  if (c.state.data !== undefined)
    seed['mechdost-demo-accounts'] = JSON.stringify([customerWithSavedData(c.state.data)]);
  if (c.world === 'busy') for (const [k, v] of Object.entries(busyWorld(now))) seed[k] = JSON.stringify(v);
  if (c.world === 'cart') {
    seed['mechdost-cart'] = JSON.stringify(CART_WORLD.cart);
    seed['mechdost-compare'] = JSON.stringify(CART_WORLD.compare);
  }
  Object.assign(seed, trustSeed(c, now));
  const cart = c.state.cart;
  if (cart !== undefined) {
    const lines = CARTS[cart];
    if (!lines) throw new Error(`${c.id}: unknown cart state ${cart}`);
    seed['mechdost-cart'] = JSON.stringify(lines);
  }
  const qty = c.state.qty;
  if (qty !== undefined)
    seed['mechdost-cart'] = JSON.stringify([{ slug: PRODUCTS.castrol, qty: Number(qty) }]);
  const compare = c.state.compare;
  if (compare !== undefined) {
    if (!(compare in COMPARES)) throw new Error(`${c.id}: unknown compare state ${compare}`);
    const list = COMPARES[compare];
    if (list) seed['mechdost-compare'] = JSON.stringify(list);
    else delete seed['mechdost-compare'];
  }
  return seed;
}

/**
 * The first submit button the "errors" step presses. Enabled ones only: a disabled one (the quote chat's Send with
 * nothing typed) makes Playwright wait for it to turn on, which used up the 90 s test budget (QT-PAGES, 2026-11-16).
 */
export const SUBMIT_SELECTOR = 'form button[type="submit"]:visible:enabled';

export async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/** Opens disclosures, fills or submits forms, presses card actions — whatever the case's state names. */
export async function prepare(page: Page, c: AuditCase): Promise<string[]> {
  const notes: string[] = [];
  const scope = page.locator(c.scope).first();
  const open = c.state.open;
  if (open === 'first' || open === 'last' || open === 'all') {
    if (c.code === 'HOME-FAQ') {
      if (open === 'all')
        await page.evaluate((s) => {
          for (const d of document.querySelectorAll(`${s} details`)) d.setAttribute('open', '');
        }, c.scope);
      else await scope.locator('summary').first().click();
    } else if (c.code === 'SHOP-POPOVER') {
      const infos = page.locator('main article button[data-track^="product_info_"]');
      await (open === 'first' ? infos.first() : infos.nth(Math.max(0, (await infos.count()) - 1))).click();
    } else if (c.code === 'CHR-ACCOUNT-MENU') {
      await page.locator('header [data-track="header_account"]').click();
      // The menu is a lazy chunk: wait for it, so the audit never measures the gap between click and mount.
      await page.locator('header [role="menu"]').waitFor({ state: 'visible' });
    } else if (c.code === 'CHR-SEARCH' || c.code === 'CHR-SEARCH-ROADSIDE') {
      // The desktop pill from 1024 px, the full-width bar under it; both open the same palette.
      const pill = page.locator('[data-track="header_search"]');
      await ((await pill.isVisible()) ? pill : page.locator('[data-track="header_search_phone"]')).click();
      await page.locator('[role="dialog"][aria-modal="true"]').waitFor({ state: 'visible' });
      if (c.code === 'CHR-SEARCH-ROADSIDE') {
        // A breakdown word puts "Roadside help" on top of the suggestions (spec 22, 2026-11-24).
        await page.getByRole('combobox').fill(c.locale === 'hi' ? 'पंक्चर' : 'puncture');
        await page.getByRole('option').first().waitFor({ state: 'visible' });
      }
    } else if (c.code === 'CHR-ASSIST') {
      await page.locator('.assistant-launcher').click();
      // The panel is a lazy chunk: wait for it, so the audit never measures the gap between click and mount.
      await page.locator('#assistant-panel').waitFor({ state: 'visible' });
    }
  }
  const tab = c.state.tab;
  if (tab)
    await scope
      .locator(`#partners-tab-${tab}`)
      .click()
      .catch(() => notes.push(`tab ${tab} not found`));
  const form = c.state.form;
  if (form === 'filled' || form === 'errors') {
    const root = page.locator('main');
    if (form === 'filled') {
      const fields = root.locator(
        'input[type="text"]:visible, input[type="tel"]:visible, input[type="email"]:visible, input:not([type]):visible, textarea:visible',
      );
      const n = await fields.count();
      for (let i = 0; i < n; i++) {
        const f = fields.nth(i);
        const type = (await f.getAttribute('type')) ?? 'text';
        const name =
          `${(await f.getAttribute('name')) ?? ''} ${(await f.getAttribute('id')) ?? ''}`.toLowerCase();
        const value = filledFieldValue(type, name, c.locale);
        await f.fill(value, { timeout: 3_000 }).catch(() => notes.push(`could not fill field ${String(i)}`));
      }
    } else {
      const submit = root.locator(SUBMIT_SELECTOR).first();
      if ((await submit.count()) > 0)
        await submit.click({ timeout: 3_000 }).catch(() => notes.push('submit not clickable'));
      else notes.push('no enabled submit button found');
    }
  }
  const action = c.state.action;
  if (action && action !== 'none') {
    const card = (slug: string) => page.locator(`main article:has(a[data-track="product_${slug}"])`);
    const lub = card(PRODUCTS.castrol);
    if (action === 'compare-other' || action === 'start-new') {
      await lub.locator('input[type="checkbox"][data-compare-toggle]').click();
      // The tray asks (compare redesign 2026-11-14): "Start new" is the question's first button.
      if (action === 'start-new')
        await page.locator('[data-compare-tray] [role="dialog"] button').first().click();
    } else if (action === 'add') {
      await card(PRODUCTS.motul).locator('[data-slot="add-to-cart"]').first().click();
    } else if (action === 'inc' || action === 'dec-remove') {
      const part: 'inc' | 'dec' = action === 'inc' ? 'inc' : 'dec';
      const times = action === 'inc' ? 1 : 2;
      for (let i = 0; i < times; i++) {
        const ok = await page.evaluate(markStepper, { scope: c.scope, slug: PRODUCTS.castrol, part });
        if (!ok) {
          notes.push(`no stepper to press (${part})`);
          break;
        }
        await page.locator('[data-sa-target]').click();
      }
    }
    await settle(page);
  }
  return notes;
}

/** Stepper interaction cases: hover, keyboard focus or press one part, measure while it holds. */
async function interact(page: Page, c: AuditCase, run: (label: string) => Promise<void>): Promise<string[]> {
  const notes: string[] = [];
  const interaction = c.state.interaction;
  if (!interaction || interaction === 'none') return notes;
  const part: 'inc' | 'dec' = interaction.endsWith('-dec') ? 'dec' : 'inc';
  const slug = c.state.surface === 'card' ? PRODUCTS.castrol : null;
  const scope = c.state.surface === 'cart' ? 'main [role="group"]' : c.scope;
  const marked = await page.evaluate(markStepper, { scope: slug ? c.scope : scope, slug, part });
  if (!marked) {
    notes.push('stepper not found');
    return notes;
  }
  const target = page.locator('[data-sa-target]');
  await target.evaluate(centre);
  const disabled = await target.isDisabled();
  if (interaction.startsWith('hover')) {
    await target.hover({ force: disabled });
  } else if (interaction.startsWith('focus')) {
    if (disabled) {
      notes.push('control disabled at this quantity: focus not possible (by design)');
      return notes;
    }
    await target.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
  } else if (interaction === 'active-inc') {
    await target.hover({ force: disabled });
    await page.mouse.down();
  }
  await page.evaluate(() => {
    document.querySelector('[data-sa-target]')?.setAttribute('data-sa-focus', '');
  });
  await run(`while ${interaction}`);
  if (interaction === 'active-inc') {
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
  await page.evaluate(() => {
    document.querySelector('[data-sa-focus]')?.removeAttribute('data-sa-focus');
  });
  return notes;
}

/**
 * Review screenshots (`STATE_AUDIT_SHOTS=<folder>`): a viewport picture of the case as the audit saw it, scrolled the
 * way a visitor would be (scroll rows 250 px down, card rows to the first card, footer rows to the foot). Off unless
 * the variable is set; used to show the user a change before it ships.
 */
async function takeReviewShot(page: Page, c: AuditCase): Promise<void> {
  const dir = process.env.STATE_AUDIT_SHOTS;
  if (!dir) return;
  const scrollTo = (y: number | 'end') =>
    page.evaluate((to) => {
      window.scrollTo(0, to === 'end' ? document.body.scrollHeight : to);
    }, y);
  if (c.code.endsWith('SCROLL')) await scrollTo(250);
  else if (c.code === 'CHR-FOOTER') await scrollTo('end');
  else if ((await page.locator('main article').count()) > 0)
    await page.locator('main article').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/${c.id}.png` });
}

const summarise = (fs: readonly Finding[]) => {
  const counts = new Map<string, number>();
  for (const f of [...fs].sort((a, b) => a.severity.localeCompare(b.severity))) {
    const k = `${f.severity} ${f.rule}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `${k} ×${String(n)}`).join('; ');
};

/**
 * What the API-mode audit adds to a case (`api-mode/`): the mocked API and session, the extra stored state, and the
 * page set-up the real-mode screens need. Absent for the demo audit.
 */
export interface ApiHooks {
  install(page: Page, c: AuditCase, now: number): Promise<{ list: string[]; expectsErrors: boolean }>;
  seed(c: AuditCase, now: number): Record<string, string>;
  prepare(page: Page, c: AuditCase): Promise<string[]>;
}

export async function runCase(page: Page, c: AuditCase, info: TestInfo, api?: ApiHooks): Promise<void> {
  const allowKnown = process.env.STATE_AUDIT_KNOWN === 'allow';
  const now = Date.now();
  await page.setViewportSize({ width: c.width, height: c.width < 768 ? 844 : 900 });
  // The saved theme is the opposite of the system one, so a lost choice shows; reduced motion measures the
  // final state of every transition (T7).
  await page.emulateMedia({ colorScheme: c.theme === 'light' ? 'dark' : 'light', reducedMotion: 'reduce' });
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const apiState = api ? await api.install(page, c, now) : null;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !isBlockedOriginNoise(m.text(), m.location().url))
      errors.push(`console: ${m.text().slice(0, 200)} @ ${m.location().url}`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith('http://localhost') && r.status() >= 400)
      errors.push(`${String(r.status())} ${r.url()}`);
  });
  await page.addInitScript(
    (seed: Record<string, string>) => {
      if (window.localStorage.getItem('mechdost-e2e-seeded') === '1') return;
      window.localStorage.setItem('mechdost-e2e-seeded', '1');
      for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    },
    { ...seedFor(c, now), ...api?.seed(c, now) },
  );

  const url = localised(c.path, c.locale);
  await page.goto(url);
  await settle(page);
  // API screens first open what the case names (a refund, a shop), then the shared form step fills or submits.
  const notes = api ? await api.prepare(page, c) : [];
  notes.push(...(await prepare(page, c)));
  if (c.state.stress && c.state.stress !== 'none')
    await page.evaluate(applyStress, { scope: c.scope, stress: c.state.stress, locale: c.locale });

  const findings: Finding[] = [];
  const has = (k: string) => (c.checks as readonly string[]).includes(k);
  // The privacy banner hides the compare tray below 1024 px until it is answered (decision 2026-11-14): by design.
  const trayWaits =
    c.code === 'SHOP-TRAY' &&
    trayHiddenByBanner({
      consentOpen: c.state.consent === 'open',
      width: c.width,
      compare: COMPARES[c.state.compare ?? 'none']?.slugs.length ?? 0,
    });
  const domRules = [
    'present',
    'inside',
    'overlap',
    'covered',
    'launcher',
    'clipped',
    'aligned',
    'tap',
    'hscroll',
    'offphoto',
    'scroll',
  ].filter((k) => has(k) && !(trayWaits && k === 'present'));
  const localRules = ['inside', 'overlap', 'covered'].filter(has);
  const local = async (label: string) => {
    if (localRules.length === 0) return;
    const fs = await page.evaluate(auditDom, {
      scope: c.scope,
      rules: localRules,
      align: [],
      ignore: IGNORE,
      local: true,
      scan: false,
    });
    for (const f of fs) findings.push({ ...f, detail: `${label}: ${f.detail}` });
  };

  // Interaction cases measure while the pointer or focus holds.
  notes.push(...(await interact(page, c, local)));

  // Whole-component measurement.
  findings.push(
    ...(await page.evaluate(auditDom, {
      scope: c.scope,
      rules: domRules,
      align: c.align,
      ignore: IGNORE,
      local: false,
      scan: true,
    })),
  );
  if (c.mustShow && (await page.locator(c.scope).filter({ hasText: c.mustShow }).count()) === 0)
    findings.push({ rule: 'present', severity: 'P0', where: c.scope, detail: `must show "${c.mustShow}"` });

  if (has('sync'))
    for (const p of [
      ...(await page.evaluate(syncFacts)),
      ...compareProblems(await page.evaluate(compareFacts)),
    ])
      findings.push({ rule: 'sync', severity: 'P0', where: 'store', detail: p });

  // Hover sweep: every kind of control once, then more up to the cap.
  if (c.sweep > 0 && localRules.length > 0) {
    const n = await page.evaluate(markControls, { scope: c.scope, max: c.sweep, ignore: IGNORE });
    for (let i = 0; i < n; i++) {
      const el = page.locator(`[data-sa-i="${String(i)}"]`);
      const name =
        (await el.getAttribute('aria-label')) ?? ((await el.textContent()) ?? '').trim().slice(0, 30);
      try {
        await el.evaluate(centre);
        // Under an open dialog, popover or viewer the control cannot be reached, and nothing is wrong.
        if (await el.evaluate(behindOpenLayer)) continue;
        await el.hover({ timeout: 2_000 });
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e))
          .split('\n')
          .find((l) => /intercepts|outside|not visible|detached/.test(l));
        if (msg?.includes('intercepts'))
          findings.push({
            rule: 'covered',
            severity: 'P0',
            where: name,
            detail: `cannot hover: ${msg.trim()}`,
          });
        continue;
      }
      await el.evaluate((node) => {
        node.setAttribute('data-sa-focus', '');
      });
      await local(`while hovering "${name}"`);
      await el.evaluate((node) => {
        node.removeAttribute('data-sa-focus');
      });
    }
    await page.mouse.move(0, 0);
  }

  // Keyboard focus sweep: Tab through the component, every stop needs a visible, unclipped ring.
  if (has('focus')) {
    await page.evaluate(rememberShadows, { scope: c.scope });
    const started = await page.evaluate((s) => {
      const root = document.querySelector<HTMLElement>(s);
      if (!root) return false;
      // Focus the component root itself (kept focusable for the rest of this test), so the first Tab lands on
      // its first control with keyboard modality (:focus-visible).
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      root.focus({ preventScroll: true });
      return true;
    }, c.scope);
    const max = Math.max(8, c.sweep);
    for (let i = 0; started && i < max; i++) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(focusFacts, { scope: c.scope });
      if (!f.inScope) break;
      if (!f.visible)
        findings.push({
          rule: 'focus',
          severity: 'P1',
          where: f.where,
          detail: 'no visible focus ring',
          box: f.box ?? undefined,
        });
      else if (f.ringClipped > 2)
        findings.push({
          rule: 'focus-clipped',
          severity: 'P2',
          where: f.where,
          detail: `focus ring cut by ${String(f.ringClipped)} px by a container`,
          box: f.box ?? undefined,
        });
      if (i < 6) {
        await page.evaluate(() => document.activeElement?.setAttribute('data-sa-focus', ''));
        await local(`while focused on ${f.where}`);
        await page.evaluate(() => document.activeElement?.removeAttribute('data-sa-focus'));
      }
    }
  }

  if (has('axe')) {
    // From the top of the page: a sticky side bar that has slid under the sticky header at the end of a scan is not
    // a target a visitor can use there (axe counts the header over it as an overlap; triage 2026-11-16, ACC-COINS).
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    const result = await new AxeBuilder({ page })
      .include(c.scope)
      .exclude(IGNORE)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
      .catch(() => null);
    for (const v of result?.violations ?? [])
      findings.push({
        rule: `axe:${v.id}`,
        severity: v.impact === 'critical' || v.impact === 'serious' ? 'P1' : 'P2',
        where: v.nodes[0]?.target.join(' ') ?? c.scope,
        detail: `${v.help} (${String(v.nodes.length)} nodes)`,
      });
  }

  if (has('hindi') && c.locale === 'hi') {
    const text = (await page.evaluate(scopeText, { scope: c.scope })).join('\n');
    const words = latinOffenders(withoutEcho(text, echoedWords(c.path)));
    if (words.length > 0)
      findings.push({
        rule: 'hindi',
        severity: 'P1',
        where: c.scope,
        detail: `English on /hi: ${words.slice(0, 12).join(', ')}`,
      });
  }

  // Panels opened by a button can be closed (clicks the openers, so it runs after the measurements).
  if (has('dismiss')) findings.push(...(await dismissCheck(page, c.scope)));

  // Last: the walk leaves the page.
  if (has('nav')) findings.push(...(await navCheck(page, c)));

  for (const p of apiState?.list ?? [])
    findings.push({ rule: 'api-mock', severity: 'P0', where: 'mock API', detail: p });

  // Error statuses the case asks for make the browser log "Failed to load resource": not a finding.
  const consoleErrors = apiState?.expectsErrors
    ? errors.filter((e) => !e.includes('Failed to load resource'))
    : errors;
  if (has('console'))
    for (const e of consoleErrors)
      findings.push({ rule: 'console', severity: 'P1', where: 'page', detail: e });

  // Report.
  const known: Finding[] = [];
  const failing: Finding[] = [];
  const notesOnly: Finding[] = [];
  for (const f of findings) {
    if (f.severity === 'P2') notesOnly.push(f);
    else if (allowKnown && knownIssueFor(c, f)) known.push(f);
    else failing.push(f);
  }
  const summary = summarise([...failing, ...notesOnly]);
  await takeReviewShot(page, c);
  await info.attach('state-audit-summary', { body: summary, contentType: 'text/plain' });
  await info.attach('state-audit-findings', {
    body: JSON.stringify({ id: c.id, state: describeCase(c), url, notes, findings }, null, 2),
    contentType: 'application/json',
  });
  for (const f of notesOnly.slice(0, 10))
    info.annotations.push({ type: `P2 ${f.rule}`, description: `${f.where}: ${f.detail}` });
  for (const f of known.slice(0, 10))
    info.annotations.push({ type: 'known issue', description: `${f.rule} ${f.where}: ${f.detail}` });

  if (failing.length > 0) {
    const boxes = failing.map((f) => f.box).filter((b): b is Box => b !== undefined);
    await page.evaluate(paintFindings, boxes);
    const first = boxes[0];
    if (first)
      await page.evaluate((y) => {
        window.scrollTo(0, Math.max(0, y - 120));
      }, first.y);
    const path = info.outputPath('state-audit-failure.png');
    await page.screenshot({ path, fullPage: false });
    await info.attach('state-audit-failure', { path, contentType: 'image/png' });
  }
  const message = [
    `${c.id} · ${describeCase(c)}`,
    ...notes.map((n) => `note: ${n}`),
    ...failing.map((f) => `${f.severity} ${f.rule} · ${f.where} · ${f.detail}`),
  ].join('\n');
  expect(failing.length, message).toBe(0);
}
