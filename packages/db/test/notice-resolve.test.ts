/**
 * Notices that ask someone to act are resolved when the action is no longer needed (spec 10, user 2026-11-23:
 * "the notification for the order routing on the admin didn't go away even after I rejected the order").
 * Every covered notice kind is proven here against the real repository functions: the notice is resolved in the
 * transaction of the change that made it moot, for every person who got it, the unread count drops, and unrelated
 * notices are left alone.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { encryptField, loadKeyring } from '../src/crypto';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  approveRefund,
  declineAssignment,
  grantRole,
  listNotices,
  offerOrderToShop,
  queueNotice,
  queueShopOrderRoutedEmail,
  queueStaffNotice,
  queueStaffOrderNotice,
  queueStaffOrderPlaced,
  rejectApplication,
  rejectRefund,
  resolveNotices,
  setTicketStatus,
  staffReplyTicket,
  syncRbacCatalogue,
  transitionOrder,
  unreadNoticeCount,
  withdrawQuote,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const ALL = { all: true } as const;
const F: Record<string, string> = {};
let seq = 0;
const ring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});

const rowsOf = (userId: string, kind: string) =>
  db
    .select()
    .from(s.notifications)
    .where(sql`${s.notifications.userId} = ${userId} and ${s.notifications.kind} = ${kind}`);

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  F.city = (
    await db
      .insert(s.cities)
      .values({
        stateId: state!.id,
        code: 'RPR',
        slug: 'raipur',
        name: 'raipur',
        status: 'live',
        centroid: { lng: 81.6, lat: 21.2 },
      })
      .returning()
  )[0]!.id;
  await db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: F.city,
    locality: 'Pandri',
    localityHi: 'पंडरी',
    centroid: { lng: 81.64, lat: 21.227 },
  });
  const user = async (uid: string) =>
    (await db.insert(s.users).values({ firebaseUid: uid }).returning())[0]!.id;
  await syncRbacCatalogue(t());
  F.customer = await user('fb-r-customer');
  F.owner = await user('fb-r-owner');
  F.owner2 = await user('fb-r-owner2');
  F.router1 = await user('fb-r-router1');
  F.router2 = await user('fb-r-router2');
  F.finance = await user('fb-r-finance');
  F.finance2 = await user('fb-r-finance2');
  F.support = await user('fb-r-support');
  F.reviewer = await user('fb-r-reviewer');
  await grantRole(t(), { userId: F.router1, role: 'city_manager', cityId: F.city, grantedBy: null });
  await grantRole(t(), { userId: F.router2, role: 'ops_manager', grantedBy: null });
  await grantRole(t(), { userId: F.finance, role: 'finance', grantedBy: null });
  await grantRole(t(), { userId: F.finance2, role: 'finance', grantedBy: null });
  await grantRole(t(), { userId: F.support, role: 'support_agent', grantedBy: null });
  await grantRole(t(), { userId: F.reviewer, role: 'super_admin', grantedBy: null });
  F.shop = (
    await db
      .insert(s.shops)
      .values({
        name: 'Resolve Shop',
        phone: '+919000000019',
        addressLine: 'Raipur',
        pincode: '492001',
        cityId: F.city,
        stateId: state!.id,
        status: 'approved',
        location: { lng: 81.63, lat: 21.22 },
      })
      .returning()
  )[0]!.id;
  await db.insert(s.shopUsers).values([
    { shopId: F.shop, userId: F.owner, role: 'owner' },
    { shopId: F.shop, userId: F.owner2, role: 'staff' },
  ]);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.execute(sql`delete from notifications`);
  await db.execute(sql`delete from notification_outbox`);
});

/** One checkout with `n` sub-orders in `placed`. */
async function checkout(n = 1) {
  seq += 1;
  const code = `MD-RPR-2026-R${String(seq).padStart(5, '0')}`;
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
      idempotencyKey: `resolve-idem-${code}-xxxxxxxxxxxx`,
    })
    .returning();
  const orders: (typeof s.orders.$inferSelect)[] = [];
  for (let i = 1; i <= n; i += 1)
    orders.push(
      (
        await db
          .insert(s.orders)
          .values({
            groupId: g!.id,
            subNo: i,
            code: `${code}-${String(i)}`,
            userId: F.customer!,
            cityId: F.city!,
            shippingAddress: { line1: 'Sarona', pincode: '492001' },
            pincode: '492001',
            subtotalPaise: 50000,
            totalPaise: 50000,
          })
          .returning()
      )[0]!,
    );
  await queueStaffOrderPlaced(t(), g!.id);
  return { group: g!, orders };
}

