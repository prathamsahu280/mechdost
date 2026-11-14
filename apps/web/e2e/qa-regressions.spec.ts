/**
 * Regressions from the live multi-role QA and the click crawler (2026-11-14; findings in the git-ignored
 * `reports/ui-review-2026-11-14/`, method in `docs/runbooks/ui-testing.md`). One test per fixed finding.
 */
import { expect, test, type Page } from '@playwright/test';
import { CONSENT_DECIDED } from './fixtures/consent';
import { CODES, seedData, supportTicket, TICKET_CODE } from './fixtures/demo-world';

async function signIn(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (phone === '9000000003') {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
  await expect(page).not.toHaveURL(/\/login/);
}

test.use({ storageState: CONSENT_DECIDED });

test('B6: the workshop finder says when it does not know a PIN code', async ({ page }) => {
  await page.goto('/workshops');
  const pin = page.getByLabel('PIN code');
  const note = page.getByText("We don't know this PIN code yet", { exact: false });
  await pin.fill('999999');
  await expect(note).toBeVisible();
  await pin.fill('492001');
  await expect(note).toHaveCount(0);
});

test('P2: an acknowledged ticket shows its order without a dangling separator', async ({ page }) => {
  const now = Date.now();
  const ticket = {
    ...supportTicket(now),
    status: 'awaiting_customer',
    acknowledgedAt: new Date(now).toISOString(),
  };
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-support'))
        window.localStorage.setItem('mechdost-demo-support', value);
    },
    JSON.stringify({ tickets: [ticket] }),
  );
  await signIn(page, '9876543210');
  await page.goto('/account/support');
  const card = page.locator('article').filter({ hasText: TICKET_CODE });
  const meta = card.getByText(`Order ${CODES.shipped}`, { exact: false });
  await expect(meta).toBeVisible();
  await expect(meta).not.toHaveText(/·\s*$/);
});

test('U5: the admin overview counts confirmed orders that are not yet delivered', async ({ page }) => {
  const orders = seedData(Date.now())['mechdost-demo-orders'];
  const shipped = orders.find((o) => o.code === CODES.shipped);
  expect(shipped).toBeTruthy();
  if (!shipped) return;
  const delivered = { ...shipped, code: 'MD-RPR-2026-HND009', stage: 5 };
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-orders'))
        window.localStorage.setItem('mechdost-demo-orders', value);
    },
    JSON.stringify([shipped, delivered]),
  );
  await signIn(page, '9000000003');
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: /Confirmed, not yet delivered/ })).toContainText('1');
});

test('F5: the signed-out account page describes sign-in correctly (a password is needed)', async ({
  page,
}) => {
  await page.goto('/account');
  await expect(page.getByText('Sign in with your mobile number or email and your password.')).toBeVisible();
  await expect(page.getByText('no password', { exact: false })).toHaveCount(0);
});

test('F2: a customer blocked from cash on delivery is told at once, not after submitting', async ({
  page,
}) => {
  const block = {
    id: 'qa-block-1',
    accountId: 'demo-customer',
    level: 'cod_only',
    reasonCode: 'cod_refused',
    note: null,
    endsAt: null,
    by: 'QA',
    at: new Date().toISOString(),
    liftedAt: null,
    liftedBy: null,
    liftedReason: null,
  };
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-customer-blocks'))
        window.localStorage.setItem('mechdost-demo-customer-blocks', value);
    },
    JSON.stringify([block]),
  );
  await signIn(page, '9876543210');
  await page.goto('/shop/castrol-activ-4t-20w40-900ml');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.goto('/checkout');
  await expect(
    page.getByText("Cash on delivery isn't available for this account.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Place order/ })).toBeDisabled();
});

test('F8: the compare tray stays out of checkout, and is back on the shop', async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem('mechdost-compare'))
      window.localStorage.setItem(
        'mechdost-compare',
        JSON.stringify({
          category: 'lubricants',
          slugs: ['castrol-activ-4t-20w40-900ml', 'motul-3100-4t-10w30-1l'],
        }),
      );
  });
  const tray = page.getByRole('complementary', { name: 'Products to compare' });
  await page.goto('/shop');
  await expect(tray).toBeVisible();
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(tray).toHaveCount(0);
});

