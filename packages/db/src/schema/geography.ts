import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, geographyPoint, id, ts, updatedAt, version } from './_common';

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
    locality: text(),
    centroid: geographyPoint(),
    serviceableParts: boolean().notNull().default(false),
    serviceableDoorstep: boolean().notNull().default(false),
    serviceablePickup: boolean().notNull().default(false),
    codAllowed: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('pincodes_format', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    index().on(t.cityId),
    index().on(t.stateId),
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
