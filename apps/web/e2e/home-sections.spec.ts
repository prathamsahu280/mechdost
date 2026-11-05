import { expect, test } from '@playwright/test';

/**
 * Home sections from the boodmo / Fixter inspiration pass (redesign 2026-11-05): search by vehicle → shop vehicle
 * filter, popular services → finder, reviews summary, brands → shop search, help band contact links.
 */
test('search by vehicle opens the shop filtered to parts that fit, and the filter can be changed', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Bike or scooter/ }).click();
  await expect(page).toHaveURL(/\/shop\?vehicle=2W$/);
  await expect(page.locator('#shop-vehicle')).toHaveText('Bike or scooter');
  await expect(page.getByRole('article').first()).toBeVisible();
  const twoW = await page.getByRole('article').count();
  expect(twoW).toBeGreaterThan(0);

  await page.locator('#shop-vehicle').click();
  await page.getByRole('option', { name: 'Electric (EV)', exact: true }).click();
  await expect(page).toHaveURL(/vehicle=EV/);
  await expect(page.getByRole('article')).toHaveCount(2);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByRole('article').nth(twoW)).toBeVisible();
});

test('popular services link to the finder with real "from" prices', async ({ page }) => {
  await page.goto('/');
  const services = page.locator('section', { has: page.locator('#services-title') });
  await expect(services.getByRole('link')).toHaveCount(4);
  await expect(services.getByRole('link', { name: /Car periodic service/ })).toContainText('From ₹1,800');
  await services.getByRole('link', { name: /Car periodic service/ }).click();
  await expect(page).toHaveURL(/\/workshops\?vehicle=4W$/);
  await expect(page.locator('input[type="hidden"][name="vehicle"]')).toHaveValue('4W');
});

test('reviews show a summary and unique stories; brands search the shop; help band links to WhatsApp and phone', async ({
  page,
}) => {
  await page.goto('/');
  const reviews = page.locator('section', { has: page.locator('#reviews-title') });
  await expect(reviews.getByText(/out of 5 from \d+ reviews/)).toBeVisible();
  const titles = await reviews.locator('blockquote p:first-child').allInnerTexts();
  expect(titles.length).toBeGreaterThan(2);
  expect(new Set(titles).size).toBe(titles.length);

  const help = page.locator('section', { has: page.locator('#help-title') });
  await expect(help.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', /^https:\/\/wa\.me\//);
  await expect(help.getByRole('link', { name: /Call/ })).toHaveAttribute('href', /^tel:\+91/);

  const brands = page.locator('section', { has: page.locator('#brands-title') });
  await brands.getByRole('link', { name: 'Exide', exact: true }).click();
  await expect(page).toHaveURL(/\/shop\?q=Exide$/);
  // Wait for the results to render before counting (count() does not wait).
  await expect(page.getByRole('article').first()).toBeVisible();
  await expect(page.getByRole('article').first()).toContainText('Exide');
});
