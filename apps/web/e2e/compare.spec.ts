/**
 * Product comparison (design 2026-11-13, spec 21): pick engine oils from the shop, open the tray, read ₹ per
 * litre and the "Lowest price per litre" mark, hide identical rows, add to cart from the table; one category at
 * a time; the link is shareable and tolerates bad or mixed slugs; axe clean. Demo data.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { CONSENT_DECIDED } from './fixtures/consent';

test.use({ storageState: CONSENT_DECIDED });

const CASTROL = 'castrol-activ-4t-20w40-900ml';
const MOTUL = 'motul-3100-4t-10w30-1l';
const HP = 'hp-racer4-20w40-900ml';
const EXIDE = 'exide-xltz4a-2w-battery';

/** The product column headers (the first header is the "Detail" corner, kept for screen readers). */
function productHeaders(page: Page) {
  return page
    .getByRole('table')
    .getByRole('columnheader')
    .filter({ has: page.getByRole('link') });
}

/** Taps like a person: the control centred on screen, never under the fixed tab bar or the compare tray. */
async function tap(target: Locator) {
  await target.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
  });
  await target.click();
}

function toggle(page: Page, name: string) {
  return page.getByRole('button', { name: `Compare ${name}`, exact: true });
}

/** The tray floats on screen wherever the shopper has scrolled (bug 2026-11-13: it sat at the end of the page). */
async function expectOnScreen(page: Page, target: Locator) {
  const box = await target.boundingBox();
  const view = page.viewportSize();
  expect(box && view).toBeTruthy();
  if (!box || !view) return;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
}

test('the compare tray floats in view while scrolling the shop', async ({ page }) => {
  await page.goto('/shop?category=lubricants');
  await tap(toggle(page, 'Castrol Activ 4T 20W40 900 ml'));
  const tray = page.getByRole('complementary', { name: 'Products to compare' });
  await expect(tray).toBeVisible();
  await expectOnScreen(page, tray);
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight / 2);
  });
  await expectOnScreen(page, tray);
});

test('compare three engine oils from the shop', async ({ page }) => {
  await page.goto('/shop?category=lubricants');
  for (const name of ['Castrol Activ 4T 20W40 900 ml', 'Motul 3100 4T 10W30 1 L', 'HP Racer4 20W40 900 ml']) {
    await tap(toggle(page, name));
    await expect(toggle(page, name)).toHaveAttribute('aria-pressed', 'true');
  }
  // The card shows the unit price next to the price.
  await expect(page.getByText('₹366.67 per litre').first()).toBeVisible();

  const tray = page.getByRole('complementary', { name: 'Products to compare' });
  await tray.getByRole('link', { name: 'Compare (3)' }).click();
  await expect(page).toHaveURL(new RegExp(`/compare\\?p=${CASTROL},${MOTUL},${HP}$`));

  const table = page.getByRole('table');
  await expect(productHeaders(page)).toHaveCount(3);
  const lowest = table.getByRole('cell').filter({ hasText: 'Lowest price per litre' });
  await expect(lowest).toHaveCount(1);
  await expect(lowest).toContainText('₹366.67 per litre');
  await expect(table.getByRole('cell', { name: '₹488.89 per litre' })).toBeVisible();

  const vehicleRow = table.getByRole('rowheader', { name: 'Vehicle type' });
  await expect(vehicleRow).toBeVisible();
  const diff = page.getByRole('button', { name: 'Only differences' });
  await diff.click();
  await expect(diff).toHaveAttribute('aria-pressed', 'true');
  await expect(vehicleRow).toBeHidden();
  await expect(table.getByRole('rowheader', { name: 'JASO class' })).toBeHidden();
  await expect(table.getByRole('rowheader', { name: 'SAE grade' })).toBeVisible();

  // Add to cart sits in the summary row under each product (third column = HP).
  await tap(table.getByRole('button', { name: 'Add to cart' }).nth(2));
  // The button becomes the quantity stepper once the product is in the cart (user 2026-11-14).
  await expect(table.getByRole('button', { name: /^Add one more HP/ })).toHaveCount(1);
});

