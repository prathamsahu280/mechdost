import { expect, test, type Page } from '@playwright/test';

/**
 * Hold-to-talk with Chromium's fake microphone (spec 23 § 4 flow 3; workstream C web). A separate file because the
 * fake device needs its own browser launch options. Tap once to start, tap again to stop (the single-pointer path).
 */
test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

async function signIn(page: Page) {
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill('9000000003');
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('One-time code').fill('123456');
  await expect(page).not.toHaveURL(/\/login/);
}

test('tap to start, tap to stop; play back, record again', async ({ page }) => {
  await signIn(page);
  await page.goto('/ustaad/ask/new');
  const mic = page.getByRole('button', { name: 'Record voice note' });
  await mic.click();
  await expect(page.getByRole('button', { name: 'Record voice note', pressed: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Record voice note', pressed: true }).click();
  await expect(page.getByText(/Recorded 0:0[1-2]/).last()).toBeVisible();
  await expect(page.getByLabel('Voice note')).toBeVisible();
  await page.getByRole('button', { name: 'Record again' }).click();
  await expect(page.getByRole('button', { name: 'Record voice note' })).toBeVisible();
});
