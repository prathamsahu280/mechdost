/**
 * Sizes of one product in the checkout (user 2026-11-24, "like 500 ml and 1 L"): each size is its own variant, so a
 * cart with two sizes is two lines, each priced and stocked on its own; the order snapshot names the size (title and
 * `variant_label`); a product with a single size is shown exactly as before.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { placeCodOrder, quoteCheckout, type ShippingAddress, type Tx } from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let userId = '';

const OIL = 'CAS-ACT4T-0900';
const OIL_2L = 'CAS-ACT4T-2000';
const address: ShippingAddress = {
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  line2: null,
  landmark: null,
  pincode: '492004',
};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  userId = (await db.insert(s.users).values({ firebaseUid: 'fb-sizes-ravi' }).returning())[0]!.id;
  const [first] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, OIL));
  await db
    .update(s.productVariants)
    .set({ options: { size: '900 ml' } })
    .where(eq(s.productVariants.sku, OIL));
  const [second] = await db
    .insert(s.productVariants)
    .values({ productId: first!.productId, sku: OIL_2L, mrpPaise: 190_000, options: { size: '2 L' } })
    .returning();
  const [stock] = await db.select().from(s.shopInventory).where(eq(s.shopInventory.variantId, first!.id));
  await db.insert(s.shopInventory).values({
    shopId: stock!.shopId,
    variantId: second!.id,
    sellingPaise: 180_000,
    onHand: 3,
    leadDays: 1,
  });
});

afterAll(async () => {
  await client.close();
});

describe('two sizes of one product', () => {
  it('quote: two lines, each priced on its own, each named with its size', async () => {
    const q = await quoteCheckout(t(), {
      pincode: '492004',
      lines: [
        { sku: OIL, qty: 1 },
        { sku: OIL_2L, qty: 2 },
      ],
      locale: 'en',
    });
    expect(q.ok).toBe(true);
    expect(q.lines.map((l) => [l.sku, l.unitPaise, l.name])).toEqual([
      [OIL, 44_000, 'Castrol Activ 4T 20W40 900 ml · 900 ml'],
      [OIL_2L, 180_000, 'Castrol Activ 4T 20W40 900 ml · 2 L'],
    ]);
  });

  it('order: two items, each with its variant, label column and a title that names the size', async () => {
    const lines = [
      { sku: OIL, qty: 1 },
      { sku: OIL_2L, qty: 2 },
    ];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    await placeCodOrder(t(), {
      userId,
      idempotencyKey: 'sizes-key-000001',
      address,
      lines,
      expectedTotalPaise: q.totalPaise,
      note: null,
      locale: 'en',
    });
    // This database holds only this file's order.
    const items = await db.select().from(s.orderItems);
    expect(items.map((i) => [i.sku, i.qty, i.variantLabel]).sort()).toEqual([
      [OIL, 1, '900 ml'],
      [OIL_2L, 2, '2 L'],
    ]);
    expect(items.find((i) => i.sku === OIL_2L)?.title).toBe('Castrol Activ 4T 20W40 900 ml · 2 L');
    expect(new Set(items.map((i) => i.variantId)).size).toBe(2);
  });

  it('stock is per size: ordering more of one size than it has leaves the other size buyable', async () => {
    const q = await quoteCheckout(t(), {
      pincode: '492004',
      lines: [
        { sku: OIL, qty: 1 },
        { sku: OIL_2L, qty: 50 },
      ],
      locale: 'en',
    });
    expect(q.lines.find((l) => l.sku === OIL_2L)?.issue).toBe('insufficient_stock');
    expect(q.lines.find((l) => l.sku === OIL)?.issue).toBeNull();
  });

  it('a product with one size keeps its plain name and no label', async () => {
    const q = await quoteCheckout(t(), {
      pincode: '492004',
      lines: [{ sku: 'TYR-SC-909012', qty: 1 }],
      locale: 'en',
    });
    expect(q.lines[0]?.name).toBe('MRF Tubeless scooter tyre 90/90-12');
  });
});
