/**
 * Garage pin, zone counts and pin changes (spec 23 § 6.5, § 9.6; SR-29–32; migration `ustaad_local`). Workstream E
 * owns the repositories. The exact point is staff-only unless the member opted in; `circle_center` is a fixed
 * per-member offset (0–150 m) set once, so a displayed circle is never centred on the garage. Exact zone counts are
 * staff-only; members get bands (`bandCount`).
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { LOCATION_SOURCES } from '@mechdost/shared/ustaad/codes';
import { createdAt, geographyPoint, id, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { oneOf } from './ustaad-common';
import { ustaadMedia } from './ustaad-media';
import { ustaadMembers } from './ustaad-members';

export const ustaadLocations = pgTable(
  'ustaad_locations',
  {
    memberId: uuid()
      .primaryKey()
      .references(() => ustaadMembers.id, { onDelete: 'cascade' }),
    location: geographyPoint().notNull(),
    accuracyM: integer().notNull(),
    source: text().notNull(),
    mockSuspected: boolean().notNull().default(false),
    landmark: text(),
    circleCenter: geographyPoint().notNull(),
    zoneCell: text().notNull(),
    shareExact: boolean().notNull().default(false),
    /** `connections` (default, SR-32) or `all_verified`. */
    exactAudience: text().notNull().default('connections'),
    countInZone: boolean().notNull().default(false),
    useForVerify: boolean().notNull().default(false),
    hidden: boolean().notNull().default(false),
    confirmedAt: ts().notNull().defaultNow(),
    verifiedAt: ts(),
    signboardMediaId: uuid().references(() => ustaadMedia.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ustaad_locations_location_gix').using('gist', t.location),
    index('ustaad_locations_circle_gix').using('gist', t.circleCenter),
    index().on(t.zoneCell),
    index().on(t.signboardMediaId),
    check('ustaad_locations_source_valid', oneOf(t.source, LOCATION_SOURCES)),
    check('ustaad_locations_audience_valid', oneOf(t.exactAudience, ['connections', 'all_verified'])),
    check('ustaad_locations_accuracy', sql`${t.accuracyM} between 0 and 100000`),
    check('ustaad_locations_zone_format', sql`${t.zoneCell} ~ '^hx:-?[0-9]+:-?[0-9]+$'`),
    check('ustaad_locations_landmark_len', sql`${t.landmark} is null or char_length(${t.landmark}) <= 120`),
  ],
);

/** Nightly zone counts; exact numbers for staff only (the member API bands them). */
export const ustaadZoneCounts = pgTable(
  'ustaad_zone_counts',
  {
    zoneCell: text().primaryKey(),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    computedAt: ts().notNull().defaultNow(),
    members: integer().notNull(),
    bySegment: jsonb()
      .notNull()
      .default(sql`'{"schema_version":1}'::jsonb`),
    center: geographyPoint().notNull(),
  },
  (t) => [
    index().on(t.cityId),
    check('ustaad_zone_counts_members', sql`${t.members} >= 0`),
    check('ustaad_zone_counts_zone_format', sql`${t.zoneCell} ~ '^hx:-?[0-9]+:-?[0-9]+$'`),
    check('ustaad_zone_counts_versioned', sql`${t.bySegment} ? 'schema_version'`),
  ],
);

/** Pin-change log for the limits (3 per 24 h, 6 per 30 days; SR-30). Append-only. */
export const ustaadPinChanges = pgTable(
  'ustaad_pin_changes',
  {
    id: id(),
    memberId: uuid()
      .notNull()
      .references(() => ustaadMembers.id, { onDelete: 'cascade' }),
    changedAt: ts().notNull().defaultNow(),
    distanceM: integer().notNull(),
    accuracyM: smallint().notNull(),
  },
  (t) => [
    index().on(t.memberId, t.changedAt),
    check('ustaad_pin_changes_values', sql`${t.distanceM} >= 0 and ${t.accuracyM} >= 0`),
  ],
);