const versionOf = async (orderId: string) =>
  (await db.select({ v: s.orders.version }).from(s.orders).where(eq(s.orders.id, orderId)))[0]!.v;

async function move(orderId: string, from: 'placed' | 'needs_rerouting', to: 'rejected' | 'cancelled') {
  const expectedVersion = await versionOf(orderId);
  const patch =
    to === 'rejected'
      ? { statusReasonCode: 'no_stock_nearby', customerMessage: 'We could not find this part nearby.' }
      : { statusReasonCode: 'changed_mind' };
  await db.transaction((tx) =>
    transitionOrder(tx, {
      orderId,
      from,
      to,
      expectedVersion,
      actor: { type: 'admin', userId: F.router1! },
      patch,
    }),
  );
}

const needsRouting = (userId: string) => rowsOf(userId, 'staff.order_needs_routing');

describe('"needs routing" (order placed)', () => {
  it('is open for every routing staff member until the order is rejected, then resolved for all of them', async () => {
    const { orders } = await checkout();
    expect(await unreadNoticeCount(t(), F.router1!)).toBe(1);
    expect(await unreadNoticeCount(t(), F.router2!)).toBe(1);

    await move(orders[0]!.id, 'placed', 'rejected');

    for (const id of [F.router1!, F.router2!]) {
      const [n] = await needsRouting(id);
      expect(n?.resolvedAt).not.toBeNull();
      expect(n?.readAt).not.toBeNull();
      expect(await unreadNoticeCount(t(), id)).toBe(0);
      const page = await listNotices(t(), id, {});
      expect(page.unread).toBe(0);
      expect(page.notices[0]).toMatchObject({
        kind: 'staff.order_needs_routing',
        read: true,
        resolved: true,
      });
    }
  });

  it('is resolved when the order is cancelled (customer, staff or payment expiry all go through the same move)', async () => {
    const { orders } = await checkout();
    await move(orders[0]!.id, 'placed', 'cancelled');
    expect((await needsRouting(F.router1!))[0]?.resolvedAt).not.toBeNull();
    expect(await unreadNoticeCount(t(), F.router1!)).toBe(0);
  });

  it('is resolved when the order is routed to a shop', async () => {
    const { orders } = await checkout();
    const ver = await versionOf(orders[0]!.id);
    await db.transaction((tx) =>
      offerOrderToShop(tx, {
        orderId: orders[0]!.id,
        shopId: F.shop!,
        expectedOrderVersion: ver,
        timeoutMinutes: 5,
        actor: { type: 'admin', userId: F.router1! },
      }),
    );
    expect((await needsRouting(F.router2!))[0]?.resolvedAt).not.toBeNull();
    expect(await unreadNoticeCount(t(), F.router2!)).toBe(0);
  });

  it('stays open while another order of the same checkout still waits, and clears with the last one', async () => {
    const { orders } = await checkout(2);
    await move(orders[0]!.id, 'placed', 'rejected');
    expect((await needsRouting(F.router1!))[0]?.resolvedAt).toBeNull();
    expect(await unreadNoticeCount(t(), F.router1!)).toBe(1);
    await move(orders[1]!.id, 'placed', 'cancelled');
    expect((await needsRouting(F.router1!))[0]?.resolvedAt).not.toBeNull();
    expect(await unreadNoticeCount(t(), F.router1!)).toBe(0);
  });

  it('leaves the notices of other checkouts and other kinds alone', async () => {
    const a = await checkout();
    const b = await checkout();
    await queueNotice(t(), {
      kind: 'order.confirmed',
      userId: F.router1!,
      entityId: 'unrelated',
      version: 1,
      params: { orderCode: 'MD-X' },
    });
    await move(a.orders[0]!.id, 'placed', 'rejected');
    expect(await unreadNoticeCount(t(), F.router1!)).toBe(2); // b's "needs routing" + the unrelated one
    const open = await db
      .select()
      .from(s.notifications)
      .where(sql`${s.notifications.userId} = ${F.router1!} and ${s.notifications.resolvedAt} is null`);
    expect(open.map((r) => r.entityId).sort()).toEqual([b.group.id, 'unrelated'].sort());
  });

  it('is not written at all for a checkout whose orders are already closed', async () => {
    const { group, orders } = await checkout();
    await db.execute(sql`delete from notifications`);
    await move(orders[0]!.id, 'placed', 'cancelled');
    await queueStaffOrderPlaced(t(), group.id);
    expect(await needsRouting(F.router1!)).toHaveLength(0);
  });

  it('a notice resolved twice, or one that was already read, stays resolved and counts nothing', async () => {
    const { group, orders } = await checkout();
    await db.execute(sql`update notifications set read_at = now()`);
    await move(orders[0]!.id, 'placed', 'rejected');
    expect(await resolveNotices(t(), { kinds: ['staff.order_needs_routing'], entityIds: [group.id] })).toBe(
      0,
    );
    expect((await needsRouting(F.router1!))[0]?.resolvedAt).not.toBeNull();
  });
});

