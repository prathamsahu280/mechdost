import { eq, sql } from 'drizzle-orm';
import type { CouponFunder, CouponKind } from '@mechdost/shared/coupon';
import type { CouponUsageReport, PublicOffer } from '@mechdost/shared/coupon-api';
import { coupons } from '../schema';
import type { CatalogueLocale } from './catalogue';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import { NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { localized } from './localized';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { num, numOrNull, rowsOf } from './sql-rows';

/**
 * The public offers list and the admin usage report (2026-11-16, plan coupon follow-ups). Both read only; the counters
 * they show are the ones `redeemCoupon` and the release functions move (never a second source of truth).
 */

/** Most offers one page lists: an admin who makes more than this public wants a curated list, not a catalogue. */
const PUBLIC_OFFERS_MAX = 50;

interface RawPublic {
  id: string;
  code: string;
  title: string;
  title_hi: string | null;
  terms: string | null;
  terms_hi: string | null;
  kind: string;
  value: unknown;
  min_subtotal_paise: unknown;
  max_discount_paise: unknown;
  ends_at: Date | string | null;
  first_order_only: boolean;
  auto_apply: boolean;
  funder: string;
  shop_name: string | null;
  shop_name_hi: string | null;
  cat_name: string | null;
  cat_name_hi: string | null;
}

/**
 * Offers the admin marked public that a customer in `cityId` can use right now: switched on, started, not ended, uses
 * left, in the customer's city or every city, and (shop-funded) accepted by an approved shop. In the page language.
 * An automatic offer is listed without its code (`code: null`): the customer cannot type it and need not.
 * Indexed by `coupons_public_live_idx`; newest first, capped at 50.
 */
export async function listPublicOffers(
  db: Tx,
  input: { cityId: string; locale: CatalogueLocale },
): Promise<PublicOffer[]> {
  const rows = rowsOf<RawPublic>(
    await db.execute(sql`
      select c.id, c.code::text as code, c.title, c.title_hi, c.terms, c.terms_hi, c.kind, c.value,
        c.min_subtotal_paise, c.max_discount_paise, c.ends_at, c.first_order_only, c.auto_apply, c.funder,
        sh.name as shop_name, sh.name_hi as shop_name_hi, cat.name as cat_name, cat.name_hi as cat_name_hi
      from coupons c
      left join coupon_shop_terms st on st.coupon_id = c.id
      left join shops sh on sh.id = c.shop_id
      left join categories cat on cat.id = c.category_id
      where c.is_public and c.active and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())
        and (c.usage_limit_total is null or c.used_count < c.usage_limit_total)
        and (c.city_id is null or c.city_id = ${input.cityId})
        and (c.funder = 'mechdost' or (st.status = 'accepted' and sh.status = 'approved'))
      order by c.created_at desc, c.id desc
      limit ${PUBLIC_OFFERS_MAX}`),
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.auto_apply ? null : r.code,
    title: localized(r.title, r.title_hi, input.locale),
    terms: r.terms ? localized(r.terms, r.terms_hi, input.locale) : null,
    kind: (r.kind === 'percent' || r.kind === 'flat' ? r.kind : 'free_shipping') satisfies CouponKind,
    value: num(r.value),
    minSubtotalPaise: num(r.min_subtotal_paise),
    maxDiscountPaise: numOrNull(r.max_discount_paise),
    endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
    firstOrderOnly: r.first_order_only,
    automatic: r.auto_apply,
    categoryName: r.cat_name ? localized(r.cat_name, r.cat_name_hi, input.locale) : null,
    funder: (r.funder === 'shop' ? 'shop' : 'mechdost') satisfies CouponFunder,
    shopName: r.shop_name ? localized(r.shop_name, r.shop_name_hi, input.locale) : null,
  }));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One coupon's use: totals and a page of IST days, newest first (keyset cursor on the day). Orders = redemptions;
 * released ones (cancelled, rejected or refunded in full) are counted apart and never in the uses, the discount or the
 * unique customers, so `uses` always equals the coupon's `used_count`. A coupon outside the staff member's cities is a
 * 404, like the coupon screens. Reads by `(coupon_id, created_at, id)` (index `coupon_redemptions_coupon_created_idx`).
 */
export async function couponUsageReport(
  db: Tx,
  input: {
    scope: CityScope;
    couponId: string;
    staffUserId?: string;
    cursor?: string | null;
    limit?: number;
  },
): Promise<CouponUsageReport> {
  const [c] = await db
    .select({ id: coupons.id, code: coupons.code, cityId: coupons.cityId })
    .from(coupons)
    .where(eq(coupons.id, input.couponId));
  const inScope = !!c && (input.scope.all || (c.cityId !== null && input.scope.cityIds.includes(c.cityId)));
  if (!c || !inScope) throw new NotFoundError('Coupon not found');

  const limit = pageSize(input.limit, 31, 92);
  let before: string | null = null;
  if (input.cursor) {
    const k = decodeCursor(input.cursor, 'text', 10);
    if (!DAY.test(k.k) || k.id !== c.id) throw new ValidationError('Invalid cursor', 'INVALID_CURSOR');
    before = k.k;
  }
  const [totals] = rowsOf<{
    orders: unknown;
    released: unknown;
    paise: unknown;
    customers: unknown;
  }>(
    await db.execute(sql`
      select count(*) as orders, count(*) filter (where released_at is not null) as released,
        coalesce(sum(discount_paise) filter (where released_at is null), 0) as paise,
        count(distinct user_id) filter (where released_at is null) as customers
      from coupon_redemptions where coupon_id = ${c.id}`),
  );
  const days = rowsOf<{
    day: string;
    orders: unknown;
    released: unknown;
    paise: unknown;
    customers: unknown;
  }>(
    await db.execute(sql`
      select to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, count(*) as orders,
        count(*) filter (where released_at is not null) as released,
        coalesce(sum(discount_paise) filter (where released_at is null), 0) as paise,
        count(distinct user_id) filter (where released_at is null) as customers
      from coupon_redemptions
      where coupon_id = ${c.id}
        and (${before}::text is null
          or to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') < ${before}::text)
      group by 1 order by 1 desc limit ${limit + 1}`),
  );
  const page = days.slice(0, limit);
  const last = page.at(-1);
  const orders = num(totals?.orders ?? 0);
  const released = num(totals?.released ?? 0);
  if (input.staffUserId && !input.cursor)
    await recordServerEvent(db, 'admin_coupon_usage_viewed', {
      userId: input.staffUserId,
      props: { couponId: c.id },
    });
  return {
    couponId: c.id,
    code: c.code,
    totals: {
      orders,
      released,
      uses: orders - released,
      discountPaise: num(totals?.paise ?? 0),
      uniqueCustomers: num(totals?.customers ?? 0),
    },
    days: page.map((d) => ({
      day: d.day,
      orders: num(d.orders),
      released: num(d.released),
      discountPaise: num(d.paise),
      uniqueCustomers: num(d.customers),
    })),
    nextCursor: days.length > limit && last ? encodeCursor({ k: last.day, id: c.id }) : null,
  };
}
