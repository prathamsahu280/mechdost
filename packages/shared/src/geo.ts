/**
 * Service-area PIN codes (spec 15 "PIN codes", decision 2026-11-14). Zod-free on purpose: `packages/db` imports
 * these constants at runtime and must never load a Zod-building module (L101/L102). The API request schemas and
 * the web response schemas (`./geo-api`) are built from them.
 */

/** An Indian PIN code: six digits, never starting with 0. Same pattern as the `pincodes_format` CHECK. */
export const PINCODE_RE = /^[1-9][0-9]{5}$/;

/** Why a PIN code is switched off (a code, rule 16; the free-text note is optional). */
export const PINCODE_INACTIVE_REASONS = [
  'outside_service_area',
  'not_launched_yet',
  'no_partners',
  'operational_pause',
  'other',
] as const;
export type PincodeInactiveReason = (typeof PINCODE_INACTIVE_REASONS)[number];

/** Who last shaped the row: the reference data file (`seed`) or a person in the admin console (`admin`). */
export const PINCODE_SOURCES = ['seed', 'admin'] as const;
export type PincodeSource = (typeof PINCODE_SOURCES)[number];

/** Area name length (English and Hindi), same bounds as the `pincodes_locality_len` CHECK. */
export const PINCODE_AREA_MIN = 2;
export const PINCODE_AREA_MAX = 80;
/** Staff note on a switched-off PIN code. */
export const PINCODE_NOTE_MAX = 300;

/** A rough box around India: catches swapped or mistyped coordinates before they reach the map or distances. */
export const INDIA_BOUNDS = { minLat: 6, maxLat: 37.5, minLng: 68, maxLng: 97.5 } as const;

/** A PIN code's centroid must lie within this distance of its city's centre (catches a wrong city or a typo). */
export const PINCODE_MAX_KM_FROM_CITY = 150;

/** A Hindi area name must contain Devanagari (rule 10: "/hi" shows no English place names). */
export const DEVANAGARI_RE = /[\u0900-\u097F]/;

/** Highest free-delivery threshold an admin can set on a PIN code (₹1,00,000), same as the CHECK. */
export const FREE_DELIVERY_MAX_PAISE = 10_000_000;

export function isPincode(value: string): boolean {
  return PINCODE_RE.test(value);
}

export function inIndia(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= INDIA_BOUNDS.minLat &&
    lat <= INDIA_BOUNDS.maxLat &&
    lng >= INDIA_BOUNDS.minLng &&
    lng <= INDIA_BOUNDS.maxLng
  );
}
