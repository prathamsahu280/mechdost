/**
 * Event store (spec 12): server events are written in the same transaction as the change (a retried order
 * records one purchase; a failed one records none), props carry no personal data, partitions are monthly with
 * RLS on, and the table is append-only.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  ensureEventPartitions,
  events,
  placeCodOrder,
  readForwardableEvents,
  quoteCheckout,
  rejectOrder,
  routeOrder,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let customer = '';
let staff = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  customer = (await db.insert(s.users).values({ firebaseUid: 'fb-events-customer' }).returning())[0]!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-events-staff' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

const place = async (key: string, expected?: number) => {
  const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  return placeCodOrder(t(), {
    userId: customer,
    idempotencyKey: key,
    address: {
      contactName: 'Ravi Sahu',
      contactPhone: '+919876543210',
      line1: 'House 12, Pandri',
      line2: null,
      landmark: null,
      pincode: '492004',
    },
    lines,
    expectedTotalPaise: expected ?? q.totalPaise,
    note: 'Call me at 9876543210',
    locale: 'en',
  });
};

describe('event store', () => {
  it('records one purchase per order, none for a failed one, and no personal data', async () => {
    const placed = await place('events-key-000000001');
    await place('events-key-000000001'); // replay: same order
    await expect(place('events-key-000000002', 1)).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    const purchases = await db.select().from(events).where(eq(events.event, 'purchase'));
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({
      source: 'server',
      userId: customer,
      props: { orderCode: placed.code, subOrders: 1, items: 1, paymentMethod: 'cod' },
    });
    const all = JSON.stringify(await db.select().from(events));
    for (const pii of ['Ravi', '9876543210', 'Pandri']) expect(all).not.toContain(pii);
  });

  it('routing and rejecting record their admin events with the attempt number', async () => {
    const placed = await place('events-key-000000003');
    const code = placed.orders[0]!.code;
    const [shop] = await db.select().from(s.shops).where(eq(s.shops.name, 'Sharma Auto Parts'));
    const version = async () => (await db.select().from(s.orders).where(eq(s.orders.code, code)))[0]!.version;
    await routeOrder(t(), {
      scope: { all: true },
      code,
      shopId: shop!.id,
      expectedVersion: await version(),
      staffUserId: staff,
    });
    const [routed] = await db.select().from(events).where(eq(events.event, 'admin_order_routed'));
    expect(routed!.props).toEqual({ orderCode: code, shopId: shop!.id, attempt: 1 });

    const other = (await place('events-key-000000004')).orders[0]!.code;
    const v = (await db.select().from(s.orders).where(eq(s.orders.code, other)))[0]!.version;
    await rejectOrder(t(), {
      scope: { all: true },
      code: other,
      reasonCode: 'pricing_error',
      message: 'The price shown was wrong. Nothing was charged.',
      expectedVersion: v,
      staffUserId: staff,
    });
    const [rejected] = await db.select().from(events).where(eq(events.event, 'admin_order_rejected'));
    expect(rejected!.props).toEqual({ orderCode: other, reasonCode: 'pricing_error' });
  });

  it('is monthly-partitioned with RLS on every partition, and append-only', async () => {
    expect(await ensureEventPartitions(t(), 3)).toBe(0); // the migration already made them
    expect(await ensureEventPartitions(t(), 5)).toBe(2);
    const parts = (
      await db.execute(sql`select c.relname, c.relrowsecurity from pg_inherits i
        join pg_class c on c.oid = i.inhrelid where i.inhparent = 'public.events'::regclass order by c.relname`)
    ).rows as { relname: string; relrowsecurity: boolean }[];
    expect(parts.length).toBe(7); // default + this month + 5 ahead
    expect(parts.every((p) => p.relrowsecurity)).toBe(true);
    const [row] = await db.select().from(events).limit(1);
    await expect(
      db.execute(sql`update events set event = 'tampered' where id = ${row!.id}`),
    ).rejects.toThrow();
  });
});

describe('events to forward to PostHog (decision 2026-11-14)', () => {
  const ids = {
    consented: '019a8f00-0000-7000-8000-000000000001',
    noConsent: '019a8f00-0000-7000-8000-000000000002',
    server: '019a8f00-0000-7000-8000-000000000003',
    tooYoung: '019a8f00-0000-7000-8000-000000000004',
  };

  beforeAll(async () => {
    // Microsecond receive times, as Postgres stores them: the cursor must not lose them (no row read twice).
    await db.execute(sql`insert into events (id, occurred_at, received_at, source, event, anonymous_id, page, props,
        consent_version) values
      (${ids.consented}::uuid, now() - interval '5 min', now() - interval '5 min' + interval '17 microseconds', 'web',
        'page_view', 'a0f1c7a2-0000-4000-8000-000000000001', '/shop', '{"path":"/shop","locale":"en"}', '2026-11-14'),
      (${ids.noConsent}::uuid, now() - interval '4 min', now() - interval '4 min', 'web', 'page_view',
        'a0f1c7a2-0000-4000-8000-000000000002', '/shop', '{"path":"/shop","locale":"en"}', null),
      (${ids.server}::uuid, now() - interval '3 min', now() - interval '3 min' + interval '123 microseconds', 'server',
        'order_delivered', null, null, '{"orderCode":"MD-RPR-2026-AAAAAA"}', null),
      (${ids.tooYoung}::uuid, now() - interval '5 s', now() - interval '5 s', 'web', 'page_view',
        'a0f1c7a2-0000-4000-8000-000000000003', '/cart', '{"path":"/cart","locale":"en"}', '2026-11-14')`);
  });

  const read = (after: Parameters<typeof readForwardableEvents>[1]['after'], limit = 10) =>
    readForwardableEvents(t(), { after, limit, lagSeconds: 60, startMinutes: 60 });

  it('returns consented web events and server events, oldest first, never unconsented or too-young rows', async () => {
    const rows = (await read(null)).filter((r) => Object.values(ids).includes(r.id));
    expect(rows.map((r) => r.id)).toEqual([ids.consented, ids.server]);
    expect(rows[0]).toMatchObject({ source: 'web', event: 'page_view', consentVersion: '2026-11-14' });
  });

  it('pages with an exact cursor: each row once, microseconds kept', async () => {
    const all = await read(null, 100);
    const firstIdx = all.findIndex((r) => r.id === ids.consented);
    const first = all[firstIdx]!;
    expect(first.cursor.receivedAt).toMatch(/\.\d{6}/u);
    const next = await read(first.cursor, 100);
    expect(next.map((r) => r.id)).not.toContain(ids.consented);
    expect(next.map((r) => r.id)).toContain(ids.server);
    const server = next.find((r) => r.id === ids.server)!;
    expect((await read(server.cursor, 100)).map((r) => r.id)).not.toContain(ids.server);
  });

  it('the cursor columns are indexed on the parent and on every partition, also ones created later (0053)', async () => {
    await ensureEventPartitions(t(), 8);
    const parts = (
      await db.execute(sql`select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
        where i.inhparent = 'public.events'::regclass`)
    ).rows as { relname: string }[];
    const indexed = (
      await db.execute(sql`select tablename from pg_indexes
        where schemaname = 'public' and indexdef like '%(received_at, id)%'`)
    ).rows as { tablename: string }[];
    const tables = new Set(indexed.map((r) => r.tablename));
    expect(tables.has('events')).toBe(true);
    for (const p of parts) expect([p.relname, tables.has(p.relname)]).toEqual([p.relname, true]);
  });
});
