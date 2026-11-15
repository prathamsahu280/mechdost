/**
 * Support threads (design 2026-11-15 "Support next tier", items 1 to 3; spec 09): one open request per customer and
 * order or service job with an issue code, photo attachments on messages, the COD refund destination (encrypted,
 * masked, locked once a refund exists) and the manual refund request made from the ticket.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { istDateString } from '@mechdost/shared/time';
import { loadKeyring } from '../src/crypto';
import {
  createRefundFromTicket,
  createServiceRequest,
  customerReplyTicket,
  findTicketMediaForServing,
  getInboxTicket,
  getMyTicket,
  openSupportThread,
  saveTicketRefundDestination,
  setTicketStatus,
  staffReplyTicket,
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
const TODAY = istDateString(new Date());
const k = () => randomBytes(32).toString('base64');
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${k()}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: k(),
});
const upi = { kind: 'upi', upiId: 'ravi.kumar@okhdfcbank' } as const;
const bank = {
  kind: 'bank',
  accountName: 'Ravi Kumar',
  accountNumber: '123456789012',
  ifsc: 'HDFC0001234',
} as const;
let n = 0;
let shopId = '';

async function order(userId: string, method: 'cod' | 'online', status = 'delivered') {
  n += 1;
  const code = `MD-RPR-2026-TH${String(n).padStart(4, '0')}`;
  const [g] = await db
    .insert(s.orderGroups)
    .values({
      code,
      userId,
      cityId: f.raipur,
      paymentMethod: method,
      paymentStatus: method === 'cod' ? 'cod_pending' : 'paid',
      subtotalPaise: 50000,
      totalPaise: 50000,
      idempotencyKey: `thread-${code}-xxxxxxxxxx`,
    })
    .returning();
  await db.insert(s.orders).values({
    groupId: g!.id,
    subNo: 1,
    code: `${code}-1`,
    userId,
    cityId: f.raipur,
    status,
    shopId,
    shippingAddress: { line1: 'Sarona', pincode: '492001' },
    pincode: '492001',
    subtotalPaise: 50000,
    totalPaise: 50000,
  });
  return { group: code, sub: `${code}-1` };
}

const image = () => {
  const mediaId = randomUUID();
  const folder = randomUUID();
  return {
    mediaId,
    bucket: 'support-photos',
    path: `ticket/${folder}/${mediaId}.webp`,
    thumbPath: `ticket/${folder}/${mediaId}-thumb.webp`,
    width: 1200,
    height: 800,
    bytes: 90_000,
    thumbBytes: 12_000,
    sha256: randomBytes(32).toString('hex'),
  };
};

const open = (over: Record<string, unknown> = {}) =>
  openSupportThread(t(), {
    userId: f.customer,
    issueCode: 'wrong_part',
    orderCode: null,
    body: 'The part is not the one I ordered.',
    defaultCityCode: 'RPR',
    ...over,
  });

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  const [state] = await db.select().from(s.states).limit(1);
  const [shop] = await db
    .insert(s.shops)
    .values({
      name: 'Thread Auto Parts',
      nameHi: 'थ्रेड ऑटो पार्ट्स',
      phone: '+919800000001',
      addressLine: 'Raipur',
      pincode: '492001',
      cityId: f.raipur,
      stateId: state!.id,
      location: { lng: 81.641, lat: 21.227 },
      status: 'approved',
    })
    .returning();
  shopId = shop!.id;
}, 60_000);

// The daily limit (5 requests) is its own rule (support.test.ts): age every earlier request out of its window.
beforeEach(async () => {
  await db.update(s.supportTickets).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) });
});

afterAll(async () => {
  await client.close();
});

describe('one thread per order', () => {
  it('opens with an issue code, the city and the first message, and a second tap continues the same thread', async () => {
    const o = await order(f.customer, 'online');
    const first = await open({ orderCode: o.group, issueCode: 'damaged' });
    expect(first.reopened).toBe(false);
    const view = await getMyTicket(t(), f.customer, first.code);
    expect(view).toMatchObject({ kind: 'order_issue', issueCode: 'damaged', orderCode: o.group });
    expect(view.messages).toHaveLength(1);
    const again = await open({ orderCode: o.group, issueCode: 'late', body: 'Any news?' });
    expect(again).toEqual({ code: first.code, reopened: true });
    expect((await getMyTicket(t(), f.customer, first.code)).messages).toHaveLength(2);
    const rows = await db.select().from(s.supportTickets).where(eq(s.supportTickets.code, first.code));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ issueCode: 'damaged' });
  });

  it('moves a resolved thread back to review when the customer writes again; a closed one frees the slot', async () => {
    const o = await order(f.customer, 'online');
    const { code } = await open({ orderCode: o.group });
    const mine = await getMyTicket(t(), f.customer, code);
    const resolved = await setTicketStatus(t(), ALL, {
      staffUserId: f.staff,
      code,
      to: 'resolved',
      expectedVersion: mine.version,
    });
    expect(resolved.status).toBe('resolved');
    const back = await open({ orderCode: o.group, body: 'Still broken.' });
    expect(back).toEqual({ code, reopened: true });
    expect((await getMyTicket(t(), f.customer, code)).status).toBe('in_review');
    // resolved -> closed by an admin, then the customer needs a new thread
    const cur = await getMyTicket(t(), f.customer, code);
    await setTicketStatus(t(), ALL, {
      staffUserId: f.staff,
      code,
      to: 'resolved',
      expectedVersion: cur.version,
    });
    const after = await getMyTicket(t(), f.customer, code);
    await setTicketStatus(t(), ALL, {
      staffUserId: f.staff,
      code,
      to: 'closed',
      expectedVersion: after.version,
    });
    const fresh = await open({ orderCode: o.group, body: 'A new problem.' });
    expect(fresh.reopened).toBe(false);
    expect(fresh.code).not.toBe(code);
  });

  it('parallel opens make exactly one thread', async () => {
    const o = await order(f.customer, 'online');
    const results = await Promise.all([1, 2, 3].map(() => open({ orderCode: o.group })));
    expect(new Set(results.map((r) => r.code)).size).toBe(1);
    expect(results.filter((r) => !r.reopened)).toHaveLength(1);
  });

  it('the database refuses a second open thread for the same order even if the code were wrong', async () => {
    const o = await order(f.customer, 'online');
    const { code } = await open({ orderCode: o.group });
    const [row] = await db.select().from(s.supportTickets).where(eq(s.supportTickets.code, code));
    await expect(
      db.insert(s.supportTickets).values({
        code: `${code}-X`,
        userId: f.customer,
        kind: 'order_issue',
        issueCode: 'late',
        orderId: row!.orderId,
        slaAckDue: new Date(),
        slaResolveDue: new Date(),
      }),
    ).rejects.toThrow();
  });

  it('refuses a foreign order, both or neither subject, and an issue that does not fit', async () => {
    const theirs = await order(f.other, 'online');
    await expect(open({ orderCode: theirs.group })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(open({})).rejects.toMatchObject({ code: 'SUBJECT_REQUIRED' });
    await expect(
      open({ orderCode: 'MD-RPR-2026-AAAAAA', serviceCode: 'SR-RPR-2026-AAAAAA' }),
    ).rejects.toMatchObject({
      code: 'SUBJECT_REQUIRED',
    });
    const mine = await order(f.customer, 'online');
    await expect(open({ orderCode: mine.group, issueCode: 'workshop_issue' })).rejects.toMatchObject({
      code: 'ISSUE_NOT_FOR_SUBJECT',
    });
  });

  it('a service job gets its own thread with the workshop issue code; someone else’s job is 404', async () => {
    const w = await addWorkshop(db, f, { name: 'Thread Workshop' });
    const job = await createServiceRequest(t(), {
      userId: f.customer,
      idempotencyKey: 'thread-job-key-000001',
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
        preferredDate: TODAY,
        preferredSlot: 'morning',
        pickup: false,
      },
    });
    const made = await open({ serviceCode: job.code, issueCode: 'workshop_issue', body: 'They were rude.' });
    const view = await getMyTicket(t(), f.customer, made.code);
    expect(view).toMatchObject({
      kind: 'service_issue',
      issueCode: 'workshop_issue',
      serviceCode: job.code,
      orderCode: null,
    });
    await expect(
      openSupportThread(t(), {
        userId: f.other,
        issueCode: 'workshop_issue',
        serviceCode: job.code,
        body: 'Not mine',
        defaultCityCode: 'RPR',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('photo attachments', () => {
  it('stores up to four photos per message, lists them on the thread for both sides, serves keys by id only', async () => {
    const o = await order(f.customer, 'online');
    const imgs = [image(), image()];
    const { code } = await open({ orderCode: o.group, images: imgs });
    const mine = await getMyTicket(t(), f.customer, code);
    expect(mine.messages[0]?.attachments.map((a) => a.mediaId)).toEqual(imgs.map((i) => i.mediaId));
    const staff = await getInboxTicket(t(), ALL, code);
    expect(staff.messages[0]?.attachments).toHaveLength(2);
    const served = await findTicketMediaForServing(t(), imgs[0]!.mediaId);
    expect(served).toMatchObject({ path: imgs[0]!.path });
    expect(await findTicketMediaForServing(t(), randomUUID())).toBeNull();
    // a reply with photos
    await customerReplyTicket(t(), { userId: f.customer, code, body: 'More', images: [image()] });
    const again = await getMyTicket(t(), f.customer, code);
    expect(again.messages.at(-1)?.attachments).toHaveLength(1);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'ticket.photos_added'));
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a fifth photo and a message with photos on a closed or foreign request', async () => {
    const o = await order(f.customer, 'online');
    await expect(open({ orderCode: o.group, images: [1, 2, 3, 4, 5].map(image) })).rejects.toMatchObject({
      code: 'ATTACHMENT_LIMIT',
    });
    const { code } = await open({ orderCode: o.group });
    await expect(
      customerReplyTicket(t(), { userId: f.other, code, body: 'x', images: [image()] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a photo of a soft-deleted message object is not served', async () => {
    const o = await order(f.customer, 'online');
    const img = image();
    await open({ orderCode: o.group, images: [img] });
    await db.update(s.mediaObjects).set({ deletedAt: new Date() }).where(eq(s.mediaObjects.id, img.mediaId));
    expect(await findTicketMediaForServing(t(), img.mediaId)).toBeNull();
  });
});

describe('COD refund destination', () => {
  it('stores it encrypted, shows it masked, never in the staff view in full', async () => {
    const o = await order(f.customer, 'cod');
    const { code } = await open({ orderCode: o.group });
    expect((await getMyTicket(t(), f.customer, code)).refund).toEqual({ eligible: true, destination: null });
    const saved = await saveTicketRefundDestination(t(), {
      userId: f.customer,
      code,
      destination: upi,
      keyring,
    });
    expect(saved).toEqual({ kind: 'upi', masked: 'ra***@okhdfcbank' });
    const [row] = await db.select().from(s.supportTickets).where(eq(s.supportTickets.code, code));
    expect(row!.refundDestinationEnc).toMatch(/^v1\./);
    expect(row!.refundDestinationEnc).not.toContain('ravi');
    expect(row!.refundDestinationMask).toBe('ra***@okhdfcbank');
    const staff = await getInboxTicket(t(), ALL, code);
    expect(JSON.stringify(staff)).not.toContain('ravi.kumar');
    expect(staff.refund.destination).toEqual({ kind: 'upi', masked: 'ra***@okhdfcbank' });
    const replaced = await saveTicketRefundDestination(t(), {
      userId: f.customer,
      code,
      destination: bank,
      keyring,
    });
    expect(replaced).toEqual({ kind: 'bank', masked: '••••9012 · HDFC0001234' });
    const log = await db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.action, 'ticket.refund_destination_saved'));
    expect(JSON.stringify(log)).not.toContain('123456789012');
    expect(JSON.stringify(log)).not.toContain('ravi.kumar');
  });

  it('is only for the customer’s own request on a cash on delivery order', async () => {
    const paid = await order(f.customer, 'online');
    const online = await open({ orderCode: paid.group });
    await expect(
      saveTicketRefundDestination(t(), { userId: f.customer, code: online.code, destination: upi, keyring }),
    ).rejects.toMatchObject({ code: 'DESTINATION_NOT_COD' });
    const cod = await order(f.customer, 'cod');
    const mine = await open({ orderCode: cod.group });
    await expect(
      saveTicketRefundDestination(t(), { userId: f.other, code: mine.code, destination: upi, keyring }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('staff create the bank_upi refund from the ticket; the destination then locks', async () => {
    const o = await order(f.customer, 'cod');
    const { code } = await open({ orderCode: o.group });
    const input = {
      ticketScope: ALL,
      refundScope: ALL,
      staffUserId: f.staff,
      code,
      amountPaise: 2_000,
      reasonCode: 'faulty' as const,
      idempotencyKey: `from-ticket-${code}-1`,
      keyring,
    };
    await expect(createRefundFromTicket(t(), input)).rejects.toMatchObject({
      code: 'REFUND_NEEDS_DESTINATION',
    });
    await saveTicketRefundDestination(t(), { userId: f.customer, code, destination: upi, keyring });
    const made = await createRefundFromTicket(t(), input);
    expect(made.replay).toBe(false);
    expect(made.refund).toMatchObject({
      mode: 'bank_upi',
      status: 'requested',
      destinationMasked: 'ra***@okhdfcbank',
    });
    const again = await createRefundFromTicket(t(), input);
    expect(again.replay).toBe(true);
    expect(again.refund.id).toBe(made.refund.id);
    await expect(
      saveTicketRefundDestination(t(), { userId: f.customer, code, destination: bank, keyring }),
    ).rejects.toMatchObject({ code: 'DESTINATION_LOCKED' });
    const log = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'ticket.refund_requested'));
    expect(log.length).toBeGreaterThanOrEqual(1);
  });

  it('staff outside the ticket’s city scope get 404', async () => {
    const o = await order(f.customer, 'cod');
    const { code } = await open({ orderCode: o.group });
    await saveTicketRefundDestination(t(), { userId: f.customer, code, destination: upi, keyring });
    await expect(
      createRefundFromTicket(t(), {
        ticketScope: { all: false, cityIds: [f.bhilai] },
        refundScope: ALL,
        staffUserId: f.staff,
        code,
        amountPaise: 1_000,
        reasonCode: 'faulty',
        idempotencyKey: `from-ticket-${code}-2`,
        keyring,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('staff replies still reach the thread', () => {
  it('a staff reply moves the thread to awaiting the customer and shows in the customer’s view', async () => {
    const o = await order(f.customer, 'online');
    const { code } = await open({ orderCode: o.group });
    await staffReplyTicket(t(), ALL, {
      staffUserId: f.staff,
      code,
      body: 'We are checking.',
      internal: false,
    });
    const view = await getMyTicket(t(), f.customer, code);
    expect(view.status).toBe('awaiting_customer');
    expect(view.messages.at(-1)).toMatchObject({ role: 'staff', attachments: [] });
  });
});
