/**
 * Transactional emails (spec 10, design 2026-11-15): queued in the same transaction as the change, one per
 * milestone, in the recipient's language, verified addresses only when the setting says so, switchable by staff,
 * shop and customer details never crossing over.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { loadKeyring, decryptField } from '../src/crypto';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  acceptAssignment,
  createSupportTicket,
  getInboxTicket,
  issuePartnerWarning,
  queueApplicationEmail,
  setTicketStatus,
  staffReplyTicket,
  issueDeliveryCode,
  offerOrderToShop,
  openPayload,
  queueEmail,
  queueOrderPlacedEmail,
  queueRefundEmail,
  saveEmailTemplate,
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

async function newOrder(opts: { method?: 'cod' | 'online'; paymentStatus?: string } = {}) {
  seq += 1;
  const code = `MD-RPR-2026-EMM8${B32[Math.floor(seq / 32) % 32] ?? '0'}${B32[seq % 32] ?? '0'}`;
  const [g] = await db
    .insert(s.orderGroups)
    .values({
      code,
      userId: F.customer!,
      cityId: F.city!,
      paymentMethod: opts.method ?? 'cod',
      paymentStatus: opts.paymentStatus ?? 'cod_pending',
      subtotalPaise: 50000,
      totalPaise: 50000,
      idempotencyKey: `email-idem-${String(seq)}-xxxxxxxxxxxx`,
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
  return { order: o!, group: g!, groupCode: code };
}

const outbox = () => db.select().from(s.notificationOutbox).orderBy(s.notificationOutbox.createdAt);

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
  await db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: F.city,
    locality: 'Pandri',
    localityHi: 'पंडरी',
    centroid: { lng: 81.64, lat: 21.227 },
  });
  F.customer = (
    await db
      .insert(s.users)
      .values({
        firebaseUid: 'fb-mail-cust',
        phone: '+919876543211',
        email: 'ravi@example.com',
        emailVerifiedAt: new Date(),
        language: 'hi',
      })
      .returning()
  )[0]!.id;
  F.enCustomer = (
    await db
      .insert(s.users)
      .values({
        firebaseUid: 'fb-mail-en',
        email: 'asha@example.com',
        emailVerifiedAt: new Date(),
        language: 'en',
      })
      .returning()
  )[0]!.id;
  F.unverified = (
    await db
      .insert(s.users)
      .values({ firebaseUid: 'fb-mail-unv', email: 'unv@example.com', language: 'en' })
      .returning()
  )[0]!.id;
  F.noEmail = (await db.insert(s.users).values({ firebaseUid: 'fb-mail-none' }).returning())[0]!.id;
  F.staff = (await db.insert(s.users).values({ firebaseUid: 'fb-mail-staff' }).returning())[0]!.id;
  F.shop = (
    await db
      .insert(s.shops)
      .values({
        name: 'Mail Shop',
        phone: '+919000000002',
        addressLine: 'Raipur',
        pincode: '492001',
        cityId: F.city,
        stateId: state!.id,
        status: 'approved',
        location: { lng: 81.63, lat: 21.22 },
      })
      .returning()
  )[0]!.id;
  F.shopOwner = (
    await db
      .insert(s.users)
      .values({
        firebaseUid: 'fb-mail-owner',
        email: 'owner@example.com',
        emailVerifiedAt: new Date(),
        language: 'en',
      })
      .returning()
  )[0]!.id;
  await db.insert(s.shopUsers).values({ shopId: F.shop, userId: F.shopOwner, role: 'owner' });
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.execute(sql`delete from notification_outbox`);
  await db.execute(sql`delete from notification_templates`);
  await db.execute(sql`delete from settings where key = 'customers.require_verified_email'`);
});

describe('queueEmail', () => {
  const base = { template: 'ticket_received' as const, entityId: 'ent-1', version: 1 };

  it('queues one email in the account language to the account address', async () => {
    expect(await queueEmail(t(), { ...base, userId: F.customer!, payload: { ticketCode: 'REQ-1' } })).toBe(
      true,
    );
    const [row] = await outbox();
    expect(row).toMatchObject({
      channel: 'email',
      templateKey: 'ticket_received',
      locale: 'hi',
      recipient: 'ravi@example.com',
      recipientUserId: F.customer,
      dedupeKey: 'ticket_received:ent-1:v1:email',
      payload: { ticketCode: 'REQ-1' },
    });
  });

  it('the same milestone twice sends once (dedupe), the next version sends again', async () => {
    const q = (version: number) =>
      queueEmail(t(), { ...base, version, userId: F.customer!, payload: { ticketCode: 'REQ-1' } });
    expect(await q(1)).toBe(true);
    expect(await q(1)).toBe(false);
    expect(await q(2)).toBe(true);
    expect(await db.$count(s.notificationOutbox)).toBe(2);
  });

  it('an unverified address gets mail unless the setting requires a verified one', async () => {
    const send = () => queueEmail(t(), { ...base, userId: F.unverified!, payload: { ticketCode: 'REQ-2' } });
    expect(await send()).toBe(true);
    await db.execute(sql`delete from notification_outbox`);
    await db.insert(s.settings).values({ key: 'customers.require_verified_email', value: true });
    expect(await send()).toBe(false);
    expect(await db.$count(s.notificationOutbox)).toBe(0);
    // A verified address is unaffected.
    expect(await queueEmail(t(), { ...base, userId: F.enCustomer!, payload: { ticketCode: 'REQ-2' } })).toBe(
      true,
    );
  });

  it('partners always need a verified address', async () => {
    expect(
      await queueEmail(t(), {
        ...base,
        template: 'shop_order_routed',
        audience: 'partner',
        userId: F.unverified!,
        payload: {},
      }),
    ).toBe(false);
  });

  it('no address, deactivated account or unknown user send nothing', async () => {
    expect(await queueEmail(t(), { ...base, userId: F.noEmail!, payload: {} })).toBe(false);
    await db.update(s.users).set({ status: 'deactivated' }).where(eq(s.users.id, F.enCustomer!));
    expect(await queueEmail(t(), { ...base, userId: F.enCustomer!, payload: {} })).toBe(false);
    await db.update(s.users).set({ status: 'active' }).where(eq(s.users.id, F.enCustomer!));
    expect(await db.$count(s.notificationOutbox)).toBe(0);
  });

  it('a direct address uses the language given', async () => {
    await queueEmail(t(), {
      template: 'application_received',
      entityId: 'app-1',
      version: 1,
      to: { email: 'applicant@example.com', locale: 'hi' },
      payload: { name: 'Asha', applicationCode: 'PA-1' },
    });
    expect((await outbox())[0]).toMatchObject({ recipient: 'applicant@example.com', locale: 'hi' });
  });

  it('staff can switch a template off for a language; no row means on', async () => {
    await saveEmailTemplate(t(), {
      key: 'ticket_received',
      locale: 'hi',
      enabled: false,
      expectedVersion: null,
      staffUserId: F.staff!,
    });
    expect(await queueEmail(t(), { ...base, userId: F.customer!, payload: { ticketCode: 'REQ-3' } })).toBe(
      false,
    );
    // The English version is untouched.
    expect(await queueEmail(t(), { ...base, userId: F.enCustomer!, payload: { ticketCode: 'REQ-3' } })).toBe(
      true,
    );
  });

  it('a rolled-back transaction queues nothing', async () => {
    await expect(
      db.transaction(async (tx) => {
        await queueEmail(tx, { ...base, userId: F.customer!, payload: { ticketCode: 'REQ-4' } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.$count(s.notificationOutbox)).toBe(0);
  });

  it('the refund helper queues the billing email the refunds code can call', async () => {
    expect(
      await queueRefundEmail(t(), {
        template: 'refund_requested',
        refundId: 'refund-1',
        refundVersion: 1,
        userId: F.customer!,
        orderCode: 'MD-RPR-2026-AAAAAA',
        amount: '₹500.00',
      }),
    ).toBe(true);
    expect((await outbox())[0]).toMatchObject({
      templateKey: 'refund_requested',
      payload: { orderCode: 'MD-RPR-2026-AAAAAA', amount: '₹500.00' },
    });
  });
});

describe('order emails', () => {
  async function confirm(order: { id: string; version: number }) {
    await db.transaction(async (tx) => {
      await offerOrderToShop(tx, {
        orderId: order.id,
        shopId: F.shop!,
        expectedOrderVersion: order.version,
        timeoutMinutes: 15,
        actor: { type: 'admin' },
      });
    });
    const [offer] = await db
      .select()
      .from(s.orderAssignments)
      .where(eq(s.orderAssignments.orderId, order.id));
    await db.transaction((tx) =>
      acceptAssignment(tx as unknown as Tx, {
        assignmentId: offer!.id,
        shopId: F.shop!,
        actor: { type: 'shop' },
      }),
    );
  }

  it('confirmed: names the order and the seller’s area in the customer’s language, never the shop phone', async () => {
    const { order, groupCode } = await newOrder();
    await confirm(order);
    const mail = (await outbox()).filter((r) => r.templateKey === 'order_confirmed');
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({
      locale: 'hi',
      recipient: 'ravi@example.com',
      payload: expect.objectContaining({ orderCode: groupCode, shopArea: 'पंडरी' }) as unknown,
    });
    expect(JSON.stringify(mail[0]!.payload)).not.toContain('9000000002');
  });

  it('routing an order emails the shop’s people (not the customer) with order code and minutes', async () => {
    const { order } = await newOrder();
    await db.transaction(async (tx) => {
      await offerOrderToShop(tx, {
        orderId: order.id,
        shopId: F.shop!,
        expectedOrderVersion: order.version,
        timeoutMinutes: 15,
        actor: { type: 'admin' },
      });
    });
    const mail = (await outbox()).filter((r) => r.templateKey === 'shop_order_routed');
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({
      recipient: 'owner@example.com',
      payload: { orderCode: order.code, minutes: 15 },
    });
    expect(JSON.stringify(mail[0]!.payload)).not.toContain('ravi@example.com');
  });

  it('cancelled before payment says there is nothing to refund; paid online says the refund is starting', async () => {
    const unpaid = await newOrder();
    await db.transaction((tx) =>
      transitionOrder(tx, {
        orderId: unpaid.order.id,
        from: 'placed',
        to: 'cancelled',
        expectedVersion: unpaid.order.version,
        actor: { type: 'customer', userId: F.customer! },
        patch: { statusReasonCode: 'changed_mind' },
      }),
    );
    const paid = await newOrder({ method: 'online', paymentStatus: 'paid' });
    await db.transaction((tx) =>
      transitionOrder(tx, {
        orderId: paid.order.id,
        from: 'placed',
        to: 'cancelled',
        expectedVersion: paid.order.version,
        actor: { type: 'admin' },
        patch: { statusReasonCode: 'customer_unreachable' },
      }),
    );
    const mail = (await outbox()).filter((r) => r.templateKey === 'order_cancelled');
    expect(mail).toHaveLength(2);
    const [a, b] = mail.map((m) => m.payload as Record<string, string>) as [
      Record<string, string>,
      Record<string, string>,
    ];
    expect(a.refundNote).toContain('ज़रूरत नहीं');
    expect(b.refundNote).toContain('रिफंड शुरू');
    expect(JSON.stringify(mail.map((m) => m.payload))).not.toMatch(/has been refunded|रिफंड कर दिया/);
  });

  it('rejected carries the reason in plain words and staff’s message', async () => {
    const { order } = await newOrder();
    await db.transaction((tx) =>
      transitionOrder(tx, {
        orderId: order.id,
        from: 'placed',
        to: 'rejected',
        expectedVersion: order.version,
        actor: { type: 'admin' },
        patch: {
          statusReasonCode: 'no_stock_nearby',
          customerMessage: 'No shop near you has this part today.',
        },
      }),
    );
    const [row] = (await outbox()).filter((r) => r.templateKey === 'order_rejected');
    expect(row?.payload).toMatchObject({ message: 'No shop near you has this part today.' });
    expect(String((row?.payload as Record<string, string>).reason)).not.toContain('no_stock_nearby');
  });

  it('a rolled-back transition queues no email', async () => {
    const { order } = await newOrder();
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

  it('a stale transition queues nothing and a retry mails once', async () => {
    const { order } = await newOrder();
    const run = (version: number) =>
      db.transaction((tx) =>
        transitionOrder(tx, {
          orderId: order.id,
          from: 'placed',
          to: 'cancelled',
          expectedVersion: version,
          actor: { type: 'admin' },
          patch: { statusReasonCode: 'other' },
        }),
      );
    await run(order.version);
    await expect(run(order.version)).rejects.toThrow();
    expect((await outbox()).filter((r) => r.templateKey === 'order_cancelled')).toHaveLength(1);
  });

  it('out for delivery carries the delivery code encrypted, in the customer’s language', async () => {
    const { order } = await newOrder();
    const [shipment] = await db
      .insert(s.shipments)
      .values({ orderId: order.id, mode: 'own', status: 'out_for_delivery' })
      .returning();
    const code = await issueDeliveryCode(t(), ring, shipment!.id);
    const [row] = (await outbox()).filter((r) => r.templateKey === 'order_out_for_delivery');
    const payload = row!.payload as Record<string, string>;
    expect(JSON.stringify(payload)).not.toContain(code);
    expect(payload.deliveryCodeEnc).toBeTruthy();
    expect(openPayload(payload, ring).deliveryCode).toBe(code);
    expect(decryptField(payload.deliveryCodeEnc!, ring, 'notification_outbox.payload.deliveryCode')).toBe(
      code,
    );
    expect(row).toMatchObject({ locale: 'hi', recipient: 'ravi@example.com' });
    // Re-issuing the code does not send a second email.
    await issueDeliveryCode(t(), ring, shipment!.id);
    expect((await outbox()).filter((r) => r.templateKey === 'order_out_for_delivery')).toHaveLength(1);
  });

  it('order placed lists the items and the total once', async () => {
    const { group } = await newOrder();
    await queueOrderPlacedEmail(t(), group.id);
    await queueOrderPlacedEmail(t(), group.id);
    const mail = (await outbox()).filter((r) => r.templateKey === 'order_placed');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.payload).toMatchObject({
      orderCode: group.code,
      total: '₹500.00',
      paymentMethod: 'डिलीवरी पर नकद',
    });
  });
});

describe('support and partner emails', () => {
  const ALL = { all: true } as const;

  it('a ticket is acknowledged, each staff reply and the resolution are mailed once; internal notes are not', async () => {
    const { code } = await createSupportTicket(t(), {
      userId: F.enCustomer!,
      kind: 'other',
      orderCode: null,
      body: 'My part does not fit.',
      defaultCityCode: 'RPR',
    });
    await staffReplyTicket(t(), ALL, { staffUserId: F.staff!, code, body: 'Internal only.', internal: true });
    await staffReplyTicket(t(), ALL, {
      staffUserId: F.staff!,
      code,
      body: 'Please send a photo.',
      internal: false,
    });
    const { version } = await getInboxTicket(t(), ALL, code);
    await setTicketStatus(t(), ALL, {
      staffUserId: F.staff!,
      code,
      to: 'resolved',
      expectedVersion: version,
    });
    const mail = await outbox();
    expect(mail.map((m) => m.templateKey)).toEqual(['ticket_received', 'ticket_reply', 'ticket_resolved']);
    expect(mail.every((m) => m.recipient === 'asha@example.com' && m.locale === 'en')).toBe(true);
    expect(mail[1]!.payload).toEqual({ ticketCode: code });
  });

  it('a warning goes to the shop’s people in calm words with the count, never as a raw code', async () => {
    await issuePartnerWarning(t(), {
      kind: 'shop',
      partnerId: F.shop!,
      scope: ALL,
      reasonCode: 'missed_offers',
      note: null,
      staffUserId: F.staff!,
    });
    const [row] = (await outbox()).filter((m) => m.templateKey === 'partner_warning_issued');
    expect(row).toMatchObject({ recipient: 'owner@example.com', locale: 'en' });
    const p = row!.payload as Record<string, string | number>;
    expect(p).toMatchObject({ name: 'Mail Shop', count: 1, windowDays: 30 });
    expect(String(p.reason)).not.toContain('missed_offers');
  });

  it('a seller application is acknowledged, decided and mailed to the applicant, not to an account', async () => {
    const app = { id: 'application-1', code: 'PA-RPR-2026-M8M8M8' };
    await queueApplicationEmail(t(), {
      template: 'application_received',
      applicationId: app.id,
      version: 1,
      name: 'Asha Verma',
      email: 'applicant@example.com',
      code: app.code,
    });
    await queueApplicationEmail(t(), {
      template: 'application_rejected',
      applicationId: app.id,
      version: 2,
      name: 'Asha Verma',
      email: 'applicant@example.com',
      code: app.code,
      reasonCode: 'documents_invalid',
    });
    await queueApplicationEmail(t(), {
      template: 'application_received',
      applicationId: 'no-email',
      version: 1,
      name: 'x',
      email: null,
      code: 'PA-1',
    });
    const mail = await outbox();
    expect(mail.map((m) => [m.templateKey, m.recipient, m.recipientUserId])).toEqual([
      ['application_received', 'applicant@example.com', null],
      ['application_rejected', 'applicant@example.com', null],
    ]);
    expect(mail[1]!.payload).toMatchObject({ reason: 'We could not verify the details you gave.' });
  });
});
