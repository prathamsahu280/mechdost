import { describe, expect, it } from 'vitest';
import { isAccount } from '../src/demo/session-state';

/** Stored accounts are checked down to their addresses (review 2026-11-14: checkout prefill read missing fields). */
const base = { id: 'a1', phone: '9876543210', role: 'customer', vehicles: [] as unknown[] };
const address = {
  id: 'x',
  label: '',
  line1: 'C-605 Salasar Greens',
  landmark: '',
  pincode: '492099',
  isDefault: true,
};

describe('isAccount', () => {
  it('accepts an account with well-formed addresses', () => {
    expect(isAccount({ ...base, addresses: [address] })).toBe(true);
  });

  it('refuses an account whose stored address is missing fields', () => {
    const { landmark: _landmark, ...noLandmark } = address;
    expect(isAccount({ ...base, addresses: [noLandmark] })).toBe(false);
    expect(isAccount({ ...base, addresses: [{ ...address, pincode: 492099 }] })).toBe(false);
  });
});
