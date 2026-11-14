/**
 * Request and response shapes of `/v1/me/addresses`, `/v1/me/vehicles` and `PATCH /v1/me` (design 2026-11-15), for
 * the API routes and the website (hard rule 4). Bodies are strict: no unknown field is accepted (no mass assignment);
 * city and state are never sent by the client, the server derives them from the PIN.
 */
import { z } from 'zod';
import {
  ADDRESS_LABELS,
  ADDRESS_LINE_MAX,
  ADDRESS_LINE_MIN,
  CONTACT_NAME_MAX,
  LANDMARK_MAX,
  NAME_MAX,
  NAME_MIN,
  ODOMETER_MAX_KM,
  VEHICLE_FUELS,
  VEHICLE_MAKE_MAX,
  VEHICLE_MODEL_MAX,
  VEHICLE_VARIANT_MAX,
  VEHICLE_YEAR_MIN,
  cleanPersonName,
  maxVehicleYear,
  normaliseRegistration,
} from './account';
import { PINCODE_RE } from './geo';
import { cleanLine } from './text';
import { VEHICLE_TYPES } from './vehicles';

const Version = z.number().int().min(1);
/** Text is cleaned first, then length-checked: too long is refused, never silently cut. */
const CLEAN_CAP = 1000;
const line = (min: number, max: number) =>
  z
    .string()
    .transform((v) => cleanLine(v, CLEAN_CAP))
    .pipe(z.string().min(min).max(max));
/** Optional text: empty after cleaning means "none" (null). */
const optionalLine = (max: number) =>
  z
    .string()
    .nullable()
    .transform((v) => {
      const cleaned = v === null ? '' : cleanLine(v, CLEAN_CAP);
      return cleaned === '' ? null : cleaned;
    })
    .pipe(z.string().max(max).nullable());
const Phone = z.string().regex(/^\+[1-9][0-9]{7,14}$/, 'Phone must be in international format');
const Pincode = z.string().regex(PINCODE_RE, 'PIN must be six digits');

// ── Profile ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Display name 2–60 characters after cleaning; language for emails and push. */
export const ProfilePatchDto = z
  .object({
    version: Version,
    name: z
      .string()
      .transform((v) => cleanPersonName(v, CLEAN_CAP))
      .pipe(z.string().min(NAME_MIN).max(NAME_MAX))
      .optional(),
    language: z.enum(['en', 'hi']).optional(),
  })
  .strict()
  .refine((b) => b.name !== undefined || b.language !== undefined, { message: 'Nothing to update' });

// ── Addresses ─────────────────────────────────────────────────────────────────────────────────────────────────

const Lat = z.number().min(-90).max(90).nullable();
const Lng = z.number().min(-180).max(180).nullable();

/** Both of lat and lng, or neither; both null removes the map pin. */
const pointTogether = (b: { lat?: number | null; lng?: number | null }) =>
  (b.lat === undefined) === (b.lng === undefined) && (b.lat === null) === (b.lng === null);

export const AddressCreateDto = z
  .object({
    label: z.enum(ADDRESS_LABELS).default('home'),
    contactName: line(NAME_MIN, CONTACT_NAME_MAX),
    contactPhone: Phone,
    line1: line(ADDRESS_LINE_MIN, ADDRESS_LINE_MAX),
    line2: optionalLine(ADDRESS_LINE_MAX).optional(),
    landmark: optionalLine(LANDMARK_MAX).optional(),
    pincode: Pincode,
    lat: Lat.optional(),
    lng: Lng.optional(),
    isDefaultShipping: z.boolean().optional(),
    isDefaultBilling: z.boolean().optional(),
  })
  .strict()
  .refine(pointTogether, { message: 'Give both lat and lng, or neither' });
export type AddressCreate = z.infer<typeof AddressCreateDto>;

/** Edit: the version you last read plus any of the fields. */
export const AddressPatchDto = z
  .object({
    version: Version,
    label: z.enum(ADDRESS_LABELS).optional(),
    contactName: line(NAME_MIN, CONTACT_NAME_MAX).optional(),
    contactPhone: Phone.optional(),
    line1: line(ADDRESS_LINE_MIN, ADDRESS_LINE_MAX).optional(),
    line2: optionalLine(ADDRESS_LINE_MAX).optional(),
    landmark: optionalLine(LANDMARK_MAX).optional(),
    pincode: Pincode.optional(),
    lat: Lat.optional(),
    lng: Lng.optional(),
  })
  .strict()
  .refine(pointTogether, { message: 'Give both lat and lng, or neither' })
  .refine((b) => Object.keys(b).some((k) => k !== 'version'), { message: 'Nothing to update' });
