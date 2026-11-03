import { sql, type SQL } from 'drizzle-orm';
import { NotFoundError, ValidationError } from './errors';
import { localized } from './localized';
import type { Tx } from './orders';
import { num, numOrNull, rowsOf } from './sql-rows';

/**
 * Public catalogue reads (spec 02). Only `live` products in a non-archived category are listed. Prices come
 * from offers that can actually be bought: active inventory with free stock, at an approved shop that is not
 * busy (paused/suspended shops are never `approved`, decision 2026-11-01).
 *
 * Price for a PIN (decision 2026-11-01 "Pincode-wise prices", Q26 default): the offer of the **nearest** shop
 * covering that PIN with stock (distance from the shop to the PIN centroid; lowest price breaks ties, then shop
 * id so the answer is stable). Without a PIN: "From ₹" = the lowest offer in the city.
 *
 * Search: the generated `products.search_vector` (English + Hindi columns), trigram word similarity on the
 * product and brand names (typos: "castrl" → Castrol), exact part number / SKU. Pagination is keyset on
 * (sort key, id), so pages stay stable while products are added.
 */
export type CatalogueLocale = 'en' | 'hi';
export const CATALOGUE_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc'] as const;
export type CatalogueSort = (typeof CATALOGUE_SORTS)[number];
export const CATALOGUE_PAGE_MAX = 48;
export const CATALOGUE_QUERY_MAX = 80;

/** Sort key for "no price" rows: they go last in both price orders. */
const NO_PRICE_ASC = 9_000_000_000_000_000;

export interface CataloguePlace {
  cityId: string;
  cityCode: string;
  /** The PIN prices were resolved for (null = city-wide "From ₹"). */
  pincode: string | null;
  /** False when the PIN is unknown or outside every city; prices are then all null. */
  pincodeKnown: boolean | null;
}

export interface CatalogueOffer {
  pricePaise: number;
  mrpPaise: number;
  /** Delivery charge for the PIN; null without a PIN. */
  shippingPaise: number | null;
  leadDays: number | null;
}

export interface CatalogueCard {
  id: string;
  slug: string;
  name: string;
  brand: { slug: string; name: string };
  category: { slug: string; name: string };
  specSummary: string | null;
  highlights: string[];
  offer: CatalogueOffer | null;
  rating: { avg: number; count: number } | null;
  photo: CataloguePhoto | null;
}

export interface CataloguePhoto {
  path: string;
  alt: string;
  width: number;
  height: number;
  blurhash: string | null;
}

export interface CataloguePage {
  place: CataloguePlace;
  items: CatalogueCard[];
  /** Opaque cursor for the next page; null on the last page. */
  nextCursor: string | null;
}

export interface CatalogueQuery {
  cityCode: string;
  pincode?: string | null;
  category?: string | null;
  brand?: string | null;
  q?: string | null;
  sort?: CatalogueSort | null;
  availableOnly?: boolean;
  cursor?: string | null;
  limit?: number;
  locale: CatalogueLocale;
}

/** A PIN prices the catalogue only in a live city — checkout refuses the others (code review 2026-11-03). */
async function resolvePlace(db: Tx, cityCode: string, pincode: string | null): Promise<CataloguePlace> {
  if (pincode) {
    const [row] = rowsOf<{ city_id: string; code: string }>(
      await db.execute(sql`
        select c.id as city_id, c.code from pincodes pc join cities c on c.id = pc.city_id
        where pc.pincode = ${pincode} and c.status = 'live'`),
    );
    if (row) return { cityId: row.city_id, cityCode: row.code, pincode, pincodeKnown: true };
  }
  const [city] = rowsOf<{ id: string; code: string }>(
    await db.execute(sql`select id, code from cities where code = ${cityCode}`),
  );
  if (!city) throw new NotFoundError('City not found');
  return {
    cityId: city.id,
    cityCode: city.code,
    pincode: pincode ?? null,
    pincodeKnown: pincode ? false : null,
  };
}

/**
 * Best buyable offer for the variants matched by `variants` (a condition on `v`), as a LATERAL subquery `o`.
 * With a PIN: only shops covering it, nearest first. Without: the city's lowest price.
 */