test('F11: the quote chat Send button waits for a message', async ({ page }) => {
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-quotes'))
        window.localStorage.setItem('mechdost-demo-quotes', value);
    },
    JSON.stringify(seedData(Date.now())['mechdost-demo-quotes']),
  );
  await signIn(page, '9876543210');
  await page.goto(`/quotes/${CODES.quote}`);
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await page.getByLabel('Message', { exact: false }).first().fill('Can you deliver by Friday?');
  await expect(send).toBeEnabled();
});

test('F4: the sign-in page tells a signed-in person so, with the way back', async ({ page }) => {
  await signIn(page, '9876543210');
  await page.goto('/login');
  await expect(page.getByText("You're signed in as Ravi Sahu.", { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to your account' })).toHaveAttribute('href', '/account');
});

test('F6: a customer blocked from signing in is told why, not silently signed out', async ({ page }) => {
  const at = new Date().toISOString();
  await page.addInitScript(
    (seed: { session: string; blocks: string }) => {
      if (window.localStorage.getItem('qa-seeded')) return;
      window.localStorage.setItem('qa-seeded', '1');
      window.localStorage.setItem('mechdost-demo-session', seed.session);
      window.localStorage.setItem('mechdost-demo-customer-blocks', seed.blocks);
    },
    {
      session: JSON.stringify([{ accountId: 'demo-customer', signedInAt: at }]),
      blocks: JSON.stringify([
        {
          id: 'qa-block-full',
          accountId: 'demo-customer',
          level: 'full',
          reasonCode: 'abusive_behaviour',
          note: null,
          endsAt: null,
          by: 'QA',
          at,
          liftedAt: null,
          liftedBy: null,
          liftedReason: null,
        },
      ]),
    },
  );
  await page.goto('/account');
  await expect(page.getByText("This account can't sign in right now.", { exact: false })).toBeVisible();
});

test('U10: the shoppers’ help button stays out of the partner and admin portals', async ({ page }) => {
  const help = page.locator('button.assistant-launcher');
  await page.goto('/');
  await expect(help).toBeVisible();
  await signIn(page, '9000000003');
  await page.goto('/admin/orders');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(help).toHaveCount(0);
  await page.goto('/hi/admin');
  await expect(help).toHaveCount(0);
});

test('U8: /compare without a list opens the saved comparison', async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem('mechdost-compare'))
      window.localStorage.setItem(
        'mechdost-compare',
        JSON.stringify({
          category: 'lubricants',
          slugs: ['castrol-activ-4t-20w40-900ml', 'motul-3100-4t-10w30-1l'],
        }),
      );
  });
  await page.goto('/compare');
  await expect(page).toHaveURL(/\/compare\?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l$/);
  await expect(
    page
      .getByRole('table')
      .getByRole('columnheader')
      .filter({ has: page.getByRole('link') }),
  ).toHaveCount(2);
});

test('U6: checkout starts from the signed-in customer’s details and default address', async ({ page }) => {
  await signIn(page, '9876543210');
  await page.goto('/shop/castrol-activ-4t-20w40-900ml');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.goto('/checkout');
  await expect(page.getByLabel('Full name')).toHaveValue('Ravi Sahu');
  await expect(page.getByLabel('Mobile number')).toHaveValue('9876543210');
  await expect(page.getByLabel('PIN code')).toHaveValue('492099');
  await expect(page.getByLabel('Delivery address')).not.toHaveValue('');
});

