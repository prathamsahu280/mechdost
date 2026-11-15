/**
 * Account deletion request (design 2026-11-15 item 7; spec 01 and 09): the customer asks from the account, which opens
 * a `deletion_request` ticket; support confirms before anything else happens. A customer with an open order, service
 * job or refund is told why it is blocked. The deletion itself is not built (Q122): confirming only records the step.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { istDateString } from '@mechdost/shared/time';
import {
  confirmAccountDeletion,
  createServiceRequest,
  getInboxTicket,
  getMyTicket,
  requestAccountDeletion,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const ALL = { all: true } as const;
let seq = 0;

async function customer(name = 'Deepa') {
  seq += 1;
  return (
    await db
      .insert(s.users)
      .values({
        firebaseUid: `fb-del-${String(seq)}`,
        name,
        phone: `+91981000${String(seq).padStart(4, '0')}`,
      })
      .returning()
  )[0]!.id;
}
async function orderFor(userId: string, status: string) {
  seq += 1;
  const code = `MD-RPR-2026-D${String(seq).padStart(5, '0')}`;
  const [g] = await db
    .insert(s.orderGroups)
    .values({
      code,
      userId,
      cityId: f.raipur,
      paymentMethod: 'cod',
      paymentStatus: 'cod_pending',
      subtotalPaise: 50000,
      totalPaise: 50000,
      idempotencyKey: `del-${code}-xxxxxxxxxxxx`,
    })
    .returning();
  const [o] = await db
    .insert(s.orders)
    .values({
      groupId: g!.id,
      subNo: 1,
      code: `${code}-1`,
      userId,
      cityId: f.raipur,
      status,
      ...(status === 'cancelled' ? { statusReasonCode: 'changed_mind' } : {}),
      shippingAddress: { line1: 'Sarona', pincode: '492001' },
      pincode: '492001',
      subtotalPaise: 50000,
      totalPaise: 50000,
    })
    .returning();
  return { group: g!, order: o! };
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
});
afterAll(async () => {
  await client.close();
});

describe('requesting deletion', () => {
  it('opens one deletion ticket, marks the account, audits, and asking again returns the same one', async () => {
    const user = await customer();
    await orderFor(user, 'cancelled');
    const first = await requestAccountDeletion(t(), { userId: user, defaultCityCode: 'RPR', note: null });
    expect(first.created).toBe(true);
    const again = await requestAccountDeletion(t(), { userId: user, defaultCityCode: 'RPR', note: null });
    expect(again).toMatchObject({ created: false, code: first.code });
    const ticket = await getMyTicket(t(), user, first.code);
    expect(ticket).toMatchObject({ kind: 'deletion_request', status: 'open', deletionConfirmedAt: null });
    const [u] = await db.select().from(s.users).where(eq(s.users.id, user));
    expect(u?.deletionRequestedAt).not.toBeNull();
    expect(u?.deletedAt).toBeNull();
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.actorUserId, user));
    expect(audit.some((a) => a.action === 'user.deletion_requested')).toBe(true);
  });

  it('is blocked, with the reasons as codes, while an order, a service job or a refund is open', async () => {
    const user = await customer();
    const { group, order } = await orderFor(user, 'awaiting_shop');
    const blocked = await requestAccountDeletion(t(), {
      userId: user,
      defaultCityCode: 'RPR',
      note: null,
    }).catch((e: unknown) => e);
    expect(blocked).toMatchObject({ code: 'DELETION_BLOCKED' });
    expect((blocked as { blockers?: string[] }).blockers).toEqual(['OPEN_ORDERS']);
    await db
      .update(s.orders)
      .set({ status: 'cancelled', statusReasonCode: 'changed_mind' })
      .where(eq(s.orders.id, order.id));
    await db.insert(s.refunds).values({
      groupId: group.id,
      orderId: order.id,
      amountPaise: 1000,
      mode: 'bank_upi',
      destinationEnc: 'v1.k1.AAAAAAAAAAAAAAAA.AAAA.AAAAAAAAAAAAAAAAAAAAAA',
      idemKey: `del-refund-${String(seq)}-xxxxxxxx`,
      status: 'requested',
      source: 'order_cancelled',
      reasonCode: 'order_cancelled',
    } as never);
    const refundBlocked = await requestAccountDeletion(t(), {
      userId: user,
      defaultCityCode: 'RPR',
      note: null,
    }).catch((e: unknown) => e);
    expect((refundBlocked as { blockers?: string[] }).blockers).toEqual(['OPEN_REFUND']);
    await db.delete(s.refunds).where(eq(s.refunds.orderId, order.id));
    const w = await addWorkshop(db, f, { name: 'Deletion Workshop' });
    await createServiceRequest(t(), {
      userId: f.customer,
      idempotencyKey: 'deletion-job-key-0001',
      request: {
        workshopSlug: w.slug,
        vehicleType: '2W',
        vehicleId: null,
        vehicle: 'Honda Activa 6G',
        serviceKeys: ['routine2w'],
        concern: null,
        pincode: '492001',
        lat: null,
        lng: null,
        preferredDate: istDateString(new Date()),
        preferredSlot: 'morning',
        contactName: 'Asha',
        contactPhone: '+919876543210',
      } as never,
    });
    const jobBlocked = await requestAccountDeletion(t(), {
      userId: f.customer,
      defaultCityCode: 'RPR',
      note: null,
    }).catch((e: unknown) => e);
    expect((jobBlocked as { blockers?: string[] }).blockers).toEqual(['OPEN_SERVICE']);
    // Nothing was opened or marked by the refused attempts.
    expect(await db.select().from(s.supportTickets).where(eq(s.supportTickets.userId, user))).toHaveLength(0);
  });
});

describe('support confirms', () => {
  it('confirms once (compare-and-set), audited, visible to the customer; nothing is deleted', async () => {
    const user = await customer();
    const { code } = await requestAccountDeletion(t(), {
      userId: user,
      defaultCityCode: 'RPR',
      note: 'Please close it',
    });
    const agent = await customer('Agent');
    const inbox = await getInboxTicket(t(), ALL, code);
    const done = await confirmAccountDeletion(t(), ALL, {
      staffUserId: agent,
      code,
      expectedVersion: inbox.version,
    });
    expect(done.version).toBeGreaterThan(inbox.version);
    expect((await getMyTicket(t(), user, code)).deletionConfirmedAt).not.toBeNull();
    const staff = await getInboxTicket(t(), ALL, code);
    expect(staff.staff.deletionConfirmedAt).not.toBeNull();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, user));
    expect(u?.deletedAt).toBeNull();
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.actorUserId, agent));
    expect(audit.some((a) => a.action === 'user.deletion_confirmed')).toBe(true);
    await expect(
      confirmAccountDeletion(t(), ALL, { staffUserId: agent, code, expectedVersion: done.version }),
    ).rejects.toMatchObject({ code: 'DELETION_ALREADY_CONFIRMED' });
  });

  it('refuses a stale version, another kind of ticket, and re-checks the blockers', async () => {
    const user = await customer();
    const { code } = await requestAccountDeletion(t(), { userId: user, defaultCityCode: 'RPR', note: null });
    const agent = await customer('Agent2');
    await expect(
      confirmAccountDeletion(t(), ALL, { staffUserId: agent, code, expectedVersion: 99 }),
    ).rejects.toMatchObject({ code: 'STALE_TICKET' });
    const { order } = await orderFor(user, 'placed');
    const inbox = await getInboxTicket(t(), ALL, code);
    await expect(
      confirmAccountDeletion(t(), ALL, { staffUserId: agent, code, expectedVersion: inbox.version }),
    ).rejects.toMatchObject({ code: 'DELETION_BLOCKED' });
    await db
      .update(s.orders)
      .set({ status: 'cancelled', statusReasonCode: 'changed_mind' })
      .where(eq(s.orders.id, order.id));
    // A ticket of another kind cannot be "confirmed" as a deletion.
    const other = await customer();
    const [row] = await db
      .insert(s.supportTickets)
      .values({
        code: 'REQ-RPR-2026-OTHER1',
        userId: other,
        kind: 'other',
        slaAckDue: new Date(),
        slaResolveDue: new Date(),
      })
      .returning();
    await expect(
      confirmAccountDeletion(t(), ALL, {
        staffUserId: agent,
        code: row!.code,
        expectedVersion: row!.version,
      }),
    ).rejects.toMatchObject({ code: 'NOT_A_DELETION_REQUEST' });
  });
});
