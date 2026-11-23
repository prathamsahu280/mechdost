import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The email link page /auth/action (Firebase custom action URL, 2026-11-23). Demo mode has no Firebase, so these
 * check the states that need none: a link without a code, an unknown mode, both languages, the `lang=hi` move,
 * one next action, no noindex leak, axe clean. The real code paths run against the Auth Emulator in real-auth.spec.
 */
test.describe('email link page', () => {
  for (const [prefix, title] of [
    ['', 'This link did not work'],
    ['/hi', 'यह लिंक काम नहीं किया'],
  ] as const) {
    test(`missing code shows one clear next step (${prefix || 'en'})`, async ({ page }) => {
      await page.goto(`${prefix}/auth/action?mode=resetPassword`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      const links = page.locator('main a[data-track^="email_action_"]');
      await expect(links).toHaveCount(1);
      await expect(links.first()).toHaveAttribute('href', `${prefix}/login`);
      expect((await links.first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      expect(axe.violations).toEqual([]);
    });
  }

  test('a verify link without a code sends people to their account for a new one', async ({ page }) => {
    await page.goto('/auth/action?mode=verifyEmail&oobCode=x');
    await expect(page.locator('main a[data-track="email_action_new_link"]')).toHaveAttribute(
      'href',
      '/account',
    );
  });

  test('lang=hi on the English route moves to the Hindi page with the same query', async ({ page }) => {
    await page.goto('/auth/action?mode=verifyEmail&oobCode=abcDEF123456&lang=hi');
    await expect(page).toHaveURL(/\/hi\/auth\/action\?.*mode=verifyEmail/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  });
});
