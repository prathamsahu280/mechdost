import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Admin customisation (spec 08 "Content" + "Settings", hard rule 8) in demo mode: what the admin changes in
 * /admin/content, /admin/layout and /admin/settings shows on the storefront, in both languages, and resets.
 */
async function signInAsAdmin(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Mobile number or email').fill('9000000003');
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Staff two-step: the code sent to their phone.
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

test.describe('admin site customisation (spec 08)', () => {
  test('content edits show on the home page in English and Hindi, and reset', async ({ page }) => {
    await signInAsAdmin(page, '/admin/content');
    await page.locator('#content-hero_titleLine1-en').fill('Genuine parts.');
    await page.locator('#content-hero_titleLine1-hi').fill('असली पार्ट्स।');
    await page.locator('#content-hero_lead-en').fill('Free fitting this week on every battery.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect(page.getByText(/Site content · saved · MechDost Operations/)).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Genuine parts.');
    await expect(page.getByText('Free fitting this week on every battery.')).toBeVisible();
    await page.goto('/hi');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('असली पार्ट्स।');

    // Visiting /hi stored the language choice; go back to English the way a user would.
    await page.context().clearCookies({ name: 'NEXT_LOCALE' });
    await page.goto('/admin/content');
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Automotive essentials.');
  });

  test('home sections can be hidden and reordered; featured categories can change', async ({ page }) => {
    await signInAsAdmin(page, '/admin/layout');
    // Hide the FAQ, move workshops to the top.
    await page.getByRole('listitem').filter({ hasText: 'Questions (FAQ)' }).getByLabel('Show').uncheck();
    for (let i = 0; i < 5; i++)
      await page.getByRole('button', { name: 'Move Top-rated workshops up' }).click();
    await page.getByRole('button', { name: 'Save changes' }).first().click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' }).first()).toBeVisible();

    // Feature EV essentials instead of bearings.
    await page.getByRole('checkbox', { name: /^Bearings/ }).uncheck();
    await page.getByRole('checkbox', { name: /^EV essentials/ }).check();
    await page.getByRole('button', { name: 'Save changes' }).nth(1).click();
    await expect(page.getByText(/Category shortcuts · saved/)).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Good to know' })).toBeHidden();
    const workshopsTop = await page.locator('[data-home-section="workshops"]').boundingBox();
    const productsTop = await page.locator('[data-home-section="products"]').boundingBox();
    expect(workshopsTop?.y ?? 0).toBeLessThan(productsTop?.y ?? 0);
    const tiles = page.getByRole('region', { name: 'What does your vehicle need?' });
    await expect(tiles.getByRole('link', { name: /EV essentials/ })).toBeVisible();
    await expect(tiles.getByRole('link', { name: /Bearings/ })).toBeHidden();
    // Category tiles carry a fixed Lucide icon (emoji removed 2026-11-01).
    await expect(page.locator('[data-home-category="evEssentials"] svg').first()).toBeVisible();

    // The layout survives a full reload (applied before first paint) and resets cleanly.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Good to know' })).toBeHidden();
    await page.goto('/admin/layout');
    await page.getByRole('button', { name: 'Reset to defaults' }).first().click();
    await page.getByRole('button', { name: 'Reset to defaults' }).nth(1).click();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Good to know' })).toBeVisible();
  });

  test('settings drive the bulk minimum, delivery fee and shop timer; bad values are refused', async ({
    page,
  }) => {
    await signInAsAdmin(page, '/admin/settings');
    await page.getByLabel('Bulk quote minimum').fill('1');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter a whole number from 2 to 500.')).toBeVisible();
    await expect(page.getByLabel('Bulk quote minimum')).toBeFocused();

    await page.getByLabel('Bulk quote minimum').fill('25');
    await page.getByLabel('Delivery fee').fill('30');
    await page.getByLabel('Free delivery from').fill('2000');
    await page.getByLabel('Shop acceptance time').fill('30');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

    // Bulk minimum: the copy and the form follow the setting.
    await page.goto('/shop/exide-xltz4a-2w-battery');
    await expect(page.getByRole('link', { name: 'Need 25 or more? Ask for a bulk price.' })).toBeVisible();
    await page.goto('/quotes/new?product=exide-xltz4a-2w-battery');
    await page.getByLabel('Full name').fill('Ravi Sahu');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByLabel('Delivery PIN code').fill('492099');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Add at least 25 units in total for a bulk price.')).toBeVisible();

    // Delivery: ₹1,000 battery is below the new ₹2,000 threshold → ₹30 fee.
    await page.goto('/shop/exide-xltz4a-2w-battery');
    await page.getByRole('button', { name: 'Add to cart' }).first().click();
    await page.goto('/cart');
    await expect(page.getByText('Free delivery on orders from ₹2,000.')).toBeVisible();
    await expect(page.getByText('₹30', { exact: true })).toBeVisible();

    // Shop timer: the home page promise follows the setting.
    await page.goto('/');
    await expect(page.getByText('It accepts within 30 minutes, or we find another shop.')).toBeVisible();

    await page.goto('/admin/settings');
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(page.getByLabel('Bulk quote minimum')).toHaveValue('10');
  });

  test('the customisation screens pass WCAG 2.2 AA and fit small screens', async ({ page }) => {
    // Measure final colours, not a frame of the page fade-in (same as every other axe test).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAsAdmin(page, '/admin/content');
    for (const path of ['/admin/content', '/admin/layout', '/admin/settings', '/hi/admin/settings']) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: /Save changes|बदलाव सेव करें/ }).first()).toBeVisible();
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(axe.violations, path).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBe(
        0,
      );
    }
  });
});
