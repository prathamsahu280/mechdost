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
