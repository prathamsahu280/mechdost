/**
 * Screenshots of the notification inbox for review (spec 10, 2026-11-25): the bell open with a mix of priorities, the
 * centre page, the empty state and the Undo toast, at 390 and 1440 px, light and dark, English and Hindi. Real-mode
 * build with the audit's mocked API; the `/v1/me/notifications*` routes below are stateful, so Remove, "Clear all
 * read" and Undo really change the list. Opt-in: `NOTICE_SHOTS=<dir>`; config `playwright.notices-shots.config.ts`.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { apiHooks } from './api-mode/hooks.ts';
import type { AuditCase } from './cases.ts';
import { localised, seedFor, settle } from './harness.ts';
import { AUDIT_API_ORIGIN } from './api-mode/session.ts';

const OUT = process.env.NOTICE_SHOTS ?? '';
type Priority = 'urgent' | 'action' | 'info' | 'success';
interface Row {
  id: string;
  kind: string;
  priority: Priority;
  title: { en: string; hi: string };
  body: { en: string; hi: string };
  read: boolean;
  ageMin: number;
  link: string;
  dismissedAt: string | null;
}

const uid = (n: number) => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SEED: Omit<Row, 'id' | 'dismissedAt'>[] = [
  {
    kind: 'staff.shop_declined',
    priority: 'urgent',
    title: { en: 'A shop declined', hi: 'एक दुकान ने मना कर दिया' },
    body: {
      en: 'A shop declined MD-RPR-2026-4K7Q2M. Choose another shop or reject.',
      hi: 'एक दुकान ने MD-RPR-2026-4K7Q2M लेने से मना किया। दूसरी दुकान चुनें या ऑर्डर रद्द करें।',
    },
    read: false,
    ageMin: 3,
    link: '/admin/orders',
  },
  {
    kind: 'shop.offer_expiring',
    priority: 'urgent',
    title: { en: 'Offer about to expire', hi: 'ऑफ़र की समय-सीमा खत्म होने वाली है' },
    body: {
      en: 'Order MD-RPR-2026-9F2KQA expires in about 5 minutes.',
      hi: 'ऑर्डर MD-RPR-2026-9F2KQA की समय-सीमा लगभग 5 मिनट में खत्म होगी।',
    },
    read: false,
    ageMin: 12,
    link: '/partner/shop',
  },
  {
    kind: 'service.estimate_ready',
    priority: 'action',
    title: { en: 'Estimate ready', hi: 'अनुमान तैयार है' },
    body: {
      en: 'Review and approve the estimate for SR-RPR-2026-4M8T2B.',
      hi: 'SR-RPR-2026-4M8T2B का अनुमान देखें और मंज़ूर करें।',
    },
    read: false,
    ageMin: 30,
    link: '/service/SR-RPR-2026-4M8T2B',
  },
  {
    kind: 'ticket.reply',
    priority: 'action',
    title: {
      en: 'New reply from support',
      hi: 'सहायता टीम की ओर से नया जवाब, कृपया अपनी बैटरी की रसीद की फ़ोटो भेजकर इसे पूरा करें',
    },
    body: { en: 'There is a reply on REQ-RPR-2026-9F2KQA.', hi: 'REQ-RPR-2026-9F2KQA पर जवाब आया है।' },
    read: false,
    ageMin: 55,
    link: '/account/support',
  },
  {
    kind: 'order.out_for_delivery',
    priority: 'info',
    title: { en: 'Out for delivery', hi: 'डिलीवरी के लिए निकला' },
    body: {
      en: 'MD-RPR-2026-4K7Q2M is on its way. Keep your delivery code ready.',
      hi: 'MD-RPR-2026-4K7Q2M रास्ते में है। अपना डिलीवरी कोड तैयार रखें।',
    },
    read: false,
    ageMin: 90,
    link: '/orders/MD-RPR-2026-4K7Q2M',
  },
  {
    kind: 'order.delivered',
    priority: 'success',
    title: { en: 'Order delivered', hi: 'ऑर्डर पहुँच गया' },
    body: {
      en: 'MD-RPR-2026-1A2B3C was delivered. Tell us how it went.',
      hi: 'MD-RPR-2026-1A2B3C पहुँच गया। बताइए कैसा रहा।',
    },
    read: false,
    ageMin: 200,
    link: '/orders/MD-RPR-2026-1A2B3C',
  },
  {
    kind: 'refund.failed',
    priority: 'urgent',
    title: { en: 'Refund needs attention', hi: 'रिफ़ंड पर ध्यान चाहिए' },
    body: {
      en: 'We could not complete the refund for MD-RPR-2026-7H2K9P. Our team will help.',
      hi: 'MD-RPR-2026-7H2K9P का रिफ़ंड पूरा नहीं हो सका। हमारी टीम मदद करेगी।',
    },
    read: true,
    ageMin: 400,
    link: '/orders/MD-RPR-2026-7H2K9P',
  },
  {
    kind: 'service.bill_ready',
    priority: 'action',
    title: { en: 'Bill ready', hi: 'बिल तैयार है' },
    body: { en: 'The bill for SR-RPR-2026-3C4D5E is ready.', hi: 'SR-RPR-2026-3C4D5E का बिल तैयार है।' },
    read: true,
    ageMin: 700,
    link: '/service/SR-RPR-2026-3C4D5E',
  },
  {
    kind: 'refund.processed',
    priority: 'success',
    title: { en: 'Refund sent', hi: 'रिफ़ंड भेज दिया गया' },
    body: {
      en: 'Your refund for MD-RPR-2026-6F7G8H was sent to your original payment method.',
      hi: 'MD-RPR-2026-6F7G8H का रिफ़ंड आपके मूल भुगतान तरीके पर भेज दिया गया।',
    },
    read: true,
    ageMin: 1500,
    link: '/orders/MD-RPR-2026-6F7G8H',
  },
  {
    kind: 'order.placed',
    priority: 'info',
    title: { en: 'Order placed', hi: 'ऑर्डर दे दिया गया' },
    body: {
      en: 'MD-RPR-2026-4K7Q2M is placed. We are confirming it for you.',
      hi: 'MD-RPR-2026-4K7Q2M दे दिया गया है। हम इसे पक्का कर रहे हैं।',
    },
    read: true,
    ageMin: 2900,
    link: '/orders/MD-RPR-2026-4K7Q2M',
  },
];

const bucket = (r: Row) => (r.read ? 2 : r.priority === 'urgent' ? 0 : 1);

/** A stateful stand-in for `/v1/me/notifications*` (list in the server's order, read, remove, clear, restore). */
async function installNotices(page: Page, locale: 'en' | 'hi', empty: boolean) {
  const now = Date.now();
  const rows: Row[] = empty
    ? []
    : SEED.map((r, i) => ({ ...r, id: uid(i + 1), dismissedAt: null as string | null }));
  const unread = () => rows.filter((r) => !r.read && r.dismissedAt === null).length;
  const view = (r: Row) => ({
    id: r.id,
    kind: r.kind,
    category: 'transactional',
    priority: r.priority,
    title: r.title[locale],
    body: r.body[locale],
    link: r.link,
    read: r.read,
    resolved: false,
    createdAt: new Date(now - r.ageMin * 60_000).toISOString(),
  });
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
  await page.route(`${AUDIT_API_ORIGIN}/v1/me/notifications**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    const url = new URL(req.url());
    const path = url.pathname.replace('/v1/me/notifications', '');
    if (req.method() === 'GET' && (path === '' || path === '/')) {
      const limit = Number(url.searchParams.get('limit') ?? 10);
      const visible = rows
        .filter((r) => r.dismissedAt === null)
        .sort((a, b) => bucket(a) - bucket(b) || a.ageMin - b.ageMin);
      return route.fulfill(
        json({ notices: visible.slice(0, limit).map(view), nextCursor: null, unread: unread() }),
      );
    }
    if (req.method() === 'GET') return route.fulfill(json({ unread: unread() }));
    if (req.method() === 'POST' && path === '/read') {
      const body = req.postDataJSON() as { ids?: string[]; all?: true };
      let n = 0;
      for (const r of rows)
        if (!r.read && (body.all || body.ids?.includes(r.id))) {
          r.read = true;
          n += 1;
        }
      return route.fulfill(json({ updated: n, unread: unread() }));
    }
    if (req.method() === 'DELETE') {
      const id = path.slice(1);
      const r = rows.find((x) => x.id === id);
      if (!r) return route.fulfill(json({ error: 'not found' }, 404));
      r.read = true;
      r.dismissedAt = '2026-11-25 12:00:00+00';
      return route.fulfill(json({ dismissed: true, undoToken: r.dismissedAt, unread: unread() }));
    }
    if (req.method() === 'POST' && path === '/clear-read') {
      const gone = rows.filter((r) => r.read && r.dismissedAt === null);
      for (const r of gone) r.dismissedAt = '2026-11-25 12:00:01+00';
      return route.fulfill(
        json({
          cleared: gone.length,
          undoToken: gone.length ? '2026-11-25 12:00:01+00' : null,
          unread: unread(),
        }),
      );
    }
    if (req.method() === 'POST' && path === '/restore') {
      const { undoToken } = req.postDataJSON() as { undoToken: string };
      let n = 0;
      for (const r of rows)
        if (r.dismissedAt === undoToken) {
          r.dismissedAt = null;
          n += 1;
        }
      return route.fulfill(json({ restored: n, unread: unread() }));
    }
    return route.fulfill(json({ error: 'not found' }, 404));
  });
}

function customerCase(width: number, theme: 'light' | 'dark', locale: 'en' | 'hi'): AuditCase {
  return {
    id: 'NOTICE-SHOTS',
    code: 'NOTICE-SHOTS',
    page: 'shots',
    component: 'shots',
    strategy: 'cross',
    path: '/',
    scope: 'main',
    width,
    theme,
    locale,
    auth: 'customer',
    world: 'empty',
    state: {},
    checks: [],
    align: [],
    sweep: 0,
    mustShow: null,
    tier: 'full',
    realApi: true,
    nav: null,
  };
}

async function open(page: Page, c: AuditCase, empty: boolean) {
  const now = Date.now();
  await page.setViewportSize({ width: c.width, height: c.width < 768 ? 844 : 900 });
  await page.emulateMedia({ colorScheme: c.theme });
  await page.route(/^https?:\/\/(?!localhost[:/])(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  await apiHooks.install(page, c, now);
  await installNotices(page, c.locale, empty);
  await page.addInitScript(
    (seed: Record<string, string>) => {
      for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    },
    { ...seedFor(c, now), ...apiHooks.seed(c, now) },
  );
}

const bell = (page: Page) => page.locator('button[data-track="bell"]');

test.describe('notification inbox screenshots', () => {
  test.skip(!OUT, 'set NOTICE_SHOTS=<dir> to capture');
  for (const width of [390, 1440] as const)
    for (const theme of ['light', 'dark'] as const)
      for (const locale of ['en', 'hi'] as const) {
        const tail = `${String(width)}-${theme}-${locale}`;
        test(`shots · ${tail}`, async ({ page }) => {
          test.setTimeout(5 * 60_000);
          mkdirSync(OUT, { recursive: true });
          const c = customerCase(width, theme, locale);
          const snap = async (name: string, full = false) => {
            await settle(page);
            await page.screenshot({
              path: join(OUT, `${name}__${tail}.png`),
              fullPage: full,
              animations: 'disabled',
            });
          };
          // 1. the bell open
          await open(page, c, false);
          await page.goto(localised('/', locale));
          await settle(page);
          await bell(page).click();
          await page.waitForSelector('[data-notice-root] ul li');
          await snap('1-bell-open');
          // 2. the bell after removing one notice (toast with Undo)
          await page.locator('[data-notice-root] ul li button[aria-label]').first().click();
          await page.waitForSelector('button >> text=/Undo|वापस लाएँ/');
          await snap('4-undo-toast-remove');
          // 3. the full page
          await page.goto(localised('/notifications', locale));
          await settle(page);
          await page.waitForSelector('[data-notice-root] ul li');
          await snap('2-notices-page', true);
          // 4. clear all read, with the Undo toast
          await page
            .locator('[data-notice-root] button', { hasText: /Clear all read|पढ़ी हुई सब हटाएँ/ })
            .click();
          await page.waitForSelector('button >> text=/Undo|वापस लाएँ/');
          await snap('5-undo-toast-clear-read');
          await snap('2b-notices-page-after-clear', true);
        });
        test(`empty · ${tail}`, async ({ page }) => {
          test.setTimeout(3 * 60_000);
          mkdirSync(OUT, { recursive: true });
          const c = customerCase(width, theme, locale);
          await open(page, c, true);
          await page.goto(localised('/notifications', locale));
          await settle(page);
          await page.waitForSelector('[data-notice-root] a');
          await settle(page);
          await page.screenshot({
            path: join(OUT, `3-empty-page__${tail}.png`),
            fullPage: true,
            animations: 'disabled',
          });
          await bell(page).click();
          await page.waitForTimeout(300);
          await page.screenshot({ path: join(OUT, `3b-empty-bell__${tail}.png`), animations: 'disabled' });
        });
      }
});
