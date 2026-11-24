import { and, eq, inArray } from 'drizzle-orm';
import { defaultRsaSettings, rsaOpenAt, type RsaProblemType, type RsaSettings } from '@mechdost/shared/rsa';
import type { RsaSettingsInputT } from '@mechdost/shared/rsa-api';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { auditLog, cities, pincodes, rsaCitySettings } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Per-city roadside settings (spec 22, spec 08): which PIN codes, hours, vehicle types, advance per type, accept timer,
 * routing mode, problem types and SOS phone. One typed row per city (the int/boolean registry cannot hold lists),
 * edited by staff with `roadside:settings`, compare-and-set on `version`, audited. No row = the defaults (switched off).
 */
type Row = typeof rsaCitySettings.$inferSelect;

function toSettings(r: Row): RsaSettings {
  const advance = r.advancePaise as Record<string, unknown>;
  const advancePaise: RsaSettings['advancePaise'] = {};
  for (const t of r.vehicleTypes as VehicleType[]) {
    const v = advance[t];
    if (typeof v === 'number') advancePaise[t] = v;
  }
  return {
    enabled: r.enabled,
    vehicleTypes: r.vehicleTypes as VehicleType[],
    advancePaise,
    pincodes: r.pincodes,
    alwaysOpen: r.alwaysOpen,
    opensAtMinute: r.opensAtMinute,
    closesAtMinute: r.closesAtMinute,
    routingMode: r.routingMode as RsaSettings['routingMode'],
    acceptTimerSeconds: r.acceptTimerSeconds,
    maxAutoAttempts: r.maxAutoAttempts,
    problemTypes: r.problemTypes as RsaProblemType[],
    sosPhone: r.sosPhone,
    version: r.version,
  };
}

export async function getRsaSettings(db: Tx, cityId: string): Promise<RsaSettings> {
  const [row] = await db.select().from(rsaCitySettings).where(eq(rsaCitySettings.cityId, cityId)).limit(1);
  return row ? toSettings(row) : defaultRsaSettings();
}

export async function saveRsaSettings(
  db: Tx,
  input: { cityId: string; staffUserId: string; settings: RsaSettingsInputT },
): Promise<RsaSettings> {
  const s = input.settings;
  return db.transaction(async (tx) => {
    const [city] = await tx
      .select({ id: cities.id })
      .from(cities)
      .where(eq(cities.id, input.cityId))
      .limit(1);
    if (!city) throw new NotFoundError('City not found');
    if (s.pincodes.length > 0) {
      const known = await tx
        .select({ pincode: pincodes.pincode })
        .from(pincodes)
        .where(
          and(
            inArray(pincodes.pincode, s.pincodes),
            eq(pincodes.cityId, input.cityId),
            eq(pincodes.active, true),
          ),
        );
      const have = new Set(known.map((k) => k.pincode));
      const missing = s.pincodes.filter((p) => !have.has(p));
      if (missing.length > 0)
        throw new ValidationError('A PIN code is not active in this city', 'RSA_PINCODE_UNKNOWN', {
          pincodes: missing,
        });
    }
    const values = {
      enabled: s.enabled,
      vehicleTypes: s.vehicleTypes,
      advancePaise: s.advancePaise,
      pincodes: s.pincodes,
      alwaysOpen: s.alwaysOpen,
      opensAtMinute: s.opensAtMinute,
      closesAtMinute: s.closesAtMinute,
      routingMode: s.routingMode,
      acceptTimerSeconds: s.acceptTimerSeconds,
      maxAutoAttempts: s.maxAutoAttempts,
      problemTypes: s.problemTypes,
      sosPhone: s.sosPhone,
      updatedBy: input.staffUserId,
    };
    const before = await getRsaSettings(tx, input.cityId);
    let row: Row | undefined;
    if (s.version === 0) {
      [row] = await tx
        .insert(rsaCitySettings)
        .values({ cityId: input.cityId, ...values })
        .onConflictDoNothing()
        .returning();
    } else {
      [row] = await tx
        .update(rsaCitySettings)
        .set(values)
        .where(and(eq(rsaCitySettings.cityId, input.cityId), eq(rsaCitySettings.version, s.version)))
        .returning();
    }
    if (!row)
      throw new ConflictError('The settings changed meanwhile; reload and try again', 'STALE_SETTINGS');
    const after = toSettings(row);
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'rsa.settings_saved',
      entity: 'rsa_city_settings',
      entityId: input.cityId,
      before: { ...before },
      after: { ...after },
    });
    await recordServerEvent(tx, 'admin_rsa_settings_saved', {
      userId: input.staffUserId,
      cityId: input.cityId,
      props: {
        cityId: input.cityId,
        enabled: after.enabled,
        vehicleTypes: after.vehicleTypes.length,
        pincodes: after.pincodes.length,
      },
    });
    return after;
  });
}

