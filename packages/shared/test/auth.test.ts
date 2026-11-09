import { describe, expect, it } from 'vitest';
import { isStaffGrant, parseSignInIdentifier } from '../src/auth';
import { customerGrant } from '../src/rbac';

describe('sign-in identifiers (spec 01 password sign-in)', () => {
  it('reads an Indian mobile number however it is typed, as E.164', () => {
    for (const typed of ['9876543210', '+91 98765 43210', '091-9876543210', '09876543210', '(98765) 43210'])
      expect(parseSignInIdentifier(typed)).toEqual({ kind: 'phone', value: '+919876543210' });
  });

  it('reads an email in lower case', () => {
    expect(parseSignInIdentifier('  Ravi.Sahu@Example.COM ')).toEqual({
      kind: 'email',
      value: 'ravi.sahu@example.com',
    });
  });

  it('refuses anything else', () => {
    for (const typed of [
      '',
      '12345',
      '5876543210',
      '98765432101',
      'ravi@',
      'ravi sahu@example.com',
      'x'.repeat(300),
    ])
      expect(parseSignInIdentifier(typed)).toBeNull();
  });
});

describe('staff grants', () => {
  it('a platform or city grant is staff; customer, shop and workshop grants are not', () => {
    const base = { permissions: [], cityId: null, shopId: null, workshopId: null };
    expect(isStaffGrant({ ...base, role: 'ops_manager' })).toBe(true);
    expect(isStaffGrant({ ...base, role: 'city_manager', cityId: 'c1' })).toBe(true);
    expect(isStaffGrant({ ...base, role: 'custom_role_made_by_admin' })).toBe(true);
    expect(isStaffGrant(customerGrant())).toBe(false);
    expect(isStaffGrant({ ...base, role: 'seller_owner', shopId: 's1' })).toBe(false);
    expect(isStaffGrant({ ...base, role: 'workshop_owner', workshopId: 'w1' })).toBe(false);
  });
});
