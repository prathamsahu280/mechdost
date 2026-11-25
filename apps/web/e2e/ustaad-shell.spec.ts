import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Ustaad Network shell and the staff preview (spec 23 § 5; plan task A3; founder 2026-11-26). The browser demo runs
 * the default `staff_preview`: signed out and customers see the site's ordinary "page not found", staff see the shell
 * with the preview note. Also the privacy notice and terms sections for the network and the grievance fallback.
 * With USTAAD_SHOTS set to a folder, the review screenshots are written there (390 / 1440 light, Hindi 390).
 */
const DEMO_PASSWORD = 'Raipur@2026';
const ADMIN = '9000000003';
const CUSTOMER = '9876543210';
const SHOTS = process.env.USTAAD_SHOTS;

async function signIn(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (phone === ADMIN) await page.getByLabel('One-time code').fill('123456');
  await expect(page).not.toHaveURL(/\/login/);
}

async function shot(page: Page, name: string, width: number) {
  if (!SHOTS) return;
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/${name}-${String(width)}.png`, fullPage: true });
}

test.describe('Ustaad Network: staff preview', () => {
  test('signed out, /ustaad looks exactly like a page that does not exist', async ({ page }) => {
    await page.goto('/ustaad');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Ustaad Network sections' })).toHaveCount(0);
    await expect(page.getByText('Ustaad Network')).toHaveCount(0);
    await expect(page).not.toHaveTitle(/Ustaad/);
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });

  test('a customer sees "page not found" too', async ({ page }) => {
    await signIn(page, CUSTOMER);
    await page.goto('/ustaad');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('Stuck on a job?')).toHaveCount(0);
  });

  test('staff see the shell: preview note, one navigation, Home current, no site dock; axe clean', async ({
    page,
  }) => {
    await signIn(page, ADMIN);
    await page.goto('/ustaad');
    await expect(page.getByRole('note')).toContainText('Staff preview');
    await expect(page.getByRole('heading', { name: 'Stuck on a job?' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Ustaad Network sections' });
    await expect(nav).toHaveCount(1); // the dock is hidden at this width, the rail is shown
    await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Create a post' })).toBeVisible();
    await expect(page.locator('[data-dock]')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
    await shot(page, 'ustaad-home-staff', 1440);
    await shot(page, 'ustaad-home-staff', 390);
    await page.goto('/hi/ustaad');
    await expect(page.getByRole('heading', { name: 'काम में अटके हो?' })).toBeVisible();
    await shot(page, 'ustaad-home-staff-hi', 390);
  });
});

test.describe('Policies for the Ustaad Network', () => {
  test('privacy notice and terms carry the network sections and the grievance contact', async ({ page }) => {
    await page.goto('/policies/privacy');
    await expect(page.getByRole('heading', { name: 'Ustaad Network: what mechanics share' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Smart correction of what you type' })).toBeVisible();
    await expect(page.getByText('Last updated: 26 November 2026')).toBeVisible();
    await expect(page.getByText('To be announced')).toBeVisible();
    await expect(page.getByRole('link', { name: 'support@mechdost.com' })).toBeVisible();
    await shot(page, 'privacy', 1440);
    await shot(page, 'privacy', 390);
    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: 'Ustaad Network rules' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What you may post in the network' })).toBeVisible();
    await shot(page, 'terms', 1440);
    await shot(page, 'terms', 390);
    await page.goto('/hi/policies/privacy');
    await expect(
      page.getByRole('heading', { name: 'उस्ताद नेटवर्क: मिस्त्री क्या साझा करते हैं' }),
    ).toBeVisible();
    await shot(page, 'privacy-hi', 390);
    await page.goto('/hi/terms');
    await expect(page.getByRole('heading', { name: 'उस्ताद नेटवर्क के नियम' })).toBeVisible();
    await shot(page, 'terms-hi', 390);
  });
});
