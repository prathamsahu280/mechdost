/**
 * Support inbox tools (design 2026-11-15 item 4 to 5; spec 09): assignment, canned replies, first-reply SLA in
 * support hours (IST), internal notes that never reach the customer, and the worker's auto-close of resolved
 * requests (clock test).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  assignTicket,
  autoCloseResolvedTickets,
  createSupportTicket,
  customerReplyTicket,
  getInboxTicket,
  getMyTicket,
  insertUserRole,
  listAssignableAgents,
  listCannedReplies,
  listInbox,
  listMyTickets,
  saveCannedReply,
  setTicketStatus,
  staffReplyTicket,
  syncRbacCatalogue,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};
const ALL = { all: true } as const;
const BOTH = { reply: ALL, assign: ALL } as const;
const NONE = { all: false, cityIds: [] as string[] };
const ist = (iso: string) => new Date(`${iso}+05:30`);
const DAY = 86_400_000;

async function raise(userId: string, now?: Date, body = 'Brake pads do not fit.') {
  return createSupportTicket(t(), {
    userId,
    kind: 'other',
    orderCode: null,
    body,
    defaultCityCode: 'RPR',
    ...(now ? { now } : {}),
  });
}
let seq = 0;
/** A customer who has raised nothing yet (the daily limit is per customer). */
async function freshCustomer(name = 'Customer') {
  seq += 1;
  return (
    await db
      .insert(s.users)
      .values({ firebaseUid: `fb-inbox-c${String(seq)}`, name })
      .returning()
  )[0]!.id;
}
/** A request tied to a city (a request without an order has none, so only all-city agents can take it). */
async function raiseIn(cityId: string, userId?: string) {
  const { code } = await raise(userId ?? (await freshCustomer()));
  await db.update(s.supportTickets).set({ cityId }).where(eq(s.supportTickets.code, code));
  return code;
}
const row = async (code: string) =>
  (await db.select().from(s.supportTickets).where(eq(s.supportTickets.code, code)))[0]!;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
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
  const user = async (uid: string, name: string) =>
    (await db.insert(s.users).values({ firebaseUid: uid, name }).returning())[0]!.id;
  F.asha = await user('fb-inbox-asha', 'Asha Verma');
  F.agent = await user('fb-inbox-agent', 'Agent Meera');
  F.agentBls = await user('fb-inbox-agent-bls', 'Agent Bilaspur');
  F.lead = await user('fb-inbox-lead', 'Lead Kiran');
  await insertUserRole(t(), { userId: F.agent, role: 'city_manager', cityId: F.raipur, grantedBy: F.lead });
  await insertUserRole(t(), {
    userId: F.agentBls,
    role: 'city_manager',
    cityId: F.bilaspur,
    grantedBy: F.lead,
  });
  await insertUserRole(t(), { userId: F.lead, role: 'support_agent', grantedBy: F.lead });
});

afterAll(async () => {
  await client.close();
});

describe('first-reply SLA (support hours, IST)', () => {
  it('a night-time request is due two working hours after the morning opening', async () => {
    const { code } = await raise(F.asha!, ist('2026-11-16T23:00:00'));
    expect((await row(code)).slaAckDue).toEqual(ist('2026-11-17T11:00:00'));
  });

  it('follows the admin settings (hours and target)', async () => {
    await db.insert(s.settings).values([
      { key: 'support.hours_start_minute', value: 600 },
      { key: 'support.hours_end_minute', value: 1080 },
      { key: 'support.first_reply_working_minutes', value: 60 },
    ]);
    const { code } = await raise(F.asha!, ist('2026-11-16T17:30:00'));
    expect((await row(code)).slaAckDue).toEqual(ist('2026-11-17T10:30:00'));
    await db.delete(s.settings).where(sql`key like 'support.%'`);
  });

  it('an internal note does not count as the first reply; the first public reply does, once', async () => {
    const { code } = await raise(F.asha!);
    await staffReplyTicket(t(), ALL, { staffUserId: F.agent!, code, body: 'Note to self', internal: true });
    expect((await row(code)).firstRepliedAt).toBeNull();
    await staffReplyTicket(t(), ALL, { staffUserId: F.agent!, code, body: 'Hello Asha', internal: false });
    const first = (await row(code)).firstRepliedAt;
    expect(first).not.toBeNull();
    await customerReplyTicket(t(), { userId: F.asha!, code, body: 'Thanks' });
    await staffReplyTicket(t(), ALL, {
      staffUserId: F.agent!,
      code,
      body: 'Anything else?',
      internal: false,
    });
    expect((await row(code)).firstRepliedAt).toEqual(first);
  });
});

