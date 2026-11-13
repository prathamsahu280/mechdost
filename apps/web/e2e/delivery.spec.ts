import { expect, test, type Page } from '@playwright/test';

/**
 * Proof of delivery (decision 2026-11-01, "like any e-commerce site"): out for delivery → the customer sees a
 * 4-digit code → the shop enters it to mark the order delivered; 5 wrong codes lock it; admins can confirm
 * without the code only with a reason.
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
  await page.getByRole('button', { name: 'Sign out' }).first().click();
}

/** Guest order → admin routes it to Sharma Auto Parts → the shop accepts, packs and sends it out. */
async function orderOutForDelivery(page: Page): Promise<string> {
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
  const code = new URL(page.url()).pathname.split('/').at(-1) ?? '';

  await signIn(page, '9000000003', '/admin/orders');
  await page
    .locator('article')
    .filter({ hasText: code })
    .getByRole('button', { name: 'Route to Sharma Auto Parts' })
    .click();
  await signOut(page);

  await signIn(page, '9000000001', '/partner/shop');
  const card = page.locator('article').filter({ hasText: code });
  await card.getByRole('button', { name: /Accept order/ }).click();
  await card.getByRole('button', { name: 'Mark packed' }).click();
  await card.getByRole('button', { name: 'Mark out for delivery' }).click();
  await expect(card.getByLabel("Customer's delivery code")).toBeVisible();
  return code;
}

/**
 * Reads the code the way it reaches the shop in real life: from the customer. The shop's own account never sees
 * it on the order page (QA 2026-11-14, U11): sign out (the guest placed the order on this device), read it, and
 * sign the shop back in.
 */
async function deliveryCodeOf(page: Page, order: string): Promise<string> {
  await page.goto('/partner/shop');
  await signOut(page);
  await page.goto(`/orders/${order}`);
  const box = page.getByRole('region', { name: /Your delivery code/ });
  await expect(box).toBeVisible();
  const text = (await box.locator('p').first().innerText()).trim();
  expect(text).toMatch(/^\d{4}$/);
  await expect(
    page.getByText('Give this code to the delivery person only after', { exact: false }),
  ).toBeVisible();
  await signIn(page, '9000000001', '/partner/shop');
  return text;
}

test.describe('proof of delivery', () => {
  test('the shop needs the customer code to mark an order delivered', async ({ page }) => {
    const order = await orderOutForDelivery(page);
    // No plain "Mark delivered" button any more.
    const card = page.locator('article').filter({ hasText: order });
    await expect(card.getByRole('button', { name: 'Mark delivered' })).toHaveCount(0);

    const code = await deliveryCodeOf(page, order);
    await page.goto('/partner/shop');
    const field = card.getByLabel("Customer's delivery code");
    await field.fill(code === '0000' ? '1111' : '0000');
    await card.getByRole('button', { name: 'Confirm delivery' }).click();
    await expect(card.getByText("That code doesn't match. 4 tries left.")).toBeVisible();
    await field.fill(code);
    await card.getByRole('button', { name: 'Confirm delivery' }).click();

    await page.goto(`/orders/${order}`);
    await expect(page.getByText(/confirmed with your delivery code/)).toBeVisible();
    await expect(page.getByRole('region', { name: /Your delivery code/ })).toHaveCount(0);
  });

  test('5 wrong codes lock it; an admin confirms with a reason', async ({ page }) => {
    const order = await orderOutForDelivery(page);
    const code = await deliveryCodeOf(page, order);
    await page.goto('/partner/shop');
    const card = page.locator('article').filter({ hasText: order });
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) {
      await card.getByLabel("Customer's delivery code").fill(wrong);
      await card.getByRole('button', { name: 'Confirm delivery' }).click();
    }
    await expect(
      card.getByText('Too many wrong codes. Call MechDost support', { exact: false }),
    ).toBeVisible();
    await signOut(page);

    await signIn(page, '9000000003', '/admin/orders');
    const adminCard = page.locator('article').filter({ hasText: order });
    await adminCard.getByRole('button', { name: 'Confirm delivery without the code' }).click();
    await adminCard.getByLabel('Reason (kept on the order)').fill('ok');
    await adminCard.getByRole('button', { name: 'Confirm delivery' }).click();
    await expect(adminCard.getByText('Write a reason of at least 5 characters.')).toBeVisible();
    await adminCard
      .getByLabel('Reason (kept on the order)')
      .fill('Customer phone was off; delivery confirmed by call to the alternate number');
    await adminCard.getByRole('button', { name: 'Confirm delivery' }).click();
    await expect(adminCard.getByText(/without the code: Customer phone was off/)).toBeVisible();

    await page.goto(`/orders/${order}`);
    // The timeline step and the line below both say so now (QA 2026-11-14, B4): check the dated line.
    await expect(page.getByText(/Delivered on .*, confirmed by MechDost support\./)).toBeVisible();
  });
});
