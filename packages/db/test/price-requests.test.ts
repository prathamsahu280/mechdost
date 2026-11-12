/**
 * Price requests (plan 2026-11-13 Task 3; user: every price is approved by staff, line by line): one pending per
 * shop and product, approval puts it on sale, a rejected change takes it off sale for that shop (orders already
 * placed keep their stock) and the next nearby shop serves the PIN; a shop can no longer set a price directly;
 * a new shop goes live only after the agreement, an approved price and a delivery area.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  acceptAgreement,
  decidePriceRequest,
  getCatalogueProduct,
  placeCodOrder,
  publishAgreement,
  quoteCheckout,
  saveShopOffer,
  submitPriceRequest,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900';
const OIL_SLUG = 'castrol-activ-4t-20w40-900ml';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let sharma = '';

const shopNamed = async (name: string) =>
  (await db.select({ id: s.shops.id }).from(s.shops).where(eq(s.shops.name, name)))[0]!.id;
const listing = async (shopId: string, sku: string) =>
  (
    await db
      .select({ inv: s.shopInventory })
      .from(s.shopInventory)
      .innerJoin(s.productVariants, eq(s.productVariants.id, s.shopInventory.variantId))
      .where(and(eq(s.shopInventory.shopId, shopId), eq(s.productVariants.sku, sku)))
  )[0]?.inv;
const sellerFor = async (pincode: string) =>
  (await getCatalogueProduct(t(), OIL_SLUG, { cityCode: 'RPR', pincode, locale: 'en' })).variants[0]?.offer
    ?.seller ?? null;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-prices-staff' }).returning())[0]!.id;
  sharma = await shopNamed('Sharma Auto Parts');
});

afterAll(async () => {
  await client.close();
});

describe('submitting prices', () => {
  it('refuses a price above the MRP or for a product that is not live; a newer request supersedes the older one', async () => {
    await expect(
      submitPriceRequest(t(), { shopId: sharma, userId: staff, sku: OIL, pricePaise: 99_00_000, onHand: 5 }),
    ).rejects.toMatchObject({ code: 'PRICE_ABOVE_MRP' });
    const [draft] = await db
      .insert(s.products)
      .values({
        slug: 'draft-oil',
        name: 'Draft oil',
        brandId: (await db.select().from(s.brands).limit(1))[0]!.id,
        categoryId: (await db.select().from(s.categories).limit(1))[0]!.id,
        hsn: '2710',
        gstRateBp: 1800,
      })
      .returning();
    await db.insert(s.productVariants).values({ productId: draft!.id, sku: 'DRAFT-OIL-1', mrpPaise: 50000 });
    await expect(
      submitPriceRequest(t(), {
        shopId: sharma,
        userId: staff,
        sku: 'DRAFT-OIL-1',
        pricePaise: 40000,
        onHand: 5,
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_LIVE' });
    const first = await submitPriceRequest(t(), {
      shopId: sharma,
      userId: staff,
      sku: OIL,
      pricePaise: 43000,
      onHand: 5,
    });
    const second = await submitPriceRequest(t(), {
      shopId: sharma,
      userId: staff,
      sku: OIL,
      pricePaise: 42500,
      onHand: 5,
    });
    const rows = await db.select().from(s.shopPriceRequests).where(eq(s.shopPriceRequests.shopId, sharma));
    expect(rows.find((r) => r.id === first.id)?.status).toBe('superseded');
    expect(rows.find((r) => r.id === second.id)?.status).toBe('pending');
  });

  it('a shop can no longer set a price directly; staff still can', async () => {
    const before = await listing(sharma, OIL);
    await expect(
      saveShopOffer(t(), {
        shopId: sharma,
        sku: OIL,
        expectedVersion: before!.version,
        changes: { sellingPaise: 41000 },
        actorUserId: staff,
        actorRole: 'shop',
      }),
    ).rejects.toMatchObject({ code: 'PRICE_NEEDS_APPROVAL' });
    await saveShopOffer(t(), {
      shopId: sharma,
      sku: OIL,
      expectedVersion: before!.version,
      changes: { onHand: 15 },
      actorUserId: staff,
      actorRole: 'shop',
    });
  });
});

describe('deciding prices', () => {
  it('approval puts the price on sale (re-checking the MRP); the old price stays while a change waits', async () => {
    const pending = (
      await db
        .select()
        .from(s.shopPriceRequests)
        .where(and(eq(s.shopPriceRequests.shopId, sharma), eq(s.shopPriceRequests.status, 'pending')))
    )[0]!;
    expect((await listing(sharma, OIL))?.sellingPaise).toBe(44000); // old price still on sale
    await decidePriceRequest(t(), {
      id: pending.id,
      expectedVersion: pending.version,
      staffUserId: staff,
      decision: 'approved',
    });
    expect(await listing(sharma, OIL)).toMatchObject({
      sellingPaise: 42500,
      active: true,
      adminBlocked: false,
    });
  });

  it('rejecting a live price keeps open orders, takes it off sale for that shop, and the next shop serves the PIN', async () => {
    expect(await sellerFor('492004')).toBe('Sharma Auto Parts');
    const lines = [{ sku: OIL, qty: 1 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const buyer = (await db.insert(s.users).values({ firebaseUid: 'fb-prices-buyer' }).returning())[0]!.id;
    await placeCodOrder(t(), {
      userId: buyer,
      idempotencyKey: 'prices-open-order-0001',
      address: {
        contactName: 'Ravi',
        contactPhone: '+919876543210',
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
    const req = await submitPriceRequest(t(), {
      shopId: sharma,
      userId: staff,
      sku: OIL,
      pricePaise: 44500,
      onHand: 15,
    });
    const [row] = await db.select().from(s.shopPriceRequests).where(eq(s.shopPriceRequests.id, req.id));
    await decidePriceRequest(t(), {
      id: req.id,
      expectedVersion: row!.version,
      staffUserId: staff,
      decision: 'rejected',
      reasonCode: 'above_market',
    });
    const inv = await listing(sharma, OIL);
    expect(inv).toMatchObject({ active: false, adminBlocked: true, blockedReasonCode: 'above_market' });
    const holds = await db.select().from(s.reservations).where(eq(s.reservations.inventoryId, inv!.id));
    expect(holds.some((h) => h.status === 'active')).toBe(true); // the open order keeps its stock
    expect(await sellerFor('492004')).not.toBe('Sharma Auto Parts');
    await expect(
      saveShopOffer(t(), {
        shopId: sharma,
        sku: OIL,
        expectedVersion: inv!.version,
        changes: { active: true },
        actorUserId: staff,
        actorRole: 'shop',
      }),
    ).rejects.toMatchObject({ code: 'LISTING_BLOCKED' });
  });
});

describe('going live', () => {
  it('a new shop goes live only after the agreement, an approved price and a delivery area, in any order', async () => {
    const pincode = (await db.select().from(s.pincodes).where(eq(s.pincodes.pincode, '492004')))[0]!;
    const [shop] = await db
      .insert(s.shops)
      .values({
        name: 'New Shop',
        phone: '+919800000001',
        addressLine: 'Main Road',
        pincode: '492004',
        cityId: pincode.cityId!,
        stateId: pincode.stateId,
      })
      .returning();
    const status = async () => (await db.select().from(s.shops).where(eq(s.shops.id, shop!.id)))[0]!.status;
    const { version } = await publishAgreement(t(), {
      textEn: 'MechDost seller agreement, version 1 (placeholder).',
      textHi: 'MechDost विक्रेता अनुबंध, संस्करण 1 (अस्थायी पाठ)।',
      staffUserId: staff,
    });
    await acceptAgreement(t(), { shopId: shop!.id, userId: staff, version });
    expect(await status()).toBe('pending');
    const req = await submitPriceRequest(t(), {
      shopId: shop!.id,
      userId: staff,
      sku: OIL,
      pricePaise: 43000,
      onHand: 4,
    });
    const [row] = await db.select().from(s.shopPriceRequests).where(eq(s.shopPriceRequests.id, req.id));
    await decidePriceRequest(t(), {
      id: req.id,
      expectedVersion: row!.version,
      staffUserId: staff,
      decision: 'approved',
    });
    expect(await status()).toBe('pending'); // no delivery area yet
    await db.insert(s.shopPincodes).values({ shopId: shop!.id, pincode: '492004', shippingPaise: 4000 });
    await acceptAgreement(t(), { shopId: shop!.id, userId: staff, version }); // re-check is idempotent
    expect(await status()).toBe('approved');
  });
});

describe('agreement versions (security review 2026-11-13)', () => {
  it('only the current version can be accepted', async () => {
    const shop = (await db.select().from(s.shops).limit(1))[0]!;
    const v1 = (await db.select().from(s.agreementVersions))[0]!.version;
    await publishAgreement(t(), {
      textEn: 'MechDost seller agreement, version 2 (placeholder).',
      textHi: 'MechDost विक्रेता अनुबंध, संस्करण 2 (अस्थायी पाठ)।',
      staffUserId: staff,
    });
    await expect(acceptAgreement(t(), { shopId: shop.id, userId: staff, version: v1 })).rejects.toMatchObject(
      {
        code: 'AGREEMENT_OUTDATED',
      },
    );
  });
});