test('one category at a time: a battery starts a new comparison', async ({ page }) => {
  await page.goto('/shop?category=lubricants');
  await tap(toggle(page, 'Castrol Activ 4T 20W40 900 ml'));
  await page.goto(`/shop/${EXIDE}`);
  await tap(toggle(page, 'Exide XLTZ4A 24F+24P'));
  // The tray asks (redesign 2026-11-14; the card no longer shows a message of its own).
  const ask = page.getByRole('dialog', { name: 'Start a new comparison with Batteries?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Start new' }).click();
  await expect(toggle(page, 'Exide XLTZ4A 24F+24P')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: 'Compare (1)' })).toBeVisible();
});

test('a shared link opens the same table; bad, extra and other-category slugs are left out', async ({
  page,
}) => {
  await page.goto(`/compare?p=${HP},${CASTROL}`);
  await expect(productHeaders(page)).toHaveCount(2);
  await expect(page.getByRole('note')).toHaveCount(0);

  await page.goto(`/compare?p=${HP},${EXIDE},not-a-product,${CASTROL}`);
  await expect(page.getByRole('note')).toContainText('Some products were left out');
  const headers = productHeaders(page);
  await expect(headers).toHaveCount(2);
  await expect(headers.first()).toContainText('HP Racer4');

  await page.goto('/compare');
  await expect(page.getByRole('heading', { name: 'Pick products to compare' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add products from the shop' })).toBeVisible();
});

test('removing a product from the table updates the link', async ({ page }) => {
  await page.goto(`/compare?p=${CASTROL},${MOTUL},${HP}`);
  await tap(page.getByRole('button', { name: 'Remove HP Racer4 20W40 900 ml' }));
  await expect(page).toHaveURL(new RegExp(`/compare\\?p=${CASTROL},${MOTUL}$`));
  await expect(productHeaders(page)).toHaveCount(2);
});

test('the comparison page passes axe (WCAG 2.2 AA)', async ({ page }) => {
  await page.goto(`/compare?p=${CASTROL},${MOTUL},${HP}`);
  await expect(page.getByRole('table')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
});

test('the left-out note appears only when a requested product is missing', async ({ page }) => {
  // A repeated product is not "left out".
  await page.goto(`/compare?p=${CASTROL},${CASTROL},${MOTUL}`);
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('note')).toHaveCount(0);
  // One product survives (a battery cannot join oils): the note explains; that product stays, with a way to add more.
  await page.goto(`/compare?p=${CASTROL},${EXIDE}`);
  await expect(page.getByRole('note')).toContainText('Some products were left out');
  await expect(productHeaders(page)).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Add a product (1 of 4)' })).toBeVisible();
  // Nothing valid at all.
  await page.goto('/compare?p=not-a-product');
  await expect(page.getByRole('note')).toBeVisible();
});

test('on a phone two products use the full width, the label above their values', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'labels above values only at phone width');
  await page.goto(`/compare?p=${CASTROL},${MOTUL}`);
  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  const row = table
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'MRP', exact: true }) });
  const label = await row.getByRole('rowheader').boundingBox();
  const cells = row.getByRole('cell');
  const first = await cells.first().boundingBox();
  const second = await cells.nth(1).boundingBox();
  const view = page.viewportSize();
  expect(label && first && second && view).toBeTruthy();
  if (!label || !first || !second || !view) return;
  expect(first.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
  expect(first.width).toBeGreaterThan(view.width * 0.38);
  expect(second.x + second.width).toBeLessThanOrEqual(view.width);
  // No scroll box inside the page: the whole comparison is reachable by scrolling the page.
  const inner = await table.evaluate((el) => {
    const body = el.querySelector<HTMLElement>('[data-compare-scroll="body"]');
    return body ? body.scrollHeight - body.clientHeight : 0;
  });
  expect(inner).toBeLessThanOrEqual(1);
});
