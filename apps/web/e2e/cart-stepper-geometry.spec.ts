/**
 * Quantity stepper geometry (bug 2026-11-14, user screenshot at ~1500–1900 px): hovering "+" on a card's stepper
 * painted its hover surface over the quantity — the "3" vanished. Cause: the words "3 in cart" were shown once the
 * stepper reached 11rem, but the card's `px-3` padding and the 2 px border left less room than the words need, so
 * the text overflowed its (shrinkable) box under the "+" button. Also the stepper was 4 px taller than "Add to cart"
 * (border outside the 44 px buttons), so the card jumped when it appeared.
 * Checks every state at card widths from the narrowest grid column up: − / count / + never overlap and the count's
 * text stays between them (hover, keyboard focus, at 1 with the bin, at 99 with + disabled); targets ≥ 44 px;
 * the stepper is exactly as tall as "Add to cart".
 * Overnight run: `pnpm --filter @mechdost/web exec playwright test e2e/cart-stepper-geometry.spec.ts --workers=1`.
 */
import { expect, test, type Locator } from '@playwright/test';
import {
  box,
  expectAligned,
  expectInside,
  expectNoOverlap,
  overlaps,
  seedStorage,
  textBox,
} from './helpers/geometry';

const CASTROL = { slug: 'castrol-activ-4t-20w40-900ml', name: 'Castrol Activ 4T 20W40 900 ml' };
const MOTUL = 'Motul 3100 4T 10W30 1 L';
const WIDTHS = [360, 390, 768, 1024, 1280, 1500, 1680, 1920] as const;

function parts(card: Locator, qty: number) {
  const minus =
    qty === 1
      ? card.getByRole('button', { name: `Remove ${CASTROL.name} from the cart`, exact: false })
      : card.getByRole('button', { name: `Remove one ${CASTROL.name}`, exact: false });
  const plus = card.getByRole('button', { name: `Add one more ${CASTROL.name}`, exact: false });
  // The count: the element between the two buttons that holds the number.
  const count = minus.locator('xpath=following-sibling::*[1]');
  return { minus, plus, count, stepper: minus.locator('xpath=..') };
}

async function expectCountClear(p: ReturnType<typeof parts>, qty: number, what: string) {
  await expect(p.count).toContainText(String(qty));
  await expectNoOverlap([p.minus, p.count, p.plus], what);
  const text = await textBox(p.count);
  for (const button of [p.minus, p.plus])
    expect(overlaps(text, await box(button)), `${what}: count text runs under a button`).toBe(false);
  // The number itself is what the shopper sees at that spot (nothing painted over it).
  const hit = await p.count.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1);
    const r = rects[0];
    if (!r) return false;
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top !== null && el.contains(top);
  });
  expect(hit, `${what}: something covers the count`).toBe(true);
}

test.describe('card stepper geometry', () => {
  test.skip(({ isMobile }) => isMobile, 'sets its own widths; the phone project would only repeat it');

  for (const width of WIDTHS)
    for (const qty of [1, 3, 99])
      test(`− / ${String(qty)} / + never overlap at ${String(width)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await seedStorage(page, { 'mechdost-cart': JSON.stringify([{ slug: CASTROL.slug, qty }]) });
        await page.goto('/shop?category=lubricants');
        const card = page.locator('main article').filter({ hasText: CASTROL.name });
        const p = parts(card, qty);
        await p.plus.scrollIntoViewIfNeeded();
        await expectInside(p.stepper, card, 'stepper inside the card');
        await expectCountClear(p, qty, 'at rest');

        // Targets: at least 44 × 44 (WCAG 2.2 asks 24; the project uses 44).
        for (const b of [p.minus, p.plus]) {
          const bb = await box(b);
          expect(bb.width).toBeGreaterThanOrEqual(44);
          expect(bb.height).toBeGreaterThanOrEqual(44);
        }
        if (qty === 99) await expect(p.plus).toBeDisabled();

        await p.plus.hover();
        await expectCountClear(p, qty, 'hovering +');
        await p.minus.hover();
        await expectCountClear(p, qty, 'hovering −');
        await p.minus.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab'); // keyboard focus: :focus-visible ring on −
        await expectCountClear(p, qty, 'focus on −');

        // Same height as "Add to cart" on the next card (no jump when the stepper replaces it).
        const add = page
          .locator('main article')
          .filter({ hasText: MOTUL })
          .getByRole('button', { name: 'Add to cart' });
        await expectAligned([p.stepper, add], 'height', 'stepper vs Add to cart height');
      });
});

test('the product page stepper has the count clear while hovering + (both projects)', async ({ page }) => {
  await seedStorage(page, { 'mechdost-cart': JSON.stringify([{ slug: CASTROL.slug, qty: 3 }]) });
  await page.goto(`/shop/${CASTROL.slug}`);
  const main = page.locator('main');
  const p = parts(main, 3);
  await p.plus.first().hover();
  await expectNoOverlap([p.minus.first(), p.count.first(), p.plus.first()], 'product page');
});
