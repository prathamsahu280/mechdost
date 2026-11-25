/**
 * The bell and the centre page as an inbox (spec 10, user 2026-11-25): unread and urgent first, then unread, then
 * read, newest first inside each group; a stable composite cursor; removed and done notices are not listed; the
 * person can remove one notice or clear all read with an Undo; the clean-up job deletes in batches; every
 * operation is scoped to the caller (404 for a foreign id); and removing pings the person's other devices.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  clearReadNotices,
  dismissNotice,
  listNotices,
  markNoticesRead,
  purgeFinishedNotices,
  queueNotice,
  restoreNotices,
  unreadNoticeCount,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};
let clock = 0;

interface Row {
  title: string;
  priority: 'urgent' | 'action' | 'info' | 'success';
  read?: boolean;
  /** Minutes ago. */
  age: number;
  userId?: string;
  resolved?: boolean;
  dismissed?: boolean;
}

async function put(r: Row) {
  clock += 1;
  const at = new Date(Date.now() - r.age * 60_000);
  const [row] = await db
    .insert(s.notifications)
    .values({
      userId: r.userId ?? F.me!,
      kind: 'order.placed',
      title: r.title,
      body: 'body',
      priority: r.priority,
      createdAt: at,
      readAt: r.read ? at : null,
      resolvedAt: r.resolved ? at : null,
      dismissedAt: r.dismissed ? at : null,
      dedupeKey: `k${String(clock)}`,
    })
    .returning();
  return row!;
}

const titles = async (userId = F.me!) =>
  (await listNotices(t(), userId, { limit: 50 })).notices.map((n) => n.title);

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const user = async (uid: string) =>
    (await db.insert(s.users).values({ firebaseUid: uid, language: 'en' }).returning())[0]!.id;
  F.me = await user('fb-inbox-me');
  F.other = await user('fb-inbox-other');
});
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  await db.execute(sql`delete from notifications`);
  await db.execute(sql`delete from live_outbox`);
});

describe('order: unread urgent, unread, read; newest first inside each', () => {
  it('sorts the three groups, then by time', async () => {
    await put({ title: 'read-new', priority: 'info', read: true, age: 1 });
    await put({ title: 'unread-old', priority: 'info', age: 50 });
    await put({ title: 'urgent-old', priority: 'urgent', age: 90 });
    await put({ title: 'unread-new', priority: 'action', age: 5 });
    await put({ title: 'urgent-new', priority: 'urgent', age: 10 });
    await put({ title: 'read-old-urgent', priority: 'urgent', read: true, age: 200 });
    expect(await titles()).toEqual([
      'urgent-new',
      'urgent-old',
      'unread-new',
      'unread-old',
      'read-new',
      'read-old-urgent',
    ]);
  });

  it('reading an urgent notice moves it below the unread ones', async () => {
    const u = await put({ title: 'u', priority: 'urgent', age: 3 });
    await put({ title: 'a', priority: 'action', age: 2 });
    expect(await titles()).toEqual(['u', 'a']);
    await markNoticesRead(t(), F.me!, { ids: [u.id] });
    expect(await titles()).toEqual(['a', 'u']);
  });

  it('carries the priority code on each notice', async () => {
    await put({ title: 'x', priority: 'success', age: 1 });
    const [n] = (await listNotices(t(), F.me!, {})).notices;
    expect(n?.priority).toBe('success');
  });

  it('does not list removed or done notices, and the unread count ignores them', async () => {
    await put({ title: 'shown', priority: 'info', age: 1 });
    await put({ title: 'removed', priority: 'info', age: 2, dismissed: true });
    await put({ title: 'done', priority: 'action', age: 3, resolved: true });
    expect(await titles()).toEqual(['shown']);
    expect(await unreadNoticeCount(t(), F.me!)).toBe(1);
  });
});

