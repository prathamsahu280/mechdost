import { expect, test, type Page } from '@playwright/test';

/**
 * Roadside help in the browser demo (spec 22): the customer asks for help (2W and 4W only, "I don't know what's wrong"
 * is a choice), pays the advance, admin sends the request to a workshop, the workshop accepts, enters the customer's
 * arrival code, starts and bills, and the customer sees the total, the advance and what is left. The demo keeps one
 * sample request in this browser, shared by the three roles.
 */
const DEMO_PASSWORD = 'Raipur@2026';
const ARRIVAL_CODE = '4821';

async function signIn(page: Page, phone: string, next: string, staff = false) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (staff) {
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
  }
}

test('a customer asks for roadside help and follows it to the bill', async ({ page }) => {
  await signIn(page, '9000000004', '/roadside');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Stuck on the road');
  await page.getByLabel('PIN code').fill('492001');
  // 2W and 4W only: no three-wheeler is offered.
  await expect(page.getByLabel('Bike / scooter')).toBeVisible();
  await expect(page.getByLabel(/Three-wheeler|Auto-rickshaw|3W/)).toHaveCount(0);
  await page.getByLabel('Bike / scooter').check();
  await page.getByLabel("I don't know what's wrong").check();
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByText(/advance of ₹500 now/)).toBeVisible();
  await page.getByRole('button', { name: /Pay advance ₹500/ }).click();
  await expect(page).toHaveURL(/\/roadside\/RSA-RPR-/);
  await expect(page.getByRole('heading', { name: 'Finding a mechanic' })).toBeVisible();

  // Admin sends it to the nearest workshop.
  await page.goto('/login');
  await signIn(page, '9000000003', '/admin/roadside', true);
  await page.getByRole('button', { name: 'Manage' }).click();
  await page.getByRole('button', { name: 'Send offer' }).first().click();

  // The workshop accepts, enters the customer's code, starts and bills.
  await signIn(page, '9000000002', '/partner/workshop');
  await page.getByRole('button', { name: 'Accept' }).click();
  await page.getByLabel("Customer's arrival code").fill(ARRIVAL_CODE);
  await page.getByRole('button', { name: 'I have arrived' }).click();
  await page.getByRole('button', { name: 'Start work' }).click();
  await page.getByLabel('Work or part').fill('Jump start');
  await page.getByLabel('Price (rupees)').fill('1800');
  await page.getByRole('button', { name: 'Send bill' }).click();

  // The customer sees the total, the advance already paid and what is left.
  await signIn(page, '9000000004', '/roadside');
  await page.goto('/account');
  await page.goBack();
  await expect(page.getByText('₹1,800').first()).toBeVisible();
  await expect(page.getByText('Left to pay')).toBeVisible();
  await expect(page.getByText('₹1,300').first()).toBeVisible();
});

test('the Hindi request page asks for a PIN code and names the choices in Hindi', async ({ page }) => {
  await signIn(page, '9000000004', '/hi/roadside');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('सड़क पर फँस गए');
  await page.getByLabel('पिन कोड').fill('492001');
  await expect(page.getByLabel('मुझे नहीं पता क्या खराबी है')).toBeVisible();
});

test('a PIN code outside the area gets a calm message and a call button', async ({ page }) => {
  await signIn(page, '9000000004', '/roadside');
  await page.getByLabel('PIN code').fill('110001');
  await expect(page.getByText(/does not cover this area yet/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Call MechDost' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review' })).toBeDisabled();
});
