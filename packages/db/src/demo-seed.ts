import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from './repo/orders';
import * as s from './schema';

/**
 * Raipur DEMO catalogue for the database (decision 2026-11-01 "Demo mode"; must be removed before public launch,
 * Q21). The fixture `packages/db/seed/raipur-demo.json` is generated from the web demo data
 * (`apps/web/test/demo-seed-fixture.test.ts`), so the catalogue API serves what the local demo shows, in English
 * and Hindi. Idempotent upserts in one transaction under an advisory lock; `removeRaipurDemo` takes it out again.
 */
export interface DemoFixture {
  state: { code: string; name: string; gstStateCode: string };
  city: { code: string; slug: string; name: string; nameHi: string; lat: number; lng: number };
  pincodes: { pincode: string; lat: number; lng: number }[];
  categories: {
    slug: string;
    name: string;
    nameHi: string;
    description: string;
    descriptionHi: string;
    sort: number;
  }[];
  brands: { slug: string; name: string }[];
  products: {
    slug: string;
    sku: string;
    name: string;
    nameHi: string;
    brand: string;
    category: string;
    specSummary: string;
    specSummaryHi: string | null;
    compatibility: string;
    compatibilityHi: string | null;
    highlights: string[];
    highlightsHi: string[];
    mrpPaise: number;
    hsn: string;
    gstRateBp: number;
    /** Vehicle types the product is for (decision 2026-11-12); empty = fitment not listed. */
    vehicleTypes?: ('2W' | '3W' | '4W')[];
  }[];
  shops: {
    slug: string;
    name: string;
    nameHi: string | null;
    addressLine: string;
    addressLineHi: string;
    pincode: string;
    lat: number;
    lng: number;
    phone: string;
  }[];
  coverage: { shippingPaise: number };
  offers: { shop: string; sku: string; sellingPaise: number; onHand: number; leadDays: number }[];
}

const LOCK = sql`select pg_advisory_xact_lock(hashtextextended('demo-seed:raipur', 0))`;

function need<T>(map: Map<string, T>, key: string, what: string): T {
  const v = map.get(key);
  if (v === undefined) throw new Error(`demo seed: unknown ${what} ${key}`);
  return v;
}

export interface DemoSeedResult {
  products: number;
  shops: number;
  offers: number;
}

