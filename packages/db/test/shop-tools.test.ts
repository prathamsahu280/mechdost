/**
 * Shop portal next tier, part 2 (design 2026-11-15 items 4 to 7): the stock and price CSV (a price is only ever a
 * price request, the file never half-applies, formula cells are refused), the packing slip (first name and masked
 * phone, no street, no prices, only for the shop fulfilling the order), performance (the city median leaves out
 * every shop the owner holds and needs five others) and the public application status (the right phone only).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  acceptShopOffer,
  applyShopCsv,
  getApplicationStatus,
  getPackingSlip,
  getShopPerformance,
  listShopInventory,
  placeCodOrder,
  previewShopCsv,
  quoteCheckout,
  routeOrder,
  shopCsvTemplateFor,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900'; // MRP 475 rupees

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let user = '';
let staff = '';
let customer = '';
const shop: Record<string, string> = {};
const SHARMA = 'Sharma Auto Parts';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  user = (await db.insert(s.users).values({ firebaseUid: 'fb-tools-user' }).returning())[0]!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-tools-staff' }).returning())[0]!.id;
  customer = (await db.insert(s.users).values({ firebaseUid: 'fb-tools-customer' }).returning())[0]!.id;
  for (const row of await db.select().from(s.shops)) shop[row.name] = row.id;
  await db.execute(sql`insert into admin_prices (variant_id, city_id, selling_paise, updated_by)
    select v.id, c.id, v.mrp_paise, ${staff} from product_variants v cross join cities c where c.code = 'RPR'`);
});

afterAll(async () => {
  await client.close();
});

const offer = async (name: string, sku = OIL) =>
  (await listShopInventory(t(), shop[name]!, 'en')).find((o) => o.sku === sku)!;
const csv = (...lines: string[]) => ['sku,stock,active,requested_price', ...lines].join('\n');
const input = (text: string, name = SHARMA) => ({ shopId: shop[name]!, userId: user, text });

describe('stock and price CSV', () => {
  it('checks a file without changing anything and lists what would change', async () => {
    const before = await offer(SHARMA);
    const r = await previewShopCsv(t(), input(csv(`${OIL},${String(before.onHand + 5)},no,400`)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.counts).toEqual({ stock: 1, active: 1, priceRequests: 1 });
    expect(r.plan.errors).toEqual([]);
    expect(r.plan.changes[0]).toMatchObject({
      sku: OIL,
      stock: { from: before.onHand, to: before.onHand + 5 },
      active: { from: true, to: false },
      price: { requestedPaise: 40_000 },
    });
    expect(await offer(SHARMA)).toMatchObject({ onHand: before.onHand, active: true });
  });

  it('applies in one transaction: stock and on/off change, the price becomes a request, one audit row', async () => {
    const before = await offer(SHARMA);
    const done = await applyShopCsv(t(), input(csv(`${OIL},${String(before.onHand + 5)},no,400`)));
    expect(done).toEqual({ stock: 1, active: 1, priceRequests: 1 });
    const after = await offer(SHARMA);
    expect(after).toMatchObject({ onHand: before.onHand + 5, active: false });
    // The price itself did not move.
    expect(after.sellingPaise).toBe(before.sellingPaise);
    const [req] = await db
      .select()
      .from(s.shopPriceRequests)
      .where(and(eq(s.shopPriceRequests.shopId, shop[SHARMA]!), eq(s.shopPriceRequests.status, 'pending')));
    expect(req?.requestedPaise).toBe(40_000);
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'inventory.csv_applied'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.after).toMatchObject({ rows: 1, stock: 1, active: 1, priceRequests: 1 });
    // Put it back on sale for the next tests.
    await applyShopCsv(t(), input(csv(`${OIL},,yes,`)));
    expect((await offer(SHARMA)).active).toBe(true);
  });

  it('never half-applies: one bad line stops the whole file, nothing changes', async () => {
    const before = await offer(SHARMA);
    const bad = csv(`${OIL},${String(before.onHand + 9)},,`, 'NO-SUCH-SKU,1,,');
    await expect(applyShopCsv(t(), input(bad))).rejects.toMatchObject({
      code: 'CSV_HAS_ERRORS',
      status: 422,
    });
    expect((await offer(SHARMA)).onHand).toBe(before.onHand);
    const r = await previewShopCsv(t(), input(bad));
    expect(r.ok && r.plan.errors).toEqual([{ line: 3, column: 'sku', code: 'UNKNOWN_SKU' }]);
  });

  it('refuses formula cells, a SKU the shop does not carry, price above MRP, stock below reserved', async () => {
    const r = await previewShopCsv(t(), input(csv('=1+1,1,,', `${OIL},1,,500`, 'BRK-NOPE-01,1,,')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.errors.map((e) => `${String(e.line)}:${e.code}`)).toEqual(
      expect.arrayContaining(['2:FORMULA_CELL', '3:PRICE_ABOVE_MRP', '4:UNKNOWN_SKU']),
    );
    expect(r.plan.changes).toEqual([]);
  });

  it('refuses unreadable files with a code, and files above the size limit', async () => {
    await expect(applyShopCsv(t(), input('stock,active\n1,yes'))).rejects.toMatchObject({
      code: 'CSV_HEADER',
    });
    await expect(applyShopCsv(t(), input(''))).rejects.toMatchObject({ code: 'CSV_EMPTY' });
    const huge = `sku,stock\n${'AB-12,1\n'.repeat(140_000)}`;
    expect(await previewShopCsv(t(), input(huge))).toEqual({ ok: false, code: 'TOO_LARGE' });
  });

  it('is scoped to the shop in the call: a SKU another shop carries is not carried here', async () => {
    const [owned] = (await listShopInventory(t(), shop[SHARMA]!, 'en')).map((o) => o.sku);
    expect(owned).toBeDefined();
    const all = await db
      .select({ sku: s.productVariants.sku })
      .from(s.productVariants)
      .leftJoin(
        s.shopInventory,
        and(eq(s.shopInventory.variantId, s.productVariants.id), eq(s.shopInventory.shopId, shop[SHARMA]!)),
      )
      .where(sql`${s.shopInventory.id} is null`)
      .limit(1);
    if (all[0]) {
      const r = await previewShopCsv(t(), input(csv(`${all[0].sku},3,,`)));
      expect(r.ok && r.plan.errors[0]?.code).toBe('NOT_CARRIED');
    }
  });

  it('writes a template with the shop’s own offers', async () => {
    const text = await shopCsvTemplateFor(t(), shop[SHARMA]!);
    expect(text.split('\r\n')[0]).toBe('sku,stock,active,requested_price');
    expect(text).toContain(OIL);
  });
});

describe('packing slip', () => {
  it('gives first name and a masked phone, the PIN and the items, nothing else about the customer', async () => {
    const lines = [{ sku: OIL, qty: 2 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const placed = await placeCodOrder(t(), {
      userId: customer,
      idempotencyKey: 'shop-tools-slip-key-00001',
      address: {
        contactName: 'Ravi Kumar Sahu',
        contactPhone: '+919876543210',
        line1: 'House 12, Pandri',
        line2: null,
        landmark: null,
        pincode: '492004',
      },
      lines,
      expectedTotalPaise: q.totalPaise,
      note: null,
      locale: 'en',
    });
    const code = placed.orders[0]!.code;
    const [o] = await db.select().from(s.orders).where(eq(s.orders.code, code));
    const routed = await routeOrder(t(), {
      scope: { all: true },
      code,
      shopId: shop[SHARMA]!,
      expectedVersion: o!.version,
      staffUserId: staff,
    });
    const ask = (shopIds: string[]) => getPackingSlip(t(), { shopIds, code, userId: user });
    // Not accepted yet: the customer's details are not shared.
    await expect(ask([shop[SHARMA]!])).rejects.toBeDefined();
    await acceptShopOffer(t(), {
      shopIds: [shop[SHARMA]!],
      assignmentId: routed.assignmentId,
      staffUserId: user,
    });

    const slip = await ask([shop[SHARMA]!]);
    expect(slip).toMatchObject({ code, pincode: '492004', firstName: 'Ravi' });
    expect(slip.items).toEqual([expect.objectContaining({ sku: OIL, qty: 2 })]);
    expect(slip.phoneMasked.endsWith('3210')).toBe(true);
    expect(slip.phoneMasked).not.toContain('98765');
    const text = JSON.stringify(slip);
    for (const leak of ['Pandri', 'Kumar', 'Sahu', 'unitPaise', 'totalPaise', 'deliveryCode'])
      expect(text).not.toContain(leak);
    // Another shop's slip is a 404.
    await expect(ask([shop['Gupta Lubes & Spares']!])).rejects.toMatchObject({ status: 404 });
  });
});

describe('performance', () => {
  async function fakeShop(n: number) {
    const [state] = await db.select().from(s.states).limit(1);
    const [city] = await db.select().from(s.cities).where(eq(s.cities.code, 'RPR'));
    const [row] = await db
      .insert(s.shops)
      .values({
        name: `Bench shop ${String(n)}`,
        phone: `+9190000000${String(n).padStart(2, '0')}`,
        addressLine: 'Raipur',
        pincode: '492001',
        cityId: city!.id,
        stateId: state!.id,
        status: 'approved',
      })
      .returning();
    return row!.id;
  }
  async function declined(shopId: string) {
    const [order] = await db.select().from(s.orders).limit(1);
    await db.insert(s.orderAssignments).values({
      orderId: order!.id,
      shopId,
      status: 'declined',
      declineReason: 'OUT_OF_STOCK',
      offeredAt: new Date(Date.now() - 3_600_000),
      expiresAt: new Date(Date.now() - 1_800_000),
      respondedAt: new Date(Date.now() - 3_000_000),
    });
  }
  const perf = (ownerShopIds: string[]) =>
    getShopPerformance(t(), { shopId: shop[SHARMA]!, ownerShopIds, userId: user });

  it('shows the shop’s own numbers; the city median is hidden below five other shops and leaves out the owner’s shops', async () => {
    const own = await perf([shop[SHARMA]!]);
    expect(own.windows.map((w) => w.days)).toEqual([30, 90]);
    expect(own.windows[0]?.mine).toMatchObject({ offers: 1, acceptanceBp: 10_000, giveUps: 0 });
    expect(own.windows[0]?.mine.medianAcceptSeconds).toBeGreaterThanOrEqual(0);
    expect(own.windows[0]?.city).toMatchObject({ acceptanceBp: null }); // the demo has few other shops with data

    const others: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const id = await fakeShop(i);
      others.push(id);
      await declined(id);
    }
    // A fifth shop that the owner holds: left out, so still four others.
    const second = await fakeShop(9);
    await declined(second);
    expect((await perf([shop[SHARMA]!, second])).windows[0]?.city?.acceptanceBp).toBeNull();
    // A fifth OTHER shop: the median is shown (all of them declined: 0 %).
    await declined(await fakeShop(5));
    expect((await perf([shop[SHARMA]!, second])).windows[0]?.city?.acceptanceBp).toBe(0);
    // Staff-scope and foreign ids: the shop must be one of the owner's.
    await expect(perf([shop['Gupta Lubes & Spares']!])).rejects.toMatchObject({ status: 404 });
  });
});

describe('application status', () => {
  it('shows the stage to the right phone and nothing to anyone else', async () => {
    await db.insert(s.partnerApplications).values({
      code: 'PA-RPR-2026-ABC234',
      kind: 'garage',
      name: 'Sunita',
      phone: '+919811111111',
      pincode: '492001',
      details: 'Two-bay garage',
      status: 'in_review',
      reviewNote: 'internal only',
      consentAt: new Date(),
    });
    const ok = await getApplicationStatus(t(), {
      code: 'PA-RPR-2026-ABC234',
      verifiedPhone: '+919811111111',
    });
    expect(ok).toMatchObject({ code: 'PA-RPR-2026-ABC234', kind: 'garage', stage: 'in_review' });
    expect(JSON.stringify(ok)).not.toContain('internal only');
    expect(
      await getApplicationStatus(t(), { code: 'PA-RPR-2026-ABC234', verifiedPhone: '+919822222222' }),
    ).toBeNull();
    expect(
      await getApplicationStatus(t(), { code: 'PA-RPR-2026-ZZZ999', verifiedPhone: '+919811111111' }),
    ).toBeNull();
  });
});
