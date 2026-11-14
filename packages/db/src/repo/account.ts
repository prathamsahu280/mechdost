import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { MAX_ACCOUNT_ITEMS, type AddressLabel, type VehicleFuel } from '@mechdost/shared/account';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { addresses, auditLog, pincodes, vehicles } from '../schema';
import { ConflictError, mapPgError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

/**
 * The customer's saved addresses and vehicles (design 2026-11-15; spec 01). Every function takes the signed-in
 * `userId` and only ever touches that user's live rows: a foreign or deleted id is `NotFoundError` (404), never
 * a hint that it exists. Edits and deletes are compare-and-set on `version` (stale => `ConflictError`). A user is
 * limited to `MAX_ACCOUNT_ITEMS` of each; creates take a row lock on the user so two racing requests cannot pass
 * the limit together. City and state come from the PIN (`pincodes`), never from the client. Each change writes
 * an `audit_log` row and a server event in the same transaction — ids, codes and flags only, never the contact
 * name, phone, address text or registration number (hard rules 3 and 16).
 */

export type AccountLocale = 'en' | 'hi';

export interface AddressRecord {
  id: string;
  label: AddressLabel;
  contactName: string;
  contactPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  pincode: string;
  cityName: string | null;
  stateName: string;
  lat: number | null;
  lng: number | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  serviceable: boolean;
  version: number;
}

export interface AddressInput {
  label: AddressLabel;
  contactName: string;
  contactPhone: string;
  line1: string;
  line2?: string | null | undefined;
  landmark?: string | null | undefined;
  pincode: string;
  lat?: number | null | undefined;
  lng?: number | null | undefined;
  isDefaultShipping?: boolean | undefined;
  isDefaultBilling?: boolean | undefined;
}

export type AddressChanges = Partial<Omit<AddressInput, 'isDefaultShipping' | 'isDefaultBilling'>>;

export interface VehicleRecord {
  id: string;
  type: VehicleType;
  fuel: VehicleFuel;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  registration: string | null;
  odometerKm: number | null;
  version: number;
}

export interface VehicleInput {
  type: VehicleType;
  fuel: VehicleFuel;
  make: string;
  model: string;
  variant?: string | null | undefined;
  year?: number | null | undefined;
  registration?: string | null | undefined;
  odometerKm?: number | null | undefined;
}

export type VehicleChanges = Partial<VehicleInput>;

// ── shared ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Serialise this user's account writes (limit checks, one default) and refuse a deleted account. */
async function lockUser(tx: Tx, userId: string): Promise<void> {
  const rows = rowsOf<{ id: string }>(
    await tx.execute(sql`select id from users where id = ${userId} and deleted_at is null for update`),
  );
  if (rows.length === 0) throw new NotFoundError('Account not found');
}

const point = (lng: number, lat: number) => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

// ── addresses ───────────────────────────────────────────────────────────────────────────────────────────────

interface AddressRow {
  id: string;
  label: AddressLabel;
  contact_name: string;
  contact_phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  pincode: string;
  city_name: string | null;
  state_name: string;
  lat: unknown;
  lng: unknown;
  is_default_shipping: boolean;
  is_default_billing: boolean;
  serviceable: boolean;
  version: unknown;
}

const asNumber = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toAddress(r: AddressRow): AddressRecord {
  return {
    id: r.id,
    label: r.label,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    line1: r.line1,
    line2: r.line2,
    landmark: r.landmark,
    pincode: r.pincode,
    cityName: r.city_name,
    stateName: r.state_name,
    lat: asNumber(r.lat),
    lng: asNumber(r.lng),
    isDefaultShipping: r.is_default_shipping,
    isDefaultBilling: r.is_default_billing,
    serviceable: r.serviceable,
    version: Number(r.version),
  };
}

/** One address of this user (or all of them, oldest first) with the PIN's city and state names. */
async function readAddresses(
  tx: Tx,
  userId: string,
  locale: AccountLocale,
  id?: string,
): Promise<AddressRecord[]> {
  const cityName = locale === 'hi' ? sql`coalesce(c.name_hi, c.name)` : sql`c.name`;
  const stateName = locale === 'hi' ? sql`coalesce(st.name_hi, st.name)` : sql`st.name`;
  const rows = rowsOf<AddressRow>(
    await tx.execute(sql`
      select a.id, a.label, a.contact_name, a.contact_phone, a.line1, a.line2, a.landmark, a.pincode,
             ${cityName} as city_name, ${stateName} as state_name,
             ST_Y(a.location::geometry) as lat, ST_X(a.location::geometry) as lng,
             a.is_default_shipping, a.is_default_billing,
             (a.city_id is not null and c.status = 'live' and p.active) as serviceable,
             a.version
        from addresses a
        join pincodes p on p.pincode = a.pincode
        join states st on st.id = a.state_id
        left join cities c on c.id = a.city_id
       where a.user_id = ${userId} and a.deleted_at is null
         ${id === undefined ? sql`` : sql`and a.id = ${id}`}
       order by a.created_at, a.id`),
  );
  return rows.map(toAddress);
}

export function listAddresses(db: Tx, userId: string, locale: AccountLocale): Promise<AddressRecord[]> {
  return readAddresses(db, userId, locale);
}

/** City and state of a PIN, or a 422 when the PIN is unknown (switched-off PINs may still be saved). */
async function derivePlace(tx: Tx, pincode: string): Promise<{ cityId: string | null; stateId: string }> {
  const [row] = await tx
    .select({ cityId: pincodes.cityId, stateId: pincodes.stateId })
    .from(pincodes)
    .where(eq(pincodes.pincode, pincode));
  if (!row) throw new ValidationError('We do not know that PIN code', 'UNKNOWN_PINCODE');
  return row;
}

async function liveCount(tx: Tx, userId: string, table: typeof addresses | typeof vehicles): Promise<number> {
  return tx.$count(table, and(eq(table.userId, userId), isNull(table.deletedAt)));
}

const addressAfter = (a: { label: string; pincode: string }) => ({ label: a.label, pincode: a.pincode });

export async function createAddress(
  db: Tx,
  userId: string,
  input: AddressInput,
  locale: AccountLocale,
): Promise<AddressRecord> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    if ((await liveCount(tx, userId, addresses)) >= MAX_ACCOUNT_ITEMS)
      throw new ValidationError('You can save up to 10 addresses', 'LIMIT_REACHED');
    const place = await derivePlace(tx, input.pincode);
    const hasDefault =
      (await tx.$count(
        addresses,
        and(eq(addresses.userId, userId), isNull(addresses.deletedAt), eq(addresses.isDefaultShipping, true)),
      )) > 0;
    const makeShippingDefault = input.isDefaultShipping === true || !hasDefault;
    if (makeShippingDefault)
      await tx
        .update(addresses)
        .set({ isDefaultShipping: false })
        .where(
          and(
            eq(addresses.userId, userId),
            isNull(addresses.deletedAt),
            eq(addresses.isDefaultShipping, true),
          ),
        );
    if (input.isDefaultBilling === true)
      await tx
        .update(addresses)
        .set({ isDefaultBilling: false })
        .where(
          and(
            eq(addresses.userId, userId),
            isNull(addresses.deletedAt),
            eq(addresses.isDefaultBilling, true),
          ),
        );
    const [row] = await tx
      .insert(addresses)
      .values({
        userId,
        label: input.label,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        line1: input.line1,
        line2: input.line2 ?? null,
        landmark: input.landmark ?? null,
        pincode: input.pincode,
        cityId: place.cityId,
        stateId: place.stateId,
        ...(input.lat !== null && input.lat !== undefined && input.lng !== null && input.lng !== undefined
          ? { location: { lat: input.lat, lng: input.lng } }
          : {}),
        isDefaultShipping: makeShippingDefault,
        isDefaultBilling: input.isDefaultBilling === true,
      })
      .returning({ id: addresses.id });
    if (!row) throw new Error('address insert returned nothing');
    await tx.insert(auditLog).values({
      actorUserId: userId,
      actorRole: 'customer',
      action: 'address.created',
      entity: 'address',
      entityId: row.id,
      after: addressAfter(input),
    });
    await recordServerEvent(tx, 'address_saved', {
      userId,
      props: { addressId: row.id, label: input.label, isDefault: makeShippingDefault, action: 'created' },
    });
    const [created] = await readAddresses(tx, userId, locale, row.id);
    if (!created) throw new Error('address vanished after insert');
    return created;
  });
}

