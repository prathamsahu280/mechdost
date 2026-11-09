import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = 'Raipur@2026';
const STAFF = new Set(['9000000003']);

/**
 * Demo sign-in (spec 01, decision 2026-11-01): phone or email + password; staff also enter the code sent to
 * their phone. Lands on the role's home unless `next` says otherwise.
 */
async function signIn(page: Page, phone: string, path = '/login', password = DEMO_PASSWORD) {
  await page.goto(path);
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (STAFF.has(phone)) {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).first().click();
}

async function placeOrder(page: Page): Promise<string> {
  await page.goto('/shop/exide-xltz4a-2w-battery');
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.goto('/checkout');
  await page.getByLabel('Full name').fill('Ravi Sahu');
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByLabel('Delivery address').fill('C-605 Salasar Greens, Sarona, Raipur');
  await page.getByLabel('PIN code').fill('492099');
  await page.getByLabel(/I agree to share/).check();
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page).toHaveURL(/\/orders\/MD-RPR-/);
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

test.describe('sign-in (spec 01: phone OTP once, then password)', () => {
  const generic = "That mobile number or email and password don't match. Check them and try again.";

  test('signs in with phone or email and password; wrong details get one generic message', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Enter your mobile number or email.')).toBeVisible();
    await expect(page.getByLabel('Mobile number or email')).toBeFocused();

    // Demo chips fill the number and the demo password.
    await page.getByRole('button', { name: /Customer/ }).click();
    await expect(page.getByLabel('Mobile number or email')).toHaveValue('9876543210');
    await page.getByLabel('Password', { exact: true }).fill('wrong password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText(generic)).toBeVisible();
    // An account that does not exist gets exactly the same answer (no account enumeration).
    await page.getByLabel('Mobile number or email').fill('nobody@example.com');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText(generic)).toBeVisible();
    // The message is still on screen from the first try: wait for this attempt to finish (the button is
    // disabled while the password is checked), or the next fill races the late result.
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();

    // Show/hide works, then the email + password sign-in succeeds.
    await page.getByLabel('Mobile number or email').fill('Ravi.Sahu@example.com');
    await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { name: 'Hello, Ravi Sahu' })).toBeVisible();
    if ((page.viewportSize()?.width ?? 0) >= 420) {
      await expect(page.getByRole('link', { name: /Ravi\s*,\s*Account/ })).toBeVisible();
    }
  });

  test('locks an account for 15 minutes after 5 wrong passwords', async ({ page }) => {
    await page.goto('/login');
    for (let i = 0; i < 5; i++) {
      await page.getByLabel('Mobile number or email').fill('9000000001');
      await page.getByLabel('Password', { exact: true }).fill(`wrong-${String(i)}-password`);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      // Shown next to the field (and, for the lock, also read out by the alert region: hence first()).
      await expect(page.getByText(/match|Too many/).first()).toBeVisible();
    }
    await expect(page.getByText(/Too many attempts. Try again in 15 minutes/).first()).toBeVisible();
    // Even the right password is refused while locked.
    await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText(/Too many attempts/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a new customer signs up with phone → code → name, email and a checked password', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Mobile number').fill('12345');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('Enter a 10-digit Indian mobile number.')).toBeVisible();
    await page.getByLabel('Mobile number').fill('9123456780');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('Sent by SMS to +91 9123456780.')).toBeVisible();
    await expect(page.getByText(/Resend in \d+s/)).toBeVisible();
    await page.getByLabel('One-time code').fill('111111');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(page.getByText('That code is not right.', { exact: false })).toBeVisible();
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();

    await expect(page.getByRole('heading', { name: 'Almost done' })).toBeVisible();
    await page.getByLabel('Full name').fill('Neha Gupta');
    await page.getByLabel('Email', { exact: true }).fill('neha@example.com');
    const create = page.getByLabel('Create password', { exact: true });
    const confirm = page.getByLabel('Confirm password', { exact: true });
    await create.fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
    await create.fill('password123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('This password is too common.', { exact: false })).toBeVisible();
    await create.fill('9123456780neha');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(
      page.getByText("Don't use your name, phone number or email in your password."),
    ).toBeVisible();
    await create.fill('my bike is blue');
    await confirm.fill('my bike is red');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText("The passwords don't match.")).toBeVisible();
    await confirm.fill('my bike is blue');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Hello, Neha Gupta' })).toBeVisible();

    // The password is never stored in plain text; next time email + password signs in.
    const stored = await page.evaluate(() => localStorage.getItem('mechdost-demo-accounts') ?? '');
    expect(stored).not.toContain('my bike is blue');
    await page.goto('/account/profile');
    await signOut(page);
    await signIn(page, 'neha@example.com', '/login', 'my bike is blue');
    await expect(page.getByRole('heading', { name: 'Hello, Neha Gupta' })).toBeVisible();
  });

  test('an existing number on sign-up is sent to sign in instead', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(page.getByText('This number already has an account.', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Mobile number or email')).toHaveValue('9876543210');
  });

  test('forgot password by phone code: the new password works, the old one does not', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByRole('button', { name: /Send a code to my phone/ }).click();
    await page.getByLabel('Mobile number').fill('9000000002');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('One-time code').fill('123456');
    await page.getByLabel('Create password', { exact: true }).fill('workshop opens at nine');
    await page.getByLabel('Confirm password', { exact: true }).fill('workshop opens at nine');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page).toHaveURL(/\/partner\/workshop$/);
    await signOut(page);
    await signIn(page, '9000000002');
    await expect(page.getByText(generic)).toBeVisible();
    await signIn(page, '9000000002', '/login', 'workshop opens at nine');
    await expect(page).toHaveURL(/\/partner\/workshop$/);
  });

  test('forgot password by email link: generic message, then a new password', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByRole('button', { name: /Email me a reset link/ }).click();
    await page.getByLabel('Email', { exact: true }).fill('orders@sharmaautoparts.example');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(
      page.getByText(/If an account uses orders@sharmaautoparts.example, we've sent a link/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Open the reset link' }).click();
    await page.getByLabel('Create password', { exact: true }).fill('sharma spares since 1998');
    await page.getByLabel('Confirm password', { exact: true }).fill('sharma spares since 1998');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByText('Password changed. Sign in with your new password.')).toBeVisible();
    await expect(page.getByLabel('Mobile number or email')).toHaveValue('orders@sharmaautoparts.example');
    await page.getByLabel('Password', { exact: true }).fill('sharma spares since 1998');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/partner\/shop$/);
  });

  test('staff sign-in needs the password and a code to their phone', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Mobile number or email').fill('9000000003');
    await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    await page.getByLabel('One-time code').fill('000000');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(page.getByText('That code is not right.', { exact: false })).toBeVisible();
    // No session yet: the console stays locked (the guard asks to sign in; no admin data shows).
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await expect(page.getByText('Orders to route')).toBeHidden();
    await signIn(page, '9000000003');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('only a safe same-site "next" is followed after sign-in', async ({ page }) => {
    await signIn(page, '9876543210', '/login?next=%2Fcart');
    await expect(page).toHaveURL(/\/cart$/);
    await page.goto('/account/profile');
    await signOut(page);
    await signIn(page, '9876543210', '/login?next=https%3A%2F%2Fevil.example');
    await expect(page).toHaveURL(/\/account$/);
  });
});

