import { and, eq, sql } from 'drizzle-orm';
import {
  DEVANAGARI_RE,
  FREE_DELIVERY_MAX_PAISE,
  inIndia,
  isPincode,
  PINCODE_AREA_MAX,
  PINCODE_AREA_MIN,
  PINCODE_INACTIVE_REASONS,
  PINCODE_MAX_KM_FROM_CITY,
  PINCODE_NOTE_MAX,
  type PincodeInactiveReason,
  type PincodeSource,
} from '@mechdost/shared/geo';
import { auditLog, cities, pincodes } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import type { Tx } from './orders';
import { num, numOrNull, rowsOf } from './sql-rows';

/**
 * Service-area PIN codes (spec 15 "PIN codes", decision 2026-11-14; hard rules 3, 7, 8). Staff add a PIN with its
 * centroid and English + Hindi area name, edit them, set a per-PIN free-delivery threshold (spec 03), and switch a
 * PIN off with a reason code — an inactive PIN is not serviceable anywhere. Every write is compare-and-set on
 * `version` and audited (before/after) in the same transaction; any admin write marks the row `source = 'admin'`
 * so the reference-data upsert (`pincodes-seed.ts`) never overrides it. Rows are never deleted (orders, shops and
 * workshops keep their PIN).
 */
export interface CityPincode {
  pincode: string;
  areaEn: string | null;
  areaHi: string | null;
  lat: number | null;
  lng: number | null;
  active: boolean;
  inactiveReason: PincodeInactiveReason | null;
  inactiveNote: string | null;
  source: PincodeSource;
  freeDeliveryMinPaise: number | null;
  /** Active shop delivery-area rows for this PIN (how covered it is before launch). */
  shopsCovering: number;
  version: number;
  updatedAt: Date;
}

interface PincodeSqlRow {
  pincode: string;
  locality: string | null;
  locality_hi: string | null;
  lat: unknown;
  lng: unknown;
  active: boolean;
  inactive_reason: PincodeInactiveReason | null;
  inactive_note: string | null;
  source: PincodeSource;
  free_delivery_min_paise: unknown;
  shops_covering: unknown;
  version: unknown;
  updated_at: Date | string;
}

export interface CityPincodes {
  city: { code: string; name: string; nameHi: string | null };
  pincodes: CityPincode[];
}

/** Every PIN code of a city (active or not), by PIN. A city has tens of PINs, so no paging. */
export async function listCityPincodes(db: Tx, cityId: string): Promise<CityPincodes> {
  const [city] = await db
    .select({ code: cities.code, name: cities.name, nameHi: cities.nameHi })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1);
  if (!city) throw new NotFoundError('City not found');
  const rows = rowsOf<PincodeSqlRow>(
    await db.execute(sql`
      select p.pincode, p.locality, p.locality_hi, ST_Y(p.centroid::geometry) as lat, ST_X(p.centroid::geometry) as lng,
        p.active, p.inactive_reason, p.inactive_note, p.source, p.free_delivery_min_paise, p.version, p.updated_at,
        (select count(*) from shop_pincodes sp where sp.pincode = p.pincode and sp.active) as shops_covering
      from pincodes p
      where p.city_id = ${cityId}
      order by p.pincode`),
  );
  const list = rows.map((r) => ({
    pincode: r.pincode,
    areaEn: r.locality,
    areaHi: r.locality_hi,
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
    active: r.active,
    inactiveReason: r.inactive_reason,
    inactiveNote: r.inactive_note,
    source: r.source,
    freeDeliveryMinPaise: numOrNull(r.free_delivery_min_paise),
    shopsCovering: num(r.shops_covering),
    version: num(r.version),
    updatedAt: new Date(r.updated_at),
  }));
  return { city, pincodes: list };
}

/** The code of the city a PIN code belongs to (staff pick lists start from an application's PIN), else 404. */
export async function cityCodeOfPincode(db: Tx, pincode: string): Promise<string> {
  const [row] = await db
    .select({ code: cities.code })
    .from(pincodes)
    .innerJoin(cities, eq(cities.id, pincodes.cityId))
    .where(eq(pincodes.pincode, pincode))
    .limit(1);
  if (!row) throw new NotFoundError('PIN code not found');
  return row.code;
}

export interface PublicPincode {
  pincode: string;
  area: string | null;
  lat: number | null;
  lng: number | null;
}

