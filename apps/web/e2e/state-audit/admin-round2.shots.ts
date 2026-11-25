/**
 * Review screenshots of the admin page pattern (design 2026-11-25, admin round 2): a handful of admin scenes in the
 * real-sign-in build with the audit's mocked API (so the screens have realistic data), at 390 and 1440 px, light and
 * dark, and Hindi for a few. Opt-in: runs only with `ROUND2_SHOTS=<dir>`; no assertions beyond "the page loaded".
 * Config: `playwright.admin-round2.config.ts`. The build must be `.next-api` (`node scripts/state-audit-api-build.mjs`),
 * or another dist dir named by `NEXT_DIST_DIR` (the "before" build of the base commit uses `.next-api-before`).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { buildCases, type AuditCase } from './cases.ts';
import { apiHooks } from './api-mode/hooks.ts';
import { localised, prepare, seedFor, settle } from './harness.ts';

const OUT = process.env.ROUND2_SHOTS ?? '';
const TAG = process.env.ROUND2_TAG ?? 'after';

interface Scene {
  name: string;
  code: string;
  /** Picks the audit case whose mocks and set-up make the scene (first match). */
  pick: (c: AuditCase) => boolean;
  /** The page to open when it is not the case's own. */
  path?: string;
  hindi?: boolean;
}

const SCENES: Scene[] = [
  { name: 'overview', code: 'API-ADM-ANALYTICS', pick: () => true, path: '/admin', hindi: true },
  {
    name: 'orders',
    code: 'API-ADM-QUEUE',
    pick: (c) => c.state.queue === 'many',
    hindi: true,
  },
  { name: 'catalogue', code: 'API-ADM-RECO', pick: () => true },
  { name: 'support', code: 'API-ADM-SUPPORT', pick: (c) => c.state.tickets === 'open-photos' },
  { name: 'settings', code: 'API-ADM-SETTINGS', pick: (c) => c.state.edit === 'dirty', hindi: true },
  { name: 'empty-orders', code: 'API-ADM-QUEUE', pick: (c) => c.state.queue === 'empty' },
];

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

test.describe('admin round 2 screenshots', () => {
  test.skip(!OUT, 'set ROUND2_SHOTS=<dir> to capture');
  const cases = buildCases();
  for (const scene of SCENES) {
    const base = cases.find((c) => c.code === scene.code && c.realApi && scene.pick(c));
    if (!base) continue;
    for (const width of [390, 1440] as const)
      for (const theme of ['light', 'dark'] as const)
        for (const locale of ['en', 'hi'] as const) {
          if (locale === 'hi' && (!scene.hindi || theme === 'dark')) continue;
          test(`${scene.name} · ${String(width)} · ${theme} · ${locale}`, async ({ page }) => {
            test.setTimeout(3 * 60_000);
            const c: AuditCase = { ...base, width, theme, locale, path: scene.path ?? base.path };
            await seedAndInstall(page, c);
            await page.goto(localised(c.path, locale));
            await settle(page);
            await apiHooks.prepare(page, c);
            await prepare(page, c).catch(() => undefined);
            await settle(page);
            mkdirSync(join(OUT, TAG), { recursive: true });
            await page.screenshot({
              path: join(OUT, TAG, `${scene.name}__${String(width)}-${theme}-${locale}.png`),
              fullPage: true,
              animations: 'disabled',
            });
          });
        }
  }
});
