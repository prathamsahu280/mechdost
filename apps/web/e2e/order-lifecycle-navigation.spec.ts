import { expect, test, type Page } from '@playwright/test';

/**
 * Order lifecycle, navigated (user 2026-11-14: "a customer made an order and still navigated the website while
 * the order wasn't accepted, then … when it's out for delivery etc, and same for the seller's screen and
 * admin's"). One real order is driven through every stage by the real UI actions; at each stage the customer,
 * the shop and the admin each sign in and walk their pages. Every page must render cleanly (heading, no
 * skeletons, no sideways scroll, no page errors) and every view must agree on the order's state: the customer's
 * timeline and account list, the shop's card and buttons, the admin's card. The delivery code is shown to the
 * customer only. Demo data is per browser, so the three roles share one page and sign in and out.
 */

const CUSTOMER = '9876543210';
const SHOP = '9000000001'; // Sharma Auto Parts
const OTHER_SHOP = '9000000004'; // Raipur Battery Point
const ADMIN = '9000000003';
const SHOP_NAME = 'Sharma Auto Parts';

type Stage = 'routing' | 'offered' | 'confirmed' | 'packed' | 'shipped' | 'delivered' | 'rejected';

/** The customer's timeline step at each stage (order namespace, en). */
const CUSTOMER_STEP: Record<Exclude<Stage, 'offered' | 'rejected'>, RegExp> = {
  routing: /Confirming availability/,
  confirmed: /Confirmed .* will be shipped/,
  packed: /Packed/,
  shipped: /Out for delivery/,
  delivered: /Delivered/,
};

async function signIn(page: Page, phone: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (phone === ADMIN) {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
  await expect(page).not.toHaveURL(/\/login/);
}

/** Sign-out lives on the account profile and the portal pages: go there first. */
async function signOut(page: Page, phone: string) {
  await page.goto(phone === CUSTOMER ? '/account/profile' : phone === ADMIN ? '/admin' : '/partner/shop');
  await page.locator('[data-track="header_account"]').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0);
}

