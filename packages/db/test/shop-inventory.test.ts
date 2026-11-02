/**
 * Shop offers (spec 07): list, add a live SKU, change price/stock/lead time with compare-and-set; never above MRP,
 * never below reserved stock, only live products; audited with before/after; staff scope by the shop's city.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  listShopInventory,
  placeCodOrder,
  quoteCheckout,
  saveShopOffer,
  shopInStaffScope,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900'; // MRP ₹475

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let user = '';
const shop: Record<string, string> = {};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  user = (await db.insert(s.users).values({ firebaseUid: 'fb-inv-user' }).returning())[0]!.id;
  for (const row of await db.select().from(s.shops)) shop[row.name] = row.id;
});

afterAll(async () => {
  await client.close();
});

const offerOf = async (name: string, sku: string) =>
  (await listShopInventory(t(), shop[name]!, 'en')).find((o) => o.sku === sku);

describe('shop offers', () => {
  it('changes price and stock with the version; never above MRP or below reserved stock', async () => {
    const base = {
      shopId: shop['Sharma Auto Parts']!,
      sku: OIL,
      actorUserId: user,
      actorRole: 'shop' as const,
    };
    const o = (await offerOf('Sharma Auto Parts', OIL))!;
    expect(o).toMatchObject({ sellingPaise: 44000, mrpPaise: 47500, free: 12 });
    await expect(
      saveShopOffer(t(), { ...base, expectedVersion: o.version, changes: { sellingPaise: 48000 } }),
    ).rejects.toMatchObject({
      code: 'PRICE_ABOVE_MRP',
    });
    const r = await saveShopOffer(t(), {
      ...base,
      expectedVersion: o.version,
      changes: { sellingPaise: 43000, leadDays: 2 },
    });
    await expect(
      saveShopOffer(t(), { ...base, expectedVersion: o.version, changes: { onHand: 5 } }),
    ).rejects.toMatchObject({
      code: 'STALE_OFFER',
    });

    // An order reserves 3; stock cannot drop below that.
    const lines = [{ sku: OIL, qty: 3 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    await placeCodOrder(t(), {
      userId: user,
      idempotencyKey: 'inventory-key-0000001',
      address: {
        contactName: 'Ravi',
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
    const after = (await offerOf('Sharma Auto Parts', OIL))!;
    expect(after).toMatchObject({ sellingPaise: 43000, reserved: 3 });
    // The reservation bumped the version too: a shop editing while an order arrives must reload.
    expect(after.version).toBe(r.version + 1);
    await expect(
      saveShopOffer(t(), { ...base, expectedVersion: after.version, changes: { onHand: 2 } }),
    ).rejects.toMatchObject({
      code: 'STOCK_BELOW_RESERVED',
    });
    await saveShopOffer(t(), { ...base, expectedVersion: after.version, changes: { onHand: 3 } });
    expect((await offerOf('Sharma Auto Parts', OIL))!.free).toBe(0);
    const [audit] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'inventory.updated'));
    expect(audit).toMatchObject({
      before: { sellingPaise: 44000, leadDays: 1 },
      after: { sellingPaise: 43000, leadDays: 2 },
    });
  });

  it('adds a live SKU once; drafts and unknown SKUs cannot be offered', async () => {
    const tyre = fixture.products.find((p) => p.slug === 'scooter-tubeless-tyre-90-90-12')!.sku;
    const add = (sku: string) =>
      saveShopOffer(t(), {
        shopId: shop['Gupta Lubes & Spares']!,
        sku,
        expectedVersion: null,
        changes: { sellingPaise: 160000, onHand: 4 },
        actorUserId: user,
        actorRole: 'staff',
      });
    await add(tyre);
    expect(await offerOf('Gupta Lubes & Spares', tyre)).toMatchObject({
      sellingPaise: 160000,
      onHand: 4,
      active: true,
    });
    await expect(add(tyre)).rejects.toMatchObject({ code: 'ALREADY_LISTED' });
    await expect(add('NO-SUCH')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await db.update(s.products).set({ status: 'draft' }).where(eq(s.products.slug, 'car-tyre-185-65-r15'));
    const draftSku = fixture.products.find((p) => p.slug === 'car-tyre-185-65-r15')!.sku;
    await expect(add(draftSku)).rejects.toMatchObject({ code: 'PRODUCT_NOT_LIVE' });
  });

  it('staff reach only shops in their cities', async () => {
    await expect(
      shopInStaffScope(t(), shop['Sharma Auto Parts']!, { all: false, cityIds: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(shopInStaffScope(t(), shop['Sharma Auto Parts']!, { all: true })).resolves.toBeUndefined();
  });
});
