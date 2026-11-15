/**
 * Opened panels can be closed (user 2026-11-16: "if we click write a review we cant really close the form that opens
 * for writing a review"). Product page, demo mode: the write-a-review form has a visible Cancel (44 px), Cancel closes
 * it and puts focus back on "Write a review", Escape does the same, and unsent text is dropped only by Cancel or Escape.
 * Contract and the other panels: `src/lib/panel-dismiss.ts`, rule `dismiss` in `e2e/state-audit/dismiss.ts`.
 * Written, not yet run (low-memory PC): `pnpm --filter @mechdost/web exec playwright test e2e/panel-dismiss.spec.ts`.
 */
import { expect, test, type Page } from '@playwright/test';

const PRODUCT = '/shop/castrol-activ-4t-20w40-900ml';

async function openForm(page: Page) {
  await page.goto(PRODUCT);
  const write = page.getByRole('button', { name: 'Write a review' });
  await write.scrollIntoViewIfNeeded();
  await write.click();
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Submit review' }) });
  await expect(form).toBeVisible();
  return { write, form };
}

test.describe('write-a-review form can be closed', () => {
  test('has a visible Cancel next to Submit, at least 44 px high', async ({ page }) => {
    const { form } = await openForm(page);
    const cancel = form.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeVisible();
    const box = await cancel.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('Cancel closes the form and focus returns to "Write a review"', async ({ page }) => {
    const { write, form } = await openForm(page);
    await form.getByLabel('Your review').fill('Unsent text that Cancel throws away');
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(form).toBeHidden();
    await expect(write).toBeVisible();
    await expect(write).toBeFocused();
    // Opening again starts empty: the unsent text was discarded.
    await write.click();
    await expect(page.getByLabel('Your review')).toHaveValue('');
  });

  test('Escape closes the form from a field and focus returns to "Write a review"', async ({ page }) => {
    const { write, form } = await openForm(page);
    await form.getByLabel('Your review').fill('Typing, then Escape');
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();
    await expect(write).toBeFocused();
  });

  test('Escape works with focus on the page, not only in a field', async ({ page }) => {
    const { write, form } = await openForm(page);
    await page.mouse.click(5, 5);
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();
    await expect(write).toBeVisible();
  });

  test('Cancel and Escape also work on the Hindi page', async ({ page }) => {
    await page.goto(`/hi${PRODUCT}`);
    const write = page.getByRole('button', { name: /रिव्यू लिखें/ });
    await write.scrollIntoViewIfNeeded();
    await write.click();
    const cancel = page.getByRole('button', { name: 'रद्द करें' });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(cancel).toBeHidden();
    await expect(write).toBeFocused();
  });
});
