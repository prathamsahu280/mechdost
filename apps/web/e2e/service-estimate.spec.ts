import { expect, test, type Page } from '@playwright/test';

/**
 * Workshop estimates and bills in the demo (spec 06, user 2026-11-14: "add the service estimates and billing in
 * the demo too"): vehicle received with the odometer → itemised estimate → the customer approves or declines every
 * line with consent → only approved work is started and billed → bill = approved lines + GST + round-off → paid
 * at the workshop → the customer can rate the workshop. A revision clears earlier approvals; declining everything
 * ends with "no work approved". Demo data is per browser, so customer and workshop share one page.
 */

const WORKSHOP_PHONE = '9000000002'; // Telibandha Car Clinic (docs/runbooks/demo.md)

async function book(page: Page): Promise<string> {
  await page.goto('/workshops/telibandha-car-clinic');
  await page.getByLabel('Make and model').fill('Maruti Dzire');
  await page.getByLabel(/Periodic service/).check();
  await page.getByLabel('Your name').fill('Ravi Sahu');
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page).toHaveURL(/\/service\/SR-RPR-/);
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

async function signInWorkshop(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(WORKSHOP_PHONE);
  await page.getByLabel('Password', { exact: true }).fill('Raipur@2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/partner\/workshop$/);
}

const job = (page: Page, code: string) => page.locator('article').filter({ hasText: code });

/** Booked → proposed → accepted → vehicle received (odometer) → the estimate builder is open. */
async function toEstimateBuilder(page: Page): Promise<string> {
  const code = await book(page);
  await signInWorkshop(page);
  await job(page, code).getByRole('button', { name: 'Send proposal' }).click();
  await page.goto(`/service/${code}`);
  await page.getByRole('button', { name: 'Accept proposal' }).click();
  await page.goto('/partner/workshop');
  const card = job(page, code);
  await card.getByLabel('Odometer (km)').fill('24500');
  await card.getByRole('button', { name: 'Vehicle received' }).click();
  await expect(card.getByRole('button', { name: 'Send estimate' })).toBeVisible();
  return code;
}

/** Line 1 comes prefilled from the requested service; this adds brake pads as line 2. */
async function sendTwoLineEstimate(page: Page, code: string) {
  const card = job(page, code);
  await expect(card.getByLabel('Line 1: description')).toHaveValue(/Periodic service/);
  await card.getByRole('button', { name: 'Add a line' }).click();
  await card.getByLabel('Line 2: description').fill('Brake pads (front)');
  await card.getByLabel('Line 2: quantity').fill('1');
  await card.getByLabel('Line 2: price (₹)').fill('1200');
  await card.getByLabel('Line 2: GST').selectOption('1800');
  await card.getByRole('button', { name: 'Send estimate' }).click();
  await expect(card.getByText('Waiting for the customer to approve')).toBeVisible();
}

test('the customer approves line by line; only approved work is billed, with GST and round-off', async ({
  page,
}) => {
  const code = await toEstimateBuilder(page);
  await sendTwoLineEstimate(page, code);

  await page.goto(`/service/${code}`);
  const estimate = page.getByRole('region', { name: /Review estimate v1/ });
  await expect(estimate).toBeVisible();
  // Nothing is chosen for the customer, and the form says what is missing.
  await estimate.getByRole('button', { name: 'Confirm my choices' }).click();
  await expect(estimate.getByText('Approve or decline every item.')).toBeVisible();
  await estimate
    .getByRole('group', { name: /Brake pads/ })
    .getByLabel('Approve')
    .check();
  await estimate
    .getByRole('group', { name: /Periodic service/ })
    .getByLabel('Decline')
    .check();
  await expect(estimate.getByText(/Approved total \(incl\. GST\): ₹1,416/)).toBeVisible();
  await estimate.getByRole('button', { name: 'Confirm my choices' }).click();
  await expect(estimate.getByText('Confirm your choices using the checkbox.')).toBeVisible();
  await estimate.getByLabel(/I authorise only the selected work/).check();
  await estimate.getByRole('button', { name: 'Confirm my choices' }).click();
  await expect(page.getByText('Selected work approved.')).toBeVisible();

  await page.goto('/partner/workshop');
  const card = job(page, code);
  await card.getByRole('button', { name: 'Start approved work' }).click();
  await card.getByRole('button', { name: 'Ready for pickup' }).click();
  await card.getByRole('button', { name: 'Create bill' }).click();
  await expect(card.getByText('Bill total: ₹1,416')).toBeVisible();
  await card.getByRole('button', { name: 'Mark paid at the workshop' }).click();
  await expect(card).toHaveCount(0); // finished jobs leave the active list
  await expect(page.getByRole('region', { name: /Completed/ }).getByText(code)).toBeVisible();

  await page.goto(`/service/${code}`);
  const bill = page.getByRole('region', { name: 'Bill' });
  await expect(bill.getByText('Brake pads (front)')).toBeVisible();
  await expect(bill.getByText(/Periodic service/)).toHaveCount(0); // declined: never billed
  await expect(bill.getByText('CGST 9%')).toBeVisible();
  await expect(bill.getByText('₹108.00').first()).toBeVisible();
  await expect(bill.getByText('₹1,416').last()).toBeVisible();
  await expect(bill.getByText(/Paid at the workshop on/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Rate Telibandha Car Clinic' })).toBeVisible();
  await expect(page.getByText('Odometer: 24,500 km')).toBeVisible();
});

test('revising the estimate clears the approvals and asks the customer again', async ({ page }) => {
  const code = await toEstimateBuilder(page);
  await sendTwoLineEstimate(page, code);
  await page.goto(`/service/${code}`);
  const v1 = page.getByRole('region', { name: /Review estimate v1/ });
  await v1
    .getByRole('group', { name: /Brake pads/ })
    .getByLabel('Approve')
    .check();
  await v1
    .getByRole('group', { name: /Periodic service/ })
    .getByLabel('Approve')
    .check();
  await v1.getByLabel(/I authorise only the selected work/).check();
  await v1.getByRole('button', { name: 'Confirm my choices' }).click();
  await expect(page.getByText('Selected work approved.')).toBeVisible();

  // Extra work found: the workshop sends version 2.
  await page.goto('/partner/workshop');
  const card = job(page, code);
  await card.getByRole('button', { name: 'Revise estimate' }).click();
  await card.getByRole('button', { name: 'Add a line' }).click();
  await card.getByLabel('Line 3: description').fill('Brake disc skimming');
  await card.getByLabel('Line 3: price (₹)').fill('450');
  await card.getByRole('button', { name: 'Send estimate' }).click();
  await expect(card.getByRole('button', { name: 'Start approved work' })).toHaveCount(0);

  await page.goto(`/service/${code}`);
  const v2 = page.getByRole('region', { name: /Review estimate v2/ });
  await expect(v2.getByText(/The workshop revised the estimate/)).toBeVisible();
  await expect(v2.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(v2.getByRole('group')).toHaveCount(3);
});

test('declining every line ends with no work approved; the workshop returns the vehicle', async ({
  page,
}) => {
  const code = await toEstimateBuilder(page);
  await sendTwoLineEstimate(page, code);
  await page.goto(`/service/${code}`);
  const estimate = page.getByRole('region', { name: /Review estimate v1/ });
  for (const g of await estimate.getByRole('group').all()) await g.getByLabel('Decline').check();
  await estimate.getByLabel(/I authorise only the selected work/).check();
  await estimate.getByRole('button', { name: 'Confirm my choices' }).click();
  await expect(page.getByText('No work approved', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Nothing is charged/)).toBeVisible();

  await page.goto('/partner/workshop');
  const card = job(page, code);
  await expect(card.getByText('No work approved')).toBeVisible();
  await card.getByRole('button', { name: 'Vehicle returned' }).click();
  await expect(card).toHaveCount(0);
});

test('the workshop must enter a valid odometer reading and valid lines', async ({ page }) => {
  const code = await book(page);
  await signInWorkshop(page);
  await job(page, code).getByRole('button', { name: 'Send proposal' }).click();
  await page.goto(`/service/${code}`);
  await page.getByRole('button', { name: 'Accept proposal' }).click();
  await page.goto('/partner/workshop');
  const card = job(page, code);
  await card.getByRole('button', { name: 'Vehicle received' }).click();
  await expect(card.getByText('Enter the odometer reading in km.')).toBeVisible();
  await card.getByLabel('Odometer (km)').fill('31000');
  await card.getByRole('button', { name: 'Vehicle received' }).click();
  await card.getByLabel('Line 1: price (₹)').fill('0');
  await card.getByRole('button', { name: 'Send estimate' }).click();
  await expect(card.getByText(/Enter a price above ₹0/)).toBeVisible();
  await expect(card.getByLabel('Line 1: price (₹)')).toBeFocused();
});

test('the demo control fills in a sample estimate from the requested services', async ({ page }) => {
  const code = await book(page);
  const controls = page.getByText('Demo controls');
  const advance = page.getByRole('button', { name: 'Simulate next update' });
  await controls.click();
  await advance.click(); // the workshop proposes
  await page.getByRole('button', { name: 'Accept proposal' }).click();
  await controls.click();
  await advance.click(); // vehicle received
  await advance.click(); // estimate sent
  const estimate = page.getByRole('region', { name: /Review estimate v1/ });
  await expect(estimate.getByRole('group', { name: /Periodic service/ })).toBeVisible();
  // The customer's own decision is never simulated.
  await expect(page.getByRole('button', { name: 'Simulate next update' })).toHaveCount(0);
  expect(code).toMatch(/^SR-RPR-/);
});

test('the Hindi estimate and bill are in Hindi', async ({ page }) => {
  const code = await toEstimateBuilder(page);
  await sendTwoLineEstimate(page, code);
  await page.goto(`/hi/service/${code}`);
  await expect(page.getByRole('button', { name: 'मेरी पसंद पक्की करें' })).toBeVisible();
});
