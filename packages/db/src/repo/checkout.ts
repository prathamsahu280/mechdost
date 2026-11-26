import { createHash } from 'node:crypto';
import { adminPriceJoins } from './admin-price-sql';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { BusinessPurchase } from '@mechdost/shared/business';
import { publicCode } from '@mechdost/shared/ids';
import { variantLabel } from '@mechdost/shared/variants';
import { OPERATIONAL_SETTINGS, type SettingKey } from '@mechdost/shared/settings';
import { splitInclusiveGst } from '@mechdost/shared/money';
import { freeDeliveryMinPaise, groupShippingPaise } from '@mechdost/shared/free-delivery';
import { savingsBreakdown } from '@mechdost/shared/savings';
import { auditLog, orderGroups, orderItems, orders, settings } from '../schema';
import { blockEffects } from '@mechdost/shared/customers';
import {
  codCartRule,
  effectiveCodCap,
  type CodCartReason,
  type CodEligibility,
} from '@mechdost/shared/cod-eligibility';
import { codStatusInCity } from './cod-requests';
import { setActor } from './actor';
import { removeOrderedCartLines } from './cart';
import { queueOrderPlacedEmail } from './email-events';
import { recordServerEvent } from './events';
import { activeBlockLevels } from './customer-blocks';
import { checkoutCoins, redeemCoins } from './coins';
import {
  couponRefusal,
  evaluateAutomaticOffer,
  evaluateCoupon,
  redeemCoupon,
  type CouponEvaluation,
  type OfferChoice,
} from './coupons';
import type { CouponGroup } from '@mechdost/shared/coupon';
import { ConflictError, ForbiddenError, NotFoundError, pgCode, ValidationError } from './errors';
import { productVisible } from './visibility';
import { reserveStock } from './inventory';
import { localized } from './localized';
import type { Tx } from './orders';
import { num, numOrNull, rowsOf } from './sql-rows';
import type { CatalogueLocale } from './catalogue';

/**
 * Server-side checkout (spec 03). The browser's cart is only a list of SKUs and quantities: every price, stock
 * level, delivery charge and tax is worked out here, again at placement, inside the placing transaction.
 *
 * Line pricing follows the catalogue rule (spec 02, decision 2026-11-01): for the delivery PIN, the **nearest**
 * covering shop that is approved, not busy and has free stock for the whole quantity. Lines are grouped by that
 * shop into sub-orders (decision "auto-split multi-shop carts"); admin then routes each sub-order (spec 04), the
 * pricing shop being the suggestion. Prices are GST-inclusive; CGST+SGST when the shop and the delivery address
 * are in the same state, IGST otherwise (`splitInclusiveGst`, exact paise).
 *
 * Placement (COD only until Razorpay, pending decision #1): one idempotency key per user returns the same order
 * however often it is sent (advisory lock + unique index), the customer's expected total must match the
 * re-priced total (else PRICE_CHANGED), stock is reserved with conditional updates (never oversold).
 */
export const CART_MAX_LINES = 20;
export const LINE_MAX_QTY = 99;

/** Settings keys (city first, then global; admin-editable, hard rule 8). Values are integer paise / minutes. */
// Defaults come from the one settings registry (`@mechdost/shared/settings`, editable via /v1/admin/settings).
const S = OPERATIONAL_SETTINGS;
export const CHECKOUT_SETTINGS = {
  codCapPaise: { key: 'checkout.cod_cap_paise', fallback: S['checkout.cod_cap_paise'].default },
  codFeePaise: { key: 'checkout.cod_fee_paise', fallback: S['checkout.cod_fee_paise'].default },
  onlinePaymentMinutes: {
    key: 'checkout.online_payment_minutes',
    fallback: S['checkout.online_payment_minutes'].default,
  },
  freeDeliveryMinPaise: {
    key: 'checkout.free_delivery_min_paise',
    fallback: S['checkout.free_delivery_min_paise'].default,
  },
  codReservationMinutes: {
    key: 'checkout.cod_reservation_minutes',
    fallback: S['checkout.cod_reservation_minutes'].default,
  },
} as const;

export interface CartLine {
  sku: string;
  qty: number;
}

export type LineIssue = 'unavailable' | 'insufficient_stock';

export interface QuoteLine {
  sku: string;
  qty: number;
  name: string | null;
  unitPaise: number | null;
  mrpPaise: number | null;
  totalPaise: number | null;
  /** Index into `groups`; null when the line cannot be bought. */
  group: number | null;
  issue: LineIssue | null;
  /** For `insufficient_stock`: the most any one shop can deliver to this PIN. */
  available: number | null;
}

export interface QuoteGroup {
  seller: string;
  subtotalPaise: number;
  shippingPaise: number;
  /** The free-delivery threshold that applied to this group (PIN ?? shop ?? city); null = delivery is never free. */
  freeDeliveryMinPaise: number | null;
  taxPaise: number;
  totalPaise: number;
  leadDays: number;
}

export interface CheckoutQuote {
  cityCode: string;
  /** GST state code of the delivery PIN (place of supply), e.g. '22' for Chhattisgarh. */
  deliveryStateCode: string;
  pincode: string;
  lines: QuoteLine[];
  groups: QuoteGroup[];
  subtotalPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  taxPaise: number;
  /** Cash-on-delivery total (includes the COD fee). */
  totalPaise: number;
  /** Total when paid online: no COD fee. */
  onlineTotalPaise: number;
  /** Every line can be bought as asked. */
  ok: boolean;
  /**
   * Cash on delivery for this cart and person. `reason` keeps its old meaning (PIN rule, cap) for older screens;
   * `eligibility` says whether this person may pay cash at all (founder ruling 2026-11-26) and `cartReason` whether
   * the cart meets the admin's minimum order and pieces. `allowed` = all three. `capPaise` is the lower of the city
   * cap and an approval's personal cap.
   */
  cod: {
    allowed: boolean;
    reason: 'over_cap' | 'pincode' | null;
    capPaise: number;
    eligibility: CodEligibility;
    cartReason: CodCartReason | null;
    minOrderPaise: number;
    minItems: number;
  };
  /**
   * "Your savings" estimate for this cart (decision 2026-11-26): the printed-MRP saving of the priced lines plus the
   * delivery fee the free-delivery threshold waives. Coupon and Coins are chosen at checkout and are not in it; the
   * final figure is written only after delivery. `excludedLines` = priced lines without a printed MRP.
   */
  savingsEstimate: SavingsEstimate;
}

