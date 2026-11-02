/**
 * Inbound WhatsApp → support tickets (spec 09): one ticket per conversation, never a duplicate message, a customer
 * reply reopens a waiting/resolved ticket through the state machine, guests get a ticket too.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { bridgeInboundWhatsApp, recordWebhookEvent, type Tx } from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let customer = '';
let n = 0;

async function inbound(from: string, text: string | null, type = 'text') {
  n += 1;
  await recordWebhookEvent(t(), {
    id: `wa:wamid.IN${String(n)}`,
    provider: 'whatsapp',
    type: 'message',
    status: 'received',
    payload: { from, type, timestamp: '1793612460', text },
  });
  return `wamid.IN${String(n)}`;
}

const bridge = () => bridgeInboundWhatsApp(t(), { cityCode: 'RPR' });

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  customer = (
    await db.insert(s.users).values({ firebaseUid: 'fb-bridge', phone: '+919876543210' }).returning()
  )[0]!.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.execute(sql`delete from ticket_messages`);
  await db.execute(sql`delete from support_tickets`);
});

describe('WhatsApp → support tickets', () => {
  it('a customer’s messages land in one new ticket, in order, marked as WhatsApp', async () => {
    await inbound('919876543210', 'Where is my order?');
    await inbound('919876543210', null, 'image');
    expect(await bridge()).toMatchObject({ processed: 2, created: 1, appended: 1 });
    const [ticket] = await db.select().from(s.supportTickets);
    expect(ticket).toMatchObject({ userId: customer, status: 'open', kind: 'other' });
    expect(ticket?.code).toMatch(/^REQ-RPR-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
    const messages = await db.select().from(s.ticketMessages).orderBy(s.ticketMessages.createdAt);
    expect(messages.map((m) => [m.body, m.channel, m.authorRole])).toEqual([
      ['Where is my order?', 'whatsapp', 'customer'],
      ['[image]', 'whatsapp', 'customer'],
    ]);
    expect(await db.$count(s.auditLog, eq(s.auditLog.action, 'ticket.created'))).toBe(1);
  });

  it('never stores the same WhatsApp message twice (Meta redelivery / job retry)', async () => {
    const wamid = await inbound('919876543210', 'Hello');
    await bridge();
    // Simulate the job crashing after the insert but before marking the event processed.
    await db
      .update(s.webhookEvents)
      .set({ status: 'received' })
      .where(eq(s.webhookEvents.id, `wa:${wamid}`));
    expect(await bridge()).toMatchObject({ processed: 1, skipped: 1 });
    expect(await db.$count(s.ticketMessages)).toBe(1);
  });

  it('a reply to a ticket waiting on the customer, or resolved in the last week, brings it back to review', async () => {
    await inbound('919876543210', 'My battery is faulty');
    await bridge();
    await db.update(s.supportTickets).set({ status: 'awaiting_customer' });
    await inbound('919876543210', 'Here is the photo');
    await bridge();
    expect((await db.select().from(s.supportTickets))[0]?.status).toBe('in_review');

    await db.update(s.supportTickets).set({ status: 'resolved', resolvedAt: new Date() });
    await inbound('919876543210', 'It failed again');
    expect(await bridge()).toMatchObject({ appended: 1, created: 0 });
    expect(await db.$count(s.supportTickets)).toBe(1);
    expect((await db.select().from(s.supportTickets))[0]).toMatchObject({
      status: 'in_review',
      resolvedAt: null,
    });

    // Resolved long ago, or closed: a new message starts a new ticket.
    await db.update(s.supportTickets).set({ status: 'closed' });
    await inbound('919876543210', 'New question');
    expect(await bridge()).toMatchObject({ created: 1 });
    expect(await db.$count(s.supportTickets)).toBe(2);
  });

  it('an unknown number gets a guest ticket; a malformed sender is parked, not lost', async () => {
    await inbound('919811111111', 'Do you sell tyres?');
    await inbound('not-a-number', 'x');
    expect(await bridge()).toMatchObject({ created: 1, skipped: 1 });
    const [ticket] = await db.select().from(s.supportTickets);
    expect(ticket).toMatchObject({ userId: null, guestPhone: '+919811111111' });
    expect(ticket?.accessKeyHash).toMatch(/^[0-9a-f]{64}$/);
    const parked = await db.select().from(s.webhookEvents).where(eq(s.webhookEvents.status, 'parked'));
    expect(parked.map((e) => e.error)).toEqual(['bad_sender']);
  });
});
