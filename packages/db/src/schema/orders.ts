import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ASSIGNMENT_GIVE_UP_REASONS,
  ASSIGNMENT_STATES,
  ORDER_CANCEL_REASONS,
  ORDER_REJECT_REASONS,
  ORDER_STATES,
  PAYMENT_STATES,
  REFUND_REASONS,
  REFUND_REJECT_REASONS,
  REFUND_SETTLE_REASONS,
  REFUND_SOURCES,
  REFUND_STATES,
} from '@mechdost/shared/state';
import { DELIVERY_FAIL_REASONS, ORDER_DELIVERY_MODES } from '@mechdost/shared/delivery/codes';
import { citext, createdAt, encryptedCheck, id, paise, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { users } from './identity';
import { categories, productVariants, shopInventory, shops } from './catalogue';
import { quoteOffers, quoteRequests } from './quotes';
import { rsaRequests } from './roadside';
import { serviceBills } from './services';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * One checkout = one order group (one payment, one public code MD-RPR-YYYY-XXXXXX).
 * It is split into per-shop sub-orders that admin routes independently (docs/specs/03, 04).
 */
export const orderGroups = pgTable(
  'order_groups',
  {
    id: id(),
    code: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    paymentMethod: text().notNull(),
    paymentStatus: text().notNull().default('created'),
    subtotalPaise: paise().notNull(),
    discountPaise: paise().notNull().default(0),
    shippingPaise: paise().notNull().default(0),
    codFeePaise: paise().notNull().default(0),
    totalPaise: paise().notNull(),
    /** MechDost Coins used on this checkout and the part of `discountPaise` they paid (spec 20). */
    coinsRedeemed: integer().notNull().default(0),
    coinDiscountPaise: paise().notNull().default(0),
    /** The one coupon used (spec 03): id, the code as typed, its discount and a snapshot of its rules and the per-line allocation. */
    couponId: uuid().references(() => coupons.id, { onDelete: 'restrict' }),
    couponCode: text(),
    couponDiscountPaise: paise().notNull().default(0),
    couponSnapshot: jsonb(),
    gstin: text(),
    businessName: text(),
    note: text(),
    idempotencyKey: text().notNull(),
    /** SHA-256 of the placed request (address, lines, note): the same key with a different request is refused. */
    requestHash: text(),
    /** Set when the order comes from an accepted bulk quote offer (spec 19): one order per quote and per offer. */
    quoteId: uuid().references(() => quoteRequests.id, { onDelete: 'restrict' }),
    quoteOfferId: uuid().references(() => quoteOffers.id, { onDelete: 'restrict' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('order_groups_idempotency_uq').on(t.userId, t.idempotencyKey),
    check('order_groups_code_format', sql`${t.code} ~ '^MD-[A-Z]{3}-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$'`),
    // Business purchase (buyer GSTIN plan 2026-11-13): both or neither, a well-formed GSTIN, a sane name.
    check(
      'order_groups_gstin_format',
      sql`${t.gstin} is null or ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check('order_groups_business_pair', sql`(${t.gstin} is null) = (${t.businessName} is null)`),
    check(
      'order_groups_business_name_len',
      sql`${t.businessName} is null or char_length(${t.businessName}) between 2 and 120`,
    ),
    check('order_groups_payment_method_valid', sql`${t.paymentMethod} in ('online','cod')`),
    check(
      'order_groups_payment_status_valid',
      sql`${t.paymentStatus} in (${inList([...PAYMENT_STATES, 'cod_pending', 'cod_collected'])})`,
    ),
    check(
      'order_groups_amounts_nonneg',
      sql`${t.subtotalPaise} >= 0 and ${t.discountPaise} >= 0 and ${t.shippingPaise} >= 0 and ${t.codFeePaise} >= 0 and ${t.totalPaise} >= 0`,
    ),
    check(
      'order_groups_coins_consistent',
      sql`${t.coinsRedeemed} >= 0 and ${t.coinDiscountPaise} >= 0 and ${t.coinDiscountPaise} <= ${t.discountPaise} and (${t.coinsRedeemed} = 0) = (${t.coinDiscountPaise} = 0)`,
    ),
    // The discount is exactly the coupon plus the coins (coupon first, then coins; spec 03 / 20).
    check(
      'order_groups_discount_parts',
      sql`${t.discountPaise} = ${t.couponDiscountPaise} + ${t.coinDiscountPaise} and ${t.couponDiscountPaise} >= 0`,
    ),
    check(
      'order_groups_coupon_set',
      sql`(${t.couponId} is null) = (${t.couponCode} is null) and (${t.couponId} is null) = (${t.couponSnapshot} is null) and (${t.couponId} is not null or ${t.couponDiscountPaise} = 0)`,
    ),
    check(
      'order_groups_total_consistent',
      sql`${t.totalPaise} = ${t.subtotalPaise} - ${t.discountPaise} + ${t.shippingPaise} + ${t.codFeePaise}`,
    ),
    check('order_groups_quote_pair', sql`(${t.quoteId} is null) = (${t.quoteOfferId} is null)`),
    uniqueIndex('order_groups_quote_uq')
      .on(t.quoteId)
      .where(sql`${t.quoteId} is not null`),
    uniqueIndex('order_groups_quote_offer_uq')
      .on(t.quoteOfferId)
      .where(sql`${t.quoteOfferId} is not null`),
    index().on(t.userId, t.createdAt),
    index().on(t.cityId, t.createdAt),
  ],
);

/** A per-shop sub-order. Status follows orderMachine; every change is a conditional UPDATE on (status, version). */
export const orders = pgTable(
  'orders',
  {
    id: id(),
    groupId: uuid()
      .notNull()
      .references(() => orderGroups.id, { onDelete: 'restrict' }),
    subNo: smallint().notNull(),
    code: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    status: text().notNull().default('placed'),
    suggestedShopId: uuid().references(() => shops.id, { onDelete: 'set null' }),
    shopId: uuid().references(() => shops.id, { onDelete: 'restrict' }),
    shippingAddress: jsonb().notNull(), // immutable snapshot
    pincode: text().notNull(),
    subtotalPaise: paise().notNull(),
    discountPaise: paise().notNull().default(0),
    shippingPaise: paise().notNull().default(0),
    /** Cash-on-delivery fee, carried by the first sub-order so the shop delivering it collects it (review 2026-11-03). */
    codFeePaise: paise().notNull().default(0),
    taxPaise: paise().notNull().default(0),
    totalPaise: paise().notNull(),
    /**
     * The delivery charge the free-delivery threshold waived on this part (paise; 0 when it was charged or never set).
     * Snapshot for "Your savings" (decision 2026-11-26); orders before migration 0101 carry 0.
     */
    deliveryWaivedPaise: paise().notNull().default(0),
    /** This sub-order's share of the checkout's MechDost Coins and the part of `discountPaise` they paid (spec 20). */
    coinsRedeemed: integer().notNull().default(0),
    coinDiscountPaise: paise().notNull().default(0),
    /** This sub-order's share of the coupon (products + delivery) and who funds it; `discount_paise` = coupon + coins. */
    couponDiscountPaise: paise().notNull().default(0),
    couponFunder: text(),
    cancellableUntilStatus: text().notNull().default('confirmed'),
    /**
     * Who delivers this sub-order (spec 24, Lead's call 9): `agent` (MechDost delivery agent) or `shop` (the shop
     * itself, today's flow). Set at routing from the shop's mode; COD is always `shop`; staff may switch to `shop`.
     */
    deliveryMode: text().notNull().default('shop'),
    /** Reject (later: cancel) reason code and the message shown to the customer (spec 04). */
    statusReasonCode: text(),
    customerMessage: text(),
    placedAt: ts().notNull().defaultNow(),
    confirmedAt: ts(),
    deliveredAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.groupId, t.subNo),
    check('orders_status_valid', sql`${t.status} in (${inList(ORDER_STATES)})`),
    check('orders_sub_no_positive', sql`${t.subNo} > 0`),
    check('orders_delivery_mode_valid', sql`${t.deliveryMode} in (${inList(ORDER_DELIVERY_MODES)})`),
    // Agent-only states (spec 24).
    check(
      'orders_agent_states',
      sql`${t.status} not in ('ready_for_pickup','returned') or ${t.deliveryMode} = 'agent'`,
    ),
    // The reason code belongs to the status it explains (code review 2026-11-03): a rejected order carries a
    // reject reason, a cancelled one a cancel reason, every other status none.
    check(
      'orders_reason_code_valid',
      sql`case ${t.status}
        when 'rejected' then ${t.statusReasonCode} in (${inList(ORDER_REJECT_REASONS)})
        when 'cancelled' then ${t.statusReasonCode} in (${inList(ORDER_CANCEL_REASONS)})
        when 'returned' then ${t.statusReasonCode} in (${inList(DELIVERY_FAIL_REASONS)})
        else ${t.statusReasonCode} is null end`,
    ),
    check(
      'orders_rejected_explained',
      sql`${t.status} <> 'rejected' or (${t.statusReasonCode} is not null and char_length(${t.customerMessage}) between 10 and 500)`,
    ),
    check('orders_cancelled_explained', sql`${t.status} <> 'cancelled' or ${t.statusReasonCode} is not null`),
    check(
      'orders_amounts_nonneg',
      sql`${t.subtotalPaise} >= 0 and ${t.totalPaise} >= 0 and ${t.taxPaise} >= 0 and ${t.codFeePaise} >= 0`,
    ),
    check('orders_delivery_waived_nonneg', sql`${t.deliveryWaivedPaise} >= 0`),
    // What the delivering shop collects is exactly the sum of its parts (the group total = sum of sub-orders).
    check(
      'orders_total_matches',
      sql`${t.totalPaise} = ${t.subtotalPaise} - ${t.discountPaise} + ${t.shippingPaise} + ${t.codFeePaise}`,
    ),
    check(
      'orders_coins_consistent',
      sql`${t.coinsRedeemed} >= 0 and ${t.coinDiscountPaise} >= 0 and ${t.coinDiscountPaise} <= ${t.discountPaise} and (${t.coinsRedeemed} = 0) = (${t.coinDiscountPaise} = 0)`,
    ),
    check(
      'orders_discount_parts',
      sql`${t.discountPaise} = ${t.couponDiscountPaise} + ${t.coinDiscountPaise} and ${t.couponDiscountPaise} >= 0`,
    ),
    check(
      'orders_coupon_funder',
      sql`(${t.couponDiscountPaise} = 0) = (${t.couponFunder} is null) and (${t.couponFunder} is null or ${t.couponFunder} in ('mechdost','shop'))`,
    ),
    check(
      'orders_shop_when_confirmed',
      sql`${t.status} in ('placed','awaiting_shop','needs_rerouting','cancelled','rejected') or ${t.shopId} is not null`,
    ),
    index().on(t.status, t.cityId, t.placedAt),
    // CSV exports (design 2026-11-15): a city's sub-orders in an IST window, keyset-paged on (placed_at, id).
    index('orders_city_placed_id_idx').on(t.cityId, t.placedAt, t.id),
    index().on(t.shopId, t.status),
    index().on(t.userId, t.placedAt),
    index().on(t.suggestedShopId),
    index().on(t.cityId),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    /** Snapshot in English (shops, admin, invoices) and Hindi when the product has it (hard rule 10). */
    title: text().notNull(),
    titleHi: text(),
    sku: text().notNull(),
    /**
     * The size ("145/70 R12 69T TL") when the product is sold in several sizes (user 2026-11-24), else null. The
     * titles above already end with it; this column keeps it apart for reports and training data (rule 16).
     */
    variantLabel: text(),
    hsn: text().notNull(),
    gstRateBp: integer().notNull(),
    unitPaise: paise().notNull(),
    /**
     * The maker's printed MRP per unit when the order was placed (snapshot for "Your savings", decision 2026-11-26).
     * Null on lines placed before migration 0101: they are excluded from savings, never filled from today's MRP.
     */
    mrpPaise: paise(),
    /** The chosen shop's approved price per unit (what it is paid); `unit_paise` - this = MechDost's margin (Q11). Null on orders before 2026-11-13. */
    shopUnitPaise: paise(),
    qty: integer().notNull(),
    /** This line's share of the coupon discount (largest-remainder allocation; the shares add up to the coupon). */
    lineDiscountPaise: paise().notNull().default(0),
    taxablePaise: paise().notNull(),
    cgstPaise: paise().notNull().default(0),
    sgstPaise: paise().notNull().default(0),
    igstPaise: paise().notNull().default(0),
    totalPaise: paise().notNull(),
    recoSource: text(),
    /** Where the unit price came from: the catalogue, or a negotiated bulk quote offer (spec 19). */
    priceSource: text().notNull().default('catalogue'),
    /**
     * Quote lines only: the most a shop may be paid per unit — the catalogue price for the PIN when the order was
     * placed (the checkout's admin price ceiling). Routing compares shops against it, not the negotiated price.
     */
    costCeilingPaise: paise(),
  },
  (t) => [
    check('order_items_qty_positive', sql`${t.qty} > 0 and ${t.qty} <= 99`),
    check('order_items_price_source_valid', sql`${t.priceSource} in ('catalogue','quote')`),
    check(
      'order_items_cost_ceiling_quote_only',
      sql`(${t.costCeilingPaise} is not null) = (${t.priceSource} = 'quote') and (${t.costCeilingPaise} is null or ${t.costCeilingPaise} > 0)`,
    ),
    // A negotiated price may sit below the shop's approved price: MechDost pays the shop its price (spec 19).
    check(
      'order_items_shop_unit_valid',
      sql`${t.shopUnitPaise} is null or (${t.shopUnitPaise} >= 0 and (${t.shopUnitPaise} <= ${t.unitPaise} or ${t.priceSource} = 'quote'))`,
    ),
    check('order_items_mrp_nonneg', sql`${t.mrpPaise} is null or ${t.mrpPaise} >= 0`),
    check('order_items_line_discount_max', sql`${t.lineDiscountPaise} <= ${t.unitPaise} * ${t.qty}`),
    check('order_items_cgst_equals_sgst', sql`${t.cgstPaise} = ${t.sgstPaise}`),
    check('order_items_intra_or_inter', sql`${t.igstPaise} = 0 or ${t.cgstPaise} = 0`),
    check(
      'order_items_total_consistent',
      sql`${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`,
    ),
    check(
      'order_items_amounts_nonneg',
      sql`${t.unitPaise} >= 0 and ${t.lineDiscountPaise} >= 0 and ${t.taxablePaise} >= 0`,
    ),
    index().on(t.orderId),
    index().on(t.variantId),
  ],
);

/**
 * An offer of a sub-order to one shop. The partial unique index makes it impossible for an order to be
 * offered to / accepted by two shops at once, whatever the application does.
 */
export const orderAssignments = pgTable(
  'order_assignments',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    status: text().notNull().default('offered'),
    offeredBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    offeredAt: ts().notNull().defaultNow(),
    expiresAt: ts().notNull(),
    respondedAt: ts(),
    declineReason: text(),
    /** A shop that accepted and then gave the order up before packing (spec 04; user ruling 2026-11-15). */
    givenUpAt: ts(),
    giveUpReason: text(),
    /** The extra free-text note (rule 16): staff-only, never shown to the customer. */
    giveUpNote: text(),
    version: version(),
  },
  (t) => [
    check('order_assignments_status_valid', sql`${t.status} in (${inList(ASSIGNMENT_STATES)})`),
    // A given-up offer carries its reason code and time; no other status does.
    check(
      'order_assignments_give_up_explained',
      sql`(${t.status} = 'given_up') = (${t.givenUpAt} is not null and ${t.giveUpReason} in (${inList(ASSIGNMENT_GIVE_UP_REASONS)}))
        and (${t.status} = 'given_up' or (${t.givenUpAt} is null and ${t.giveUpReason} is null and ${t.giveUpNote} is null))`,
    ),
    check(
      'order_assignments_give_up_note_length',
      sql`${t.giveUpNote} is null or char_length(${t.giveUpNote}) <= 300`,
    ),
    check('order_assignments_expiry_after_offer', sql`${t.expiresAt} > ${t.offeredAt}`),
    check(
      'order_assignments_decline_reason',
      sql`${t.status} <> 'declined' or (${t.declineReason} is not null and length(${t.declineReason}) > 0)`,
    ),
    uniqueIndex('order_assignments_one_active_uq')
      .on(t.orderId)
      .where(sql`${t.status} in ('offered','accepted')`),
    index('order_assignments_expiring_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'offered'`),
    index().on(t.shopId, t.status),
    index().on(t.offeredBy),
    // Admin analytics (0050): shop acceptance over offers made in a date range.
    index('order_assignments_offered_at_idx').on(t.offeredAt),
  ],
);

/** Append-only timeline (update/delete blocked by trigger in migration 0002). */
export const orderEvents = pgTable(
  'order_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    fromStatus: text(),
    toStatus: text().notNull(),
    actorType: text().notNull(),
    actorId: uuid(),
    visibleToCustomer: boolean().notNull().default(true),
    payload: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'order_events_actor_valid',
      sql`${t.actorType} in ('customer','shop','workshop','admin','system','delivery_agent')`,
    ),
    index().on(t.orderId, t.id),
  ],
);

/** Stock held for an order between placement and shop acceptance / payment (TTL release job). */
export const reservations = pgTable(
  'reservations',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    inventoryId: uuid()
      .notNull()
      .references(() => shopInventory.id, { onDelete: 'restrict' }),
    qty: integer().notNull(),
    status: text().notNull().default('active'),
    expiresAt: ts().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('reservations_qty_positive', sql`${t.qty} > 0`),
    check('reservations_status_valid', sql`${t.status} in ('active','committed','released','expired')`),
    check('reservations_expiry_after_create', sql`${t.expiresAt} > ${t.createdAt}`),
    index('reservations_active_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active'`),
    index().on(t.orderId),
    index().on(t.inventoryId),
  ],
);

export const shipments = pgTable(
  'shipments',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    mode: text().notNull(),
    courier: text(),
    awb: text(),
    status: text().notNull().default('created'),
    proofPath: text(),
    /**
     * Proof of delivery (decision 2026-11-01): 4-digit code shown to the customer, stored encrypted
     * (`'shipments.delivery_code_enc'`) so the customer can see it again; 5 wrong tries lock it.
     */
    deliveryCodeEnc: text(),
    deliveryCodeAttempts: integer().notNull().default(0),
    /** How delivery was confirmed: the customer's code, or an admin override with a reason. */
    deliveredVia: text(),
    deliveredAt: ts(),
    overrideReason: text(),
    overrideBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // `agent`: a MechDost delivery agent carries it (spec 24).
    check('shipments_mode_valid', sql`${t.mode} in ('own','courier','agent')`),
    check('shipments_delivery_code_encrypted', encryptedCheck(t.deliveryCodeEnc)),
    check('shipments_delivery_attempts_range', sql`${t.deliveryCodeAttempts} between 0 and 5`),
    check(
      'shipments_delivered_via_valid',
      sql`${t.deliveredVia} is null or ${t.deliveredVia} in ('code','override')`,
    ),
    check(
      'shipments_delivered_needs_proof',
      sql`${t.status} <> 'delivered' or (${t.deliveredAt} is not null and (${t.deliveredVia} = 'code' or (${t.deliveredVia} = 'override' and ${t.overrideBy} is not null and coalesce(char_length(${t.overrideReason}), 0) >= 5)))`,
    ),
    index().on(t.overrideBy),
    check(
      'shipments_courier_awb',
      sql`${t.mode} in ('own','agent') or (${t.courier} is not null and ${t.awb} is not null)`,
    ),
    unique().on(t.courier, t.awb),
    index().on(t.orderId),
  ],
);

/** One row per Razorpay order (a failed attempt needs a new Razorpay order). Status is monotonic. */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    /** The checkout this pays (purpose `order`); null for a service bill (migration 0068). */
    groupId: uuid().references(() => orderGroups.id, { onDelete: 'restrict' }),
    /** What the Razorpay order is for: a product checkout, or the bill of a workshop service request. */
    purpose: text().notNull().default('order'),
    billId: uuid().references(() => serviceBills.id, { onDelete: 'restrict' }),
    /** The roadside request an advance or balance pays (purposes `rsa_advance`, `rsa_balance`; migration 0082). */
    rsaRequestId: uuid().references(() => rsaRequests.id, { onDelete: 'restrict' }),
    provider: text().notNull().default('razorpay'),
    providerOrderId: text().notNull().unique(),
    providerPaymentId: text().unique(),
    amountPaise: paise().notNull(),
    currency: text().notNull().default('INR'),
    status: text().notNull().default('created'),
    method: text(),
    capturedAt: ts(),
    /**
     * Refund ledger (spec 05, 2026-11-15): money held by refunds that are requested, approved, initiated or processed,
     * and the part Razorpay confirmed. Changed only by conditional UPDATEs under this row's lock, so the CHECK below
     * means "refunds can never exceed what was captured" whatever the concurrency.
     */
    refundReservedPaise: paise().notNull().default(0),
    refundedPaise: paise().notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('payments_status_valid', sql`${t.status} in (${inList(PAYMENT_STATES)})`),
    check(
      'payments_refund_ledger',
      sql`${t.refundedPaise} >= 0 and ${t.refundedPaise} <= ${t.refundReservedPaise} and ${t.refundReservedPaise} <= ${t.amountPaise}`,
    ),
    check('payments_amount_positive', sql`${t.amountPaise} > 0`),
    check('payments_currency_inr', sql`${t.currency} = 'INR'`),
    check('payments_provider_valid', sql`${t.provider} in ('razorpay')`),
    check(
      'payments_purpose_valid',
      sql`${t.purpose} in ('order','service_bill','rsa_advance','rsa_balance')`,
    ),
    check(
      'payments_purpose_target',
      sql`(${t.purpose} = 'order' and ${t.groupId} is not null and ${t.billId} is null and ${t.rsaRequestId} is null) or (${t.purpose} = 'service_bill' and ${t.billId} is not null and ${t.groupId} is null and ${t.rsaRequestId} is null) or (${t.purpose} in ('rsa_advance','rsa_balance') and ${t.rsaRequestId} is not null and ${t.groupId} is null and ${t.billId} is null)`,
    ),
    // One captured payment per bill, and one Razorpay order a customer can still pay: a double-click never makes two.
    uniqueIndex('payments_one_success_per_bill_uq')
      .on(t.billId)
      .where(sql`${t.status} in ('paid','partially_refunded','refunded')`),
    uniqueIndex('payments_one_open_per_bill_uq')
      .on(t.billId)
      .where(sql`${t.status} in ('created','attempted','failed')`),
    index().on(t.billId),
    // Roadside: one captured and one open payment per request and purpose (advance, balance).
    uniqueIndex('payments_one_success_per_rsa_uq')
      .on(t.rsaRequestId, t.purpose)
      .where(sql`${t.status} in ('paid','partially_refunded','refunded') and ${t.rsaRequestId} is not null`),
    uniqueIndex('payments_one_open_per_rsa_uq')
      .on(t.rsaRequestId, t.purpose)
      .where(sql`${t.status} in ('created','attempted','failed') and ${t.rsaRequestId} is not null`),
    index().on(t.rsaRequestId),
    uniqueIndex('payments_one_success_per_group_uq')
      .on(t.groupId)
      .where(sql`${t.status} in ('paid','partially_refunded','refunded')`),
    // One Razorpay order a customer can still pay per group: two overlapping place calls never create two
    // (final review 2026-11-12, finding 2).
    uniqueIndex('payments_one_open_per_group_uq')
      .on(t.groupId)
      .where(sql`${t.status} in ('created','attempted','failed')`),
    index().on(t.groupId),
  ],
);

/**
 * Refund requests (spec 05; decision 2026-11-15 "All need approval"). Status follows `refundMachine` as a conditional
 * UPDATE on (id, status, version); the amount is held on `payments.refund_reserved_paise` (see there). A request made
 * by a staff member can be approved only by someone else (CHECK). `provider_refund_id` is Razorpay's refund id;
 * `idem_key` doubles as the `X-Refund-Idempotency` header, so a retried call never refunds twice.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    /** The captured Razorpay payment (mode `source`); null for cash-on-delivery orders paid out by hand (`bank_upi`). */
    paymentId: uuid().references(() => payments.id, { onDelete: 'restrict' }),
    /** The checkout the refund belongs to (city scope, customer); set for both modes. */
    groupId: uuid().references(() => orderGroups.id, { onDelete: 'restrict' }),
    /** The service bill a refund belongs to (a cancelled or double-paid workshop bill); then `group_id` and `order_id` are null. */
    billId: uuid().references(() => serviceBills.id, { onDelete: 'restrict' }),
    /** The roadside request a refund belongs to (admin cancel, total below the advance, a late capture); migration 0082. */
    rsaRequestId: uuid().references(() => rsaRequests.id, { onDelete: 'restrict' }),
    orderId: uuid().references(() => orders.id, { onDelete: 'restrict' }),
    amountPaise: paise().notNull(),
    /** `source` = back to the original payment method through Razorpay; `bank_upi` = finance pays by hand (COD). */
    mode: text().notNull().default('source'),
    /** Bank account / UPI id for `bank_upi` refunds (COD orders), encrypted (`'refunds.destination_enc'`). */
    destinationEnc: text(),
    idemKey: text().notNull().unique(),
    providerRefundId: text().unique(),
    status: text().notNull().default('requested'),
    source: text().notNull(),
    reasonCode: text().notNull(),
    /** Optional free-text note (the column was the old required `reason`, never written before 2026-11-15). */
    note: text('reason'),
    /** Null when the system asked (an order was rejected or cancelled). */
    requestedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    rejectedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    rejectReasonCode: text(),
    decidedAt: ts(),
    initiatedAt: ts(),
    /** When it became `processed` or `failed`. */
    settledAt: ts(),
    failureCode: text(),
    /** UTR / bank reference finance typed when it paid a `bank_upi` refund by hand. */
    manualReference: text(),
    /** The amount Razorpay reported when it differed from ours (status `needs_reconciliation`). */
    providerReportedPaise: paise(),
    /** Finance settled an unsure refund by hand: who, why (code) and the required note (spec 05 "Settling by hand"). */
    settledBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    settleReasonCode: text(),
    settleNote: text(),
    /** Calls to Razorpay so far, and when the worker may try again (backoff). */
    dispatchAttempts: integer().notNull().default(0),
    nextAttemptAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('refunds_amount_positive', sql`${t.amountPaise} > 0`),
    check('refunds_one_target', sql`num_nonnulls(${t.groupId}, ${t.billId}, ${t.rsaRequestId}) = 1`),
    index().on(t.billId),
    index().on(t.rsaRequestId),
    check('refunds_source_valid', sql`${t.source} in (${inList(REFUND_SOURCES)})`),
    check('refunds_reason_valid', sql`${t.reasonCode} in (${inList(REFUND_REASONS)})`),
    check(
      'refunds_reject_reason_valid',
      sql`(${t.status} = 'rejected') = (${t.rejectReasonCode} is not null) and (${t.rejectReasonCode} is null or ${t.rejectReasonCode} in (${inList(REFUND_REJECT_REASONS)}))`,
    ),
    check('refunds_note_len', sql`${t.note} is null or char_length(${t.note}) between 1 and 300`),
    // Four-eyes: whoever asked for a refund cannot approve it.
    check(
      'refunds_four_eyes',
      sql`${t.approvedBy} is null or ${t.requestedBy} is null or ${t.approvedBy} <> ${t.requestedBy}`,
    ),
    // The money only moves after an approval, and a Razorpay id exists once it is on its way.
    check(
      'refunds_approved_before_dispatch',
      sql`${t.status} not in ('approved','initiated','processed') or ${t.decidedAt} is not null`,
    ),
    check(
      'refunds_provider_id_when_sent',
      sql`${t.mode} <> 'source' or ${t.status} not in ('initiated','processed') or ${t.providerRefundId} is not null`,
    ),
    // A Razorpay refund hangs on a captured payment; a manual payout has none and carries the UTR once paid.
    check('refunds_mode_payment', sql`(${t.mode} = 'source') = (${t.paymentId} is not null)`),
    check(
      'refunds_manual_paid_has_reference',
      sql`${t.mode} = 'source' or ${t.status} <> 'processed' or ${t.manualReference} ~ '^[A-Za-z0-9]{6,35}$'`,
    ),
    check(
      'refunds_manual_never_initiated',
      sql`${t.mode} = 'source' or ${t.status} not in ('initiated','needs_reconciliation')`,
    ),
    check(
      'refunds_reported_positive',
      sql`${t.providerReportedPaise} is null or ${t.providerReportedPaise} > 0`,
    ),
    check(
      'refunds_settled_when_final',
      sql`(${t.status} in ('processed','failed')) = (${t.settledAt} is not null)`,
    ),
    check('refunds_attempts_nonneg', sql`${t.dispatchAttempts} >= 0`),
    check(
      'refunds_settle_valid',
      sql`(${t.settleReasonCode} is null and ${t.settleNote} is null) or (${t.settleReasonCode} in (${inList(REFUND_SETTLE_REASONS)}) and char_length(${t.settleNote}) between 10 and 300)`,
    ),
    // Four-eyes also when settling by hand: whoever asked for the refund cannot settle it.
    check(
      'refunds_settle_four_eyes',
      sql`${t.settledBy} is null or ${t.requestedBy} is null or ${t.settledBy} <> ${t.requestedBy}`,
    ),
    index().on(t.settledBy),
    // No wallet (decision 2026-11-01): money goes back to the original method, or bank/UPI for COD orders.
    check('refunds_mode_valid', sql`${t.mode} in ('source','bank_upi')`),
    check('refunds_destination_encrypted', encryptedCheck(t.destinationEnc)),
    check(
      'refunds_bank_upi_needs_destination',
      sql`${t.mode} <> 'bank_upi' or ${t.destinationEnc} is not null`,
    ),
    check('refunds_status_valid', sql`${t.status} in (${inList(REFUND_STATES)})`),
    check('refunds_idem_key_format', sql`${t.idemKey} ~ '^[A-Za-z0-9_-]{10,64}$'`),
    index().on(t.paymentId),
    index().on(t.orderId),
    index().on(t.requestedBy),
    index().on(t.approvedBy),
    index().on(t.rejectedBy),
    index().on(t.groupId),
    // The finance queue: oldest waiting first, by status.
    index().on(t.status, t.createdAt),
    // CSV exports (design 2026-11-15): refunds in an IST window, keyset-paged on (created_at, id).
    index('refunds_created_id_idx').on(t.createdAt, t.id),
    // The worker's retry sweep touches only approved refunds that are due.
    index('refunds_dispatch_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'approved' and ${t.mode} = 'source'`),
  ],
);

/**
 * Append-only refund timeline (requested, approved, rejected, initiated, processed, failed, dispatch retries). The
 * per-entity event log beside `audit_log` (spec 14 rule 9).
 */
export const refundEvents = pgTable(
  'refund_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    refundId: uuid()
      .notNull()
      .references(() => refunds.id, { onDelete: 'restrict' }),
    kind: text().notNull(),
    fromStatus: text(),
    toStatus: text().notNull(),
    actorType: text().notNull(),
    actorId: uuid(),
    payload: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'refund_events_kind_valid',
      sql`${t.kind} in ('requested','approved','rejected','initiated','processed','failed','retry','needs_reconciliation')`,
    ),
    check('refund_events_actor_valid', sql`${t.actorType} in ('admin','system')`),
    index().on(t.refundId, t.id),
  ],
);