describe('cursor stays stable under the group order', () => {
  it('pages through every row once, with ties on the same time', async () => {
    const tie = new Date(Date.now() - 600_000);
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const priority = i % 3 === 0 ? 'urgent' : 'info';
      const [row] = await db
        .insert(s.notifications)
        .values({
          userId: F.me!,
          kind: 'order.placed',
          title: `n${String(i)}`,
          body: 'b',
          priority,
          createdAt: tie,
          readAt: i % 2 === 0 ? tie : null,
        })
        .returning();
      ids.push(row!.id);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await listNotices(t(), F.me!, { limit: 2, cursor });
      seen.push(...page.notices.map((n) => n.id));
      pages += 1;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(pages).toBe(4);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...ids].sort());
    const full = (await listNotices(t(), F.me!, { limit: 50 })).notices.map((n) => n.id);
    expect(seen).toEqual(full);
  });

  it('a group boundary falls between pages without losing a row', async () => {
    await put({ title: 'a', priority: 'urgent', age: 1 });
    await put({ title: 'b', priority: 'urgent', age: 2 });
    await put({ title: 'c', priority: 'info', age: 3 });
    await put({ title: 'd', priority: 'info', read: true, age: 4 });
    const p1 = await listNotices(t(), F.me!, { limit: 2 });
    const p2 = await listNotices(t(), F.me!, { limit: 2, cursor: p1.nextCursor ?? undefined });
    expect([...p1.notices, ...p2.notices].map((n) => n.title)).toEqual(['a', 'b', 'c', 'd']);
    expect(p2.nextCursor).toBeNull();
  });

  it('rejects a cursor that is not ours', async () => {
    const old = Buffer.from(JSON.stringify({ k: '2026-11-10 12:00:00+00', id: F.me })).toString('base64url');
    await expect(listNotices(t(), F.me!, { cursor: old })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('uses the inbox index for the ordering', async () => {
    for (let i = 0; i < 30; i += 1) await put({ title: `p${String(i)}`, priority: 'info', age: i });
    await db.execute(sql`set enable_seqscan = off`);
    const plan = await db.execute(sql`explain select id from notifications
      where user_id = ${F.me} and dismissed_at is null and resolved_at is null
      order by (case when read_at is null then (case when priority = 'urgent' then 0 else 1 end) else 2 end),
               created_at desc, id desc limit 11`);
    await db.execute(sql`set enable_seqscan = on`);
    expect(JSON.stringify(plan)).toContain('notifications_inbox_idx');
    expect(JSON.stringify(plan)).not.toContain('"Sort');
  });
});

describe('removing', () => {
  it('removes one notice, counts it as read, and gives a token that brings it back', async () => {
    const a = await put({ title: 'a', priority: 'urgent', age: 1 });
    await put({ title: 'b', priority: 'info', age: 2 });
    const res = await dismissNotice(t(), F.me!, a.id);
    expect(res.unread).toBe(1);
    expect(await titles()).toEqual(['b']);
    const back = await restoreNotices(t(), F.me!, res.undoToken);
    expect(back.restored).toBe(1);
    // it was unread-urgent before; removing counted it as read, so it returns as read
    expect(await titles()).toEqual(['b', 'a']);
  });

  it('removing twice is harmless; an unknown or foreign id is 404', async () => {
    const a = await put({ title: 'a', priority: 'info', age: 1 });
    const first = await dismissNotice(t(), F.me!, a.id);
    const second = await dismissNotice(t(), F.me!, a.id);
    expect(second.undoToken).toBe(first.undoToken);
    const theirs = await put({ title: 'theirs', priority: 'info', age: 1, userId: F.other! });
    await expect(dismissNotice(t(), F.me!, theirs.id)).rejects.toMatchObject({ status: 404 });
    await expect(dismissNotice(t(), F.me!, '019a0000-0000-7000-8000-000000000000')).rejects.toMatchObject({
      status: 404,
    });
    const [still] = await db.select().from(s.notifications).where(eq(s.notifications.id, theirs.id));
    expect(still?.dismissedAt).toBeNull();
  });

  it('clear all read removes only the caller’s read notices, and Undo restores exactly that batch', async () => {
    await put({ title: 'r1', priority: 'info', read: true, age: 1 });
    await put({ title: 'r2', priority: 'urgent', read: true, age: 2 });
    await put({ title: 'u1', priority: 'info', age: 3 });
    await put({ title: 'theirs', priority: 'info', read: true, age: 1, userId: F.other! });
    const gone = await put({ title: 'earlier', priority: 'info', read: true, age: 4, dismissed: true });
    const res = await clearReadNotices(t(), F.me!);
    expect(res.cleared).toBe(2);
    expect(res.unread).toBe(1);
    expect(await titles()).toEqual(['u1']);
    expect(await titles(F.other)).toEqual(['theirs']);
    const back = await restoreNotices(t(), F.me!, String(res.undoToken));
    expect(back.restored).toBe(2);
    expect(await titles()).toEqual(['u1', 'r1', 'r2']);
    const [earlier] = await db.select().from(s.notifications).where(eq(s.notifications.id, gone.id));
    expect(earlier?.dismissedAt).not.toBeNull();
  });

  it('clear all read with nothing read does nothing and gives no token', async () => {
    await put({ title: 'u', priority: 'info', age: 1 });
    expect(await clearReadNotices(t(), F.me!)).toEqual({ cleared: 0, undoToken: null, unread: 1 });
  });

  it('a token never restores someone else’s notices', async () => {
    const mine = await put({ title: 'mine', priority: 'info', age: 1 });
    const theirs = await put({ title: 'theirs', priority: 'info', age: 1, userId: F.other! });
    const res = await dismissNotice(t(), F.me!, mine.id);
    await db.execute(
      sql`update notifications set dismissed_at = ${res.undoToken}::timestamptz where id = ${theirs.id}`,
    );
    expect((await restoreNotices(t(), F.me!, res.undoToken)).restored).toBe(1);
    const [other] = await db.select().from(s.notifications).where(eq(s.notifications.id, theirs.id));
    expect(other?.dismissedAt).not.toBeNull();
  });

  it('pings the person’s other devices, once per change, never someone else', async () => {
    const a = await put({ title: 'a', priority: 'info', read: true, age: 1 });
    const pings = async () =>
      (await db.select().from(s.liveOutbox)).filter((p) => p.kind === 'notice' && p.topic === `user:${F.me}`);
    expect(await pings()).toHaveLength(0);
    const res = await dismissNotice(t(), F.me!, a.id);
    expect(await pings()).toHaveLength(1);
    await dismissNotice(t(), F.me!, a.id); // already removed: no second ping
    expect(await pings()).toHaveLength(1);
    await restoreNotices(t(), F.me!, res.undoToken);
    expect((await pings()).length).toBe(2);
    expect((await db.select().from(s.liveOutbox)).every((p) => p.topic === `user:${F.me}`)).toBe(true);
  });
});

describe('queueNotice stores the priority of its kind', () => {
  it('writes urgent for a shop offer and success for a delivery', async () => {
    await queueNotice(t(), {
      kind: 'shop.offer_expiring',
      userId: F.me!,
      entityId: 'x1',
      version: 1,
      params: { orderCode: 'MD-1', minutes: 5 },
    });
    await queueNotice(t(), {
      kind: 'order.delivered',
      userId: F.me!,
      entityId: 'x2',
      version: 1,
      params: { orderCode: 'MD-1' },
    });
    const rows = await db.select().from(s.notifications).where(eq(s.notifications.userId, F.me!));
    const byKind: Record<string, string> = {};
    for (const r of rows) byKind[r.kind ?? ''] = r.priority;
    expect(byKind).toEqual({ 'shop.offer_expiring': 'urgent', 'order.delivered': 'success' });
  });
});

describe('the clean-up job', () => {
  const ago = (days: number) => sql`now() - make_interval(days => ${days})`;
  const count = async () =>
    Number((await db.select({ n: sql<number>`count(*)::int` }).from(s.notifications))[0]?.n);

  it('deletes removed (7 days), done (1 day) and read information older than N days — nothing else', async () => {
    const mk = async (title: string, priority: Row['priority'], patch: Record<string, unknown>) => {
      const r = await put({ title, priority, age: 60 * 24 * 40 });
      if (Object.keys(patch).length > 0)
        await db.update(s.notifications).set(patch).where(eq(s.notifications.id, r.id));
      return r;
    };
    await mk('removed-old', 'info', { dismissedAt: sql`${ago(8)}` });
    await mk('removed-recent', 'info', { dismissedAt: sql`${ago(2)}` });
    await mk('done-old', 'action', { resolvedAt: sql`${ago(2)}`, readAt: sql`${ago(2)}` });
    await mk('done-today', 'action', { resolvedAt: sql`now()`, readAt: sql`now()` });
    await mk('info-read-old', 'info', { readAt: sql`${ago(35)}` });
    await mk('success-read-old', 'success', { readAt: sql`${ago(35)}` });
    await mk('info-unread-old', 'info', {});
    await mk('action-read-old', 'action', { readAt: sql`${ago(35)}` });
    await mk('urgent-read-old', 'urgent', { readAt: sql`${ago(35)}` });
    const young = await put({ title: 'info-read-young', priority: 'info', read: true, age: 60 });
    expect(await count()).toBe(10);
    const res = await purgeFinishedNotices(t(), { infoDays: 30, batch: 2 });
    expect(res).toEqual({ dismissed: 1, resolved: 1, info: 2 });
    const left = (await db.select({ title: s.notifications.title }).from(s.notifications))
      .map((r) => r.title)
      .sort();
    expect(left).toEqual(
      [
        'removed-recent',
        'done-today',
        'info-unread-old',
        'action-read-old',
        'urgent-read-old',
        'info-read-young',
      ].sort(),
    );
    expect(young.id).toBeTruthy();
  });

  it('uses the number of days it is given', async () => {
    const r = await put({ title: 'info', priority: 'info', read: true, age: 60 * 24 * 10 });
    expect((await purgeFinishedNotices(t(), { infoDays: 30 })).info).toBe(0);
    expect((await purgeFinishedNotices(t(), { infoDays: 7 })).info).toBe(1);
    expect(r.id).toBeTruthy();
  });
});
