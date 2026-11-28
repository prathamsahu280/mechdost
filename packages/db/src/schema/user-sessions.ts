/**
 * Password sign-ins, one row each (spec 01 § Devices, decision 2026-11-28): the "Where you're signed in" list and the
 * per-device sign-out. The raw session key travels only in the person's Firebase token (custom claim `mds`); the row
 * keeps its SHA-256 hash. What is kept: device kind, browser and OS as codes, a rough place from an offline IP lookup
 * (English names), created / last active, and why it ended. The IP address and the raw User-Agent are never stored.
 * Private to the person: the API is the only reader (RLS on, no grants).
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { DEVICE_BROWSERS, DEVICE_KINDS, DEVICE_OSES, SESSION_REVOKE_REASONS } from '@mechdost/shared/devices';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { users } from './identity';
import { nullOrOneOf, oneOf } from './ustaad-common';

export const userSessions = pgTable(
  'user_sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Lower-case hex SHA-256 of the 256-bit random session key; the key itself is never stored. */
    keyHash: text().notNull(),
    deviceKind: text().notNull(),
    browser: text().notNull(),
    os: text().notNull(),
    /** ISO 3166-1 alpha-2 (upper case) from the lookup; null when there was none. English names below. */
    countryCode: text(),
    region: text(),
    city: text(),
    lastActiveAt: ts().notNull().defaultNow(),
    revokedAt: ts(),
    revokedReason: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_sessions_key_hash_uq').on(t.keyHash),
    // The list reads a person's active sessions newest activity first.
    index('user_sessions_active_idx')
      .on(t.userId, t.lastActiveAt.desc())
      .where(sql`${t.revokedAt} is null`),
    check('user_sessions_key_hash_format', sql`${t.keyHash} ~ '^[0-9a-f]{64}$'`),
    check('user_sessions_device_kind_valid', oneOf(t.deviceKind, DEVICE_KINDS)),
    check('user_sessions_browser_valid', oneOf(t.browser, DEVICE_BROWSERS)),
    check('user_sessions_os_valid', oneOf(t.os, DEVICE_OSES)),
    check('user_sessions_country_format', sql`${t.countryCode} is null or ${t.countryCode} ~ '^[A-Z]{2}$'`),
    check('user_sessions_revoked_reason_valid', nullOrOneOf(t.revokedReason, SESSION_REVOKE_REASONS)),
    check('user_sessions_revoked_pair', sql`(${t.revokedAt} is null) = (${t.revokedReason} is null)`),
  ],
);
