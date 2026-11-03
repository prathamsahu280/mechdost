import { sql } from 'drizzle-orm';
import {
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
  ASSIGNMENT_STATES,
  ORDER_CANCEL_REASONS,
  ORDER_REJECT_REASONS,
  ORDER_STATES,
  PAYMENT_STATES,
} from '@mechdost/shared/state';
import { citext, createdAt, encryptedCheck, id, paise, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { users } from './identity';
import { productVariants, shopInventory, shops } from './catalogue';

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
    couponId: uuid(),
    gstin: text(),
    businessName: text(),
    note: text(),
    idempotencyKey: text().notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('order_groups_idempotency_uq').on(t.userId, t.idempotencyKey),
    check('order_groups_code_format', sql`${t.code} ~ '^MD-[A-Z]{3}-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$'`),
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
    check(
      'order_groups_total_consistent',
      sql`${t.totalPaise} = ${t.subtotalPaise} - ${t.discountPaise} + ${t.shippingPaise} + ${t.codFeePaise}`,
    ),
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
    cancellableUntilStatus: text().notNull().default('confirmed'),
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
    check(
      'orders_reason_code_valid',
      sql`${t.statusReasonCode} is null or ${t.statusReasonCode} in (${inList([...ORDER_REJECT_REASONS, ...ORDER_CANCEL_REASONS])})`,
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
    // What the delivering shop collects is exactly the sum of its parts (the group total = sum of sub-orders).
    check(
      'orders_total_matches',
      sql`${t.totalPaise} = ${t.subtotalPaise} - ${t.discountPaise} + ${t.shippingPaise} + ${t.codFeePaise}`,
    ),
    check(
      'orders_shop_when_confirmed',
      sql`${t.status} in ('placed','awaiting_shop','needs_rerouting','cancelled','rejected') or ${t.shopId} is not null`,
    ),
    index().on(t.status, t.cityId, t.placedAt),
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
    title: text().notNull(),
    sku: text().notNull(),
    hsn: text().notNull(),
    gstRateBp: integer().notNull(),
    unitPaise: paise().notNull(),
    qty: integer().notNull(),
    lineDiscountPaise: paise().notNull().default(0),
    taxablePaise: paise().notNull(),
    cgstPaise: paise().notNull().default(0),
    sgstPaise: paise().notNull().default(0),
    igstPaise: paise().notNull().default(0),
    totalPaise: paise().notNull(),
    recoSource: text(),
  },
  (t) => [
    check('order_items_qty_positive', sql`${t.qty} > 0 and ${t.qty} <= 99`),
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
    version: version(),
  },
  (t) => [
    check('order_assignments_status_valid', sql`${t.status} in (${inList(ASSIGNMENT_STATES)})`),
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
    check('order_events_actor_valid', sql`${t.actorType} in ('customer','shop','workshop','admin','system')`),
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
    check('shipments_mode_valid', sql`${t.mode} in ('own','courier')`),
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
      sql`${t.mode} = 'own' or (${t.courier} is not null and ${t.awb} is not null)`,
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
    groupId: uuid()
      .notNull()
      .references(() => orderGroups.id, { onDelete: 'restrict' }),
    provider: text().notNull().default('razorpay'),
    providerOrderId: text().notNull().unique(),
    providerPaymentId: text().unique(),
    amountPaise: paise().notNull(),
    currency: text().notNull().default('INR'),
    status: text().notNull().default('created'),
    method: text(),
    capturedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('payments_status_valid', sql`${t.status} in (${inList(PAYMENT_STATES)})`),
    check('payments_amount_positive', sql`${t.amountPaise} > 0`),
    check('payments_currency_inr', sql`${t.currency} = 'INR'`),
    check('payments_provider_valid', sql`${t.provider} in ('razorpay')`),
    uniqueIndex('payments_one_success_per_group_uq')
      .on(t.groupId)
      .where(sql`${t.status} in ('paid','partially_refunded','refunded')`),
    index().on(t.groupId),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    orderId: uuid().references(() => orders.id, { onDelete: 'restrict' }),
    amountPaise: paise().notNull(),
    mode: text().notNull().default('source'),
    /** Bank account / UPI id for `bank_upi` refunds (COD orders), encrypted (`'refunds.destination_enc'`). */
    destinationEnc: text(),
    idemKey: text().notNull().unique(),
    providerRefundId: text().unique(),
    status: text().notNull().default('pending'),
    reason: text().notNull(),
    requestedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('refunds_amount_positive', sql`${t.amountPaise} > 0`),
    // No wallet (decision 2026-11-01): money goes back to the original method, or bank/UPI for COD orders.
    check('refunds_mode_valid', sql`${t.mode} in ('source','bank_upi')`),
    check('refunds_destination_encrypted', encryptedCheck(t.destinationEnc)),
    check(
      'refunds_bank_upi_needs_destination',
      sql`${t.mode} <> 'bank_upi' or ${t.destinationEnc} is not null`,
    ),
    check('refunds_status_valid', sql`${t.status} in ('pending','initiated','processed','failed')`),
    check('refunds_idem_key_format', sql`${t.idemKey} ~ '^[A-Za-z0-9_-]{10,64}$'`),
    index().on(t.paymentId),
    index().on(t.orderId),
    index().on(t.requestedBy),
    index().on(t.approvedBy),
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
    creditNoteFor: uuid(),
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
    check('invoices_round_off_range', sql`${t.roundOffPaise} between -50 and 50`),
    index().on(t.orderId),
    index().on(t.serviceRequestId),
  ],
);

export const coupons = pgTable(
  'coupons',
  {
    id: id(),
    code: citext().notNull().unique(),
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
    active: boolean().notNull().default(true),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('coupons_kind_valid', sql`${t.kind} in ('percent','flat','free_shipping')`),
    check(
      'coupons_value_range',
      sql`(${t.kind} <> 'percent' or ${t.value} between 1 and 100) and ${t.value} >= 0`,
    ),
    check('coupons_window', sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
    check(
      'coupons_usage_within_limit',
      sql`${t.usedCount} >= 0 and (${t.usageLimitTotal} is null or ${t.usedCount} <= ${t.usageLimitTotal})`,
    ),
    index().on(t.cityId),
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
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.couponId, t.groupId),
    check('coupon_redemptions_discount_nonneg', sql`${t.discountPaise} >= 0`),
    index().on(t.userId, t.couponId),
    index().on(t.groupId),
  ],
);
