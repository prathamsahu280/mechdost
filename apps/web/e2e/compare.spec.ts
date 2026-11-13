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
  await expect(table.getByRole('columnheader')).toHaveCount(3);
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

  const hpColumn = table.getByRole('columnheader').filter({ hasText: 'HP Racer4' });
  await tap(hpColumn.getByRole('button', { name: 'Add to cart' }));
  await expect(hpColumn.getByRole('button', { name: 'Added' })).toBeVisible();
});

test('one category at a time: a battery starts a new comparison', async ({ page }) => {
  await page.goto('/shop?category=lubricants');
  await tap(toggle(page, 'Castrol Activ 4T 20W40 900 ml'));
  await page.goto(`/shop/${EXIDE}`);
  await tap(toggle(page, 'Exide XLTZ4A 24F+24P'));
  await expect(
    page.getByRole('status').filter({ hasText: 'You can compare one category at a time.' }),
  ).toBeVisible();
  await tap(page.getByRole('button', { name: 'Start a new comparison' }));
  await expect(toggle(page, 'Exide XLTZ4A 24F+24P')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: 'Compare (1)' })).toBeVisible();
});

test('a shared link opens the same table; bad, extra and other-category slugs are left out', async ({
  page,
}) => {
  await page.goto(`/compare?p=${HP},${CASTROL}`);
  await expect(page.getByRole('table').getByRole('columnheader')).toHaveCount(2);
  await expect(page.getByRole('note')).toHaveCount(0);

  await page.goto(`/compare?p=${HP},${EXIDE},not-a-product,${CASTROL}`);
  await expect(page.getByRole('note')).toContainText('Some products were left out');
  const headers = page.getByRole('table').getByRole('columnheader');
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
  await expect(page.getByRole('table').getByRole('columnheader')).toHaveCount(2);
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