describe('"shop declined / did not respond / gave up" (needs a new shop)', () => {
  it.each(['staff.shop_declined', 'staff.shop_timed_out', 'staff.shop_gave_up'] as const)(
    '%s is resolved when staff reroute the order',
    async (kind) => {
      const { orders } = await checkout();
      const order = orders[0]!;
      await db.update(s.orders).set({ status: 'needs_rerouting' }).where(eq(s.orders.id, order.id));
      await queueStaffOrderNotice(t(), { kind, orderId: order.id, version: 2 });
      expect(await unreadNoticeCount(t(), F.router1!)).toBeGreaterThan(0);
      const ver = await versionOf(order.id);
      await db.transaction((tx) =>
        offerOrderToShop(tx, {
          orderId: order.id,
          shopId: F.shop!,
          expectedOrderVersion: ver,
          timeoutMinutes: 5,
          actor: { type: 'admin', userId: F.router1! },
        }),
      );
      for (const id of [F.router1!, F.router2!]) {
        const [n] = await rowsOf(id, kind);
        expect(n?.resolvedAt).not.toBeNull();
      }
    },
  );

  it.each(['rejected', 'cancelled'] as const)('is resolved when the order is %s instead', async (to) => {
    const { orders } = await checkout();
    const order = orders[0]!;
    await db.update(s.orders).set({ status: 'needs_rerouting' }).where(eq(s.orders.id, order.id));
    await queueStaffOrderNotice(t(), { kind: 'staff.shop_declined', orderId: order.id, version: 2 });
    await move(order.id, 'needs_rerouting', to);
    expect((await rowsOf(F.router1!, 'staff.shop_declined'))[0]?.resolvedAt).not.toBeNull();
  });
});

describe('the shop’s "new order" and "offer ends soon" notices', () => {
  async function offered() {
    const { orders } = await checkout();
    const order = orders[0]!;
    const ver = await versionOf(order.id);
    const a = await db.transaction((tx) =>
      offerOrderToShop(tx, {
        orderId: order.id,
        shopId: F.shop!,
        expectedOrderVersion: ver,
        timeoutMinutes: 5,
        actor: { type: 'admin', userId: F.router1! },
      }),
    );
    await queueShopOrderRoutedEmail(t(), {
      assignmentId: a.id,
      shopId: F.shop!,
      orderCode: order.code,
      minutes: 5,
    });
    for (const userId of [F.owner!, F.owner2!])
      await queueNotice(t(), {
        kind: 'shop.offer_expiring',
        userId,
        entityId: a.id,
        version: 1,
        params: { orderCode: order.code, minutes: 2 },
      });
    return { order, assignment: a };
  }

  it('are open for everyone at the shop while the offer waits', async () => {
    await offered();
    for (const id of [F.owner!, F.owner2!]) {
      expect(await rowsOf(id, 'shop.order_routed')).toHaveLength(1);
      expect(await unreadNoticeCount(t(), id)).toBe(2);
    }
  });

  it('are resolved for every person of the shop when the shop declines', async () => {
    const { order, assignment } = await offered();
    await db.transaction((tx) =>
      declineAssignment(tx, {
        assignmentId: assignment.id,
        shopId: F.shop!,
        reason: 'out_of_stock',
        actor: { type: 'shop', userId: F.owner! },
      }),
    );
    expect((await db.select().from(s.orders).where(eq(s.orders.id, order.id)))[0]?.status).toBe(
      'needs_rerouting',
    );
    for (const id of [F.owner!, F.owner2!]) {
      for (const kind of ['shop.order_routed', 'shop.offer_expiring'])
        expect((await rowsOf(id, kind))[0]?.resolvedAt).not.toBeNull();
      expect(await unreadNoticeCount(t(), id)).toBe(0);
    }
  });

  it('are resolved when the order is cancelled while the shop is still deciding', async () => {
    const { order } = await offered();
    const v = await versionOf(order.id);
    await db.transaction((tx) =>
      transitionOrder(tx, {
        orderId: order.id,
        from: 'awaiting_shop',
        to: 'cancelled',
        expectedVersion: v,
        actor: { type: 'admin', userId: F.router1! },
        patch: { statusReasonCode: 'changed_mind' },
      }),
    );
    expect((await rowsOf(F.owner!, 'shop.order_routed'))[0]?.resolvedAt).not.toBeNull();
    expect(await unreadNoticeCount(t(), F.owner2!)).toBe(0);
  });
});