function offerLateral(place: CataloguePlace, variants: SQL): SQL {
  const buyable = sql`v.status = 'active' and si.active and si.on_hand - si.reserved > 0
    and s.status = 'approved' and not (s.busy and (s.busy_until is null or s.busy_until > now()))`;
  if (place.pincode) {
    return sql`left join lateral (
      select si.selling_paise as price, v.mrp_paise as mrp, sp.shipping_paise as shipping,
        coalesce(si.lead_days, sp.lead_days) as lead_days, s.name as shop_name, s.name_hi as shop_name_hi
      from product_variants v
      join shop_inventory si on si.variant_id = v.id
      join shops s on s.id = si.shop_id
      join shop_pincodes sp on sp.shop_id = s.id and sp.pincode = ${place.pincode} and sp.active
      where ${variants} and ${buyable}
      order by st_distance(s.location, (select centroid from pincodes where pincode = ${place.pincode})) asc nulls last,
        si.selling_paise, s.id
      limit 1) o on true`;
  }
  return sql`left join lateral (
    select si.selling_paise as price, v.mrp_paise as mrp, null::bigint as shipping, si.lead_days as lead_days,
      s.name as shop_name, s.name_hi as shop_name_hi
    from product_variants v
    join shop_inventory si on si.variant_id = v.id
    join shops s on s.id = si.shop_id and s.city_id = ${place.cityId}
    where ${variants} and ${buyable}
    order by si.selling_paise, s.id
    limit 1) o on true`;
}

interface Cursor {
  k: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'k' in parsed &&
      'id' in parsed &&
      typeof parsed.k === 'string' &&
      typeof parsed.id === 'string' &&
      parsed.k.length <= 64 &&
      UUID.test(parsed.id)
    )
      return { k: parsed.k, id: parsed.id };
  } catch {
    // fall through
  }
  throw new ValidationError('Invalid cursor', 'INVALID_CURSOR');
}

