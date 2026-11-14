/**
 * Seller onboarding on the website (plan 2026-11-13 Task 7, demo store): the seller form with GST, address, the
 * map pin and a product tick-list; a wrong GSTIN is caught next to its field; the location works by search even
 * when the device location is refused and the map cannot load; an invite link locks the invited contacts and works
 * once.
 */
import { expect, test, type Page } from '@playwright/test';

const PANDRI = { label: 'Pandri, Raipur, Chhattisgarh, 492004, India', lat: 21.2514, lng: 81.6467 };
const RESULT = [PANDRI];

async function offline(page: Page) {
  // No third-party calls (map tiles, fonts): the map fails, and search must still work.
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await page.route('**/api/geo/search**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: RESULT }) }),
  );
}

async function fillShop(page: Page, gstin: string) {
  await page.getByLabel('Business name (as on GST)').fill('Sahu Auto Parts');
  await page.getByLabel('Shop name').fill('Sahu Auto Parts');
  await page.getByLabel('GSTIN (15 characters)').fill(gstin);
  await page.getByLabel('Shop address').fill('Shop 4, GE Road, Pandri');
  await page.getByLabel('PIN code').fill('492004');
}

async function setLocationBySearch(page: Page) {
  await page.getByRole('button', { name: 'Set the shop location' }).click();
  const dialog = page.getByRole('dialog', { name: 'Where is your shop?' });
  await dialog.getByRole('button', { name: 'Use my location' }).click();
  await expect(
    dialog.getByText('We could not get your location. Search for your area instead.'),
  ).toBeVisible();
  await dialog.getByRole('searchbox', { name: "Search for your shop's area" }).fill('Pandri Raipur');
  await dialog.getByRole('button', { name: 'Search', exact: true }).click();
  await dialog.getByRole('button', { name: PANDRI.label }).click();
  await dialog.getByRole('button', { name: 'Confirm this location' }).click();
  await expect(page.getByText('Location set (by search).')).toBeVisible();
}

async function chooseProducts(page: Page) {
  await page.getByRole('button', { name: 'Choose products' }).click();
  const dialog = page.getByRole('dialog', { name: 'Which products do you sell?' });
  await dialog.getByRole('searchbox', { name: 'Search products' }).fill('castrol');
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByRole('searchbox', { name: 'Search products' }).fill('exide');
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 products chosen' })).toBeVisible();
}

test.describe('apply as a seller', () => {
  test('a complete application with GST, address, map pin and products is received', async ({ page }) => {
    await offline(page);
    await page.goto('/partners/apply/seller');
    await page.getByLabel('Your name').fill('Ravi Sahu');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByLabel('Email').fill('ravi@example.com');
    await fillShop(page, '22ABVCS4888H1ZL');
    await setLocationBySearch(page);
    await chooseProducts(page);
    await page.getByLabel(/I agree that MechDost may store/).check();
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page).toHaveURL(/\/partners\/applications\/PA-RPR-/);
    await expect(page.getByText('Application received', { exact: true })).toBeVisible();
  });

  test('a wrong GSTIN is shown next to its field and nothing is sent', async ({ page }) => {
    await offline(page);
    await page.goto('/partners/apply/seller');
    await fillShop(page, '22ABVCS4888H1ZM');
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByText('Check the GSTIN: 15 characters, as on your GST certificate.')).toBeVisible();
    await expect(page.getByLabel('GSTIN (15 characters)')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/partners\/apply\/seller$/);
  });
});

