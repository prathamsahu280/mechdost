import { and, eq, sql } from 'drizzle-orm';
import {
  applyCoupon,
  type CouponDiscount,
  type CouponFunder,
  type CouponGroup,
  type CouponKind,
  type CouponReason,
  type CouponRule,
} from '@mechdost/shared/coupon';
import { couponRedemptions, orderGroups, orders, shopPayoutEntries } from '../schema';
import { ValidationError } from './errors';
import { recordServerEvent } from './events';
import { localized } from './localized';
import type { Tx } from './orders';
import type { CatalogueLocale } from './catalogue';
import { num, numOrNull, rowsOf } from './sql-rows';

/**
 * Coupons in the checkout (spec 03 "Coupons", design 2026-11-15). The customer side of the rules, all inside the
 * placing transaction:
 *
 * - `evaluateCoupon` reads the coupon and answers with a discount or one reason code (never throws for a bad code,
 *   so the preview can show it; `placeOrder` turns a refusal into 422 COUPON_INVALID).
 * - `redeemCoupon` is the authoritative count: a conditional UPDATE on `coupons.used_count` (never above the total
 *   limit, only while live) and a conditional upsert on `coupon_user_usage` (never above the per-customer limit, which
 *   a trigger repeats). A parallel checkout that took the last use makes this one fail and the order rolls back.
 * - `releaseCouponIfOrderDead` gives the use back when every part of the order was cancelled or rejected. Partial
 *   refunds and a delivered order never release it (rule recorded 2026-11-15).
 * - `recordShopCouponDiscount` (on delivery) compensates the delivering shop for a discount it did not fund.
 */
export interface CouponView {
  code: string;
  title: string;
  terms: string | null;
  kind: CouponKind;
  value: number;
  minSubtotalPaise: number;
  maxDiscountPaise: number | null;
  funder: CouponFunder;
  shopName: string | null;
  endsAt: string | null;
  firstOrderOnly: boolean;
}

export interface CouponRow {
  id: string;
  code: string;
  rule: CouponRule;
  view: CouponView;
  /** Category offer: the category the discount is limited to (its lines and sub-categories). */
  categoryId: string | null;
}

export type CouponEvaluation =
  | { ok: true; coupon: CouponRow; discount: CouponDiscount }
  | { ok: false; reason: CouponReason; view: CouponView | null };

/**
 * The one offer a checkout gets (2026-11-16): a typed code or an automatic offer, never both. `beaten` is the other
 * one, when there was one, so the customer is told what they did not get.
 */
export type OfferChoice =
  | (Extract<CouponEvaluation, { ok: true }> & {
      source: 'code' | 'automatic';
      beaten: { source: 'code' | 'automatic'; title: string; discountPaise: number } | null;
    })
  | Extract<CouponEvaluation, { ok: false }>;

interface RawCoupon {
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
  usage_limit_total: unknown;
  usage_limit_per_user: unknown;
  used_count: unknown;
  first_order_only: boolean;
  city_id: string | null;
  funder: string;
  shop_id: string | null;
  active: boolean;
  not_started: boolean;
  ended: boolean;
  terms_status: string | null;
  shop_name: string | null;
  shop_name_hi: string | null;
  my_uses: unknown;
  had_order: boolean;
  category_id: string | null;
  /** The category and every sub-category (recursive), for category offers. */
  category_ids: string[] | null;
}

/** What a person types: trimmed; the database compares case-insensitively (citext). Letters and digits only. */
export function normalizeCouponCode(raw: string): string {
  return raw.trim();
}

const kindOf = (k: string): CouponKind => (k === 'percent' || k === 'flat' ? k : 'free_shipping');

function viewOf(r: RawCoupon, locale: CatalogueLocale): CouponView {
  return {
    code: r.code,
    title: localized(r.title, r.title_hi, locale),
    terms: r.terms ? localized(r.terms, r.terms_hi, locale) : null,
    kind: kindOf(r.kind),
    value: num(r.value),
    minSubtotalPaise: num(r.min_subtotal_paise),
    maxDiscountPaise: numOrNull(r.max_discount_paise),
    funder: r.funder === 'shop' ? 'shop' : 'mechdost',
    shopName: r.shop_name ? localized(r.shop_name, r.shop_name_hi, locale) : null,
    endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
    firstOrderOnly: r.first_order_only,
  };
}

/**
 * Check a code for this customer, city and cart. Order of refusals (first match wins): unknown, paused, not started,
 * ended, shop has not accepted, other city, all uses taken, this customer's uses taken, first-order only, then the
 * cart rules (`applyCoupon`: nothing eligible in the cart, minimum order).
 */
