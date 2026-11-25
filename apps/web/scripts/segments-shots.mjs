/**
 * Screenshots of the vehicle segments for the founder's review (design 2026-11-25): shop chips, card tags, home tiles
 * and the admin segment editor, 390 and 1440, light and dark, plus Hindi light 390. Demo build on port E2E_PORT
 * (default 3100); the privacy banner is already decided by the consent storage state.
 * Usage: node scripts/segments-shots.mjs <outDir>
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const out = process.argv[2];
if (!out) throw new Error('usage: node scripts/segments-shots.mjs <outDir>');
mkdirSync(out, { recursive: true });
const base = `http://localhost:${process.env.E2E_PORT ?? '3100'}`;

const runs = [
  { width: 390, height: 844, theme: 'light', locale: 'en' },
  { width: 390, height: 844, theme: 'dark', locale: 'en' },
  { width: 1440, height: 900, theme: 'light', locale: 'en' },
  { width: 1440, height: 900, theme: 'dark', locale: 'en' },
  { width: 390, height: 844, theme: 'light', locale: 'hi' },
];

const browser = await chromium.launch();
try {
  for (const r of runs) {
    const context = await browser.newContext({
      viewport: { width: r.width, height: r.height },
      deviceScaleFactor: 1,
    });
    // The privacy banner is closed with the "Essential only" choice (the same value e2e/fixtures/consent-decided.json holds).
    await context.addInitScript((theme) => {
      window.localStorage.setItem('mechdost-theme', theme);
      window.localStorage.setItem(
        'mechdost-consent',
        JSON.stringify({ analytics: false, version: '2026-11-14', at: '2026-11-01T00:00:00.000Z' }),
      );
    }, r.theme);
    const page = await context.newPage();
    const prefix = r.locale === 'hi' ? '/hi' : '';
    const tag = `${r.width}-${r.theme}-${r.locale}`;
    const shot = async (name, clip) => {
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(out, `${name}__${tag}.png`), ...(clip ?? {}) });
    };

    await page.goto(`${base}${prefix}/shop`, { waitUntil: 'networkidle' });
    await page.locator('[data-slot="segment-chips"]').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -140));
    await shot('1-shop-chips');

    await page.goto(`${base}${prefix}/shop?segment=truck_bus`, { waitUntil: 'networkidle' });
    await page.locator('[data-slot="segment-chips"]').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -140));
    await shot('2-shop-truck-selected');

    await page.goto(
      `${base}${prefix}/shop?segment=truck_bus,tractor_farm,construction_otr,light_commercial`,
      {
        waitUntil: 'networkidle',
      },
    );
    await page.locator('main article').first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    await shot('3-card-grid-tags');

    await page.goto(`${base}${prefix}/`, { waitUntil: 'networkidle' });
    await page.locator('section[aria-labelledby="vehicles-title"]').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -60));
    await shot('4-home-shop-by-vehicle');

    // The demo admin: staff sign-in, then the segment panel on the catalogue page.
    await page.goto(`${base}${prefix}/login`, { waitUntil: 'networkidle' });
    await page.getByRole('textbox').first().fill('9000000003');
    await page.locator('input[type="password"]').first().fill('Raipur@2026');
    await page.locator('form button[type="submit"]').first().click();
    await page
      .locator('input[autocomplete="one-time-code"], input[inputmode="numeric"]')
      .first()
      .fill('123456');
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 });
    await page.goto(`${base}${prefix}/admin/catalogue`, { waitUntil: 'networkidle' });
    await page.locator('button[aria-controls="seg-panel"]').click();
    await page.locator('#seg-panel').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -100));
    await shot('5-admin-segments');
    await context.close();
  }
} finally {
  await browser.close();
}
console.log('screenshots in', out);
