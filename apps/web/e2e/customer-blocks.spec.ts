import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Customer blocks (spec 08, same rules as the API): an admin blocks a customer with a reason; checkout refuses
 * (also when the blocked number is typed in signed out); lifting restores ordering; a full block refuses
 * sign-in; staff accounts never appear as blockable customers.
 */
const DEMO_PASSWORD = 'Raipur@2026';
const ADMIN = '9000000003';
const CUSTOMER = '9876543210';

async function signIn(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (phone === ADMIN) {
    await page.getByLabel('One-time code').fill('123456');
  }
}

async function tryCheckout(page: Page) {
  await page.goto('/shop/exide-xltz4a-2w-battery');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.goto('/checkout');
  await page.getByLabel('Full name').fill('Ravi Sahu');
  await page.getByLabel('Mobile number').fill(CUSTOMER);
  await page.getByLabel('Delivery address').fill('C-605 Salasar Greens, Sarona, Raipur');
  await page.getByLabel('PIN code').fill('492099');
  await page.getByLabel(/I agree to share/).check();
  await page.getByRole('button', { name: /Place order/ }).click();
}

test('block → checkout refused → lift → order goes through; full block refuses sign-in', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ADMIN);
  await page.goto('/admin/customers');
  await expect(page.getByRole('heading', { name: 'Customers', level: 2 })).toBeVisible();
  const row = page.locator('li').filter({ hasText: 'Ravi Sahu' }).first();
  await expect(row.getByText('No blocks')).toBeVisible();
  await expect(page.locator('li').filter({ hasText: 'MechDost Operations' })).toHaveCount(0); // staff are not customers
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  await row.getByRole('button', { name: 'Block…' }).click();
  await expect(row.getByLabel('Block', { exact: true })).toBeFocused(); // focus moves into the revealed form
  await row.getByLabel('Block', { exact: true }).selectOption('orders');
  await row.getByLabel('Reason').selectOption('fake_orders');
  await row.getByLabel('Note for staff (optional)').fill('Three fake orders in October');
  await row.getByRole('button', { name: 'Block Ravi Sahu' }).click();
  await expect(row.getByText('No orders', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Block…' })).toBeFocused(); // and back to its trigger
  await expect(row.getByText(/Can browse and ask support, cannot order/)).toBeVisible();

  // Signed out, typing the blocked customer's number still hits the block.
  await page.locator('[data-track="header_account"]').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  // Sign-out ends with a fresh load of the home page (bug 2026-11-23): wait for it before the next step.
  await expect(page.locator('html[data-signing-out]')).toHaveCount(0);
  await page.waitForLoadState();
  await tryCheckout(page);
  await expect(
    page.getByRole('alert').filter({ hasText: "This account can't place orders right now." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/checkout$/);

  await signIn(page, ADMIN);
  await page.goto('/admin/customers');
  const again = page.locator('li').filter({ hasText: 'Ravi Sahu' }).first();
  await again.getByRole('button', { name: 'Lift this block' }).click();
  await expect(again.getByLabel('Why is it lifted?')).toBeFocused();
  await again.getByLabel('Why is it lifted?').fill('Customer confirmed the orders by phone');
  await again.getByRole('button', { name: 'Lift block' }).click();
  await expect(again.getByText('No blocks')).toBeVisible();
  await expect(again.getByRole('button', { name: 'Block…' })).toBeFocused(); // the lifted block's button is gone
  await again.getByText('Earlier blocks (1)').click();

  // Lifted: the same checkout now places the order.
  await tryCheckout(page);
  await expect(page).toHaveURL(/\/orders\/MD-RPR-/);
  await page.goto('/admin/customers');

  const ravi = page.locator('li').filter({ hasText: 'Ravi Sahu' }).first();
  await ravi.getByRole('button', { name: 'Block…' }).click();
  await ravi.getByLabel('Block', { exact: true }).selectOption('full');
  await ravi.getByRole('button', { name: 'Block Ravi Sahu' }).click();
  await expect(ravi.getByText('No sign-in', { exact: true })).toBeVisible();
  await page.locator('[data-track="header_account"]').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  // Sign-out ends with a fresh load of the home page (bug 2026-11-23): wait for it before the next step.
  await expect(page.locator('html[data-signing-out]')).toHaveCount(0);
  await page.waitForLoadState();
  await signIn(page, CUSTOMER);
  // Form-level message: on screen above the button and read out by the alert region (hence first()).
  await expect(page.getByText("This account can't sign in right now.").first()).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('the Customers screen is in Hindi on /hi', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/hi/admin/customers');
  await expect(page.getByRole('heading', { name: 'ग्राहक', level: 2 })).toBeVisible();
  await expect(page.getByText('कोई रोक नहीं').first()).toBeVisible();
});