describe('refund notices for finance', () => {
  async function refundWaiting() {
    const { group, orders } = await checkout();
    const [r] = await db
      .insert(s.refunds)
      .values({
        groupId: group.id,
        orderId: orders[0]!.id,
        amountPaise: 1000,
        mode: 'bank_upi',
        idemKey: `resolve-refund-idem-${String(seq)}`,
        status: 'requested',
        source: 'order_rejected',
        reasonCode: 'order_rejected',
        destinationEnc: encryptField('acct-1234', ring, 'refunds.destination_enc'),
      })
      .returning();
    for (const kind of ['staff.refund_overdue', 'staff.refund_alert'] as const)
      await queueStaffNotice(t(), {
        kind,
        cityId: F.city!,
        entityId: r!.id,
        version: 'x',
        params: { orderCode: group.code },
      });
    return r!;
  }

  it('"waiting for approval" is resolved for every finance person when the refund is approved', async () => {
    const r = await refundWaiting();
    expect(await unreadNoticeCount(t(), F.finance!)).toBe(2);
    await approveRefund(t(), {
      scope: ALL,
      staffUserId: F.finance!,
      refundId: r.id,
      expectedVersion: r.version,
    });
    for (const id of [F.finance!, F.finance2!]) {
      expect((await rowsOf(id, 'staff.refund_overdue'))[0]?.resolvedAt).not.toBeNull();
      // approved is not settled: the "needs a look" alert stays open
      expect((await rowsOf(id, 'staff.refund_alert'))[0]?.resolvedAt).toBeNull();
    }
  });

  it('both are resolved when the refund is declined (settled)', async () => {
    const r = await refundWaiting();
    await rejectRefund(t(), {
      scope: ALL,
      staffUserId: F.finance!,
      refundId: r.id,
      expectedVersion: r.version,
      reasonCode: 'not_eligible',
    });
    for (const id of [F.finance!, F.finance2!]) {
      expect((await rowsOf(id, 'staff.refund_overdue'))[0]?.resolvedAt).not.toBeNull();
      expect((await rowsOf(id, 'staff.refund_alert'))[0]?.resolvedAt).not.toBeNull();
      expect(await unreadNoticeCount(t(), id)).toBe(0);
    }
  });
});

