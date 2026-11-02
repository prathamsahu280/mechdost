/**
 * Support tickets (spec 09): customers only ever see their own requests (foreign codes 404), 5 a day, replies move
 * status through the ticket machine, staff are scoped by city, WhatsApp requests get a WhatsApp reply when on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  createSupportTicket,
  customerReplyTicket,
  getInboxTicket,
  getMyTicket,
  listInbox,
  listMyTickets,
  saveNotificationTemplate,
  setTicketStatus,
  staffReplyTicket,
  ticketScopeFrom,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};
const ALL = { all: true } as const;

async function orderFor(userId: string, cityId: string, code: string) {
  const [g] = await db
    .insert(s.orderGroups)
    .values({
      code,
      userId,
      cityId,
      paymentMethod: 'cod',
      paymentStatus: 'cod_pending',
      subtotalPaise: 50000,
      totalPaise: 50000,
      idempotencyKey: `support-${code}-xxxxxxxxxx`,
    })
    .returning();
  await db.insert(s.orders).values({
    groupId: g!.id,
    subNo: 1,
    code: `${code}-1`,
    userId,
    cityId,
    shippingAddress: { line1: 'Sarona', pincode: '492001' },
    pincode: '492001',
    subtotalPaise: 50000,
    totalPaise: 50000,
  });
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const city = async (code: string, slug: string) =>
    (
      await db
        .insert(s.cities)
        .values({
          stateId: state!.id,
          code,
          slug,
          name: slug,
          status: 'live',
          centroid: { lng: 81.64, lat: 21.227 },
        })
        .returning()
    )[0]!.id;
  F.raipur = await city('RPR', 'raipur');
  F.bilaspur = await city('BLS', 'bilaspur');
  await db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: F.raipur,
    centroid: { lng: 81.64, lat: 21.227 },
  });
  const user = async (uid: string, phone?: string) =>
    (await db.insert(s.users).values({ firebaseUid: uid, phone }).returning())[0]!.id;
  F.asha = await user('fb-support-asha', '+919876543210');
  F.ravi = await user('fb-support-ravi');
  F.staff = await user('fb-support-staff');
  await orderFor(F.asha, F.raipur, 'MD-RPR-2026-SPRTA1');
  await orderFor(F.ravi, F.bilaspur, 'MD-BLS-2026-SPRTB1');
});

afterAll(async () => {
  await client.close();
});

describe('customer requests', () => {
  it('raises a request about an own order (city + code from the order) and reads it back', async () => {
    const { code } = await createSupportTicket(t(), {
      userId: F.asha!,
      kind: 'order_issue',
      orderCode: 'MD-RPR-2026-SPRTA1',
      body: 'The battery does not hold charge.',
      defaultCityCode: 'RPR',
    });
    expect(code).toMatch(/^REQ-RPR-/);
    const ticket = await getMyTicket(t(), F.asha!, code);
    expect(ticket).toMatchObject({
      kind: 'order_issue',
      status: 'open',
      orderCode: 'MD-RPR-2026-SPRTA1',
      channel: 'web',
    });
    expect(ticket.messages.map((m) => m.body)).toEqual(['The battery does not hold charge.']);
    const [row] = await db.select().from(s.supportTickets).where(eq(s.supportTickets.code, code));
    expect(row?.cityId).toBe(F.raipur);
  });

  it('someone else’s order or request is "not found"', async () => {
    await expect(
      createSupportTicket(t(), {
        userId: F.asha!,
        kind: 'refund',
        orderCode: 'MD-BLS-2026-SPRTB1',
        body: 'Refund please',
        defaultCityCode: 'RPR',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [mine] = await listMyTickets(t(), F.asha!);
    await expect(getMyTicket(t(), F.ravi!, mine!.code)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      customerReplyTicket(t(), { userId: F.ravi!, code: mine!.code, body: 'hi' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('allows 5 requests a day', async () => {
    for (let i = 0; i < 5; i += 1) {
      await createSupportTicket(t(), {
        userId: F.ravi!,
        kind: 'other',
        orderCode: null,
        body: `Question ${String(i)}`,
        defaultCityCode: 'RPR',
      });
    }
    await expect(
      createSupportTicket(t(), {
        userId: F.ravi!,
        kind: 'other',
        orderCode: null,
        body: 'One more',
        defaultCityCode: 'RPR',
      }),
    ).rejects.toMatchObject({ code: 'TICKET_DAILY_LIMIT' });
  });
});

describe('staff inbox', () => {
  it('city staff see their city only; requests with no city go to all-city staff', async () => {
    const raipurOnly = ticketScopeFrom([
      { permissions: ['tickets:read'], cityId: F.raipur!, shopId: null, workshopId: null },
    ]);
    const bilaspurOnly = ticketScopeFrom([
      { permissions: ['tickets:read'], cityId: F.bilaspur!, shopId: null, workshopId: null },
    ]);
    expect(
      ticketScopeFrom([{ permissions: ['tickets:read'], cityId: null, shopId: null, workshopId: null }]),
    ).toEqual(ALL);
    expect(
      ticketScopeFrom([{ permissions: ['orders:read'], cityId: null, shopId: null, workshopId: null }]),
    ).toEqual({
      all: false,
      cityIds: [],
    });

    const raipurCodes = (await listInbox(t(), raipurOnly)).map((r) => r.orderCode);
    expect(raipurCodes).toContain('MD-RPR-2026-SPRTA1');
    expect(raipurCodes.every((c) => c === 'MD-RPR-2026-SPRTA1')).toBe(true);
    const [asha] = await listMyTickets(t(), F.asha!);
    await expect(getInboxTicket(t(), bilaspurOnly, asha!.code)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await listInbox(t(), ALL)).length).toBeGreaterThan(raipurCodes.length);
  });

  it('replying uses the reply scope, never the wider read scope', async () => {
    const grants = [
      { permissions: ['tickets:read'], cityId: null, shopId: null, workshopId: null },
      { permissions: ['tickets:read', 'tickets:reply'], cityId: F.bilaspur!, shopId: null, workshopId: null },
    ];
    expect(ticketScopeFrom(grants, 'tickets:read')).toEqual(ALL);
    const replyScope = ticketScopeFrom(grants, 'tickets:reply');
    expect(replyScope).toEqual({ all: false, cityIds: [F.bilaspur] });
    const [asha] = await listMyTickets(t(), F.asha!); // a Raipur request
    await expect(
      staffReplyTicket(t(), replyScope, {
        staffUserId: F.staff!,
        code: asha!.code,
        body: 'Hi',
        internal: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a reply asks the customer; an internal note does not; the customer’s answer brings it back', async () => {
    const [asha] = await listMyTickets(t(), F.asha!);
    const code = asha!.code;
    await staffReplyTicket(t(), ALL, {
      staffUserId: F.staff!,
      code,
      body: 'Checking with the shop.',
      internal: true,
    });
    expect((await getMyTicket(t(), F.asha!, code)).status).toBe('open');
    expect((await getMyTicket(t(), F.asha!, code)).messages.some((m) => m.internal)).toBe(false); // hidden
    expect((await getInboxTicket(t(), ALL, code)).messages.some((m) => m.internal)).toBe(true);

    await staffReplyTicket(t(), ALL, {
      staffUserId: F.staff!,
      code,
      body: 'Please send a photo.',
      internal: false,
    });
    expect((await getMyTicket(t(), F.asha!, code)).status).toBe('awaiting_customer');
    expect((await listInbox(t(), ALL)).find((r) => r.code === code)?.acknowledged).toBe(true);
    expect(await customerReplyTicket(t(), { userId: F.asha!, code, body: 'Sent.' })).toEqual({
      status: 'in_review',
    });

    const { version } = await getInboxTicket(t(), ALL, code);
    await setTicketStatus(t(), ALL, {
      staffUserId: F.staff!,
      code,
      to: 'resolved',
      expectedVersion: version,
    });
    await expect(
      setTicketStatus(t(), ALL, { staffUserId: F.staff!, code, to: 'closed', expectedVersion: version }),
    ).rejects.toMatchObject({ code: 'STALE_TICKET' });
    await expect(
      setTicketStatus(t(), ALL, {
        staffUserId: F.staff!,
        code,
        to: 'awaiting_customer',
        expectedVersion: version + 1,
      }),
    ).rejects.toThrow(); // not a legal move from resolved
  });

  it('a reply to a WhatsApp request queues the ticket.replied WhatsApp when switched on', async () => {
    await db.insert(s.supportTickets).values({
      code: 'REQ-RPR-2026-WAPP01',
      guestPhone: '+919811111111',
      accessKeyHash: 'a'.repeat(64),
      kind: 'other',
      channel: 'whatsapp',
      slaAckDue: new Date(Date.now() + 3_600_000),
      slaResolveDue: new Date(Date.now() + 86_400_000),
    });
    await staffReplyTicket(t(), ALL, {
      staffUserId: F.staff!,
      code: 'REQ-RPR-2026-WAPP01',
      body: 'Yes, we do.',
      internal: false,
    });
    expect(await db.$count(s.notificationOutbox)).toBe(0); // switched off
    for (const locale of ['en', 'hi'] as const) {
      await saveNotificationTemplate(t(), {
        key: 'ticket.replied',
        channel: 'whatsapp',
        locale,
        body: 'Support replied to {{1}}.',
        enabled: true,
        expectedVersion: null,
        staffUserId: F.staff!,
      });
    }
    await staffReplyTicket(t(), ALL, {
      staffUserId: F.staff!,
      code: 'REQ-RPR-2026-WAPP01',
      body: 'Delivery tomorrow.',
      internal: false,
    });
    const [queued] = await db.select().from(s.notificationOutbox);
    expect(queued).toMatchObject({
      templateKey: 'ticket.replied',
      recipient: '+919811111111',
      payload: { ticketCode: 'REQ-RPR-2026-WAPP01' },
    });
    await db.execute(sql`delete from notification_outbox`);
  });
});
