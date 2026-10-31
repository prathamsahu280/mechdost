import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Scan in the final visual state: scroll-reveal fades are disabled under reduced motion. */
async function axe(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.describe('shop → cart → checkout → tracking', () => {
  test('a customer can buy a product and follow the order', async ({ page }) => {
    await page.goto('/shop?category=batteries');
    await expect(page.getByRole('status').filter({ hasText: 'products' })).toBeVisible();
    await page.getByRole('link', { name: 'XLTZ4A 24F+24P' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'XLTZ4A 24F+24P' })).toBeVisible();

    await page.getByRole('button', { name: 'Add to cart' }).first().click();
    await expect(page.getByRole('button', { name: 'Added to cart' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Cart\s*,\s*1 item/ })).toBeVisible();

    await page.goto('/cart');
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.getByRole('link', { name: /Cart\s*,\s*2 items/ })).toBeVisible();
    await expect(page.getByText('₹2,000').first()).toBeVisible();
    await page.getByRole('link', { name: 'Proceed to checkout' }).click();

    // Validation: errors appear next to fields and focus moves to the first one.
    await page.getByRole('button', { name: /Place order/ }).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await expect(page.getByLabel('Full name')).toBeFocused();

    await page.getByLabel('Full name').fill('Ravi Sahu');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByLabel('Delivery address').fill('C-605 Salasar Greens, Sarona, Raipur');
    await page.getByLabel('PIN code').fill('110001');
    await page.getByLabel(/I agree to share/).check();
    await page.getByRole('button', { name: /Place order/ }).click();
    await expect(page.getByText(/do not deliver to this PIN yet/)).toBeVisible();

    await page.getByLabel('PIN code').fill('492099');
    await page.getByRole('button', { name: /Place order/ }).click();
    await expect(page).toHaveURL(/\/orders\/MD-RPR-\d{4}-[0-9A-Z]{6}\?new=1$/);
    await expect(page.getByText('Thank you! Your order is placed.')).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText('Confirming with a nearby shop');
    await expect(page.getByRole('link', { name: /Cart\s*,\s*no items/ })).toBeVisible();

    await page.getByText('Demo controls').click();
    await page.getByRole('button', { name: 'Simulate next update' }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText('Confirmed — will be shipped');

    await page.goto('/account');
    await expect(page.getByRole('link', { name: /MD-RPR-/ })).toBeVisible();
  });

  test('search and sort the catalogue from the URL', async ({ page }) => {
    await page.goto('/shop?q=tyre&sort=price_desc');
    const names = await page.getByRole('article').getByRole('heading').allTextContents();
    // Highest price first; "tyre" also matches the tyre pressure gauge (by design).
    expect(names[0]).toContain('Passenger car tyre');
    expect(names).toHaveLength(3);
  });
});

test.describe('workshops → booking → request status', () => {
  test('a customer finds a workshop near a PIN and requests an appointment', async ({ page }) => {
    await page.goto('/workshops');
    await page.getByLabel('PIN code').fill('492006');
    await expect(page.getByText('Sorted by distance from PIN 492006.')).toBeVisible();
    await page.getByLabel('Vehicle type').selectOption('4W');
    const first = page.getByRole('article').first();
    await expect(first).toContainText('Telibandha Car Clinic');
    await first.getByRole('link', { name: 'View services & book' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Telibandha Car Clinic' })).toBeVisible();
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Choose at least one service.')).toBeVisible();

    await page.getByLabel('Make and model').fill('Maruti Dzire');
    await page.getByLabel(/Periodic service/).check();
    await page.getByLabel(/AC inspection/).check();
    await expect(page.getByText(/Expected cost: ₹2,150 – ₹4,700/)).toBeVisible();
    await page.getByLabel('Your name').fill('Ravi Sahu');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByRole('button', { name: 'Send request' }).click();

    await expect(page).toHaveURL(/\/service\/SR-RPR-\d{4}-[0-9A-Z]{6}\?new=1$/);
    await expect(page.getByText('Request sent to Telibandha Car Clinic.')).toBeVisible();
    await page.getByText('Demo controls').click();
    await page.getByRole('button', { name: 'Simulate next update' }).click();
    await expect(page.getByText(/Proposed:/)).toBeVisible();
    await page.getByRole('button', { name: 'Accept proposal' }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText('Appointment confirmed');
  });
});

test.describe('theme and assistant', () => {
  test('dark mode toggles, persists across pages and passes axe', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 400, 'toggle sits in the footer on very small screens');
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Dark mode' }).first();
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/workshops');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await axe(page)).toEqual([]);
    await page.goto('/shop');
    expect(await axe(page)).toEqual([]);
  });

  test('follows the system dark preference without a saved choice', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto('/');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(10, 20, 36)');
    await context.close();
  });

  test('the assistant answers a bulk-order question and closes with Escape', async ({ page }) => {
    await page.goto('/');
    const launcher = page.getByRole('button', { name: 'Ask MechDost' });
    await launcher.click();
    const panel = page.getByRole('dialog', { name: 'MechDost assistant' });
    await expect(panel).toBeVisible();
    await expect(page.getByLabel('Type your question')).toBeFocused();
    await page.getByLabel('Type your question').fill('I need 40 batteries, bulk price?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(panel.getByText(/negotiate the price directly/)).toBeVisible();
    await expect(panel.getByRole('link', { name: /Message on WhatsApp/ })).toHaveAttribute('href', /wa\.me/);
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(launcher).toBeFocused();
  });
});

test.describe('accessibility of the demo flows', () => {
  for (const path of [
    '/shop/castrol-activ-4t-20w40-900ml',
    '/hi/shop/exide-xltz4a-2w-battery',
    '/workshops/shankar-nagar-auto-hub',
    '/hi/workshops',
    '/checkout',
    '/account',
  ]) {
    test(`no WCAG 2.2 AA violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      expect(await axe(page)).toEqual([]);
    });
  }
});
