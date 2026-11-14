import { expect, test, type Page } from '@playwright/test';

/**
 * Quantity right where the product is (user 2026-11-14: "after we click add to cart we should be able to add the
 * quantity in there itself too just like swiggy or amazon"): once in the cart, "Add to cart" becomes − / count /
 * +; − at one removes it and "Add to cart" comes back. The header cart count follows every press.
 */
const PRODUCT = 'Castrol Activ 4T 20W40 900 ml';
/** The header cart link announces its count ("Cart, 3 items"). */
const cartLink = (page: Page, items: number) =>
  page.getByRole('link', { name: new RegExp(`Cart\\s*,\\s*${String(items)} items?`) });

test('a product card turns into a quantity stepper after adding', async ({ page }) => {
  await page.goto('/shop/castrol-activ-4t-20w40-900ml');
  const add = page.getByRole('button', { name: 'Add to cart' }).first();
  await add.click();
  const more = page.getByRole('button', { name: `Add one more ${PRODUCT}`, exact: false });
  await expect(more).toBeVisible();
  await expect(page.getByText('1 in cart').first()).toBeVisible();
  await expect(cartLink(page, 1)).toBeVisible();

  await more.click();
  await more.click();
  await expect(page.getByText('3 in cart').first()).toBeVisible();
  await expect(cartLink(page, 3)).toBeVisible();

  await page.getByRole('button', { name: `Remove one ${PRODUCT}`, exact: false }).click();
  await expect(page.getByText('2 in cart').first()).toBeVisible();
  await page.getByRole('button', { name: `Remove one ${PRODUCT}`, exact: false }).click();
  await expect(page.getByText('1 in cart').first()).toBeVisible();
  // At one, the minus removes it from the cart.
  await page.getByRole('button', { name: `Remove ${PRODUCT} from the cart`, exact: false }).click();
  await expect(page.getByRole('button', { name: 'Add to cart' }).first()).toBeVisible();
});

test('the stepper also works on the shop list and stays in step with the cart page', async ({ page }) => {
  await page.goto('/shop?category=lubricants');
  const card = page.locator('article').filter({ hasText: PRODUCT }).first();
  await card.getByRole('button', { name: 'Add to cart' }).click();
  await card.getByRole('button', { name: `Add one more ${PRODUCT}`, exact: false }).click();
  await expect(card.getByText('2 in cart').first()).toBeVisible();
  await page.goto('/cart');
  await expect(page.getByText('Activ 4T 20W40 900 ml').first()).toBeVisible();
  await page.goBack();
  await expect(card.getByText('2 in cart').first()).toBeVisible();
});

test('the Hindi stepper is in Hindi', async ({ page }) => {
  await page.goto('/hi/shop/castrol-activ-4t-20w40-900ml');
  await page.locator('main button:has(svg.lucide-shopping-cart)').first().click();
  await expect(page.getByText('कार्ट में 1').first()).toBeVisible();
});
