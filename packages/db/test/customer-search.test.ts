/**
 * Customer search and view for staff (design 2026-11-15, specs 08/13): find by phone (last 10 digits), email,
 * order/request/ticket code or name prefix; at most 20 results, contact details always masked in the list; the
 * profile view unmasks only for `customers:read_pii` and every unmasked view is audited; sections the viewer may
 * not read come back null; deleted accounts are never found.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { customerView, placeCodOrder, quoteCheckout, searchCustomers, type Tx } from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let asha = '';
let staff = '';
let cityId = '';
let orderCode = '';
let groupCode = '';
const ticketCode = 'REQ-RPR-2026-000A01';
const serviceCode = 'SR-RPR-2026-23456K';

const ALL = { orders: true, serviceRequests: true, tickets: true, refunds: true, coins: true } as const;
const NONE = { orders: false, serviceRequests: false, tickets: false, refunds: false, coins: false } as const;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  cityId = (await db.select({ id: s.cities.id }).from(s.cities).limit(1))[0]!.id;
  const [a] = await db
    .insert(s.users)
    .values({
      firebaseUid: 'cs-asha',
      name: 'Asha Verma',
      phone: '+919876500001',
      phoneVerifiedAt: new Date(),
      email: 'Asha.Verma@Example.com',
    })
    .returning();
  asha = a!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'cs-staff', name: 'Desk' }).returning())[0]!.id;
  await db.insert(s.users).values({
    firebaseUid: 'cs-gone',
    name: 'Asha Deleted',
    phone: '+919876500002',
    deletedAt: new Date(),
    status: 'deleted',
  });

  const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  const placed = await placeCodOrder(t(), {
    userId: asha,
    idempotencyKey: 'customer-search-000001',
    address: {
      contactName: 'Asha',
      contactPhone: '+919876500001',
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
  groupCode = placed.code;
  orderCode = placed.orders[0]!.code;
  await db.insert(s.supportTickets).values({
    code: ticketCode,
    userId: asha,
    kind: 'other',
    slaAckDue: new Date(),
    slaResolveDue: new Date(),
  });
  await db.insert(s.serviceRequests).values({
    code: serviceCode,
    userId: asha,
    cityId,
    routingMode: 'mechdost',
    vehicleType: '2W',
    vehicleText: 'Honda Activa',
    vehicleKey: 'honda activa',
    services: [],
    pincode: '492004',
    preferredDate: '2026-12-01',
    preferredSlot: 'morning',
    idempotencyKey: 'cs-service-idem-0001',
  });
  const [grp] = await db
    .select({ id: s.orderGroups.id })
    .from(s.orderGroups)
    .where(eq(s.orderGroups.code, groupCode));
  await db.insert(s.refunds).values({
    groupId: grp!.id,
    amountPaise: 5000,
    mode: 'bank_upi',
    destinationEnc: 'v1.k1.AAAAAAAAAAAAAAAA.xxx.BBBBBBBBBBBBBBBBBBBBBB',
    idemKey: 'cs-refund-idem-0001',
    source: 'other',
    reasonCode: 'goodwill',
  });
  await db.insert(s.coinAccounts).values({ userId: asha, balance: 40, lifetimeEarned: 90 });
  await db.insert(s.consents).values([
    { userId: asha, purpose: 'marketing', granted: true, noticeVersion: 'v1', source: 'web' },
    { userId: asha, purpose: 'marketing', granted: false, noticeVersion: 'v1', source: 'web' },
    { userId: asha, purpose: 'analytics', granted: true, noticeVersion: 'v1', source: 'web' },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('searchCustomers', () => {
  it('finds by phone (any format, last 10 digits), by email (any case) and by name prefix', async () => {
    for (const q of [
      '9876500001',
      '+91 98765 00001',
      'asha.verma@example.com',
      'ASHA.verma@Example.com',
      'ash',
      'Asha V',
    ]) {
      const out = await searchCustomers(t(), { q });
      expect(
        out.results.map((r) => r.id),
        q,
      ).toEqual([asha]);
    }
  });

  it('finds the owner by order, checkout, request or ticket code', async () => {
    for (const q of [orderCode, groupCode, serviceCode, ticketCode, orderCode.toLowerCase()]) {
      const out = await searchCustomers(t(), { q });
      expect(out.kind).toBe('code');
      expect(
        out.results.map((r) => r.id),
        q,
      ).toEqual([asha]);
    }
    expect((await searchCustomers(t(), { q: 'MD-RPR-2026-ZZZZZZ' })).results).toEqual([]);
  });

  it('masks contact details, never returns deleted accounts, caps at 20, refuses weak queries', async () => {
    const out = await searchCustomers(t(), { q: '9876500001' });
    expect(out.results[0]).toMatchObject({ phoneMasked: '••••••0001', emailMasked: 'A•••@Example.com' });
    expect(JSON.stringify(out)).not.toContain('9876500001');
    expect((await searchCustomers(t(), { q: '9876500002' })).results).toEqual([]);
    expect((await searchCustomers(t(), { q: 'Asha Deleted' })).results).toEqual([]);
    for (let i = 0; i < 25; i++)
      await db.insert(s.users).values({ firebaseUid: `cs-bulk-${String(i)}`, name: `Bulkname ${String(i)}` });
    expect((await searchCustomers(t(), { q: 'bulkname' })).results).toHaveLength(20);
    for (const q of ['a', '98765', ' ', 'x'.repeat(101)])
      await expect(searchCustomers(t(), { q })).rejects.toMatchObject({ code: 'SEARCH_QUERY' });
    // LIKE wildcards in a name are literal characters
    expect((await searchCustomers(t(), { q: '%%' })).results).toEqual([]);
  });
});

describe('customerView', () => {
  it('shows everything, masked, to a viewer without the PII permission and writes no unmasked audit row', async () => {
    const v = await customerView(t(), {
      customerId: asha,
      viewerId: staff,
      canReadPii: false,
      sections: ALL,
    });
    expect(v.profile).toMatchObject({
      id: asha,
      masked: true,
      phone: '••••••0001',
      email: 'A•••@Example.com',
      phoneVerified: true,
      emailVerified: false,
    });
    expect(v.orders?.map((o) => o.code)).toEqual([orderCode]);
    expect(v.orders?.[0]?.totalPaise).toBeGreaterThan(0);
    expect(v.serviceRequests?.map((r) => r.code)).toEqual([serviceCode]);
    expect(v.tickets?.map((r) => r.code)).toEqual([ticketCode]);
    expect(v.refunds).toEqual([expect.objectContaining({ amountPaise: 5000, status: 'requested' })]);
    expect(v.coins).toEqual({ balance: 40, lifetimeEarned: 90 });
    // latest answer per purpose
    expect(v.consents.find((c) => c.purpose === 'marketing')?.granted).toBe(false);
    expect(v.consents.find((c) => c.purpose === 'analytics')?.granted).toBe(true);
    const rows = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'customer.pii_viewed'));
    expect(rows).toHaveLength(0);
  });

  it('unmasks for the PII permission and audits every such view (who looked)', async () => {
    const v = await customerView(t(), { customerId: asha, viewerId: staff, canReadPii: true, sections: ALL });
    expect(v.profile).toMatchObject({
      masked: false,
      phone: '+919876500001',
      email: 'Asha.Verma@Example.com',
    });
    await customerView(t(), { customerId: asha, viewerId: staff, canReadPii: true, sections: ALL });
    const rows = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'customer.pii_viewed'), eq(s.auditLog.entityId, asha)));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actorUserId: staff, entity: 'user' });
    expect(JSON.stringify(rows)).not.toContain('9876500001');
  });

  it('returns null for sections the viewer may not read, 404 for an unknown or deleted customer', async () => {
    const v = await customerView(t(), {
      customerId: asha,
      viewerId: staff,
      canReadPii: false,
      sections: NONE,
    });
    expect(v).toMatchObject({
      orders: null,
      serviceRequests: null,
      tickets: null,
      refunds: null,
      coins: null,
    });
    expect(v.consents.length).toBeGreaterThan(0);
    await expect(
      customerView(t(), {
        customerId: '019a8f00-0000-7000-8000-000000000999',
        viewerId: staff,
        canReadPii: false,
        sections: ALL,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
