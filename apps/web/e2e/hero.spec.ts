import { expect, test } from '@playwright/test';

/** Home hero search console: workshop mode hands PIN + vehicle to the finder (custom select, GET form). */
test('hero workshop search opens the finder with the PIN and vehicle applied', async ({ page }) => {
  await page.goto('/');
  // The mode tabs are a native radio group (label text differs by width, the radio role does not).
  await page.getByRole('radio', { name: /Workshop/ }).check();
  await page.getByLabel('Your PIN code').fill('492006');
  await page.getByRole('combobox', { name: 'Vehicle' }).click();
  await page.getByRole('option', { name: 'Car', exact: true }).click();
  await expect(page.locator('#hero-vehicle')).toHaveText('Car');
  await page.getByRole('button', { name: 'Find workshops' }).click();

  await expect(page).toHaveURL(/\/workshops\?pin=492006&vehicle=4W$/);
  await expect(page.getByText('Sorted by distance from PIN 492006.')).toBeVisible();
  await expect(page.locator('input[type="hidden"][name="vehicle"]')).toHaveValue('4W');
  await expect(page.getByRole('article').first()).toContainText('Telibandha Car Clinic');
});
