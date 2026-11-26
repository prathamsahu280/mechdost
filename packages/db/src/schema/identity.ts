import { sql } from 'drizzle-orm';
import { USTAAD_CONSENT_PURPOSES } from '@mechdost/shared/ustaad/codes';
import {
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
import { citext, createdAt, encryptedCheck, geographyPoint, id, ts, updatedAt, version } from './_common';
import { cities, pincodes, states } from './geography';
import { workshops } from './services';

/** docs/specs/01-auth-accounts.md. Identity comes from Firebase; this row is our profile. */
export const users = pgTable(
  'users',
  {
    id: id(),
    firebaseUid: text().notNull().unique(),
    name: text(),
    phone: text(), // E.164
    phoneVerifiedAt: ts(),
    email: citext(),
    emailVerifiedAt: ts(),
    language: text().notNull().default('en'),
    status: text().notNull().default('active'),
    deactivatedAt: ts(),
    deletionRequestedAt: ts(),
    deletedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('users_phone_e164', sql`${t.phone} is null or ${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('users_language_valid', sql`${t.language} in ('en','hi')`),
    check('users_status_valid', sql`${t.status} in ('active','deactivated','deleted')`),
    // Soft-deleted accounts release their phone/email for reuse.
    uniqueIndex('users_phone_active_uq')
      .on(t.phone)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex('users_email_active_uq')
      .on(t.email)
      .where(sql`${t.deletedAt} is null`),
    // Admin customer search (design 2026-11-15): phone by its last 10 digits, name by prefix (`lower(name) like 'ab%'`).
    index('users_phone_last10_idx')
      .on(sql`right(${t.phone}, 10)`)
      .where(sql`${t.deletedAt} is null`),
    index('users_name_prefix_idx')
      .on(sql`lower(${t.name}) text_pattern_ops`)
      .where(sql`${t.deletedAt} is null`),
    // CSV exports of accounts (design 2026-11-15): created in an IST window, keyset-paged on (created_at, id).
    index('users_created_id_idx')
      .on(t.createdAt, t.id)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** RBAC: permissions are `resource:action` strings grouped into roles (docs/specs/13-rbac-security-abuse.md). */
export const permissions = pgTable(
  'permissions',
  {
    key: text().primaryKey(),
    description: text().notNull(),
  },
  (t) => [check('permissions_key_format', sql`${t.key} ~ '^[a-z_]+:[a-z_]+$'`)],
);

export const roles = pgTable('roles', {
  id: id(),
  key: text().notNull().unique(),
  name: text().notNull(),
  description: text(),
  isSystem: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text()
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] }), index().on(t.permissionKey)],
);

/** A role granted to a user, optionally scoped to a city and/or a partner (shop/workshop). */
export const userRoles = pgTable(
  'user_roles',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    cityId: uuid().references(() => cities.id, { onDelete: 'cascade' }),
    shopId: uuid(),
    // Lazy reference: services.ts imports users from this file (the ESM cycle resolves at build time).
    workshopId: uuid().references(() => workshops.id, { onDelete: 'cascade' }),
    grantedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('user_roles_scope_uq').on(t.userId, t.roleId, t.cityId, t.shopId, t.workshopId).nullsNotDistinct(),
    index().on(t.roleId),
    index().on(t.cityId),
    index().on(t.shopId),
    index().on(t.workshopId),
    index().on(t.grantedBy),
  ],
);

/** Staff second factor (TOTP) — enforced automatically once staff beyond founders exist. */
export const staffSecurity = pgTable(
  'staff_security',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** TOTP secret, encrypted (`encryptField(…, 'staff_security.totp_secret_enc')`). */
    totpSecretEnc: text(),
    totpEnabledAt: ts(),
    updatedAt: updatedAt(),
  },
  (t) => [check('staff_security_totp_encrypted', encryptedCheck(t.totpSecretEnc))],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    device: text(),
    ipTruncated: text(),
    city: text(),
    lastSeenAt: ts().notNull().defaultNow(),
    revokedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

/** Append-only consent log (DPDP): one row per grant/withdrawal. */
export const consents = pgTable(
  'consents',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text().notNull(),
    granted: boolean().notNull(),
    noticeVersion: text().notNull(),
    source: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'consents_purpose_valid',
      // Ustaad Network purposes (spec 23 § 13) added by migration ustaad_foundations; the list is the shared one.
      sql`${t.purpose} in ('account','marketing','analytics','personalisation','location','share_with_partner','whatsapp',${sql.raw(USTAAD_CONSENT_PURPOSES.map((p) => `'${p}'`).join(','))})`,
    ),
    index().on(t.userId, t.purpose, t.createdAt),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: text().notNull(),
    category: text().notNull(),
    enabled: boolean().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.channel, t.category] }),
    check('notif_pref_channel_valid', sql`${t.channel} in ('inapp','email','sms','whatsapp','push')`),
    check(
      'notif_pref_category_valid',
      sql`${t.category} in ('transactional','promotional','reminders','price_alerts')`,
    ),
  ],
);

export const addresses = pgTable(
  'addresses',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text().notNull().default('home'),
    contactName: text().notNull(),
    contactPhone: text().notNull(),
    line1: text().notNull(),
    line2: text(),
    landmark: text(),
    pincode: text()
      .notNull()
      .references(() => pincodes.pincode, { onDelete: 'restrict' }),
    cityId: uuid().references(() => cities.id, { onDelete: 'restrict' }),
    stateId: uuid()
      .notNull()
      .references(() => states.id, { onDelete: 'restrict' }),
    location: geographyPoint(),
    isDefaultShipping: boolean().notNull().default(false),
    isDefaultBilling: boolean().notNull().default(false),
    deletedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('addresses_label_valid', sql`${t.label} in ('home','work','garage','other')`),
    check('addresses_contact_phone_e164', sql`${t.contactPhone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    uniqueIndex('addresses_one_default_shipping_uq')
      .on(t.userId)
      .where(sql`${t.isDefaultShipping} and ${t.deletedAt} is null`),
    uniqueIndex('addresses_one_default_billing_uq')
      .on(t.userId)
      .where(sql`${t.isDefaultBilling} and ${t.deletedAt} is null`),
    index().on(t.userId),
    index().on(t.pincode),
    index().on(t.cityId),
    index().on(t.stateId),
  ],
);

/** Vehicle master (drives fitment). Source pending decision #4; admin-editable. */
export const vehicleMakes = pgTable('vehicle_makes', {
  id: id(),
  name: text().notNull().unique(),
  slug: text().notNull().unique(),
  createdAt: createdAt(),
});

export const vehicleModels = pgTable(
  'vehicle_models',
  {
    id: id(),
    makeId: uuid()
      .notNull()
      .references(() => vehicleMakes.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    vehicleType: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.makeId, t.name),
    check('vehicle_models_type_valid', sql`${t.vehicleType} in ('2W','3W','4W')`),
  ],
);

export const vehicleVariants = pgTable(
  'vehicle_variants',
  {
    id: id(),
    modelId: uuid()
      .notNull()
      .references(() => vehicleModels.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    fuel: text().notNull(),
    yearFrom: smallint().notNull(),
    yearTo: smallint(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.modelId, t.name, t.fuel, t.yearFrom),
    check('vehicle_variants_fuel_valid', sql`${t.fuel} in ('petrol','diesel','cng_lpg','hybrid','electric')`),
    check('vehicle_variants_years', sql`${t.yearTo} is null or ${t.yearTo} >= ${t.yearFrom}`),
  ],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vehicleVariantId: uuid().references(() => vehicleVariants.id, { onDelete: 'set null' }),
    type: text().notNull(),
    make: text().notNull(),
    model: text().notNull(),
    variant: text(),
    year: smallint(),
    fuel: text().notNull(),
    registration: text(),
    odometerKm: integer(),
    lastServiceKm: integer(),
    lastServiceAt: ts(),
    insurance: jsonb(), // private: provider, expiry
    isPrimary: boolean().notNull().default(false),
    deletedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('vehicles_type_valid', sql`${t.type} in ('2W','3W','4W')`),
    check('vehicles_fuel_valid', sql`${t.fuel} in ('petrol','diesel','cng_lpg','hybrid','electric')`),
    check('vehicles_odometer_nonneg', sql`${t.odometerKm} is null or ${t.odometerKm} >= 0`),
    check(
      'vehicles_service_km_le_odometer',
      sql`${t.lastServiceKm} is null or ${t.odometerKm} is null or ${t.lastServiceKm} <= ${t.odometerKm}`,
    ),
    uniqueIndex('vehicles_one_primary_uq')
      .on(t.userId)
      .where(sql`${t.isPrimary} and ${t.deletedAt} is null`),
    uniqueIndex('vehicles_registration_uq')
      .on(t.userId, sql`upper(${t.registration})`)
      .where(sql`${t.registration} is not null and ${t.deletedAt} is null`),
    index().on(t.userId),
    index().on(t.vehicleVariantId),
  ],
);