test.describe('invite link', () => {
  test('shows the invited contacts locked, submits once, then says it was used', async ({ page }) => {
    await offline(page);
    await page.addInitScript(() => {
      if (window.localStorage.getItem('mechdost-demo-invites')) return;
      window.localStorage.setItem(
        'mechdost-demo-invites',
        JSON.stringify([
          {
            token: 'e2e-invite-token-0001',
            name: 'Asha Verma',
            email: 'asha@example.com',
            phone: '9812345670',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            status: 'sent',
          },
        ]),
      );
    });
    await page.goto('/partners/invite/e2e-invite-token-0001');
    await expect(page.getByText('MechDost invited you.', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveValue('Asha Verma');
    await expect(page.getByLabel('Your name')).toHaveAttribute('readonly', '');
    await fillShop(page, '27AAPFU0939F1ZV');
    await setLocationBySearch(page);
    await chooseProducts(page);
    await page.getByLabel(/I agree that MechDost may store/).check();
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page).toHaveURL(/\/partners\/applications\/PA-RPR-/);
    await page.goto('/partners/invite/e2e-invite-token-0001');
    await expect(page.getByText('This invite has already been used.', { exact: false })).toBeVisible();
  });
});

async function signInAdmin(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Mobile number or email').fill('9000000003');
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

test.describe('admin invites a seller', () => {
  test('the invite is listed with its link, opens the invited form, and can be revoked', async ({ page }) => {
    await offline(page);
    await signInAdmin(page, '/admin/partners');
    const card = page.getByRole('region', { name: 'Invite a seller' });
    await card.getByLabel('Name').fill('Meena Sahu');
    await card.getByLabel('Email').fill('meena@example.com');
    await card.getByLabel('Mobile number').fill('9811122233');
    await card.getByRole('button', { name: 'Create invite link' }).click();
    const row = card.getByRole('listitem').filter({ hasText: 'Meena Sahu' });
    await expect(row.getByText('Waiting for the seller')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Copy link' })).toBeVisible();
    const href = await row.getByRole('link', { name: 'Open the invite' }).getAttribute('href');
    expect(href).toMatch(/^\/partners\/invite\/[0-9a-f]{48}$/);

    await page.goto(href ?? '/');
    await expect(page.getByLabel('Your name')).toHaveValue('Meena Sahu');

    await page.goto('/admin/partners');
    await card
      .getByRole('listitem')
      .filter({ hasText: 'Meena Sahu' })
      .getByRole('button', { name: 'Revoke' })
      .click();
    await expect(
      card.getByRole('listitem').filter({ hasText: 'Meena Sahu' }).getByText('Revoked'),
    ).toBeVisible();
    await page.goto(href ?? '/');
    await expect(page.getByText('This invite was withdrawn.', { exact: false })).toBeVisible();
  });
});

test.describe('price approval queue', () => {
  test('the admin approves one price and rejects another with a reason', async ({ page }) => {
    await offline(page);
    await page.addInitScript(() => {
      if (window.localStorage.getItem('mechdost-demo-price-requests')) return;
      const base = {
        shopSlug: 'sharma-auto-parts',
        status: 'pending',
        reason: null,
        createdAt: new Date().toISOString(),
        decidedAt: null,
      };
      window.localStorage.setItem(
        'mechdost-demo-price-requests',
        JSON.stringify([
          {
            ...base,
            id: 'pr-1',
            productSlug: 'castrol-activ-4t-20w40-900ml',
            pricePaise: 44_000,
            mrpPaise: 47_500,
          },
          {
            ...base,
            id: 'pr-2',
            productSlug: 'exide-xltz4a-2w-battery',
            pricePaise: 111_500,
            mrpPaise: 112_000,
          },
        ]),
      );
    });
    await signInAdmin(page, '/admin/partners');
    const queue = page.getByRole('region', { name: 'Price requests' });
    const castrol = queue.getByRole('listitem').filter({ hasText: 'Activ 4T 20W40 900 ml' });
    await expect(castrol).toContainText('Sharma Auto Parts');
    await expect(castrol).toContainText('₹440');
    await castrol.getByRole('button', { name: 'Approve' }).click();
    await expect(castrol).toHaveCount(0);

    const exide = queue.getByRole('listitem').filter({ hasText: 'XLTZ4A' });
    await exide.getByLabel('Reason').selectOption({ label: 'Above market price' });
    await exide.getByRole('button', { name: 'Reject' }).click();
    await expect(queue.getByText('No price changes are waiting.')).toBeVisible();
  });
});

async function signInShop(page: Page) {
  await page.goto(`/login?next=${encodeURIComponent('/partner/shop')}`);
  await page.getByLabel('Mobile number or email').fill('9000000001');
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/partner\/shop$/);
}

test.describe('shop prices', () => {
  test('prices wait for approval; approved goes on sale, a rejected change takes it off sale', async ({
    page,
  }) => {
    await offline(page);
    await signInShop(page);
    const prices = page.getByRole('region', { name: 'Your prices' });
    const castrol = prices.getByRole('listitem').filter({ hasText: 'Activ 4T 20W40 900 ml' });
    await expect(castrol).toContainText('On sale · you are paid ₹440');
    await castrol.getByLabel('New price (₹)').fill('480');
    await castrol.getByRole('button', { name: 'Send for approval' }).click();
    await expect(castrol.getByText('The price cannot be above the MRP (₹475).')).toBeVisible();
    await castrol.getByLabel('New price (₹)').fill('430');
    await castrol.getByRole('button', { name: 'Send for approval' }).click();
    await expect(castrol).toContainText('Waiting for approval: ₹430');
    await expect(castrol).toContainText('On sale · you are paid ₹440');

    const shell = prices.getByRole('listitem').filter({ hasText: 'Fully synthetic engine oil 5W-30 3.5 L' });
    await shell.getByLabel('New price (₹)').fill('3100');
    await shell.getByRole('button', { name: 'Send for approval' }).click();
    await expect(shell).toContainText('Waiting for approval: ₹3,100');

    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await signInAdmin(page, '/admin/partners');
    const queue = page.getByRole('region', { name: 'Price requests' });
    await queue
      .getByRole('listitem')
      .filter({ hasText: 'Activ 4T 20W40 900 ml' })
      .getByRole('button', { name: 'Approve' })
      .click();
    const shellRequest = queue.getByRole('listitem').filter({ hasText: 'Fully synthetic engine oil' });
    await shellRequest.getByLabel('Reason').selectOption({ label: 'Above market price' });
    await shellRequest.getByRole('button', { name: 'Reject' }).click();
    await expect(queue.getByText('No price changes are waiting.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await signInShop(page);
    await expect(castrol).toContainText('On sale · you are paid ₹430');
    await expect(shell).toContainText('Taken off sale: Above market price');
  });
});

test.describe('seller agreement', () => {
  test('the admin publishes the agreement and the shop accepts the current version', async ({ page }) => {
    await offline(page);
    await signInAdmin(page, '/admin/partners');
    const admin = page.getByRole('region', { name: 'Seller agreement' });
    await expect(admin.getByText('No agreement published yet.', { exact: false })).toBeVisible();
    await admin
      .getByLabel('Agreement text (English)')
      .fill('The seller agrees to list genuine parts at prices approved by MechDost.');
    await admin
      .getByLabel('Agreement text (Hindi)')
      .fill('विक्रेता MechDost द्वारा मंज़ूर कीमतों पर असली पुर्ज़े बेचने के लिए सहमत है।');
    await admin.getByRole('button', { name: 'Publish this version' }).click();
    await expect(admin.getByText('Version 1 is current.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await signInShop(page);
    const card = page.getByRole('region', { name: 'Seller agreement' });
    await expect(card).toContainText('genuine parts at prices approved by MechDost');
    await card.getByRole('button', { name: 'Accept the agreement' }).click();
    await expect(card.getByText('Tick the box to accept.')).toBeVisible();
    await card.getByLabel('I have read and agree to this agreement.').check();
    await card.getByRole('button', { name: 'Accept the agreement' }).click();
    await expect(card).toContainText('You accepted version 1');
  });
});

test.describe('application review', () => {
  test('the admin sees the seller details, sets the delivery area and approves; another is rejected with a reason', async ({
    page,
  }) => {
    await offline(page);
    await page.addInitScript(() => {
      if (window.localStorage.getItem('mechdost-demo-applications')) return;
      const base = {
        createdAt: new Date().toISOString(),
        kind: 'seller',
        phone: '9876543210',
        pincode: '492004',
        vehicles: [],
        details: '',
        stage: 2,
        rejected: false,
        gstStatus: 'registered',
        gstNumber: '22ABVCS4888H1ZL',
        addressLine: 'Shop 4, GE Road, Pandri',
        location: { lat: 21.2514, lng: 81.6467, accuracyM: 100, source: 'search' },
        productSlugs: ['castrol-activ-4t-20w40-900ml', 'synthetic-engine-oil-5w30-3-5l'],
        source: 'public',
      };
      window.localStorage.setItem(
        'mechdost-demo-applications',
        JSON.stringify([
          { ...base, code: 'PA-RPR-2026-AAAAAA', name: 'Ravi Sahu', business: 'Sahu Auto Parts' },
          { ...base, code: 'PA-RPR-2026-BBBBBB', name: 'Mohan Sahu', business: 'Sahu Motors' },
        ]),
      );
    });
    await signInAdmin(page, '/admin/applications');
    const ravi = page.getByRole('listitem').filter({ hasText: 'Ravi Sahu' });
    await expect(ravi).toContainText('22ABVCS4888H1ZL');
    await expect(ravi).toContainText('2 products');
    await expect(ravi).toContainText('Same GSTIN as PA-RPR-2026-BBBBBB');

    await ravi.getByRole('button', { name: 'Approve with delivery area' }).click();
    const area = ravi.getByRole('group', { name: 'Delivery area' });
    await expect(area.getByRole('checkbox', { name: '492004' })).toBeChecked();
    await area.getByRole('checkbox', { name: '492099' }).uncheck();
    await ravi.getByLabel('Delivery charge (₹)').fill('30');
    await ravi.getByLabel('Delivery days').fill('1');
    await ravi.getByRole('button', { name: 'Approve and onboard' }).click();
    await expect(ravi).toContainText('Approved and onboarded');
    await expect(ravi).toContainText('Delivers to 4 PIN codes · ₹30 · 1 day');

    const mohan = page.getByRole('listitem').filter({ hasText: 'Mohan Sahu' });
    await mohan.getByRole('button', { name: 'Reject' }).click();
    await mohan.getByRole('button', { name: 'Reject application' }).click();
    await expect(mohan.getByText('Choose a reason.')).toBeVisible();
    await mohan.getByLabel('Reason').selectOption({ label: 'Duplicate application' });
    await mohan.getByRole('button', { name: 'Reject application' }).click();
    await expect(mohan).toContainText('Rejected: Duplicate application');
  });
});

/**
 * Q89 (lifecycle QA 2026-11-14): an approved seller reaches their own shop, as the API does on sign-in
 * (`linkApplicantOwner`): the onboarded application becomes a shop, the applicant's phone account becomes its
 * owner, and the admin can route orders to it.
 */
test.describe('approved seller reaches their shop', () => {
  test('signs up with the application phone, opens their shop, and receives an order the admin routes', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (window.localStorage.getItem('mechdost-demo-applications')) return;
      window.localStorage.setItem(
        'mechdost-demo-applications',
        JSON.stringify([
          {
            code: 'PA-RPR-2026-CCCCCC',
            createdAt: new Date().toISOString(),
            kind: 'seller',
            name: 'Kiran Verma',
            phone: '9123456700',
            business: 'Verma Lubricants LLP',
            shopName: 'Verma Lubricants',
            pincode: '492004',
            vehicles: [],
            details: '',
            stage: 3, // onboarded
            rejected: false,
            gstStatus: 'registered',
            gstNumber: '22ABVCS4888H1ZL',
            addressLine: 'Shop 9, GE Road, Pandri',
            location: { lat: 21.2514, lng: 81.6467, accuracyM: 100, source: 'search' },
            productSlugs: ['castrol-activ-4t-20w40-900ml'],
            categories: ['lubricants'],
            coverage: { pincodes: ['492004', '492099'], shippingPaise: 3000, leadDays: 1 },
            source: 'public',
          },
        ]),
      );
    });

    // A guest orders engine oil; the admin can offer it to the new shop.
    await page.goto('/shop/castrol-activ-4t-20w40-900ml');
    await page.getByRole('button', { name: 'Add to cart' }).first().click();
    await page.goto('/checkout');
    await page.getByLabel('Full name').fill('Ravi Sahu');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByLabel('Delivery address').fill('C-605 Salasar Greens, Sarona, Raipur');
    await page.getByLabel('PIN code').fill('492099');
    await page.getByLabel(/I agree to share/).check();
    await page.getByRole('button', { name: /Place order/ }).click();
    await expect(page).toHaveURL(/\/orders\/MD-RPR-/);
    const order = new URL(page.url()).pathname.split('/').at(-1) ?? '';

    await signInAdmin(page, '/admin/orders');
    await page
      .locator('article')
      .filter({ hasText: order })
      .getByRole('button', { name: 'Route to Verma Lubricants' })
      .click();
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Sign out' }).first().click();

    // The applicant creates their login with the application phone (OTP) and lands in their own shop.
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Mobile number').fill('9123456700');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await page.getByLabel('Full name').fill('Kiran Verma');
    await page.getByLabel('Email', { exact: true }).fill('kiran.verma@example.com');
    await page.getByLabel('Create password', { exact: true }).fill('Ghadi#Chowk2026');
    await page.getByLabel('Confirm password', { exact: true }).fill('Ghadi#Chowk2026');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto('/partner/shop');
    await expect(page.getByRole('heading', { name: /Verma Lubricants/ })).toBeVisible();
    await expect(page.locator('article').filter({ hasText: order })).toBeVisible();

    // Signing in again later keeps the shop (claimed once, not re-linked or lost).
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await page.goto(`/login?next=${encodeURIComponent('/partner/shop')}`);
    await page.getByLabel('Mobile number or email').fill('9123456700');
    await page.getByLabel('Password', { exact: true }).fill('Ghadi#Chowk2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Verma Lubricants/ })).toBeVisible();
  });
});
