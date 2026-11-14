/**
 * Comparison table geometry (bug 2026-11-14, user screenshot: three batteries, the middle one "Save 11%" and 3 in
 * the cart): artwork as tall as the column was wide, crowding the product strip above it; the "Save 11%" badge in
 * one column only pushed that column's button lower; the "3 in cart" stepper was taller than "Add to cart".
 * Now every column has the same slots (artwork, rating, saving, action) and the action sits on one line.
 * Matrix: 2 / 3 / 4 products × in cart or not × 390 / 768 / 1280 / 1920 × light / dark × en / hi.
 * Overnight run: `pnpm --filter @mechdost/web exec playwright test e2e/compare-table-geometry.spec.ts --workers=1`.
 */
import { expect, test, type Page } from '@playwright/test';
import { box, expectAligned, expectChildrenInside, seedStorage } from './helpers/geometry';

const BATTERIES = ['car-starter-battery-45ah', 'exide-xltz4a-2w-battery', 'heavy-duty-battery-90ah'];
const OILS = [
  'castrol-activ-4t-20w40-900ml',
  'motul-3100-4t-10w30-1l',
  'shell-advance-ax7-10w30-1l',
  'hp-racer4-20w40-900ml',
];
const WIDTHS = [390, 768, 1280, 1920] as const;

const LISTS = [
  { label: '2 batteries', slugs: BATTERIES.slice(0, 2), inCart: BATTERIES[1] },
  { label: '3 batteries (user screenshot)', slugs: BATTERIES, inCart: BATTERIES[1] },
  { label: '4 oils', slugs: OILS, inCart: OILS[2] },
] as const;

/** The summary row: one cell per product with artwork, rating, saving and the action. */
function summaryCells(page: Page) {
  return page
    .getByRole('table')
    .getByRole('row')
    .filter({ has: page.locator('.blueprint') })
    .getByRole('cell');
}

async function checkTable(page: Page, count: number, what: string) {
  const cells = summaryCells(page);
  await expect(cells).toHaveCount(count);
  // The action of each column: its last button ("Add to cart", or "+" of the stepper).
  const actions = Array.from({ length: count }, (_, i) => cells.nth(i).getByRole('button').last());
  await expectAligned(actions, 'top', `${what}: action tops`);
  await expectAligned(actions, 'bottom', `${what}: action bottoms`);
  // Each column's own pieces stay inside it; the strip's names and prices too.
  await expectChildrenInside(cells, 'button, a, .blueprint, span, p', `${what}: summary cells`);
  const headers = page
    .getByRole('table')
    .getByRole('columnheader')
    .filter({ has: page.getByRole('link') });
  await expectChildrenInside(headers, 'button, a, p', `${what}: product strip`);
  const prices = Array.from({ length: count }, (_, i) => headers.nth(i).locator('p').first());
  await expectAligned(prices, 'top', `${what}: prices in the strip`);
  // Artwork: a sensible size, below the strip (page not scrolled), never taller than 11rem.
  const strip = await box(page.locator('[data-compare-scroll="head"]'));
  for (let i = 0; i < count; i++) {
    const art = await box(cells.nth(i).locator('.blueprint'));
    expect(art.height, `${what}: artwork ${String(i)} height`).toBeLessThanOrEqual(176);
    expect(art.y, `${what}: artwork ${String(i)} under the strip`).toBeGreaterThanOrEqual(
      strip.y + strip.height + 8,
    );
  }
}

test.describe('comparison table alignment', () => {
  test.skip(({ isMobile }) => isMobile, 'sets its own widths; the phone project would only repeat it');

  for (const list of LISTS)
    for (const width of WIDTHS)
      test(`${list.label} at ${String(width)} px (light, en)`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await seedStorage(page, { 'mechdost-cart': JSON.stringify([{ slug: list.inCart, qty: 3 }]) });
        await page.goto(`/compare?p=${list.slugs.join(',')}`);
        await checkTable(page, list.slugs.length, `${list.label} @${String(width)}`);
      });

  for (const theme of ['light', 'dark'] as const)
    for (const locale of ['en', 'hi'] as const)
      test(`3 batteries, middle in the cart, ${theme} ${locale} at 1920 and 390 px`, async ({ page }) => {
        await seedStorage(page, {
          'mechdost-cart': JSON.stringify([{ slug: BATTERIES[1], qty: 3 }]),
          'mechdost-theme': theme,
        });
        for (const width of [1920, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.goto(`${locale === 'hi' ? '/hi' : ''}/compare?p=${BATTERIES.join(',')}`);
          await checkTable(page, 3, `${theme} ${locale} @${String(width)}`);
        }
      });
});