export interface SavingsEstimate {
  mrpPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  excludedLines: number;
}

/** The size of a variant of a product sold in several sizes, else null (a single size is never named). */
export function sizeLabelOf(r: { options: Record<string, unknown> | null; sizes: unknown }): string | null {
  if (Number(r.sizes) <= 1) return null;
  return variantLabel(r.options ?? {}) || null;
}

export const withSize = (title: string, size: string | null): string => (size ? `${title} · ${size}` : title);

interface PricedLine {
  sku: string;
  qty: number;
  variantId: string;
  inventoryId: string;
  shopId: string;
  /** The product's category (category offers, 2026-11-16). */
  categoryId: string;
  title: string;
  titleHi: string | null;
  /** The size, when the product is sold in several (user 2026-11-24); the titles end with it. */
  variantLabel: string | null;
  hsn: string;
  gstRateBp: number;
  unitPaise: number;
  /** The chosen shop's approved price (what it is paid); unitPaise - this = MechDost's margin (Q11). */
  shopUnitPaise: number;
  interState: boolean;
  /** 'quote' when the unit price was negotiated in a bulk quote (spec 19). */
  priceSource: 'catalogue' | 'quote';
  /** Quote lines: the catalogue price this line had (the most a shop may be paid; routing ceiling). */
  costCeilingPaise: number | null;
  /** The printed MRP per unit right now (snapshot onto `order_items.mrp_paise` for "Your savings"). */
  mrpPaise: number | null;
}

export interface InternalQuote {
  quote: CheckoutQuote;
  cityId: string;
  priced: PricedLine[];
  groupShops: string[];
  /** Per group: the delivery charge the free-delivery threshold waived (0 when charged); `orders.delivery_waived_paise`. */
  groupWaivedPaise: number[];
}

/** The cart's savings estimate from the priced lines and the waived delivery (one breakdown for every surface). */
function savingsEstimateOf(priced: readonly PricedLine[], waived: readonly number[]): SavingsEstimate {
  const b = savingsBreakdown({
    lines: priced.map((l, i) => ({
      itemId: String(i),
      qty: l.qty,
      unitPaise: l.unitPaise,
      mrpPaise: l.mrpPaise,
    })),
    couponPaise: 0,
    coinsPaise: 0,
    deliveryWaivedPaise: waived.reduce((a, v) => a + v, 0),
  });
  return {
    mrpPaise: b.mrpPaise,
    deliveryPaise: b.deliveryPaise,
    totalPaise: b.totalPaise,
    excludedLines: b.excludedLines,
  };
}

/** The cart as the coupon maths sees it: per sub-order its shop, product line totals (cart order) and delivery. */
export function couponGroupsOf(internal: InternalQuote): CouponGroup[] {
  return internal.groupShops.map((shopId, index) => ({
    shopId,
    lineTotals: internal.priced.filter((p) => p.shopId === shopId).map((p) => p.unitPaise * p.qty),
    shippingPaise: internal.quote.groups[index]?.shippingPaise ?? 0,
  }));
}

/** Each product line's category, per sub-order in the same order as `couponGroupsOf` (category offers). */
export function couponLineCategoriesOf(internal: InternalQuote): string[][] {
  return internal.groupShops.map((shopId) =>
    internal.priced.filter((p) => p.shopId === shopId).map((p) => p.categoryId),
  );
}

/** Check the coupon on a priced cart for one customer (the preview and the placing transaction share this). */
export function evaluateCouponOnQuote(
  tx: Tx,
  internal: InternalQuote,
  input: { code: string; userId: string; locale: CatalogueLocale },
): Promise<CouponEvaluation> {
  return evaluateCoupon(tx, {
    code: input.code,
    userId: input.userId,
    cityId: internal.cityId,
    groups: couponGroupsOf(internal),
    lineCategories: couponLineCategoriesOf(internal),
    locale: input.locale,
  });
}

/**
 * The one offer a checkout gets (2026-11-16 ruling: offers never stack). A typed code and the best automatic offer
 * compete; the larger discount wins and a tie goes to the code the customer typed. The loser is returned so the
 * screen can say what the customer did not get. A typed code that cannot be used is refused whatever the automatic
 * offer would give (the customer typed it on purpose). Bulk quote orders never get an automatic offer (their prices
 * were negotiated, spec 19). The preview and the placing transaction share this, so they can never disagree.
 */
export async function chooseOffer(
  tx: Tx,
  internal: InternalQuote,
  input: { code: string | null; userId: string; locale: CatalogueLocale; allowAutomatic: boolean },
): Promise<OfferChoice> {
  const typed = input.code ? await evaluateCouponOnQuote(tx, internal, { ...input, code: input.code }) : null;
  if (typed && !typed.ok) return typed;
  const auto = input.allowAutomatic
    ? await evaluateAutomaticOffer(tx, {
        userId: input.userId,
        cityId: internal.cityId,
        groups: couponGroupsOf(internal),
        lineCategories: couponLineCategoriesOf(internal),
        locale: input.locale,
      })
    : null;
  if (typed && (!auto || typed.discount.discountPaise >= auto.discount.discountPaise))
    return {
      ...typed,
      source: 'code',
      beaten: auto
        ? { source: 'automatic', title: auto.coupon.view.title, discountPaise: auto.discount.discountPaise }
        : null,
    };
  if (auto)
    return {
      ...auto,
      source: 'automatic',
      beaten: typed
        ? { source: 'code', title: typed.coupon.view.title, discountPaise: typed.discount.discountPaise }
        : null,
    };
  return { ok: false, reason: 'not_found', view: null };
}

