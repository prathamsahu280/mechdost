/**
 * Visual review capture (user 2026-11-16: "the actual screenshot viewing test for u"): a full-page screenshot of
 * every page for every role at 390 and 1440 px, light and dark, English and Hindi, saved for a person (or the
 * coordinator) to look at — the audit checks rules, this is for the eye. Opt-in: runs only with `VISUAL_SHOTS=<dir>`
 * (manual GitHub workflow `visual-review.yml`, sharded); no assertions beyond "the page loaded".
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { busyWorld, CODES } from './fixtures/demo-world';
import { ACCOUNT_SECTIONS, ADMIN_SECTIONS } from '../src/lib/sections';

const SHOTS = process.env.VISUAL_SHOTS ?? '';
const DEMO_PASSWORD = 'Raipur@2026';
const CONSENT = JSON.stringify({ analytics: false, version: '2026-11-14', at: '2026-11-01T00:00:00.000Z' });
const CASTROL = 'castrol-activ-4t-20w40-900ml';
const MOTUL = 'motul-3100-4t-10w30-1l';

const GUEST_PAGES = [
  '/',
  '/shop',
  '/shop?category=lubricants',
  `/shop/${CASTROL}`,
  `/compare?p=${CASTROL},${MOTUL}`,
  '/cart',
  '/checkout',
  '/offers',
  '/workshops',
  '/workshops/telibandha-car-clinic',
  '/partners',
  '/partners/apply/seller',
  '/support',
  '/support/guest',
  '/quotes/new',
  '/policies/returns',
  '/policies/privacy',
  '/policies/company',
  '/terms',
  '/login',
  '/no-such-page',
];

const CUSTOMER_PAGES = [
  '/account',
  ...ACCOUNT_SECTIONS.filter((s) => s !== 'overview').map((s) => `/account/${s}`),
  `/orders/${CODES.shipped}`,
  `/service/${CODES.proposed}`,
  `/service/${CODES.estimate}`,
  `/service/${CODES.billed}`,
  `/quotes/${CODES.quote}`,
  '/notifications',
];

const ROLES = [
  { role: 'guest', phone: '', pages: GUEST_PAGES },
  { role: 'customer', phone: '9876543210', pages: CUSTOMER_PAGES },
  { role: 'shop', phone: '9000000001', pages: ['/partner/shop'] },
  { role: 'workshop', phone: '9000000002', pages: ['/partner/workshop'] },
  {
    role: 'admin',
    phone: '9000000003',
    pages: ['/admin', ...ADMIN_SECTIONS.filter((s) => s !== 'overview').map((s) => `/admin/${s}`)],
  },
] as const;

const localised = (path: string, locale: 'en' | 'hi') =>
  locale === 'en' ? path : path === '/' ? '/hi' : `/hi${path}`;
const fileName = (path: string) => path.replace(/^\//, '').replace(/[/?=,&]+/g, '_') || 'home';

async function seed(page: Page, theme: 'light' | 'dark') {
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await page.addInitScript(
    (s: { theme: string; consent: string; extra: Record<string, unknown> }) => {
      window.localStorage.setItem('mechdost-theme', s.theme);
      if (window.localStorage.getItem('mechdost-visual-seeded') === '1') return;
      window.localStorage.setItem('mechdost-visual-seeded', '1');
      window.localStorage.setItem('mechdost-consent', s.consent);
      for (const [k, v] of Object.entries(s.extra)) window.localStorage.setItem(k, JSON.stringify(v));
    },
    { theme, consent: CONSENT, extra: busyWorld(Date.now()) },
  );
}

async function signIn(page: Page, phone: string, admin: boolean) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (admin) {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('visual review capture', () => {
  test.skip(!SHOTS, 'set VISUAL_SHOTS=<dir> to capture');
  test.skip(({ isMobile }) => isMobile, 'sets its own widths');
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const { role, phone, pages } of ROLES)
    for (const width of [390, 1440])
      for (const theme of ['light', 'dark'] as const)
        for (const locale of ['en', 'hi'] as const)
          test(`${role} · ${String(width)} · ${theme} · ${locale}`, async ({ page }) => {
            test.setTimeout(20 * 60_000);
            await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
            await seed(page, theme);
            if (phone) await signIn(page, phone, role === 'admin');
            const dir = join(SHOTS, role);
            mkdirSync(dir, { recursive: true });
            for (const path of pages) {
              await page.goto(localised(path, locale));
              await page.evaluate(() => document.fonts.ready);
              await page.waitForLoadState('networkidle').catch(() => undefined);
              await page.screenshot({
                path: join(dir, `${fileName(path)}__${String(width)}-${theme}-${locale}.png`),
                fullPage: true,
                animations: 'disabled',
              });
            }
          });
});
