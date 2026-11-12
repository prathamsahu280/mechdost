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
