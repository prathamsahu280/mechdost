import { describe, expect, it } from 'vitest';
import { changeFailFor, validatePasswordChange } from '../src/lib/auth/password-change';

describe('validatePasswordChange', () => {
  const ctx = { phone: '9876543210', email: 'asha@example.com', name: 'Asha Verma' };
  const v = (current: string, next: string, confirm = next) =>
    validatePasswordChange({ current, next, confirm }, ctx);

  it('needs the current password', () => {
    expect(v('', 'Longer-pass-1')).toBe('current');
  });
  it('applies the sign-up password rules', () => {
    expect(v('old-pass-9', 'short')).toBe('short');
    expect(v('old-pass-9', 'password123')).toBe('common');
    expect(v('old-pass-9', 'asha-is-here-1')).toBe('personal');
    expect(v('old-pass-9', 'x'.repeat(200))).toBe('long');
  });
  it('refuses the same password and a mismatch', () => {
    expect(v('Same-pass-77', 'Same-pass-77')).toBe('same');
    expect(v('old-pass-9', 'New-pass-77', 'New-pass-78')).toBe('confirm');
  });
  it('accepts a good change', () => {
    expect(v('old-pass-9', 'New-pass-77')).toBeNull();
  });
});

describe('changeFailFor', () => {
  it('maps Firebase codes to one plain reason', () => {
    expect(changeFailFor('auth/wrong-password')).toBe('wrong_current');
    expect(changeFailFor('auth/invalid-credential')).toBe('wrong_current');
    expect(changeFailFor('auth/weak-password')).toBe('weak');
    expect(changeFailFor('auth/too-many-requests')).toBe('rate');
    expect(changeFailFor('auth/requires-recent-login')).toBe('recent');
    expect(changeFailFor('auth/network-request-failed')).toBe('network');
    expect(changeFailFor('auth/whatever')).toBe('unavailable');
    expect(changeFailFor(undefined)).toBe('unavailable');
  });
});
