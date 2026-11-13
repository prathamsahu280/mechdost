import AxeBuilder from '@axe-core/playwright';
import { CONSENT_DECIDED } from './fixtures/consent';
import { expect, test, type Page } from '@playwright/test';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Scan in the final visual state: scroll-reveal fades are disabled under reduced motion. */
async function axe(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.describe('shop → cart → checkout → tracking', () => {
  test('a customer can buy a product and follow the order', async ({ page }) => {
    await page.goto('/shop?category=batteries');
    await expect(page.getByRole('status').filter({ hasText: 'products' })).toBeVisible();
    await page.getByRole('link', { name: 'XLTZ4A 24F+24P' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'XLTZ4A 24F+24P' })).toBeVisible();

    await page.getByRole('button', { name: 'Add to cart' }).first().click();
    await expect(page.getByRole('button', { name: 'Added to cart' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Cart\s*,\s*1 item/ })).toBeVisible();

    await page.goto('/cart');
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.getByRole('link', { name: /Cart\s*,\s*2 items/ })).toBeVisible();
    await expect(page.getByText('₹2,000').first()).toBeVisible();
    await page.getByRole('link', { name: 'Proceed to checkout' }).click();

    // Validation: errors appear next to fields and focus moves to the first one.
    await page.getByRole('button', { name: /Place order/ }).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await expect(page.getByLabel('Full name')).toBeFocused();

    await page.getByLabel('Full name').fill('Ravi Sahu');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByLabel('Delivery address').fill('C-605 Salasar Greens, Sarona, Raipur');
    await page.getByLabel('PIN code').fill('110001');
    await page.getByLabel(/I agree to share/).check();
    await page.getByRole('button', { name: /Place order/ }).click();
    await expect(page.getByText(/do not deliver to this PIN yet/)).toBeVisible();

    await page.getByLabel('PIN code').fill('492099');
    await page.getByRole('button', { name: /Place order/ }).click();
    await expect(page).toHaveURL(/\/orders\/MD-RPR-\d{4}-[0-9A-Z]{6}\?new=1$/);
    await expect(page.getByText('Thank you! Your order is placed.')).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText('Confirming with a nearby shop');
    await expect(page.getByRole('link', { name: /Cart\s*,\s*no items/ })).toBeVisible();

    await page.getByText('Demo controls').click();
    await page.getByRole('button', { name: 'Simulate next update' }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText('Confirmed — will be shipped');

    await page.goto('/account');
    await expect(page.getByRole('link', { name: /MD-RPR-/ })).toBeVisible();
  });

  test('search and sort the catalogue from the URL', async ({ page }) => {
    await page.goto('/shop?q=tyre&sort=price_desc');
    const names = await page.getByRole('article').getByRole('heading').allTextContents();
    // Highest price first; "tyre" also matches the tyre pressure gauge (by design).
    expect(names[0]).toContain('Passenger car tyre');
    expect(names).toHaveLength(3);
  });
});