function validateLines(lines: readonly CartLine[]): void {
  if (lines.length === 0 || lines.length > CART_MAX_LINES)
    throw new ValidationError(`A cart has 1 to ${String(CART_MAX_LINES)} products`, 'CART_SIZE');
  const skus = new Set<string>();
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > LINE_MAX_QTY)
      throw new ValidationError(`Quantity must be 1 to ${String(LINE_MAX_QTY)}`, 'LINE_QTY');
    if (skus.has(l.sku)) throw new ValidationError('Each product appears once', 'DUPLICATE_LINE');
    skus.add(l.sku);
  }
}

async function setting(db: Tx, cityId: string, key: string): Promise<number | null> {
  const rows = await db
    .select({ cityId: settings.cityId, value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, key), or(eq(settings.cityId, cityId), isNull(settings.cityId))));
  const row = rows.find((r) => r.cityId === cityId) ?? rows.find((r) => r.cityId === null);
  return row && typeof row.value === 'number' && Number.isSafeInteger(row.value) && row.value >= 0
    ? row.value
    : null;
}

/** A yes/no setting for a city (city value, else global, else the registry default). */
async function flagSetting(db: Tx, cityId: string, key: SettingKey): Promise<boolean> {
  const rows = await db
    .select({ cityId: settings.cityId, value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, key), or(eq(settings.cityId, cityId), isNull(settings.cityId))));
  const row = rows.find((r) => r.cityId === cityId) ?? rows.find((r) => r.cityId === null);
  const fallback = OPERATIONAL_SETTINGS[key];
  return typeof row?.value === 'boolean' ? row.value : fallback.kind === 'boolean' && fallback.default;
}

/** A checkout setting for a city (city value, else global, else the registry default). */
export async function settingOr(
  db: Tx,
  cityId: string,
  s: { key: string; fallback: number },
): Promise<number> {
  return (await setting(db, cityId, s.key)) ?? s.fallback;
}

