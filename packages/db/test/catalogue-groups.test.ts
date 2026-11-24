/**
 * Brand / range switches, the one visibility rule, bulk actions and "no MRP = not sellable" (design 2026-11-22,
 * spec 02/08/14). Hiding a brand removes its products from every storefront read at once and restoring brings them
 * back untouched; every switch is a version-checked, audited conditional UPDATE.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  addCartLine,
  bulkSetMrp,
  bulkSetProductStatus,
  catalogueHasMatch,
  getCart,
  getCatalogueProduct,
  listBrandGroups,
  listCatalogue,
  listCatalogueCategories,
  recommendFor,
  replaceCart,
  setBrandHidden,
  setRangeHidden,
  setWishlisted,
  submitPriceRequest,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};
const sku = (slug: string) => `SKU-${slug.toUpperCase()}`;

async function product(
  slug: string,
  opts: {
    brand: string;
    range?: string;
    category?: string;
    mrp?: number | null;
    status?: string;
    name?: string;
  },
) {
  const [p] = await db
    .insert(s.products)
    .values({
      slug,
      name: opts.name ?? slug,
      brandId: opts.brand,
      rangeId: opts.range ?? null,
      categoryId: opts.category ?? F.lub!,
      hsn: '2710',
      gstRateBp: 1800,
      status: opts.status ?? 'live',
    })
    .returning();
  await db
    .insert(s.productVariants)
    .values({ productId: p!.id, sku: sku(slug), mrpPaise: opts.mrp === undefined ? 100_000 : opts.mrp });
  return p!;
}

async function offer(slug: string, selling = 90_000) {
  const [v] = await db
    .select()
    .from(s.productVariants)
    .where(eq(s.productVariants.sku, sku(slug)));
  await db
    .insert(s.shopInventory)
    .values({ shopId: F.shop!, variantId: v!.id, sellingPaise: selling, onHand: 5 });
}

const list = async (extra: Partial<Parameters<typeof listCatalogue>[1]> = {}) =>
  (
    await listCatalogue(t(), { cityCode: 'RPR', pincode: '492001', locale: 'en', limit: 48, ...extra })
  ).items.map((i) => i.slug);

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [city] = await db
    .insert(s.cities)
    .values({
      stateId: state!.id,
      code: 'RPR',
      slug: 'raipur',
      name: 'Raipur',
      status: 'live',
      centroid: { lng: 81.64, lat: 21.227 },
    })
    .returning();
  await db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: city!.id,
    centroid: { lng: 81.64, lat: 21.227 },
  });
  F.staff = (await db.insert(s.users).values({ firebaseUid: 'fb-groups-staff' }).returning())[0]!.id;
  F.user = (await db.insert(s.users).values({ firebaseUid: 'fb-groups-user' }).returning())[0]!.id;
  F.lubRoot = (
    await db.insert(s.categories).values({ slug: 'lubricants', name: 'Lubricants' }).returning()
  )[0]!.id;
  F.lub = (
    await db
      .insert(s.categories)
      .values({ slug: 'motorcycle-oil', name: 'Motorcycle oil', parentId: F.lubRoot })
      .returning()
  )[0]!.id;
  F.castrol = (await db.insert(s.brands).values({ slug: 'castrol', name: 'Castrol' }).returning())[0]!.id;
  F.motul = (await db.insert(s.brands).values({ slug: 'motul', name: 'Motul' }).returning())[0]!.id;
  F.crb = (
    await db
      .insert(s.productRanges)
      .values({ brandId: F.castrol, slug: 'castrol-crb', name: 'Castrol CRB' })
      .returning()
  )[0]!.id;
  F.activ = (
    await db
      .insert(s.productRanges)
      .values({ brandId: F.castrol, slug: 'castrol-activ', name: 'Castrol Activ' })
      .returning()
  )[0]!.id;
  F.shop = (
    await db
      .insert(s.shops)
      .values({
        name: 'Shop',
        phone: '+919800000000',
        addressLine: 'Raipur',
        pincode: '492001',
        cityId: city!.id,
        stateId: state!.id,
        location: { lng: 81.641, lat: 21.227 },
        status: 'approved',
      })
      .returning()
  )[0]!.id;
  await db.insert(s.shopPincodes).values({ shopId: F.shop, pincode: '492001', shippingPaise: 4000 });

  await product('castrol-activ-4t', { brand: F.castrol, range: F.activ });
  await product('castrol-crb-diesel', { brand: F.castrol, range: F.crb });
  await product('castrol-plain', { brand: F.castrol });
  await product('motul-3100', { brand: F.motul });
  await product('motul-no-mrp', { brand: F.motul, mrp: null });
  for (const slug of ['castrol-activ-4t', 'castrol-crb-diesel', 'castrol-plain', 'motul-3100'])
    await offer(slug);
});
afterAll(async () => {
  await client.close();
});

const group = async (kind: 'brand' | 'range', slug: string) => {
  const brands = await listBrandGroups(t());
  const found =
    kind === 'brand'
      ? brands.find((b) => b.slug === slug)
      : brands.flatMap((b) => b.ranges).find((r) => r.slug === slug);
  if (!found) throw new Error(`no ${kind} ${slug}`);
  return found;
};
const brandGroup = async (slug: string) => {
  const found = (await listBrandGroups(t())).find((b) => b.slug === slug);
  if (!found) throw new Error(`no brand ${slug}`);
  return found;
};

describe('brand switch', () => {
  it('hiding a brand removes every product of it from every storefront read, and showing restores them', async () => {
    const before = await list();
    expect(before).toEqual(
      expect.arrayContaining(['castrol-activ-4t', 'castrol-crb-diesel', 'castrol-plain', 'motul-3100']),
    );
    await replaceCart(t(), F.user!, [{ sku: sku('castrol-plain'), qty: 1 }]);
    await setWishlisted(t(), F.user!, 'castrol-plain', true);

    const g = await group('brand', 'castrol');
    const res = await setBrandHidden(t(), {
      slug: 'castrol',
      hidden: true,
      reasonCode: 'supplier_issue',
      expectedVersion: g.version,
      staffUserId: F.staff!,
    });
    expect(res).toMatchObject({ hidden: true, hiddenReason: 'supplier_issue', productsAffected: 3 });

    expect((await list()).sort()).toEqual(['motul-3100', 'motul-no-mrp']);
    expect(await list({ q: 'castrol' })).toEqual([]);
    expect(await list({ brand: 'castrol' })).toEqual([]);
    await expect(
      getCatalogueProduct(t(), 'castrol-plain', { cityCode: 'RPR', pincode: '492001', locale: 'en' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await catalogueHasMatch(t(), 'castrol')).toBe(false);
    const cats = await listCatalogueCategories(t(), 'en');
    expect(cats.find((c) => c.slug === 'motorcycle-oil')?.liveProducts).toBe(2);
    await expect(addCartLine(t(), F.user!, sku('castrol-activ-4t'), 1)).rejects.toMatchObject({
      code: 'CART_LINE_UNAVAILABLE',
    });
    await expect(setWishlisted(t(), F.user!, 'castrol-plain', true)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // The line that was already in the cart is dropped as "not available", like an unpublished product.
    const cart = await getCart(t(), F.user!, 'en');
    expect(cart.lines.map((l) => l.sku)).not.toContain(sku('castrol-plain'));
    expect(await recommendFor(t(), { slugs: ['castrol-plain'], cityCode: 'RPR', locale: 'en' })).toEqual([]);
    // Product status is untouched: switching back is lossless.
    const [row] = await db.select().from(s.products).where(eq(s.products.slug, 'castrol-plain'));
    expect(row?.status).toBe('live');

    const g2 = await group('brand', 'castrol');
    const back = await setBrandHidden(t(), {
      slug: 'castrol',
      hidden: false,
      reasonCode: null,
      expectedVersion: g2.version,
      staffUserId: F.staff!,
    });
    expect(back).toMatchObject({ hidden: false, hiddenReason: null, productsAffected: 3 });
    expect(await list()).toEqual(
      expect.arrayContaining(['castrol-activ-4t', 'castrol-crb-diesel', 'castrol-plain', 'motul-3100']),
    );
    await expect(addCartLine(t(), F.user!, sku('castrol-activ-4t'), 1)).resolves.toBeDefined();
  });

  it('needs a reason code to hide, is version-checked and audited', async () => {
    const g = await group('brand', 'motul');
    await expect(
      setBrandHidden(t(), {
        slug: 'motul',
        hidden: true,
        reasonCode: null,
        expectedVersion: g.version,
        staffUserId: F.staff!,
      }),
    ).rejects.toMatchObject({ code: 'REASON_CODE' });
    await setBrandHidden(t(), {
      slug: 'motul',
      hidden: true,
      reasonCode: 'price_review',
      expectedVersion: g.version,
      staffUserId: F.staff!,
    });
    // A second screen with the old version loses.
    await expect(
      setBrandHidden(t(), {
        slug: 'motul',
        hidden: false,
        reasonCode: null,
        expectedVersion: g.version,
        staffUserId: F.staff!,
      }),
    ).rejects.toMatchObject({ code: 'STALE_GROUP' });
    await expect(
      setBrandHidden(t(), {
        slug: 'no-such-brand',
        hidden: true,
        reasonCode: 'legal',
        expectedVersion: 1,
        staffUserId: F.staff!,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const logs = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'brand.hidden'));
    const motul = logs.find((l) => (l.after as { reasonCode?: string }).reasonCode === 'price_review');
    expect(motul?.reason).toBe('price_review');
    expect(motul?.after).toMatchObject({ hidden: true, productsAffected: 2 });
    const g2 = await group('brand', 'motul');
    await setBrandHidden(t(), {
      slug: 'motul',
      hidden: false,
      reasonCode: null,
      expectedVersion: g2.version,
      staffUserId: F.staff!,
    });
  });

  it('the database refuses a hidden brand without a reason', async () => {
    await expect(
      db.update(s.brands).set({ hidden: true }).where(eq(s.brands.slug, 'castrol')),
    ).rejects.toThrow();
    await expect(
      db.update(s.brands).set({ hiddenReason: 'legal' }).where(eq(s.brands.slug, 'castrol')),
    ).rejects.toThrow();
  });
});

describe('range switch', () => {
  it('hides only that range, leaves the rest of the brand', async () => {
    const g = await group('range', 'castrol-crb');
    const res = await setRangeHidden(t(), {
      slug: 'castrol-crb',
      hidden: true,
      reasonCode: 'out_of_season',
      expectedVersion: g.version,
      staffUserId: F.staff!,
    });
    expect(res.productsAffected).toBe(1);
    const visible = await list();
    expect(visible).not.toContain('castrol-crb-diesel');
    expect(visible).toEqual(expect.arrayContaining(['castrol-activ-4t', 'castrol-plain']));
    const g2 = await group('range', 'castrol-crb');
    await setRangeHidden(t(), {
      slug: 'castrol-crb',
      hidden: false,
      reasonCode: null,
      expectedVersion: g2.version,
      staffUserId: F.staff!,
    });
    expect(await list()).toContain('castrol-crb-diesel');
  });

  it('a hidden category (or parent) hides its products too', async () => {
    await db.update(s.categories).set({ hidden: true }).where(eq(s.categories.id, F.lubRoot!));
    expect(await list()).toEqual([]);
    await db.update(s.categories).set({ hidden: false }).where(eq(s.categories.id, F.lubRoot!));
    expect((await list()).length).toBeGreaterThan(0);
  });

  it('brand counts show products, live products and packs without MRP', async () => {
    const motul = await group('brand', 'motul');
    expect(motul).toMatchObject({ products: 2, liveProducts: 2, missingMrpPacks: 1 });
    const castrol = await brandGroup('castrol');
    expect(castrol.ranges.map((r) => r.slug).sort()).toEqual(['castrol-activ', 'castrol-crb']);
  });
});

describe('no MRP = not sellable', () => {
  it('a pack without MRP never gets an offer or a cart line, and shops cannot price it', async () => {
    const page = await getCatalogueProduct(t(), 'motul-no-mrp', {
      cityCode: 'RPR',
      pincode: '492001',
      locale: 'en',
    });
    expect(page.variants[0]).toMatchObject({ mrpPaise: null, offer: null });
    await expect(addCartLine(t(), F.user!, sku('motul-no-mrp'), 1)).rejects.toMatchObject({
      code: 'CART_LINE_UNAVAILABLE',
    });
    await expect(
      submitPriceRequest(t(), {
        shopId: F.shop!,
        userId: F.staff!,
        sku: sku('motul-no-mrp'),
        pricePaise: 1000,
        onHand: 1,
      }),
    ).rejects.toMatchObject({ code: 'MRP_MISSING' });
  });
});

describe('bulk actions', () => {
  it('unpublish moves live to archived and publish brings drafts live; others are skipped with a reason', async () => {
    await product('bulk-draft', { brand: F.motul!, status: 'draft' });
    await product('bulk-live', { brand: F.motul! });
    const un = await bulkSetProductStatus(t(), {
      slugs: ['bulk-live', 'bulk-draft', 'nope'],
      action: 'unpublish',
      staffUserId: F.staff!,
    });
    expect(un.changed).toEqual(['bulk-live']);
    expect(un.skipped).toEqual(
      expect.arrayContaining([
        { slug: 'bulk-draft', reason: 'WRONG_STATE' },
        { slug: 'nope', reason: 'NOT_FOUND' },
      ]),
    );
    const pub = await bulkSetProductStatus(t(), {
      slugs: ['bulk-draft'],
      action: 'publish',
      staffUserId: F.staff!,
    });
    expect(pub.changed).toEqual(['bulk-draft']);
    const rows = await db
      .select()
      .from(s.products)
      .where(sql`${s.products.slug} in ('bulk-live','bulk-draft')`);
    expect(Object.fromEntries(rows.map((r) => [r.slug, r.status]))).toEqual({
      'bulk-live': 'archived',
      'bulk-draft': 'live',
    });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'product.status_changed'));
    expect(audit.filter((a) => (a.after as { bulk?: boolean }).bulk === true).length).toBe(2);
  });

  it('refuses an empty or oversized selection', async () => {
    await expect(
      bulkSetProductStatus(t(), { slugs: [], action: 'publish', staffUserId: F.staff! }),
    ).rejects.toMatchObject({ code: 'BULK_SIZE' });
    const many = Array.from({ length: 501 }, (_, i) => `p-${String(i)}`);
    await expect(
      bulkSetProductStatus(t(), { slugs: many, action: 'publish', staffUserId: F.staff! }),
    ).rejects.toMatchObject({ code: 'BULK_SIZE' });
    await expect(
      bulkSetMrp(t(), { items: many.map((x) => ({ sku: x, mrpPaise: 100 })), staffUserId: F.staff! }),
    ).rejects.toMatchObject({ code: 'BULK_SIZE' });
  });

  it('sets MRPs in bulk, never under an existing price, and audits each change', async () => {
    const res = await bulkSetMrp(t(), {
      items: [
        { sku: sku('motul-no-mrp'), mrpPaise: 55_000 },
        { sku: sku('motul-3100'), mrpPaise: 50_000 }, // the shop is paid ₹900: below it
        { sku: 'NO-SUCH-SKU', mrpPaise: 100 },
      ],
      staffUserId: F.staff!,
    });
    expect(res.updated).toEqual([sku('motul-no-mrp')]);
    expect(res.skipped).toEqual(
      expect.arrayContaining([
        { sku: sku('motul-3100'), reason: 'BELOW_PRICE' },
        { sku: 'NO-SUCH-SKU', reason: 'NOT_FOUND' },
      ]),
    );
    const [v] = await db
      .select()
      .from(s.productVariants)
      .where(eq(s.productVariants.sku, sku('motul-no-mrp')));
    expect(v?.mrpPaise).toBe(55_000);
    const log = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'variant.mrp_updated'));
    expect(log[0]).toMatchObject({
      entityId: sku('motul-no-mrp'),
      before: { mrpPaise: null },
      after: { mrpPaise: 55_000 },
    });
    await expect(
      bulkSetMrp(t(), { items: [{ sku: sku('motul-3100'), mrpPaise: 0 }], staffUserId: F.staff! }),
    ).rejects.toMatchObject({ code: 'MRP_INVALID' });
  });
});

describe('guard: one visibility rule', () => {
  it('no storefront repository reads a live product without productVisible()', () => {
    const dir = new URL('../src/repo/', import.meta.url);
    // Shop-side and admin repositories judge "live" for their own audience (seller pricing, the admin editor).
    const allowed = new Set([
      'visibility.ts',
      'catalogue-admin.ts',
      'catalogue-create.ts',
      'catalogue-bulk.ts',
      'catalogue-variants.ts',
      'catalogue-groups.ts',
      'catalogue-v2-import.ts',
      'price-requests.ts',
      'shop-inventory.ts',
      'shop-csv.ts',
      'product-photos.ts',
    ]);
    const bad: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || allowed.has(file)) continue;
      const text = readFileSync(new URL(file, dir), 'utf8');
      text.split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (
          /\bp\.status\s*=\s*'live'/.test(code) ||
          /products\.status,\s*'live'/.test(code) ||
          /\bpStatus\b.*'live'/.test(code)
        )
          bad.push(`${file}:${String(i + 1)}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

describe('MRP shown without an offer (spec 02, 2026-11-22)', () => {
  const card = async (slug: string) => {
    const [row] = await db.select().from(s.products).where(eq(s.products.slug, slug));
    const page = await listCatalogue(t(), {
      cityCode: 'RPR',
      pincode: '492001',
      locale: 'en',
      limit: 48,
      productIds: [row!.id],
    });
    return page.items[0];
  };

  it('with and without a shop offer the card carries the MRP; offer stays null without a shop', async () => {
    await product('mrp-sold', { brand: F.motul!, mrp: 120_000 });
    await offer('mrp-sold');
    await product('mrp-unsold', { brand: F.motul!, mrp: 80_000 });
    expect(await card('mrp-sold')).toMatchObject({ mrpFromPaise: 120_000, mrpVaries: false });
    expect(await card('mrp-unsold')).toMatchObject({ mrpFromPaise: 80_000, mrpVaries: false });
  });

  it('packs with different MRPs give the lowest and flag the difference; null MRPs are ignored', async () => {
    const p = await product('mrp-packs', { brand: F.motul!, mrp: 90_000 });
    await db.insert(s.productVariants).values([
      { productId: p.id, sku: 'MRP-PACKS-2', mrpPaise: 150_000 },
      { productId: p.id, sku: 'MRP-PACKS-3', mrpPaise: null },
    ]);
    expect(await card('mrp-packs')).toMatchObject({ mrpFromPaise: 90_000, mrpVaries: true });
  });

  it('no MRP at all is null, and the product page carries the same fields', async () => {
    await product('mrp-none', { brand: F.motul!, mrp: null });
    expect(await card('mrp-none')).toMatchObject({ mrpFromPaise: null, mrpVaries: false });
    const page = await getCatalogueProduct(t(), 'mrp-unsold', {
      cityCode: 'RPR',
      pincode: '492001',
      locale: 'en',
    });
    expect(page).toMatchObject({ mrpFromPaise: 80_000, mrpVaries: false });
  });
});
