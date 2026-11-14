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
  box,
  expectChildrenInside,
  expectEqualHeightsPerRow,
  expectInside,
  overlaps,
  seedStorage,
} from './helpers/geometry';

const CASTROL = { slug: 'castrol-activ-4t-20w40-900ml', name: 'Castrol Activ 4T 20W40 900 ml' };
const MOTUL = { slug: 'motul-3100-4t-10w30-1l', name: 'Motul 3100 4T 10W30 1 L' };
const SHELL = { slug: 'shell-advance-ax7-10w30-1l' };
const HP = { slug: 'hp-racer4-20w40-900ml', name: 'HP Racer4 20W40 900 ml' };
const EXIDE = { slug: 'exide-xltz4a-2w-battery', name: 'Exide XLTZ4A 24F+24P' };
// 480 / 560 / 760: the narrowest two- and three-column cards (review 2026-11-14, I7).
const WIDTHS = [390, 480, 560, 760, 768, 1280, 1920] as const;
const STALE = /You can compare one category at a time|Start a new comparison$/;

const compareList = (category: string, slugs: readonly string[]) =>
  JSON.stringify({
    category,
    slugs,
    name: category === 'lubricants' ? 'Lubricants' : 'Batteries',
    lang: 'en',
  });

/** "☐ Compare" (user ruling 2026-11-15: a checkbox under the price, separate from "Add to cart"). */
function toggle(page: Page, name: string) {
  return page.getByRole('checkbox', { name: `Compare ${name}`, exact: true });
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
  await expect(toggle(page, CASTROL.name)).toBeChecked();
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
  await expect(toggle(page, EXIDE.name)).toBeChecked();
  await expect(toggle(page, CASTROL.name)).not.toBeChecked();
  await expect(page.locator('main input[type="checkbox"]:checked')).toHaveCount(1);
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
  await expect(toggle(page, EXIDE.name)).not.toBeChecked();
  await expect(toggle(page, EXIDE.name)).toBeFocused();
  await expect(toggle(page, CASTROL.name)).toBeChecked();
  await expect(toggle(page, MOTUL.name)).toBeChecked();
  await expect(tray(page).getByRole('link', { name: 'Compare (2)' })).toBeVisible();

  await page.keyboard.press('Space'); // the focused Exide checkbox asks again
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
    .filter({ has: page.locator('input[type="checkbox"]:not(:checked)') })
    .first();
  await tap(fifth.getByRole('checkbox', { name: /^Compare / }));
  await expect(tray(page)).toContainText('You can compare up to 4 products. Remove one first.');
  await expect(fifth.getByText(/You can compare up to 4/)).toHaveCount(0);
  await expectCardsIntact(page, 'full list');
});

test('Clear resets every card, closes an open question and keeps focus on the page', async ({ page }) => {
  await seedStorage(page, { 'mechdost-compare': compareList('lubricants', [CASTROL.slug, HP.slug]) });
  await page.goto('/shop');
  await expect(page.locator('main input[type="checkbox"]:checked')).toHaveCount(2);
  // A stale state to clear: the question about a battery is open while the oils are picked.
  await tap(toggle(page, EXIDE.name));
  await expect(confirmation(page)).toBeVisible();
  await tray(page).getByRole('button', { name: 'Clear' }).focus();
  await page.keyboard.press('Enter');
  await expect(tray(page)).toBeHidden();
  await expect(confirmation(page)).toHaveCount(0);
  await expect(page.locator('main input[type="checkbox"]:checked')).toHaveCount(0);
  // The tray left with focus inside it: focus lands on the first compare control, not the top of the page.
  await expect(page.locator('main [data-compare-toggle]').first()).toBeFocused();
  // Start again from a battery: no question, the list was empty.
  await page.goto('/shop');
  await tap(toggle(page, EXIDE.name));
  await expect(confirmation(page)).toHaveCount(0);
  await expect(toggle(page, EXIDE.name)).toBeChecked();
});

test('the product page asks the same way', async ({ page }) => {
  await seedStorage(page, { 'mechdost-compare': compareList('lubricants', [CASTROL.slug]) });
  await page.goto(`/shop/${EXIDE.slug}`);
  await tap(toggle(page, EXIDE.name));
  await expect(confirmation(page)).toBeVisible();
  await expect(page.locator('main').getByText(STALE)).toHaveCount(0);
  await confirmation(page).getByRole('button', { name: 'Start new' }).click();
  await expect(toggle(page, EXIDE.name)).toBeChecked();
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
  await tap(page.getByRole('checkbox', { name: `${EXIDE.name} की तुलना करें`, exact: true }));
  const ask = page.getByRole('dialog');
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('बैटरी');
  await expect(ask).toContainText('लुब्रिकेंट');
  // Only digits may be Latin in the question and its buttons.
  expect(await ask.innerText()).not.toMatch(/[A-Za-z]/);
});