/**
 * Can this city take this request now? Throws a `ValidationError` with a code the page turns into a calm message plus
 * the call and WhatsApp buttons: `RSA_NOT_AVAILABLE` (switched off), `RSA_OUT_OF_AREA` (PIN not on the list),
 * `RSA_CLOSED` (outside the hours), `RSA_VEHICLE_NOT_OFFERED` (3W is not offered at launch), `RSA_PROBLEM_NOT_OFFERED`.
 */
export function assertRsaServiceable(
  settings: RsaSettings,
  input: { pincode: string; vehicleType: VehicleType; problemType: RsaProblemType | null; now: Date },
): void {
  if (!settings.enabled)
    throw new ValidationError('Roadside help is not available here yet', 'RSA_NOT_AVAILABLE');
  if (!settings.pincodes.includes(input.pincode))
    throw new ValidationError('Roadside help does not cover this area yet', 'RSA_OUT_OF_AREA');
  if (!rsaOpenAt(settings, input.now))
    throw new ValidationError('Roadside help is closed at this hour', 'RSA_CLOSED');
  if (!settings.vehicleTypes.includes(input.vehicleType))
    throw new ValidationError(
      'Roadside help is not offered for this vehicle type',
      'RSA_VEHICLE_NOT_OFFERED',
    );
  if (input.problemType && !settings.problemTypes.includes(input.problemType))
    throw new ValidationError('This problem type is not offered', 'RSA_PROBLEM_NOT_OFFERED');
}

export interface RsaAvailability {
  available: boolean;
  /** The refusal code or null. */
  reason: 'RSA_NOT_AVAILABLE' | 'RSA_OUT_OF_AREA' | 'RSA_CLOSED' | null;
  cityCode: string | null;
  vehicleTypes: VehicleType[];
  advancePaise: Partial<Record<VehicleType, number>>;
  problemTypes: RsaProblemType[];
  sosPhone: string | null;
  alwaysOpen: boolean;
  opensAtMinute: number;
  closesAtMinute: number;
}

/**
 * What the request page needs before sign-in: whether this PIN code is covered right now and, if so, the offered vehicle
 * types with their advance, the problem types and the SOS phone. Read-only and cacheable; never any request data.
 */
export async function getRsaAvailability(
  db: Tx,
  input: { pincode: string; now?: Date },
): Promise<RsaAvailability> {
  const [place] = await db
    .select({ cityId: pincodes.cityId, cityCode: cities.code })
    .from(pincodes)
    .innerJoin(cities, eq(cities.id, pincodes.cityId))
    .where(and(eq(pincodes.pincode, input.pincode), eq(pincodes.active, true)))
    .limit(1);
  if (!place?.cityId)
    return {
      available: false,
      reason: 'RSA_OUT_OF_AREA',
      cityCode: null,
      vehicleTypes: [],
      advancePaise: {},
      problemTypes: [],
      sosPhone: null,
      alwaysOpen: true,
      opensAtMinute: 0,
      closesAtMinute: 0,
    };
  const s = await getRsaSettings(db, place.cityId);
  const reason = !s.enabled
    ? 'RSA_NOT_AVAILABLE'
    : !s.pincodes.includes(input.pincode)
      ? 'RSA_OUT_OF_AREA'
      : !rsaOpenAt(s, input.now ?? new Date())
        ? 'RSA_CLOSED'
        : null;
  return {
    available: reason === null,
    reason,
    cityCode: place.cityCode,
    vehicleTypes: s.vehicleTypes,
    advancePaise: s.advancePaise,
    problemTypes: s.problemTypes,
    sosPhone: s.sosPhone,
    alwaysOpen: s.alwaysOpen,
    opensAtMinute: s.opensAtMinute,
    closesAtMinute: s.closesAtMinute,
  };
}