test('U11: only the customer sees the delivery code, never the shop', async ({ page }) => {
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-orders'))
        window.localStorage.setItem('mechdost-demo-orders', value);
    },
    JSON.stringify(seedData(Date.now())['mechdost-demo-orders']),
  );
  await signIn(page, '9000000001');
  await page.goto(`/orders/${CODES.shipped}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(CODES.shipped);
  await expect(page.getByText('4821')).toHaveCount(0);
  await page.goto('/login');
  await signIn(page, '9876543210');
  await page.goto(`/orders/${CODES.shipped}`);
  await expect(page.getByText('4821')).toBeVisible();
});

test('U14: an offer price above the list price is flagged before sending', async ({ page }) => {
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-quotes'))
        window.localStorage.setItem('mechdost-demo-quotes', value);
    },
    JSON.stringify(seedData(Date.now())['mechdost-demo-quotes']),
  );
  await signIn(page, '9000000003');
  await page.goto('/admin/quotes');
  await page
    .getByRole('button', { name: new RegExp(CODES.quote) })
    .first()
    .click();
  const price = page.locator('input[name^="price-"]').first();
  await price.fill('999999');
  await expect(page.getByText('Above the list price', { exact: false }).first()).toBeVisible();
});

test('U15: a delivered order links straight to rating what was bought', async ({ page }) => {
  const orders = seedData(Date.now())['mechdost-demo-orders'];
  const shipped = orders.find((o) => o.code === CODES.shipped);
  expect(shipped).toBeTruthy();
  if (!shipped) return;
  const delivered = { ...shipped, stage: 5, delivery: null };
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-orders'))
        window.localStorage.setItem('mechdost-demo-orders', value);
    },
    JSON.stringify([delivered]),
  );
  await signIn(page, '9876543210');
  await page.goto(`/orders/${CODES.shipped}`);
  const slug = delivered.lines[0]?.slug ?? '';
  const rate = page.getByRole('link', { name: /^Rate / }).first();
  await expect(rate).toBeVisible();
  await expect(rate).toHaveAttribute('href', `/shop/${slug}#reviews-${slug}`);
});

test('B1: a rejection reaches a Hindi customer in Hindi, with nothing charged for cash on delivery', async ({
  page,
}) => {
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-orders'))
        window.localStorage.setItem('mechdost-demo-orders', value);
    },
    JSON.stringify(seedData(Date.now())['mechdost-demo-orders']),
  );
  await signIn(page, '9000000003');
  await page.goto('/admin/orders');
  const card = page.locator('article').filter({ hasText: CODES.routing });
  await card.getByRole('button', { name: 'Reject with a message' }).click();
  const note = card.getByLabel('Message to the customer', { exact: false });
  await expect(note).toHaveValue('');
  await card.getByLabel('Reason', { exact: true }).selectOption('no_stock_nearby');
  // Same rule as the API: a message of at least 10 characters, written by the admin.
  await card.getByRole('button', { name: 'Reject order' }).click();
  await expect(card.getByText('Write at least 10 characters for the customer.')).toBeVisible();
  await note.fill('हमें खेद है, यह बैटरी अभी उपलब्ध नहीं है।');
  await card.getByRole('button', { name: 'Reject order' }).click();
  await page.goto(`/hi/orders/${CODES.routing}`);
  await expect(
    page.getByText('आपके पास की किसी दुकान में ये प्रोडक्ट अभी स्टॉक में नहीं हैं।', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('यह कैश ऑन डिलीवरी था', { exact: false })).toBeVisible();
});

test('lifecycle 3: an offer held by a suspended shop can be rerouted at once', async ({ page }) => {
  await page.addInitScript(
    (seed: { orders: string; status: string }) => {
      if (window.localStorage.getItem('qa-seeded')) return;
      window.localStorage.setItem('qa-seeded', '1');
      window.localStorage.setItem('mechdost-demo-orders', seed.orders);
      window.localStorage.setItem('mechdost-demo-partner-status', seed.status);
    },
    {
      orders: JSON.stringify(seedData(Date.now())['mechdost-demo-orders']),
      status: JSON.stringify([
        {
          kind: 'shop',
          slug: 'sharma-auto-parts',
          status: 'suspended',
          reason: 'QA: documents expired',
          by: 'QA',
          at: new Date().toISOString(),
        },
      ]),
    },
  );
  await signIn(page, '9000000003');
  await page.goto('/admin/orders');
  const card = page.locator('article').filter({ hasText: CODES.offered });
  await expect(card.getByText(/is paused or suspended — reroute or reject/)).toBeVisible();
  await expect(card.getByRole('button', { name: /^Route to/ }).first()).toBeVisible();
});

test('lifecycle 6: the compare tray stays out of the admin and partner portals', async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem('mechdost-compare'))
      window.localStorage.setItem(
        'mechdost-compare',
        JSON.stringify({
          category: 'lubricants',
          slugs: ['castrol-activ-4t-20w40-900ml', 'motul-3100-4t-10w30-1l'],
        }),
      );
  });
  const tray = page.getByRole('complementary', { name: 'Products to compare' });
  await signIn(page, '9000000003');
  await page.goto('/admin/coins');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(tray).toHaveCount(0);
  await page.goto('/shop');
  await expect(tray).toBeVisible();
});