export type AddressPatch = z.infer<typeof AddressPatchDto>;

/** Make this address the default for shipping (the default) or billing; the old default is cleared with it. */
export const AddressDefaultDto = z
  .object({ version: Version, kind: z.enum(['shipping', 'billing']).default('shipping') })
  .strict();

export const AddressDto = z.object({
  id: z.string(),
  label: z.enum(ADDRESS_LABELS),
  contactName: z.string(),
  contactPhone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  landmark: z.string().nullable(),
  pincode: z.string(),
  /** Derived from the PIN on the server; names follow the requested locale. */
  cityName: z.string().nullable(),
  stateName: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  isDefaultShipping: z.boolean(),
  isDefaultBilling: z.boolean(),
  /** False when the PIN is outside a live city or switched off: checkout says "not delivered here yet". */
  serviceable: z.boolean(),
  version: z.number().int(),
});
export type SavedAddress = z.infer<typeof AddressDto>;

export const AddressesDto = z.object({ addresses: z.array(AddressDto) });
export type SavedAddresses = z.infer<typeof AddressesDto>;

// ── Vehicles ──────────────────────────────────────────────────────────────────────────────────────────────────

const Registration = z.string().transform((v, ctx) => {
  const registration = normaliseRegistration(v);
  if (registration === null) {
    ctx.addIssue({ code: 'custom', message: 'Not a valid registration number' });
    return z.NEVER;
  }
  return registration;
});
const Year = z.number().int().min(VEHICLE_YEAR_MIN).max(maxVehicleYear());
const Odometer = z.number().int().min(0).max(ODOMETER_MAX_KM);

export const VehicleCreateDto = z
  .object({
    type: z.enum(VEHICLE_TYPES),
    fuel: z.enum(VEHICLE_FUELS),
    make: line(2, VEHICLE_MAKE_MAX),
    model: line(1, VEHICLE_MODEL_MAX),
    variant: optionalLine(VEHICLE_VARIANT_MAX).optional(),
    year: Year.nullable().optional(),
    registration: Registration.nullable().optional(),
    odometerKm: Odometer.nullable().optional(),
  })
  .strict();
export type VehicleCreate = z.infer<typeof VehicleCreateDto>;

export const VehiclePatchDto = z
  .object({
    version: Version,
    type: z.enum(VEHICLE_TYPES).optional(),
    fuel: z.enum(VEHICLE_FUELS).optional(),
    make: line(2, VEHICLE_MAKE_MAX).optional(),
    model: line(1, VEHICLE_MODEL_MAX).optional(),
    variant: optionalLine(VEHICLE_VARIANT_MAX).optional(),
    year: Year.nullable().optional(),
    registration: Registration.nullable().optional(),
    odometerKm: Odometer.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).some((k) => k !== 'version'), { message: 'Nothing to update' });
export type VehiclePatch = z.infer<typeof VehiclePatchDto>;

export const VehicleDto = z.object({
  id: z.string(),
  type: z.enum(VEHICLE_TYPES),
  fuel: z.enum(VEHICLE_FUELS),
  make: z.string(),
  model: z.string(),
  variant: z.string().nullable(),
  year: z.number().int().nullable(),
  registration: z.string().nullable(),
  odometerKm: z.number().int().nullable(),
  version: z.number().int(),
});
export type SavedVehicle = z.infer<typeof VehicleDto>;

export const VehiclesDto = z.object({ vehicles: z.array(VehicleDto) });
export type SavedVehicles = z.infer<typeof VehiclesDto>;

export const DeletedDto = z.object({ deleted: z.literal(true) });

/** The part of `GET/PATCH /v1/me` the profile screen needs (phone and email are shown, never edited here). */
export const ProfileDto = z.object({
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  language: z.enum(['en', 'hi']),
  version: z.number().int(),
});
export type MyProfile = z.infer<typeof ProfileDto>;
