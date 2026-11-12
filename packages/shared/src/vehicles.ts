/**
 * Vehicle types: two-wheelers, three-wheelers and cars are first-class everywhere (decision 2026-11-11).
 * The codes match the database CHECKs on `vehicle_models.vehicle_type` and `vehicles.type`.
 * Electric is a fuel, not a type: an e-rickshaw is a `3W` with fuel `electric`.
 * No Zod here on purpose: browser islands import this file and must stay inside the JS budget (spec 16).
 */
export const VEHICLE_TYPES = ['2W', '3W', '4W'] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number];

export function isVehicleType(value: unknown): value is VehicleType {
  return typeof value === 'string' && (VEHICLE_TYPES as readonly string[]).includes(value);
}

/** Locale key of each type's label; every namespace that names vehicle types uses these three keys. */
export const VEHICLE_LABEL_KEY: Record<VehicleType, 'twoWheeler' | 'threeWheeler' | 'fourWheeler'> = {
  '2W': 'twoWheeler',
  '3W': 'threeWheeler',
  '4W': 'fourWheeler',
};

/** Decorative icon per type (always `aria-hidden`; the label carries the meaning). */
export const VEHICLE_ICON: Record<VehicleType, string> = {
  '2W': '🛵',
  '3W': '🛺',
  '4W': '🚗',
};
