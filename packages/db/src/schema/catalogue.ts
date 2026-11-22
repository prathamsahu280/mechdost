import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { GST_STATUSES } from '@mechdost/shared/partners';
import { NET_UNITS } from '@mechdost/shared/product-attributes';
import { INVITE_STATES, PRICE_REQUEST_STATES } from '@mechdost/shared/state';
import {
  createdAt,
  encryptedCheck,
  geographyPoint,
  id,
  paise,
  ts,
  tsvector,
  updatedAt,
  version,
} from './_common';
import { cities, pincodes, states } from './geography';
import { users, vehicleVariants } from './identity';

/** docs/specs/02-catalogue-search.md */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

export const categories = pgTable(
  'categories',
  {
    id: id(),
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: 'restrict' }),
    slug: text().notNull().unique(),
    name: text().notNull(),
    nameHi: text(),
    description: text(),
    descriptionHi: text(),
    icon: text(),
    sort: integer().notNull().default(0),
    hidden: boolean().notNull().default(false),
    archivedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.parentId)],
);

export const brands = pgTable(
  'brands',
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    origin: text().notNull().default('aftermarket'),
    logoPath: text(),
    featured: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('brands_origin_valid', sql`${t.origin} in ('oem','oes','aftermarket')`)],
);

export const shops = pgTable(
  'shops',
  {
    id: id(),
    name: text().notNull(),
    /** Hindi (transliterated) business name for /hi pages; null = show `name` and flag it in admin (rule 10). */
    nameHi: text(),
    legalName: text(),
    gstin: text(),
    /** PAN, AES-256-GCM encrypted (`encryptField(…, 'shops.pan_enc')`); lookups use `panIndex`. */
    panEnc: text(),
    /** Blind index of the normalised PAN (`blindIndex(…, 'pan')`): one shop per PAN without decrypting. */
    panIndex: text().unique(),
    phone: text().notNull(),
    email: text(),
    addressLine: text().notNull(),
    addressLineHi: text(),
    pincode: text()
      .notNull()
      .references(() => pincodes.pincode, { onDelete: 'restrict' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    stateId: uuid()
      .notNull()
      .references(() => states.id, { onDelete: 'restrict' }),
    location: geographyPoint(),
    /**
     * `registered` (GSTIN) or `enrolled` (GST enrolment number, Notification 34/2023-CT). Enrolled shops are never
     * priced or routed until bills of supply exist (design 2026-11-13).
     */
    gstStatus: text().notNull().default('registered'),
    /** Standing, set by staff only (decision 2026-11-01): pending → approved ↔ paused → suspended. */
    status: text().notNull().default('pending'),
    /** Partner-visible reason for the current paused/suspended standing, who set it and when it ends. */
    statusReason: text(),
    statusChangedBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
    statusChangedAt: ts(),
    pausedUntil: ts(),
    /** Availability, set by the shop itself (busy / holiday) — separate from staff standing. */
    busy: boolean().notNull().default(false),
    busyUntil: ts(),
    acceptanceTimeoutMin: integer(),
    /**
     * Free delivery from this order value for this shop's orders (paise). NULL = the city setting
     * `checkout.free_delivery_min_paise`; 0 = always free. A PIN override wins over it (spec 03 delivery chain).
     */
    freeDeliveryMinPaise: paise(),
    /**
     * Working hours `{open, close, days}` (IST, 0 = Sunday; `@mechdost/shared/shop-hours`), set by the owner or
     * staff. Routing suggests open shops first; an offer to a closed shop waits until it opens + the grace setting.
     */
    hours: jsonb()
      .notNull()
      .default(sql`'{"open":"09:00","close":"21:00","days":[1,2,3,4,5,6]}'::jsonb`),
    ratingAvg: numeric({ precision: 3, scale: 2 }),
    ratingCount: integer().notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('shops_status_valid', sql`${t.status} in ('pending','approved','paused','suspended')`),
    check('shops_gst_status_valid', sql`${t.gstStatus} in (${inList(GST_STATUSES)})`),
    check(
      'shops_standing_has_reason',
      sql`${t.status} not in ('paused','suspended') or (coalesce(char_length(${t.statusReason}), 0) >= 5 and ${t.statusChangedBy} is not null)`,
    ),
    check(
      'shops_gstin_format',
      sql`${t.gstin} is null or ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check('shops_timeout_positive', sql`${t.acceptanceTimeoutMin} is null or ${t.acceptanceTimeoutMin} > 0`),
    check('shops_hours_object', sql`jsonb_typeof(${t.hours}) = 'object'`),
    check(
      'shops_free_delivery_nonneg',
      sql`${t.freeDeliveryMinPaise} is null or ${t.freeDeliveryMinPaise} >= 0`,
    ),
    check('shops_pan_encrypted', encryptedCheck(t.panEnc)),
    index().on(t.cityId, t.status),
    index().on(t.pincode),
    index().on(t.stateId),
    index().on(t.statusChangedBy),
  ],
);

export const shopUsers = pgTable(
  'shop_users',
  {
    id: id(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text().notNull().default('staff'),
    permissions: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.shopId, t.userId),
    check('shop_users_role_valid', sql`${t.role} in ('owner','staff')`),
    index().on(t.userId),
  ],
);

/**
 * An owner's invite for a helper to join the shop (design 2026-11-15, spec 07): bound to the invitee's phone (their
 * OTP at sign-in is the proof, as for seller applicants), single use, expires. Claimed in `repo/shop-staff.ts`,
 * which grants `seller_staff` and writes the `shop_users` membership in the same transaction.
 */
export const shopStaffInvites = pgTable(
  'shop_staff_invites',
  {
    id: id(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    phone: text().notNull(),
    status: text().notNull().default('sent'),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    usedBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('shop_staff_invites_status_valid', sql`${t.status} in (${inList(INVITE_STATES)})`),
    check('shop_staff_invites_phone', sql`${t.phone} ~ '^\\+91[6-9][0-9]{9}$'`),
    check('shop_staff_invites_name', sql`char_length(${t.name}) between 2 and 60`),
    check(
      'shop_staff_invites_used_has_user',
      sql`${t.status} <> 'used' or (${t.usedAt} is not null and ${t.usedBy} is not null)`,
    ),
    // One open invite per person per shop (a second one for the same number is refused, not queued).
    uniqueIndex('shop_staff_invites_one_open_uq')
      .on(t.shopId, t.phone)
      .where(sql`${t.status} = 'sent'`),
    // The sign-in lookup: open invites for a phone.
    index('shop_staff_invites_open_phone_idx')
      .on(t.phone)
      .where(sql`${t.status} = 'sent'`),
    index().on(t.createdBy),
    index().on(t.usedBy),
  ],
);

export const shopPincodes = pgTable(
  'shop_pincodes',
  {
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    pincode: text()
      .notNull()
      .references(() => pincodes.pincode, { onDelete: 'restrict' }),
    shippingPaise: paise().notNull().default(0),
    leadDays: smallint().notNull().default(2),
    active: boolean().notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.shopId, t.pincode] }),
    check('shop_pincodes_shipping_nonneg', sql`${t.shippingPaise} >= 0`),
    check('shop_pincodes_lead_days', sql`${t.leadDays} between 0 and 60`),
    index().on(t.pincode),
  ],
);

export const products = pgTable(
  'products',
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    nameHi: text(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id, { onDelete: 'restrict' }),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    description: text(),
    descriptionHi: text(),
    /**
     * Customer-visible summary lines, English + Hindi side by side (decision 2026-11-02 "Localised content
     * columns", spec 02). Brand/model names, units and codes stay in Latin script inside the Hindi text.
     */
    specSummary: text(),
    specSummaryHi: text(),
    compatibility: text(),
    compatibilityHi: text(),
    highlights: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    highlightsHi: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    spec: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    hsn: text().notNull(),
    gstRateBp: integer().notNull(),
    countryOfOrigin: text().notNull().default('India'),
    warranty: text(),
    status: text().notNull().default('draft'),
    submittedByShopId: uuid().references(() => shops.id, { onDelete: 'set null' }),
    rejectionReason: text(),
    /**
     * Vehicle types the product is for (decision 2026-11-12, Q76 default): a type, never an exact-fit claim.
     * Empty = fitment not listed. Exact make/model/year rows live in `fitments` and take priority later.
     */
    vehicleTypes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Full-text search document (spec 02 "Search"), English and Hindi side by side so "battery" and "बैटरी"
     * match on either locale: English text through the `english` config (stemming), Hindi through `simple`.
     * Brand names and part numbers are matched separately (trigram on `brands.name`, exact `part_numbers`).
     */
    searchVector: tsvector().generatedAlwaysAs(
      sql`setweight(to_tsvector('english'::regconfig, coalesce("name", '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce("name_hi", '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce("spec_summary", '') || ' ' || coalesce("compatibility", '')), 'B') || setweight(to_tsvector('simple'::regconfig, coalesce("spec_summary_hi", '') || ' ' || coalesce("compatibility_hi", '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce("description", '')), 'C') || setweight(to_tsvector('simple'::regconfig, coalesce("description_hi", '')), 'C')`,
    ),
    /**
     * Upper-case letters and digits of the name, spec summary and compatibility with everything else removed
     * (migration 0080): "Activ 4T 20W-40 900 ml" → "ACTIV4T20W40900ML". The search matches viscosity grades, battery
     * capacities and tyre sizes against it however the customer spaced them (trigram index, spec 02 "Smart search").
     */
    searchCompact: text().generatedAlwaysAs(
      sql`regexp_replace(upper(coalesce("name", '') || ' ' || coalesce("spec_summary", '') || ' ' || coalesce("compatibility", '')), '[^A-Z0-9]', '', 'g')`,
    ),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('products_status_valid', sql`${t.status} in ('draft','submitted','live','rejected','archived')`),
    check('products_hsn_format', sql`${t.hsn} ~ '^[0-9]{4,8}$'`),
    check('products_gst_rate_range', sql`${t.gstRateBp} between 0 and 4000`),
    // Typed attributes per category live here (decision 2026-11-13); always a JSON object.
    check('products_spec_object', sql`jsonb_typeof(${t.spec}) = 'object'`),
    // At most 8 highlights; the Hindi list is empty (falls back to English) or matches the English one line by line.
    check('products_highlights_max', sql`coalesce(array_length(${t.highlights}, 1), 0) <= 8`),
    check(
      'products_highlights_hi_aligned',
      sql`coalesce(array_length(${t.highlightsHi}, 1), 0) in (0, coalesce(array_length(${t.highlights}, 1), 0))`,
    ),
    index().on(t.categoryId, t.status),
    index().on(t.brandId),
    index().on(t.submittedByShopId),
    index('products_search_vector_idx').using('gin', t.searchVector),
    check('products_vehicle_types_valid', sql`${t.vehicleTypes} <@ array['2W','3W','4W']::text[]`),
    index('products_vehicle_types_idx').using('gin', t.vehicleTypes),
    // Catalogue listing "newest first" with a stable keyset (spec 02, cursor pagination).
    index('products_live_newest_idx')
      .on(t.createdAt.desc(), t.id.desc())
      .where(sql`status = 'live'`),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: text().notNull().unique(),
    options: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    barcode: text(),
    mrpPaise: paise().notNull(),
    weightG: integer(),
    /**
     * Net quantity of the pack (design 2026-11-13 "Product comparison"): a whole number in a base unit
     * (`NET_UNITS`: ml, g, piece, m). Both or neither; the unit price is worked out from it.
     */
    netQty: integer(),
    netUnit: text(),
    status: text().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('product_variants_mrp_nonneg', sql`${t.mrpPaise} >= 0`),
    check('product_variants_status_valid', sql`${t.status} in ('active','archived')`),
    check('product_variants_net_pair', sql`(${t.netQty} is null) = (${t.netUnit} is null)`),
    check('product_variants_net_qty_range', sql`${t.netQty} between 1 and 1000000`),
    check('product_variants_net_unit_valid', sql`${t.netUnit} in (${inList(NET_UNITS)})`),
    index().on(t.productId),
    index().on(t.barcode),
  ],
);

export const partNumbers = pgTable(
  'part_numbers',
  {
    id: id(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    value: text().notNull(),
    normalised: text().notNull(), // upper-case alphanumerics only
  },
  (t) => [
    unique().on(t.kind, t.normalised, t.variantId),
    check('part_numbers_kind_valid', sql`${t.kind} in ('oe','mfr','xref')`),
    check('part_numbers_normalised_format', sql`${t.normalised} ~ '^[A-Z0-9]+$'`),
    index().on(t.normalised),
    index().on(t.variantId),
  ],
);

export const fitments = pgTable(
  'fitments',
  {
    id: id(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    vehicleVariantId: uuid()
      .notNull()
      .references(() => vehicleVariants.id, { onDelete: 'cascade' }),
    yearFrom: smallint(),
    yearTo: smallint(),
    notes: text(),
  },
  (t) => [
    unique().on(t.variantId, t.vehicleVariantId),
    check(
      'fitments_years',
      sql`${t.yearTo} is null or ${t.yearFrom} is null or ${t.yearTo} >= ${t.yearFrom}`,
    ),
    index().on(t.vehicleVariantId),
  ],
);

/**
 * A shop's offer for a variant. Stock invariant enforced by the database: on_hand - reserved >= 0.
 * Reservations use a conditional UPDATE (docs/research/data-integrity.md §3).
 */
export const shopInventory = pgTable(
  'shop_inventory',
  {
    id: id(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    sellingPaise: paise().notNull(),
    onHand: integer().notNull().default(0),
    reserved: integer().notNull().default(0),
    leadDays: smallint(),
    active: boolean().notNull().default(true),
    /** Staff refused this listing (a rejected price, design 2026-11-13): the shop cannot switch it back on. */
    adminBlocked: boolean().notNull().default(false),
    blockedReasonCode: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.shopId, t.variantId),
    check('shop_inventory_blocked_reason', sql`not ${t.adminBlocked} or ${t.blockedReasonCode} is not null`),
    check('shop_inventory_selling_positive', sql`${t.sellingPaise} > 0`),
    check('shop_inventory_on_hand_nonneg', sql`${t.onHand} >= 0`),
    check('shop_inventory_reserved_nonneg', sql`${t.reserved} >= 0`),
    check('shop_inventory_available_nonneg', sql`${t.onHand} - ${t.reserved} >= 0`),
    index().on(t.variantId, t.active),
  ],
);

/**
 * A shop's price for one product, approved or rejected by staff line by line (user 2026-11-13, approach 3):
 * onboarding prices, invited sellers' prices and later changes all go through here. Append-style history.
 */
export const shopPriceRequests = pgTable(
  'shop_price_requests',
  {
    id: id(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    requestedPaise: paise().notNull(),
    /** The approved price on sale when the request was made; null for a first price. */
    previousPaise: paise(),
    onHand: integer().notNull().default(0),
    status: text().notNull().default('pending'),
    reasonCode: text(),
    note: text(),
    requestedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    decidedBy: uuid().references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('shop_price_requests_status_valid', sql`${t.status} in (${inList(PRICE_REQUEST_STATES)})`),
    check('shop_price_requests_positive', sql`${t.requestedPaise} > 0`),
    check('shop_price_requests_on_hand_nonneg', sql`${t.onHand} >= 0`),
    uniqueIndex('shop_price_requests_one_pending_uq')
      .on(t.shopId, t.variantId)
      .where(sql`${t.status} = 'pending'`),
    index().on(t.status, t.createdAt),
    index().on(t.shopId, t.createdAt, t.id),
    index().on(t.variantId),
    index().on(t.requestedBy),
    index().on(t.decidedBy),
  ],
);

/**
 * Customer prices set by the admin (design `docs/superpowers/specs/2026-11-13-admin-catalogue-pin-prices-design.md`,
 * Q26): one city price per pack, plus optional per-PIN overrides. The shop keeps its own approved price in
 * `shop_inventory.selling_paise` (what it is paid); the difference is MechDost's margin (Q11). Rules (never above
 * MRP, never below what a shop is paid) are checked by the repository; the database keeps the shape.
 */
export const adminPrices = pgTable(
  'admin_prices',
  {
    id: id(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    /** Null = the city price; set = an override for this PIN (in the same city). */
    pincode: text().references(() => pincodes.pincode, { onDelete: 'restrict' }),
    sellingPaise: paise().notNull(),
    updatedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('admin_prices_positive', sql`${t.sellingPaise} > 0`),
    uniqueIndex('admin_prices_city_uq')
      .on(t.variantId, t.cityId)
      .where(sql`${t.pincode} is null`),
    uniqueIndex('admin_prices_pin_uq')
      .on(t.variantId, t.cityId, t.pincode)
      .where(sql`${t.pincode} is not null`),
    index().on(t.cityId),
    index().on(t.pincode),
    index().on(t.updatedBy),
  ],
);