describe('"new support request"', () => {
  async function ticket() {
    seq += 1;
    const [tk] = await db
      .insert(s.supportTickets)
      .values({
        code: `REQ-RPR-2026-T${String(seq).padStart(5, '0')}`,
        userId: F.customer!,
        kind: 'other',
        cityId: F.city!,
        slaAckDue: new Date(Date.now() + 3_600_000),
        slaResolveDue: new Date(Date.now() + 86_400_000),
      })
      .returning();
    await queueStaffNotice(t(), {
      kind: 'staff.new_ticket',
      cityId: F.city!,
      entityId: tk!.id,
      version: 1,
      params: { ticketCode: tk!.code },
    });
    return tk!;
  }

  it('is resolved by the first public reply, for every support person; an internal note does not', async () => {
    const tk = await ticket();
    expect(await unreadNoticeCount(t(), F.support!)).toBe(1);
    await staffReplyTicket(t(), ALL, {
      staffUserId: F.support!,
      code: tk.code,
      body: 'Internal only note',
      internal: true,
    });
    expect((await rowsOf(F.support!, 'staff.new_ticket'))[0]?.resolvedAt).toBeNull();
    await staffReplyTicket(t(), ALL, {
      staffUserId: F.support!,
      code: tk.code,
      body: 'We are on it.',
      internal: false,
    });
    expect((await rowsOf(F.support!, 'staff.new_ticket'))[0]?.resolvedAt).not.toBeNull();
    expect(await unreadNoticeCount(t(), F.support!)).toBe(0);
  });

  it('is resolved by a status change', async () => {
    const tk = await ticket();
    await setTicketStatus(t(), ALL, {
      staffUserId: F.support!,
      code: tk.code,
      to: 'in_review',
      expectedVersion: tk.version,
    });
    expect((await rowsOf(F.support!, 'staff.new_ticket'))[0]?.resolvedAt).not.toBeNull();
  });
});

describe('"new application"', () => {
  it('is resolved for all reviewers once the application is decided', async () => {
    const [app] = await db
      .insert(s.partnerApplications)
      .values({
        code: 'APP-RPR-2026-AAAAAA',
        kind: 'seller',
        name: 'Test Seller',
        phone: '+919000000077',
        pincode: '492001',
        gstStatus: 'registered',
        addressLine: 'Sarona, Raipur',
        location: { lng: 81.63, lat: 21.22 },
        locationSource: 'pin',
        consentAt: new Date(),
      })
      .returning();
    await queueStaffNotice(t(), {
      kind: 'staff.new_application',
      cityId: F.city!,
      entityId: app!.id,
      version: 1,
    });
    expect(await unreadNoticeCount(t(), F.reviewer!)).toBe(1);
    await rejectApplication(t(), {
      scope: ALL,
      code: app!.code,
      expectedVersion: app!.version,
      staffUserId: F.reviewer!,
      reasonCode: 'not_serviceable',
    });
    expect((await rowsOf(F.reviewer!, 'staff.new_application'))[0]?.resolvedAt).not.toBeNull();
    expect(await unreadNoticeCount(t(), F.reviewer!)).toBe(0);
  });
});

describe('"your price is ready" (customer quote)', () => {
  it('is resolved when staff withdraw the offered quote', async () => {
    const [q] = await db
      .insert(s.quoteRequests)
      .values({
        code: 'QT-RPR-2026-AAAAAA',
        userId: F.customer!,
        cityId: F.city!,
        pincode: '492001',
        shippingAddress: { line1: 'Sarona', pincode: '492001' },
        status: 'offered',
        offerVersion: 1,
        units: 4,
        expiresAt: new Date(Date.now() + 86_400_000),
        idempotencyKey: 'resolve-quote-idem-key-1',
        requestHash: 'h',
      })
      .returning();
    const [offer] = await db
      .insert(s.quoteOffers)
      .values({
        quoteId: q!.id,
        offerVersion: 1,
        lines: [{ sku: 'X', qty: 1, unitPaise: 1000 }],
        subtotalPaise: 1000,
        deliveryPaise: 0,
        totalPaise: 1000,
        validUntil: new Date(Date.now() + 86_400_000),
      })
      .returning();
    await queueNotice(t(), {
      kind: 'quote.offer',
      userId: F.customer!,
      entityId: q!.id,
      version: 1,
      params: { quoteCode: q!.code, validUntil: '1 Jan' },
    });
    await queueNotice(t(), {
      kind: 'quote.expiring',
      userId: F.customer!,
      entityId: offer!.id,
      version: 1,
      params: { quoteCode: q!.code, validUntil: '1 Jan' },
    });
    expect(await unreadNoticeCount(t(), F.customer!)).toBe(2);
    await withdrawQuote(t(), {
      scope: ALL,
      staffUserId: F.reviewer!,
      code: q!.code,
      expectedVersion: q!.version,
      reasonCode: 'cannot_supply',
      message: 'We cannot supply this one, sorry.',
    });
    for (const kind of ['quote.offer', 'quote.expiring'])
      expect((await rowsOf(F.customer!, kind))[0]?.resolvedAt).not.toBeNull();
    expect(await unreadNoticeCount(t(), F.customer!)).toBe(0);
  });
});