test.describe('account (spec 01)', () => {
  test('vehicles and addresses can be added, made default and removed', async ({ page }) => {
    await signIn(page, '9876543210');
    await page
      .getByRole('link', { name: /My vehicles/ })
      .first()
      .click();
    await expect(page.getByText('Honda Activa 6G')).toBeVisible();
    await page.getByRole('button', { name: /Add a vehicle/ }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Fill in make, model and a year/)).toBeVisible();
    await page.getByText('Car / SUV').click();
    await page.getByLabel('Make').fill('Tata');
    await page.getByLabel('Model').fill('Nexon EV');
    await page.getByLabel('Year').fill('2024');
    await page.getByLabel('Fuel').selectOption('ev');
    await page.getByLabel(/Registration number/).fill('cg04 ev 1234');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Tata Nexon EV')).toBeVisible();
    await expect(page.getByText(/CG04 EV 1234/)).toBeVisible();
    await page.getByRole('button', { name: 'Remove Tata Nexon EV' }).click();
    await expect(page.getByText('Tata Nexon EV')).toHaveCount(0);

    await page
      .getByRole('link', { name: /Addresses/ })
      .first()
      .click();
    await page.getByRole('button', { name: /Add an address/ }).click();
    await page.getByLabel('Label').fill('Shop');
    await page.getByLabel('PIN code').fill('492001');
    await page.getByLabel('House, building, street').fill('12 Station Road, Pandri');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('12 Station Road, Pandri')).toBeVisible();
    await page.getByRole('button', { name: 'Make default' }).click();
    await expect(page.getByRole('button', { name: 'Make default' })).toHaveCount(1); // now on "Home"

    await page
      .getByRole('link', { name: /Profile/ })
      .first()
      .click();
    await page.getByLabel('Full name').fill('Ravi K. Sahu');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page
      .getByRole('link', { name: /Overview/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Hello, Ravi K. Sahu' })).toBeVisible();
  });
});

