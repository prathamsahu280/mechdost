/**
 * Regressions from the live multi-role QA and the click crawler (2026-11-14; findings in the git-ignored
 * `reports/ui-review-2026-11-14/`, method in `docs/runbooks/ui-testing.md`). One test per fixed finding.
 */
import { expect, test, type Page } from '@playwright/test';
import { CONSENT_DECIDED } from './fixtures/consent';
import { CODES, seedData, supportTicket, TICKET_CODE } from './fixtures/demo-world';

async function signIn(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (phone === '9000000003') {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
  await expect(page).not.toHaveURL(/\/login/);
}

test.use({ storageState: CONSENT_DECIDED });

test('B6: the workshop finder says when it does not know a PIN code', async ({ page }) => {
  await page.goto('/workshops');
  const pin = page.getByLabel('PIN code');
  const note = page.getByText("We don't know this PIN code yet", { exact: false });
  await pin.fill('999999');
  await expect(note).toBeVisible();
  await pin.fill('492001');
  await expect(note).toHaveCount(0);
});

test('P2: an acknowledged ticket shows its order without a dangling separator', async ({ page }) => {
  const now = Date.now();
  const ticket = {
    ...supportTicket(now),
    status: 'awaiting_customer',
    acknowledgedAt: new Date(now).toISOString(),
  };
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-support'))
        window.localStorage.setItem('mechdost-demo-support', value);
    },
    JSON.stringify({ tickets: [ticket] }),
  );
  await signIn(page, '9876543210');
  await page.goto('/account/support');
  const card = page.locator('article').filter({ hasText: TICKET_CODE });
  const meta = card.getByText(`Order ${CODES.shipped}`, { exact: false });
  await expect(meta).toBeVisible();
  await expect(meta).not.toHaveText(/·\s*$/);
});

test('U5: the admin overview counts confirmed orders that are not yet delivered', async ({ page }) => {
  const orders = seedData(Date.now())['mechdost-demo-orders'];
  const shipped = orders.find((o) => o.code === CODES.shipped);
  expect(shipped).toBeTruthy();
  if (!shipped) return;
  const delivered = { ...shipped, code: 'MD-RPR-2026-HND009', stage: 5 };
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-orders'))
        window.localStorage.setItem('mechdost-demo-orders', value);
    },
    JSON.stringify([shipped, delivered]),
  );
  await signIn(page, '9000000003');
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: /Confirmed, not yet delivered/ })).toContainText('1');
});