test('lifecycle 5: delivered orders have a home for the admin and the shop', async ({ page }) => {
  const orders = seedData(Date.now())['mechdost-demo-orders'];
  const shipped = orders.find((o) => o.code === CODES.shipped);
  expect(shipped).toBeTruthy();
  if (!shipped) return;
  const delivered = { ...shipped, stage: 5, delivery: null };
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-orders'))
        window.localStorage.setItem('mechdost-demo-orders', value);
    },
    JSON.stringify([delivered]),
  );
  await signIn(page, '9000000003');
  await page.goto('/admin/orders');
  await expect(page.getByRole('heading', { name: /^Delivered/ })).toBeVisible();
  await page.goto('/login');
  await signIn(page, '9000000001');
  await page.goto('/partner/shop');
  await expect(page.getByRole('heading', { name: /^Delivered/ })).toBeVisible();
  await expect(page.getByText(CODES.shipped).first()).toBeVisible();
});

test('U12: a shop sees the offers it missed', async ({ page }) => {
  const orders = seedData(Date.now())['mechdost-demo-orders'];
  const offered = orders.find((o) => o.code === CODES.offered);
  expect(offered?.shop).toBeTruthy();
  if (!offered?.shop) return;
  const past = new Date(Date.now() - 60_000).toISOString();
  const missed = { ...offered, shop: { ...offered.shop, expiresAt: past } };
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-orders'))
        window.localStorage.setItem('mechdost-demo-orders', value);
    },
    JSON.stringify([missed]),
  );
  await signIn(page, '9000000001');
  await page.goto('/partner/shop');
  const section = page.getByRole('region', { name: /Missed offers/ });
  await expect(section).toBeVisible();
  await expect(section.getByText(CODES.offered)).toBeVisible();
});