/** Upper-case alphanumerics, as stored in `part_numbers.normalised`. */
export function normalisePartNumber(q: string): string {
  return q.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

interface CardRow {
  id: string;
  slug: string;
  name: string;
  name_hi: string | null;
  brand_slug: string;
  brand_name: string;
  category_slug: string;
  category_name: string;
  category_name_hi: string | null;
  spec_summary: string | null;
  spec_summary_hi: string | null;
  highlights: string[] | null;
  highlights_hi: string[] | null;
  price: unknown;
  mrp: unknown;
  shipping: unknown;
  lead_days: unknown;
  sort_key_text: string;
  photo_path: string | null;
  photo_alt: string | null;
  photo_alt_hi: string | null;
  photo_width: unknown;
  photo_height: unknown;
  photo_blurhash: string | null;
  rating_avg: unknown;
  rating_count: unknown;
}

function toCard(r: CardRow, locale: CatalogueLocale): CatalogueCard {
  const price = numOrNull(r.price);
  const highlightsHi = r.highlights_hi ?? [];
  return {
    id: r.id,
    slug: r.slug,
    name: localized(r.name, r.name_hi, locale),
    brand: { slug: r.brand_slug, name: r.brand_name },
    category: { slug: r.category_slug, name: localized(r.category_name, r.category_name_hi, locale) },
    specSummary: r.spec_summary === null ? null : localized(r.spec_summary, r.spec_summary_hi, locale),
    highlights: locale === 'hi' && highlightsHi.length > 0 ? highlightsHi : (r.highlights ?? []),
    offer:
      price === null
        ? null
        : {
            pricePaise: price,
            mrpPaise: num(r.mrp),
            shippingPaise: numOrNull(r.shipping),
            leadDays: numOrNull(r.lead_days),
          },
    rating: num(r.rating_count ?? 0) > 0 ? { avg: num(r.rating_avg), count: num(r.rating_count) } : null,
    photo:
      r.photo_path === null
        ? null
        : {
            path: r.photo_path,
            alt: localized(r.photo_alt ?? '', r.photo_alt_hi, locale),
            width: num(r.photo_width),
            height: num(r.photo_height),
            blurhash: r.photo_blurhash,
          },
  };
}

/** First photo and approved-review rating for the rows of `page` (joined after the page is cut). */
const cardExtras = sql`
  left join lateral (
    select ph.storage_path as photo_path, ph.alt as photo_alt, ph.alt_hi as photo_alt_hi, ph.width as photo_width,
      ph.height as photo_height, ph.blurhash as photo_blurhash
    from product_photos ph where ph.product_id = pg.id order by ph.sort, ph.id limit 1) ph on true
  left join lateral (
    select avg(rv.rating)::float8 as rating_avg, count(*)::int as rating_count
    from reviews rv where rv.target_type = 'product' and rv.target_id = pg.id and rv.status = 'approved') rv on true`;

export async function listCatalogue(db: Tx, query: CatalogueQuery): Promise<CataloguePage> {
  const limit = Math.min(Math.max(query.limit ?? 24, 1), CATALOGUE_PAGE_MAX);
  const q = (query.q ?? '').trim().slice(0, CATALOGUE_QUERY_MAX);
  const sort: CatalogueSort =
    query.sort === 'relevance' && !q ? 'newest' : (query.sort ?? (q ? 'relevance' : 'newest'));
  const place = await resolvePlace(db, query.cityCode, query.pincode ?? null);

  const tsq = sql`(websearch_to_tsquery('english', ${q}) || websearch_to_tsquery('simple', ${q}))`;
  const part = normalisePartNumber(q);
  const partMatch =
    part.length >= 4
      ? sql`exists (select 1 from product_variants v2 left join part_numbers pn on pn.variant_id = v2.id
          where v2.product_id = p.id and (pn.normalised = ${part} or upper(v2.sku) = ${q.toUpperCase()}))`
      : sql`false`;
  const filters: SQL[] = [sql`p.status = 'live'`, sql`c.archived_at is null`];
  if (q) filters.push(sql`(p.search_vector @@ ${tsq} or ${q} <% p.name or ${q} <% b.name or ${partMatch})`);
  if (query.category)
    filters.push(
      sql`(c.slug = ${query.category} or c.parent_id = (select id from categories where slug = ${query.category}))`,
    );
  if (query.brand) filters.push(sql`b.slug = ${query.brand}`);
  if (query.availableOnly) filters.push(sql`o.price is not null`);

  const key: Record<CatalogueSort, { expr: SQL; type: SQL; dir: 'asc' | 'desc' }> = {
    relevance: {
      expr: sql`(ts_rank(p.search_vector, ${tsq}) + greatest(word_similarity(${q}, p.name), word_similarity(${q}, b.name))
        + case when ${partMatch} then 1 else 0 end)::float8`,
      type: sql`float8`,
      dir: 'desc',
    },
    newest: { expr: sql`p.created_at`, type: sql`timestamptz`, dir: 'desc' },
    price_asc: { expr: sql`coalesce(o.price, ${NO_PRICE_ASC})`, type: sql`bigint`, dir: 'asc' },
    price_desc: { expr: sql`coalesce(o.price, -1)`, type: sql`bigint`, dir: 'desc' },
  };
  const k = key[sort];
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const after = cursor
    ? k.dir === 'desc'
      ? sql`(r.sort_key, r.id) < (cast(${cursor.k} as ${k.type}), cast(${cursor.id} as uuid))`
      : sql`(r.sort_key, r.id) > (cast(${cursor.k} as ${k.type}), cast(${cursor.id} as uuid))`
    : sql`true`;
  const order = k.dir === 'desc' ? sql`sort_key desc, id desc` : sql`sort_key asc, id asc`;

  const result = await db.execute(sql`
    with ranked as (
      select p.id, p.slug, p.name, p.name_hi, b.slug as brand_slug, b.name as brand_name,
        c.slug as category_slug, c.name as category_name, c.name_hi as category_name_hi,
        p.spec_summary, p.spec_summary_hi, p.highlights, p.highlights_hi,
        o.price, o.mrp, o.shipping, o.lead_days, ${k.expr} as sort_key
      from products p
      join brands b on b.id = p.brand_id
      join categories c on c.id = p.category_id
      ${offerLateral(place, sql`v.product_id = p.id`)}
      where ${sql.join(filters, sql` and `)}
    ),
    pg as (
      select r.*, r.sort_key::text as sort_key_text from ranked r where ${after} order by ${order} limit ${limit + 1}
    )
    select pg.*, ph.*, rv.* from pg ${cardExtras}
    order by ${order}`);
  const rows = rowsOf<CardRow>(result);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    place,
    items: page.map((r) => toCard(r, query.locale)),
    nextCursor: rows.length > limit && last ? encodeCursor({ k: last.sort_key_text, id: last.id }) : null,
  };
}

export interface CatalogueVariant {
  sku: string;
  options: Record<string, unknown>;
  mrpPaise: number;
  offer: (CatalogueOffer & { seller: string }) | null;
}

export interface CatalogueProduct extends Omit<CatalogueCard, 'offer' | 'photo'> {
  description: string | null;
  compatibility: string | null;
  spec: Record<string, unknown>;
  countryOfOrigin: string;
  warranty: string | null;
  gstRateBp: number;
  partNumbers: { kind: string; value: string }[];
  photos: CataloguePhoto[];
  variants: CatalogueVariant[];
  place: CataloguePlace;
}

