import { and, eq, isNull, sql } from 'drizzle-orm';
import { checkAdminPrice, type AdminPriceIssue } from '@mechdost/shared/admin-prices';
import { adminPrices, auditLog, cities, pincodes, productVariants, products } from '../schema';
import { BUYABLE_OFFER } from './catalogue';
import { ConflictError, NotFoundError, ValidationError, pgCode } from './errors';
import type { Tx } from './orders';
import { num, rowsOf } from './sql-rows';

/**
 * Admin customer prices (design `docs/superpowers/specs/2026-11-13-admin-catalogue-pin-prices-design.md`, Q26):
 * a city price per pack plus optional PIN overrides, with suggestions from the shops that can deliver there.
 * Rules (never above MRP, never below the lowest approved price of a shop that can fulfil) come from
 * `@mechdost/shared/admin-prices`. Every write is a compare-and-set on `version` and audited.
 */
export interface AdminPriceRef {
  pricePaise: number;
  version: number;
}

export interface PriceBoardPin {
  pincode: string;
  override: AdminPriceRef | null;
  /** Approved price of the nearest shop that delivers to this PIN with stock (today's customer price). */
  nearestShopPaise: number | null;
  lowestShopPaise: number | null;
  highestShopPaise: number | null;
}

export interface PriceBoardVariant {
  sku: string;
  mrpPaise: number | null;
  city: AdminPriceRef | null;
  pins: PriceBoardPin[];
}

export interface PriceBoard {
  productSlug: string;
  cityCode: string;
  variants: PriceBoardVariant[];
}

const PRICE_MESSAGES: Record<AdminPriceIssue, string> = {
  BAD_PRICE: 'Enter a price in whole paise above zero',
  MRP_EXCEEDED: 'The price cannot be above MRP',
  BELOW_SHOP_PRICE: 'The price is below what every shop there is paid; MechDost would lose money',
  NO_SHOP: 'No shop delivers this pack there with stock, so there is nothing to price against',
};

const stale = () => new ConflictError('Someone else changed this price; reload', 'STALE_PRICE');

async function cityByCode(db: Tx, cityCode: string): Promise<{ id: string; code: string }> {
  const [city] = await db
    .select({ id: cities.id, code: cities.code })
    .from(cities)
    .where(eq(cities.code, cityCode))
    .limit(1);
  if (!city) throw new NotFoundError('City not found');
  return city;
}

/** Per covered PIN of the city: the nearest, lowest and highest approved price among shops that can sell now. */
async function shopPricesByPin(
  db: Tx,
  variantId: string,
  cityId: string,
  pincode: string | null,
): Promise<Map<string, { nearest: number; lowest: number; highest: number }>> {
  const onePin = pincode === null ? sql`` : sql`and sp.pincode = ${pincode}`;
  const rows = rowsOf<{ pincode: string; nearest: unknown; lowest: unknown; highest: unknown }>(
    await db.execute(sql`
      select sp.pincode,
        (array_agg(si.selling_paise order by st_distance(s.location, pc.centroid) asc nulls last, si.selling_paise, s.id))[1] as nearest,
        min(si.selling_paise) as lowest, max(si.selling_paise) as highest
      from shop_pincodes sp
      join shops s on s.id = sp.shop_id and s.city_id = ${cityId}
      join pincodes pc on pc.pincode = sp.pincode and pc.city_id = ${cityId}
      join shop_inventory si on si.shop_id = s.id and si.variant_id = ${variantId}
      join product_variants v on v.id = si.variant_id
      where sp.active and ${BUYABLE_OFFER} ${onePin}
      group by sp.pincode
      order by sp.pincode`),
  );
  return new Map(
    rows.map((r) => [r.pincode, { nearest: num(r.nearest), lowest: num(r.lowest), highest: num(r.highest) }]),
  );
}

export async function getPriceBoard(
  db: Tx,
  input: { productSlug: string; cityCode: string },
): Promise<PriceBoard> {
  const city = await cityByCode(db, input.cityCode);
  const variants = await db
    .select({ id: productVariants.id, sku: productVariants.sku, mrpPaise: productVariants.mrpPaise })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(products.slug, input.productSlug), eq(productVariants.status, 'active')))
    .orderBy(productVariants.sku);
  if (variants.length === 0) throw new NotFoundError('Product not found');
  const out: PriceBoardVariant[] = [];
  for (const v of variants) {
    const prices = await db
      .select({ pincode: adminPrices.pincode, price: adminPrices.sellingPaise, version: adminPrices.version })
      .from(adminPrices)
      .where(and(eq(adminPrices.variantId, v.id), eq(adminPrices.cityId, city.id)));
    const cityRow = prices.find((p) => p.pincode === null);
    const overrides = new Map<string, AdminPriceRef>();
    for (const p of prices)
      if (p.pincode !== null) overrides.set(p.pincode, { pricePaise: p.price, version: p.version });
    const shops = await shopPricesByPin(db, v.id, city.id, null);
    out.push({
      sku: v.sku,
      mrpPaise: v.mrpPaise,
      city: cityRow ? { pricePaise: cityRow.price, version: cityRow.version } : null,
      pins: [...shops.entries()].map(([pincode, s]) => ({
        pincode,
        override: overrides.get(pincode) ?? null,
        nearestShopPaise: s.nearest,
        lowestShopPaise: s.lowest,
        highestShopPaise: s.highest,
      })),
    });
  }
  return { productSlug: input.productSlug, cityCode: city.code, variants: out };
}

