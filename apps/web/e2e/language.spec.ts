import { expect, test, type Page } from '@playwright/test';

/**
 * Bug 2026-11-02: after a reload on a Hindi page (NEXT_LOCALE=hi), clicking "English" bounced straight back to
 * `/hi/…` — next-intl only writes the cookie on document requests and the switcher used a client-side <Link>.
 * The switcher is now a plain link; these checks replay the user's path in both directions and across reloads.
 */
const localeCookie = async (page: Page) =>
  (await page.context().cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value;

for (const path of ['/', '/shop', '/workshops']) {
  test(`language switch survives reloads on ${path}`, async ({ page }) => {
    const hiPath = path === '/' ? '/hi' : `/hi${path}`;

    // Start in Hindi from a direct load, the way a reload or a shared link leaves the cookie.
    await page.goto(hiPath);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    expect(await localeCookie(page)).toBe('hi');

    await page.getByRole('link', { name: 'English', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/' : path}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await localeCookie(page)).toBe('en');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // And back to Hindi: the choice is remembered too.
    await page.getByRole('link', { name: 'हिंदी', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`${hiPath}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    expect(await localeCookie(page)).toBe('hi');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');

    // One more round trip to English, the step that used to fail.
    await page.getByRole('link', { name: 'English', exact: true }).first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
}