export async function evaluateCoupon(
  tx: Tx,
  input: CouponCart & { code: string },
): Promise<CouponEvaluation> {
  const code = normalizeCouponCode(input.code);
  // An automatic offer's code is only its internal name: typing it is "not valid" (2026-11-16), like an unknown code.
  const [r] = rowsOf<RawCoupon>(
    await tx.execute(sql`${couponSelect(input.userId)} where c.code = ${code}::citext and not c.auto_apply`),
  );
  if (!r) return { ok: false, reason: 'not_found', view: null };
  return evaluateRow(r, input);
}

/** What a coupon is checked against: who, which city, the priced cart (and each line's category for category offers). */
export interface CouponCart {
  userId: string;
  cityId: string;
  groups: readonly CouponGroup[];
  /** Per sub-order, per product line: its category id (same shape as `groups[].lineTotals`). */
  lineCategories?: readonly (readonly string[])[];
  locale: CatalogueLocale;
}

/** The coupon row with everything the rules need for one customer (one statement, no read-then-write). */
function couponSelect(userId: string) {
  return sql`
      select c.id, c.code::text as code, c.title, c.title_hi, c.terms, c.terms_hi, c.kind, c.value, c.min_subtotal_paise,
        c.max_discount_paise, c.ends_at, c.usage_limit_total, c.usage_limit_per_user, c.used_count, c.first_order_only,
        c.city_id, c.funder, c.shop_id, c.active, now() < c.starts_at as not_started,
        (c.ends_at is not null and now() >= c.ends_at) as ended, st.status as terms_status,
        sh.name as shop_name, sh.name_hi as shop_name_hi, c.auto_apply, c.category_id,
        case when c.category_id is null then null else (
          with recursive d(id) as (
            select ct.id from categories ct where ct.id = c.category_id
            union all
            select ch.id from categories ch join d on ch.parent_id = d.id)
          select array_agg(d.id::text) from d) end as category_ids,
        coalesce((select u.uses from coupon_user_usage u where u.coupon_id = c.id and u.user_id = ${userId}), 0) as my_uses,
        exists (select 1 from order_groups g where g.user_id = ${userId}
          and exists (select 1 from orders o where o.group_id = g.id and o.status not in ('cancelled','rejected','returned'))) as had_order
      from coupons c
      left join coupon_shop_terms st on st.coupon_id = c.id
      left join shops sh on sh.id = c.shop_id`;
}

/**
 * The best automatic offer this cart gets (2026-11-16): every live automatic offer of the city is checked with the same
 * rules as a typed code; the largest discount wins, ties to the older offer (stable). Null when none applies.
 */
export async function evaluateAutomaticOffer(
  tx: Tx,
  input: CouponCart,
): Promise<Extract<CouponEvaluation, { ok: true }> | null> {
  const rows = rowsOf<RawCoupon>(
    await tx.execute(sql`${couponSelect(input.userId)}
      where c.auto_apply and c.active and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())
        and (c.city_id is null or c.city_id = ${input.cityId})
      order by c.created_at, c.id limit 50`),
  );
  let best: Extract<CouponEvaluation, { ok: true }> | null = null;
  for (const r of rows) {
    const e = evaluateRow(r, input);
    if (e.ok && (!best || e.discount.discountPaise > best.discount.discountPaise)) best = e;
  }
  return best;
}

function evaluateRow(r: RawCoupon, input: CouponCart): CouponEvaluation {
  const view = viewOf(r, input.locale);
  // A code the caller may not know about (paused, not started, waiting for its shop, another city) answers exactly like
  // an unknown code, on the preview and on placing, so neither path tells which codes exist (security review 2026-11-15).
  // All of those checks come first, so a code in a hidden state can never leak a showable reason (expired ...). A
  // refusal never carries the coupon (title, terms, shop): only an applicable code is shown.
  if (
    !r.active ||
    r.not_started ||
    (r.funder === 'shop' && r.terms_status !== 'accepted') ||
    (r.city_id !== null && r.city_id !== input.cityId)
  )
    return { ok: false, reason: 'not_found', view: null };
  const refuse = (reason: CouponReason): CouponEvaluation => ({ ok: false, reason, view: null });
  if (r.ended) return refuse('expired');
  const total = numOrNull(r.usage_limit_total);
  if (total !== null && num(r.used_count) >= total) return refuse('exhausted');
  if (num(r.my_uses) >= num(r.usage_limit_per_user)) return refuse('user_limit');
  if (r.first_order_only && r.had_order) return refuse('first_order_only');
  const rule: CouponRule = {
    kind: kindOf(r.kind),
    value: num(r.value),
    minSubtotalPaise: num(r.min_subtotal_paise),
    maxDiscountPaise: numOrNull(r.max_discount_paise),
    funder: r.funder === 'shop' ? 'shop' : 'mechdost',
    shopId: r.shop_id,
  };
  const discount = applyCoupon(rule, groupsFor(r, input));
  if ('reason' in discount) return refuse(discount.reason);
  return { ok: true, coupon: { id: r.id, code: r.code, rule, view, categoryId: r.category_id }, discount };
}

