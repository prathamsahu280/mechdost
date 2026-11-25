import { expect, test, type Locator, type Page } from '@playwright/test';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Vehicle segments (design 2026-11-25, spec 02): chips filter the shop and keep their state in the URL, cards carry a
 * tag, home tiles open the filtered shop, everything reads in Hindi, nothing makes the page scroll sideways, and the
 * demo admin's rename shows on the chips. Demo build.
 */
const TRUCK_TYRE = 'mrf-steel-muscle-1000r20-truck-tyre';
const TRACTOR_BATTERY = 'amaron-pro-tractor-88ah-battery';
const BIKE_OIL = 'castrol-activ-4t-20w40-900ml';
const PASSWORD = 'Raipur@2026';

const card = (page: Page, slug: string) => page.locator(`main article:has(a[href$="/shop/${slug}"])`).first();
const chip = (page: Page, name: RegExp) =>
  page.locator('[data-slot="segment-chips"]').getByRole('button', { name });

async function noSideScroll(page: Page) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
}

test.describe('shop chips', () => {
  test('choosing Truck & bus shows only those products; the URL keeps it across a reload', async ({
    page,
  }) => {
    await page.goto('/shop');
    await expect(card(page, BIKE_OIL)).toBeVisible();
    const truck = chip(page, /^Truck & bus \(\d+\)$/);
    await expect(truck).toHaveAttribute('aria-pressed', 'false');
    await truck.click();
    await expect(page).toHaveURL(/segment=truck_bus/);
    await expect(truck).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, TRUCK_TYRE)).toBeVisible();
    await expect(card(page, BIKE_OIL)).toHaveCount(0);
    await page.reload();
    await expect(chip(page, /^Truck & bus/)).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, TRUCK_TYRE)).toBeVisible();
    await expect(card(page, BIKE_OIL)).toHaveCount(0);
    await noSideScroll(page);
  });

  test('several chips at once, counts follow the search, "All vehicles" clears', async ({ page }) => {
    await page.goto('/shop');
    await chip(page, /^Truck & bus/).click();
    await chip(page, /^Tractor & farm/).click();
    await expect(page).toHaveURL(/segment=truck_bus%2Ctractor_farm|segment=truck_bus,tractor_farm/);
    await expect(card(page, TRACTOR_BATTERY)).toBeVisible();
    await expect(card(page, TRUCK_TYRE)).toBeVisible();
    // The Truck & bus count for a tyre search is smaller than for everything.
    await page.goto('/shop?q=tyre');
    await expect(chip(page, /^Truck & bus \(1\)$/)).toBeVisible();
    await page.goto('/shop?segment=truck_bus');
    await page.locator('[data-slot="segment-chips"]').getByRole('button', { name: 'All vehicles' }).click();
    await expect(page).not.toHaveURL(/segment=/);
    await expect(card(page, BIKE_OIL)).toBeVisible();
  });

  test('keyboard: Tab to a chip and press Space; the chip is a button with a pressed state', async ({
    page,
  }) => {
    await page.goto('/shop');
    const truck = chip(page, /^Truck & bus/);
    await truck.focus();
    await page.keyboard.press('Space');
    await expect(truck).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(truck).toHaveAttribute('aria-pressed', 'false');
  });

  test('chips are at least 44 px high', async ({ page }) => {
    await page.goto('/shop');
    const boxes = await page
      .locator('[data-slot="segment-chips"] button')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(boxes.length).toBeGreaterThan(3);
    for (const h of boxes) expect(h).toBeGreaterThanOrEqual(44);
  });
});

test.describe('card tag', () => {
  test('a truck tyre card carries the tag inside the card, clear of the other buttons', async ({ page }) => {
    await page.goto('/shop?segment=truck_bus');
    const c = card(page, TRUCK_TYRE);
    const tag = c.locator('[data-slot="card-segment"]');
    await expect(tag).toContainText('Truck & bus');
    const rect = async (l: Locator): Promise<Rect> => {
      const r = await l.boundingBox();
      if (!r) throw new Error('element has no box');
      return r;
    };
    const [t, box] = [await rect(tag), await rect(c)];
    expect(t.height).toBeGreaterThanOrEqual(18);
    expect(t.x).toBeGreaterThanOrEqual(box.x);
    expect(t.x + t.width).toBeLessThanOrEqual(box.x + box.width);
    for (const b of await c.locator('[data-slot="card-tools"] button, [data-slot="admin-edit"]').all()) {
      const r = await b.boundingBox();
      if (!r) continue; // not shown (nothing to overlap)
      const apart =
        t.x + t.width <= r.x || r.x + r.width <= t.x || t.y + t.height <= r.y || r.y + r.height <= t.y;
      expect(apart).toBe(true);
    }
  });
});

test.describe('home tiles', () => {
  test('Shop by vehicle tile opens the shop on that segment', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section[aria-labelledby="vehicles-title"]');
    await expect(
      section.getByRole('heading', { name: 'Parts for trucks, tractors and machines' }),
    ).toBeVisible();
    await expect(section.getByRole('link')).toHaveCount(4); // three tiles and "All vehicle types"
    await section.getByRole('link', { name: /Tractor & farm/ }).click();
    await expect(page).toHaveURL(/\/shop\?segment=tractor_farm/);
    await expect(card(page, TRACTOR_BATTERY)).toBeVisible();
    await expect(card(page, TRUCK_TYRE)).toHaveCount(0);
  });
});

test.describe('Hindi', () => {
  test('chips, tag and tiles read in Hindi', async ({ page }) => {
    await page.goto('/hi/shop?segment=truck_bus');
    await expect(chip(page, /^ट्रक और बस \(\d+\)$/)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-slot="segment-chips"]')).toContainText('सभी वाहन');
    await expect(card(page, TRUCK_TYRE).locator('[data-slot="card-segment"]')).toContainText('ट्रक और बस');
    await page.goto('/hi');
    const section = page.locator('section[aria-labelledby="vehicles-title"]');
    await expect(section).toContainText('वाहन के हिसाब से ख़रीदें');
    await expect(section).toContainText('ट्रैक्टर और खेती');
    await expect(section).toContainText('निर्माण और ओटीआर');
  });
});

test.describe('demo admin', () => {
  test('renaming a segment shows on the shop chips in this browser', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Mobile number or email').fill('9000000003');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('One-time code').fill('123456');
    await page.waitForURL((u) => !u.pathname.endsWith('/login'));
    await page.goto('/admin/catalogue');
    await page.getByRole('button', { name: 'Edit vehicle segments' }).click();
    const form = page.getByRole('form', { name: 'Truck & bus' });
    await form.getByLabel('Name (English)').fill('Trucks and buses');
    await form.getByRole('button', { name: /Save/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await page.goto('/shop');
    await expect(chip(page, /^Trucks and buses \(\d+\)$/)).toBeVisible();
  });
});