/** Why a compare-and-set matched no row: someone else's or deleted id is 404, a stale version is 409. */
async function explainMiss(
  tx: Tx,
  table: typeof addresses | typeof vehicles,
  userId: string,
  id: string,
  what: string,
): Promise<never> {
  const exists = await tx.$count(
    table,
    and(eq(table.id, id), eq(table.userId, userId), isNull(table.deletedAt)),
  );
  if (exists === 0) throw new NotFoundError();
  throw new ConflictError(`Your ${what} changed elsewhere — reload and try again`, 'STALE_VERSION');
}

export async function updateAddress(
  db: Tx,
  userId: string,
  id: string,
  expectedVersion: number,
  changes: AddressChanges,
  locale: AccountLocale,
): Promise<AddressRecord> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const place = changes.pincode === undefined ? null : await derivePlace(tx, changes.pincode);
    const set: Partial<typeof addresses.$inferInsert> = {
      ...(changes.label === undefined ? {} : { label: changes.label }),
      ...(changes.contactName === undefined ? {} : { contactName: changes.contactName }),
      ...(changes.contactPhone === undefined ? {} : { contactPhone: changes.contactPhone }),
      ...(changes.line1 === undefined ? {} : { line1: changes.line1 }),
      ...(changes.line2 === undefined ? {} : { line2: changes.line2 }),
      ...(changes.landmark === undefined ? {} : { landmark: changes.landmark }),
      ...(place && changes.pincode !== undefined
        ? { pincode: changes.pincode, cityId: place.cityId, stateId: place.stateId }
        : {}),
    };
    // `location` has a custom driver type, so a map pin (or its removal) goes through raw SQL values.
    const pin =
      changes.lat === undefined || changes.lng === undefined
        ? {}
        : changes.lat === null || changes.lng === null
          ? { location: sql`null` }
          : { location: point(changes.lng, changes.lat) };
    const rows = await tx
      .update(addresses)
      .set({ ...set, ...pin })
      .where(
        and(
          eq(addresses.id, id),
          eq(addresses.userId, userId),
          isNull(addresses.deletedAt),
          eq(addresses.version, expectedVersion),
        ),
      )
      .returning({
        id: addresses.id,
        label: addresses.label,
        pincode: addresses.pincode,
        isDefault: addresses.isDefaultShipping,
      });
    const row = rows[0];
    if (!row) return explainMiss(tx, addresses, userId, id, 'address');
    await tx.insert(auditLog).values({
      actorUserId: userId,
      actorRole: 'customer',
      action: 'address.updated',
      entity: 'address',
      entityId: id,
      after: { fields: Object.keys(changes).sort(), ...addressAfter(row) },
    });
    await recordServerEvent(tx, 'address_saved', {
      userId,
      props: { addressId: id, label: row.label, isDefault: row.isDefault, action: 'updated' },
    });
    const [updated] = await readAddresses(tx, userId, locale, id);
    if (!updated) throw new Error('address vanished after update');
    return updated;
  });
}