test.describe('order routing across roles (spec 04)', () => {
  test('customer orders → admin routes → shop declines → admin reroutes → shop accepts → customer sees it', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const code = await placeOrder(page);
    await expect(page.getByText('Confirming with a nearby shop').first()).toBeVisible();

    // Admin: the order waits in "Needs routing" with ranked shop suggestions.
    await signIn(page, '9000000003');
    await expect(page).toHaveURL(/\/admin$/);
    await page
      .getByRole('link', { name: /Order routing/ })
      .first()
      .click();
    const card = page.locator('article').filter({ hasText: code });
    await expect(card.getByText('Recommended')).toBeVisible();
    await card.getByRole('button', { name: 'Route to Raipur Battery Point' }).click();
    await expect(card.getByText(/Offered to Raipur Battery Point/)).toBeVisible();

    // The offered shop declines with a reason → the order goes back to admin.
    await signOut(page);
    await signIn(page, '9000000001'); // Sharma Auto Parts was not offered this order: it sees nothing
    await expect(page.locator('article').filter({ hasText: code })).toHaveCount(0);
    await signOut(page);
    await signIn(page, '9000000004'); // Raipur Battery Point
    const offered = page.locator('article').filter({ hasText: code });
    await offered.getByRole('button', { name: 'Decline' }).click();
    await offered.getByLabel('Reason').selectOption('out_of_stock');
    await offered.getByRole('button', { name: 'Decline' }).click();
    await expect(page.locator('article').filter({ hasText: code })).toHaveCount(0);
    await signOut(page);

    await signIn(page, '9000000003', '/login?next=%2Fadmin%2Forders');
    const rerouted = page.locator('article').filter({ hasText: code });
    await expect(rerouted.getByText('Declined by Raipur Battery Point: out of stock')).toBeVisible();
    await expect(rerouted.getByRole('button', { name: 'Route to Raipur Battery Point' })).toHaveCount(0);
    await rerouted.getByRole('button', { name: 'Route to Sharma Auto Parts' }).click();
    await signOut(page);

    // Shop accepts within the timer.
    await signIn(page, '9000000001');
    const offer = page.locator('article').filter({ hasText: code });
    await expect(offer.getByText(/min left to accept/)).toBeVisible();
    await offer.getByRole('button', { name: /Accept order/ }).click();
    const active = page.locator('article').filter({ hasText: code });
    await expect(active.getByText('Confirmed — will be shipped')).toBeVisible();
    await active.getByRole('button', { name: 'Mark packed' }).click();
    await expect(active.getByText('Packed')).toBeVisible();

    // Customer (and admin) see the confirmation.
    await page.goto(`/orders/${code}`);
    await expect(page.getByText('Fulfilled by Sharma Auto Parts')).toBeVisible();
    await expect(page.getByText('Packed').first()).toBeVisible();
  });

  test('admin can reject an order with a message the customer sees', async ({ page }) => {
    const code = await placeOrder(page);
    await signIn(page, '9000000003', '/login?next=%2Fadmin%2Forders');
    const card = page.locator('article').filter({ hasText: code });
    await card.getByRole('button', { name: 'Reject with a message' }).click();
    await card
      .getByLabel('Message to the customer')
      .fill('Sorry, this battery is out of stock across Raipur this week.');
    await card.getByRole('button', { name: 'Reject order' }).click();
    await expect(
      page
        .locator('article')
        .filter({ hasText: code })
        .getByText(/Rejected: Sorry/),
    ).toBeVisible();
    await page.goto(`/orders/${code}`);
    await expect(page.getByText('We could not fulfil this order')).toBeVisible();
    await expect(page.getByText('out of stock across Raipur this week')).toBeVisible();
  });

  test('portals refuse the wrong role', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('This area is for Admin accounts.')).toBeVisible();
    await signIn(page, '9876543210');
    await page.goto('/partner/shop');
    await expect(page.getByText('This area is for Shop owner accounts.')).toBeVisible();
  });
});

