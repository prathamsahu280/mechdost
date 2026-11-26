import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Ustaad Network workstreams C (Q&A, Learn) and E (pin my garage, area map, jobs): the web screens in the staff
 * preview with the browser demo's sample data (spec 23 § 5). Every screen: its heading, one primary action, axe clean
 * on `main`, no full reload between list and detail. With USTAAD_SHOTS set to a folder, review screenshots are written
 * there (390 / 1440 light, Hindi 390).
 */
const DEMO_PASSWORD = 'Raipur@2026';
const ADMIN = '9000000003';
const SHOTS = process.env.USTAAD_SHOTS;

async function signIn(page: Page) {
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(ADMIN);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('One-time code').fill('123456');
  await expect(page).not.toHaveURL(/\/login/);
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).include('main').analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

async function shots(page: Page, name: string, path: string) {
  if (!SHOTS) return;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.goto(path);
    await page.locator('main h1').first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${name}-${String(width)}.png`, fullPage: true });
  }
  await page.goto(`/hi${path}`);
  await page.locator('main h1').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}-hi-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await page.locator('main h1').first().waitFor();
}

test.describe('Ustaad Q&A (workstream C)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('Ask list: filters are links, cards open the thread without a reload; axe clean', async ({ page }) => {
    await page.goto('/ustaad/ask');
    await expect(page.getByRole('heading', { level: 1, name: 'Ask the Ustaads' })).toBeVisible();
    await expect(page.getByText('Sample data')).toBeVisible();
    const filters = page.getByRole('navigation', { name: 'Which questions' });
    await expect(filters.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page');
    await axe(page);
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });
    await filters.getByRole('link', { name: 'Mine' }).click();
    await expect(page).toHaveURL(/filter=mine/);
    await expect(page.getByText('Bolero AC thanda nahi kar raha')).toBeVisible();
    await expect(page.getByText('Splendor Plus self start')).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Which questions' })
      .getByRole('link', { name: 'All' })
      .click();
    await page.getByText('Splendor Plus self start').click();
    await expect(page).toHaveURL(/\/ustaad\/q\/UQ-RPR-2026-K7QM2D/);
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
    await shots(page, 'ustaad-ask', '/ustaad/ask');
  });

  test('Thread: best answer first with parts, Listen, Helpful once; axe clean', async ({ page }) => {
    await page.goto('/ustaad/q/UQ-RPR-2026-K7QM2D');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Splendor Plus');
    const best = page.getByRole('article').filter({ hasText: 'Best answer, chosen by the asker' });
    await expect(best).toContainText('starter relay');
    await expect(best.getByRole('link', { name: 'Exide XLTZ4A battery' })).toHaveAttribute(
      'href',
      '/shop/exide-xltz4a-2w-battery',
    );
    await expect(page.getByText('Community advice, not a professional guarantee.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play voice note' }).first()).toBeVisible();
    // Helpful on someone else's answer: counted once.
    await page.getByRole('button', { name: 'Helpful · 3', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Helpful · 4', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Not the asker: no "Mark as best".
    await expect(page.getByRole('button', { name: 'Mark as best' })).toHaveCount(0);
    // An Ustaad can answer.
    await expect(page.getByRole('heading', { name: 'Your answer' })).toBeVisible();
    await axe(page);
    await shots(page, 'ustaad-thread', '/ustaad/q/UQ-RPR-2026-K7QM2D');
  });

  test('Asker marks the best answer on their own question', async ({ page }) => {
    await page.goto('/ustaad/q/UQ-RPR-2026-M4ZC5J');
    await page.getByRole('button', { name: 'Mark as best' }).click();
    await expect(page.getByText('Marked as the best answer.')).toBeVisible();
    await expect(page.getByText('Best answer, chosen by the asker')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as best' })).toHaveCount(0);
  });

  test('Safety note on a brake question; answer by text', async ({ page }) => {
    await page.goto('/ustaad/q/UQ-RPR-2026-T5WQ3L');
    await expect(page.getByText('Brakes save lives.')).toBeVisible();
    await page.getByRole('button', { name: 'Post answer' }).click();
    await expect(page.getByText('Speak or write your answer first.')).toBeVisible();
    await page.getByLabel('Or write your answer').fill('Master cylinder ki seal check karo.');
    await page.getByRole('button', { name: 'Post answer' }).click();
    await expect(page.getByText('Answer posted.')).toBeVisible();
    await expect(page.getByText('Master cylinder ki seal check karo.')).toBeVisible();
  });

  test('Composer: needs voice or words; sends a typed question; Close goes back', async ({ page }) => {
    await page.goto('/ustaad/ask/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Ask a question' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Record voice note' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make it clearer' })).toBeVisible();
    await axe(page);
    await shots(page, 'ustaad-ask-composer', '/ustaad/ask/new');
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect(page.getByText('Speak or write your question first.')).toBeVisible();
    await expect(page.getByLabel('Your question in one line (vehicle + problem)')).toBeFocused();
    await page
      .getByLabel('Your question in one line (vehicle + problem)')
      .fill('Pulsar 150 garam hone pe band');
    await page.getByRole('radio', { name: 'Two-wheeler' }).check();
    await page.getByRole('checkbox', { name: 'Engine' }).check();
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect(page.getByText('Question sent.')).toBeVisible();
    await page.getByRole('link', { name: 'Open my question' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pulsar 150');
    await page.goto('/ustaad/ask/new');
    await page.getByRole('link', { name: 'Close' }).click();
    await expect(page).toHaveURL(/\/ustaad\/ask$/);
  });
});

test.describe('Ustaad Learn (workstream C)', () => {
  test('courses, data saver, tap to play, self-mark an external video; axe clean', async ({ page }) => {
    await signIn(page);
    await page.goto('/ustaad/learn');
    await expect(page.getByRole('heading', { level: 1, name: 'Learn' })).toBeVisible();
    await expect(page.getByText('1 of 3 lessons done')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Data saver' })).toBeChecked();
    await expect(page.locator('video')).toHaveCount(0); // nothing loads before a tap
    await axe(page);
    await page.getByRole('button', { name: 'Play Pin your garage on the map' }).click();
    await expect(page.locator('video')).toHaveCount(1);
    await expect(page.locator('video')).toHaveAttribute('preload', 'none');
    await page.getByRole('button', { name: 'Mark as watched' }).click();
    await expect(page.getByText('Marked as watched.')).toBeVisible();
    await shots(page, 'ustaad-learn', '/ustaad/learn');
  });
});

test.describe('Ustaad local (workstream E)', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { latitude: 21.2458, longitude: 81.6501, accuracy: 18 },
  });

  test('Pin my garage: GPS fix, arrows, choices off by default, confirm, signboard; axe clean', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/ustaad/pin');
    await expect(page).toHaveURL(/\/ustaad\/me\/location$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Pin my garage' })).toBeVisible();
    for (const name of [
      'Use my pin to check my garage',
      'Count me in my area total',
      'Show my exact pin to other mechanics',
    ])
      await expect(page.getByRole('switch', { name })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'This is my garage' })).toBeDisabled();
    await axe(page);
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByText('Found you, accurate to about 18 m.')).toBeVisible();
    await page.getByRole('button', { name: 'Move up' }).click();
    await page.getByRole('switch', { name: 'Count me in my area total' }).check();
    await page.getByRole('button', { name: 'This is my garage' }).click();
    await expect(page.getByText('Location confirmed. Others see only your area.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Get "Verified location"' })).toBeVisible();
    await shots(page, 'ustaad-pin', '/ustaad/me/location');
  });

  test('Pin moved far by hand needs a landmark', async ({ page }) => {
    await signIn(page);
    await page.goto('/ustaad/me/location');
    await page.getByRole('button', { name: 'Use my location' }).click();
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Move right' }).click();
    await page.getByRole('button', { name: 'This is my garage' }).click();
    await expect(page.getByText('Add a landmark first.')).toBeVisible();
    await expect(page.getByLabel('Nearby landmark')).toBeFocused();
  });

  test('Area map: banded counts only, list equivalent; axe clean', async ({ page }) => {
    await signIn(page);
    await page.goto('/ustaad/area');
    await expect(page.getByRole('heading', { level: 1, name: 'Area map' })).toBeVisible();
    await expect(page.locator('figure svg').first()).toBeVisible();
    await expect(page.getByText('Few mechanics nearby').first()).toBeVisible();
    await expect(page.getByText('5+ mechanics').first()).toBeVisible();
    await page.getByRole('button', { name: /Area 1/ }).click();
    await expect(page.getByText('Who works here')).toBeVisible();
    await axe(page);
    await shots(page, 'ustaad-area', '/ustaad/area');
  });

  test('Jobs: anti-scam banner everywhere, apply sheet (Escape returns focus), apply', async ({ page }) => {
    await signIn(page);
    await page.goto('/ustaad/jobs');
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs near you' })).toBeVisible();
    await expect(
      page.getByRole('note').filter({ hasText: 'MechDost never asks for money for a job' }),
    ).toBeVisible();
    await axe(page);
    await shots(page, 'ustaad-jobs', '/ustaad/jobs');
    await page.getByText('Bike mechanic chahiye').click();
    await expect(page).toHaveURL(/UJ-RPR-2026-Q4MZ7A/);
    await expect(
      page.getByRole('note').filter({ hasText: 'MechDost never asks for money for a job' }),
    ).toBeVisible();
    await expect(
      page.getByText('This employer confirmed they hire only people aged 18 or older.'),
    ).toBeVisible();
    await axe(page);
    const apply = page.getByRole('button', { name: 'Apply with my card' });
    await apply.click();
    const dialog = page.getByRole('dialog', { name: 'Send your card' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('checkbox', { name: 'Share my phone number with this employer' }),
    ).not.toBeChecked();
    if (SHOTS) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
        await page.screenshot({ path: `${SHOTS}/ustaad-job-apply-${String(width)}.png` });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(apply).toBeFocused();
    await apply.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Send application' }).click();
    await expect(page.getByText('Application sent. The employer sees your card.')).toBeVisible();
    await shots(page, 'ustaad-job', '/ustaad/jobs/UJ-RPR-2026-Q4MZ7A');
  });

  test('Post a job: errors beside fields, 18+ box required, then posted', async ({ page }) => {
    await signIn(page);
    await page.goto('/ustaad/jobs/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Post a job' })).toBeVisible();
    await axe(page);
    await shots(page, 'ustaad-job-post', '/ustaad/jobs/new');
    await page.getByRole('button', { name: 'Post job' }).click();
    await expect(page.getByLabel('Job title')).toBeFocused();
    await expect(page.getByText('Tick this to post.')).toBeVisible();
    await page.getByLabel('Job title').fill('Car mechanic chahiye');
    await page.getByLabel('About the job').fill('Maruti aur Hyundai ka kaam, roz 8 gaadi.');
    await page.getByLabel('Area', { exact: true }).fill('Pandri');
    await page.getByLabel('Pay from (₹ a month)').fill('15000');
    await page.getByLabel('Pay up to (₹ a month)').fill('12000');
    await page.getByLabel('Timing', { exact: true }).fill('9 to 7');
    await page.getByRole('checkbox', { name: 'I hire only people aged 18 or older' }).check();
    await page.getByRole('button', { name: 'Post job' }).click();
    await expect(page.getByText('Enter the pay in whole rupees.')).toBeVisible();
    await page.getByLabel('Pay up to (₹ a month)').fill('18,000');
    await page.getByRole('button', { name: 'Post job' }).click();
    await expect(page.getByText('Job posted.')).toBeVisible();
    await page.getByRole('link', { name: 'Your job' }).click();
    await expect(page.getByRole('button', { name: 'Pause job' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply with my card' })).toHaveCount(0);
  });
});