test.describe('workshops → booking → request status', () => {
  test('a customer finds a workshop near a PIN and requests an appointment', async ({ page }) => {
    await page.goto('/workshops');
    await page.getByLabel('PIN code').fill('492006');
    await expect(page.getByText('Sorted by distance from PIN 492006.')).toBeVisible();
    await page.getByLabel('Vehicle type').selectOption('4W');
    const first = page.getByRole('article').first();
    await expect(first).toContainText('Telibandha Car Clinic');
    await first.getByRole('link', { name: 'View services & book' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Telibandha Car Clinic' })).toBeVisible();
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Choose at least one service.')).toBeVisible();

    await page.getByLabel('Make and model').fill('Maruti Dzire');
    await page.getByLabel(/Periodic service/).check();
    await page.getByLabel(/AC inspection/).check();
    await expect(page.getByText(/Expected cost: ₹2,150 – ₹4,700/)).toBeVisible();
    await page.getByLabel('Your name').fill('Ravi Sahu');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByRole('button', { name: 'Send request' }).click();

    await expect(page).toHaveURL(/\/service\/SR-RPR-\d{4}-[0-9A-Z]{6}\?new=1$/);
    await expect(page.getByText('Request sent to Telibandha Car Clinic.')).toBeVisible();
    await page.getByText('Demo controls').click();
    await page.getByRole('button', { name: 'Simulate next update' }).click();
    await expect(page.getByText(/Proposed:/)).toBeVisible();
    await page.getByRole('button', { name: 'Accept proposal' }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText('Appointment confirmed');
  });
});

test.describe('demo shop filters follow the URL (review B13)', () => {
  test('the main Shop link clears a category picked on the page; Back brings it back', async ({ page }) => {
    await page.goto('/shop');
    const allCategories = page.getByRole('link', { name: /All categories/ });
    await expect(allCategories).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Batteries' }).first().click();
    await expect(page).toHaveURL(/category=batteries/);
    await expect(allCategories).not.toHaveAttribute('aria-current', 'page');
    const filtered = await page.locator('article').count();

    // The header link on desktop, the bottom tab bar on phones: whichever main link to the shop is visible.
    await page.locator('a[href="/shop"]').filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(allCategories).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => page.locator('article').count()).toBeGreaterThan(filtered);

    await page.goBack();
    await expect(page).toHaveURL(/category=batteries/);
    await expect.poll(() => page.locator('article').count()).toBe(filtered);
  });
});

test.describe('vehicle type filter (decision 2026-11-12: 2W, 3W and 4W first-class)', () => {
  test('filters the shop by vehicle type, keeps it in the URL, and clears it', async ({ page }) => {
    await page.goto('/shop');
    const vehicle = page.getByLabel('Vehicle type');
    await vehicle.selectOption('2W');
    await expect(page).toHaveURL(/vehicle=2W/);
    const cards = page.getByRole('article');
    await expect.poll(() => cards.count()).toBeGreaterThan(0);
    for (const text of await cards.allTextContents()) expect(text).toContain('2W');

    // No demo product is tagged for three-wheelers yet: an empty list with one next action.
    await vehicle.selectOption('3W');
    await expect(page).toHaveURL(/vehicle=3W/);
    await expect(cards).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(vehicle).toHaveValue('');

    await page.goto('/shop?vehicle=4W');
    await expect(vehicle).toHaveValue('4W');
  });
});

test.describe('workshop booking date (review B14)', () => {
  test("the date starts at the visitor's today in IST, not the day the page was built", async ({ page }) => {
    await page.clock.setFixedTime(new Date('2027-03-15T10:00:00+05:30'));
    await page.goto('/workshops/telibandha-car-clinic');
    const date = page.getByLabel('Preferred date');
    await expect(date).toHaveValue('2027-03-15');
    await expect(date).toHaveAttribute('min', '2027-03-15');
    await expect(date).toHaveAttribute('max', '2027-05-14');
  });
});

test.describe('bulk quote → negotiation → order (spec 19)', () => {
  test('a customer asks for a bulk price, chats with admin, accepts the offer and gets a normal order', async ({
    page,
  }) => {
    await page.goto('/shop/exide-xltz4a-2w-battery');
    await page.getByRole('link', { name: /Ask for a bulk price/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ask for a bulk price' })).toBeVisible();
    // Prefilled from the product page with the minimum bulk quantity.
    await expect(page.getByLabel('Product', { exact: true })).toHaveValue('exide-xltz4a-2w-battery');
    await expect(page.getByLabel('Quantity')).toHaveValue('10');

    // Below the minimum is refused with a field error.
    await page.getByLabel('Quantity').fill('4');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Add at least 10 units in total for a bulk price.')).toBeVisible();

    await page.getByLabel('Quantity').fill('40');
    await page.getByLabel('Full name').fill('Ravi Sahu');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByLabel('Delivery address').fill('House 12, Pandri, Raipur');
    await page.getByLabel('Delivery PIN code').fill('492001');
    await page.getByLabel(/Anything else/).fill('Need GST invoice');
    await page.getByRole('button', { name: 'Send request' }).click();

    await expect(page).toHaveURL(/\/quotes\/QT-RPR-\d{4}-[0-9A-Z]{6}\?new=1$/);
    await expect(page.getByText('Request sent')).toBeVisible();
    await expect(page.getByText('Waiting for MechDost')).toBeVisible();
    await expect(page.getByText('Need GST invoice')).toBeVisible();

    // Customer writes; admin (demo controls) replies and sends the final price.
    await page.getByLabel('Message').fill('Can you deliver by Friday?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Can you deliver by Friday?')).toBeVisible();
    await page.getByText('Demo controls').click();
    await page.getByRole('button', { name: 'Admin: reply' }).click();
    await expect(page.getByText(/we can do better than the list price/)).toBeVisible();
    await page.getByRole('button', { name: /Admin: send an offer/ }).click();
    const offer = page.getByRole('region', { name: /Final price · offer 1/ });
    await expect(offer).toBeVisible();
    await expect(offer.getByRole('definition').filter({ hasText: '₹36,800' })).toBeVisible(); // 40 × ₹920 (8% off ₹1,000), free delivery
    await expect(offer.getByText('You save ₹3,200')).toBeVisible();

    // A newer offer arrives while the customer reads: accepting the old one is refused.
    await page.getByRole('button', { name: /Admin: send an offer/ }).click();
    await page.getByRole('button', { name: 'Accept offer' }).click();
    await expect(page.getByText('A newer offer arrived.', { exact: false })).toBeVisible();
    await expect(page.getByRole('region', { name: /offer 2/ })).toBeVisible();

    await page.getByRole('button', { name: 'Accept offer' }).click();
    await expect(page.getByText('Order created')).toBeVisible();
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Message')).toHaveCount(0); // chat is read-only once closed
    await page.getByRole('link', { name: 'Track order' }).click();

    // The negotiated order follows the normal order workflow.
    await expect(page).toHaveURL(/\/orders\/MD-RPR-/);
    await expect(page.getByText('₹36,800').first()).toBeVisible();

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Bulk quotes' })).toBeVisible();
    await expect(page.getByText('Accepted')).toBeVisible();
  });

  test('admin offer prices: a stray "." is explained next to the field, never sent (review B4)', async ({
    page,
  }) => {
    await page.goto('/shop/exide-xltz4a-2w-battery');
    await page.getByRole('link', { name: /Ask for a bulk price/ }).click();
    await page.getByLabel('Quantity').fill('20');
    await page.getByLabel('Full name').fill('Ravi Sahu');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByLabel('Delivery address').fill('House 12, Pandri, Raipur');
    await page.getByLabel('Delivery PIN code').fill('492001');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page).toHaveURL(/\/quotes\/QT-RPR-/);

    await page.goto('/login?next=%2Fadmin%2Fquotes');
    await page.getByLabel('Mobile number or email').fill('9000000003');
    await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(page).toHaveURL(/\/admin\/quotes$/);

    const price = page.getByLabel(/Price per unit for/).first();
    await price.fill('.');
    await price.blur();
    await expect(page.getByText('Use digits only, up to 2 decimals, for example 1250.50.')).toBeVisible();
    await expect(price).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Fix the highlighted prices to see the total.')).toBeVisible();
    await page.getByRole('button', { name: 'Send offer' }).click();
    await expect(price).toBeFocused();
    await expect(page.getByText('Offer sent.')).toHaveCount(0);

    await price.fill('900');
    await expect(price).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Send offer' }).click();
    await expect(page.getByText('Offer sent.')).toBeVisible();
  });

  test('the cart hands its items to a bulk quote', async ({ page }) => {
    await page.goto('/shop/castrol-activ-4t-20w40-900ml');
    await page.getByRole('button', { name: 'Add to cart' }).first().click();
    await page.goto('/cart');
    await page.getByRole('link', { name: /Ask for a bulk price/ }).click();
    await expect(page.getByLabel('Product', { exact: true })).toHaveValue('castrol-activ-4t-20w40-900ml');
  });
});

test.describe('workshop map (spec 06)', () => {
  // Both tests open their own 1440px desktop context, so the mobile project would only repeat them. MapLibre
  // renders WebGL on the CPU in CI (2 workers on 2 cores), so the long interactive run gets triple time
  // (CI flake 2026-11-12/13: timeouts at different steps, never a wrong result).
  test.skip(({ isMobile }) => isMobile, 'desktop-only: the test creates its own desktop context');
  test.beforeEach(() => {
    test.slow();
  });

  test('is fully interactive: zoom, pins, popups, locate me, show all', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: CONSENT_DECIDED,
      viewport: { width: 1440, height: 900 },
      permissions: ['geolocation'],
      geolocation: { latitude: 21.238, longitude: 81.6337 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    // Reverse geocoding is mocked: tests never call OpenStreetMap.
    await page.route('**/api/geo/pincode**', (route) =>
      route.fulfill({ json: { pincode: null, area: null } }),
    );
    await page.goto('/workshops');
    const map = page.getByRole('region', { name: 'Map of workshops' });
    await map.scrollIntoViewIfNeeded();
    await expect(map.locator('.maplibregl-canvas')).toBeVisible();
    await expect(map.locator('.md-map-pin')).toHaveCount(8);

    const scale = map.locator('.maplibregl-ctrl-scale');
    await expect(scale).not.toHaveText('');
    const before = await scale.textContent();
    await map.getByRole('button', { name: 'Zoom in' }).click();
    await expect(scale).not.toHaveText(before ?? '');

    // A pin opens its popup and highlights the matching card in the list.
    await map.getByRole('button', { name: 'Telibandha Car Clinic' }).click();
    const popup = map.locator('.maplibregl-popup');
    await expect(popup.getByRole('link', { name: 'Telibandha Car Clinic' })).toBeVisible();
    await expect(popup.getByRole('link', { name: 'View & book' })).toHaveAttribute(
      'href',
      '/workshops/telibandha-car-clinic',
    );
    await expect(popup.getByRole('link', { name: 'Directions' })).toHaveAttribute(
      'href',
      /google\.com\/maps\/dir/,
    );
    await expect(page.locator('article button[aria-pressed="true"]')).toHaveCount(1);

    await map.getByRole('button', { name: 'Show all workshops' }).click();
    await expect(popup).toHaveCount(0);

    // "Locate me" on the map sorts the list by distance, like the finder's own button.
    await map.getByRole('button', { name: 'Show my location' }).click();
    await expect(page.getByText('Sorted by distance from you.')).toBeVisible();
    await expect(map.getByRole('img', { name: 'You are here' })).toBeVisible();
    await expect(map.getByRole('button', { name: 'Full-screen map' })).toBeVisible();

    // Hybrid view (decisions 2026-11-01/02): satellite imagery under roads and labels is the default; the
    // switch to the plain map is remembered.
    const satellite = map.getByRole('button', { name: 'Satellite' });
    await expect(satellite).toHaveAttribute('aria-pressed', 'true');
    await satellite.click();
    await expect(satellite).toHaveAttribute('aria-pressed', 'false');
    await expect(map.locator('.md-map-pin')).toHaveCount(8);
    expect(await page.evaluate(() => localStorage.getItem('mechdost-map-mode'))).toBe('map');
    await satellite.click();
    await expect(satellite).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
    await context.close();
  });

  test('locating after selecting a workshop centres on you and fills your PIN (bug 2026-11-02)', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: CONSENT_DECIDED,
      viewport: { width: 1440, height: 900 },
      permissions: ['geolocation'],
      // Salasar Greens, Sarona: right next to Sarona Car Care, where the old camera kept flying.
      geolocation: { latitude: 21.2085, longitude: 81.6725 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const asked: string[] = [];
    await page.route('**/api/geo/pincode**', (route) => {
      asked.push(new URL(route.request().url()).search);
      return route.fulfill({ json: { pincode: '492099', area: 'Sarona' } });
    });
    await page.goto('/workshops');
    const map = page.getByRole('region', { name: 'Map of workshops' });
    await expect(map.locator('.md-map-pin')).toHaveCount(8);

    // Select a far workshop first: this used to pin the camera to it.
    const pinBefore = await map.locator('.md-map-pin').first().elementHandle();
    const show = page
      .locator('article')
      .filter({ hasText: 'Telibandha Car Clinic' })
      .getByRole('button', { name: 'Show on map' });
    await show.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await show.click();
    await expect(map.locator('.maplibregl-popup')).toHaveCount(1);
    await expect(map.locator('.md-map-pin[aria-pressed="true"]')).toHaveCount(1);
    // "Show on map" restyles pins in place (no rebuild = no flash) and never jumps the page.
    expect(await pinBefore.evaluate((el) => el.isConnected)).toBe(true);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThan(200);

    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: 'Use my location' }).click();
      await expect(page.locator('#finder-pin')).toHaveValue('492099');
    }
    await expect(page.getByText('Sorted by distance from you · PIN 492099.')).toBeVisible();
    await expect(map.locator('.md-map-pin[aria-pressed="true"]')).toHaveCount(0);
    // "You are here" is inside the visible map, not off-screen behind a workshop.
    const you = await map.getByRole('img', { name: 'You are here' }).boundingBox();
    const box = await map.boundingBox();
    expect(you && box).toBeTruthy();
    if (you && box) {
      expect(you.x).toBeGreaterThan(box.x);
      expect(you.x).toBeLessThan(box.x + box.width);
      expect(you.y).toBeGreaterThan(box.y);
      expect(you.y).toBeLessThan(box.y + box.height);
    }
    // Coordinates go to our own server only, rounded by it before any lookup.
    expect(asked.length).toBeGreaterThan(0);
    // The action trail is kept on the device for bug reports.
    const log = await page.evaluate(() => localStorage.getItem('mechdost-demo-events') ?? '');
    expect(log).toContain('"show_on_map"');
    expect(log).toContain('"location_detected"');
    await context.close();
  });
});