export async function setDefaultAddress(
  db: Tx,
  userId: string,
  id: string,
  expectedVersion: number,
  kind: 'shipping' | 'billing',
  locale: AccountLocale,
): Promise<AddressRecord> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const flag = kind === 'shipping' ? addresses.isDefaultShipping : addresses.isDefaultBilling;
    const column = kind === 'shipping' ? 'isDefaultShipping' : 'isDefaultBilling';
    // Check the target first (404 vs 409), then swap: clearing the old default before setting the new one keeps
    // the one-default partial unique index satisfied at every statement.
    const [target] = await tx
      .select({ version: addresses.version, already: flag })
      .from(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId), isNull(addresses.deletedAt)));
    if (!target) throw new NotFoundError();
    if (target.version !== expectedVersion)
      throw new ConflictError('Your address changed elsewhere — reload and try again', 'STALE_VERSION');
    if (target.already) {
      const [same] = await readAddresses(tx, userId, locale, id);
      if (!same) throw new NotFoundError();
      return same;
    }
    await tx
      .update(addresses)
      .set({ [column]: false })
      .where(and(eq(addresses.userId, userId), isNull(addresses.deletedAt), eq(flag, true)));
    const rows = await tx
      .update(addresses)
      .set({ [column]: true })
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId), eq(addresses.version, expectedVersion)))
      .returning({ label: addresses.label, pincode: addresses.pincode });
    const row = rows[0];
    if (!row)
      throw new ConflictError('Your address changed elsewhere — reload and try again', 'STALE_VERSION');
    await tx.insert(auditLog).values({
      actorUserId: userId,
      actorRole: 'customer',
      action: 'address.default_set',
      entity: 'address',
      entityId: id,
      after: { kind },
    });
    await recordServerEvent(tx, 'address_saved', {
      userId,
      props: { addressId: id, label: row.label, isDefault: kind === 'shipping', action: 'updated' },
    });
    const [updated] = await readAddresses(tx, userId, locale, id);
    if (!updated) throw new Error('address vanished after update');
    return updated;
  });
}

