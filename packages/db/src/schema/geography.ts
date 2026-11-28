import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import {
  PINCODE_AREA_MAX,
  PINCODE_AREA_MIN,
  PINCODE_INACTIVE_REASONS,
  PINCODE_NOTE_MAX,
  PINCODE_SOURCES,
} from '@mechdost/shared/geo';
import { createdAt, geographyPoint, id, paise, ts, updatedAt, version } from './_common';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/** docs/specs/15-multi-city.md */
export const states = pgTable('states', {
  id: id(),
  code: text().notNull().unique(), // e.g. CG
  name: text().notNull(),
  nameHi: text(),
  gstStateCode: text().notNull().unique(), // e.g. 22
  createdAt: createdAt(),
});

export const cities = pgTable(
  'cities',
  {
    id: id(),
    stateId: uuid()
      .notNull()
      .references(() => states.id, { onDelete: 'restrict' }),
    code: text().notNull().unique(), // 3 letters, used in public codes: RPR
    slug: text().notNull().unique(),
    name: text().notNull(),
    nameHi: text(),
    status: text().notNull().default('coming_soon'),
    centroid: geographyPoint(),
    radiusKm: integer().notNull().default(25),
    launchedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('cities_code_format', sql`${t.code} ~ '^[A-Z]{3}$'`),
    check('cities_status_valid', sql`${t.status} in ('live','coming_soon','paused')`),
    check('cities_radius_positive', sql`${t.radiusKm} > 0`),
    index().on(t.stateId),
  ],
);

export const pincodes = pgTable(
  'pincodes',
  {
    pincode: text().primaryKey(),
    stateId: uuid()
      .notNull()
      .references(() => states.id, { onDelete: 'restrict' }),
    cityId: uuid().references(() => cities.id, { onDelete: 'restrict' }),
    district: text(),
    /** Main area name in English (India Post head office / locality); `locality_hi` is the Hindi name (rule 10). */
    locality: text(),
    localityHi: text(),
    centroid: geographyPoint(),
    /**
     * Master switch (spec 15 "PIN codes", 2026-11-14): an inactive PIN is not serviceable — checkout, nearby
     * workshops, new service requests and new shop coverage refuse it like an unknown PIN. Admin-controlled.
     */
    active: boolean().notNull().default(true),
    inactiveReason: text(),
    inactiveNote: text(),
    /** `seed` rows may be refreshed by `pnpm db:seed:pincodes`; any admin change makes the row `admin` (left alone). */
    source: text().notNull().default('seed'),
    // Per-service flags reserved for later (spec 15 model); nothing reads them yet — `active` decides today.
    serviceableParts: boolean().notNull().default(false),
    serviceableDoorstep: boolean().notNull().default(false),
    serviceablePickup: boolean().notNull().default(false),
    codAllowed: boolean().notNull().default(true),
    /**
     * Free-delivery threshold for orders to this PIN (spec 03 "Delivery charges", user 2026-11-14): NULL = no
     * override (shop, then city setting `checkout.free_delivery_min_paise`), 0 = always free. Integer paise.
     */
    freeDeliveryMinPaise: paise(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('pincodes_format', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    check('pincodes_locality_pair', sql`(${t.locality} is null) = (${t.localityHi} is null)`),
    check(
      'pincodes_locality_len',
      sql`${t.locality} is null or (char_length(${t.locality}) between ${sql.raw(String(PINCODE_AREA_MIN))} and ${sql.raw(String(PINCODE_AREA_MAX))} and char_length(${t.localityHi}) between ${sql.raw(String(PINCODE_AREA_MIN))} and ${sql.raw(String(PINCODE_AREA_MAX))})`,
    ),
    check(
      'pincodes_inactive_reason',
      // `is not null` first: `NULL in (…)` is NULL, which a CHECK lets through (caught by the db test).
      sql`(${t.active} and ${t.inactiveReason} is null and ${t.inactiveNote} is null) or (not ${t.active} and ${t.inactiveReason} is not null and ${t.inactiveReason} in (${inList(PINCODE_INACTIVE_REASONS)}))`,
    ),
    check(
      'pincodes_inactive_note_len',
      sql`${t.inactiveNote} is null or char_length(${t.inactiveNote}) between 1 and ${sql.raw(String(PINCODE_NOTE_MAX))}`,
    ),
    check(
      'pincodes_free_delivery_min',
      sql`${t.freeDeliveryMinPaise} is null or ${t.freeDeliveryMinPaise} between 0 and 10000000`,
    ),
    check('pincodes_source_valid', sql`${t.source} in (${inList(PINCODE_SOURCES)})`),
    index().on(t.cityId),
    index().on(t.stateId),
    // Nearest-PIN shortlist for "use my location" (KNN `<->` + ST_DWithin, spec 06).
    index('pincodes_centroid_gix').using('gist', t.centroid),
  ],
);

/** Demand capture for areas that are not live yet ("Not serviceable yet — notify me"). */
export const waitlist = pgTable(
  'waitlist',
  {
    id: id(),
    pincode: text().notNull(),
    phone: text().notNull(),
    interest: text().notNull().default('general'),
    createdAt: createdAt(),
  },
  (t) => [check('waitlist_pincode_format', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`), index().on(t.pincode)],
);