/** Active PIN codes of a live city, the area name in the reader's language (Hindi falls back to English). */
export async function listActivePincodes(
  db: Tx,
  cityCode: string,
  locale: 'en' | 'hi',
): Promise<PublicPincode[]> {
  const [city] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(and(eq(cities.code, cityCode), eq(cities.status, 'live')))
    .limit(1);
  if (!city) throw new NotFoundError('City not found');
  const rows = rowsOf<{
    pincode: string;
    locality: string | null;
    locality_hi: string | null;
    lat: unknown;
    lng: unknown;
  }>(
    await db.execute(sql`
      select pincode, locality, locality_hi, ST_Y(centroid::geometry) as lat, ST_X(centroid::geometry) as lng
      from pincodes where city_id = ${city.id} and active order by pincode`),
  );
  return rows.map((r) => ({
    pincode: r.pincode,
    area: locale === 'hi' ? (r.locality_hi ?? r.locality) : r.locality,
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
  }));
}

function checkArea(en: string, hi: string) {
  const ok = (v: string) => v.trim() === v && v.length >= PINCODE_AREA_MIN && v.length <= PINCODE_AREA_MAX;
  if (!ok(en) || !ok(hi) || !DEVANAGARI_RE.test(hi))
    throw new ValidationError('Give the area name in English and in Hindi', 'PINCODE_AREA');
}

function checkFreeMin(v: number | null) {
  if (v !== null && (!Number.isSafeInteger(v) || v < 0 || v > FREE_DELIVERY_MAX_PAISE))
    throw new ValidationError('Free delivery must be ₹0 to ₹1,00,000', 'PINCODE_FREE_DELIVERY');
}

/** The centroid is in India and within reach of the city's centre (catches swapped or mistyped coordinates). */
async function checkCentroid(tx: Tx, cityId: string, lat: number, lng: number) {
  if (!inIndia(lat, lng))
    throw new ValidationError('These coordinates are not in India', 'PINCODE_OUTSIDE_INDIA');
  const [row] = rowsOf<{ km: unknown }>(
    await tx.execute(sql`
      select ST_Distance(centroid, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) / 1000 as km
      from cities where id = ${cityId} and centroid is not null`),
  );
  if (row && num(row.km) > PINCODE_MAX_KM_FROM_CITY)
    throw new ValidationError('These coordinates are far from the city', 'PINCODE_FAR_FROM_CITY');
}

const point = (lat: number, lng: number) => ({ lng, lat });

/** Add a PIN code to a city (active). 409 when the PIN already exists (in any city). */
export async function addPincode(
  db: Tx,
  input: {
    cityId: string;
    pincode: string;
    lat: number;
    lng: number;
    areaEn: string;
    areaHi: string;
    freeDeliveryMinPaise: number | null;
    staffUserId: string;
  },
): Promise<{ pincode: string; version: number }> {
  if (!isPincode(input.pincode)) throw new ValidationError('Check the PIN code', 'PINCODE_INVALID');
  checkArea(input.areaEn, input.areaHi);
  checkFreeMin(input.freeDeliveryMinPaise);
  return db.transaction(async (tx) => {
    const [city] = await tx
      .select({ stateId: cities.stateId })
      .from(cities)
      .where(eq(cities.id, input.cityId))
      .limit(1);
    if (!city) throw new NotFoundError('City not found');
    await checkCentroid(tx, input.cityId, input.lat, input.lng);
    const [row] = await tx
      .insert(pincodes)
      .values({
        pincode: input.pincode,
        stateId: city.stateId,
        cityId: input.cityId,
        locality: input.areaEn,
        localityHi: input.areaHi,
        centroid: point(input.lat, input.lng),
        freeDeliveryMinPaise: input.freeDeliveryMinPaise,
        source: 'admin',
      })
      .onConflictDoNothing({ target: pincodes.pincode })
      .returning({ pincode: pincodes.pincode, version: pincodes.version });
    if (!row) throw new ConflictError('This PIN code is already listed', 'PINCODE_EXISTS');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'pincode.added',
      entity: 'pincode',
      entityId: input.pincode,
      before: null,
      after: {
        cityId: input.cityId,
        areaEn: input.areaEn,
        areaHi: input.areaHi,
        lat: input.lat,
        lng: input.lng,
        freeDeliveryMinPaise: input.freeDeliveryMinPaise,
      },
    });
    return row;
  });
}

/** The row as it is now, in the given city (404 otherwise: city scope, hard rule 3). */
async function current(tx: Tx, cityId: string, pincode: string) {
  if (!isPincode(pincode)) throw new NotFoundError('PIN code not found');
  const [row] = rowsOf<PincodeSqlRow>(
    await tx.execute(sql`
      select pincode, locality, locality_hi, ST_Y(centroid::geometry) as lat, ST_X(centroid::geometry) as lng, active,
        inactive_reason, inactive_note, source, free_delivery_min_paise, version, updated_at, 0 as shops_covering
      from pincodes where pincode = ${pincode} and city_id = ${cityId} for update`),
  );
  if (!row) throw new NotFoundError('PIN code not found');
  return {
    areaEn: row.locality,
    areaHi: row.locality_hi,
    lat: numOrNull(row.lat),
    lng: numOrNull(row.lng),
    active: row.active,
    inactiveReason: row.inactive_reason,
    inactiveNote: row.inactive_note,
    freeDeliveryMinPaise: numOrNull(row.free_delivery_min_paise),
    version: num(row.version),
  };
}

