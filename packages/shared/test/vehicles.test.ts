import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import hi from '../src/i18n/hi.json';
import { VEHICLE_ICON, VEHICLE_LABEL_KEY, VEHICLE_TYPES, isVehicleType } from '../src/vehicles';

describe('vehicle types (decision 2026-11-11: 2W, 3W and 4W are first-class)', () => {
  it('has exactly the codes the database CHECKs allow', () => {
    expect(VEHICLE_TYPES).toEqual(['2W', '3W', '4W']);
  });

  it('accepts only those codes', () => {
    for (const type of VEHICLE_TYPES) expect(isVehicleType(type)).toBe(true);
    for (const value of ['EV', 'both', 'any', '2w', '', null, 3]) expect(isVehicleType(value)).toBe(false);
  });

  it('gives every type an icon and a label in each screen that names vehicle types, in English and Hindi', () => {
    for (const type of VEHICLE_TYPES) {
      expect(VEHICLE_ICON[type]).toBeTruthy();
      for (const ns of ['finder', 'apply', 'account'] as const) {
        expect(en[ns][VEHICLE_LABEL_KEY[type]]).toBeTruthy();
        expect(hi[ns][VEHICLE_LABEL_KEY[type]]).toBeTruthy();
      }
    }
  });
});
