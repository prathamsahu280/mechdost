/**
 * Guest tickets (design 2026-11-15 item 6; spec 09, 13): a private key shown once and stored only as a hash, view and
 * reply with reference + key only, wrong key and unknown reference look identical, nothing is ever sent to what a
 * guest typed (no email, no message to the typed number), internal notes stay hidden.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createGuestTicket,
  getGuestTicket,
  getInboxTicket,
  guestReplyTicket,
  setTicketStatus,
  staffReplyTicket,
  autoCloseResolvedTickets,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let staffId = '';
const t = () => db as unknown as Tx;
const ALL = { all: true } as const;
const guest = {
  name: 'Mohan Lal',
  phone: '+919811122233',
  kind: 'other' as const,
  body: 'Where is my parcel?',
};
let seq = 0;
const g = () => ({ ...guest, phone: `+91980000${String(++seq).padStart(4, '0')}` });
const row = async (code: string) =>
  (await db.select().from(s.supportTickets).where(eq(s.supportTickets.code, code)))[0]!;
const outbox = async () => [
  ...(await db.select().from(s.notificationOutbox)),
  ...(await db.select().from(s.notifications)),
];

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  await db.insert(s.cities).values({
    stateId: state!.id,
    code: 'RPR',
    slug: 'raipur',
    name: 'Raipur',
    status: 'live',
    centroid: { lng: 81.64, lat: 21.227 },
  });
  staffId = (await db.insert(s.users).values({ firebaseUid: 'fb-guest-staff' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('guest tickets', () => {
  it('creates a ticket with a reference and a private key; only the key hash is stored', async () => {
    const outboxBefore = (await db.select().from(s.notificationOutbox)).length;
    const made = await createGuestTicket(t(), { ...guest, defaultCityCode: 'RPR' });
    expect(made.code).toMatch(/^REQ-RPR-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(made.accessKey).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    const r = await row(made.code);
    expect(r.userId).toBeNull();
    expect(r.guestPhone).toBe('+919811122233');
    expect(r.accessKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r)).not.toContain(made.accessKey.replace(/-/g, ''));
    // Never an email or a message to what the guest typed: no outbox row at all (the staff bell is a separate table).
    expect(await db.select().from(s.notificationOutbox)).toHaveLength(outboxBefore);
  });

  it('views and replies with reference + key; the dashes and case of the key do not matter', async () => {
    const { code, accessKey } = await createGuestTicket(t(), { ...g(), defaultCityCode: 'RPR' });
    const view = await getGuestTicket(t(), code, accessKey.toLowerCase().replace(/-/g, ' '));
    expect(view.messages.map((m) => m.body)).toEqual(['Where is my parcel?']);
    await guestReplyTicket(t(), { code, key: accessKey, body: 'Any news?' });
    expect((await getGuestTicket(t(), code, accessKey)).messages).toHaveLength(2);
  });

  it('a wrong key and an unknown reference are the same "not found"', async () => {
    const { code, accessKey } = await createGuestTicket(t(), { ...g(), defaultCityCode: 'RPR' });
    const wrong = await getGuestTicket(t(), code, 'AAAA-AAAA-AAAA-AAAA').catch((e: unknown) => e);
    const unknown = await getGuestTicket(t(), 'REQ-RPR-2026-ZZZZZZ', accessKey).catch((e: unknown) => e);
    expect(wrong).toMatchObject({ code: 'NOT_FOUND' });
    expect(unknown).toMatchObject({ code: 'NOT_FOUND' });
    expect((wrong as Error).message).toBe((unknown as Error).message);
    await expect(
      guestReplyTicket(t(), { code, key: 'AAAA-AAAA-AAAA-AAAA', body: 'hi' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a key of one ticket does not open another; a signed-in customer’s ticket is not reachable as a guest', async () => {
    const a = await createGuestTicket(t(), { ...g(), defaultCityCode: 'RPR' });
    const b = await createGuestTicket(t(), { ...g(), defaultCityCode: 'RPR' });
    await expect(getGuestTicket(t(), a.code, b.accessKey)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const user = (await db.insert(s.users).values({ firebaseUid: 'fb-guest-cust' }).returning())[0]!.id;
    const [mine] = await db
      .insert(s.supportTickets)
      .values({
        code: 'REQ-RPR-2026-CUST01',
        userId: user,
        kind: 'other',
        slaAckDue: new Date(),
        slaResolveDue: new Date(),
      })
      .returning();
    await expect(getGuestTicket(t(), mine!.code, a.accessKey)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('internal notes never reach the guest; staff replies do, and move the status', async () => {
    const { code, accessKey } = await createGuestTicket(t(), { ...g(), defaultCityCode: 'RPR' });
    const secret = 'INTERNAL-guest-looks-like-a-bot-5521';
    await staffReplyTicket(t(), ALL, { staffUserId: staffId, code, body: secret, internal: true });
    await staffReplyTicket(t(), ALL, {
      staffUserId: staffId,
      code,
      body: 'Checking with the courier.',
      internal: false,
    });
    const view = await getGuestTicket(t(), code, accessKey);
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(view.messages.map((m) => m.body)).toContain('Checking with the courier.');
    expect(view.status).toBe('awaiting_customer');
    const staff = await getInboxTicket(t(), ALL, code);
    expect(staff.staff).toMatchObject({ isGuest: true, customerName: 'Mohan Lal' });
    expect(staff.staff.customerPhoneMasked).not.toContain('9811122233');
    expect((await outbox()).some((n) => JSON.stringify(n).includes('9811122233'))).toBe(false);
  });

  it('a reply reopens a waiting or resolved ticket and a closed one refuses', async () => {
    const { code, accessKey } = await createGuestTicket(t(), { ...g(), defaultCityCode: 'RPR' });
    const r = await row(code);
    await setTicketStatus(t(), ALL, {
      staffUserId: staffId,
      code,
      to: 'resolved',
      expectedVersion: r.version,
    });
    await guestReplyTicket(t(), { code, key: accessKey, body: 'Not fixed' });
    expect((await row(code)).status).toBe('in_review');
    const r2 = await row(code);
    await setTicketStatus(t(), ALL, {
      staffUserId: staffId,
      code,
      to: 'resolved',
      expectedVersion: r2.version,
    });
    await db
      .update(s.supportTickets)
      .set({ resolvedAt: new Date(Date.now() - 9 * 86_400_000) })
      .where(eq(s.supportTickets.code, code));
    await autoCloseResolvedTickets(t(), new Date());
    await expect(guestReplyTicket(t(), { code, key: accessKey, body: 'Hello?' })).rejects.toMatchObject({
      code: 'TICKET_CLOSED',
    });
  });

  it('allows 3 tickets a day per phone number', async () => {
    const phone = '+919700000001';
    for (let i = 0; i < 3; i += 1) await createGuestTicket(t(), { ...guest, phone, defaultCityCode: 'RPR' });
    await expect(createGuestTicket(t(), { ...guest, phone, defaultCityCode: 'RPR' })).rejects.toMatchObject({
      code: 'GUEST_DAILY_LIMIT',
    });
  });

  it('refuses a bad phone number, an empty message and a kind a guest cannot use', async () => {
    await expect(
      createGuestTicket(t(), { ...guest, phone: '12345', defaultCityCode: 'RPR' }),
    ).rejects.toMatchObject({ code: 'GUEST_PHONE_INVALID' });
    await expect(
      createGuestTicket(t(), { ...guest, body: '  ', defaultCityCode: 'RPR' }),
    ).rejects.toMatchObject({ code: 'TICKET_BODY_EMPTY' });
    await expect(
      createGuestTicket(t(), { ...guest, kind: 'labour_redo' as never, defaultCityCode: 'RPR' }),
    ).rejects.toMatchObject({ code: 'TICKET_KIND' });
  });
});
