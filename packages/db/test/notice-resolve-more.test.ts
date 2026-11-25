/**
 * Notice hooks added with the notification clean-up (spec 10, user 2026-11-25: "clear the notifications whose actions
 * have been done"). Each kind below asked a person to do something; the notice is resolved, in the transaction of the
 * change that made it moot: a support reply is done once the customer answers or the request ends; a shop's warning
 * once staff withdraw it; "your refund needs attention" once the refund is settled.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { encryptField, loadKeyring } from '../src/crypto';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  customerReplyTicket,
  grantRole,
  issuePartnerWarning,
  queueNotice,
  rejectRefund,
  setTicketStatus,
  staffReplyTicket,
  syncRbacCatalogue,
  unreadNoticeCount,
  withdrawPartnerWarning,
  listNotices,
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
    .where(and(eq(s.notifications.userId, userId), eq(s.notifications.kind, kind)));

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
  F.customer = await user('fb-m-customer');
  F.owner = await user('fb-m-owner');
  F.support = await user('fb-m-support');
  F.admin = await user('fb-m-admin');
  F.finance = await user('fb-m-finance');
  await grantRole(t(), { userId: F.support, role: 'support_agent', grantedBy: null });
  await grantRole(t(), { userId: F.admin, role: 'super_admin', grantedBy: null });
  await grantRole(t(), { userId: F.finance, role: 'finance', grantedBy: null });
  F.shop = (
    await db
      .insert(s.shops)
      .values({
        name: 'More Shop',
        phone: '+919000000029',
        addressLine: 'Raipur',
        pincode: '492001',
        cityId: F.city,
        stateId: state!.id,
        status: 'approved',
        location: { lng: 81.63, lat: 21.22 },
      })
      .returning()
  )[0]!.id;
  await db.insert(s.shopUsers).values({ shopId: F.shop, userId: F.owner, role: 'owner' });
});
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  await db.execute(sql`delete from notifications`);
  await db.execute(sql`delete from notification_outbox`);
});

async function ticketWithStaffReply() {
  seq += 1;
  const [tk] = await db
    .insert(s.supportTickets)
    .values({
      code: `REQ-RPR-2026-M${String(seq).padStart(5, '0')}`,
      userId: F.customer!,
      kind: 'other',
      cityId: F.city!,
      slaAckDue: new Date(Date.now() + 3_600_000),
      slaResolveDue: new Date(Date.now() + 86_400_000),
    })
    .returning();
  await staffReplyTicket(t(), ALL, {
    staffUserId: F.support!,
    code: tk!.code,
    body: 'Please send the photo.',
    internal: false,
  });
  return tk!;
}

describe('"new reply from support" (customer)', () => {
  it('is open after the reply, and resolved when the customer answers', async () => {
    const tk = await ticketWithStaffReply();
    const [n] = await rowsOf(F.customer!, 'ticket.reply');
    expect(n?.resolvedAt).toBeNull();
    expect(n?.priority).toBe('action');
    expect(await unreadNoticeCount(t(), F.customer!)).toBe(1);
    await customerReplyTicket(t(), { userId: F.customer!, code: tk.code, body: 'Here it is.' });
    expect((await rowsOf(F.customer!, 'ticket.reply'))[0]?.resolvedAt).not.toBeNull();
    expect(await unreadNoticeCount(t(), F.customer!)).toBe(0);
    expect((await listNotices(t(), F.customer!, {})).notices).toHaveLength(0);
  });

  it('is resolved when staff resolve or close the request', async () => {
    const tk = await ticketWithStaffReply();
    const [fresh] = await db.select().from(s.supportTickets).where(eq(s.supportTickets.id, tk.id));
    await setTicketStatus(t(), ALL, {
      staffUserId: F.support!,
      code: tk.code,
      to: 'resolved',
      expectedVersion: fresh!.version,
    });
    expect((await rowsOf(F.customer!, 'ticket.reply'))[0]?.resolvedAt).not.toBeNull();
  });

  it('only the notices of that request are resolved', async () => {
    await ticketWithStaffReply();
    const other = await ticketWithStaffReply();
    await customerReplyTicket(t(), { userId: F.customer!, code: other.code, body: 'Answer' });
    const rows = await rowsOf(F.customer!, 'ticket.reply');
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.resolvedAt !== null)).toHaveLength(1);
  });
});

describe('"a warning was added to your shop"', () => {
  it('is resolved for every person of the shop when staff withdraw the warning', async () => {
    const issued = await issuePartnerWarning(t(), {
      kind: 'shop',
      partnerId: F.shop!,
      scope: ALL,
      reasonCode: 'late_deliveries',
      staffUserId: F.admin!,
    });
    expect((await rowsOf(F.owner!, 'partner.warning'))[0]?.resolvedAt).toBeNull();
    await withdrawPartnerWarning(t(), {
      kind: 'shop',
      partnerId: F.shop!,
      warningId: issued.id,
      scope: ALL,
      staffUserId: F.admin!,
      note: 'Given by mistake',
    });
    expect((await rowsOf(F.owner!, 'partner.warning'))[0]?.resolvedAt).not.toBeNull();
  });
});

describe('"your refund needs attention" (customer)', () => {
  it('is resolved when staff settle the refund, and not before', async () => {
    seq += 1;
    const [g] = await db
      .insert(s.orderGroups)
      .values({
        code: `MD-RPR-2026-M${String(seq).padStart(5, '0')}`,
        userId: F.customer!,
        cityId: F.city!,
        paymentMethod: 'cod',
        paymentStatus: 'cod_pending',
        subtotalPaise: 50000,
        totalPaise: 50000,
        idempotencyKey: `more-idem-${String(seq)}-xxxxxxxxxxxxxxxx`,
      })
      .returning();
    const [o] = await db
      .insert(s.orders)
      .values({
        groupId: g!.id,
        subNo: 1,
        code: `${g!.code}-1`,
        userId: F.customer!,
        cityId: F.city!,
        shippingAddress: { line1: 'Sarona', pincode: '492001' },
        pincode: '492001',
        subtotalPaise: 50000,
        totalPaise: 50000,
      })
      .returning();
    const [r] = await db
      .insert(s.refunds)
      .values({
        groupId: g!.id,
        orderId: o!.id,
        amountPaise: 1000,
        mode: 'bank_upi',
        idemKey: `more-refund-idem-${String(seq)}`,
        status: 'requested',
        source: 'order_rejected',
        reasonCode: 'order_rejected',
        destinationEnc: encryptField('acct-1234', ring, 'refunds.destination_enc'),
      })
      .returning();
    await queueNotice(t(), {
      kind: 'refund.failed',
      userId: F.customer!,
      entityId: r!.id,
      version: 1,
      params: { orderCode: g!.code },
    });
    expect((await rowsOf(F.customer!, 'refund.failed'))[0]?.priority).toBe('urgent');
    expect((await rowsOf(F.customer!, 'refund.failed'))[0]?.resolvedAt).toBeNull();
    await rejectRefund(t(), {
      scope: ALL,
      staffUserId: F.finance!,
      refundId: r!.id,
      expectedVersion: r!.version,
      reasonCode: 'not_eligible',
    });
    expect((await rowsOf(F.customer!, 'refund.failed'))[0]?.resolvedAt).not.toBeNull();
  });
});