/** Gapless counters for GST invoice series (CGST Rule 46). Row lock serialises allocation. */
export const invoiceCounters = pgTable(
  'invoice_counters',
  {
    series: text().notNull(),
    fy: text().notNull(),
    last: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.series, t.fy] }),
    check('invoice_counters_last_nonneg', sql`${t.last} >= 0`),
    check('invoice_counters_fy_format', sql`${t.fy} ~ '^[0-9]{4}$'`),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    kind: text().notNull(),
    series: text().notNull(),
    fy: text().notNull(),
    seq: integer().notNull(),
    number: text().notNull().unique(),
    orderId: uuid().references(() => orders.id, { onDelete: 'restrict' }),
    serviceRequestId: uuid(),
    /** A credit note points at the tax invoice it reduces. */
    creditNoteFor: uuid().references((): AnyPgColumn => invoices.id, { onDelete: 'restrict' }),
    /** The refund a credit note was issued for (one credit note per refund, by a unique index). */
    refundId: uuid().references(() => refunds.id, { onDelete: 'restrict' }),
    status: text().notNull().default('issued'),
    taxablePaise: paise().notNull(),
    cgstPaise: paise().notNull().default(0),
    sgstPaise: paise().notNull().default(0),
    igstPaise: paise().notNull().default(0),
    roundOffPaise: integer().notNull().default(0),
    totalPaise: paise().notNull(),
    pdfPath: text(),
    issuedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.series, t.fy, t.seq),
    check('invoices_kind_valid', sql`${t.kind} in ('tax_invoice','credit_note','service_bill')`),
    check('invoices_status_valid', sql`${t.status} in ('issued','cancelled')`),
    check('invoices_number_rule46', sql`length(${t.number}) <= 16 and ${t.number} ~ '^[A-Z0-9][A-Z0-9/-]*$'`),
    check('invoices_seq_positive', sql`${t.seq} > 0`),
    // A credit note always reduces one invoice; only a credit note can carry a refund.
    check('invoices_credit_note_link', sql`(${t.kind} = 'credit_note') = (${t.creditNoteFor} is not null)`),
    check('invoices_refund_only_credit_note', sql`${t.refundId} is null or ${t.kind} = 'credit_note'`),
    uniqueIndex('invoices_one_credit_note_per_refund_uq')
      .on(t.refundId)
      .where(sql`${t.refundId} is not null`),
    index().on(t.creditNoteFor),
    check('invoices_round_off_range', sql`${t.roundOffPaise} between -50 and 50`),
    index().on(t.orderId),
    index().on(t.serviceRequestId),
  ],
);

