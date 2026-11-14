/**
 * Compare control on product cards and the product page (redesign 2026-11-14; user: "that ui is really really
 * buggy and needs a thorough improvement and major one"). Written before the fix, against these bugs:
 *  1. with a Lubricants product in the tray, every card of another category showed red "You can compare one
 *     category at a time." + "Start a new comparison" inside the card; the action row overflowed and "Add to cart"
 *     hung outside the card's right edge;
 *  2. "Start a new comparison" cleared the message only on the card pressed: the state lived in each card.
 * Now: no message inside cards; another category asks once, in the tray ("Start new" / "Keep current"), and every
 * card follows one shared list. Geometry is measured at 390 / 768 / 1280 / 1920 (state-dependent layout, T68).
 * Overnight run: `pnpm --filter @mechdost/web exec playwright test e2e/compare-ui.spec.ts --workers=1`.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  expectChildrenInside,
  expectEqualHeightsPerRow,
  expectInside,
  seedStorage,
} from './helpers/geometry';

const CASTROL = { slug: 'castrol-activ-4t-20w40-900ml', name: 'Castrol Activ 4T 20W40 900 ml' };
const MOTUL = { slug: 'motul-3100-4t-10w30-1l', name: 'Motul 3100 4T 10W30 1 L' };
const SHELL = { slug: 'shell-advance-ax7-10w30-1l' };
const HP = { slug: 'hp-racer4-20w40-900ml', name: 'HP Racer4 20W40 900 ml' };
const EXIDE = { slug: 'exide-xltz4a-2w-battery', name: 'Exide XLTZ4A 24F+24P' };
const WIDTHS = [390, 768, 1280, 1920] as const;
const STALE = /You can compare one category at a time|Start a new comparison$/;

const compareList = (category: string, slugs: readonly string[]) =>
  JSON.stringify({
    category,
    slugs,
    name: category === 'lubricants' ? 'Lubricants' : 'Batteries',
    lang: 'en',
  });

function toggle(page: Page, name: string) {
  return page.getByRole('button', { name: `Compare ${name}`, exact: true });
}
const tray = (page: Page) => page.getByRole('complementary', { name: 'Products to compare' });
const confirmation = (page: Page) => page.getByRole('dialog', { name: /Start a new comparison with/ });

/** Clicks like a person: the control centred on screen, never under the tab bar or the tray. */
async function tap(target: Locator) {
  await target.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
  });
  await target.click();
}

/** Every visible button and link of every card lies inside its card; cards in a row are equally tall. */
async function expectCardsIntact(page: Page, what: string) {
  const cards = page.locator('main article');
  await expect(cards.first()).toBeVisible();
  await expectChildrenInside(cards, 'button, a', what);
  await expectEqualHeightsPerRow(cards, what);
}

test.describe('cards with another category in the tray', () => {
  test.skip(({ isMobile }) => isMobile, 'sets its own widths; the phone project would only repeat it');

  for (const width of WIDTHS)
    test(`no inline message and nothing outside its card at ${String(width)} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedStorage(page, { 'mechdost-compare': compareList('lubricants', [CASTROL.slug]) });
      await page.goto('/shop');
      await expect(tray(page).getByRole('link', { name: 'Compare (1)' })).toBeVisible();
      // Press Compare on a battery: the old card filled with red text and pushed "Add to cart" out of the card.
      await tap(toggle(page, EXIDE.name));
      await expect(page.locator('main article').getByText(STALE)).toHaveCount(0);
      await expectCardsIntact(page, `width ${String(width)}`);
      const exide = page.locator('main article').filter({ hasText: EXIDE.name });
      await expectInside(exide.getByRole('button', { name: 'Add to cart' }), exide, 'Exide add to cart');
    });

  for (const width of WIDTHS)
    test(`cards stay intact with a product in the cart and a full list at ${String(width)} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedStorage(page, {
        'mechdost-compare': compareList('lubricants', [CASTROL.slug, MOTUL.slug, SHELL.slug, HP.slug]),
        'mechdost-cart': JSON.stringify([
          { slug: EXIDE.slug, qty: 3 },
          { slug: CASTROL.slug, qty: 12 },
        ]),
      });
      await page.goto('/shop');
      await expect(tray(page).getByRole('link', { name: 'Compare (4)' })).toBeVisible();
      await expectCardsIntact(page, `cart + full list, width ${String(width)}`);
    });
});

test('another category asks once in the tray; "Start new" updates every card', async ({ page }) => {
  await seedStorage(page, { 'mechdost-compare': compareList('lubricants', [CASTROL.slug]) });
  await page.goto('/shop');
  await expect(toggle(page, CASTROL.name)).toHaveAttribute('aria-pressed', 'true');
  await expect(tray(page)).toContainText('Lubricants');

  await tap(toggle(page, EXIDE.name));
  const ask = confirmation(page);
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('Start a new comparison with Batteries?');
  await expect(ask).toContainText('This removes 1 Lubricants item.');
  // Focus moves to the question (keyboard and screen readers), inside the tray, not a modal.
  await expect(ask).toBeFocused();
  await expect(tray(page).getByRole('dialog')).toHaveCount(1);
  await expect(page.locator('main article').getByText(STALE)).toHaveCount(0);

  await ask.getByRole('button', { name: 'Start new' }).click();
  await expect(ask).toBeHidden();
  // One shared list: every card follows at once.
  await expect(toggle(page, EXIDE.name)).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page, CASTROL.name)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('main [aria-pressed="true"]')).toHaveCount(1);
  await expect(tray(page).getByRole('link', { name: 'Compare (1)' })).toBeVisible();
  await expect(tray(page)).toContainText('Batteries');
  // Focus returns to the control that asked.
  await expect(toggle(page, EXIDE.name)).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Added to compare (1 of 4)' })).toHaveCount(1);
  const stored = await page.evaluate(() => window.localStorage.getItem('mechdost-compare'));
  expect(JSON.parse(stored ?? '{}')).toMatchObject({ category: 'batteries', slugs: [EXIDE.slug] });
});

