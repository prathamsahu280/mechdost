import { expect, test, type Page } from '@playwright/test';

/**
 * Cancellations (spec 05, same rules as the API): the customer cancels until the shop packs, with a reason code;
 * once packed only MechDost can cancel, and then the shop's active list drops it and nothing moves it forward.
 */
const DEMO_PASSWORD = 'Raipur@2026';
const ADMIN = '9000000003';

async function signIn(page: Page, phone: string, path = '/login') {
  await page.goto(path);
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (phone === ADMIN) {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
}

/** Sign out from the user's own area (order pages have no sign-out button). */
async function signOut(page: Page, from: '/admin' | '/partner/shop' | null = null) {
  if (from) await page.goto(from);
  await page.getByRole('button', { name: 'Sign out' }).first().click();
}

async function placeOrder(page: Page): Promise<string> {
  await page.goto('/shop/exide-xltz4a-2w-battery');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.goto('/checkout');
  await page.getByLabel('Full name').fill('Ravi Sahu');
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByLabel('Delivery address').fill('C-605 Salasar Greens, Sarona, Raipur');
  await page.getByLabel('PIN code').fill('492099');
  await page.getByLabel(/I agree to share/).check();
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page).toHaveURL(/\/orders\/MD-RPR-/);
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

test('the customer cancels before packing; the admin sees it with the reason', async ({ page }) => {
  const code = await placeOrder(page);
  await page.getByRole('button', { name: 'Cancel this order' }).click();
  // Keyboard focus follows the disclosure (web-design-guidelines review): into the form, back to the trigger.
  await expect(page.getByLabel('Why are you cancelling?')).toBeFocused();
  await page.getByLabel('Why are you cancelling?').selectOption('ordered_by_mistake');
  await page.getByRole('button', { name: 'Keep my order' }).click();
  await expect(page.getByRole('button', { name: 'Cancel this order' })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel this order' }).click();
  await page.getByLabel('Why are you cancelling?').selectOption('ordered_by_mistake');
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(page.getByText('Order cancelled')).toBeVisible();
  await expect(page.locator('#order-cancelled')).toBeFocused();
  await expect(page.getByText(/You cancelled this order on .* · Ordered by mistake/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel this order' })).toHaveCount(0);

  await signIn(page, ADMIN, '/login?next=%2Fadmin%2Forders');
  const card = page.locator('article').filter({ hasText: code });
  await expect(card.getByText(/Cancelled by the customer on .* · Ordered by mistake/)).toBeVisible();
  await expect(card.getByRole('button', { name: /^Route to/ })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Reject with a message' })).toHaveCount(0);
});

test('once packed only MechDost can cancel; the shop then stops seeing it', async ({ page }) => {
  test.setTimeout(120_000);
  const code = await placeOrder(page);
  await signIn(page, ADMIN, '/login?next=%2Fadmin%2Forders');
  await page
    .locator('article')
    .filter({ hasText: code })
    .getByRole('button', { name: 'Route to Sharma Auto Parts' })
    .click();
  await signOut(page);
  await signIn(page, '9000000001'); // Sharma Auto Parts
  await page
    .locator('article')
    .filter({ hasText: code })
    .getByRole('button', { name: /Accept order/ })
    .click();
  const active = page.locator('article').filter({ hasText: code });
  await active.getByRole('button', { name: 'Mark packed' }).click();
  await expect(active.getByText('Packed')).toBeVisible();

  await page.goto(`/orders/${code}`);
  await expect(page.getByText('Packed').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel this order' })).toHaveCount(0);

  await signOut(page, '/partner/shop');
  await signIn(page, ADMIN, '/login?next=%2Fadmin%2Forders');
  const card = page.locator('article').filter({ hasText: code });
  await card.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await card.getByLabel('Reason for cancelling').selectOption('customer_unreachable');
  await card.getByRole('button', { name: `Cancel ${code}` }).click();
  await expect(
    page
      .locator('article')
      .filter({ hasText: code })
      .getByText(/Cancelled by MechDost on .* · Customer could not be reached/),
  ).toBeVisible();

  await page.goto(`/orders/${code}`);
  await expect(page.getByText(/MechDost cancelled this order on/)).toBeVisible();
  await signOut(page, '/admin');
  await signIn(page, '9000000001');
  await expect(page.locator('article').filter({ hasText: code })).toHaveCount(0);
});
