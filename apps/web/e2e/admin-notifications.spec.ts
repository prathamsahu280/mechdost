import { expect, test, type Page } from '@playwright/test';

/**
 * Admin → Notifications and the map default view (hard rule 8; user 2026-11-02: "all these options need to be
 * with the admin too"). WhatsApp text is checked like the API: no offer wording, exact placeholders.
 */
async function signInAdmin(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Mobile number or email').fill('9000000003');
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

test.describe('admin notifications', () => {
  test('edits WhatsApp text with the offer and placeholder checks, switches it on and sets the budget', async ({
    page,
  }) => {
    await signInAdmin(page, '/admin/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications', level: 2 })).toBeVisible();
    await expect(page.getByText('WhatsApp is off')).toBeVisible();

    const card = page.locator('form').filter({ hasText: 'Out for delivery (with the delivery code)' });
    const english = card.getByLabel('English message');
    await expect(english).toHaveValue(/\{\{1\}\}.*\{\{2\}\}/);
    // The preview fills sample values.
    await expect(card.getByText(/Share delivery code 4821/)).toBeVisible();

    await english.fill('Your order {{1}} is on its way, code {{2}}. Get 10% off your next order!');
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(card.getByText(/can’t mention offers, discounts or coupons/)).toBeVisible();
    await expect(english).toBeFocused();

    await english.fill('Your order {{1}} is on its way.');
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(card.getByText('Use every placeholder: {{1}}, {{2}}.')).toBeVisible();

    await english.fill('Your order {{1}} is on its way. Delivery code: {{2}}.');
    await card.getByRole('switch', { name: 'Send on WhatsApp' }).check({ force: true });
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(card.getByText('Saved.')).toBeVisible();
    await expect(page.getByText(/switched on “Out for delivery \(with the delivery code\)”/)).toBeVisible();

    // Survives a reload (stored in the demo store; production stores it through the API).
    await page.reload();
    const after = page.locator('form').filter({ hasText: 'Out for delivery (with the delivery code)' });
    await expect(after.getByLabel('English message')).toHaveValue(
      'Your order {{1}} is on its way. Delivery code: {{2}}.',
    );
    await expect(after.getByRole('switch', { name: 'Send on WhatsApp' })).toBeChecked();

    const budget = page.getByLabel('Alert admins above (₹)');
    await budget.fill('abc');
    await page.getByRole('button', { name: 'Save budget' }).click();
    await expect(page.getByText(/Enter whole rupees from 0 to/)).toBeVisible();
    await budget.fill('3000');
    await page.getByRole('button', { name: 'Save budget' }).click();
    await expect(page.getByText('₹0 of ₹3,000 used this month')).toBeVisible();
  });

  test('admin sets the workshop map default view; a viewer’s own choice still wins', async ({ page }) => {
    await signInAdmin(page, '/admin/layout');
    await page.getByRole('radio', { name: /Plain map/ }).check();
    await page.getByRole('button', { name: 'Save map view' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.goto('/workshops');
    const map = page.getByRole('region', { name: 'Map of workshops' });
    const satellite = map.getByRole('button', { name: 'Satellite' });
    await expect(satellite).toHaveAttribute('aria-pressed', 'false');
    await satellite.click();
    await page.reload();
    await expect(map.getByRole('button', { name: 'Satellite' })).toHaveAttribute('aria-pressed', 'true');
  });
});