/* ---- Review 2026-11-14 (I1–I7): fixed-position cases, navigation, focus, tooltip, Hindi geometry ---- */

const launcher = (page: Page) => page.locator('button.assistant-launcher');

test.describe('the tray never sits under the assistant button', () => {
  test.skip(({ isMobile }) => isMobile, 'sets its own widths; the phone project would only repeat it');
  for (const width of [360, 390])
    for (const locale of ['en', 'hi'] as const)
      test(`full list with its category at ${String(width)} px (${locale})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await seedStorage(page, {
          'mechdost-compare': JSON.stringify({
            category: 'lubricants',
            slugs: [CASTROL.slug, MOTUL.slug, SHELL.slug, HP.slug],
            name: locale === 'hi' ? 'लुब्रिकेंट' : 'Lubricants',
            lang: locale,
          }),
        });
        await page.goto(locale === 'hi' ? '/hi/shop' : '/shop');
        const bar = tray(page).locator('[data-slot="compare-bar"]');
        await expect(bar).toBeVisible();
        await expect(launcher(page)).toBeVisible();
        expect(overlaps(await box(bar), await box(launcher(page)))).toBe(false);
        // While a question is open the assistant button steps aside (one floating thing at a time).
        await tap(page.locator(`[data-compare-toggle="${EXIDE.slug}"]`));
        await expect(tray(page).getByRole('dialog')).toBeVisible();
        await expect(launcher(page)).toBeHidden();
      });
});

test('a question does not survive leaving the page', async ({ page }) => {
  await seedStorage(page, { 'mechdost-compare': compareList('lubricants', [CASTROL.slug]) });
  await page.goto('/shop');
  await tap(toggle(page, EXIDE.name));
  await expect(confirmation(page)).toBeVisible();
  // Client-side navigation (the tray stays mounted in the layout).
  await page.locator('main a[data-track^="product_"]').first().click();
  await expect(page).toHaveURL(/\/shop\/[a-z0-9-]+$/);
  await expect(confirmation(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toBeFocused();
  await page.goBack();
  await expect(confirmation(page)).toHaveCount(0);
});

test('Tab can leave the question; Escape anywhere keeps the list and returns focus', async ({ page }) => {
  await seedStorage(page, { 'mechdost-compare': compareList('lubricants', [CASTROL.slug]) });
  await page.goto('/shop');
  await tap(toggle(page, EXIDE.name));
  const ask = confirmation(page);
  await expect(ask).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(ask.getByRole('button', { name: 'Start new' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(ask.getByRole('button', { name: 'Keep current' })).toBeFocused();
  await page.keyboard.press('Tab');
  // Out of the question (no trap): focus is on the page or the tray bar, the question stays open.
  await expect(ask).toBeVisible();
  expect(await ask.evaluate((el) => el.contains(document.activeElement))).toBe(false);
  await page.keyboard.press('Escape');
  await expect(ask).toBeHidden();
  await expect(toggle(page, EXIDE.name)).toBeFocused();
  await expect(toggle(page, CASTROL.name)).toBeChecked();
});

test('a refused save is told in the tray, even with an empty list', async ({ page }) => {
  await page.addInitScript(() => {
    const proto = Storage.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'setItem')?.value as (
      this: Storage,
      k: string,
      v: string,
    ) => void;
    Object.defineProperty(proto, 'setItem', {
      value(this: Storage, k: string, v: string) {
        if (k === 'mechdost-compare') throw new DOMException('full', 'QuotaExceededError');
        original.call(this, k, v);
      },
    });
  });
  await page.goto('/shop');
  const card = page.locator('main article').filter({ hasText: EXIDE.name });
  const before = await box(card);
  await tap(toggle(page, EXIDE.name));
  const notice = tray(page).locator('[data-slot="compare-notice"]');
  await expect(notice).toContainText('Not added');
  await expect(toggle(page, EXIDE.name)).not.toBeChecked();
  expect((await box(card)).height).toBeCloseTo(before.height, 0);
  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(notice).toHaveCount(0);
});

test.describe('privacy banner open (a fresh visitor)', () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  test('the question floats above the banner', async ({ page }) => {
    await page.addInitScript(
      (list: string) => {
        if (!window.localStorage.getItem('mechdost-compare'))
          window.localStorage.setItem('mechdost-compare', list);
      },
      compareList('lubricants', [CASTROL.slug]),
    );
    await page.goto('/shop');
    const banner = page.getByTestId('consent-banner');
    await expect(banner).toBeVisible();
    await expect(tray(page)).toBeHidden(); // nothing asked yet: the tray steps aside for the banner
    await tap(page.locator(`[data-compare-toggle="${EXIDE.slug}"]`));
    const ask = tray(page).getByRole('dialog');
    await expect(ask).toBeVisible();
    const [t, b] = [await box(tray(page)), await box(banner)];
    expect(t.y + t.height, 'tray bottom above the banner top').toBeLessThanOrEqual(b.y + 0.5);
  });
});

/**
 * "☐ Compare" (user ruling 2026-11-15, "Checkbox style"): a real checkbox with its word, on its own line under the
 * price; the action row holds only "Add to cart" or the stepper, at full width, at every card width.
 */
test.describe('compare checkbox on cards', () => {
  test.skip(({ isMobile }) => isMobile, 'sets its own widths; the phone project would only repeat it');
  for (const width of [360, 390, 480, 560, 760, 1024, 1280, 1920])
    test(`checkbox inside the card, clear of the price and the action row at ${String(width)} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedStorage(page, {
        'mechdost-compare': compareList('lubricants', [CASTROL.slug]),
        'mechdost-cart': JSON.stringify([{ slug: CASTROL.slug, qty: 3 }]),
      });
      await page.goto('/shop');
      const cards = page.locator('main article');
      await expect(cards.first()).toBeVisible();
      const n = await cards.count();
      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        const label = card.locator('[data-slot="compare-toggle"]');
        const row = card.locator('[data-slot="card-actions"]');
        if ((await label.count()) === 0 || (await row.count()) === 0) continue;
        await expectInside(label, card, `card ${String(i)}: checkbox inside`);
        await expectInside(row, card, `card ${String(i)}: action row inside`);
        const price = card.locator('span.font-heading').first();
        expect(overlaps(await box(label), await box(row)), `card ${String(i)}: checkbox vs action row`).toBe(
          false,
        );
        if ((await price.count()) > 0)
          expect(overlaps(await box(label), await box(price)), `card ${String(i)}: checkbox vs price`).toBe(
            false,
          );
        // The label is the target: at least 44 px tall.
        expect((await box(label)).height).toBeGreaterThanOrEqual(44);
        // The action row holds only "Add to cart" or the stepper, as wide as the row.
        const action = row.locator('[data-slot="add-to-cart"], [data-slot="cart-stepper"]');
        await expect(action).toHaveCount(1);
        const [a, r] = [await box(action), await box(row)];
        expect(Math.abs(a.width - r.width), `card ${String(i)}: action fills the row`).toBeLessThanOrEqual(1);
      }
      await expectCardsIntact(page, `checkbox @${String(width)}`);
    });

  for (const theme of ['light', 'dark'] as const)
    test(`Space toggles it; the focus ring shows; the box is in the brand colour (${theme})`, async ({
      page,
    }) => {
      await seedStorage(page, { 'mechdost-theme': theme });
      await page.goto('/shop?category=lubricants');
      const box1 = toggle(page, CASTROL.name);
      await box1.scrollIntoViewIfNeeded();
      await box1.focus();
      await page.keyboard.press('Space');
      await expect(box1).toBeChecked();
      await expect(tray(page).getByRole('link', { name: 'Compare (1)' })).toBeVisible();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const look = await box1.evaluate((el) => {
        const s = getComputedStyle(el);
        return { outline: s.outlineStyle, width: parseFloat(s.outlineWidth), accent: s.accentColor };
      });
      expect(look.outline !== 'none' && look.width >= 2, 'visible focus ring').toBe(true);
      expect(look.accent, 'accent-color set').not.toBe('auto');
      // Clicking the word (the label) toggles it too.
      await page
        .locator('main article')
        .filter({ hasText: CASTROL.name })
        .getByText('Compare', { exact: true })
        .click();
      await expect(box1).not.toBeChecked();
    });
});

test.describe('Hindi cards with another category in the tray', () => {
  test.skip(({ isMobile }) => isMobile, 'sets its own widths; the phone project would only repeat it');
  for (const width of [390, 560, 1280, 1920])
    test(`nothing outside its card in Hindi at ${String(width)} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedStorage(page, {
        'mechdost-compare': JSON.stringify({
          category: 'lubricants',
          slugs: [CASTROL.slug],
          name: 'लुब्रिकेंट',
          lang: 'hi',
        }),
        'mechdost-cart': JSON.stringify([{ slug: EXIDE.slug, qty: 3 }]),
      });
      await page.goto('/hi/shop');
      await tap(page.locator(`[data-compare-toggle="${EXIDE.slug}"]`));
      await expect(tray(page).getByRole('dialog')).toBeVisible();
      await expectCardsIntact(page, `hi @${String(width)}`);
    });
});
