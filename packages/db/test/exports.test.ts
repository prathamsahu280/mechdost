/**
 * CSV export reads (design 2026-11-15 item 4, specs 08/13/14): every dataset has a stable header, amounts come out as
 * exact rupee strings next to the raw paise, times are IST, the window edges are IST day boundaries, city scope
 * narrows the rows, customer contact columns are masked unless the actor may read them, paging by keyset never
 * skips or repeats a row, and the audit row and analytics event are written.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { events } from '../src/repo/events';
import {
  countExportRows,
  exportHeader,
  exportPages,
  placeCodOrder,
  quoteCheckout,
  recordExportDownload,
  recordExportRequest,
  type ExportQuery,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { EXPORT_DATASETS } from '@mechdost/shared/exports';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let raipur = '';
let other = '';
let asha = '';
let staff = '';
let groupCode = '';
let subCode = '';
let totalPaise = 0;

const base = (dataset: ExportQuery['dataset'], over: Partial<ExportQuery> = {}): ExportQuery => ({
  dataset,
  from: '2026-11-10',
  to: '2026-11-12',
  cityIds: null,
  maskContacts: true,
  ...over,
});

async function all(q: ExportQuery, size = 1000): Promise<string[][]> {
  const rows: string[][] = [];
  for await (const page of exportPages(t(), q, size)) rows.push(...page);
  return rows;
}

const col = (dataset: ExportQuery['dataset'], name: string) => exportHeader(dataset).indexOf(name);

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  raipur = (await db.select({ id: s.cities.id }).from(s.cities).limit(1))[0]!.id;
  const [state] = await db.select({ id: s.states.id }).from(s.states).limit(1);
  other = (
    await db
      .insert(s.cities)
      .values({ stateId: state!.id, code: 'BPL', slug: 'bilaspur', name: 'Bilaspur' })
      .returning()
  )[0]!.id;
  asha = (
    await db
      .insert(s.users)
      .values({
        firebaseUid: 'ex-asha',
        name: '=Asha Verma',
        phone: '+919876500001',
        phoneVerifiedAt: new Date(),
        email: 'Asha.Verma@Example.com',
      })
      .returning()
  )[0]!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'ex-staff', name: 'Desk' }).returning())[0]!.id;

  const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  const placed = await placeCodOrder(t(), {
    userId: asha,
    idempotencyKey: 'export-test-000001',
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
  subCode = placed.orders[0]!.code;
  totalPaise = q.totalPaise;
  // 2026-11-10 00:00 IST is the first instant of the window.
  await db
    .update(s.orderGroups)
    .set({ createdAt: new Date('2026-11-09T18:30:00.000Z') })
    .where(eq(s.orderGroups.code, groupCode));
  await db
    .update(s.orders)
    .set({ placedAt: new Date('2026-11-09T18:30:00.000Z') })
    .where(eq(s.orders.code, subCode));
  await db
    .update(s.users)
    .set({ createdAt: new Date('2026-11-11T06:00:00.000Z') })
    .where(eq(s.users.id, asha));

  const [grp] = await db
    .select({ id: s.orderGroups.id })
    .from(s.orderGroups)
    .where(eq(s.orderGroups.code, groupCode));
  await db.insert(s.refunds).values({
    groupId: grp!.id,
    amountPaise: 5005,
    mode: 'bank_upi',
    destinationEnc: 'v1.k1.AAAAAAAAAAAAAAAA.xxx.BBBBBBBBBBBBBBBBBBBBBB',
    idemKey: 'export-refund-0001',
    source: 'other',
    reasonCode: 'goodwill',
    createdAt: new Date('2026-11-11T05:00:00.000Z'),
  });
  await db.insert(s.serviceRequests).values({
    code: 'SR-RPR-2026-23456K',
    userId: asha,
    cityId: raipur,
    routingMode: 'mechdost',
    vehicleType: '2W',
    vehicleText: 'Honda Activa',
    vehicleKey: 'honda activa',
    services: [],
    pincode: '492004',
    preferredDate: '2026-12-01',
    preferredSlot: 'morning',
    idempotencyKey: 'export-service-idem-01',
    createdAt: new Date('2026-11-12T18:29:59.000Z'),
  });
});

afterAll(async () => {
  await client.close();
});

describe('header', () => {
  it('has a header for every dataset, paired rupee and paise columns for money', () => {
    for (const d of EXPORT_DATASETS) expect(exportHeader(d).length).toBeGreaterThan(3);
    expect(exportHeader('orders')).toContain('total_rupees');
    expect(exportHeader('orders')).toContain('total_paise');
  });
});

describe('orders and sub-orders', () => {
  it('writes exact rupees from integer paise, the raw paise and IST time', async () => {
    const rows = await all(base('orders'));
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r[col('orders', 'code')]).toBe(groupCode);
    expect(r[col('orders', 'total_paise')]).toBe(String(totalPaise));
    const rupees = `${String(Math.floor(totalPaise / 100))}.${String(totalPaise % 100).padStart(2, '0')}`;
    expect(r[col('orders', 'total_rupees')]).toBe(rupees);
    expect(r[col('orders', 'placed_at_ist')]).toBe('2026-11-10 00:00:00');
    expect(r[col('orders', 'city_code')]).toBe('RPR');
    const sub = await all(base('sub_orders'));
    expect(sub).toHaveLength(1);
    expect(sub[0]![col('sub_orders', 'code')]).toBe(subCode);
    expect(sub[0]![col('sub_orders', 'order_code')]).toBe(groupCode);
  });

  it('uses IST day boundaries: the last instant before the start is out, the first is in', async () => {
    await db
      .update(s.orderGroups)
      .set({ createdAt: new Date('2026-11-09T18:29:59.999Z') })
      .where(eq(s.orderGroups.code, groupCode));
    expect(await all(base('orders'))).toHaveLength(0);
    await db
      .update(s.orderGroups)
      .set({ createdAt: new Date('2026-11-12T18:29:59.999Z') })
      .where(eq(s.orderGroups.code, groupCode));
    expect(await all(base('orders'))).toHaveLength(1);
    await db
      .update(s.orderGroups)
      .set({ createdAt: new Date('2026-11-12T18:30:00.000Z') })
      .where(eq(s.orderGroups.code, groupCode));
    expect(await all(base('orders'))).toHaveLength(0);
    await db
      .update(s.orderGroups)
      .set({ createdAt: new Date('2026-11-09T18:30:00.000Z') })
      .where(eq(s.orderGroups.code, groupCode));
  });

  it('narrows to the cities in scope', async () => {
    expect(await all(base('orders', { cityIds: [other] }))).toHaveLength(0);
    expect(await all(base('orders', { cityIds: [raipur] }))).toHaveLength(1);
    expect(await all(base('orders', { cityIds: [] }))).toHaveLength(0);
    expect(await countExportRows(t(), base('orders', { cityIds: [other] }))).toBe(0);
    expect(await countExportRows(t(), base('orders', { cityIds: [raipur, other] }))).toBe(1);
  });
});

describe('refunds and service requests', () => {
  it('exports a refund with the checkout code and exact rupees but never the destination', async () => {
    const rows = await all(base('refunds'));
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r[col('refunds', 'order_code')]).toBe(groupCode);
    expect(r[col('refunds', 'amount_rupees')]).toBe('50.05');
    expect(r[col('refunds', 'amount_paise')]).toBe('5005');
    expect(exportHeader('refunds').join(',')).not.toMatch(/destination|upi|bank/);
    expect(await all(base('refunds', { cityIds: [other] }))).toHaveLength(0);
  });

  it('includes a request created in the last second of the window, in IST', async () => {
    const rows = await all(base('service_requests'));
    expect(rows).toHaveLength(1);
    expect(rows[0]![col('service_requests', 'created_at_ist')]).toBe('2026-11-12 23:59:59');
    expect(rows[0]![col('service_requests', 'code')]).toBe('SR-RPR-2026-23456K');
    expect(await all(base('service_requests', { cityIds: [other] }))).toHaveLength(0);
  });
});

describe('partners', () => {
  it('lists shops and workshops created in the window with kind, scoped by city', async () => {
    await db.insert(s.workshops).values({
      cityId: raipur,
      slug: 'export-workshop',
      name: 'Export Workshop',
      addressLine: 'GE Road',
      area: 'Shankar Nagar',
      pincode: '492004',
      location: { lng: 81.6612, lat: 21.2621 },
      vehicleTypes: ['2W'],
      hours: { open: '09:00', close: '19:00', days: [1] },
    });
    const wide = base('partners', { from: '2020-01-01', to: '2020-06-01' });
    expect(await all(wide)).toHaveLength(0);
    await db
      .update(s.shops)
      .set({ createdAt: new Date('2026-11-11T05:00:00.000Z') })
      .where(eq(s.shops.cityId, raipur));
    await db
      .update(s.workshops)
      .set({ createdAt: new Date('2026-11-11T05:00:00.000Z') })
      .where(eq(s.workshops.cityId, raipur));
    const rows = await all(base('partners'));
    const kinds = new Set(rows.map((r) => r[col('partners', 'kind')]));
    expect(kinds).toEqual(new Set(['shop', 'workshop']));
    expect(await all(base('partners', { cityIds: [other] }))).toHaveLength(0);
    expect(await countExportRows(t(), base('partners'))).toBe(rows.length);
  });

  it('pages by keyset across both partner tables without skipping or repeating', async () => {
    const whole = await all(base('partners'), 1000);
    const paged = await all(base('partners'), 2);
    expect(paged.length).toBeGreaterThanOrEqual(3);
    expect(paged.map((r) => r.join('|'))).toEqual(whole.map((r) => r.join('|')));
    expect(new Set(paged.map((r) => r[col('partners', 'id')])).size).toBe(paged.length);
  });
});

describe('customers', () => {
  it('masks phone and email unless the actor may read them; text stays text', async () => {
    const masked = (await all(base('customers')))[0]!;
    expect(masked[col('customers', 'phone')]).toBe('••••••0001');
    expect(masked[col('customers', 'email')]).toBe('A•••@Example.com');
    expect(masked[col('customers', 'created_at_ist')]).toBe('2026-11-11 11:30:00');
    const open = (await all(base('customers', { maskContacts: false })))[0]!;
    expect(open[col('customers', 'phone')]).toBe('+919876500001');
    expect(open[col('customers', 'email')]).toBe('Asha.Verma@Example.com');
    // A formula-looking name is returned as typed; the CSV writer neutralises it.
    expect(open[col('customers', 'name')]).toBe('=Asha Verma');
  });

  it('ignores the city list (customers have no city) and skips deleted accounts', async () => {
    await db.update(s.users).set({ deletedAt: new Date(), status: 'deleted' }).where(eq(s.users.id, asha));
    const none = await all(base('customers'));
    expect(none.some((r) => r[col('customers', 'user_id')] === asha)).toBe(false);
    await db.update(s.users).set({ deletedAt: null, status: 'active' }).where(eq(s.users.id, asha));
    expect((await all(base('customers', { cityIds: [other] }))).length).toBe(1);
  });
});

describe('audit and events', () => {
  it('writes an audit row (who, dataset, range, rows, masked) and an analytics event', async () => {
    await recordExportRequest(t(), {
      actorId: staff,
      query: base('orders'),
      cityCode: null,
      rowCount: 7,
    });
    const [row] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'export.requested'));
    expect(row!.entityId).toBe('orders');
    expect(row!.actorUserId).toBe(staff);
    expect(row!.entity).toBe('export');
    expect(row!.after).toMatchObject({
      dataset: 'orders',
      from: '2026-11-10',
      to: '2026-11-12',
      rowCount: 7,
      masked: false,
    });
    await recordExportRequest(t(), {
      actorId: staff,
      query: base('customers'),
      cityCode: null,
      rowCount: 1,
    });
    const both = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'export.requested'));
    expect(both.some((r) => (r.after as { masked: boolean }).masked)).toBe(true);
    await recordExportDownload(t(), { actorId: staff, query: base('orders'), rowCount: 7 });
    const [dl] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'export.downloaded'));
    expect(dl!.after).toMatchObject({ dataset: 'orders', rowCount: 7 });
    const found = await db
      .select({ event: events.event, props: events.props })
      .from(events)
      .where(like(events.event, 'admin_export_%'))
      .orderBy(events.event);
    expect(found.map((e) => e.event)).toEqual([
      'admin_export_downloaded',
      'admin_export_run',
      'admin_export_run',
    ]);
    expect(found.map((e) => e.props)).toContainEqual({
      dataset: 'orders',
      rangeDays: 3,
      rowCount: 7,
      masked: false,
    });
  });
});