/**
 * Coupons (spec 03, design 2026-11-15 catalogue/storefront next tier). Only admin creates and configures them
 * (`coupons:write`). Each says who funds it: MechDost (the shop is paid in full) or one shop (its payout is lower, and
 * it must have accepted the offer in its portal first: `coupon_shop_terms`). `used_count` and the per-user counter
 * only move by conditional UPDATEs (never oversold); `first_order_only` implies one use per customer.
 */
export const coupons = pgTable(
  'coupons',
  {
    id: id(),
    code: citext().notNull().unique(),
    /** What the customer reads before applying: a short name and the conditions (en + hi, hard rule 10). */
    title: text().notNull().default(''),
    titleHi: text(),
    terms: text(),
    termsHi: text(),
    kind: text().notNull(),
    value: integer().notNull(),
    minSubtotalPaise: paise().notNull().default(0),
    maxDiscountPaise: paise(),
    startsAt: ts().notNull(),
    endsAt: ts(),
    usageLimitTotal: integer(),
    usageLimitPerUser: integer().notNull().default(1),
    usedCount: integer().notNull().default(0),
    firstOrderOnly: boolean().notNull().default(false),
    cityId: uuid().references(() => cities.id, { onDelete: 'cascade' }),
    funder: text().notNull().default('mechdost'),
    /** The funding shop (shop-funded only). */
    shopId: uuid().references(() => shops.id, { onDelete: 'restrict' }),
    /** Listed on the public offers page (admin chooses; 2026-11-16). Never lists usage numbers or an automatic offer's code. */
    isPublic: boolean().notNull().default(false),
    /** Applied at checkout with no code (2026-11-16): the best automatic offer competes with a typed code. MechDost-funded only. */
    autoApply: boolean().notNull().default(false),
    /** Category offer: only the lines of this category count (minimum order, percent, shares). */
    categoryId: uuid().references(() => categories.id, { onDelete: 'restrict' }),
    /** Paused by admin (history in the audit log); the code then answers "paused". */
    active: boolean().notNull().default(true),
    pausedReason: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /**
     * Counts admin edits and pauses only: the admin screens compare-and-set on this, because `version` also moves with
     * every redemption (the usage counter), which would make a busy coupon impossible to edit.
     */
    configVersion: integer().notNull().default(1),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('coupons_kind_valid', sql`${t.kind} in ('percent','flat','free_shipping')`),
    check('coupons_funder_valid', sql`${t.funder} in ('mechdost','shop')`),
    check('coupons_funder_shop', sql`(${t.funder} = 'shop') = (${t.shopId} is not null)`),
    // A shop cannot fund a delivery charge it does not control; free delivery is MechDost's offer.
    check('coupons_shop_not_free_delivery', sql`${t.funder} = 'mechdost' or ${t.kind} <> 'free_shipping'`),
    check('coupons_code_format', sql`${t.code} ~ '^[A-Za-z0-9]{4,20}$'`),
    check(
      'coupons_value_range',
      sql`case ${t.kind} when 'percent' then ${t.value} between 1 and 90 when 'flat' then ${t.value} between 1 and 10000000 else ${t.value} = 0 end`,
    ),
    check(
      'coupons_cap_percent_only',
      sql`${t.maxDiscountPaise} is null or (${t.kind} = 'percent' and ${t.maxDiscountPaise} > 0)`,
    ),
    check('coupons_min_nonneg', sql`${t.minSubtotalPaise} >= 0`),
    check('coupons_window', sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
    check(
      'coupons_usage_within_limit',
      sql`${t.usedCount} >= 0 and (${t.usageLimitTotal} is null or (${t.usageLimitTotal} >= 1 and ${t.usedCount} <= ${t.usageLimitTotal}))`,
    ),
    check('coupons_per_user_range', sql`${t.usageLimitPerUser} between 1 and 100`),
    check('coupons_first_order_once', sql`not ${t.firstOrderOnly} or ${t.usageLimitPerUser} = 1`),
    check('coupons_paused_reason', sql`${t.active} or char_length(${t.pausedReason}) between 3 and 300`),
    // 2026-11-16: an automatic offer is funded by MechDost (a shop would have to accept terms nobody shows it); a category
    // offer takes a percent or flat amount off lines, free delivery has no lines.
    check('coupons_auto_mechdost', sql`not ${t.autoApply} or ${t.funder} = 'mechdost'`),
    check('coupons_category_not_delivery', sql`${t.categoryId} is null or ${t.kind} <> 'free_shipping'`),
    index().on(t.cityId),
    index().on(t.categoryId),
    // The public offers page and the checkout's automatic offers read live rows of these two kinds only.
    index('coupons_public_live_idx')
      .on(t.cityId, t.startsAt)
      .where(sql`${t.active} and (${t.isPublic} or ${t.autoApply})`),
    index().on(t.shopId),
    index().on(t.createdBy),
    index().on(t.active, t.startsAt),
  ],
);

/**
 * A shop's acceptance of the terms of a coupon that it funds (one row per shop-funded coupon). The coupon cannot be
 * redeemed until `status = 'accepted'`; changing the money terms puts it back to `pending`. `terms` is the snapshot
 * of what the shop saw and accepted (kind, value, cap, minimum, window, limits).
 */
export const couponShopTerms = pgTable(
  'coupon_shop_terms',
  {
    id: id(),
    couponId: uuid()
      .notNull()
      .unique()
      .references(() => coupons.id, { onDelete: 'restrict' }),
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    status: text().notNull().default('pending'),
    terms: jsonb().notNull(),
    decidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('coupon_shop_terms_status_valid', sql`${t.status} in ('pending','accepted','declined')`),
    check(
      'coupon_shop_terms_decided',
      sql`(${t.status} = 'pending') = (${t.decidedAt} is null) and (${t.status} = 'pending') = (${t.decidedBy} is null)`,
    ),
    index().on(t.shopId, t.status),
    index().on(t.decidedBy),
  ],
);

/** How often one customer has used a coupon. Moves only by a conditional upsert; a trigger repeats the limit. */
export const couponUserUsage = pgTable(
  'coupon_user_usage',
  {
    couponId: uuid()
      .notNull()
      .references(() => coupons.id, { onDelete: 'restrict' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    uses: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.couponId, t.userId] }),
    check('coupon_user_usage_nonneg', sql`${t.uses} >= 0`),
    index().on(t.userId),
  ],
);

export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: id(),
    couponId: uuid()
      .notNull()
      .references(() => coupons.id, { onDelete: 'restrict' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    groupId: uuid()
      .notNull()
      .references(() => orderGroups.id, { onDelete: 'restrict' }),
    discountPaise: paise().notNull(),
    funder: text().notNull().default('mechdost'),
    /** Set when the order was cancelled or rejected in full: the use went back to the coupon and the customer. */
    releasedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.couponId, t.groupId),
    check('coupon_redemptions_discount_nonneg', sql`${t.discountPaise} >= 0`),
    check('coupon_redemptions_funder_valid', sql`${t.funder} in ('mechdost','shop')`),
    index().on(t.userId, t.couponId),
    index().on(t.groupId),
    // Usage reports and the export page one coupon's uses by time (2026-11-16).
    index('coupon_redemptions_coupon_created_idx').on(t.couponId, t.createdAt, t.id),
  ],
);
