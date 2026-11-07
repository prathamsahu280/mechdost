import { expect, test } from '@playwright/test';

/**
 * Booking cancellation (spec 06): the customer cancels until the workshop has the vehicle, with a reason code;
 * the workshop no longer sees the request and nothing moves it forward.
 */
test('the customer cancels a workshop booking; the workshop stops seeing it', async ({ page }) => {
  await page.goto('/workshops/telibandha-car-clinic');
  await page.getByLabel('Make and model').fill('Maruti Dzire');
  await page.getByLabel(/Periodic service/).check();
  await page.getByLabel('Your name').fill('Ravi Sahu');
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page).toHaveURL(/\/service\/SR-RPR-/);
  const code = new URL(page.url()).pathname.split('/').at(-1) ?? '';

  await page.getByRole('button', { name: 'Cancel this booking' }).click();
  await page.getByLabel('Why are you cancelling?').selectOption('found_another_workshop');
  await page.getByRole('button', { name: 'Cancel booking', exact: true }).click();
  await expect(page.getByText('Booking cancelled')).toBeVisible();
  await expect(page.locator('#request-cancelled')).toBeFocused();
  await expect(page.getByText(/You cancelled this booking on .* · Found another workshop/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel this booking' })).toHaveCount(0);

  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill('9000000002'); // the workshop owner
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/partner\/workshop$/);
  await expect(page.locator('article').filter({ hasText: code })).toHaveCount(0);
});

test('the Hindi booking page offers the cancel in Hindi', async ({ page }) => {
  await page.goto('/hi/workshops/telibandha-car-clinic');
  await page
    .getByLabel(/मेक और मॉडल|मॉडल/)
    .first()
    .fill('Maruti Dzire');
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByLabel(/आपका नाम/).fill('Ravi Sahu');
  await page.getByLabel(/मोबाइल नंबर/).fill('9876543210');
  // Scoped to the page content: the header search form has a submit button too.
  await page.locator('main form button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/hi\/service\/SR-RPR-/);
  await expect(page.getByRole('button', { name: 'यह बुकिंग रद्द करें' })).toBeVisible();
});
