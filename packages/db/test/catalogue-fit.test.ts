/**
 * "Fits your vehicle" for sizes (user 2026-11-24): the saved vehicles of the signed-in customer are matched on the
 * server against the private per-size fitment (`spec.variantSpecs[sku].fitment`); only the SKU of the first
 * matching size and the vehicle's make and model leave the server, never the fitment lists.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { createVehicle, fitVariantForUser, getCatalogueProduct, type Tx } from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let userId = '';
let otherId = '';
const SLUG = 'car-tyre-185-65-r15';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  userId = (await db.insert(s.users).values({ firebaseUid: 'fb-fit-a' }).returning())[0]!.id;
  otherId = (await db.insert(s.users).values({ firebaseUid: 'fb-fit-b' }).returning())[0]!.id;
  const [product] = await db.select().from(s.products).where(eq(s.products.slug, SLUG));
  const [v1] = await db.select().from(s.productVariants).where(eq(s.productVariants.productId, product!.id));
  await db
    .update(s.productVariants)
    .set({ options: { size: '185/65 R15' } })
    .where(eq(s.productVariants.id, v1!.id));
  await db.insert(s.productVariants).values({
    productId: product!.id,
    sku: 'TYR-PC-1756514',
    mrpPaise: 365_000,
    options: { size: '175/65 R14' },
  });
  await db
    .update(s.products)
    .set({
      spec: {
        variantSpecs: {
          [v1!.sku]: { fitment: [{ vehicleType: 'car', make: 'Honda', model: 'City' }] },
          'TYR-PC-1756514': {
            fitment: [
              { vehicleType: 'car', make: 'Maruti Suzuki', model: 'Swift' },
              { vehicleType: 'car', make: 'Hyundai', model: 'i10' },
            ],
          },
        },
      },
    })
    .where(eq(s.products.id, product!.id));
});

afterAll(async () => {
  await client.close();
});

describe('fitVariantForUser', () => {
  it('has no match without a saved vehicle', async () => {
    expect(await fitVariantForUser(t(), userId, SLUG)).toEqual({ fitsVariantSku: null, vehicle: null });
  });

  it('picks the size whose fitment lists the saved vehicle, and names only the vehicle', async () => {
    await createVehicle(t(), userId, { type: '4W', fuel: 'petrol', make: 'Maruti-Suzuki', model: 'SWIFT' });
    expect(await fitVariantForUser(t(), userId, SLUG)).toEqual({
      fitsVariantSku: 'TYR-PC-1756514',
      vehicle: { make: 'Maruti-Suzuki', model: 'SWIFT' },
    });
  });

  it('is scoped to the caller: another customer sees no match', async () => {
    expect(await fitVariantForUser(t(), otherId, SLUG)).toEqual({ fitsVariantSku: null, vehicle: null });
  });

  it('a product that does not exist or is not live is a 404', async () => {
    await expect(fitVariantForUser(t(), userId, 'no-such-product')).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });

  it('keeps the fitment out of the public product page', async () => {
    const page = await getCatalogueProduct(t(), SLUG, { cityCode: 'RPR', locale: 'en' });
    expect(JSON.stringify(page.spec)).not.toContain('fitment');
    expect(page.variants.map((v) => v.label).sort()).toEqual(['175/65 R14', '185/65 R15']);
  });
});