async function variantBySku(db: Tx, sku: string): Promise<{ id: string; mrpPaise: number | null }> {
  const [v] = await db
    .select({ id: productVariants.id, mrpPaise: productVariants.mrpPaise })
    .from(productVariants)
    .where(eq(productVariants.sku, sku))
    .limit(1);
  if (!v) throw new NotFoundError('Pack not found');
  return v;
}

const priceKey = (variantId: string, cityId: string, pincode: string | null) =>
  and(
    eq(adminPrices.variantId, variantId),
    eq(adminPrices.cityId, cityId),
    pincode === null ? isNull(adminPrices.pincode) : eq(adminPrices.pincode, pincode),
  );

/** Set the city price (`pincode` null) or a PIN override. `expectedVersion` null = create. */
export async function setAdminPrice(
  db: Tx,
  input: {
    sku: string;
    cityCode: string;
    pincode: string | null;
    pricePaise: number;
    expectedVersion: number | null;
    staffUserId: string;
  },
): Promise<{ version: number }> {
  const variant = await variantBySku(db, input.sku);
  if (variant.mrpPaise === null)
    throw new ValidationError("Set this pack's MRP before its price", 'MRP_MISSING');
  const mrpPaise = variant.mrpPaise;
  const city = await cityByCode(db, input.cityCode);
  if (input.pincode !== null) {
    const [pin] = await db
      .select({ cityId: pincodes.cityId })
      .from(pincodes)
      .where(eq(pincodes.pincode, input.pincode))
      .limit(1);
    if (pin?.cityId !== city.id) throw new ValidationError('That PIN code is not in this city', 'PIN_CITY');
  }
  const shops = await shopPricesByPin(db, variant.id, city.id, input.pincode);
  const lows = [...shops.values()].map((s) => s.lowest);
  const issue = checkAdminPrice({
    pricePaise: input.pricePaise,
    mrpPaise,
    lowestShopPaise: lows.length > 0 ? Math.min(...lows) : null,
  });
  if (issue) throw new ValidationError(PRICE_MESSAGES[issue], issue);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ price: adminPrices.sellingPaise })
      .from(adminPrices)
      .where(priceKey(variant.id, city.id, input.pincode))
      .limit(1);
    let version: number;
    if (input.expectedVersion === null) {
      if (current) throw stale();
      try {
        const [row] = await tx
          .insert(adminPrices)
          .values({
            variantId: variant.id,
            cityId: city.id,
            pincode: input.pincode,
            sellingPaise: input.pricePaise,
            updatedBy: input.staffUserId,
          })
          .returning({ version: adminPrices.version });
        version = row?.version ?? 1;
      } catch (err) {
        if (pgCode(err) === '23505') throw stale();
        throw err;
      }
    } else {
      const [row] = await tx
        .update(adminPrices)
        .set({ sellingPaise: input.pricePaise, updatedBy: input.staffUserId })
        .where(
          and(priceKey(variant.id, city.id, input.pincode), eq(adminPrices.version, input.expectedVersion)),
        )
        .returning({ version: adminPrices.version });
      if (!row) throw stale();
      version = row.version;
    }
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'price.set',
      entity: 'product_variant',
      entityId: variant.id,
      before: current ? { cityCode: city.code, pincode: input.pincode, pricePaise: current.price } : null,
      after: { cityCode: city.code, pincode: input.pincode, pricePaise: input.pricePaise },
    });
    return { version };
  });
}

/** Remove a PIN override (the PIN then follows the city price). */
export async function clearPinPrice(
  db: Tx,
  input: { sku: string; cityCode: string; pincode: string; expectedVersion: number; staffUserId: string },
): Promise<void> {
  const variant = await variantBySku(db, input.sku);
  const city = await cityByCode(db, input.cityCode);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(adminPrices)
      .where(
        and(priceKey(variant.id, city.id, input.pincode), eq(adminPrices.version, input.expectedVersion)),
      )
      .returning({ price: adminPrices.sellingPaise });
    if (!row) throw stale();
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'price.cleared',
      entity: 'product_variant',
      entityId: variant.id,
      before: { cityCode: city.code, pincode: input.pincode, pricePaise: row.price },
      after: null,
    });
  });
}
