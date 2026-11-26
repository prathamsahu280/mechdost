import { expect, test, type Page } from '@playwright/test';
import {
  CUSTOMER_DELIVERY_CODE,
  DELIVERY_CODES,
  DELIVERY_JOB_IDS,
  PICKUP_CODE_READY,
  deliveryWorld,
} from './fixtures/delivery-world';

/**
 * Delivery agents in the browser demo (spec 24): the agent's happy path (offer → accept → shop code + photo →
 * customer revealed → customer code + photo), a failed delivery returned to the shop with the agent's return code,
 * admin assignment and offer expiry, the shop's ready-for-pickup and "deliver ourselves" request, the customer's view
 * (never the shop or the agent's phone) and the role leak (another agent's job is not shown). Roles are switched by
 * writing the demo session (sign-in itself is covered by roles.spec.ts).
 */

/** A 1×1 PNG: the camera input gets a real image, which the page shrinks and re-encodes. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function seed(page: Page) {
  const world = deliveryWorld(Date.now());
  await page.addInitScript((data: Record<string, unknown>) => {
    if (window.sessionStorage.getItem('delivery-seeded')) return;
    window.sessionStorage.setItem('delivery-seeded', '1');
    for (const [key, value] of Object.entries(data)) window.localStorage.setItem(key, JSON.stringify(value));
  }, world);
}

/** Switches the demo session to a seeded account and opens `path`. */
async function as(page: Page, accountId: string, path: string) {
  await page.evaluate((id) => {
    window.localStorage.setItem(
      'mechdost-demo-session',
      JSON.stringify([{ accountId: id, signedInAt: new Date().toISOString() }]),
    );
  }, accountId);
  await page.goto(path);
}

async function start(page: Page) {
  await seed(page);
  await page.goto('/');
}

const desktopOnly = (name: string) =>
  test.skip(name === 'mobile', 'agent portal runs on both; the rest desktop');

