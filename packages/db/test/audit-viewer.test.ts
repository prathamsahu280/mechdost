/**
 * Audit log viewer (design 2026-11-15, spec 13): read-only, newest first, filters (entity, entity id or code, actor,
 * action, IST date range), cursor paging that never repeats or skips a row, contact details inside before/after
 * always masked, tampered cursors refused.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { listAudit, placeCodOrder, quoteCheckout, type Tx } from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let actor = '';
let other = '';
let orderCode = '';
let orderId = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  actor = (await db.insert(s.users).values({ firebaseUid: 'au-actor', name: 'Ravi Staff' }).returning())[0]!
    .id;
  other = (await db.insert(s.users).values({ firebaseUid: 'au-other', name: 'Other' }).returning())[0]!.id;
  const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  const placed = await placeCodOrder(t(), {
    userId: other,
    idempotencyKey: 'audit-viewer-000001',
    address: {
      contactName: 'Other',
      contactPhone: '+919876500009',
      line1: 'House 1',
      line2: null,
      landmark: null,
      pincode: '492004',
    },
    lines,
    expectedTotalPaise: q.totalPaise,
    note: null,
    locale: 'en',
  });
  orderCode = placed.orders[0]!.code;
  orderId = (await db.select({ id: s.orders.id }).from(s.orders).where(eq(s.orders.code, orderCode)))[0]!.id;
  const rows: (typeof s.auditLog.$inferInsert)[] = [];
  for (let i = 0; i < 30; i++)
    rows.push({
      actorUserId: actor,
      actorRole: 'staff',
      action: i % 2 === 0 ? 'setting.changed' : 'content.changed',
      entity: i % 2 === 0 ? 'setting' : 'content',
      entityId: `k${String(i)}`,
      before: { phone: '+919876543210', n: i },
      after: { email: 'asha@example.com', line1: '12 MG Road', n: i + 1 },
      reason: 'seed',
    });
  rows.push({
    actorUserId: other,
    actorRole: 'customer',
    action: 'order.cancelled',
    entity: 'order',
    entityId: orderId,
  });
  await db.insert(s.auditLog).values(rows);
});

afterAll(async () => {
  await client.close();
});

describe('listAudit', () => {
  it('returns newest first with the actor name, and pages by cursor without repeats or gaps', async () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listAudit(t(), { actorUserId: actor, limit: 7, cursor });
      expect(page.rows.length).toBeLessThanOrEqual(7);
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    expect([...seen].sort((a, b) => b - a)).toEqual(seen);
    const first = await listAudit(t(), { actorUserId: actor, limit: 1 });
    expect(first.rows[0]).toMatchObject({ actorName: 'Ravi Staff', actorRole: 'staff' });
  });

  it('filters by entity, entity id, action and actor', async () => {
    expect((await listAudit(t(), { entity: 'setting', limit: 50 })).rows).toHaveLength(15);
    expect((await listAudit(t(), { entity: 'content', entityId: 'k3', limit: 50 })).rows).toHaveLength(1);
    expect((await listAudit(t(), { action: 'order.cancelled', limit: 50 })).rows).toHaveLength(1);
    expect((await listAudit(t(), { actorUserId: other, limit: 50 })).rows.map((r) => r.action)).toContain(
      'order.cancelled',
    );
    expect((await listAudit(t(), { entity: 'setting', action: 'content.changed' })).rows).toEqual([]);
  });

  it('resolves an order code to its entity id', async () => {
    const page = await listAudit(t(), { code: orderCode, limit: 50 });
    expect(page.rows.map((r) => r.action)).toContain('order.cancelled');
    expect(page.rows.every((r) => r.entityId === orderId)).toBe(true);
    expect((await listAudit(t(), { code: 'MD-RPR-2026-ZZZZZZ-1' })).rows).toEqual([]);
    await expect(listAudit(t(), { code: 'not a code' })).rejects.toMatchObject({ code: 'AUDIT_CODE' });
  });

  it('filters by IST calendar days (inclusive of the last day)', async () => {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    expect((await listAudit(t(), { fromDay: today, toDay: today, limit: 100 })).rows.length).toBeGreaterThan(
      30,
    );
    expect((await listAudit(t(), { toDay: '2020-01-01' })).rows).toEqual([]);
    expect((await listAudit(t(), { fromDay: '2099-01-01' })).rows).toEqual([]);
    // a row written at 23:30 IST on 2026-01-01 (18:00 UTC) belongs to that IST day only
    await db.execute(
      sql`insert into audit_log (action, entity, created_at) values ('edge.test', 'edge', '2026-01-01T18:00:00Z')`,
    );
    expect(
      (await listAudit(t(), { action: 'edge.test', fromDay: '2026-01-01', toDay: '2026-01-01' })).rows,
    ).toHaveLength(1);
    expect(
      (await listAudit(t(), { action: 'edge.test', fromDay: '2026-01-02', toDay: '2026-01-02' })).rows,
    ).toHaveLength(0);
    await expect(listAudit(t(), { fromDay: '2026-13-45' })).rejects.toMatchObject({ code: 'AUDIT_DATE' });
  });

  it('masks contact details in before and after, always', async () => {
    const page = await listAudit(t(), { entity: 'setting', limit: 1 });
    const row = page.rows[0]!;
    expect(row.before).toMatchObject({ phone: '••••••3210' });
    expect(row.after).toMatchObject({ email: 'a•••@example.com', line1: '[hidden]' });
    expect(JSON.stringify(page)).not.toContain('9876543210');
  });

  it('refuses a tampered cursor and a malformed filter', async () => {
    await expect(listAudit(t(), { cursor: 'abc' })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(listAudit(t(), { entity: "x'; drop table audit_log;--" })).rejects.toMatchObject({
      code: 'AUDIT_FILTER',
    });
  });
});