/** Opens a page the way a person would land on it and checks it rendered cleanly. */
async function visit(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('main h1').first(), `${path}: heading`).toBeVisible();
  await expect(page.locator('.skeleton'), `${path}: still loading`).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${path}: scrolls sideways`).toBeLessThanOrEqual(0);
}

const card = (page: Page, code: string) => page.locator('article').filter({ hasText: code });
const codeBox = (page: Page) => page.getByRole('region', { name: /Your delivery code/ });

async function customerTour(page: Page, code: string, stage: Stage) {
  await signIn(page, CUSTOMER);
  for (const path of ['/', '/shop', '/workshops', '/cart', '/account']) await visit(page, path);

  await visit(page, '/account/orders');
  await expect(page.getByText(code).first(), 'the order is in the account list').toBeVisible();

  await visit(page, `/orders/${code}`);
  if (stage === 'rejected') {
    await expect(page.getByText('We could not fulfil this order')).toBeVisible();
  } else {
    const step = CUSTOMER_STEP[stage === 'offered' ? 'routing' : stage];
    await expect(page.locator('[aria-current="step"]')).toContainText(step);
  }
  // The code is the customer's, and only while the order is out for delivery.
  await expect(codeBox(page)).toHaveCount(stage === 'shipped' ? 1 : 0);
  if (stage === 'delivered') await expect(page.getByText(/confirmed with your delivery code/)).toBeVisible();
  await signOut(page, CUSTOMER);
}

async function shopTour(page: Page, code: string, stage: Stage) {
  await signIn(page, SHOP);
  await visit(page, '/partner/shop');
  const mine = card(page, code);
  switch (stage) {
    case 'routing':
    case 'rejected':
      // Not offered to this shop (yet, or ever): it never sees the order.
      await expect(mine).toHaveCount(0);
      break;
    case 'offered':
      await expect(mine.getByText(/min left to accept/)).toBeVisible();
      await expect(mine.getByRole('button', { name: /Accept order/ })).toBeVisible();
      break;
    case 'confirmed':
      await expect(mine.getByText(/Confirmed .* will be shipped/)).toBeVisible();
      await expect(mine.getByRole('button', { name: 'Mark packed' })).toBeVisible();
      break;
    case 'packed':
      await expect(mine.getByRole('button', { name: 'Mark out for delivery' })).toBeVisible();
      break;
    case 'shipped':
      await expect(mine.getByLabel("Customer's delivery code")).toBeVisible();
      break;
    case 'delivered':
      await expect(mine.getByRole('button')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /^Delivered/ })).toBeVisible();
      await expect(page.getByText(code).first()).toBeVisible();
      break;
  }
  if (stage !== 'routing' && stage !== 'rejected') {
    await visit(page, `/orders/${code}`);
    await expect(codeBox(page), 'the shop never sees the delivery code').toHaveCount(0);
  }
  await visit(page, '/');
  await signOut(page, SHOP);
}

async function adminTour(page: Page, code: string, stage: Stage) {
  await signIn(page, ADMIN);
  await visit(page, '/admin');
  await visit(page, '/admin/orders');
  const c = card(page, code);
  await expect(c).toHaveCount(1);
  const route = c.getByRole('button', { name: `Route to ${SHOP_NAME}` });
  const override = c.getByRole('button', { name: 'Confirm delivery without the code' });
  switch (stage) {
    case 'routing':
      await expect(route).toBeVisible();
      break;
    case 'offered':
      await expect(c.getByText(`Offered to ${SHOP_NAME}`, { exact: false })).toBeVisible();
      await expect(route).toHaveCount(0);
      break;
    case 'confirmed':
    case 'packed':
      await expect(c.getByText(`Accepted by ${SHOP_NAME}`)).toBeVisible();
      await expect(override).toHaveCount(0);
      break;
    case 'shipped':
      await expect(override).toBeVisible();
      break;
    case 'delivered':
      await expect(override).toHaveCount(0);
      break;
    case 'rejected':
      await expect(c.getByText(/Rejected: Sorry/)).toBeVisible();
      await expect(route).toHaveCount(0);
      break;
  }
  await visit(page, `/orders/${code}`);
  await expect(codeBox(page), 'staff never see the delivery code').toHaveCount(0);
  await visit(page, '/admin/services');
  await signOut(page, ADMIN);
}

async function everyoneTours(page: Page, code: string, stage: Stage) {
  await test.step(`${stage}: customer`, () => customerTour(page, code, stage));
  await test.step(`${stage}: shop`, () => shopTour(page, code, stage));
  await test.step(`${stage}: admin`, () => adminTour(page, code, stage));
}

/** A guest order for the demo customer's phone, so their account lists it. */
async function placeOrder(page: Page): Promise<string> {
  await page.goto('/shop/exide-xltz4a-2w-battery');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.goto('/checkout');
  await page.getByLabel('Full name').fill('Ravi Sahu');
  await page.getByLabel('Mobile number').fill(CUSTOMER);
  await page.getByLabel('Delivery address').fill('C-605 Salasar Greens, Sarona, Raipur');
  await page.getByLabel('PIN code').fill('492099');
  await page.getByLabel(/I agree to share/).check();
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page).toHaveURL(/\/orders\/MD-RPR-/);
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

async function asRole(page: Page, phone: string, path: string, act: () => Promise<void>) {
  await signIn(page, phone);
  await page.goto(path);
  await act();
  await signOut(page, phone);
}

test.describe('order lifecycle, navigated by every role', () => {
  test.describe.configure({ timeout: 300_000 });
  const errors: string[] = [];
  test.beforeEach(({ page }) => {
    errors.length = 0;
    page.on('pageerror', (e) => errors.push(e.message));
  });
  test.afterEach(() => {
    expect(errors, 'uncaught page errors').toEqual([]);
  });

  test('placed → offered → accepted → packed → out for delivery → delivered', async ({ page }) => {
    const code = await placeOrder(page);
    await everyoneTours(page, code, 'routing');

    await asRole(page, ADMIN, '/admin/orders', async () => {
      await card(page, code)
        .getByRole('button', { name: `Route to ${SHOP_NAME}` })
        .click();
      await expect(card(page, code).getByText(`Offered to ${SHOP_NAME}`, { exact: false })).toBeVisible();
    });
    await everyoneTours(page, code, 'offered');

    await asRole(page, SHOP, '/partner/shop', async () => {
      await card(page, code)
        .getByRole('button', { name: /Accept order/ })
        .click();
      await expect(card(page, code).getByRole('button', { name: 'Mark packed' })).toBeVisible();
    });
    await everyoneTours(page, code, 'confirmed');

    await asRole(page, SHOP, '/partner/shop', async () => {
      await card(page, code).getByRole('button', { name: 'Mark packed' }).click();
      await expect(card(page, code).getByRole('button', { name: 'Mark out for delivery' })).toBeVisible();
    });
    await everyoneTours(page, code, 'packed');

    await asRole(page, SHOP, '/partner/shop', async () => {
      await card(page, code).getByRole('button', { name: 'Mark out for delivery' }).click();
      await expect(card(page, code).getByLabel("Customer's delivery code")).toBeVisible();
    });
    await everyoneTours(page, code, 'shipped');

    // The customer reads the code out; the shop types it in.
    await signIn(page, CUSTOMER);
    await page.goto(`/orders/${code}`);
    const deliveryCode = (await codeBox(page).locator('p').first().innerText()).trim();
    expect(deliveryCode).toMatch(/^\d{4}$/);
    await signOut(page, CUSTOMER);
    await asRole(page, SHOP, '/partner/shop', async () => {
      await card(page, code).getByLabel("Customer's delivery code").fill(deliveryCode);
      await card(page, code).getByRole('button', { name: 'Confirm delivery' }).click();
      await expect(card(page, code).getByRole('button', { name: 'Confirm delivery' })).toHaveCount(0);
    });
    await everyoneTours(page, code, 'delivered');
  });

  test('declined by one shop, then rejected with a message: every role sees the same outcome', async ({
    page,
  }) => {
    const code = await placeOrder(page);
    await asRole(page, ADMIN, '/admin/orders', async () => {
      await card(page, code).getByRole('button', { name: 'Route to Raipur Battery Point' }).click();
    });
    await asRole(page, OTHER_SHOP, '/partner/shop', async () => {
      const offered = card(page, code);
      await offered.getByRole('button', { name: 'Decline' }).click();
      await offered.getByLabel('Reason').selectOption('out_of_stock');
      await offered.getByRole('button', { name: 'Decline' }).click();
      await expect(card(page, code)).toHaveCount(0);
    });
    // Back with MechDost: for everyone it is "confirming with a shop" again, and Sharma never saw it.
    await everyoneTours(page, code, 'routing');

    await asRole(page, ADMIN, '/admin/orders', async () => {
      const c = card(page, code);
      await expect(c.getByText('Declined by Raipur Battery Point: out of stock')).toBeVisible();
      await c.getByRole('button', { name: 'Reject with a message' }).click();
      await c
        .getByLabel('Message to the customer')
        .fill('Sorry, this battery is out of stock across Raipur.');
      await c.getByLabel('Reason', { exact: true }).selectOption('no_stock_nearby');
      await c.getByRole('button', { name: 'Reject order' }).click();
      await expect(c.getByText(/Rejected: Sorry/)).toBeVisible();
    });
    await everyoneTours(page, code, 'rejected');
  });
});