test.describe('delivery agents (demo)', () => {
  test('agent happy path: accept, pick up with the shop code, deliver with the customer code', async ({
    page,
  }) => {
    await start(page);
    await as(page, 'demo-admin', '/admin/delivery');
    const row = page.getByRole('row', { name: new RegExp(DELIVERY_CODES.ready) });
    await row.getByRole('button', { name: 'Open' }).click();
    await page.getByRole('button', { name: 'Offer to Sunil Yadav' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Offered to Sunil Yadav.' })).toBeVisible();

    await as(page, 'demo-agent', '/partner/delivery');
    const offer = page.locator('article').filter({ hasText: DELIVERY_CODES.ready });
    await expect(offer).toContainText('left');
    await expect(offer).toContainText('Drop at PIN 492099');
    // Before pickup: no customer name or phone anywhere on the offer.
    await expect(offer).not.toContainText('Ravi Sahu');
    await offer.getByRole('button', { name: 'Accept' }).click();
    await expect(page).toHaveURL(new RegExp(`/partner/delivery/jobs/${DELIVERY_JOB_IDS.ready}`));
    await expect(page.getByRole('heading', { name: 'Go to the shop' })).toBeVisible();
    await expect(page.getByText('Gupta Lubes & Spares')).toBeVisible();
    await expect(page.getByText('Name, address and phone show after pickup.')).toBeVisible();
    await page.getByRole('button', { name: "I'm at the shop" }).click();
    await expect(page.getByRole('heading', { name: 'Pick up' })).toBeVisible();

    // The photo is required: the code alone is refused.
    await page.getByLabel("Shop's pickup code").fill(PICKUP_CODE_READY);
    await expect(page.getByRole('alert')).toContainText('Take a photo first.');
    await page.locator(`#pickup-photo-${DELIVERY_JOB_IDS.ready}`).setInputFiles({
      name: 'parcel.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByText('Photo ready')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm pickup' }).click();
    await expect(page.getByRole('heading', { name: 'Go to the customer' })).toBeVisible();
    await expect(page.getByText('Ravi Sahu')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Call the customer' })).toHaveAttribute(
      'href',
      'tel:+919876543210',
    );

    const code = await page.evaluate((orderCode) => {
      const orders = JSON.parse(window.localStorage.getItem('mechdost-demo-orders') ?? '[]') as {
        code: string;
        delivery?: { code: string } | null;
      }[];
      return orders.find((o) => o.code === orderCode)?.delivery?.code ?? '';
    }, DELIVERY_CODES.ready);
    expect(code).toMatch(/^\d{4}$/);
    await page.getByRole('button', { name: "I'm at the customer" }).click();
    await page.locator(`#delivery-photo-${DELIVERY_JOB_IDS.ready}`).setInputFiles({
      name: 'handover.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByText('Photo ready')).toBeVisible();
    const wrong = code === '0000' ? '1111' : '0000';
    await page.getByLabel("Customer's delivery code").fill(wrong);
    await expect(page.getByRole('alert')).toContainText('4 tries left');
    await page.getByLabel("Customer's delivery code").fill(code);
    await expect(page.getByText('Delivered. Thank you!')).toBeVisible();
    // Delivered: the customer's details are gone from the agent's screen.
    await expect(page.getByText('C-605 Salasar Greens')).toHaveCount(0);
  });

  test('role leak: another agent cannot open the job', async ({ page }) => {
    await start(page);
    await as(page, 'demo-agent-2', `/partner/delivery/jobs/${DELIVERY_JOB_IDS.pickedUp}`);
    await expect(page.getByText('This job is not available to you.')).toBeVisible();
    await expect(page.getByText('Ravi Sahu')).toHaveCount(0);
    await expect(page.getByText('C-605')).toHaveCount(0);
    await as(page, 'demo-agent-2', '/partner/delivery/jobs');
    await expect(page.getByText(DELIVERY_CODES.pickedUp)).toHaveCount(0);
  });

  test('failed delivery → back to the shop with the return code → customer sees the refund', async ({
    page,
  }, info) => {
    desktopOnly(info.project.name);
    await start(page);
    await as(page, 'demo-agent', `/partner/delivery/jobs/${DELIVERY_JOB_IDS.pickedUp}`);
    await page.getByRole('button', { name: "Couldn't deliver" }).click();
    await page.getByRole('button', { name: 'Report' }).click();
    await expect(page.getByText('Choose a reason.')).toBeVisible();
    await page.getByLabel('Customer refused the parcel').check();
    await page.locator(`#fail-${DELIVERY_JOB_IDS.pickedUp}-photo`).setInputFiles({
      name: 'door.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByText('Photo ready')).toBeVisible();
    await page.getByRole('button', { name: 'Report' }).click();
    await expect(page.getByText(/Reported\. MechDost tells you/)).toBeVisible();

    await as(page, 'demo-admin', '/admin/delivery');
    await page.getByRole('button', { name: 'Failed', exact: true }).click();
    await page
      .getByRole('row', { name: new RegExp(DELIVERY_CODES.pickedUp) })
      .getByRole('button', { name: 'Open' })
      .click();
    await expect(page.getByText('Failed: Customer refused the parcel')).toBeVisible();
    await page.getByRole('button', { name: 'Send it back to the shop' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Decision saved.' })).toBeVisible();

    await as(page, 'demo-agent', `/partner/delivery/jobs/${DELIVERY_JOB_IDS.pickedUp}`);
    await expect(page.getByRole('heading', { name: 'Bring it back to the shop' })).toBeVisible();
    const returnCode = (await page.locator('#return-code-title + p').textContent())?.trim() ?? '';
    expect(returnCode).toMatch(/^\d{4}$/);
    await expect(page.getByText('Ravi Sahu')).toHaveCount(0);

    await as(page, 'demo-shop-3', '/partner/shop');
    const card = page.locator('article').filter({ hasText: DELIVERY_CODES.pickedUp });
    await expect(card.getByText('Parcel coming back')).toBeVisible();
    await card.getByLabel("Delivery partner's return code").fill(returnCode);
    await expect(page.locator('article').filter({ hasText: DELIVERY_CODES.pickedUp })).toHaveCount(0);

    await as(page, 'demo-customer', `/orders/${DELIVERY_CODES.pickedUp}`);
    await expect(page.getByText('Returned, refund on its way')).toBeVisible();
    await expect(page.getByText(/Refund for the parts/)).toBeVisible();
  });

  test('admin offer runs out after the timer and the job goes back to the queue', async ({ page }, info) => {
    desktopOnly(info.project.name);
    await page.clock.install({ time: new Date() });
    await start(page);
    await as(page, 'demo-admin', '/admin/delivery');
    await page
      .getByRole('row', { name: new RegExp(DELIVERY_CODES.ready) })
      .getByRole('button', { name: 'Open' })
      .click();
    await page.getByRole('button', { name: 'Offer to Sunil Yadav' }).click();
    await page.getByRole('button', { name: 'Offered', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(DELIVERY_CODES.ready) })).toContainText(
      'Offer ends in',
    );
    // Just before the 15-minute timer the offer is still open; just after, it is back in "Needs an agent".
    await page.clock.fastForward('14:30');
    await as(page, 'demo-agent', '/partner/delivery');
    await expect(page.locator('article').filter({ hasText: DELIVERY_CODES.ready })).toBeVisible();
    await page.clock.fastForward('01:00');
    await page.reload();
    await expect(page.locator('article').filter({ hasText: DELIVERY_CODES.ready })).toHaveCount(0);
    await as(page, 'demo-admin', '/admin/delivery');
    await expect(page.getByRole('row', { name: new RegExp(DELIVERY_CODES.ready) })).toBeVisible();
  });

  test('shop marks ready for pickup and asks to deliver itself; admin approves', async ({ page }, info) => {
    desktopOnly(info.project.name);
    await start(page);
    await as(page, 'demo-shop-3', '/partner/shop');
    const card = page.locator('article').filter({ hasText: DELIVERY_CODES.packed });
    await expect(card.getByRole('button', { name: 'Out for delivery' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Mark ready for pickup' }).click();
    await expect(card.getByText('Finding a delivery partner')).toBeVisible();
    await expect(card.getByText('Pickup code')).toBeVisible();
    await expect(card.getByText(/^\d{4}$/)).toBeVisible();
    // The agent picking up another order is named with first name and vehicle.
    await expect(
      page
        .locator('article')
        .filter({ hasText: DELIVERY_CODES.pickedUp })
        .getByText('Picked up by Sunil (Motorcycle).'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Ask to deliver ourselves' }).click();
    await page.getByLabel('We have our own delivery staff').check();
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText(/Waiting for MechDost/)).toBeVisible();

    await as(page, 'demo-admin', '/admin/delivery');
    await page.getByRole('button', { name: 'Shop requests' }).click();
    const req = page.locator('li').filter({ hasText: 'Gupta Lubes & Spares' });
    await req.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Request approved.' })).toBeVisible();

    await as(page, 'demo-shop-3', '/partner/shop');
    await expect(page.getByText('You deliver your orders yourself.')).toBeVisible();
  });

  test('customer sees the delivery partner, never the shop or the agent phone', async ({ page }, info) => {
    desktopOnly(info.project.name);
    await start(page);
    await as(page, 'demo-customer', `/orders/${DELIVERY_CODES.pickedUp}`);
    await expect(page.getByText('Picked up by Sunil (Motorcycle)')).toBeVisible();
    await expect(page.getByText(CUSTOMER_DELIVERY_CODE)).toBeVisible();
    await expect(page.locator('main')).not.toContainText('Gupta');
    await expect(page.locator('main')).not.toContainText('9000000005');
  });
});
