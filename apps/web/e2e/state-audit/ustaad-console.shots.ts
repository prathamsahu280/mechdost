/**
 * Admin → Ustaad community console (spec 23 § 21g, task G2): one check per section in the real-sign-in build with the
 * audit's mocked API (a Raipur community manager), plus review screenshots at 1440 px (light, English and Hindi).
 * Each test asserts the section heading, that no API call went unmocked, and the four-eyes / blur behaviour where the
 * section has it. Opt-in screenshots: `USTAAD_CONSOLE_SHOTS=<dir>`. Config: `playwright.ustaad-console.config.ts`;
 * the build must be `.next-api` (`node scripts/state-audit-api-build.mjs`).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildCases, type AuditCase } from './cases.ts';
import { apiHooks } from './api-mode/hooks.ts';
import { localised, seedFor, settle } from './harness.ts';

const OUT = process.env.USTAAD_CONSOLE_SHOTS ?? '';

interface Scene {
  section: string;
  /** English heading of the section (the Hindi run checks the URL and the absence of errors only). */
  heading: RegExp;
  act?: (page: Page) => Promise<void>;
  check?: (page: Page) => Promise<void>;
}

const SCENES: Scene[] = [
  {
    section: 'queue',
    heading: /^Queue$/,
    act: async (page) => {
      await page
        .getByRole('button', { name: /Intimate image/ })
        .first()
        .click();
    },
    check: async (page) => {
      await expect(page.getByText('Hidden for your protection').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: /Report UR-RPR-2026-NCIAA3/ })).toBeFocused();
      // The file is fetched only when asked (that request is the audited view, with its reason), then blurred until
      // "Show clearly".
      const asked = page.waitForRequest((r) => /\/media\/[^/?]+\?reason=report_review$/.test(r.url()));
      await page.getByRole('button', { name: 'Show blurred preview' }).first().click();
      await asked;
      const img = page.getByRole('img', { name: 'Reported file 1' });
      await expect(img).toHaveClass(/blur-xl/);
      const reveal = page.getByRole('button', { name: 'Show clearly' }).first();
      await expect(reveal).toBeFocused();
      await reveal.click();
      await expect(reveal).toHaveAttribute('aria-pressed', 'true');
      await expect(img).not.toHaveClass(/blur-xl/);
    },
  },
  {
    section: 'holds',
    heading: /^Holds$/,
    act: async (page) => {
      await page
        .getByRole('button', { name: /Job scam/ })
        .first()
        .click();
    },
    check: async (page) => {
      await expect(page.getByRole('radio', { name: 'Release' })).toBeVisible();
      await expect(page.getByRole('radio', { name: 'Warn' })).toHaveCount(0);
    },
  },
  {
    section: 'appeals',
    heading: /^Appeals$/,
    act: async (page) => {
      await page
        .getByRole('button', { name: /Abuse or bad language/ })
        .first()
        .click();
    },
    check: async (page) => {
      await expect(page.getByRole('group', { name: 'Decide the appeal' })).toBeVisible();
    },
  },
  {
    section: 'verify',
    heading: /^Verify$/,
    check: async (page) => {
      await expect(page.getByText('Vouches: 2 of 2')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Issue the owner link' })).toBeVisible();
    },
  },
  {
    section: 'members',
    heading: /^Members$/,
    act: async (page) => {
      await page.getByRole('textbox', { name: 'Handle' }).fill('rame');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByRole('button', { name: /Ramesh Sahu/ }).click();
    },
    check: async (page) => {
      await expect(page.getByRole('heading', { name: /Ramesh Sahu/ })).toBeFocused();
      // Handles carry "@"; phone numbers and email addresses never appear (SR-38).
      await expect(page.getByText(/\+91|[0-9]{10}|@[a-z0-9-]+\.[a-z]{2,}/i)).toHaveCount(0);
    },
  },
  { section: 'legal', heading: /^Takedowns and legal holds$/ },
  {
    section: 'names',
    heading: /^Reserved names$/,
    check: async (page) => {
      // A community manager reads the list; only a super admin changes it.
      await expect(page.getByText('Only a super admin changes this list.')).toBeVisible();
    },
  },
  { section: 'audit', heading: /^My actions$/ },
];

async function open(page: Page, c: AuditCase) {
  const now = Date.now();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort());
  const problems = await apiHooks.install(page, c, now);
  await page.addInitScript(
    (seed: Record<string, string>) => {
      if (window.localStorage.getItem('mechdost-visual-seeded') === '1') return;
      window.localStorage.setItem('mechdost-visual-seeded', '1');
      for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    },
    { ...seedFor(c, now), ...apiHooks.seed(c, now) },
  );
  return problems;
}

test.describe('ustaad community console', () => {
  const base = buildCases().find(
    (c) => c.code === 'API-ADM-USTAAD-CONSOLE' && c.state.ustaad === 'readonly' && c.state.lists !== 'empty',
  );
  for (const scene of SCENES)
    for (const locale of ['en', 'hi'] as const) {
      test(`${scene.section} · ${locale}`, async ({ page }) => {
        test.skip(!base, 'no audit case');
        test.skip(locale === 'hi' && !OUT, 'Hindi runs only with screenshots');
        if (!base) return;
        test.setTimeout(2 * 60_000);
        const c: AuditCase = {
          ...base,
          width: 1440,
          theme: 'light',
          locale,
          state: { ...base.state, ustaad: 'readonly', lists: 'few', stress: 'none' },
          path: `/admin/ustaad?section=${scene.section}`,
        };
        const problems = await open(page, c);
        await page.goto(localised(c.path, locale));
        await settle(page);
        if (locale === 'en') {
          await expect(page.getByRole('heading', { level: 3, name: scene.heading })).toBeVisible();
          if (scene.act) await scene.act(page);
          await settle(page);
          if (scene.check) await scene.check(page);
        }
        const unmocked = (problems as { list?: string[] } | undefined)?.list ?? [];
        expect(unmocked.filter((p) => !p.includes('audit-photo'))).toEqual([]);
        if (OUT) {
          mkdirSync(OUT, { recursive: true });
          await page.screenshot({
            path: join(OUT, `${scene.section}__1440-light-${locale}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        }
      });
    }
});
