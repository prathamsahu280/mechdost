/**
 * Customer account rules (spec 01 "Saved addresses, vehicles, profile"; design 2026-11-15). Zod-free on purpose:
 * the database layer imports these (learnings L101/L102); the request/response schemas live in `account-api.ts`.
 * Codes (labels, fuels) are enums, free text is only an extra (hard rule 16).
 */
import { cleanLine } from './text';

export const ADDRESS_LABELS = ['home', 'work', 'garage', 'other'] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

/** Same codes as the `vehicles_fuel_valid` CHECK. */
export const VEHICLE_FUELS = ['petrol', 'diesel', 'cng_lpg', 'hybrid', 'electric'] as const;
export type VehicleFuel = (typeof VEHICLE_FUELS)[number];

/** Saved addresses and saved vehicles per customer (spec 01). */
export const MAX_ACCOUNT_ITEMS = 10;

export const NAME_MIN = 2;
export const NAME_MAX = 60;
export const CONTACT_NAME_MAX = 80;
export const ADDRESS_LINE_MIN = 5;
export const ADDRESS_LINE_MAX = 200;
export const LANDMARK_MAX = 100;
export const VEHICLE_MAKE_MAX = 40;
export const VEHICLE_MODEL_MAX = 60;
export const VEHICLE_VARIANT_MAX = 60;
export const VEHICLE_YEAR_MIN = 1980;
export const ODOMETER_MAX_KM = 999_999;

/** Indian vehicle registration after normalising: 4–12 letters/digits (e.g. `CG04AB1234`, `22BH1234AA`). */
const REGISTRATION = /^[A-Z0-9]{4,12}$/;

/** Upper-case, without spaces and dashes; null when it is not a plausible registration number. */
export function normaliseRegistration(raw: string): string | null {
  const value = raw
    .normalize('NFKC')
    .replace(/[\s-]+/g, '')
    .toUpperCase();
  return REGISTRATION.test(value) ? value : null;
}

/** A person's name as stored: NFKC, control/invisible characters dropped, whitespace collapsed (spec 01: 2–60). */
export function cleanPersonName(raw: string, max = NAME_MAX): string {
  return cleanLine(raw.normalize('NFKC'), max);
}

/** The next calendar year is the newest model year a vehicle can have. */
export function maxVehicleYear(now: Date = new Date()): number {
  return now.getUTCFullYear() + 1;
}