export async function deleteAddress(
  db: Tx,
  userId: string,
  id: string,
  expectedVersion: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(addresses)
      .set({ deletedAt: sql`now()`, isDefaultShipping: false, isDefaultBilling: false })
      .where(
        and(
          eq(addresses.id, id),
          eq(addresses.userId, userId),
          isNull(addresses.deletedAt),
          eq(addresses.version, expectedVersion),
        ),
      )
      .returning({ id: addresses.id });
    if (rows.length === 0) return explainMiss(tx, addresses, userId, id, 'address');
    await tx.insert(auditLog).values({
      actorUserId: userId,
      actorRole: 'customer',
      action: 'address.deleted',
      entity: 'address',
      entityId: id,
    });
    await recordServerEvent(tx, 'address_deleted', { userId, props: { addressId: id } });
  });
}

// ── vehicles ────────────────────────────────────────────────────────────────────────────────────────────────

const vehicleColumns = {
  id: vehicles.id,
  type: vehicles.type,
  fuel: vehicles.fuel,
  make: vehicles.make,
  model: vehicles.model,
  variant: vehicles.variant,
  year: vehicles.year,
  registration: vehicles.registration,
  odometerKm: vehicles.odometerKm,
  version: vehicles.version,
};

interface VehicleRow {
  id: string;
  type: string;
  fuel: string;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  registration: string | null;
  odometerKm: number | null;
  version: number;
}

const toVehicle = (r: VehicleRow): VehicleRecord => ({
  ...r,
  type: r.type as VehicleType,
  fuel: r.fuel as VehicleFuel,
});

export async function listVehicles(db: Tx, userId: string): Promise<VehicleRecord[]> {
  const rows = await db
    .select(vehicleColumns)
    .from(vehicles)
    .where(and(eq(vehicles.userId, userId), isNull(vehicles.deletedAt)))
    .orderBy(asc(vehicles.createdAt), asc(vehicles.id));
  return rows.map(toVehicle);
}

