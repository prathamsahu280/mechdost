/**
 * "No page may feel like a reload" (user rule 2026-11-16, docs/decisions.md): clicking a section link in the admin
 * console or the account area swaps only the section. The side bar element stays the same DOM node, the document is
 * not reloaded (a window marker survives), the sticky header and heading are not redrawn, and the page does not jump
 * to the top when the user had scrolled.
 */
import { expect, test, type Page } from '@playwright/test';
import { CONSENT_DECIDED } from './fixtures/consent';

test.use({ storageState: CONSENT_DECIDED });

async function signIn(page: Page, phone: string, admin = false) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (admin) {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
  await expect(page).not.toHaveURL(/\/login/);
}

/** Marks the document, the side bar and the page heading so a remount or reload is detectable afterwards. */
async function mark(page: Page, navName: string) {
  const nav = page.getByRole('navigation', { name: navName });
  await expect(nav).toBeVisible();
  await nav.evaluate((el: HTMLElement) => {
    el.dataset.keep = 'yes';
    document.querySelector<HTMLElement>('main h1')?.setAttribute('data-keep', 'yes');
    (window as unknown as { __noReload: number }).__noReload = 1;
  });
}

async function expectFrameSurvived(page: Page, navName: string) {
  const nav = page.getByRole('navigation', { name: navName });
  await expect(nav).toHaveAttribute('data-keep', 'yes');
  await expect(page.locator('main h1')).toHaveAttribute('data-keep', 'yes');
  expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(1);
}

async function expectNoJumpToTop(page: Page, isMobile: boolean) {
  // On phones the bar is a row above the section, so the page legitimately scrolls to bring the section into view.
  if (isMobile) return;
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
}

async function scrollALittle(page: Page) {
  await page.evaluate(() => {
    window.scrollTo(0, Math.min(240, document.documentElement.scrollHeight - window.innerHeight));
  });
}

test('admin: a side-bar click keeps the frame, the document and the scroll position', async ({
  page,
  isMobile,
}) => {
  await signIn(page, '9000000003', true);
  await page.goto('/admin');
  await mark(page, 'Console sections');
  await scrollALittle(page);

  const nav = page.getByRole('navigation', { name: 'Console sections' });
  await nav.getByRole('link', { name: 'Orders' }).click();
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expect(nav.locator('[aria-current="page"]')).toContainText('Orders');
  await expectFrameSurvived(page, 'Console sections');
  await expectNoJumpToTop(page, isMobile);

  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expectFrameSurvived(page, 'Console sections');
});

test('account: a side-bar click keeps the frame, the document and the scroll position', async ({
  page,
  isMobile,
}) => {
  await signIn(page, '9876543210');
  await page.goto('/account');
  await mark(page, 'Account sections');
  await scrollALittle(page);

  const nav = page.getByRole('navigation', { name: 'Account sections' });
  await nav.getByRole('link', { name: 'Orders' }).click();
  await expect(page).toHaveURL(/\/account\/orders$/);
  await expect(nav.locator('[aria-current="page"]')).toContainText('Orders');
  await expectFrameSurvived(page, 'Account sections');
  await expectNoJumpToTop(page, isMobile);

  await nav.getByRole('link', { name: 'Profile' }).click();
  await expect(page).toHaveURL(/\/account\/profile$/);
  await expectFrameSurvived(page, 'Account sections');
});

test('the privacy notice link in the consent banner is an in-app move (no reload)', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(() => {
    (window as unknown as { __noReload: number }).__noReload = 1;
  });
  await page.getByTestId('consent-banner').getByRole('link').click();
  await expect(page).toHaveURL(/\/policies\/privacy$/);
  expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(1);
  await context.close();
});
