import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Cash on delivery only on request (founder ruling 2026-11-26; spec 03 § Cash-on-delivery eligibility), browser demo:
 * with "every customer" off a normal customer cannot pick cash on delivery, asks for it, an admin approves, and cash on
 * delivery is offered; a verified Ustaad member has it without asking. The API side is covered by
 * `apps/api/test/cod-requests.test.ts` and `packages/db/test/cod-requests.test.ts`.
 */
const DEMO_PASSWORD = 'Raipur@2026';
const ADMIN = '9000000003';
const CUSTOMER = '9876543210';
const COD_KEY = 'mechdost-demo-cod';

async function signIn(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (phone === ADMIN) await page.getByLabel('One-time code').fill('123456');
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

async function signOut(page: Page) {
  await page.locator('[data-track="header_account"]').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.locator('html[data-signing-out]')).toHaveCount(0);
  await page.waitForLoadState();
}

async function toCheckout(page: Page) {
  await page.goto('/shop/exide-xltz4a-2w-battery');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.goto('/checkout');
}

const codRadio = (page: Page) => page.getByRole('radio', { name: 'Cash on delivery' });

test('everyone off: a normal customer asks, an admin approves, cash on delivery is offered', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, ADMIN);
  await page.goto('/admin/customers');
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Cash-on-delivery requests' }) });
  await expect(card).toBeVisible();
  const everyone = card.getByRole('checkbox', { name: 'Every customer' });
  await expect(everyone).toBeChecked(); // the demo starts with it on (Q-COD-3)
  await everyone.uncheck();
  await expect(card.getByText('No requests waiting.')).toBeVisible();
  await signOut(page);

  await signIn(page, CUSTOMER);
  await toCheckout(page);
  await expect(codRadio(page)).toBeDisabled();
  await expect(
    page.getByText('Cash on delivery is for customers we approve.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Request cash on delivery' }).click();
  const panel = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Request cash on delivery' }) });
  await expect(panel.getByRole('heading', { name: 'Request cash on delivery' })).toBeFocused();
  await panel.getByRole('button', { name: 'Send request' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Choose a reason.');
  await panel.getByRole('radio', { name: 'I do not use UPI, cards or net banking' }).check();
  await panel.getByLabel('Anything else (optional)').fill('My shop pays suppliers in cash');
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await panel.getByRole('button', { name: 'Send request' }).click();
  await expect(panel.getByRole('status')).toHaveText(/Request sent/);
  await expect(
    page.getByText('Your cash on delivery request is with our team.', { exact: false }),
  ).toBeVisible();

  await page.goto('/account/payments');
  await expect(page.getByText('With our team')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw request' })).toBeVisible();
  await signOut(page);

  await signIn(page, ADMIN);
  await page.goto('/admin/customers');
  const request = page.locator('li').filter({ hasText: 'Ravi Sahu' }).filter({ hasText: 'I do not use UPI' });
  await expect(request).toBeVisible();
  await request.getByRole('button', { name: 'Approve' }).click();
  await request.getByLabel('Personal limit per order in ₹ (optional)').fill('3000');
  await request.getByRole('button', { name: 'Approve cash on delivery' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Approved.' })).toBeVisible();
  await signOut(page);

  await signIn(page, CUSTOMER);
  await toCheckout(page);
  await expect(codRadio(page)).toBeEnabled();
  await expect(page.getByText('Cash on delivery is for customers we approve.', { exact: false })).toHaveCount(
    0,
  );
  await page.goto('/account/payments');
  await expect(page.getByText('Approved for your account.')).toBeVisible();
});

test('a verified Ustaad member has cash on delivery without asking; others do not', async ({ page }) => {
  await page.goto('/');
  // The demo network is not tied to accounts: mark the demo customer as a verified member in the demo store.
  await page.evaluate(
    ([key]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          switches: { everyone: false, approved: true, ustaad: true, ustaadMinLevel: 0 },
          requests: [],
          ustaad: { 'demo-customer': { verificationState: 'pending_verification', level: 'naya' } },
        }),
      );
    },
    [COD_KEY],
  );
  await signIn(page, CUSTOMER);
  await toCheckout(page);
  await expect(codRadio(page)).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Get verified on Ustaad' })).toBeVisible();

  await page.evaluate(
    ([key]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          switches: { everyone: false, approved: true, ustaad: true, ustaadMinLevel: 0 },
          requests: [],
          ustaad: { 'demo-customer': { verificationState: 'verified', level: 'pakka' } },
        }),
      );
    },
    [COD_KEY],
  );
  await page.reload();
  await expect(codRadio(page)).toBeEnabled();
  await page.goto('/account/payments');
  await expect(page.getByText('Available to you as a verified MechDost Ustaad mechanic.')).toBeVisible();
});

test('Hindi: the checkout line and the request panel are in Hindi', async ({ page }) => {
  await page.goto('/hi');
  await page.evaluate(
    ([key]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          switches: { everyone: false, approved: true, ustaad: true, ustaadMinLevel: 0 },
          requests: [],
        }),
      );
    },
    [COD_KEY],
  );
  await signIn(page, CUSTOMER);
  await page.goto('/hi/shop/exide-xltz4a-2w-battery');
  await page.getByRole('button', { name: 'कार्ट में डालें' }).first().click();
  await page.goto('/hi/checkout');
  await expect(
    page.getByText('कैश ऑन डिलीवरी हमारे मंज़ूर किए ग्राहकों के लिए है', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'कैश ऑन डिलीवरी का अनुरोध करें' }).click();
  await expect(page.getByRole('heading', { name: 'कैश ऑन डिलीवरी का अनुरोध करें' })).toBeVisible();
});
