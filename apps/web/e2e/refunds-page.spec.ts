/**
 * The customer's Refunds page (spec 05, 2026-11-23: "the customer should also have a refund status page"): in the
 * browser demo it lists three sample refunds with a stepper in plain words, the money's destination, the typical bank
 * time and the Razorpay reference of a sent one; it never says "refunded" before a refund is completed; the account
 * bar and the account menu link to it; axe is clean in English and Hindi, in light and dark.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { CONSENT_DECIDED } from './fixtures/consent';

test.use({ storageState: CONSENT_DECIDED });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill('9876543210');
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

test('lists the customer’s refunds with a plain-words stepper (English)', async ({ page }) => {
  await signIn(page);
  await page.goto('/account/refunds');
  await expect(page.getByRole('heading', { name: 'Refunds', level: 2 })).toBeVisible();
  const list = page.getByRole('list', { name: 'Your refunds' });
  const cards = list.getByRole('listitem').filter({ has: page.locator('ol') });
  await expect(cards).toHaveCount(3);

  // A Razorpay refund that was sent: four steps, the third is the current one, the typical bank time and the reference.
  const sent = list.getByRole('listitem').filter({ hasText: 'MD-RPR-2026-DEMO01' }).first();
  await expect(sent.getByRole('list', { name: 'Refund progress' }).getByRole('listitem')).toHaveCount(4);
  await expect(sent.locator('[aria-current="step"]')).toContainText('Sent to your bank or UPI');
  await expect(sent).toContainText('Usually 5 to 7 working days after it is sent.');
  await expect(sent).toContainText('rfnd_DemoSent0001');
  await expect(sent).toContainText('The UPI, card or bank account you paid with');
  await expect(sent).not.toContainText('Completed. The money has been sent back.');

  // A cash-on-delivery payout still waiting for approval: three steps, paid by hand, nothing promised.
  const waiting = list.getByRole('listitem').filter({ hasText: 'MD-RPR-2026-DEMO02' }).first();
  await expect(waiting.getByRole('list', { name: 'Refund progress' }).getByRole('listitem')).toHaveCount(3);
  await expect(waiting).toContainText('Waiting for our team to approve it. This is not automatic.');
  await expect(waiting).toContainText('paid by our team by hand');
  await expect(waiting).not.toContainText('Usually 5 to 7 working days');

  // Only the finished one says completed.
  const done = list.getByRole('listitem').filter({ hasText: 'SR-RPR-2026-DEMO03' }).first();
  await expect(done).toContainText('Completed. The money has been sent back.');
  await expectNoViolations(page);
});

test('is in the account bar and the account menu, and is clean in Hindi', async ({ page }) => {
  await signIn(page);
  await page.goto('/account/orders');
  await page
    .getByRole('navigation', { name: 'Account sections' })
    .getByRole('link', { name: 'Refunds', exact: true })
    .click();
  await expect(page).toHaveURL(/\/account\/refunds$/);

  await page.goto('/hi/account/refunds');
  await expect(page.getByRole('heading', { name: 'रिफ़ंड', level: 2 })).toBeVisible();
  await expect(page.getByRole('list', { name: 'आपके रिफ़ंड' })).toBeVisible();
  await expect(page.getByText('हमारी टीम की मंज़ूरी का इंतज़ार है। यह अपने आप नहीं होता।')).toBeVisible();
  await expectNoViolations(page);

  // Dark theme keeps the contrast.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await expectNoViolations(page);
});

test('the account menu has a Refunds link', async ({ page, isMobile }) => {
  test.skip(
    isMobile,
    'the account menu is the desktop header; phones use the bottom bar and the account bar',
  );
  await signIn(page);
  await page.goto('/account');
  await page
    .getByRole('button', { name: /account/i })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'My refunds' }).click();
  await expect(page).toHaveURL(/\/account\/refunds$/);
});