/** The registration unique index (one live number per customer) surfaces as a typed conflict. */
function mapVehicleError(err: unknown): never {
  if (pgCode(err) === '23505')
    throw new ConflictError('You already saved a vehicle with that registration', 'DUPLICATE_REGISTRATION');
  return mapPgError(err);
}

export async function createVehicle(db: Tx, userId: string, input: VehicleInput): Promise<VehicleRecord> {
  return db
    .transaction(async (tx) => {
      await lockUser(tx, userId);
      if ((await liveCount(tx, userId, vehicles)) >= MAX_ACCOUNT_ITEMS)
        throw new ValidationError('You can save up to 10 vehicles', 'LIMIT_REACHED');
      const [row] = await tx
        .insert(vehicles)
        .values({
          userId,
          type: input.type,
          fuel: input.fuel,
          make: input.make,
          model: input.model,
          variant: input.variant ?? null,
          year: input.year ?? null,
          registration: input.registration ?? null,
          odometerKm: input.odometerKm ?? null,
        })
        .returning(vehicleColumns);
      if (!row) throw new Error('vehicle insert returned nothing');
      await tx.insert(auditLog).values({
        actorUserId: userId,
        actorRole: 'customer',
        action: 'vehicle.created',
        entity: 'vehicle',
        entityId: row.id,
        after: { type: row.type, fuel: row.fuel },
      });
      await recordServerEvent(tx, 'vehicle_saved', {
        userId,
        props: { vehicleId: row.id, type: row.type, fuel: row.fuel, action: 'created' },
      });
      return toVehicle(row);
    })
    .catch(mapVehicleError);
}

export async function updateVehicle(
  db: Tx,
  userId: string,
  id: string,
  expectedVersion: number,
  changes: VehicleChanges,
): Promise<VehicleRecord> {
  return db
    .transaction(async (tx) => {
      const set: Partial<typeof vehicles.$inferInsert> = {};
      for (const k of [
        'type',
        'fuel',
        'make',
        'model',
        'variant',
        'year',
        'registration',
        'odometerKm',
      ] as const) {
        const v = changes[k];
        if (v !== undefined) Object.assign(set, { [k]: v });
      }
      const rows = await tx
        .update(vehicles)
        .set(set)
        .where(
          and(
            eq(vehicles.id, id),
            eq(vehicles.userId, userId),
            isNull(vehicles.deletedAt),
            eq(vehicles.version, expectedVersion),
          ),
        )
        .returning(vehicleColumns);
      const row = rows[0];
      if (!row) return explainMiss(tx, vehicles, userId, id, 'vehicle');
      await tx.insert(auditLog).values({
        actorUserId: userId,
        actorRole: 'customer',
        action: 'vehicle.updated',
        entity: 'vehicle',
        entityId: id,
        after: { fields: Object.keys(set).sort(), type: row.type, fuel: row.fuel },
      });
      await recordServerEvent(tx, 'vehicle_saved', {
        userId,
        props: { vehicleId: id, type: row.type, fuel: row.fuel, action: 'updated' },
      });
      return toVehicle(row);
    })
    .catch(mapVehicleError);
}

export async function deleteVehicle(
  db: Tx,
  userId: string,
  id: string,
  expectedVersion: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(vehicles)
      .set({ deletedAt: sql`now()`, isPrimary: false })
      .where(
        and(
          eq(vehicles.id, id),
          eq(vehicles.userId, userId),
          isNull(vehicles.deletedAt),
          eq(vehicles.version, expectedVersion),
        ),
      )
      .returning({ id: vehicles.id });
    if (rows.length === 0) return explainMiss(tx, vehicles, userId, id, 'vehicle');
    await tx.insert(auditLog).values({
      actorUserId: userId,
      actorRole: 'customer',
      action: 'vehicle.deleted',
      entity: 'vehicle',
      entityId: id,
    });
    await recordServerEvent(tx, 'vehicle_deleted', { userId, props: { vehicleId: id } });
  });
}
