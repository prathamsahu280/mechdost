import { expect, test, type Page } from '@playwright/test';

/**
 * Admin control over partners (decision 2026-11-01): pause or suspend any shop, workshop or mechanic with a
 * reason; paused partners get no new work, suspended ones are hidden and their portal is locked.
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

async function setStatus(page: Page, tab: string, name: string, action: string, reason: string) {
  await page.goto('/admin/partners');
  await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
  const row = page.getByRole('listitem').filter({ hasText: name });
  await row.getByRole('button', { name: action, exact: true }).click();
  await row.getByLabel('Reason (the partner sees it)').fill(reason);
  await row.getByRole('button', { name: `${action} ${name}` }).click();
  return row;
}

test.describe('admin partner controls', () => {
  test('a paused shop gets no new orders and sees why; resuming brings it back', async ({ page }) => {
    // A guest order waiting for routing.
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

    await signIn(page, '9000000003', '/admin/partners');
    // A reason is required.
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Sharma Auto Parts' })
      .getByRole('button', { name: 'Pause', exact: true })
      .click();
    await page.getByRole('button', { name: 'Pause Sharma Auto Parts' }).click();
    await expect(page.getByText('Write a reason of 5 to 300 characters.')).toBeVisible();
    const row = await setStatus(page, 'Shops', 'Sharma Auto Parts', 'Pause', 'Owner on leave this week');
    await expect(row.getByText('Paused', { exact: true })).toBeVisible();
    await expect(row.getByText('No new orders or bookings; current work continues.')).toBeVisible();

    await page.goto('/admin/orders');
    const card = page.locator('article').filter({ hasText: code });
    await expect(card.getByRole('button', { name: 'Route to Sharma Auto Parts' })).toHaveCount(0);
    await signOut(page);

    await signIn(page, '9000000001', '/partner/shop');
    await expect(page.getByText('Paused by MechDost.')).toBeVisible();
    await expect(page.getByText('Owner on leave this week', { exact: false })).toBeVisible();
    await signOut(page);

    await signIn(page, '9000000003', '/admin/partners');
    await setStatus(page, 'Shops', 'Sharma Auto Parts', 'Resume', 'Owner is back');
    await page.goto('/admin/orders');
    await expect(
      page
        .locator('article')
        .filter({ hasText: code })
        .getByRole('button', { name: 'Route to Sharma Auto Parts' }),
    ).toBeVisible();
  });

  test('a suspended workshop disappears for customers and its portal is locked', async ({ page }) => {
    await signIn(page, '9000000003', '/admin/partners');
    const row = await setStatus(
      page,
      'Workshops',
      'Telibandha Car Clinic',
      'Suspend',
      'Repeated complaints about overcharging',
    );
    await expect(row.getByText('Suspended', { exact: true })).toBeVisible();
    await expect(page.getByText(/Telibandha Car Clinic · Suspended by MechDost Operations/)).toBeVisible();

    await page.goto('/workshops');
    await expect(page.getByRole('heading', { name: 'Telibandha Car Clinic' })).toHaveCount(0);
    await page.goto('/workshops/telibandha-car-clinic');
    await expect(
      page.getByText("This workshop isn't available on MechDost right now.", { exact: false }),
    ).toBeVisible();
    await page.goto('/admin/partners');
    await signOut(page);

    await signIn(page, '9000000002', '/partner/workshop');
    await expect(page.getByRole('heading', { name: 'Your account is suspended' })).toBeVisible();
    await expect(page.getByText('Repeated complaints about overcharging', { exact: false })).toBeVisible();
    await signOut(page);

    await signIn(page, '9000000003', '/admin/partners');
    await setStatus(
      page,
      'Workshops',
      'Telibandha Car Clinic',
      'Reactivate',
      'Complaints resolved with refunds',
    );
    await page.goto('/workshops');
    await expect(page.getByRole('heading', { name: 'Telibandha Car Clinic' })).toBeVisible();
  });
});
