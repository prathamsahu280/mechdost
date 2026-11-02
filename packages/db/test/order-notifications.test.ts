/**
 * Customer WhatsApp updates for order milestones (spec 10): queued in the same transaction as the change, only
 * when staff switched the event on, once per transition, delivery code never stored in clear text.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { loadKeyring } from '../src/crypto';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  acceptAssignment,
  issueDeliveryCode,
  offerOrderToShop,
  openPayload,
  saveNotificationTemplate,
  transitionOrder,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};
const ring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let seq = 0;

async function newOrder() {
  seq += 1;
  const code = `MD-RPR-2026-NTFY${B32[Math.floor(seq / 32) % 32] ?? '0'}${B32[seq % 32] ?? '0'}`;
  const [g] = await db
    .insert(s.orderGroups)
    .values({
      code,
      userId: F.customer!,
      cityId: F.city!,
      paymentMethod: 'cod',
      paymentStatus: 'cod_pending',
      subtotalPaise: 50000,
      totalPaise: 50000,
      idempotencyKey: `notify-idem-${String(seq)}-xxxxxxxxxxxx`,
    })
    .returning();
  const [o] = await db
    .insert(s.orders)
    .values({
      groupId: g!.id,
      subNo: 1,
      code: `${code}-1`,
      userId: F.customer!,
      cityId: F.city!,
      shippingAddress: { line1: 'Sarona', pincode: '492001' },
      pincode: '492001',
      subtotalPaise: 50000,
      totalPaise: 50000,
    })
    .returning();
  return { order: o!, groupCode: code };
}

async function enable(event: string, body: string) {
  for (const locale of ['en', 'hi'] as const) {
    await saveNotificationTemplate(t(), {
      key: event,
      channel: 'whatsapp',
      locale,
      body,
      enabled: true,
      expectedVersion: null,
      staffUserId: F.staff!,
    });
  }
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [city] = await db
    .insert(s.cities)
    .values({
      stateId: state!.id,
      code: 'RPR',
      slug: 'raipur',
      name: 'Raipur',
      status: 'live',
      centroid: { lng: 81.64, lat: 21.227 },
    })
    .returning();
  F.city = city!.id;
  await db
    .insert(s.pincodes)
    .values({ pincode: '492001', stateId: state!.id, cityId: F.city, centroid: { lng: 81.64, lat: 21.227 } });
  F.customer = (
    await db
      .insert(s.users)
      .values({ firebaseUid: 'fb-notify-cust', phone: '+919876543210', language: 'hi' })
      .returning()
  )[0]!.id;
  F.staff = (await db.insert(s.users).values({ firebaseUid: 'fb-notify-staff' }).returning())[0]!.id;
  F.shop = (
    await db
      .insert(s.shops)
      .values({
        name: 'Notify Shop',
        phone: '+919000000001',
        addressLine: 'Raipur',
        pincode: '492001',
        cityId: F.city,
        stateId: state!.id,
        status: 'approved',
        location: { lng: 81.63, lat: 21.22 },
      })
      .returning()
  )[0]!.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.execute(sql`delete from notification_outbox`);
});

async function confirm() {
  const { order, groupCode } = await newOrder();
  const [offer] = await db.transaction(async (tx) => {
    await offerOrderToShop(tx, {
      orderId: order.id,
      shopId: F.shop!,
      expectedOrderVersion: order.version,
      timeoutMinutes: 15,
      actor: { type: 'admin' },
    });
    return tx.select().from(s.orderAssignments).where(eq(s.orderAssignments.orderId, order.id));
  });
  await db.transaction((tx) =>
    acceptAssignment(tx as unknown as Tx, {
      assignmentId: offer!.id,
      shopId: F.shop!,
      actor: { type: 'shop' },
    }),
  );
  return { order, groupCode };
}

describe('order WhatsApp updates', () => {
  it('nothing is queued while staff have not switched the event on', async () => {
    await confirm();
    expect(await db.$count(s.notificationOutbox)).toBe(0);
  });

  it('a confirmed order queues one WhatsApp in the customer’s language with the order code', async () => {
    await enable('order.confirmed', 'Your order {{1}} is confirmed.');
    const { groupCode } = await confirm();
    const rows = await db.select().from(s.notificationOutbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: 'whatsapp',
      templateKey: 'order.confirmed',
      locale: 'hi',
      recipient: '+919876543210',
      recipientUserId: F.customer,
      payload: { orderCode: groupCode },
      status: 'pending',
    });
  });

  it('a rolled-back transition queues nothing', async () => {
    const { order } = await newOrder();
    await enable('order.rejected', 'We could not fulfil your order {{1}}.');
    await expect(
      db.transaction(async (tx) => {
        await transitionOrder(tx, {
          orderId: order.id,
          from: 'placed',
          to: 'rejected',
          expectedVersion: order.version,
          actor: { type: 'admin' },
          patch: {
            statusReasonCode: 'no_stock_nearby',
            customerMessage: 'No shop near you has this part today.',
          },
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.$count(s.notificationOutbox)).toBe(0);
  });

  it('out for delivery carries the code encrypted; only the sender can open it', async () => {
    await enable('order.out_for_delivery', 'Order {{1}} is on the way. Code {{2}}.');
    const { order } = await newOrder();
    const [shipment] = await db
      .insert(s.shipments)
      .values({ orderId: order.id, mode: 'own', status: 'out_for_delivery' })
      .returning();
    const code = await issueDeliveryCode(t(), ring, shipment!.id);
    const [row] = await db.select().from(s.notificationOutbox);
    const payload = row!.payload as Record<string, string>;
    expect(JSON.stringify(payload)).not.toContain(`"${code}"`);
    expect(payload.deliveryCodeEnc).toMatch(/^v1\./);
    expect(openPayload(payload, ring)).toEqual({
      orderCode: expect.any(String) as string,
      deliveryCode: code,
    });
    expect(() => openPayload(payload, null)).toThrow();
  });
});
