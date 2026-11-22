import { sql, type SQL } from 'drizzle-orm';

/**
 * The ONE rule for "a customer may see this product" (design 2026-11-22, spec 02/14): the product is live, its brand
 * is not hidden, its range (if any) is not hidden, and its category and the parent category are neither hidden nor
 * archived. Every storefront read (list, product page, search, sitemap, recommendations, co-purchase, cart, checkout,
 * compare, wishlist, reviews) goes through this predicate, so a switch in the admin console takes effect everywhere
 * at once. A guard test (`test/visibility-guard.test.ts`) fails when a storefront repository reads
 * `status = 'live'` on products anywhere else. Hiding never rewrites `products.status`: switching back is lossless.
 *
 * `alias` is the SQL alias of `products` in the calling query (default `p`); the checks are correlated sub-selects
 * on indexed keys, so the caller needs no extra joins.
 */
export function productVisible(alias = 'p'): SQL {
  const p = sql.raw(alias);
  return sql`(${p}.status = 'live'
    and not exists (select 1 from brands vb where vb.id = ${p}.brand_id and vb.hidden)
    and not exists (select 1 from product_ranges vr where vr.id = ${p}.range_id and vr.hidden)
    and not exists (
      select 1 from categories vc left join categories vpc on vpc.id = vc.parent_id
      where vc.id = ${p}.category_id
        and (vc.hidden or vc.archived_at is not null or vpc.hidden or vpc.archived_at is not null)))`;
}
