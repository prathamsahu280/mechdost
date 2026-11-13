/**
 * Buyer GSTIN at checkout (plan 2026-11-13): optional business purchase; a wrong GSTIN is shown next to its field;
 * a GSTIN from another state is a note, not an error; the GSTIN and business name are shown back on the order and
 * to staff. Demo store (cash on delivery).
 */
import { expect, test, type Page } from '@playwright/test';

async function toCheckout(page: Page, prefix = '') {
  // The cart lives in the browser for both languages: add in English, check out in either.
  await page.goto('/shop/castrol-activ-4t-20w40-900ml');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.goto(`${prefix}/checkout`);
}

async function fillDelivery(page: Page) {
  await page.getByLabel('Full name').fill('Ravi Sahu');
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByLabel('Delivery address').fill('C-605 Salasar Greens, Sarona, Raipur');
  await page.getByLabel('PIN code').fill('492099');
  await page.getByLabel(/I agree to share/).check();
}

test('without a business purchase, checkout and the order are unchanged', async ({ page }) => {
  await toCheckout(page);
  await fillDelivery(page);
  await expect(page.locator('#checkout-gstin')).toHaveCount(0);
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page).toHaveURL(/\/orders\/MD-RPR-/);
  await expect(page.getByText(/GST invoice for/)).toHaveCount(0);
});

test('a business purchase checks the GSTIN, notes another state, and shows on the order and to staff', async ({
  page,
}) => {
  await toCheckout(page);
  await fillDelivery(page);
  await page.getByLabel(/This is a business purchase/).check();
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page.getByText('Enter the business name as on its GST registration.')).toBeVisible();
  await expect(page.getByText('Check the GSTIN: 15 characters, as on the GST certificate.')).toBeVisible();
  await expect(page.getByLabel('GSTIN', { exact: true })).toBeFocused();

  await page.getByLabel('GSTIN', { exact: true }).fill('27AAPFU0939F1ZW');
  await page.getByLabel('Business name (as on GST)').fill('Sahu Motors');
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page.getByLabel('GSTIN', { exact: true })).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('GSTIN', { exact: true }).fill('27aapfu0939f1zv');
  await expect(page.getByText(/registered in Maharashtra.*delivered in Chhattisgarh/)).toBeVisible();
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page).toHaveURL(/\/orders\/MD-RPR-/);
  await expect(page.getByText('GST invoice for Sahu Motors (27AAPFU0939F1ZV)')).toBeVisible();
  const code = /\/orders\/(MD-RPR-[^?]+)/.exec(page.url())?.[1] ?? '';

  await page.goto(`/login?next=${encodeURIComponent('/admin/orders')}`);
  await page.getByLabel('Mobile number or email').fill('9000000003');
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL(/\/admin\/orders$/);
  const card = page.locator('article').filter({ hasText: code });
  await expect(card.getByText('GST invoice for Sahu Motors (27AAPFU0939F1ZV)')).toBeVisible();
});

test('on /hi the state note names the states in Hindi', async ({ page }) => {
  await toCheckout(page, '/hi');
  await page.locator('#checkout-business').check();
  await page.locator('#checkout-gstin').fill('27AAPFU0939F1ZV');
  await expect(page.getByText(/महाराष्ट्र/)).toBeVisible();
  await expect(page.getByText(/छत्तीसगढ़/).first()).toBeVisible();
});