test.describe('service requests across roles (spec 06)', () => {
  test('workshop proposes slot and cost; the customer accepts it', async ({ page }) => {
    await page.goto('/workshops/telibandha-car-clinic');
    await page.getByLabel('Make and model').fill('Maruti Dzire');
    await page.getByLabel(/Periodic service/).check();
    await page.getByLabel('Your name').fill('Ravi Sahu');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page).toHaveURL(/\/service\/SR-RPR-/);
    const code = new URL(page.url()).pathname.split('/').at(-1) ?? '';

    await signIn(page, '9000000002');
    await expect(page).toHaveURL(/\/partner\/workshop$/);
    const request = page.locator('article').filter({ hasText: code });
    await request.getByLabel('From (₹)').fill('900');
    await request.getByLabel('Up to (₹)').fill('1400');
    await request.getByLabel(/Note to the customer/).fill('Includes a free wash');
    await request.getByRole('button', { name: 'Send proposal' }).click();
    await expect(page.getByRole('heading', { name: 'Waiting for the customer to accept' })).toBeVisible();

    await page.goto(`/service/${code}`);
    await expect(page.getByText(/expected ₹900 – ₹1,400/)).toBeVisible();
    await expect(page.getByText('Includes a free wash', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Accept proposal' }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText('Appointment confirmed');
  });
});

test.describe('signed-in areas: accessibility and layout', () => {
  const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  for (const [phone, paths] of [
    ['9876543210', ['/account', '/account/vehicles', '/account/addresses', '/account/profile']],
    ['9000000003', ['/admin', '/admin/orders', '/admin/quotes', '/admin/reviews']],
    ['9000000001', ['/partner/shop']],
    ['9000000002', ['/partner/workshop']],
  ] as const) {
    test(`no WCAG 2.2 AA violations or horizontal scroll for ${phone}`, async ({ page }) => {
      await placeOrder(page); // gives every area something to show
      await signIn(page, phone);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const path of paths) {
        await page.goto(path);
        await expect(page.locator('main h1')).toBeVisible();
        await expect(page.locator('.skeleton')).toHaveCount(0);
        const violations = (await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map(
          (v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
        );
        expect(violations).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${path} overflow`).toBeLessThanOrEqual(0);
      }
    });
  }
});