/** A category offer only touches the lines of its category (and sub-categories): mark them for the maths. */
function groupsFor(r: RawCoupon, input: CouponCart): readonly CouponGroup[] {
  const ids = r.category_ids;
  if (ids === null) return input.groups;
  const inCategory = new Set(ids);
  return input.groups.map((g, i) => ({
    ...g,
    lineEligible: g.lineTotals.map((_, j) => inCategory.has(input.lineCategories?.[i]?.[j] ?? '')),
  }));
}

const REFUSAL_TEXT: Record<CouponReason, string> = {
  not_found: 'This code is not valid',
  paused: 'This offer is not available right now',
  not_started: 'This offer has not started yet',
  expired: 'This offer has ended',
  exhausted: 'This offer has been fully used',
  user_limit: 'You have already used this offer',
  min_order: 'Your cart is below the minimum for this offer',
  wrong_city: 'This offer is not available in your city',
  first_order_only: 'This offer is for a first order only',
  not_for_cart: 'This offer does not apply to the items in your cart',
  shop_terms_pending: 'This offer is not available right now',
  quote_order: 'Coupons cannot be used on a bulk quote order',
};

/** The 422 `placeOrder` answers with when a coupon cannot be used; the screen words it from `details.reason`. */
export function couponRefusal(reason: CouponReason): ValidationError {
  return new ValidationError(REFUSAL_TEXT[reason], 'COUPON_INVALID', { reason });
}

/**
 * Count one use, inside the placing transaction (after coins, before stock; the same order a cancel uses to give it
 * back). Throws 422 COUPON_INVALID (`exhausted` / `user_limit` / `paused`) when a parallel checkout took the last use.
 */
export async function redeemCoupon(
  tx: Tx,
  input: { couponId: string; userId: string; groupId: string; funder: CouponFunder; discountPaise: number },
): Promise<void> {
  const used = rowsOf<{ id: string }>(
    await tx.execute(sql`
      update coupons set used_count = used_count + 1
      where id = ${input.couponId} and active and starts_at <= now() and (ends_at is null or ends_at > now())
        and (usage_limit_total is null or used_count < usage_limit_total)
      returning id`),
  );
  if (used.length === 0) throw couponRefusal('exhausted');
  const mine = rowsOf<{ uses: number }>(
    await tx.execute(sql`
      insert into coupon_user_usage (coupon_id, user_id, uses) values (${input.couponId}, ${input.userId}, 1)
      on conflict (coupon_id, user_id) do update set uses = coupon_user_usage.uses + 1
        where coupon_user_usage.uses < (select usage_limit_per_user from coupons where id = ${input.couponId})
      returning uses`),
  );
  if (mine.length === 0) throw couponRefusal('user_limit');
  await tx.insert(couponRedemptions).values({
    couponId: input.couponId,
    userId: input.userId,
    groupId: input.groupId,
    discountPaise: input.discountPaise,
    funder: input.funder,
  });
}

/**
 * A part of the order was cancelled or rejected (`transitionOrder`, same transaction). When no part of the order is
 * left alive, the coupon's use goes back (total and per customer), once (`released_at`). The group row is locked first,
 * so two parts cancelled at the same moment cannot both think the other is still alive.
 */
export async function releaseCouponIfOrderDead(tx: Tx, groupId: string): Promise<boolean> {
  const [g] = await tx
    .select({ couponId: orderGroups.couponId, userId: orderGroups.userId, code: orderGroups.code })
    .from(orderGroups)
    .where(eq(orderGroups.id, groupId))
    .for('update');
  if (!g?.couponId) return false;
  const alive = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.groupId, groupId), sql`${orders.status} not in ('cancelled','rejected','returned')`))
    .limit(1);
  if (alive.length > 0) return false;
  return giveUseBack(tx, {
    groupId,
    couponId: g.couponId,
    userId: g.userId,
    code: g.code,
    reason: 'order_closed',
  });
}