export async function quoteInternal(
  db: Tx,
  input: { pincode: string; lines: readonly CartLine[]; locale: CatalogueLocale; userId?: string | null },
): Promise<InternalQuote> {
  validateLines(input.lines);
  const [place] = rowsOf<{
    city_id: string;
    city_code: string;
    state_id: string;
    state_gst_code: string;
    cod_allowed: boolean;
    free_delivery_min_paise: unknown;
  }>(
    // An inactive PIN is not serviceable (spec 15 "PIN codes"): refused like an unknown one.
    await db.execute(sql`
      select c.id as city_id, c.code as city_code, pc.state_id, st.gst_state_code as state_gst_code, pc.cod_allowed,
        pc.free_delivery_min_paise
      from pincodes pc join cities c on c.id = pc.city_id join states st on st.id = pc.state_id
      where pc.pincode = ${input.pincode} and pc.active and c.status = 'live'`),
  );
  if (!place) throw new ValidationError('We do not deliver to this PIN code yet', 'PINCODE_NOT_SERVICEABLE');

  const rows = rowsOf<{
    sku: string;
    qty: unknown;
    variant_id: string | null;
    category_id: string | null;
    name: string | null;
    name_hi: string | null;
    options: Record<string, unknown> | null;
    sizes: unknown;
    brand: string | null;
    hsn: string | null;
    gst_rate_bp: unknown;
    mrp_paise: unknown;
    inventory_id: string | null;
    shop_id: string | null;
    shop_name: string | null;
    shop_name_hi: string | null;
    shop_state_id: string | null;
    price: unknown;
    shop_price: unknown;
    shipping: unknown;
    lead_days: unknown;
    max_free: unknown;
    shop_free_min: unknown;
  }>(
    await db.execute(sql`
      select l.sku, l.qty, v.id as variant_id, p.category_id, p.name, p.name_hi, v.options, (select count(*) from product_variants sz where sz.product_id = v.product_id and sz.status = 'active') as sizes, b.name as brand, p.hsn, p.gst_rate_bp,
        v.mrp_paise, o.inventory_id, o.shop_id, o.shop_name, o.shop_name_hi, o.shop_state_id, o.price, o.shop_price,
        o.shipping, o.lead_days, best.max_free, o.shop_free_min
      from jsonb_to_recordset(${JSON.stringify(input.lines)}::jsonb) as l(sku text, qty int)
      left join product_variants v on v.sku = l.sku and v.status = 'active' and v.mrp_paise is not null
      left join products p on p.id = v.product_id and ${productVisible('p')}
      left join brands b on b.id = p.brand_id
      left join lateral (
        select si.id as inventory_id, s.id as shop_id, s.name as shop_name, s.name_hi as shop_name_hi,
          s.state_id as shop_state_id,
          coalesce(ap_pin.selling_paise, ap_city.selling_paise, si.selling_paise) as price,
          si.selling_paise as shop_price, sp.shipping_paise as shipping,
          coalesce(si.lead_days, sp.lead_days) as lead_days, s.free_delivery_min_paise as shop_free_min
        from shop_inventory si
        join shops s on s.id = si.shop_id
        join shop_pincodes sp on sp.shop_id = s.id and sp.pincode = ${input.pincode} and sp.active
        ${adminPriceJoins(sql`si.variant_id`, place.city_id, input.pincode)}
        where p.id is not null and si.variant_id = v.id and si.active and not si.admin_blocked
          and si.on_hand - si.reserved >= l.qty and s.status = 'approved' and s.gst_status = 'registered' and not (s.busy and (s.busy_until is null or s.busy_until > now()))
          and si.selling_paise <= coalesce(ap_pin.selling_paise, ap_city.selling_paise, si.selling_paise)
        order by st_distance(s.location, (select centroid from pincodes where pincode = ${input.pincode})) asc nulls last,
          si.selling_paise, s.id
        limit 1) o on true
      left join lateral (
        select max(si.on_hand - si.reserved) as max_free
        from shop_inventory si
        join shops s on s.id = si.shop_id
        join shop_pincodes sp on sp.shop_id = s.id and sp.pincode = ${input.pincode} and sp.active
        ${adminPriceJoins(sql`si.variant_id`, place.city_id, input.pincode)}
        where p.id is not null and si.variant_id = v.id and si.active and not si.admin_blocked
          and si.selling_paise <= coalesce(ap_pin.selling_paise, ap_city.selling_paise, si.selling_paise)
          and s.status = 'approved' and s.gst_status = 'registered'
          and not (s.busy and (s.busy_until is null or s.busy_until > now()))) best on true`),
  );
  const bySku = new Map(rows.map((r) => [r.sku, r]));

  const groupShops: string[] = [];
  /** Per group: the shop's own free-delivery threshold (null = follow the city). */
  const groupShopFreeMin: (number | null)[] = [];
  const groups: QuoteGroup[] = [];
  const priced: PricedLine[] = [];
  const lines: QuoteLine[] = input.lines.map((l) => {
    const r = bySku.get(l.sku);
    const size = r ? sizeLabelOf(r) : null;
    const name = r?.name
      ? withSize(`${r.brand ?? ''} ${localized(r.name, r.name_hi, input.locale)}`.trim(), size)
      : null;
    const base = { sku: l.sku, qty: l.qty, name, mrpPaise: numOrNull(r?.mrp_paise) };
    if (!r?.name || !r.variant_id)
      return {
        ...base,
        unitPaise: null,
        totalPaise: null,
        group: null,
        issue: 'unavailable',
        available: null,
      };
    if (!r.shop_id || !r.inventory_id || !r.shop_state_id) {
      const free = Math.max(0, numOrNull(r.max_free) ?? 0);
      return {
        ...base,
        unitPaise: null,
        totalPaise: null,
        group: null,
        issue: free > 0 ? 'insufficient_stock' : 'unavailable',
        available: free > 0 ? free : null,
      };
    }
    const unit = num(r.price);
    let g = groupShops.indexOf(r.shop_id);
    if (g === -1) {
      g = groupShops.push(r.shop_id) - 1;
      groupShopFreeMin.push(numOrNull(r.shop_free_min));
      groups.push({
        seller: localized(r.shop_name ?? '', r.shop_name_hi, input.locale),
        subtotalPaise: 0,
        shippingPaise: num(r.shipping),
        freeDeliveryMinPaise: null,
        taxPaise: 0,
        totalPaise: 0,
        leadDays: 0,
      });
    }
    const group = groups[g];
    const interState = r.shop_state_id !== place.state_id;
    const gross = unit * l.qty;
    const tax = splitInclusiveGst(gross, num(r.gst_rate_bp), interState);
    if (group) {
      group.subtotalPaise += gross;
      group.taxPaise += tax.cgst + tax.sgst + tax.igst;
      group.leadDays = Math.max(group.leadDays, numOrNull(r.lead_days) ?? 0);
    }
    priced.push({
      sku: l.sku,
      qty: l.qty,
      variantId: r.variant_id,
      inventoryId: r.inventory_id,
      shopId: r.shop_id,
      categoryId: r.category_id ?? '',
      // Snapshot both languages, whatever the customer's locale (code review 2026-11-03, hard rule 10).
      title: withSize(`${r.brand ?? ''} ${r.name}`.trim(), size),
      titleHi: r.name_hi ? withSize(`${r.brand ?? ''} ${r.name_hi}`.trim(), size) : null,
      variantLabel: size,
      hsn: r.hsn ?? '',
      gstRateBp: num(r.gst_rate_bp),
      unitPaise: unit,
      shopUnitPaise: num(r.shop_price),
      interState,
      priceSource: 'catalogue',
      costCeilingPaise: null,
      mrpPaise: numOrNull(r.mrp_paise),
    });
    return { ...base, unitPaise: unit, totalPaise: gross, group: g, issue: null, available: null };
  });

  // Free delivery per group (spec 03): PIN override ?? shop override ?? city setting (`@mechdost/shared/free-delivery`).
  const cityFreeMin = await setting(db, place.city_id, CHECKOUT_SETTINGS.freeDeliveryMinPaise.key);
  const pinFreeMin = numOrNull(place.free_delivery_min_paise);
  const groupWaivedPaise = groups.map((g, i) => {
    const freeMinPaise = freeDeliveryMinPaise({
      pin: pinFreeMin,
      shop: groupShopFreeMin[i] ?? null,
      city: cityFreeMin,
    });
    const base = g.shippingPaise;
    g.freeDeliveryMinPaise = freeMinPaise;
    g.shippingPaise = groupShippingPaise({ ...g, freeMinPaise });
    g.totalPaise = g.subtotalPaise + g.shippingPaise;
    return base - g.shippingPaise;
  });
  const subtotal = groups.reduce((a, g) => a + g.subtotalPaise, 0);
  const shipping = groups.reduce((a, g) => a + g.shippingPaise, 0);
  const tax = groups.reduce((a, g) => a + g.taxPaise, 0);
  const codFee = await settingOr(db, place.city_id, CHECKOUT_SETTINGS.codFeePaise);
  const cityCap = await settingOr(db, place.city_id, CHECKOUT_SETTINGS.codCapPaise);
  const totalCod = subtotal + shipping + codFee;
  // Who may pay cash (founder ruling 2026-11-26): the person, then the cap, the PIN rule and the cart minimums.
  const codStatus = await codStatusInCity(db, { userId: input.userId ?? null, cityId: place.city_id });
  const cap = effectiveCodCap(cityCap, codStatus.eligibility.capPaise);
  const reason = !place.cod_allowed ? 'pincode' : totalCod > cap ? 'over_cap' : null;
  const cartReason = codCartRule({
    payablePaise: totalCod,
    pieces: priced.reduce((sum, l) => sum + l.qty, 0),
    minOrderPaise: codStatus.rules.minOrderPaise,
    minItems: codStatus.rules.minItems,
  });
  return {
    cityId: place.city_id,
    priced,
    groupShops,
    groupWaivedPaise,
    quote: {
      cityCode: place.city_code,
      deliveryStateCode: place.state_gst_code,
      pincode: input.pincode,
      lines,
      groups,
      subtotalPaise: subtotal,
      shippingPaise: shipping,
      codFeePaise: codFee,
      taxPaise: tax,
      totalPaise: totalCod,
      onlineTotalPaise: subtotal + shipping,
      ok: lines.every((l) => l.issue === null),
      cod: {
        allowed: reason === null && cartReason === null && codStatus.eligibility.eligible,
        reason,
        capPaise: cap,
        eligibility: codStatus.eligibility,
        cartReason,
        minOrderPaise: codStatus.rules.minOrderPaise,
        minItems: codStatus.rules.minItems,
      },
      savingsEstimate: savingsEstimateOf(priced, groupWaivedPaise),
    },
  };
}

