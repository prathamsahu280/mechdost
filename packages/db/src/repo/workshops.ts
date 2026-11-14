import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type {
  CreateWorkshopInput,
  MenuItemInput,
  UpdateWorkshopInput,
  WorkshopHours,
} from '@mechdost/shared/service-requests';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { auditLog, partnerStatusEvents, pincodes, workshops, workshopServices } from '../schema';
import { ConflictError, ForbiddenError, mapPgError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { localized } from './localized';
import type { Tx } from './orders';
import { assertHomeFeeWithinCap } from './home-settings';
import { grantRole } from './rbac';
import type { CityScope } from './routing';
import { num, numOrNull, rowsOf } from './sql-rows';
import { findPasswordAccount } from './users';

/**
 * Workshops (spec 06, spec 08): staff create and edit workshops and their menus (the database starts empty), set
 * their standing (pause/suspend with a reason, history in `partner_status_events`) and give signed-up people access
 * to the workshop portal. Customers find **bookable** workshops — published, location verified, approved standing,
 * not busy — near a point or a PIN centroid (PostGIS `ST_DWithin`, nearest first by KNN on the GIST index).
 */
import type { ServiceLocale } from './service-requests';

/** Workshops in the caller's grants holding `permission` (workshop-scoped grants only). */
export function workshopIdsFrom(
  grants: readonly { permissions: readonly string[]; workshopId: string | null }[],
  permission: string,
): string[] {
  return [
    ...new Set(
      grants
        .filter((g) => g.workshopId !== null && g.permissions.includes(permission))
        .map((g) => g.workshopId)
        .filter((id): id is string => id !== null),
    ),
  ];
}

const inCities = (scope: CityScope, column: string) =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : sql`${sql.raw(column)} in (${sql.join(
          scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;

/** SQL predicate: the workshop can take a new request right now. */
export const BOOKABLE_SQL = sql.raw(
  `w.published and w.location_verified and w.status = 'approved' and not w.busy`,
);

export interface MenuItem {
  key: string;
  title: string;
  included: string | null;
  lowPaise: number;
  highPaise: number;
  minMinutes: number;
  maxMinutes: number;
  vehicleType: VehicleType | null;
  /** Can be done at the customer's home. */
  homeAvailable: boolean;
}

export interface NearbyWorkshop {
  id: string;
  slug: string;
  name: string;
  area: string;
  address: string;
  pincode: string;
  lat: number;
  lng: number;
  distanceKm: number;
  vehicleTypes: VehicleType[];
  evBasic: boolean;
  pickup: boolean;
  hours: WorkshopHours;
  ratingAvg: number | null;
  ratingCount: number;
  gstRegistered: boolean;
  /** Home servicing (null when the workshop does not do home visits). */
  home: { radiusKm: number; visitFeePaise: number } | null;
  services: MenuItem[];
}

interface MenuRow {
  workshop_id: string;
  key: string;
  title: string;
  title_hi: string | null;
  included: string | null;
  included_hi: string | null;
  low_paise: unknown;
  high_paise: unknown;
  min_minutes: unknown;
  max_minutes: unknown;
  vehicle_type: VehicleType | null;
  home_available: boolean;
}

async function activeMenus(db: Tx, ids: readonly string[], locale: ServiceLocale) {
  if (ids.length === 0) return new Map<string, MenuItem[]>();
  const rows = rowsOf<MenuRow>(
    await db.execute(sql`
      select workshop_id, key, title, title_hi, included, included_hi, low_paise, high_paise, min_minutes,
        max_minutes, vehicle_type, home_available
      from workshop_services
      where active and workshop_id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      order by workshop_id, sort_order, key`),
  );
  const out = new Map<string, MenuItem[]>();
  for (const r of rows) {
    const list = out.get(r.workshop_id) ?? [];
    list.push({
      key: r.key,
      title: localized(r.title, r.title_hi, locale),
      included: r.included === null ? null : localized(r.included, r.included_hi, locale),
      lowPaise: num(r.low_paise),
      highPaise: num(r.high_paise),
      minMinutes: num(r.min_minutes),
      maxMinutes: num(r.max_minutes),
      vehicleType: r.vehicle_type,
      homeAvailable: r.home_available,
    });
    out.set(r.workshop_id, list);
  }
  return out;
}

interface WorkshopRow {
  id: string;
  slug: string;
  name: string;
  name_hi: string | null;
  area: string;
  area_hi: string | null;
  address_line: string;
  address_line_hi: string | null;
  pincode: string;
  lat: unknown;
  lng: unknown;
  distance_m?: unknown;
  vehicle_types: VehicleType[];
  ev_basic: boolean;
  pickup: boolean;
  hours: WorkshopHours;
  rating_avg: unknown;
  rating_count: unknown;
  gst_registered: boolean;
  home_service: boolean;
  home_radius_km: unknown;
  home_visit_fee_paise: unknown;
}

const WORKSHOP_COLUMNS = sql.raw(`w.id, w.slug, w.name, w.name_hi, w.area, w.area_hi, w.address_line,
  w.address_line_hi, w.pincode, ST_Y(w.location::geometry) as lat, ST_X(w.location::geometry) as lng,
  w.vehicle_types, w.ev_basic, w.pickup, w.hours, w.rating_avg, w.rating_count, w.gst_registered,
  w.home_service, w.home_radius_km, w.home_visit_fee_paise`);

function toPublic(r: WorkshopRow, locale: ServiceLocale, services: MenuItem[]): NearbyWorkshop {
  return {
    id: r.id,
    slug: r.slug,
    name: localized(r.name, r.name_hi, locale),
    area: localized(r.area, r.area_hi, locale),
    address: localized(r.address_line, r.address_line_hi, locale),
    pincode: r.pincode,
    lat: num(r.lat),
    lng: num(r.lng),
    distanceKm: r.distance_m === undefined ? 0 : Math.round(num(r.distance_m) / 100) / 10,
    vehicleTypes: r.vehicle_types,
    evBasic: r.ev_basic,
    pickup: r.pickup,
    hours: r.hours,
    ratingAvg: numOrNull(r.rating_avg),
    ratingCount: num(r.rating_count),
    gstRegistered: r.gst_registered,
    home: r.home_service
      ? { radiusKm: num(r.home_radius_km), visitFeePaise: num(r.home_visit_fee_paise) }
      : null,
    services,
  };
}

/** The origin for a nearby search: the given point, or the PIN code's centroid (an inactive PIN reads as unknown). */
async function originOf(db: Tx, at: { lat: number; lng: number } | { pincode: string }) {
  if ('lat' in at) return at;
  const [p] = rowsOf<{ lat: unknown; lng: unknown }>(
    await db.execute(sql`select ST_Y(centroid::geometry) as lat, ST_X(centroid::geometry) as lng
      from pincodes where pincode = ${at.pincode} and active and centroid is not null`),
  );
  if (!p) throw new ValidationError('We do not know where this PIN code is yet', 'PINCODE_UNKNOWN');
  return { lat: num(p.lat), lng: num(p.lng) };
}

/**
 * Bookable workshops within `radiusKm` of a point or PIN centroid, nearest first (max 50), with their active menu.
 * Filters: vehicle type served, EV basics, pickup, a menu key offered.
 */
export async function findNearbyWorkshops(
  db: Tx,
  input: {
    at: { lat: number; lng: number } | { pincode: string };
    radiusKm: number;
    vehicleType?: VehicleType | null;
    ev?: boolean;
    pickup?: boolean;
    serviceKey?: string | null;
    /**
     * `home`: only workshops that opted in and whose own radius covers the point (the point must be a pin, not a PIN
     * code); the radius argument is ignored. Default `workshop`.
     */
    mode?: 'workshop' | 'home';
    locale: ServiceLocale;
  },
): Promise<{ origin: { lat: number; lng: number }; workshops: NearbyWorkshop[] }> {
  const home = input.mode === 'home';
  if (home && !('lat' in input.at))
    throw new ValidationError('Pin your address on the map to see home visits', 'HOME_NEEDS_PIN');
  const origin = await originOf(db, input.at);
  const point = sql`ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography`;
  const rows = rowsOf<WorkshopRow>(
    await db.execute(sql`
      select ${WORKSHOP_COLUMNS}, ST_Distance(w.location, ${point}) as distance_m
      from workshops w
      where ${BOOKABLE_SQL}
        and ${
          home
            ? // The GIST index serves the first, constant bound (the 25 km maximum); the second is each workshop's own radius.
              sql`w.home_service and ST_DWithin(w.location, ${point}, 25000)
                and ST_DWithin(w.location, ${point}, w.home_radius_km * 1000)
                and exists (select 1 from workshop_services h
                  where h.workshop_id = w.id and h.active and h.home_available
                    ${input.serviceKey ? sql`and h.key = ${input.serviceKey}` : sql``})`
            : sql`ST_DWithin(w.location, ${point}, ${Math.round(input.radiusKm * 1000)})`
        }
        ${input.vehicleType ? sql`and ${input.vehicleType} = any(w.vehicle_types)` : sql``}
        ${input.ev ? sql`and w.ev_basic` : sql``}
        ${input.pickup ? sql`and w.pickup` : sql``}
        ${
          input.serviceKey
            ? sql`and exists (select 1 from workshop_services s
                where s.workshop_id = w.id and s.active and s.key = ${input.serviceKey})`
            : sql``
        }
      order by w.location <-> ${point}, w.id
      limit 50`),
  );
  const menus = await activeMenus(
    db,
    rows.map((r) => r.id),
    input.locale,
  );
  return { origin, workshops: rows.map((r) => toPublic(r, input.locale, menus.get(r.id) ?? [])) };
}

/** A bookable workshop's public page with its active menu; anything else is 404. */
export async function getPublicWorkshop(
  db: Tx,
  slug: string,
  locale: ServiceLocale,
): Promise<NearbyWorkshop> {
  const [row] = rowsOf<WorkshopRow>(
    await db.execute(sql`select ${WORKSHOP_COLUMNS} from workshops w
      where w.slug = ${slug} and ${BOOKABLE_SQL} limit 1`),
  );
  if (!row) throw new NotFoundError('Workshop not found');
  const menus = await activeMenus(db, [row.id], locale);
  return toPublic(row, locale, menus.get(row.id) ?? []);
}

// ---------------------------------------------------------------------------------------------------------------
// Admin

export interface AdminWorkshop {
  id: string;
  cityId: string;
  slug: string;
  name: string;
  nameHi: string | null;
  addressLine: string;
  addressLineHi: string | null;
  area: string;
  areaHi: string | null;
  pincode: string;
  lat: number;
  lng: number;
  phone: string | null;
  vehicleTypes: VehicleType[];
  evBasic: boolean;
  pickup: boolean;
  hours: WorkshopHours;
  gstin: string | null;
  gstRegistered: boolean;
  locationVerified: boolean;
  published: boolean;
  status: 'approved' | 'paused' | 'suspended';
  statusReason: string | null;
  busy: boolean;
  homeService: boolean;
  homeRadiusKm: number;
  homeVisitFeePaise: number;
  version: number;
  /** Customer-visible English fields without Hindi (hard rule 10: flagged in the editor). */
  missingHindi: string[];
  menu: AdminMenuItem[];
}

export interface AdminMenuItem {
  key: string;
  title: string;
  titleHi: string | null;
  included: string | null;
  includedHi: string | null;
  lowPaise: number;
  highPaise: number;
  minMinutes: number;
  maxMinutes: number;
  vehicleType: VehicleType | null;
  active: boolean;
  homeAvailable: boolean;
}

async function cityOfPincode(tx: Tx, pincode: string): Promise<string> {
  const [p] = await tx
    .select({ cityId: pincodes.cityId })
    .from(pincodes)
    .where(eq(pincodes.pincode, pincode))
    .limit(1);
  if (!p?.cityId) throw new ValidationError('This PIN code is not in a MechDost city', 'PINCODE_NOT_SERVED');
  return p.cityId;
}

function assertInScope(scope: CityScope, cityId: string) {
  if (!scope.all && !scope.cityIds.includes(cityId)) throw new NotFoundError('City not found');
}

/**
 * Listing a workshop (published) or vouching for its pin (location verified) is an approval: the caller needs
 * `partners:approve` covering the workshop's city, not just somewhere (security review 2026-11-14).
 */
function assertCanApprove(
  approveScope: CityScope,
  cityId: string,
  w: { published?: boolean; locationVerified?: boolean },
) {
  if (w.published !== true && w.locationVerified !== true) return;
  if (!approveScope.all && !approveScope.cityIds.includes(cityId))
    throw new ForbiddenError(
      'Publishing a workshop or verifying its location needs approval rights in its city',
    );
}

async function saveMenu(tx: Tx, workshopId: string, menu: readonly MenuItemInput[]) {
  const keys = menu.map((m) => m.key);
  if (new Set(keys).size !== keys.length)
    throw new ValidationError('Menu keys must be unique', 'MENU_KEY_DUPLICATE');
  // Lines left out are switched off, not deleted: requests keep their snapshot and the key stays reserved.
  await tx
    .update(workshopServices)
    .set({ active: false })
    .where(
      keys.length === 0
        ? eq(workshopServices.workshopId, workshopId)
        : and(eq(workshopServices.workshopId, workshopId), notInArray(workshopServices.key, keys)),
    );
  for (const [i, m] of menu.entries()) {
    const values = {
      title: m.title,
      titleHi: m.titleHi ?? null,
      included: m.included ?? null,
      includedHi: m.includedHi ?? null,
      lowPaise: m.lowPaise,
      highPaise: m.highPaise,
      minMinutes: m.minMinutes,
      maxMinutes: m.maxMinutes,
      vehicleType: m.vehicleType ?? null,
      active: m.active,
      // Left out = keep what the workshop chose (an admin menu edit must not switch home services off).
      ...(m.homeAvailable !== undefined && { homeAvailable: m.homeAvailable }),
      sortOrder: i,
    };
    await tx
      .insert(workshopServices)
      .values({ workshopId, key: m.key, ...values })
      .onConflictDoUpdate({ target: [workshopServices.workshopId, workshopServices.key], set: values });
  }
}

async function auditWorkshop(
  tx: Tx,
  input: {
    staffUserId: string;
    action: string;
    workshopId: string;
    after: Record<string, unknown>;
    reason?: string;
  },
) {
  await tx.insert(auditLog).values({
    actorUserId: input.staffUserId,
    actorRole: 'admin',
    action: input.action,
    entity: 'workshop',
    entityId: input.workshopId,
    after: input.after,
    reason: input.reason ?? null,
  });
}

/** Staff add a workshop with its menu. The city comes from the PIN code and must be in the caller's scope. */
export async function createWorkshop(
  db: Tx,
  input: { scope: CityScope; approveScope: CityScope; staffUserId: string; workshop: CreateWorkshopInput },
): Promise<{ id: string; slug: string; version: number }> {
  const w = input.workshop;
  return db.transaction(async (tx) => {
    const cityId = await cityOfPincode(tx, w.pincode);
    assertInScope(input.scope, cityId);
    assertCanApprove(input.approveScope, cityId, w);
    let row: { id: string; slug: string; version: number } | undefined;
    try {
      [row] = await tx.transaction(async (sp) =>
        sp
          .insert(workshops)
          .values({
            cityId,
            slug: w.slug,
            name: w.name,
            nameHi: w.nameHi ?? null,
            addressLine: w.addressLine,
            addressLineHi: w.addressLineHi ?? null,
            area: w.area,
            areaHi: w.areaHi ?? null,
            pincode: w.pincode,
            location: { lat: w.lat, lng: w.lng },
            phone: w.phone ?? null,
            vehicleTypes: [...w.vehicleTypes],
            evBasic: w.evBasic,
            pickup: w.pickup,
            hours: w.hours,
            gstin: w.gstin ?? null,
            gstRegistered: Boolean(w.gstin),
            locationVerified: w.locationVerified,
            published: w.published,
            createdBy: input.staffUserId,
          })
          .returning({ id: workshops.id, slug: workshops.slug, version: workshops.version }),
      );
    } catch (err) {
      if (pgCode(err) === '23505') throw new ConflictError('That web address is already used', 'SLUG_TAKEN');
      mapPgError(err);
    }
    if (!row) throw new Error('workshop insert returned no row');
    await saveMenu(tx, row.id, w.menu);
    await auditWorkshop(tx, {
      staffUserId: input.staffUserId,
      action: 'workshop.created',
      workshopId: row.id,
      after: { slug: w.slug, published: w.published, menu: w.menu.length },
    });
    await recordServerEvent(tx, 'admin_workshop_saved', {
      userId: input.staffUserId,
      cityId,
      props: { workshopId: row.id, action: 'created', published: w.published },
    });
    return row;
  });
}

async function scopedWorkshop(tx: Tx, scope: CityScope, workshopId: string, lock: boolean) {
  const q = tx
    .select({
      id: workshops.id,
      cityId: workshops.cityId,
      status: workshops.status,
      version: workshops.version,
      published: workshops.published,
      locationVerified: workshops.locationVerified,
    })
    .from(workshops)
    .where(eq(workshops.id, workshopId))
    .limit(1);
  const [w] = lock ? await q.for('update') : await q;
  if (!w) throw new NotFoundError('Workshop not found');
  assertInScope(scope, w.cityId);
  return w;
}

/** Edit any subset of fields (compare-and-set on `version`); `menu`, when given, replaces the menu by key. */
export async function updateWorkshop(
  db: Tx,
  input: {
    scope: CityScope;
    approveScope: CityScope;
    staffUserId: string;
    workshopId: string;
    patch: UpdateWorkshopInput;
  },
): Promise<{ id: string; version: number }> {
  const p = input.patch;
  return db.transaction(async (tx) => {
    const current = await scopedWorkshop(tx, input.scope, input.workshopId, true);
    const cityId = p.pincode ? await cityOfPincode(tx, p.pincode) : current.cityId;
    assertInScope(input.scope, cityId);
    const set: Partial<typeof workshops.$inferInsert> = {
      ...(p.name !== undefined && { name: p.name }),
      ...(p.nameHi !== undefined && { nameHi: p.nameHi }),
      ...(p.addressLine !== undefined && { addressLine: p.addressLine }),
      ...(p.addressLineHi !== undefined && { addressLineHi: p.addressLineHi }),
      ...(p.area !== undefined && { area: p.area }),
      ...(p.areaHi !== undefined && { areaHi: p.areaHi }),
      ...(p.pincode !== undefined && { pincode: p.pincode, cityId }),
      ...(p.lat !== undefined && p.lng !== undefined && { location: { lat: p.lat, lng: p.lng } }),
      ...(p.phone !== undefined && { phone: p.phone }),
      ...(p.vehicleTypes !== undefined && { vehicleTypes: [...p.vehicleTypes] }),
      ...(p.evBasic !== undefined && { evBasic: p.evBasic }),
      ...(p.pickup !== undefined && { pickup: p.pickup }),
      ...(p.hours !== undefined && { hours: p.hours }),
      ...(p.gstin !== undefined && { gstin: p.gstin, gstRegistered: p.gstin !== null }),
      ...(p.locationVerified !== undefined && { locationVerified: p.locationVerified }),
      ...(p.published !== undefined && { published: p.published }),
      ...(p.busy !== undefined && { busy: p.busy }),
      ...(p.homeService !== undefined && { homeService: p.homeService }),
      ...(p.homeRadiusKm !== undefined && { homeRadiusKm: p.homeRadiusKm }),
      ...(p.homeVisitFeePaise !== undefined && { homeVisitFeePaise: p.homeVisitFeePaise }),
    };
    if (p.homeVisitFeePaise !== undefined) await assertHomeFeeWithinCap(tx, cityId, p.homeVisitFeePaise);
    // A moved workshop must be checked on the map again before it is listed (spec 06 "location_verified").
    if (set.location && p.locationVerified === undefined) {
      set.locationVerified = false;
      set.published = false;
    }
    // Approval is checked on the resulting state: setting the flags, or keeping them while moving to another city.
    const movedCity = cityId !== current.cityId;
    assertCanApprove(input.approveScope, cityId, {
      published: set.published ?? (movedCity ? current.published : undefined),
      locationVerified: set.locationVerified ?? (movedCity ? current.locationVerified : undefined),
    });
    let row: { id: string; version: number } | undefined;
    try {
      [row] = await tx.transaction(async (sp) =>
        sp
          .update(workshops)
          // An empty patch still bumps `version` (touching `updated_at`), so the CAS stays meaningful.
          .set({ ...set, updatedAt: new Date() })
          .where(and(eq(workshops.id, current.id), eq(workshops.version, p.version)))
          .returning({ id: workshops.id, version: workshops.version }),
      );
    } catch (err) {
      mapPgError(err);
    }
    if (!row)
      throw new ConflictError('The workshop changed meanwhile; reload and try again', 'STALE_WORKSHOP');
    if (p.menu) await saveMenu(tx, row.id, p.menu);
    const published = set.published ?? current.published;
    await auditWorkshop(tx, {
      staffUserId: input.staffUserId,
      action: 'workshop.updated',
      workshopId: row.id,
      after: { fields: Object.keys(set), menu: p.menu?.length ?? null },
    });
    await recordServerEvent(tx, 'admin_workshop_saved', {
      userId: input.staffUserId,
      cityId,
      props: { workshopId: row.id, action: 'updated', published },
    });
    return row;
  });
}

/** Pause, suspend or reactivate with a reason (history kept, decision 2026-11-01). */
export async function setWorkshopStanding(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    workshopId: string;
    status: 'approved' | 'paused' | 'suspended';
    reason: string;
    expectedVersion: number;
  },
): Promise<{ status: string; version: number }> {
  return db.transaction(async (tx) => {
    const current = await scopedWorkshop(tx, input.scope, input.workshopId, true);
    if (current.status === input.status)
      throw new ConflictError(`The workshop is already ${input.status}`, 'SAME_STANDING');
    const [row] = await tx
      .update(workshops)
      .set({
        status: input.status,
        statusReason: input.status === 'approved' ? null : input.reason,
        statusChangedBy: input.staffUserId,
        statusChangedAt: new Date(),
      })
      .where(
        and(
          eq(workshops.id, current.id),
          eq(workshops.status, current.status),
          eq(workshops.version, input.expectedVersion),
        ),
      )
      .returning({ status: workshops.status, version: workshops.version });
    if (!row)
      throw new ConflictError('The workshop changed meanwhile; reload and try again', 'STALE_WORKSHOP');
    await tx.insert(partnerStatusEvents).values({
      partnerKind: 'workshop',
      partnerId: current.id,
      fromStatus: current.status,
      toStatus: input.status,
      reason: input.reason,
      changedBy: input.staffUserId,
    });
    await auditWorkshop(tx, {
      staffUserId: input.staffUserId,
      action: 'workshop.standing',
      workshopId: current.id,
      after: { from: current.status, to: input.status },
      reason: input.reason,
    });
    return row;
  });
}

/** Give a signed-up person (found by phone) owner or staff access to a workshop's portal. Idempotent. */
export async function addWorkshopMember(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    workshopId: string;
    phone: string;
    role: 'workshop_owner' | 'workshop_staff';
  },
): Promise<{ userId: string }> {
  await scopedWorkshop(db, input.scope, input.workshopId, false);
  const account = await findPasswordAccount(db, { kind: 'phone', value: input.phone });
  if (!account) throw new NotFoundError('No account uses this phone number; the person signs up first');
  await grantRole(db, {
    userId: account.userId,
    role: input.role,
    workshopId: input.workshopId,
    grantedBy: input.staffUserId,
    reason: 'workshop member added by staff',
  });
  return { userId: account.userId };
}

interface AdminRow extends WorkshopRow {
  city_id: string;
  phone: string | null;
  gstin: string | null;
  location_verified: boolean;
  published: boolean;
  status: 'approved' | 'paused' | 'suspended';
  status_reason: string | null;
  busy: boolean;
  version: unknown;
}

const ADMIN_COLUMNS = sql.raw(`w.city_id, w.phone, w.gstin, w.location_verified, w.published, w.status,
  w.status_reason, w.busy, w.version`);

function missingHindiOf(r: AdminRow, menu: AdminWorkshop['menu']): string[] {
  const out: string[] = [];
  if (!r.name_hi) out.push('name');
  if (!r.address_line_hi) out.push('addressLine');
  if (!r.area_hi) out.push('area');
  for (const m of menu) {
    if (!m.active) continue;
    if (!m.titleHi) out.push(`menu.${m.key}.title`);
    if (m.included && !m.includedHi) out.push(`menu.${m.key}.included`);
  }
  return out;
}

async function adminMenus(db: Tx, ids: readonly string[]) {
  const rows =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(workshopServices)
          .where(inArray(workshopServices.workshopId, [...ids]))
          .orderBy(asc(workshopServices.sortOrder), asc(workshopServices.key));
  const out = new Map<string, AdminWorkshop['menu']>();
  for (const r of rows) {
    const list = out.get(r.workshopId) ?? [];
    list.push({
      key: r.key,
      title: r.title,
      titleHi: r.titleHi,
      included: r.included,
      includedHi: r.includedHi,
      lowPaise: r.lowPaise,
      highPaise: r.highPaise,
      minMinutes: r.minMinutes,
      maxMinutes: r.maxMinutes,
      vehicleType: r.vehicleType as VehicleType | null,
      active: r.active,
      homeAvailable: r.homeAvailable,
    });
    out.set(r.workshopId, list);
  }
  return out;
}

function toAdmin(r: AdminRow, menu: AdminWorkshop['menu']): AdminWorkshop {
  return {
    id: r.id,
    cityId: r.city_id,
    slug: r.slug,
    name: r.name,
    nameHi: r.name_hi,
    addressLine: r.address_line,
    addressLineHi: r.address_line_hi,
    area: r.area,
    areaHi: r.area_hi,
    pincode: r.pincode,
    lat: num(r.lat),
    lng: num(r.lng),
    phone: r.phone,
    vehicleTypes: r.vehicle_types,
    evBasic: r.ev_basic,
    pickup: r.pickup,
    hours: r.hours,
    gstin: r.gstin,
    gstRegistered: r.gst_registered,
    locationVerified: r.location_verified,
    published: r.published,
    status: r.status,
    statusReason: r.status_reason,
    busy: r.busy,
    homeService: r.home_service,
    homeRadiusKm: num(r.home_radius_km),
    homeVisitFeePaise: num(r.home_visit_fee_paise),
    version: num(r.version),
    missingHindi: missingHindiOf(r, menu),
    menu,
  };
}

/** Every workshop in the caller's cities (bounded: a city has tens of workshops at launch), by name. */
export async function listAdminWorkshops(db: Tx, scope: CityScope): Promise<AdminWorkshop[]> {
  const rows = rowsOf<AdminRow>(
    await db.execute(sql`select ${WORKSHOP_COLUMNS}, ${ADMIN_COLUMNS} from workshops w
      where ${inCities(scope, 'w.city_id')} order by w.name, w.id limit 500`),
  );
  const menus = await adminMenus(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toAdmin(r, menus.get(r.id) ?? []));
}

export async function getAdminWorkshop(db: Tx, scope: CityScope, workshopId: string): Promise<AdminWorkshop> {
  const [row] = rowsOf<AdminRow>(
    await db.execute(sql`select ${WORKSHOP_COLUMNS}, ${ADMIN_COLUMNS} from workshops w
      where w.id = ${workshopId} and ${inCities(scope, 'w.city_id')} limit 1`),
  );
  if (!row) throw new NotFoundError('Workshop not found');
  const menus = await adminMenus(db, [row.id]);
  return toAdmin(row, menus.get(row.id) ?? []);
}
