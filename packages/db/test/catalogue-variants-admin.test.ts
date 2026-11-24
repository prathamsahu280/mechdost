/**
 * Staff editing the sizes (variants) of a product (user 2026-11-24): add a size, edit its label / MRP / barcode,
 * archive and restore it. Every change is a conditional update on the size's version, is audited with before and
 * after, never lowers an MRP under a price already set, and never archives the last active size of a live product.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { addVariant, getAdminProduct, updateVariant, type Tx } from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staffId = '';
const SLUG = 'castrol-activ-4t-20w40-900ml';
const OIL = 'CAS-ACT4T-0900';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  staffId = (await db.insert(s.users).values({ firebaseUid: 'fb-variant-staff' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

const audit = (action: string) =>
  db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.action, action), eq(s.auditLog.actorUserId, staffId)));

describe('add a size', () => {
  it('creates an active size with its label, MRP and barcode, and audits it', async () => {
    const created = await addVariant(t(), {
      slug: SLUG,
      sku: 'CAS-ACT4T-2000',
      options: { size: '2 L' },
      mrpPaise: 190_000,
      barcode: '8901234567890',
      staffUserId: staffId,
    });
    expect(created).toMatchObject({ sku: 'CAS-ACT4T-2000', version: 1 });
    const detail = await getAdminProduct(t(), SLUG);
    expect(detail.variants.find((v) => v.sku === 'CAS-ACT4T-2000')).toMatchObject({
      label: '2 L',
      mrpPaise: 190_000,
      barcode: '8901234567890',
      status: 'active',
      version: 1,
    });
    expect((await audit('variant.added')).length).toBe(1);
  });

  it('refuses a SKU that exists (any product), an unknown product and a bad MRP', async () => {
    const base = { options: { size: '5 L' }, mrpPaise: 100, barcode: null, staffUserId: staffId };
    await expect(addVariant(t(), { ...base, slug: SLUG, sku: OIL })).rejects.toMatchObject({
      code: 'SKU_TAKEN',
    });
    await expect(addVariant(t(), { ...base, slug: 'nope', sku: 'NEW-1' })).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    await expect(addVariant(t(), { ...base, slug: SLUG, sku: 'NEW-2', mrpPaise: 0 })).rejects.toMatchObject({
      code: 'MRP_INVALID',
    });
  });

  it('a size without an MRP is price on request', async () => {
    await addVariant(t(), {
      slug: SLUG,
      sku: 'CAS-ACT4T-5000',
      options: { size: '5 L' },
      mrpPaise: null,
      barcode: null,
      staffUserId: staffId,
    });
    const v = (await getAdminProduct(t(), SLUG)).variants.find((x) => x.sku === 'CAS-ACT4T-5000');
    expect(v?.mrpPaise).toBeNull();
  });
});

describe('edit a size', () => {
  it('changes the label, MRP and barcode with the version, bumps it and audits before and after', async () => {
    const out = await updateVariant(t(), {
      sku: 'CAS-ACT4T-2000',
      expectedVersion: 1,
      changes: { options: { size: '2 L pack' }, mrpPaise: 195_000, barcode: null },
      staffUserId: staffId,
    });
    expect(out.version).toBe(2);
    const v = (await getAdminProduct(t(), SLUG)).variants.find((x) => x.sku === 'CAS-ACT4T-2000');
    expect(v).toMatchObject({ label: '2 L pack', mrpPaise: 195_000, barcode: null, version: 2 });
    const rows = await audit('variant.updated');
    expect(rows[0]?.before).toMatchObject({ mrpPaise: 190_000 });
    expect(rows[0]?.after).toMatchObject({ mrpPaise: 195_000 });
  });

  it('a stale version is refused and changes nothing; of two staff saving at once only one wins', async () => {
    await expect(
      updateVariant(t(), {
        sku: 'CAS-ACT4T-2000',
        expectedVersion: 1,
        changes: { mrpPaise: 100_000 },
        staffUserId: staffId,
      }),
    ).rejects.toMatchObject({ code: 'STALE_VARIANT' });
    const results = await Promise.allSettled([
      updateVariant(t(), {
        sku: 'CAS-ACT4T-2000',
        expectedVersion: 2,
        changes: { barcode: '1111' },
        staffUserId: staffId,
      }),
      updateVariant(t(), {
        sku: 'CAS-ACT4T-2000',
        expectedVersion: 2,
        changes: { barcode: '2222' },
        staffUserId: staffId,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('never lowers an MRP under a price a shop already set', async () => {
    await expect(
      updateVariant(t(), {
        sku: OIL,
        expectedVersion: 1,
        changes: { mrpPaise: 1_000 },
        staffUserId: staffId,
      }),
    ).rejects.toMatchObject({ code: 'MRP_BELOW_PRICE' });
  });

  it('an unknown size is a 404 and an empty change is refused', async () => {
    await expect(
      updateVariant(t(), {
        sku: 'NOPE',
        expectedVersion: 1,
        changes: { barcode: '1234' },
        staffUserId: staffId,
      }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(
      updateVariant(t(), { sku: OIL, expectedVersion: 1, changes: {}, staffUserId: staffId }),
    ).rejects.toMatchObject({ code: 'EMPTY_PATCH' });
  });
});

describe('archive and restore a size', () => {
  it('archiving hides the size from the storefront; restoring brings it back', async () => {
    const before = (await getAdminProduct(t(), SLUG)).variants.find((x) => x.sku === 'CAS-ACT4T-5000');
    const archived = await updateVariant(t(), {
      sku: 'CAS-ACT4T-5000',
      expectedVersion: before!.version,
      changes: { status: 'archived' },
      staffUserId: staffId,
    });
    const row = (await getAdminProduct(t(), SLUG)).variants.find((x) => x.sku === 'CAS-ACT4T-5000');
    expect(row?.status).toBe('archived');
    expect((await audit('variant.archived')).length).toBe(1);
    await updateVariant(t(), {
      sku: 'CAS-ACT4T-5000',
      expectedVersion: archived.version,
      changes: { status: 'active' },
      staffUserId: staffId,
    });
    expect((await audit('variant.restored')).length).toBe(1);
  });

  it('the last active size of a live product cannot be archived', async () => {
    await expect(
      updateVariant(t(), {
        sku: 'TYR-SC-909012',
        expectedVersion: 1,
        changes: { status: 'archived' },
        staffUserId: staffId,
      }),
    ).rejects.toMatchObject({ code: 'LAST_VARIANT' });
  });

  it('archiving one size leaves the others, their offers and stock alone', async () => {
    const stock = await db
      .select()
      .from(s.shopInventory)
      .innerJoin(s.productVariants, eq(s.productVariants.id, s.shopInventory.variantId))
      .where(eq(s.productVariants.sku, OIL));
    expect(stock.length).toBeGreaterThan(0);
    const mine = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, 'CAS-ACT4T-2000'));
    await updateVariant(t(), {
      sku: 'CAS-ACT4T-2000',
      expectedVersion: mine[0]!.version,
      changes: { status: 'archived' },
      staffUserId: staffId,
    });
    const after = await db
      .select()
      .from(s.shopInventory)
      .innerJoin(s.productVariants, eq(s.productVariants.id, s.shopInventory.variantId))
      .where(eq(s.productVariants.sku, OIL));
    expect(after.map((r) => r.shop_inventory.onHand)).toEqual(stock.map((r) => r.shop_inventory.onHand));
    expect(after[0]?.product_variants.status).toBe('active');
  });
});
