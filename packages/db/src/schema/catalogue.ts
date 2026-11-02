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
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, encryptedCheck, geographyPoint, id, paise, ts, updatedAt, version } from './_common';
import { cities, pincodes, states } from './geography';
import { users, vehicleVariants } from './identity';

/** docs/specs/02-catalogue-search.md */
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
    ratingAvg: numeric({ precision: 3, scale: 2 }),
    ratingCount: integer().notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('shops_status_valid', sql`${t.status} in ('pending','approved','paused','suspended')`),
    check(
      'shops_standing_has_reason',
      sql`${t.status} not in ('paused','suspended') or (coalesce(char_length(${t.statusReason}), 0) >= 5 and ${t.statusChangedBy} is not null)`,
    ),
    check(
      'shops_gstin_format',
      sql`${t.gstin} is null or ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check('shops_timeout_positive', sql`${t.acceptanceTimeoutMin} is null or ${t.acceptanceTimeoutMin} > 0`),
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
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('products_status_valid', sql`${t.status} in ('draft','submitted','live','rejected','archived')`),
    check('products_hsn_format', sql`${t.hsn} ~ '^[0-9]{4,8}$'`),
    check('products_gst_rate_range', sql`${t.gstRateBp} between 0 and 4000`),
    // At most 8 highlights; the Hindi list is empty (falls back to English) or matches the English one line by line.
    check('products_highlights_max', sql`coalesce(array_length(${t.highlights}, 1), 0) <= 8`),
    check(
      'products_highlights_hi_aligned',
      sql`coalesce(array_length(${t.highlightsHi}, 1), 0) in (0, coalesce(array_length(${t.highlights}, 1), 0))`,
    ),
    index().on(t.categoryId, t.status),
    index().on(t.brandId),
    index().on(t.submittedByShopId),
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
    status: text().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('product_variants_mrp_nonneg', sql`${t.mrpPaise} >= 0`),
    check('product_variants_status_valid', sql`${t.status} in ('active','archived')`),
    index().on(t.productId),
    index().on(t.barcode),
  ],
);

export const productPhotos = pgTable(
  'product_photos',
  {
    id: id(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid().references(() => productVariants.id, { onDelete: 'cascade' }),
    storagePath: text().notNull(),
    alt: text().notNull(),
    altHi: text(),
    sort: integer().notNull().default(0),
    blurhash: text(),
    width: integer().notNull(),
    height: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.productId, t.sort), index().on(t.variantId)],
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
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.shopId, t.variantId),
    check('shop_inventory_selling_positive', sql`${t.sellingPaise} > 0`),
    check('shop_inventory_on_hand_nonneg', sql`${t.onHand} >= 0`),
    check('shop_inventory_reserved_nonneg', sql`${t.reserved} >= 0`),
    check('shop_inventory_available_nonneg', sql`${t.onHand} - ${t.reserved} >= 0`),
    index().on(t.variantId, t.active),
  ],
);
