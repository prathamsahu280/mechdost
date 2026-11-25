import { expect, test, type Page } from '@playwright/test';

/**
 * Support requests (spec 09): the only route for faulty/damaged/wrong parts under the no-returns policy (spec 05).
 * Customer raises a request from the order page, staff reply from the inbox (internal notes stay internal), the
 * customer's reply brings it back to review, staff resolve it. WhatsApp requests show in the same inbox.
 */
async function signIn(page: Page, phone: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (phone === '9000000003') {
    await page.getByLabel('One-time code').fill('123456');
  }
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[?]/g, '\\?')}$`));
}

/** Customers sign out from Account → Profile; staff from the portal header. */
async function signOut(page: Page, from: 'account' | 'portal') {
  if (from === 'account') await page.goto('/account/profile');
  await page.locator('[data-track="header_account"]').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  // Sign-out ends with a fresh load of the home page (bug 2026-11-23): wait for it before the next step.
  await expect(page.locator('html[data-signing-out]')).toHaveCount(0);
  await page.waitForLoadState();
}

test('a faulty-part request goes from the order page to the inbox and back', async ({ page }) => {
  // Five sign-ins across three roles: longer than the 30 s default (same as the role suites).
  test.setTimeout(120_000);
  // A guest order to complain about.
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
  const orderCode = new URL(page.url()).pathname.split('/').at(-1) ?? '';

  await signIn(page, '9876543210', `/orders/${orderCode}`);
  await page.getByRole('link', { name: 'Report a problem with this order' }).click();
  await expect(page).toHaveURL(new RegExp(`/account/support\\?order=${orderCode}$`));
  await expect(page.getByText(/We don’t take returns or exchanges/)).toBeVisible();
  await expect(page.getByLabel('Order (optional)')).toHaveValue(orderCode);
  await expect(page.getByLabel('What is it about?')).toHaveValue('order_issue');

  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Write a message.')).toBeVisible();
  await page.getByLabel('Message').fill('The battery does not hold charge after two days.');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText(/Request REQ-RPR-\d{4}-[0-9A-Z]{6} sent/)).toBeVisible();
  const request = page.locator('article').filter({ hasText: 'The battery does not hold charge' });
  await expect(request.getByText('Received', { exact: true })).toBeVisible();
  await expect(request.getByText(/We’ll reply by/)).toBeVisible();
  await signOut(page, 'account');

  await signIn(page, '9000000003', '/admin/support');
  // The WhatsApp request is in the same inbox, with the number masked.
  const whatsapp = page.locator('article').filter({ hasText: 'via WhatsApp' });
  await expect(whatsapp.getByText(/\+91 98•••••11/)).toBeVisible();
  const ticket = page.locator('article').filter({ hasText: `Order ${orderCode}` });
  await ticket.getByRole('button', { name: /Faulty, damaged or wrong part/ }).click();
  await ticket.getByLabel('Internal note (the customer won’t see it)').check();
  await ticket.getByLabel('Reply to the customer').fill('Check the batch number with the shop first.');
  await ticket.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(ticket.getByText('Internal note', { exact: false }).first()).toBeVisible();
  await ticket.getByLabel('Internal note (the customer won’t see it)').uncheck();
  await ticket
    .getByLabel('Reply to the customer')
    .fill('Sorry about that. Please send a photo of the battery label.');
  await ticket.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(ticket.getByText('Waiting for your reply', { exact: true })).toBeVisible();
  await signOut(page, 'portal');

  await signIn(page, '9876543210', '/account/support');
  const mine = page.locator('article').filter({ hasText: 'The battery does not hold charge' });
  await expect(mine.getByText('Please send a photo of the battery label.')).toBeVisible();
  await expect(mine.getByText('MechDost support', { exact: false })).toBeVisible();
  await expect(mine.getByText('Check the batch number')).toHaveCount(0); // internal note stays internal
  await mine.getByLabel('Your reply').fill('Photo sent on WhatsApp just now.');
  await mine.getByRole('button', { name: 'Send reply' }).click();
  await expect(mine.getByText('We’re looking into it', { exact: true })).toBeVisible();
  await signOut(page, 'account');

  await signIn(page, '9000000003', '/admin/support');
  const again = page.locator('article').filter({ hasText: `Order ${orderCode}` });
  await again.getByRole('button', { name: /Faulty, damaged or wrong part/ }).click();
  await again.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(page.locator('article').filter({ hasText: `Order ${orderCode}` })).toHaveCount(0);
  await page.getByRole('button', { name: 'Resolved and closed' }).click();
  await expect(
    page
      .locator('article')
      .filter({ hasText: `Order ${orderCode}` })
      .getByText('Resolved'),
  ).toBeVisible();
});