/**
 * Price a cart for a delivery PIN (no side effects): the COD total and the online total. `who.userId` (signed in)
 * makes the COD answer personal; a guest gets `sign_in_required` unless COD is open to everyone.
 */
export async function quoteCheckout(
  db: Tx,
  input: { pincode: string; lines: readonly CartLine[]; locale: CatalogueLocale },
  who: { userId?: string | null } = {},
): Promise<CheckoutQuote> {
  return (await quoteInternal(db, { ...input, userId: who.userId ?? null })).quote;
}

export interface ShippingAddress {
  contactName: string;
  /** E.164, validated by the API. */
  contactPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  pincode: string;
}

export type PaymentMethod = 'cod' | 'online';

export interface PlacedOrder {
  code: string;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  totalPaise: number;
  orders: { code: string; totalPaise: number }[];
  /** MechDost Coins used on this checkout and the discount they gave (spec 20); 0 when none. */
  coinsRedeemed: number;
  coinDiscountPaise: number;
  /** The coupon's discount on this checkout (spec 03); 0 when none. Taken off before the coins. */
  couponDiscountPaise: number;
  /** True when this key had already placed the order (a retry or a double tap). */
  replayed: boolean;
}

/** Fingerprint of what was asked for, in a fixed field order (a retry must be the same request). */
function requestHash(input: {
  address: ShippingAddress;
  lines: readonly CartLine[];
  note: string | null;
  business?: BusinessPurchase | null;
  coins?: number;
  couponCode?: string | null;
}) {
  const a = input.address;
  const canonical = JSON.stringify([
    [a.contactName, a.contactPhone, a.line1, a.line2, a.landmark, a.pincode],
    [...input.lines].map((l) => [l.sku, l.qty]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    input.note,
    // A different GSTIN under the same key is a different request (buyer GSTIN plan).
    input.business ? [input.business.gstin, input.business.businessName] : null,
    // Coins asked for (spec 20); left out when none, so requests without coins keep their earlier fingerprint.
    ...(input.coins ? [['coins', input.coins]] : []),
    // The coupon asked for (any letter case is one code); left out when none, like the coins.
    ...(input.couponCode ? [['coupon', input.couponCode.trim().toUpperCase()]] : []),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

async function existingGroup(db: Tx, userId: string, key: string, hash: string): Promise<PlacedOrder | null> {
  const [group] = await db
    .select()
    .from(orderGroups)
    .where(and(eq(orderGroups.userId, userId), eq(orderGroups.idempotencyKey, key)));
  if (!group) return null;
  // Same key, different cart or address: a client bug or a reused key — never silently return the old order
  // (code review 2026-11-03). Rows placed before the hash existed are trusted.
  if (group.requestHash !== null && group.requestHash !== hash)
    throw new ValidationError(
      'This request key was already used for a different order',
      'IDEMPOTENCY_MISMATCH',
    );
  const subs = await db
    .select({ code: orders.code, totalPaise: orders.totalPaise })
    .from(orders)
    .where(eq(orders.groupId, group.id))
    .orderBy(orders.subNo);
  return {
    code: group.code,
    paymentMethod: group.paymentMethod === 'online' ? 'online' : 'cod',
    paymentStatus: group.paymentStatus,
    totalPaise: group.totalPaise,
    orders: subs,
    coinsRedeemed: group.coinsRedeemed,
    coinDiscountPaise: group.coinDiscountPaise,
    couponDiscountPaise: group.couponDiscountPaise,
    replayed: true,
  };
}

export interface PlaceOrderInput {
  userId: string;
  idempotencyKey: string;
  address: ShippingAddress;
  lines: readonly CartLine[];
  expectedTotalPaise: number;
  note: string | null;
  locale: CatalogueLocale;
  /** Optional business purchase (GST invoice); validated by `BusinessPurchaseSchema` at the API. */
  business?: BusinessPurchase | null;
  /**
   * MechDost Coins to use (spec 20): within the cap or COINS_CHANGED; `expectedTotalPaise` already has their
   * discount taken off. Products only, never delivery or the COD fee.
   */
  coins?: number;
  /**
   * One coupon code (spec 03): checked again here against the re-priced cart, counted by conditional UPDATE in this
   * transaction; `expectedTotalPaise` already has its discount (and then the coins') taken off. A coupon that no
   * longer applies is 422 COUPON_INVALID with `details.reason`. Not allowed on a bulk quote order.
   */
  couponCode?: string | null;
  /**
   * An accepted bulk quote offer (spec 19; only `acceptQuoteOffer` sets it): the negotiated GST-inclusive unit prices
   * and the offer's delivery charge replace the catalogue prices, delivery and COD fee. The COD cap does not apply
   * (staff agreed the order with the customer); the PIN's COD rule and customer blocks still do.
   */
  quotePricing?: QuotePricing | null;
}

export interface QuotePricing {
  quoteId: string;
  offerId: string;
  unitPaiseBySku: ReadonlyMap<string, number>;
  deliveryPaise: number;
}

/** Replace catalogue prices with the negotiated ones and recompute every group (exact paise, same GST rule). */
function applyQuotePricing(internal: InternalQuote, pricing: QuotePricing): void {
  const { quote, priced, groupShops } = internal;
  for (const line of priced) {
    const unit = pricing.unitPaiseBySku.get(line.sku);
    if (unit === undefined) throw new Error(`quote pricing has no price for ${line.sku}`);
    // The catalogue price stays the routing ceiling: shops are never paid more than it (review C1, 2026-11-14).
    line.costCeilingPaise = line.unitPaise;
    line.unitPaise = unit;
    line.priceSource = 'quote';
  }
  quote.groups.forEach((g, index) => {
    const lines = priced.filter((p) => p.shopId === groupShops[index]);
    g.subtotalPaise = lines.reduce((sum, l) => sum + l.unitPaise * l.qty, 0);
    g.taxPaise = lines.reduce((sum, l) => {
      const tax = splitInclusiveGst(l.unitPaise * l.qty, l.gstRateBp, l.interState);
      return sum + tax.cgst + tax.sgst + tax.igst;
    }, 0);
    // The whole negotiated delivery charge rides on the first sub-order (like the COD fee).
    g.shippingPaise = index === 0 ? pricing.deliveryPaise : 0;
    g.totalPaise = g.subtotalPaise + g.shippingPaise;
  });
  quote.subtotalPaise = quote.groups.reduce((a, g) => a + g.subtotalPaise, 0);
  quote.shippingPaise = quote.groups.reduce((a, g) => a + g.shippingPaise, 0);
  quote.taxPaise = quote.groups.reduce((a, g) => a + g.taxPaise, 0);
  quote.codFeePaise = 0;
  quote.totalPaise = quote.subtotalPaise + quote.shippingPaise;
  quote.onlineTotalPaise = quote.totalPaise;
  // A bulk quote order is not gated by COD eligibility or the cart minimums (staff agreed it with the customer;
  // ruling 2026-11-26, queued as a question); its own ceiling is checked when the offer is accepted.
  const pincodeCod = quote.cod.reason !== 'pincode';
  quote.cod = {
    ...quote.cod,
    allowed: pincodeCod,
    reason: pincodeCod ? null : 'pincode',
    cartReason: null,
  };
  // A negotiated delivery charge is what was agreed, not a waiver: nothing to count as saved on delivery.
  internal.groupWaivedPaise = internal.groupWaivedPaise.map(() => 0);
  quote.savingsEstimate = savingsEstimateOf(priced, internal.groupWaivedPaise);
}

/** Place a cash-on-delivery order (see `placeOrder`). */
export function placeCodOrder(db: Tx, input: PlaceOrderInput): Promise<PlacedOrder> {
  return placeOrder(db, { ...input, method: 'cod' });
}

/**
 * Place an order paid by cash on delivery or online (Razorpay). Same `idempotencyKey` (per user) → the same order,
 * never a second one. Online: no COD fee, `payment_status = 'created'`, stock held for the online payment window;
 * the API then creates the Razorpay order. Throws CHECKOUT_UNAVAILABLE (with the line issues as details),
 * PRICE_CHANGED, COD_NOT_ALLOWED, OUT_OF_STOCK, ORDERS_BLOCKED.
 */
export async function placeOrder(
  db: Tx,
  input: PlaceOrderInput & { method: PaymentMethod },
): Promise<PlacedOrder> {
  const online = input.method === 'online';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.idempotencyKey))
    throw new ValidationError('Invalid idempotency key', 'IDEMPOTENCY_KEY');
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`place:${input.userId}:${input.idempotencyKey}`}, 0))`,
    );
    const hash = requestHash(input);
    const replay = await existingGroup(tx, input.userId, input.idempotencyKey, hash);
    if (replay) return replay;
    // Customer blocks (shared/customers.ts): `orders`/`full` refuse placing, `cod_only` refuses cash on delivery.
    const allowed = blockEffects(await activeBlockLevels(tx, input.userId));
    if (!allowed.order) throw new ForbiddenError('This account cannot place orders', 'ORDERS_BLOCKED');

    const internal = await quoteInternal(tx, {
      pincode: input.address.pincode,
      lines: input.lines,
      locale: input.locale,
      userId: input.userId,
    });
    const { quote, priced, groupShops, cityId } = internal;
    if (!quote.ok)
      throw new ValidationError('Some products changed; please review your cart', 'CHECKOUT_UNAVAILABLE', {
        lines: quote.lines
          .filter((l) => l.issue)
          .map((l) => ({ sku: l.sku, issue: l.issue, available: l.available })),
      });
    if (input.quotePricing) applyQuotePricing(internal, input.quotePricing);
    // Coins are never used on a bulk quote order: its prices were negotiated with staff (ruling 2026-11-14).
    if (input.quotePricing && (input.coins ?? 0) > 0)
      throw new ValidationError('MechDost Coins cannot be used on a bulk quote order', 'COINS_NOT_ON_QUOTES');
    // One coupon (spec 03), first in the order of discounts: checked again on the re-priced cart; counted below.
    const couponCode = input.couponCode?.trim() ?? '';
    if (couponCode && input.quotePricing) throw couponRefusal('quote_order');
    // 2026-11-16: the best automatic offer competes with a typed code (never stacked); the winner is counted below.
    let couponEval: Extract<OfferChoice, { ok: true }> | null = null;
    const chosen = await chooseOffer(tx, internal, {
      code: couponCode || null,
      userId: input.userId,
      locale: input.locale,
      allowAutomatic: !input.quotePricing,
    });
    if (chosen.ok) couponEval = chosen;
    else if (couponCode) throw couponRefusal(chosen.reason);
    const couponShare = (index: number) => couponEval?.discount.perGroup[index];
    const couponDiscountPaise = couponEval?.discount.discountPaise ?? 0;
    // Coins (spec 20) come after the coupon: on what the products cost once the coupon's share is off.
    const netGroupSubtotals = quote.groups.map(
      (g, i) => g.subtotalPaise - (couponShare(i)?.productPaise ?? 0),
    );
    const coins = await checkoutCoins(tx, {
      userId: input.userId,
      requested: input.coins ?? 0,
      subtotalPaise: netGroupSubtotals.reduce((a, b) => a + b, 0),
      groupSubtotals: netGroupSubtotals,
    });
    const totalPaise =
      (online ? quote.onlineTotalPaise : quote.totalPaise) - couponDiscountPaise - coins.discountPaise;
    const codFeePaise = online ? 0 : quote.codFeePaise;
    if (totalPaise !== input.expectedTotalPaise)
      throw new ConflictError('The total changed since you reviewed it', 'PRICE_CHANGED');
    // The COD cap applies to what the customer pays at the door (after coins). A quote order has its own ceiling,
    // checked when the offer is accepted (`quotes.cod_cap_paise`, spec 19), so the checkout cap does not apply.
    // Then the admin's minimum order (on what is paid at the door) and pieces (founder ruling 2026-11-26).
    const codReason =
      quote.cod.reason === 'pincode'
        ? 'pincode'
        : input.quotePricing
          ? null
          : totalPaise > quote.cod.capPaise
            ? 'over_cap'
            : codCartRule({
                payablePaise: totalPaise,
                pieces: input.lines.reduce((sum, l) => sum + l.qty, 0),
                minOrderPaise: quote.cod.minOrderPaise,
                minItems: quote.cod.minItems,
              });
    if (!online && !allowed.cod)
      throw new ValidationError('Cash on delivery is not available for this order', 'COD_NOT_ALLOWED', {
        reason: 'customer',
        capPaise: quote.cod.capPaise,
      });
    // Who may pay cash at all, decided here and never by the client. Bulk quote orders are exempt (see above).
    if (!online && !input.quotePricing && !quote.cod.eligibility.eligible)
      throw new ValidationError('Cash on delivery is not available to this account', 'COD_NOT_ELIGIBLE', {
        reason: quote.cod.eligibility.reason,
        canRequest: quote.cod.eligibility.canRequest,
      });
    if (!online && codReason !== null)
      throw new ValidationError('Cash on delivery is not available for this order', 'COD_NOT_ALLOWED', {
        reason: codReason,
        capPaise: quote.cod.capPaise,
        minOrderPaise: quote.cod.minOrderPaise,
        minItems: quote.cod.minItems,
      });

    await setActor(tx, { type: 'customer', userId: input.userId });
    // Snapshot of the cancel rule (Q25): customers cancel until confirmed only when the admin allows it, set
    // separately for online-paid and cash-on-delivery orders (user 2026-11-14).
    const cancellableUntilStatus = (await flagSetting(
      tx,
      cityId,
      online ? 'orders.customer_self_cancel_online' : 'orders.customer_self_cancel_cod',
    ))
      ? 'confirmed'
      : 'none';
    const group = await insertGroup(tx, {
      cityCode: quote.cityCode,
      values: {
        userId: input.userId,
        cityId,
        paymentMethod: input.method,
        paymentStatus: online ? 'created' : 'cod_pending',
        subtotalPaise: quote.subtotalPaise,
        discountPaise: couponDiscountPaise + coins.discountPaise,
        coinsRedeemed: coins.coins,
        coinDiscountPaise: coins.discountPaise,
        couponId: couponEval?.coupon.id ?? null,
        couponCode: couponEval?.coupon.code ?? null,
        couponDiscountPaise,
        couponSnapshot: couponEval ? couponSnapshot(couponEval, internal) : null,
        shippingPaise: quote.shippingPaise,
        codFeePaise,
        totalPaise,
        note: input.note,
        gstin: input.business?.gstin ?? null,
        businessName: input.business?.businessName ?? null,
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
        quoteId: input.quotePricing?.quoteId ?? null,
        quoteOfferId: input.quotePricing?.offerId ?? null,
      },
    });

    if (coins.coins > 0) {
      // Lock order (spec 14): coins are spent before any stock is reserved, the order a cancel uses too (coins
      // restored in `transitionOrder`, then stock released), so the two can never wait on each other.
      // Compare-and-set on the balance: a parallel checkout that spent the coins first makes this one fail
      // (INSUFFICIENT_COINS) and the whole order rolls back. One spend per order (`redeem:<group id>`).
      await redeemCoins(tx, {
        userId: input.userId,
        coins: coins.coins,
        orderGroupId: group.id,
        idemKey: `redeem:${group.id}`,
      });
      await recordServerEvent(tx, 'coins_redeemed', {
        userId: input.userId,
        cityId,
        props: { orderCode: group.code, coins: coins.coins, discountPaise: coins.discountPaise },
      });
    }
    if (couponEval) {
      // After the coins and before any stock (the order a cancel gives them back in): the authoritative count.
      try {
        await redeemCoupon(tx, {
          couponId: couponEval.coupon.id,
          userId: input.userId,
          groupId: group.id,
          funder: couponEval.coupon.rule.funder,
          discountPaise: couponDiscountPaise,
        });
      } catch (err) {
        // An automatic offer the customer never typed ran out while they paid: the price changed, not "your code".
        if (couponEval.source === 'automatic' && err instanceof ValidationError)
          throw new ConflictError('The total changed since you reviewed it', 'PRICE_CHANGED');
        throw err;
      }
      await recordServerEvent(tx, 'coupon_redeemed', {
        userId: input.userId,
        cityId,
        props: {
          couponId: couponEval.coupon.id,
          orderCode: group.code,
          discountPaise: couponDiscountPaise,
          funder: couponEval.coupon.rule.funder,
          kind: couponEval.coupon.rule.kind,
          source: couponEval.source,
        },
      });
    }
    const ttl = await settingOr(
      tx,
      cityId,
      online ? CHECKOUT_SETTINGS.onlinePaymentMinutes : CHECKOUT_SETTINGS.codReservationMinutes,
    );
    const placed: { code: string; totalPaise: number }[] = [];
    for (const [index, shopId] of groupShops.entries()) {
      const g = quote.groups[index];
      if (!g) continue;
      const subNo = index + 1;
      const code = `${group.code}-${String(subNo)}`;
      const subCoins = coins.perGroup[index] ?? 0;
      const subCoinDiscount = subCoins * coins.coinValuePaise;
      const subCoupon = couponShare(index);
      const subCouponDiscount = subCoupon?.discountPaise ?? 0;
      const subDiscount = subCouponDiscount + subCoinDiscount;
      const subTotal = g.totalPaise - subDiscount + (index === 0 ? codFeePaise : 0);
      const [order] = await tx
        .insert(orders)
        .values({
          groupId: group.id,
          subNo,
          code,
          userId: input.userId,
          cityId,
          suggestedShopId: shopId,
          shippingAddress: input.address,
          pincode: input.address.pincode,
          subtotalPaise: g.subtotalPaise,
          // This part's share of the coupon, then of the coins (spec 03 / 20): what the delivering shop collects is
          // after both.
          discountPaise: subDiscount,
          coinsRedeemed: subCoins,
          coinDiscountPaise: subCoinDiscount,
          couponDiscountPaise: subCouponDiscount,
          couponFunder: subCouponDiscount > 0 ? (couponEval?.coupon.rule.funder ?? null) : null,
          shippingPaise: g.shippingPaise,
          deliveryWaivedPaise: internal.groupWaivedPaise[index] ?? 0,
          // The COD fee rides on the first sub-order, so sub-order totals add up to the group total and
          // someone collects it (code review 2026-11-03).
          codFeePaise: index === 0 ? codFeePaise : 0,
          taxPaise: g.taxPaise,
          totalPaise: subTotal,
          cancellableUntilStatus,
        })
        .returning({ id: orders.id });
      if (!order) throw new Error('order insert returned no row');
      for (const [lineIndex, line] of priced.filter((p) => p.shopId === shopId).entries()) {
        const gross = line.unitPaise * line.qty;
        const tax = splitInclusiveGst(gross, line.gstRateBp, line.interState);
        await tx.insert(orderItems).values({
          orderId: order.id,
          variantId: line.variantId,
          title: line.title,
          titleHi: line.titleHi,
          variantLabel: line.variantLabel,
          sku: line.sku,
          hsn: line.hsn,
          gstRateBp: line.gstRateBp,
          unitPaise: line.unitPaise,
          mrpPaise: line.mrpPaise,
          shopUnitPaise: line.shopUnitPaise,
          qty: line.qty,
          lineDiscountPaise: subCoupon?.lines[lineIndex] ?? 0,
          taxablePaise: tax.taxable,
          cgstPaise: tax.cgst,
          sgstPaise: tax.sgst,
          igstPaise: tax.igst,
          totalPaise: gross,
          priceSource: line.priceSource,
          costCeilingPaise: line.costCeilingPaise,
        });
        const reservation = await reserveStock(tx, {
          inventoryId: line.inventoryId,
          orderId: order.id,
          qty: line.qty,
          ttlMinutes: ttl,
        });
        if (!reservation)
          throw new ConflictError('A product just sold out; please review your cart', 'OUT_OF_STOCK');
      }
      placed.push({ code, totalPaise: subTotal });
    }
    await recordServerEvent(tx, 'purchase', {
      userId: input.userId,
      cityId,
      props: {
        orderCode: group.code,
        subOrders: placed.length,
        items: priced.length,
        totalPaise,
        paymentMethod: input.method,
      },
    });
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'order.placed',
      entity: 'order_group',
      entityId: group.id,
      after: {
        code: group.code,
        totalPaise,
        subOrders: placed.length,
        paymentMethod: input.method,
        coinsRedeemed: coins.coins,
        couponDiscountPaise,
      },
    });
    // Cash on delivery is placed now; an online order is "placed" for the customer once the payment is captured.
    if (!online) {
      await queueOrderPlacedEmail(tx, group.id);
      // The ordered packs leave the saved cart (the customer's other devices show it on their next refresh).
      await removeOrderedCartLines(tx, input.userId, { skus: priced.map((p) => p.sku) });
    }
    return {
      code: group.code,
      paymentMethod: input.method,
      paymentStatus: online ? 'created' : 'cod_pending',
      totalPaise,
      orders: placed,
      coinsRedeemed: coins.coins,
      coinDiscountPaise: coins.discountPaise,
      couponDiscountPaise,
      replayed: false,
    };
  });
}

/**
 * What the order keeps of the coupon (spec 14 snapshot rule): its rules as they were at placement and the split of the
 * discount over sub-orders and SKUs, so later edits or a pause of the coupon never change an old order.
 */
function couponSnapshot(ev: Extract<OfferChoice, { ok: true }>, internal: InternalQuote) {
  const { coupon, discount } = ev;
  return {
    code: coupon.code,
    /** Applied without a code (2026-11-16); `code` is then the offer's internal name. */
    automatic: ev.source === 'automatic',
    categoryId: coupon.categoryId,
    /** What the other offer would have given (never stacked); null when there was none. */
    beaten: ev.beaten,
    title: coupon.view.title,
    kind: coupon.rule.kind,
    value: coupon.rule.value,
    maxDiscountPaise: coupon.rule.maxDiscountPaise,
    minSubtotalPaise: coupon.rule.minSubtotalPaise,
    funder: coupon.rule.funder,
    shopId: coupon.rule.shopId,
    discountPaise: discount.discountPaise,
    productDiscountPaise: discount.productDiscountPaise,
    shippingDiscountPaise: discount.shippingDiscountPaise,
    allocation: internal.groupShops.map((shopId, index) => ({
      subNo: index + 1,
      shopId,
      discountPaise: discount.perGroup[index]?.discountPaise ?? 0,
      shippingPaise: discount.perGroup[index]?.shippingPaise ?? 0,
      lines: internal.priced
        .filter((p) => p.shopId === shopId)
        .map((p, i) => ({ sku: p.sku, paise: discount.perGroup[index]?.lines[i] ?? 0 })),
    })),
  };
}

/** Insert the group with a fresh public code; a (vanishingly rare) code collision retries in a savepoint. */
async function insertGroup(
  tx: Tx,
  args: { cityCode: string; values: Omit<typeof orderGroups.$inferInsert, 'code'> },
): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = publicCode('MD', args.cityCode);
    try {
      return await tx.transaction(async (sp) => {
        const [row] = await sp
          .insert(orderGroups)
          .values({ ...args.values, code })
          .returning({ id: orderGroups.id, code: orderGroups.code });
        if (!row) throw new Error('order group insert returned no row');
        return row;
      });
    } catch (err) {
      if (pgCode(err) !== '23505') throw err;
    }
  }
  throw new ConflictError('Could not allocate an order code, please retry', 'CODE_COLLISION');
}

/** For tests and the API: the user's group by public code, or 404 (actor-scoped, hard rule 3). */
export async function getMyOrderGroup(db: Tx, userId: string, code: string) {
  const [group] = await db
    .select()
    .from(orderGroups)
    .where(and(eq(orderGroups.userId, userId), eq(orderGroups.code, code)));
  if (!group) throw new NotFoundError();
  return group;
}
