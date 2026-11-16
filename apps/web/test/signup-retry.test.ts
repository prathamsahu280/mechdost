/**
 * Sign-up retry after a half-finished attempt (real-API pass 2026-11-16): linking email + password turns the Firebase
 * session into a `password` sign-in, which the API refuses (401 PROVIDER_NOT_ALLOWED). If the security check or the
 * API sign-in then failed, every retry called `fetchMe()` first with that session and showed "Sign-in isn't working
 * right now" for good. A retry must skip the phone-session profile call when the password is already linked.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasPasswordProvider } from '../src/lib/auth/auth-errors';

describe('sign-up retry', () => {
  it('knows when the password is already linked', () => {
    const phone = { providerId: 'phone' };
    const password = { providerId: 'password' };
    expect(hasPasswordProvider([phone])).toBe(false);
    expect(hasPasswordProvider([phone, password])).toBe(true);
  });
  it('skips the phone-session profile call on a retry', () => {
    const flow = readFileSync(join(__dirname, '..', 'src', 'components', 'auth', 'login-flow.tsx'), 'utf8');
    expect(flow).toMatch(/if \(!r\.sessionHasPassword\(\)\) \{\s*const first = await r\.fetchMe\(\);/);
  });
});