/** A live product page with each active variant's best offer for the PIN (or city). Others → 404. */
export async function getCatalogueProduct(
  db: Tx,
  slug: string,
  opts: { cityCode: string; pincode?: string | null; locale: CatalogueLocale },
): Promise<CatalogueProduct> {
  const place = await resolvePlace(db, opts.cityCode, opts.pincode ?? null);
  const [p] = rowsOf<
    CardRow & {
      description: string | null;
      description_hi: string | null;
      compatibility: string | null;
      compatibility_hi: string | null;
      spec: Record<string, unknown>;
      country_of_origin: string;
      warranty: string | null;
      gst_rate_bp: unknown;
    }
  >(
    await db.execute(sql`
      with pg as (
        select p.id, p.slug, p.name, p.name_hi, b.slug as brand_slug, b.name as brand_name,
          c.slug as category_slug, c.name as category_name, c.name_hi as category_name_hi,
          p.spec_summary, p.spec_summary_hi, p.highlights, p.highlights_hi, p.description, p.description_hi,
          p.compatibility, p.compatibility_hi, p.spec, p.country_of_origin, p.warranty, p.gst_rate_bp,
          null::bigint as price, null::bigint as mrp, null::bigint as shipping, null::int as lead_days,
          '' as sort_key_text
        from products p join brands b on b.id = p.brand_id join categories c on c.id = p.category_id
        where p.slug = ${slug} and p.status = 'live' and c.archived_at is null
      )
      select pg.*, ph.*, rv.* from pg ${cardExtras}`),
  );
  if (!p) throw new NotFoundError('Product not found');
  const variants = rowsOf<{
    sku: string;
    options: Record<string, unknown>;
    mrp_paise: unknown;
    price: unknown;
    mrp: unknown;
    shipping: unknown;
    lead_days: unknown;
    shop_name: string | null;
    shop_name_hi: string | null;
  }>(
    await db.execute(sql`
      select pv.sku, pv.options, pv.mrp_paise, o.price, o.mrp, o.shipping, o.lead_days, o.shop_name, o.shop_name_hi
      from product_variants pv
      ${offerLateral(place, sql`v.id = pv.id`)}
      where pv.product_id = ${p.id} and pv.status = 'active'
      order by pv.sku`),
  );
  const photos = rowsOf<{
    storage_path: string;
    alt: string;
    alt_hi: string | null;
    width: unknown;
    height: unknown;
    blurhash: string | null;
  }>(
    await db.execute(sql`
      select storage_path, alt, alt_hi, width, height, blurhash from product_photos
      where product_id = ${p.id} order by sort, id limit 12`),
  );
  const partNumbers = rowsOf<{ kind: string; value: string }>(
    await db.execute(sql`
      select distinct pn.kind, pn.value from part_numbers pn join product_variants v on v.id = pn.variant_id
      where v.product_id = ${p.id} and pn.kind in ('oe', 'mfr') order by pn.kind, pn.value limit 20`),
  );
  const card = toCard(p, opts.locale);
  const { offer: _offer, photo: _photo, ...base } = card;
  return {
    ...base,
    description: p.description === null ? null : localized(p.description, p.description_hi, opts.locale),
    compatibility:
      p.compatibility === null ? null : localized(p.compatibility, p.compatibility_hi, opts.locale),
    spec: p.spec,
    countryOfOrigin: p.country_of_origin,
    warranty: p.warranty,
    gstRateBp: num(p.gst_rate_bp),
    partNumbers,
    photos: photos.map((ph) => ({
      path: ph.storage_path,
      alt: localized(ph.alt, ph.alt_hi, opts.locale),
      width: num(ph.width),
      height: num(ph.height),
      blurhash: ph.blurhash,
    })),
    variants: variants.map((v) => {
      const price = numOrNull(v.price);
      return {
        sku: v.sku,
        options: v.options,
        mrpPaise: num(v.mrp_paise),
        offer:
          price === null
            ? null
            : {
                pricePaise: price,
                mrpPaise: num(v.mrp),
                shippingPaise: numOrNull(v.shipping),
                leadDays: numOrNull(v.lead_days),
                seller: localized(v.shop_name ?? '', v.shop_name_hi, opts.locale),
              },
      };
    }),
    place,
  };
}

export interface CatalogueCategory {
  slug: string;
  parentSlug: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  liveProducts: number;
}

/** Visible categories in admin order, with their live product counts. */
export async function listCatalogueCategories(db: Tx, locale: CatalogueLocale): Promise<CatalogueCategory[]> {
  const rows = rowsOf<{
    slug: string;
    parent_slug: string | null;
    name: string;
    name_hi: string | null;
    description: string | null;
    description_hi: string | null;
    icon: string | null;
    live: unknown;
  }>(
    await db.execute(sql`
      select c.slug, parent.slug as parent_slug, c.name, c.name_hi, c.description, c.description_hi, c.icon,
        (select count(*) from products p where p.category_id = c.id and p.status = 'live')::int as live
      from categories c left join categories parent on parent.id = c.parent_id
      where not c.hidden and c.archived_at is null
      order by c.sort, c.slug`),
  );
  return rows.map((r) => ({
    slug: r.slug,
    parentSlug: r.parent_slug,
    name: localized(r.name, r.name_hi, locale),
    description: r.description === null ? null : localized(r.description, r.description_hi, locale),
    icon: r.icon,
    liveProducts: num(r.live),
  }));
}
