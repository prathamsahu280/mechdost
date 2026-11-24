import { expect, test, type Page } from '@playwright/test';

/**
 * MechDost Coins (spec 20) and the no-returns policy (spec 05, decision 2026-11-01) in demo mode.
 * The seeded customer starts with 250 demo coins; 1 coin = ₹1, coins pay at most 10% of the products.
 */
async function signIn(page: Page, phone: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (phone === '9000000003') {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

async function signOut(page: Page) {
  await page.goto('/account/profile');
  await page.locator('[data-track="header_account"]').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  // Sign-out ends with a fresh load of the home page (bug 2026-11-23): wait for it before the next step.
  await expect(page.locator('html[data-signing-out]')).toHaveCount(0);
  await page.waitForLoadState();
}

test.describe('MechDost Coins (spec 20)', () => {
  test('a customer uses coins at checkout, and gets them back when the order is rejected', async ({
    page,
  }) => {
    await signIn(page, '9876543210', '/account/coins');
    await expect(page.getByRole('heading', { name: 'How coins work' })).toBeVisible();
    await expect(page.getByText('Coins have no cash value', { exact: false })).toBeVisible();
    await expect(page.getByText('Demo coins')).toBeVisible();

    // ₹1,000 battery → coins may pay 10% = ₹100 (100 coins), never the delivery.
    await page.goto('/shop/exide-xltz4a-2w-battery');
    await page.getByRole('button', { name: 'Add to cart' }).first().click();
    await page.goto('/checkout');
    await expect(page.getByText('No returns or exchanges.')).toBeVisible();
    const useCoins = page.getByRole('checkbox', { name: /Use 100 MechDost Coins and save ₹100/ });
    await useCoins.check();
    await expect(page.getByText('MechDost Coins (100)')).toBeVisible();
    await page.getByLabel('Full name').fill('Ravi Sahu');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByLabel('Delivery address').fill('C-605 Salasar Greens, Sarona, Raipur');
    await page.getByLabel('PIN code').fill('492099');
    await page.getByLabel(/I agree to share/).check();
    await page.getByRole('button', { name: /Place order · ₹900/ }).click();
    await expect(page).toHaveURL(/\/orders\/MD-RPR-/);
    const code = new URL(page.url()).pathname.split('/').at(-1) ?? '';
    await expect(page.getByText('MechDost Coins (100)')).toBeVisible();

    await page.goto('/account/coins');
    await expect(page.getByText(`Used on order ${code}`)).toBeVisible();
    await expect(page.locator('#coins-title').locator('..')).toContainText('150');

    // Admin rejects the order: the coins come back once, as coins.
    await signOut(page);
    await signIn(page, '9000000003', '/admin/orders');
    const card = page.locator('article').filter({ hasText: code });
    await card.getByRole('button', { name: 'Reject with a message' }).click();
    await card.getByLabel('Message to the customer').fill('Sorry, this battery is out of stock this week.');
    await card.getByLabel('Reason', { exact: true }).selectOption('no_stock_nearby');
    await card.getByRole('button', { name: 'Reject order' }).click();
    await expect(card.getByText(/Rejected: Sorry/)).toBeVisible();
    await page.goto('/admin/coins');
    await expect(page.getByText(code).first()).toBeVisible();

    await signOut(page);
    await signIn(page, '9876543210', '/account/coins');
    await expect(page.getByText(`Returned from order ${code}`)).toBeVisible();
    await expect(page.locator('#coins-title').locator('..')).toContainText('250');
  });

  test('admins grant or remove coins with a reason; mistakes are explained', async ({ page }) => {
    await signIn(page, '9000000003', '/admin/coins');
    await page.getByLabel("Customer's mobile number").fill('9000000001');
    await page.getByLabel('Number of coins').fill('50');
    await page.getByLabel('Reason (the customer sees it)').fill('Goodwill');
    await page.getByRole('button', { name: 'Save change' }).click();
    await expect(page.getByText('No customer account uses this mobile number.')).toBeVisible();

    await page.getByLabel("Customer's mobile number").fill('9876543210');
    await page.getByLabel('Reason (the customer sees it)').fill('');
    await page.getByRole('button', { name: 'Save change' }).click();
    await expect(page.getByText('Give a reason (3 to 200 characters).')).toBeVisible();

    await page.getByLabel('Reason (the customer sees it)').fill('Thanks for your feedback');
    await page.getByRole('button', { name: 'Save change' }).click();
    await expect(page.getByText('Done. Ravi Sahu now has 300 coins.')).toBeVisible();

    await page.getByLabel("Customer's mobile number").fill('9876543210');
    await page.getByLabel('Remove coins').check();
    await page.getByLabel('Number of coins').fill('1000');
    await page.getByLabel('Reason (the customer sees it)').fill('Correction');
    await page.getByRole('button', { name: 'Save change' }).click();
    await expect(page.getByText('The customer has only 300 coins.')).toBeVisible();
  });

  test('coin rules are admin settings and the checkout follows them', async ({ page }) => {
    await signIn(page, '9000000003', '/admin/settings');
    // Coin rules are their own category in Admin → Settings (design 2026-11-24).
    await page.goto('/admin/settings?cat=coins');
    await page.getByLabel('Most of an order coins can pay').fill('20');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await signOut(page);
    await signIn(page, '9876543210', '/account/coins');
    await page.goto('/shop/exide-xltz4a-2w-battery');
    await page.getByRole('button', { name: 'Add to cart' }).first().click();
    await page.goto('/checkout');
    await expect(page.getByRole('checkbox', { name: /Use 200 MechDost Coins and save ₹200/ })).toBeVisible();
  });
});

test.describe('returns policy (spec 05)', () => {
  test('is shown before purchase and explains the faulty-part route', async ({ page }) => {
    await page.goto('/shop/castrol-activ-4t-20w40-900ml');
    await expect(
      page.getByText('No returns or exchanges. Faulty parts are handled by our support team.'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Read the policy' }).click();
    await expect(page).toHaveURL(/\/policies\/returns$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Returns, refunds and faulty parts' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Faulty, damaged or wrong parts' })).toBeVisible();
    await expect(page.getByText('within 7 days of delivery', { exact: false })).toBeVisible();
    await page.goto('/hi/policies/returns');
    await expect(
      page.getByRole('heading', { level: 1, name: 'वापसी, रिफ़ंड और ख़राब पार्ट्स' }),
    ).toBeVisible();
  });
});
