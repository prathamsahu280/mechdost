import { describe, expect, it } from 'vitest';
import { cleanPersonName, maxVehicleYear, normaliseRegistration } from '../src/account';
import { AddressCreateDto, AddressPatchDto, VehicleCreateDto } from '../src/account-api';

describe('account rules (design 2026-11-15)', () => {
  it('normalises a registration number and refuses nonsense', () => {
    expect(normaliseRegistration(' cg 04-ab 1234 ')).toBe('CG04AB1234');
    expect(normaliseRegistration('22BH1234AA')).toBe('22BH1234AA');
    expect(normaliseRegistration('AB')).toBeNull();
    expect(normaliseRegistration('CG04 AB 1234 5678 99')).toBeNull();
    expect(normaliseRegistration('CG04*AB1234')).toBeNull();
  });

  it('cleans a name: full-width letters to plain, invisible characters dropped, spaces collapsed', () => {
    expect(cleanPersonName(`  Ｐriya ${String.fromCharCode(0x200b)}  Singh `)).toBe('Priya Singh');
    expect(cleanPersonName('राहुल  शर्मा')).toBe('राहुल शर्मा');
  });

  it('a vehicle can be up to next year old, not further', () => {
    expect(maxVehicleYear(new Date('2026-11-15T00:00:00Z'))).toBe(2027);
  });

  it('address bodies are strict, need a map pin as a pair, and keep Hindi text', () => {
    const ok = {
      contactName: 'रवि वर्मा',
      contactPhone: '+919811100001',
      line1: '१२ शंकर नगर',
      pincode: '492001',
    };
    expect(AddressCreateDto.safeParse(ok).success).toBe(true);
    expect(AddressCreateDto.safeParse({ ...ok, cityId: 'x' }).success).toBe(false);
    expect(AddressCreateDto.safeParse({ ...ok, lat: 21 }).success).toBe(false);
    expect(AddressCreateDto.safeParse({ ...ok, line1: 'x'.repeat(201) }).success).toBe(false);
    expect(AddressPatchDto.safeParse({ version: 1 }).success).toBe(false);
    expect(AddressPatchDto.safeParse({ version: 1, lat: null, lng: null }).success).toBe(true);
  });

  it('vehicle year and odometer bounds', () => {
    const ok = { type: '4W', fuel: 'diesel', make: 'Tata', model: 'Nexon' };
    expect(VehicleCreateDto.safeParse({ ...ok, year: 2021, odometerKm: 999_999 }).success).toBe(true);
    expect(VehicleCreateDto.safeParse({ ...ok, odometerKm: 1_000_000 }).success).toBe(false);
    expect(VehicleCreateDto.safeParse({ ...ok, year: 1979 }).success).toBe(false);
  });
});