describe('role leak: internal notes', () => {
  it('never appear in the customer views, never send a customer email, never move the status', async () => {
    const { code } = await raise(F.asha!);
    const secret = 'INTERNAL-SECRET-fraud-suspect-7781';
    const before = (await row(code)).status;
    const sent = async () => [
      ...(await db.select().from(s.notificationOutbox)),
      ...(await db.select().from(s.notifications)),
    ];
    const emails = await sent();
    await staffReplyTicket(t(), ALL, { staffUserId: F.agent!, code, body: secret, internal: true });
    expect((await row(code)).status).toBe(before);
    expect(JSON.stringify(await getMyTicket(t(), F.asha!, code))).not.toContain(secret);
    expect(JSON.stringify(await listMyTickets(t(), F.asha!))).not.toContain(secret);
    expect(JSON.stringify(await getInboxTicket(t(), ALL, code))).toContain(secret);
    const after = await sent();
    expect(JSON.stringify(after.slice(emails.length))).not.toContain(secret);
    expect(after.length).toBe(emails.length);
  });
});

describe('assignment', () => {
  it('assigns to a support agent of the ticket’s city, audited, with the name in the inbox', async () => {
    const asha = await freshCustomer('Asha Verma');
    const code = await raiseIn(F.raipur!, asha);
    const before = await row(code);
    const res = await assignTicket(t(), BOTH, {
      staffUserId: F.lead!,
      code,
      assigneeId: F.agent!,
      expectedVersion: before.version,
    });
    expect(res.version).toBe(before.version + 1);
    const after = await row(code);
    expect(after.assigneeId).toBe(F.agent);
    expect(after.assignedAt).not.toBeNull();
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, after.id));
    expect(audit.some((a) => a.action === 'ticket.assigned')).toBe(true);
    const inbox = await listInbox(t(), ALL, { assignee: 'me', staffUserId: F.agent! });
    expect(inbox.find((r) => r.code === code)).toMatchObject({
      customerName: 'Asha Verma',
      assignee: { id: F.agent, name: 'Agent Meera' },
    });
    expect(inbox.every((r) => r.assignee?.id === F.agent)).toBe(true);
    const unassigned = await listInbox(t(), ALL, { assignee: 'unassigned' });
    expect(unassigned.some((r) => r.code === code)).toBe(false);
  });

  it('refuses a customer, another city’s agent, a stale version; unassigning works', async () => {
    const code = await raiseIn(F.raipur!);
    const v = (await row(code)).version;
    await expect(
      assignTicket(t(), BOTH, { staffUserId: F.lead!, code, assigneeId: F.asha!, expectedVersion: v }),
    ).rejects.toMatchObject({ code: 'ASSIGNEE_INVALID' });
    // Bilaspur's agent has no reach into a Raipur request.
    await expect(
      assignTicket(t(), BOTH, { staffUserId: F.lead!, code, assigneeId: F.agentBls!, expectedVersion: v }),
    ).rejects.toMatchObject({ code: 'ASSIGNEE_INVALID' });
    await expect(
      assignTicket(t(), BOTH, { staffUserId: F.lead!, code, assigneeId: F.lead!, expectedVersion: v + 5 }),
    ).rejects.toMatchObject({ code: 'STALE_TICKET' });
    const ok = await assignTicket(t(), BOTH, {
      staffUserId: F.lead!,
      code,
      assigneeId: F.lead!,
      expectedVersion: v,
    });
    await assignTicket(t(), BOTH, {
      staffUserId: F.lead!,
      code,
      assigneeId: null,
      expectedVersion: ok.version,
    });
    expect((await row(code)).assigneeId).toBeNull();
  });

  it('staff outside the ticket’s scope get "not found"', async () => {
    const code = await raiseIn(F.raipur!);
    await expect(
      assignTicket(
        t(),
        { reply: { all: false, cityIds: [F.bilaspur!] }, assign: { all: false, cityIds: [F.bilaspur!] } },
        { staffUserId: F.agentBls!, code, assigneeId: F.agentBls!, expectedVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('without tickets:assign an agent may only take an unassigned request or release their own (security review)', async () => {
    const code = await raiseIn(F.raipur!);
    const v0 = (await row(code)).version;
    const agentOnly = { reply: ALL, assign: NONE };
    // Someone else holds it: the agent can neither unassign nor take it over.
    const held = await assignTicket(t(), BOTH, {
      staffUserId: F.lead!,
      code,
      assigneeId: F.lead!,
      expectedVersion: v0,
    });
    await expect(
      assignTicket(t(), agentOnly, {
        staffUserId: F.agent!,
        code,
        assigneeId: null,
        expectedVersion: held.version,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGN_NOT_ALLOWED' });
    await expect(
      assignTicket(t(), agentOnly, {
        staffUserId: F.agent!,
        code,
        assigneeId: F.agent!,
        expectedVersion: held.version,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGN_NOT_ALLOWED' });
    expect((await row(code)).assigneeId).toBe(F.lead);
    // The holder releases it; then an agent takes the unassigned request and releases it again.
    const freed = await assignTicket(t(), agentOnly, {
      staffUserId: F.lead!,
      code,
      assigneeId: null,
      expectedVersion: held.version,
    });
    const taken = await assignTicket(t(), agentOnly, {
      staffUserId: F.agent!,
      code,
      assigneeId: F.agent!,
      expectedVersion: freed.version,
    });
    expect((await row(code)).assigneeId).toBe(F.agent);
    await assignTicket(t(), agentOnly, {
      staffUserId: F.agent!,
      code,
      assigneeId: null,
      expectedVersion: taken.version,
    });
    expect((await row(code)).assigneeId).toBeNull();
    // Never to a third person.
    await expect(
      assignTicket(t(), agentOnly, {
        staffUserId: F.agent!,
        code,
        assigneeId: F.lead!,
        expectedVersion: (await row(code)).version,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGN_NOT_ALLOWED' });
  });

  it('tickets:assign is checked for the ticket’s own city, not widened by the reply scope (security review)', async () => {
    const bls = await raiseIn(F.bilaspur!);
    const v = (await row(bls)).version;
    const rprAssigner = { reply: ALL, assign: { all: false, cityIds: [F.raipur!] } };
    await expect(
      assignTicket(t(), rprAssigner, {
        staffUserId: F.agent!,
        code: bls,
        assigneeId: F.lead!,
        expectedVersion: v,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGN_NOT_ALLOWED' });
    // Not even visible to a staff member whose reply scope is Raipur only.
    const rprOnly = {
      reply: { all: false, cityIds: [F.raipur!] },
      assign: { all: false, cityIds: [F.raipur!] },
    };
    await expect(
      assignTicket(t(), rprOnly, {
        staffUserId: F.agent!,
        code: bls,
        assigneeId: F.lead!,
        expectedVersion: v,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // In its own city the same assigner may assign others.
    const rpr = await raiseIn(F.raipur!);
    await assignTicket(t(), rprAssigner, {
      staffUserId: F.agent!,
      code: rpr,
      assigneeId: F.lead!,
      expectedVersion: (await row(rpr)).version,
    });
    expect((await row(rpr)).assigneeId).toBe(F.lead);
  });

  it('lists the agents a scope may assign to (all-city agents always, city agents of the scope)', async () => {
    const all = await listAssignableAgents(t(), ALL);
    expect(all.map((a) => a.id).sort()).toEqual([F.agent, F.agentBls, F.lead].sort());
    const bls = await listAssignableAgents(t(), { all: false, cityIds: [F.bilaspur!] });
    expect(bls.map((a) => a.id).sort()).toEqual([F.agentBls, F.lead].sort());
  });
});

describe('canned replies', () => {
  it('seeds starter replies in both languages; the admin edits (version CAS) and switches off', async () => {
    const seeded = await listCannedReplies(t(), { includeInactive: false });
    expect(seeded.length).toBeGreaterThanOrEqual(5);
    expect(seeded.every((r) => r.titleHi.length > 0 && r.bodyHi.length > 0)).toBe(true);
    const created = await saveCannedReply(t(), {
      staffUserId: F.lead!,
      key: 'test_reply',
      titleEn: 'Test',
      titleHi: 'परीक्षण',
      bodyEn: 'English body',
      bodyHi: 'हिंदी पाठ',
      active: true,
      sortOrder: 5,
    });
    expect(created.version).toBe(1);
    const updated = await saveCannedReply(t(), {
      staffUserId: F.lead!,
      id: created.id,
      expectedVersion: 1,
      key: 'test_reply',
      titleEn: 'Test 2',
      titleHi: 'परीक्षण २',
      bodyEn: 'English body',
      bodyHi: 'हिंदी पाठ',
      active: false,
      sortOrder: 5,
    });
    expect(updated.version).toBe(2);
    await expect(
      saveCannedReply(t(), {
        staffUserId: F.lead!,
        id: created.id,
        expectedVersion: 1,
        key: 'test_reply',
        titleEn: 'x',
        titleHi: 'x',
        bodyEn: 'x',
        bodyHi: 'x',
        active: true,
        sortOrder: 5,
      }),
    ).rejects.toMatchObject({ code: 'STALE_CANNED_REPLY' });
    const active = await listCannedReplies(t(), { includeInactive: false });
    expect(active.some((r) => r.key === 'test_reply')).toBe(false);
    const all = await listCannedReplies(t(), { includeInactive: true });
    expect(all.some((r) => r.key === 'test_reply')).toBe(true);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entity, 'canned_reply'));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['canned_reply.created', 'canned_reply.updated']),
    );
  });

  it('refuses a duplicate key and an empty Hindi text', async () => {
    await expect(
      saveCannedReply(t(), {
        staffUserId: F.lead!,
        key: 'refund_started',
        titleEn: 'A',
        titleHi: 'ए',
        bodyEn: 'A',
        bodyHi: 'ए',
        active: true,
        sortOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'CANNED_REPLY_KEY_TAKEN' });
    await expect(
      saveCannedReply(t(), {
        staffUserId: F.lead!,
        key: 'no_hindi',
        titleEn: 'A',
        titleHi: ' ',
        bodyEn: 'A',
        bodyHi: 'ए',
        active: true,
        sortOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'CANNED_REPLY_INVALID' });
  });
});

describe('auto-close (worker, clock)', () => {
  async function resolvedAgo(days: number) {
    const asha = await freshCustomer();
    const { code } = await raise(asha);
    const r = await row(code);
    await setTicketStatus(t(), ALL, {
      staffUserId: F.agent!,
      code,
      to: 'resolved',
      expectedVersion: r.version,
    });
    await db
      .update(s.supportTickets)
      .set({ resolvedAt: new Date(Date.now() - days * DAY) })
      .where(eq(s.supportTickets.code, code));
    return { code, asha };
  }

  it('closes a ticket resolved 7+ days ago, leaves a newer one, and is idempotent', async () => {
    const { code: old } = await resolvedAgo(8);
    const { code: fresh } = await resolvedAgo(6);
    const first = await autoCloseResolvedTickets(t(), new Date());
    expect(first.closed).toBeGreaterThanOrEqual(1);
    expect((await row(old)).status).toBe('closed');
    expect((await row(old)).closeReason).toBe('auto');
    expect((await row(old)).closedAt).not.toBeNull();
    expect((await row(fresh)).status).toBe('resolved');
    expect((await autoCloseResolvedTickets(t(), new Date())).closed).toBe(0);
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(eq(s.auditLog.entityId, (await row(old)).id));
    expect(audit.find((a) => a.action === 'ticket.auto_closed')).toMatchObject({ actorUserId: null });
    // The clock moves: a week after "resolved" the fresh one closes too.
    await autoCloseResolvedTickets(t(), new Date(Date.now() + 2 * DAY));
    expect((await row(fresh)).status).toBe('closed');
  });

  it('a customer reply reopens before the close; a closed request stays closed', async () => {
    const { code, asha } = await resolvedAgo(8);
    await customerReplyTicket(t(), { userId: asha, code, body: 'Still broken' });
    expect((await row(code)).status).toBe('in_review');
    await autoCloseResolvedTickets(t(), new Date());
    expect((await row(code)).status).toBe('in_review');
  });

  it('uses the admin setting for the number of days', async () => {
    const { code } = await resolvedAgo(3);
    await autoCloseResolvedTickets(t(), new Date());
    expect((await row(code)).status).toBe('resolved');
    await db.insert(s.settings).values({ key: 'support.auto_close_days', value: 2 });
    await autoCloseResolvedTickets(t(), new Date());
    expect((await row(code)).status).toBe('closed');
    await db.delete(s.settings).where(eq(s.settings.key, 'support.auto_close_days'));
  });

  it('skips a ticket whose version changed under it (compare-and-set)', async () => {
    const { code } = await resolvedAgo(9);
    const r = await row(code);
    const closed = await autoCloseResolvedTickets(t(), new Date(), {
      beforeUpdate: async () => {
        await db.update(s.supportTickets).set({ priority: 'high' }).where(eq(s.supportTickets.id, r.id));
      },
    });
    expect((await row(code)).status).toBe('resolved');
    expect(closed.skipped).toBeGreaterThanOrEqual(1);
    await autoCloseResolvedTickets(t(), new Date());
    expect((await row(code)).status).toBe('closed');
  });
});
