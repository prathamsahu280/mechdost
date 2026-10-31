/**
 * Shared column builders. Conventions (CLAUDE.md, docs/specs/14-data-integrity.md):
 * - PK uuid v7 generated in the app (index locality) with gen_random_uuid() as DB fallback.
 * - Money: bigint paise (number mode is safe below 2^53). Rates: integer basis points.
 * - Time: timestamptz everywhere. Mutable rows carry `version` for optimistic locking.
 */
import { sql } from 'drizzle-orm';
import { bigint, customType, integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

export const id = () =>
  uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .$defaultFn(() => uuidv7());

export const ts = () => timestamp({ withTimezone: true, mode: 'date' });

export const createdAt = () => ts().notNull().defaultNow();
export const updatedAt = () =>
  ts()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const version = () => integer().notNull().default(1);

export const paise = () => bigint({ mode: 'number' });

/** Case-insensitive text (emails, coupon codes). Requires the citext extension. */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** WGS84 point stored as PostGIS geography for metre-accurate ST_DWithin distance queries. */
export const geographyPoint = customType<{ data: { lng: number; lat: number }; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
  toDriver: (v) => `SRID=4326;POINT(${v.lng} ${v.lat})`,
});

export { uuidv7 };
