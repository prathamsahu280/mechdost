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

test('hold to talk: press, speak, let go records a note', async ({ page }) => {
  await signIn(page);
  await page.goto('/ustaad/ask/new');
  const mic = page.getByRole('button', { name: 'Record voice note' });
  const box = await mic.boundingBox();
  if (!box) throw new Error('mic not laid out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await expect(page.getByText(/Recorded 0:0[1-2]/).last()).toBeVisible();
});

test('ask by voice only: sent, opens as "Voice question", plays back; no CSP errors', async ({ page }) => {
  const csp: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) csp.push(m.text());
  });
  await signIn(page);
  await page.goto('/ustaad/ask/new');
  await page.getByRole('button', { name: 'Record voice note' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText(/Recorded 0:0[1-2]/).last()).toBeVisible();
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('Question sent.')).toBeVisible();
  await page.getByRole('link', { name: 'Open my question' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Voice question' })).toBeVisible();
  await page.getByRole('button', { name: 'Play voice note' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByText('Could not play the voice note.')).toHaveCount(0);
  expect(csp).toEqual([]);
});

test('tap to start, tap to stop; play back, record again', async ({ page }) => {
  await signIn(page);
  await page.goto('/ustaad/ask/new');
  const mic = page.getByRole('button', { name: 'Record voice note' });
  await mic.click();
  // While recording the button's name is its visible word "Stop" (spec 23 § 10b; no aria-pressed).
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText(/Recorded 0:0[1-2]/).last()).toBeVisible();
  await expect(page.getByLabel('Voice note')).toBeVisible();
  await page.getByRole('button', { name: 'Record again' }).click();
  await expect(page.getByRole('button', { name: 'Record voice note' })).toBeVisible();
});

test('Cancel while recording discards the take (spec 23 § 10b, audit 9)', async ({ page }) => {
  await signIn(page);
  await page.goto('/ustaad/ask/new');
  await page.getByRole('button', { name: 'Record voice note' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Recording cancelled, nothing was saved').first()).toBeAttached();
  await expect(page.getByText(/Recorded 0:0/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record voice note' })).toBeFocused();
});
