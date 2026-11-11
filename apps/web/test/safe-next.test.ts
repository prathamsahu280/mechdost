import { describe, expect, it } from 'vitest';
import { safeNext } from '../src/demo/session';
import { codeFailFor, passwordLinkedFor } from '../src/lib/auth/auth-errors';

describe('post-login destination (review B1: open redirect)', () => {
  it('refuses anything that could leave the site', () => {
    for (const bad of [
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      '/\u0000/evil.example',
      '//evil.example',
      String.raw`/\evil.example`,
      'https://evil.example',
      'evil.example',
      '',
      null,
    ]) {
      expect(safeNext(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('keeps same-site paths with their query and hash', () => {
    expect(safeNext('/account?tab=orders')).toBe('/account?tab=orders');
    expect(safeNext('/hi/shop/castrol-activ-4t-20w40-900ml#reviews')).toBe(
      '/hi/shop/castrol-activ-4t-20w40-900ml#reviews',
    );
  });
});

describe('sign-up errors (review B15)', () => {
  it('an expired code says so, so the "send a new code" path is reachable', () => {
    expect(codeFailFor('auth/code-expired')).toBe('expired');
    expect(codeFailFor('auth/invalid-verification-code')).toBe('otp');
    expect(codeFailFor('auth/too-many-requests')).toBe('rate');
    expect(codeFailFor('auth/network-request-failed')).toBe('unavailable');
  });

  it('a retry after the password was already linked counts as linked (same email only)', () => {
    const data = [
      { providerId: 'phone', email: null },
      { providerId: 'password', email: 'Ravi@Example.com' },
    ];
    expect(passwordLinkedFor(data, 'ravi@example.com')).toBe(true);
    expect(passwordLinkedFor(data, 'other@example.com')).toBe(false);
    expect(passwordLinkedFor([{ providerId: 'phone', email: null }], 'ravi@example.com')).toBe(false);
  });
});
