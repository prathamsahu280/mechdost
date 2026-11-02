import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { latinOffenders } from '../test/hindi-allowlist';

/** The project's accessibility bar (same tags as shell.spec.ts). */
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Privacy choice (DPDP; decision "declines non-essential by default"): a fresh visitor sees two equal choices,
 * nothing optional happens before choosing (no visitor id, no event request), the choice sticks across pages,
 * "Privacy choices" in the footer reopens it, and the Hindi banner has no stray English.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('a fresh visitor chooses; the choice persists and can be changed', async ({ page }) => {
  const eventRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/v1/events')) eventRequests.push(r.url());
  });
  await page.goto('/');
  const banner = page.getByTestId('consent-banner');
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('heading', { name: 'Your privacy choice' })).toBeVisible();
  const allow = banner.getByRole('button', { name: 'Allow analytics' });
  const essential = banner.getByRole('button', { name: 'Essential only' });
  // Equal weight: the same size, neither pre-selected.
  const [a, e] = await Promise.all([allow.boundingBox(), essential.boundingBox()]);
  expect(Math.abs((a?.height ?? 0) - (e?.height ?? 0))).toBeLessThan(2);
  expect(await allow.getAttribute('aria-pressed')).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('mechdost-visitor'))).toBeNull();
  const axe = await new AxeBuilder({ page })
    .withTags(WCAG_AA)
    .include('[data-testid="consent-banner"]')
    .analyze();
  expect(axe.violations).toEqual([]);

  await essential.click();
  await expect(banner).toBeHidden();
  await page.goto('/shop');
  await expect(page.getByTestId('consent-banner')).toBeHidden();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('mechdost-consent') ?? '{}') as unknown),
  ).toMatchObject({
    analytics: false,
    version: '2026-11',
  });

  await page.getByRole('button', { name: 'Privacy choices' }).click();
  await expect(page.getByTestId('consent-banner')).toBeVisible();
  await expect(
    page.getByTestId('consent-banner').getByRole('button', { name: 'Essential only' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('consent-banner').getByRole('button', { name: 'Allow analytics' }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('mechdost-consent') ?? '{}') as unknown),
  ).toMatchObject({
    analytics: true,
  });
  // The demo build has no API URL: nothing leaves the browser even with consent.
  expect(eventRequests).toEqual([]);
});

test('the Hindi banner is in Hindi', async ({ page }) => {
  await page.goto('/hi');
  const banner = page.getByTestId('consent-banner');
  await expect(banner.getByRole('heading', { name: 'आपकी प्राइवेसी पसंद' })).toBeVisible();
  expect(latinOffenders(await banner.innerText())).toEqual([]);
});

test('the assistant button steps aside while the choice is open; Escape closes a reopened choice', async ({
  page,
}) => {
  await page.goto('/cart');
  const launcher = page.getByRole('button', { name: 'Ask MechDost' });
  await expect(page.getByTestId('consent-banner')).toBeVisible();
  await expect(launcher).toBeHidden();
  await page.getByRole('button', { name: 'Essential only' }).click();
  await expect(launcher).toBeVisible();
  await page.getByRole('button', { name: 'Privacy choices' }).click();
  await expect(launcher).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('consent-banner')).toBeHidden();
  await expect(launcher).toBeVisible();
});

test('the banner links to the privacy notice, in both languages', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('consent-banner').getByRole('link', { name: 'Read the privacy policy' }).click();
  await expect(page).toHaveURL(/\/policies\/privacy$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy');
  await expect(page.locator('main').getByRole('heading', { level: 2 })).toHaveCount(7); // the 7 sections
  const axe = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  expect(axe.violations).toEqual([]);
  await page.goto('/hi/policies/privacy');
  await expect(page.getByRole('heading', { name: 'आपके विकल्प और अधिकार' })).toBeVisible();
});
