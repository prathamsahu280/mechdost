import { expect, test } from '@playwright/test';

/**
 * Home banner carousel + header (redesign 2026-11-02, SpareVillage-style). Three illustrated slides; dots, pause/play
 * and inert off-screen slides; site search and the category bar in the header.
 */
test.describe('home banner carousel', () => {
  test('dots move between slides, only the visible slide is interactive, and it can be paused', async ({
    page,
  }) => {
    await page.goto('/');
    const carousel = page.getByRole('region', { name: 'Highlights' });
    await expect(carousel).toHaveAttribute('aria-roledescription', 'carousel');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(carousel.getByRole('group', { name: '1 of 3' })).toBeVisible();

    // Pause first so auto-advance cannot move the slides under the test.
    await carousel.getByRole('button', { name: 'Pause slideshow' }).click();
    await expect(carousel.getByRole('button', { name: 'Play slideshow' })).toBeVisible();

    await carousel.getByRole('button', { name: 'Show slide 2' }).click();
    await expect(carousel.getByRole('button', { name: 'Show slide 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const second = carousel.getByRole('group', { name: '2 of 3' });
    await expect(second).not.toHaveAttribute('inert');
    await expect(carousel.getByRole('group', { name: '1 of 3' })).toHaveAttribute('inert', '');

    await second.getByRole('link', { name: 'Find a workshop' }).click();
    await expect(page).toHaveURL(/\/workshops$/);
  });

  test('auto-advances when playing and stays put under reduced motion', async ({ browser }) => {
    const moving = await browser.newPage();
    await moving.goto('/');
    await expect(moving.getByRole('button', { name: 'Show slide 2' })).toHaveAttribute(
      'aria-current',
      'true',
      {
        timeout: 12_000,
      },
    );
    await moving.close();

    const still = await browser.newPage({ reducedMotion: 'reduce' });
    await still.goto('/');
    await expect(still.getByRole('button', { name: 'Pause slideshow' })).toHaveCount(0);
    await still.waitForTimeout(8_000);
    await expect(still.getByRole('button', { name: 'Show slide 1' })).toHaveAttribute('aria-current', 'true');
    await still.close();
  });
});

test('the category bar opens the shop filtered by category', async ({ page }) => {
  await page.goto('/');
  const bar = page.getByRole('navigation', { name: 'Shop by category' });
  await bar.getByRole('link', { name: 'Batteries', exact: true }).click();
  await expect(page).toHaveURL(/\/shop\?category=batteries$/);
  await expect(page.locator('input[type="hidden"][name="category"]')).toHaveValue('batteries');
});