const stale = () =>
  new ConflictError('Someone else changed this PIN code; reload and try again', 'STALE_PINCODE');

/** Change the centroid, the area names and/or the free-delivery threshold (only the fields given). */
export async function updatePincode(
  db: Tx,
  input: {
    cityId: string;
    pincode: string;
    expectedVersion: number;
    centroid?: { lat: number; lng: number };
    area?: { en: string; hi: string };
    /** null clears the override (shop, then city setting applies). */
    freeDeliveryMinPaise?: number | null;
    staffUserId: string;
  },
): Promise<{ pincode: string; version: number }> {
  if (input.area) checkArea(input.area.en, input.area.hi);
  if (input.freeDeliveryMinPaise !== undefined) checkFreeMin(input.freeDeliveryMinPaise);
  return db.transaction(async (tx) => {
    const before = await current(tx, input.cityId, input.pincode);
    if (before.version !== input.expectedVersion) throw stale();
    if (input.centroid) await checkCentroid(tx, input.cityId, input.centroid.lat, input.centroid.lng);
    const [row] = await tx
      .update(pincodes)
      .set({
        source: 'admin',
        ...(input.centroid && { centroid: point(input.centroid.lat, input.centroid.lng) }),
        ...(input.area && { locality: input.area.en, localityHi: input.area.hi }),
        ...(input.freeDeliveryMinPaise !== undefined && { freeDeliveryMinPaise: input.freeDeliveryMinPaise }),
      })
      .where(
        and(
          eq(pincodes.pincode, input.pincode),
          eq(pincodes.cityId, input.cityId),
          eq(pincodes.version, input.expectedVersion),
        ),
      )
      .returning({ pincode: pincodes.pincode, version: pincodes.version });
    if (!row) throw stale();
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'pincode.updated',
      entity: 'pincode',
      entityId: input.pincode,
      before,
      after: {
        ...(input.centroid && { lat: input.centroid.lat, lng: input.centroid.lng }),
        ...(input.area && { areaEn: input.area.en, areaHi: input.area.hi }),
        ...(input.freeDeliveryMinPaise !== undefined && { freeDeliveryMinPaise: input.freeDeliveryMinPaise }),
        version: row.version,
      },
    });
    return row;
  });
}

/**
 * Switch a PIN code on or off. Off needs a reason code (and takes an optional note); on clears both. Existing
 * orders, shops and workshops keep the PIN; only new checkout, nearby searches, service requests and shop
 * coverage stop using it.
 */
export async function setPincodeActive(
  db: Tx,
  input: {
    cityId: string;
    pincode: string;
    expectedVersion: number;
    staffUserId: string;
  } & ({ active: true } | { active: false; reason: PincodeInactiveReason | null; note?: string | null }),
): Promise<{ pincode: string; version: number }> {
  const reason = input.active ? null : input.reason;
  const note = input.active ? null : (input.note?.trim() ?? '') || null;
  if (!input.active && (reason === null || !PINCODE_INACTIVE_REASONS.includes(reason)))
    throw new ValidationError('Choose why this PIN code is switched off', 'PINCODE_REASON');
  if (note !== null && note.length > PINCODE_NOTE_MAX)
    throw new ValidationError('The note is too long', 'PINCODE_REASON');
  return db.transaction(async (tx) => {
    const before = await current(tx, input.cityId, input.pincode);
    if (before.version !== input.expectedVersion) throw stale();
    if (input.active && (before.lat === null || before.lng === null))
      throw new ValidationError('Set where this PIN code is before switching it on', 'PINCODE_NO_CENTROID');
    const [row] = await tx
      .update(pincodes)
      .set({ active: input.active, inactiveReason: reason, inactiveNote: note, source: 'admin' })
      .where(
        and(
          eq(pincodes.pincode, input.pincode),
          eq(pincodes.cityId, input.cityId),
          eq(pincodes.version, input.expectedVersion),
        ),
      )
      .returning({ pincode: pincodes.pincode, version: pincodes.version });
    if (!row) throw stale();
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: input.active ? 'pincode.activated' : 'pincode.deactivated',
      entity: 'pincode',
      entityId: input.pincode,
      before: { active: before.active, reason: before.inactiveReason, note: before.inactiveNote },
      after: { active: input.active, reason, note, version: row.version },
      reason: reason ?? null,
    });
    return row;
  });
}