test('"Keep current" and Escape leave everything as it was', async ({ page }) => {
  await seedStorage(page, { 'mechdost-compare': compareList('lubricants', [CASTROL.slug, MOTUL.slug]) });
  await page.goto('/shop');
  await tap(toggle(page, EXIDE.name));
  await expect(confirmation(page)).toContainText('This removes 2 Lubricants items.');
  await confirmation(page).getByRole('button', { name: 'Keep current' }).click();
  await expect(confirmation(page)).toBeHidden();
  await expect(toggle(page, EXIDE.name)).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle(page, EXIDE.name)).toBeFocused();
  await expect(toggle(page, CASTROL.name)).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page, MOTUL.name)).toHaveAttribute('aria-pressed', 'true');
  await expect(tray(page).getByRole('link', { name: 'Compare (2)' })).toBeVisible();

  await page.keyboard.press('Enter'); // the focused Exide toggle asks again
  await expect(confirmation(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation(page)).toBeHidden();
  await expect(tray(page).getByRole('link', { name: 'Compare (2)' })).toBeVisible();
});

test('a fifth product is explained in the tray, not inside the card', async ({ page }) => {
  await seedStorage(page, {
    'mechdost-compare': compareList('lubricants', [CASTROL.slug, MOTUL.slug, SHELL.slug, HP.slug]),
  });
  await page.goto('/shop?category=lubricants');
  const fifth = page
    .locator('main article')
    .filter({ has: page.locator('[aria-pressed="false"]') })
    .first();
  await tap(fifth.getByRole('button', { name: /^Compare / }));
  await expect(tray(page)).toContainText('You can compare up to 4 products. Remove one first.');
  await expect(fifth.getByText(/You can compare up to 4/)).toHaveCount(0);
  await expectCardsIntact(page, 'full list');
});

test('Clear resets every card', async ({ page }) => {
  await seedStorage(page, { 'mechdost-compare': compareList('lubricants', [CASTROL.slug, HP.slug]) });
  await page.goto('/shop?category=lubricants');
  await expect(page.locator('main [aria-pressed="true"]')).toHaveCount(2);
  await tray(page).getByRole('button', { name: 'Clear' }).click();
  await expect(tray(page)).toBeHidden();
  await expect(page.locator('main [aria-pressed="true"]')).toHaveCount(0);
  // Start again from a battery: no question, the list was empty.
  await page.goto('/shop');
  await tap(toggle(page, EXIDE.name));
  await expect(confirmation(page)).toHaveCount(0);
  await expect(toggle(page, EXIDE.name)).toHaveAttribute('aria-pressed', 'true');
});

test('the product page asks the same way', async ({ page }) => {
  await seedStorage(page, { 'mechdost-compare': compareList('lubricants', [CASTROL.slug]) });
  await page.goto(`/shop/${EXIDE.slug}`);
  await tap(toggle(page, EXIDE.name));
  await expect(confirmation(page)).toBeVisible();
  await expect(page.locator('main').getByText(STALE)).toHaveCount(0);
  await confirmation(page).getByRole('button', { name: 'Start new' }).click();
  await expect(toggle(page, EXIDE.name)).toHaveAttribute('aria-pressed', 'true');
  await expect(tray(page).getByRole('link', { name: 'Compare (1)' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const)
  test(`axe passes on /shop with the tray and its question open (${theme})`, async ({ page }) => {
    await seedStorage(page, {
      'mechdost-compare': compareList('lubricants', [CASTROL.slug]),
      'mechdost-theme': theme,
    });
    await page.goto('/shop');
    await expect(tray(page)).toBeVisible();
    await tap(toggle(page, EXIDE.name));
    await expect(confirmation(page)).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });

test('the question is in Hindi on /hi', async ({ page }) => {
  await seedStorage(page, {
    'mechdost-compare': JSON.stringify({
      category: 'lubricants',
      slugs: [CASTROL.slug],
      name: 'लुब्रिकेंट',
      lang: 'hi',
    }),
  });
  await page.goto('/hi/shop');
  await tap(page.getByRole('button', { name: `${EXIDE.name} की तुलना करें`, exact: true }));
  const ask = page.getByRole('dialog');
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('बैटरी');
  await expect(ask).toContainText('लुब्रिकेंट');
  // Only digits may be Latin in the question and its buttons.
  expect(await ask.innerText()).not.toMatch(/[A-Za-z]/);
});
