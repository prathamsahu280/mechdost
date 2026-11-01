import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Below 1024px the header uses the bottom tab bar instead of the full nav (tokens.css --breakpoint-nav). */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

test.describe('home', () => {
  test('renders the concept hero in English with hreflang alternates', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /Automotive essentials\.\s*Local vehicle care\./,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="hi"]')).toHaveAttribute('href', /\/hi$/);
    // Root canonical is the bare origin (Next drops the trailing slash).
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https?:\/\/[^/]+\/?$/);
  });

  test('renders Hindi at /hi with Devanagari copy', async ({ page }) => {
    await page.goto('/hi');
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('वाहन की ज़रूरी चीज़ें');
  });

  test('switches language on the same page and back', async ({ page }) => {
    await page.goto('/workshops');
    await page.getByRole('link', { name: 'हिंदी' }).click();
    await expect(page).toHaveURL(/\/hi\/workshops$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/workshops$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('hero search goes to the shop with the query', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Find your next essential').fill('battery');
    await page.getByRole('button', { name: 'Search products' }).click();
    await expect(page).toHaveURL(/\/shop\?q=battery$/);
    await expect(page.getByRole('status').filter({ hasText: 'You searched for' })).toContainText(
      'You searched for “battery”.',
    );
    await expect(page.getByRole('article').first()).toBeVisible();
  });
});

test.describe('navigation chrome', () => {
  test('shows the desktop nav or the mobile tab bar, never both', async ({ page }) => {
    await page.goto('/');
    const main = page.getByRole('navigation', { name: 'Main' });
    const tabs = page.getByRole('navigation', { name: 'Quick navigation' });
    if (isMobile(page)) {
      await expect(tabs).toBeVisible();
      await expect(main).toBeHidden();
    } else {
      await expect(main).toBeVisible();
      await expect(tabs).toBeHidden();
    }
  });

  test('marks the current section and works under the Hindi prefix', async ({ page }) => {
    await page.goto('/hi/shop');
    const nav = isMobile(page)
      ? page.getByRole('navigation', { name: 'त्वरित नेविगेशन' })
      : page.getByRole('navigation', { name: 'मुख्य' });
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('href', '/hi/shop');
  });

  test('highlights the section on statically pre-rendered detail pages (no /en hydration mismatch)', async ({
    page,
  }) => {
    await page.goto('/workshops/telibandha-car-clinic');
    const nav = isMobile(page)
      ? page.getByRole('navigation', { name: 'Quick navigation' })
      : page.getByRole('navigation', { name: 'Main' });
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('href', '/workshops');
    await expect(page.getByRole('link', { name: 'हिंदी' })).toHaveAttribute(
      'href',
      '/hi/workshops/telibandha-car-clinic',
    );
  });

  test('skip link is the first focusable element and moves focus to the content', async ({
    page,
    browserName,
  }) => {
    test.skip(isMobile(page) || browserName !== 'chromium', 'keyboard test on desktop');
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#content$/);
  });

  test('stays responsive from 320px to 1920px: no horizontal scroll, tap targets ≥ 24px', async ({
    page,
  }) => {
    test.skip(isMobile(page), 'the sweep sets its own viewports; run once');
    // 13 widths × 9 pages = 117 loads; 120 s ran out under full-suite load (2026-11-01). Same checks, more time.
    test.setTimeout(240_000);
    const widths = [320, 360, 390, 414, 600, 759, 760, 768, 1023, 1024, 1280, 1440, 1920];
    const paths = [
      '/',
      '/hi',
      '/shop',
      '/workshops',
      '/hi/workshops',
      '/partners',
      '/cart',
      '/account',
      '/login',
    ];
    const problems: string[] = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of paths) {
        await page.goto(path);
        const found = await page.evaluate(() => {
          const out: string[] = [];
          const overflow = document.documentElement.scrollWidth - window.innerWidth;
          if (overflow > 0) out.push(`overflow ${overflow}px`);
          for (const el of document.querySelectorAll<HTMLElement>('a, button, input')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)) {
              out.push(
                `small target "${el.textContent.trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
              );
            }
          }
          return out;
        });
        for (const f of found) problems.push(`${width}px ${path}: ${f}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('unknown pages return 404 with a way home', async ({ page }) => {
    const res = await page.goto('/does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Go to home/ })).toBeVisible();
  });
});

test.describe('quality gates', () => {
  for (const path of ['/', '/hi', '/shop', '/workshops', '/partners', '/cart', '/account', '/hi/partners']) {
    test(`no WCAG 2.2 AA violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      ).toEqual([]);
    });
  }

  test('sends security headers', async ({ page }) => {
    const res = await page.goto('/');
    const headers = res?.headers() ?? {};
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('serves the hero image in a modern format and preloads only it', async ({ page }) => {
    const imageTypes: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/_next/image')) imageTypes.push(r.headers()['content-type'] ?? '');
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(imageTypes.length).toBeGreaterThan(0);
    for (const type of imageTypes) expect(type).toMatch(/image\/(avif|webp)/);
    await expect(page.locator('link[rel="preload"][as="image"]')).toHaveCount(1);
  });

  test('tracks clicks through the first-party event queue', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const w = window as unknown as { __events: unknown[] };
      w.__events = [];
      window.addEventListener('mechdost:track', (e) => w.__events.push((e as CustomEvent).detail));
    });
    await page.getByRole('link', { name: 'Engine oil', exact: true }).first().click();
    await expect(page).toHaveURL(/\/shop\?q=engine\+oil$/);
    const events = await page.evaluate(
      () => (window as unknown as { __events: { event: string; props: { id?: string } }[] }).__events,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'click',
        props: expect.objectContaining({ id: 'hero_popular_oil' }),
      }),
    );
    expect(events.some((e) => e.event === 'page_view')).toBe(true);
  });
});
