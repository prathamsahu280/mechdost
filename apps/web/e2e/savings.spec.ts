import { expect, test, type Page } from '@playwright/test';

/**
 * "Your savings" (shopping personalisation phase 4, decision 2026-11-26) in the demo store: the cart shows a server-
 * style estimate vs the maker's printed MRP with "final after delivery"; the order page shows the estimate while on
 * its way and the final line once delivered; the account overview card sums delivered orders this month / this year;
 * Hindi keeps MRP in Latin script. The battery costs ₹1,000 against a printed MRP of ₹1,120: ₹120 saved.
 */
const DEMO_PASSWORD = 'Raipur@2026';
const CUSTOMER = '9876543210';
const BATTERY = '/shop/exide-xltz4a-2w-battery';

async function addBattery(page: Page, prefix = '') {
  await page.goto(`${prefix}${BATTERY}`);
  await page
    .getByRole('button', { name: prefix ? 'कार्ट में डालें' : 'Add to cart' })
    .first()
    .click();
}

async function placeOrder(page: Page): Promise<string> {
  await addBattery(page);
  await page.goto('/checkout');
  await page.getByLabel('Full name').fill('Ravi Sahu');
  await page.getByLabel('Mobile number').fill(CUSTOMER);
  await page.getByLabel('Delivery address').fill('C-605 Salasar Greens, Sarona, Raipur');
  await page.getByLabel('PIN code').fill('492099');
  await page.getByLabel(/I agree to share/).check();
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page).toHaveURL(/\/orders\/MD-RPR-/);
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

/** The demo has no shop to deliver it: mark the stored order delivered, as the shop's delivery code would. */
async function markDelivered(page: Page, code: string) {
  await page.evaluate((c) => {
    const key = 'mechdost-demo-orders';
    const orders = JSON.parse(window.localStorage.getItem(key) ?? '[]') as { code: string; stage: number }[];
    window.localStorage.setItem(
      key,
      JSON.stringify(orders.map((o) => (o.code === c ? { ...o, stage: 5 } : o))),
    );
  }, code);
}

test('the cart shows the estimate vs the printed MRP, final after delivery', async ({ page }) => {
  await addBattery(page);
  await page.goto('/cart');
  const row = page.locator('dl div', { hasText: "Estimated saving vs the maker's printed MRP" });
  await expect(row).toBeVisible();
  await expect(row.locator('dd')).toHaveText(/₹\s?120/);
  await expect(page.getByText('Estimate, final after delivery.')).toBeVisible();
  // Honest wording only: no strike-through "was" price, no percentage hype.
  await expect(page.locator('main')).not.toContainText(/was ₹|% off|sale price/i);
});

test('the order page shows an estimate on the way and the saving once delivered; the account card sums it', async ({
  page,
}) => {
  const code = await placeOrder(page);
  await expect(page.getByText("You save about ₹120 vs the maker's printed MRP on this order")).toBeVisible();
  await expect(page.getByText('Estimate. The final figure is set after delivery.')).toBeVisible();

  await markDelivered(page, code);
  await page.reload();
  await expect(page.getByText("You saved ₹120 vs the maker's printed MRP on this order")).toBeVisible();
  await expect(page.getByText('Estimate. The final figure is set after delivery.')).toHaveCount(0);

  await page.goto('/login?next=%2Faccount');
  await page.getByLabel('Mobile number or email').fill(CUSTOMER);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  const card = page.getByRole('region', { name: 'Your savings' });
  await expect(card).toBeVisible();
  await expect(card.getByText("You saved ₹120 this year vs the maker's printed MRP")).toBeVisible();
  await expect(card.getByText('This month')).toBeVisible();
  await expect(card.getByText('1 delivered order')).toBeVisible();
  // The breakdown is behind a native disclosure (keyboard: Enter opens it).
  await card.getByText('How it adds up').focus();
  await page.keyboard.press('Enter');
  await expect(card.getByText('Price below the printed MRP')).toBeVisible();
});

test('Hindi: the cart estimate is in Hindi with MRP kept in Latin script', async ({ page }) => {
  await addBattery(page, '/hi');
  await page.goto('/hi/cart');
  await expect(page.getByText('निर्माता के छपे MRP की तुलना में अनुमानित बचत')).toBeVisible();
  await expect(page.getByText('अनुमान, डिलीवरी के बाद पक्का।')).toBeVisible();
});