/**
 * A refund was paid (`afterProcessed`, same transaction). When every part of the order that was not cancelled or
 * rejected has been refunded in full (processed refunds of at least its total), the order is as good as returned and the
 * coupon's use goes back (2026-11-16 ruling; a partial refund keeps it). Locks the group row first, then reads the
 * refunds, so two refunds paid at the same moment cannot both miss each other. Once only (`released_at`).
 */
export async function releaseCouponIfOrderRefunded(tx: Tx, orderId: string): Promise<boolean> {
  const [o] = await tx.select({ groupId: orders.groupId }).from(orders).where(eq(orders.id, orderId));
  if (!o) return false;
  const [g] = await tx
    .select({ couponId: orderGroups.couponId, userId: orderGroups.userId, code: orderGroups.code })
    .from(orderGroups)
    .where(eq(orderGroups.id, o.groupId))
    .for('update');
  if (!g?.couponId) return false;
  const [open] = rowsOf<{ open: unknown }>(
    await tx.execute(sql`
      select count(*) as open from orders o
      where o.group_id = ${o.groupId} and o.status not in ('cancelled','rejected','returned')
        and coalesce((select sum(r.amount_paise) from refunds r where r.order_id = o.id and r.status = 'processed'), 0)
          < o.total_paise`),
  );
  if (num(open?.open ?? 0) > 0) return false;
  const [live] = rowsOf<{ live: unknown }>(
    await tx.execute(
      sql`select count(*) as live from orders o where o.group_id = ${o.groupId} and o.status not in ('cancelled','rejected','returned')`,
    ),
  );
  // Every part cancelled or rejected is the other rule's case (`releaseCouponIfOrderDead`); nothing refunded yet either.
  if (num(live?.live ?? 0) === 0) return false;
  return giveUseBack(tx, {
    groupId: o.groupId,
    couponId: g.couponId,
    userId: g.userId,
    code: g.code,
    reason: 'order_refunded',
  });
}

async function giveUseBack(
  tx: Tx,
  g: {
    groupId: string;
    couponId: string;
    userId: string;
    code: string;
    reason: 'order_closed' | 'order_refunded';
  },
): Promise<boolean> {
  const groupId = g.groupId;
  const released = await tx
    .update(couponRedemptions)
    .set({ releasedAt: sql`now()` })
    .where(and(eq(couponRedemptions.groupId, groupId), sql`${couponRedemptions.releasedAt} is null`))
    .returning({ couponId: couponRedemptions.couponId, userId: couponRedemptions.userId });
  if (released.length === 0) return false;
  await tx.execute(
    sql`update coupons set used_count = used_count - 1 where id = ${g.couponId} and used_count > 0`,
  );
  await tx.execute(
    sql`update coupon_user_usage set uses = uses - 1 where coupon_id = ${g.couponId} and user_id = ${g.userId} and uses > 0`,
  );
  await recordServerEvent(tx, 'coupon_released', {
    userId: g.userId,
    props: { couponId: g.couponId, orderCode: g.code, reason: g.reason },
  });
  return true;
}

/**
 * A sub-order was delivered (`transitionOrder`, same transaction): a discount the delivering shop did not fund is owed
 * to it by MechDost (`coupon_discount`, once per order). MechDost-funded coupons always; a shop-funded coupon only when
 * the order was routed to a different shop than the funder (it never pays for another shop's goods). Nothing when the
 * delivering shop funded the discount itself: its payout is simply the lower amount.
 */
export async function recordShopCouponDiscount(tx: Tx, orderId: string): Promise<void> {
  const [row] = rowsOf<{
    shop_id: string | null;
    coupon_discount_paise: unknown;
    funder: string | null;
    funding_shop: string | null;
  }>(
    await tx.execute(sql`
      select o.shop_id, o.coupon_discount_paise, o.coupon_funder as funder, c.shop_id as funding_shop
      from orders o join order_groups g on g.id = o.group_id left join coupons c on c.id = g.coupon_id
      where o.id = ${orderId}`),
  );
  const amount = num(row?.coupon_discount_paise ?? 0);
  if (!row?.shop_id || amount <= 0) return;
  if (row.funder === 'shop' && row.funding_shop === row.shop_id) return;
  await tx
    .insert(shopPayoutEntries)
    .values({
      shopId: row.shop_id,
      orderId,
      kind: 'coupon_discount',
      amountPaise: amount,
      idemKey: `coupon_discount:${orderId}`,
    })
    .onConflictDoNothing({ target: shopPayoutEntries.idemKey });
}
