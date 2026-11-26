/**
 * Admin → Usage & limits (founder 2026-11-26; spec 08): checks in the real-sign-in build with the audit's mocked API
 * (`api-mode/usage-fixtures.ts`), plus review screenshots (1440 light English and Hindi, 390 light English).
 * Asserts the header action, the bullet bars, the inline limit form's focus path, Check now's announcement, the
 * read-only view and the never-checked empty state, and that no API call went unmocked. Opt-in screenshots:
 * `USAGE_SHOTS=<dir>`. Config: `playwright.usage.config.ts`; the build must be `.next-api`
 * (`node scripts/state-audit-api-build.mjs`).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildCases, type AuditCase } from './cases.ts';
import { apiHooks } from './api-mode/hooks.ts';
import { localised, seedFor, settle } from './harness.ts';

const OUT = process.env.USAGE_SHOTS ?? '';

async function open(page: Page, c: AuditCase) {
  const now = Date.now();
  await page.setViewportSize({ width: c.width, height: 900 });
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
  await page.goto(localised('/admin/usage', c.locale));
  await settle(page);
  return problems as { list?: string[] } | undefined;
}

const base = buildCases().find((c) => c.code === 'API-ADM-USAGE');
const variant = (usage: string, locale: 'en' | 'hi' = 'en', width = 1440): AuditCase | null =>
  base
    ? {
        ...base,
        width,
        theme: 'light',
        locale,
        state: { ...base.state, usage, stress: 'none' },
        path: '/admin/usage',
      }
    : null;

const shot = async (page: Page, name: string) => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true, animations: 'disabled' });
};

test.describe('admin usage & limits', () => {
  test.skip(!base, 'no audit case');

  test('full: bars, edit focus path, Check now announces', async ({ page }) => {
    const c = variant('full');
    if (!c) return;
    const problems = await open(page, c);
    await expect(page.getByRole('heading', { level: 2, name: 'Usage & limits' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Cloudflare R2 (Ustaad media)' })).toBeVisible();
    const meters = page.getByRole('meter');
    expect(await meters.count()).toBeGreaterThanOrEqual(6);
    await expect(page.getByRole('meter', { name: 'Database size' })).toHaveAttribute(
      'aria-valuetext',
      /93% used, Critical/,
    );
    await expect(page.getByText('Marks on the bars: warning at 70%, critical at 90%')).toBeVisible();
    await shot(page, 'usage__1440-light-en');

    const edit = page.getByRole('button', { name: /^Edit[\s:]+Database size$/ });
    await edit.click();
    await expect(edit).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('textbox', { name: /Limit \(GB\)/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(edit).toBeFocused();
    await expect(edit).toHaveAttribute('aria-expanded', 'false');

    await page.getByRole('button', { name: 'Check now' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Checked. 11 values stored.' })).toBeVisible();
    expect((problems?.list ?? []).filter((p) => !p.includes('audit-photo'))).toEqual([]);
  });

  test('full in Hindi', async ({ page }) => {
    const c = variant('full', 'hi');
    if (!c) return;
    const problems = await open(page, c);
    await expect(page.getByRole('heading', { level: 2, name: 'उपयोग और सीमाएँ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'अभी जाँचें' })).toBeVisible();
    await shot(page, 'usage__1440-light-hi');
    expect((problems?.list ?? []).filter((p) => !p.includes('audit-photo'))).toEqual([]);
  });

  test('full on a phone', async ({ page }) => {
    const c = variant('full', 'en', 390);
    if (!c) return;
    await open(page, c);
    await expect(page.getByRole('heading', { level: 3, name: 'Server' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, 'usage__390-light-en');
  });

  test('read-only for an operations manager', async ({ page }) => {
    const c = variant('readonly');
    if (!c) return;
    await open(page, c);
    await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
    await expect(page.getByText('Only a super admin can change limits and warnings.')).toBeVisible();
    await shot(page, 'usage-readonly__1440-light-en');
  });

  test('never checked and providers not set up', async ({ page }) => {
    const empty = variant('empty');
    if (!empty) return;
    await open(page, empty);
    await expect(page.getByText('No measurements yet')).toBeVisible();
    const mixed = variant('mixed');
    if (!mixed) return;
    await page.evaluate(() => {
      window.localStorage.removeItem('mechdost-visual-seeded');
    });
    await open(page, mixed);
    await expect(page.getByText('Not set up').first()).toBeVisible();
    await expect(page.getByText('Could not be read').first()).toBeVisible();
    await shot(page, 'usage-mixed__1440-light-en');
  });
});