test('lifecycle 8: an onboarded application reads as finished, without an empty details box', async ({
  page,
}) => {
  const apps = seedData(Date.now())['mechdost-demo-applications'];
  const first = apps[0];
  expect(first).toBeTruthy();
  if (!first) return;
  const done = { ...first, stage: 3, details: '' }; // 'onboarded', the last of APPLICATION_STAGES
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-applications'))
        window.localStorage.setItem('mechdost-demo-applications', value);
    },
    JSON.stringify([done]),
  );
  await page.goto(`/partners/applications/${first.code}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(first.code);
  await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
  await expect(page.locator('aside p.rounded-lg.bg-surface-alt')).toHaveCount(0);
});

test.describe('consent banner on phones', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('P5: the privacy banner leaves most of the first screen visible', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone layout');
    await page.goto('/');
    const banner = page.getByTestId('consent-banner');
    await expect(banner).toBeVisible();
    const box = await banner.boundingBox();
    const view = page.viewportSize();
    expect(box && view).toBeTruthy();
    if (box && view) expect(box.height).toBeLessThanOrEqual(view.height * 0.3);
  });
});

test('U7: the customer is told when a workshop declines and when the request moves', async ({ page }) => {
  const requests = seedData(Date.now())['mechdost-demo-requests'];
  const declined = requests.find((r) => r.code === CODES.declined);
  expect(declined).toBeTruthy();
  if (!declined) return;
  const moved = {
    ...declined,
    code: 'SR-RPR-2026-HND109',
    workshopSlug: 'sarona-car-care',
    workshopName: 'Sarona Car Care',
  };
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-requests'))
        window.localStorage.setItem('mechdost-demo-requests', value);
    },
    JSON.stringify([declined, moved]),
  );
  await page.goto(`/service/${CODES.declined}`);
  await expect(
    page.getByText('MechDost is finding another workshop near you', { exact: false }),
  ).toBeVisible();
  await page.goto('/service/SR-RPR-2026-HND109');
  await expect(page.getByText('MechDost passed your request to', { exact: false })).toBeVisible();
});

test('U4: the admin overview shows waiting support requests and price changes', async ({ page }) => {
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-support'))
        window.localStorage.setItem('mechdost-demo-support', value);
    },
    JSON.stringify({ tickets: [supportTicket(Date.now())] }),
  );
  await signIn(page, '9000000003');
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: /Support requests to answer/ })).toContainText('1');
  await expect(page.getByRole('link', { name: /Price changes to approve/ })).toHaveAttribute(
    'href',
    '/admin/partners',
  );
});

test('U4: the customer’s section bar shows a reply or an offer waiting for them', async ({ page }) => {
  const now = Date.now();
  const ticket = {
    ...supportTicket(now),
    status: 'awaiting_customer',
    acknowledgedAt: new Date(now).toISOString(),
  };
  await page.addInitScript(
    (seed: { support: string; quotes: string }) => {
      if (window.localStorage.getItem('qa-seeded')) return;
      window.localStorage.setItem('qa-seeded', '1');
      window.localStorage.setItem('mechdost-demo-support', seed.support);
      window.localStorage.setItem('mechdost-demo-quotes', seed.quotes);
    },
    {
      support: JSON.stringify({ tickets: [ticket] }),
      quotes: JSON.stringify(seedData(now)['mechdost-demo-quotes']),
    },
  );
  await signIn(page, '9876543210');
  await page.goto('/account');
  const nav = page.getByRole('navigation', { name: 'Account sections' });
  await expect(nav.getByRole('link', { name: /Support.*1 waiting/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Bulk quotes.*1 waiting/ })).toBeVisible();
  // The badge's screen-reader text must not widen the page (it escaped the section bar on phones).
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
});

test.describe('consent banner on desktop', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('lifecycle 6: the privacy banner does not cover the side navigation', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop layout: the side navigation is on the left');
    await signIn(page, '9876543210');
    await page.goto('/account/orders');
    const banner = page.getByTestId('consent-banner');
    await expect(banner).toBeVisible();
    const nav = await page.getByRole('navigation', { name: 'Account sections' }).boundingBox();
    const box = await banner.boundingBox();
    expect(nav && box).toBeTruthy();
    if (nav && box) expect(box.x).toBeGreaterThanOrEqual(nav.x + nav.width);
  });
});

test('review: the theme toggle still works when the browser storage is full', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the header toggle is shown from 400 px; desktop is enough for the storage case');
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('mechdost-theme', 'light');
  });
  await page.reload();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
  });
  await page.getByRole('button', { name: 'Dark mode' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(300);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('QA 13: checkout says from when delivery is free while a fee is charged', async ({ page }) => {
  await page.goto('/shop/castrol-activ-4t-20w40-900ml');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.goto('/checkout');
  await expect(page.getByRole('complementary').getByText(/Free delivery on orders from ₹/)).toBeVisible();
});

test('review: a different customer account does not see someone else’s delivery code', async ({ page }) => {
  const orders = seedData(Date.now())['mechdost-demo-orders'];
  const shipped = orders.find((o) => o.code === CODES.shipped);
  expect(shipped).toBeTruthy();
  if (!shipped) return;
  const someoneElse = {
    ...shipped,
    customer: { ...shipped.customer, phone: '9123456780', name: 'Asha Verma' },
  };
  await page.addInitScript(
    (value: string) => {
      if (!window.localStorage.getItem('mechdost-demo-orders'))
        window.localStorage.setItem('mechdost-demo-orders', value);
    },
    JSON.stringify([someoneElse]),
  );
  await signIn(page, '9876543210');
  await page.goto(`/orders/${CODES.shipped}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(CODES.shipped);
  await expect(page.getByText('4821')).toHaveCount(0);
});

test('review: a comparison link stays readable after switching language', async ({ page }) => {
  await page.goto('/hi/compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l');
  await page.locator('a[hreflang="en"]').first().click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveURL(/\/compare\?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l$/);
});

test('U16: the portals drop the shopper tab bar and cart; the storefront keeps them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.locator('[data-track^="tab_"]'); // the bottom tab bar's links, in any language
  const cart = page.locator('[data-track="header_cart"]');
  await signIn(page, '9000000001'); // shop owner
  for (const path of ['/partner/shop', '/hi/partner/shop']) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(tabs).toHaveCount(0);
    await expect(cart).toHaveCount(0);
  }
  await page.goto('/shop');
  await expect(tabs.first()).toBeVisible();
  await expect(cart).toBeVisible();
});