export async function seedRaipurDemo(db: Tx, f: DemoFixture): Promise<DemoSeedResult> {
  return db.transaction(async (tx) => {
    await tx.execute(LOCK);
    await tx.insert(s.states).values(f.state).onConflictDoNothing({ target: s.states.code });
    const [state] = await tx
      .select({ id: s.states.id })
      .from(s.states)
      .where(eq(s.states.code, f.state.code));
    if (!state) throw new Error('demo seed: state missing');
    await tx
      .insert(s.cities)
      .values({
        stateId: state.id,
        code: f.city.code,
        slug: f.city.slug,
        name: f.city.name,
        nameHi: f.city.nameHi,
        status: 'live',
        centroid: { lng: f.city.lng, lat: f.city.lat },
      })
      .onConflictDoNothing({ target: s.cities.code });
    const [city] = await tx.select({ id: s.cities.id }).from(s.cities).where(eq(s.cities.code, f.city.code));
    if (!city) throw new Error('demo seed: city missing');

    for (const p of f.pincodes) {
      await tx
        .insert(s.pincodes)
        .values({
          pincode: p.pincode,
          stateId: state.id,
          cityId: city.id,
          centroid: { lng: p.lng, lat: p.lat },
          serviceableParts: true,
        })
        .onConflictDoUpdate({
          target: s.pincodes.pincode,
          set: { cityId: city.id, centroid: { lng: p.lng, lat: p.lat }, serviceableParts: true },
        });
    }

    const categoryIds = new Map<string, string>();
    for (const c of f.categories) {
      const [row] = await tx
        .insert(s.categories)
        .values(c)
        .onConflictDoUpdate({
          target: s.categories.slug,
          set: {
            name: c.name,
            nameHi: c.nameHi,
            description: c.description,
            descriptionHi: c.descriptionHi,
            sort: c.sort,
          },
        })
        .returning({ id: s.categories.id });
      if (row) categoryIds.set(c.slug, row.id);
    }
    const brandIds = new Map<string, string>();
    for (const b of f.brands) {
      const [row] = await tx
        .insert(s.brands)
        .values(b)
        .onConflictDoUpdate({ target: s.brands.slug, set: { name: b.name } })
        .returning({ id: s.brands.id });
      if (row) brandIds.set(b.slug, row.id);
    }

    const variantIds = new Map<string, string>();
    for (const p of f.products) {
      const values = {
        name: p.name,
        nameHi: p.nameHi,
        brandId: need(brandIds, p.brand, 'brand'),
        categoryId: need(categoryIds, p.category, 'category'),
        specSummary: p.specSummary,
        specSummaryHi: p.specSummaryHi,
        compatibility: p.compatibility,
        compatibilityHi: p.compatibilityHi,
        highlights: p.highlights,
        highlightsHi: p.highlightsHi,
        hsn: p.hsn,
        gstRateBp: p.gstRateBp,
        vehicleTypes: p.vehicleTypes ?? [],
        status: 'live',
      };
      const [product] = await tx
        .insert(s.products)
        .values({ slug: p.slug, ...values })
        .onConflictDoUpdate({
          target: s.products.slug,
          set: { ...values, version: sql`${s.products.version} + 1` },
        })
        .returning({ id: s.products.id });
      if (!product) throw new Error('demo seed: product upsert returned nothing');
      const [variant] = await tx
        .insert(s.productVariants)
        .values({ productId: product.id, sku: p.sku, mrpPaise: p.mrpPaise })
        .onConflictDoUpdate({
          target: s.productVariants.sku,
          set: { productId: product.id, mrpPaise: p.mrpPaise, status: 'active' },
        })
        .returning({ id: s.productVariants.id });
      if (variant) variantIds.set(p.sku, variant.id);
    }

    // Shops have no slug column: a demo shop is identified by its name within the city.
    const shopIds = new Map<string, string>();
    for (const shop of f.shops) {
      const values = {
        name: shop.name,
        nameHi: shop.nameHi,
        phone: shop.phone,
        addressLine: shop.addressLine,
        addressLineHi: shop.addressLineHi,
        pincode: shop.pincode,
        cityId: city.id,
        stateId: state.id,
        location: { lng: shop.lng, lat: shop.lat },
      };
      const [existing] = await tx
        .select({ id: s.shops.id })
        .from(s.shops)
        .where(and(eq(s.shops.cityId, city.id), eq(s.shops.name, shop.name)));
      if (existing) {
        await tx.update(s.shops).set(values).where(eq(s.shops.id, existing.id));
        shopIds.set(shop.slug, existing.id);
      } else {
        const [row] = await tx
          .insert(s.shops)
          .values({ ...values, status: 'approved' })
          .returning({ id: s.shops.id });
        if (row) shopIds.set(shop.slug, row.id);
      }
      for (const p of f.pincodes) {
        await tx
          .insert(s.shopPincodes)
          .values({
            shopId: need(shopIds, shop.slug, 'shop'),
            pincode: p.pincode,
            shippingPaise: f.coverage.shippingPaise,
          })
          .onConflictDoUpdate({
            target: [s.shopPincodes.shopId, s.shopPincodes.pincode],
            set: { shippingPaise: f.coverage.shippingPaise, active: true },
          });
      }
    }

    for (const o of f.offers) {
      const values = {
        shopId: need(shopIds, o.shop, 'shop'),
        variantId: need(variantIds, o.sku, 'sku'),
        sellingPaise: o.sellingPaise,
        onHand: o.onHand,
        leadDays: o.leadDays,
        active: true,
      };
      // Keep live reservations: on_hand never drops below what is reserved (stock CHECK).
      await tx
        .insert(s.shopInventory)
        .values(values)
        .onConflictDoUpdate({
          target: [s.shopInventory.shopId, s.shopInventory.variantId],
          set: {
            sellingPaise: o.sellingPaise,
            onHand: sql`greatest(${o.onHand}, ${s.shopInventory.reserved})`,
            leadDays: o.leadDays,
            active: true,
            version: sql`${s.shopInventory.version} + 1`,
          },
        });
    }
    return { products: f.products.length, shops: f.shops.length, offers: f.offers.length };
  });
}

/**
 * Takes the demo catalogue out (before public launch, Q21): offers, coverage and shops, then products. Anything
 * already referenced by an order stays (foreign keys refuse), and the whole removal rolls back — archive instead.
 */
export async function removeRaipurDemo(db: Tx, f: DemoFixture): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(LOCK);
    const [city] = await tx.select({ id: s.cities.id }).from(s.cities).where(eq(s.cities.code, f.city.code));
    if (city) {
      const shopRows = await tx
        .select({ id: s.shops.id })
        .from(s.shops)
        .where(
          and(
            eq(s.shops.cityId, city.id),
            inArray(
              s.shops.name,
              f.shops.map((x) => x.name),
            ),
          ),
        );
      const ids = shopRows.map((r) => r.id);
      if (ids.length > 0) {
        await tx.delete(s.shopInventory).where(inArray(s.shopInventory.shopId, ids));
        await tx.delete(s.shops).where(inArray(s.shops.id, ids));
      }
    }
    await tx.delete(s.products).where(
      inArray(
        s.products.slug,
        f.products.map((p) => p.slug),
      ),
    );
  });
}