test.describe('theme and assistant', () => {
  test('dark mode toggles, persists across pages and passes axe', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 400, 'toggle sits in the footer on very small screens');
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Dark mode' }).first();
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/workshops');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await axe(page)).toEqual([]);
    await page.goto('/shop');
    expect(await axe(page)).toEqual([]);
  });

  test('a saved light choice survives switching language both ways (bug 2026-11-13)', async ({ browser }) => {
    const context = await browser.newContext({ storageState: CONSENT_DECIDED, colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('mechdost-theme', 'light');
    });
    await page.reload();
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    // Client-side navigation to the other language rebuilds <html> (the root layout is per locale).
    await page.locator('a[hreflang="hi"]').first().click();
    await expect(page).toHaveURL(/\/hi$/);
    await expect(html).toHaveAttribute('lang', 'hi');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.locator('a[hreflang="en"]').first().click();
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(html).toHaveAttribute('data-theme', 'light');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('rgb(10, 20, 36)');
    await context.close();
  });

  test('the saved theme comes back if <html> loses it, and follows another tab', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('mechdost-theme', 'dark');
    });
    await page.reload();
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    // What React does to <html> on a client-side change of locale (redirect by the language cookie).
    await page.evaluate(() => {
      delete document.documentElement.dataset.theme;
    });
    await expect(html).toHaveAttribute('data-theme', 'dark');
    const other = await context.newPage();
    await other.goto('/shop');
    await other.evaluate(() => {
      localStorage.setItem('mechdost-theme', 'light');
    });
    await expect(html).toHaveAttribute('data-theme', 'light');
    await other.close();
  });

  test('Hindi → English works after a Hindi visit and keeps the filters (bugs 2026-11-13)', async ({
    page,
  }) => {
    // Opening a Hindi page directly stores the Hindi language cookie.
    await page.goto('/hi/shop?category=lubricants#top');
    await page.locator('a[hreflang="en"]').first().click();
    await expect(page).toHaveURL(/\/shop\?category=lubricants#top$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('a[hreflang="hi"]').first().click();
    await expect(page).toHaveURL(/\/hi\/shop\?category=lubricants#top$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  });

  test('follows the system dark preference without a saved choice', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: CONSENT_DECIDED,
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await page.goto('/');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(10, 20, 36)');
    await context.close();
  });

  test('the assistant answers a bulk-order question and closes with Escape', async ({ page }) => {
    await page.goto('/');
    const launcher = page.getByRole('button', { name: 'Ask MechDost' });
    await launcher.click();
    const panel = page.getByRole('dialog', { name: 'MechDost assistant' });
    await expect(panel).toBeVisible();
    await expect(page.getByLabel('Type your question')).toBeFocused();
    await page.getByLabel('Type your question').fill('I need 40 batteries, bulk price?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(panel.getByText(/negotiate the price directly/)).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Ask for a bulk price' })).toHaveAttribute(
      'href',
      '/quotes/new',
    );
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(launcher).toBeFocused();
  });
});

test.describe('accessibility of the demo flows', () => {
  for (const path of [
    '/shop/castrol-activ-4t-20w40-900ml',
    '/hi/shop/exide-xltz4a-2w-battery',
    '/workshops/shankar-nagar-auto-hub',
    '/hi/workshops',
    '/checkout',
    '/account',
    '/quotes/new?product=exide-xltz4a-2w-battery',
  ]) {
    test(`no WCAG 2.2 AA violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      expect(await axe(page)).toEqual([]);
    });
  }
});
