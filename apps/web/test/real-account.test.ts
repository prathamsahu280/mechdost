import { beforeEach, describe, expect, it } from 'vitest';
import { adoptRealAccount, DEMO_PASSWORD, sessionSnapshot, signInWithPassword } from '../src/demo/session';
import { demoRoleFor, type RealMe } from '../src/lib/auth/real-account';

/** Minimal browser stand-in: the store needs localStorage and storage-event listeners only. */
function fakeWindow() {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          data.set(k, v);
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
}

const me = (over: Partial<RealMe> = {}): RealMe => ({
  name: 'Ravi Sahu',
  phone: '+919812345678',
  email: 'ravi@example.com',
  emailVerified: false,
  language: 'hi',
  roles: [{ role: 'customer', shopId: null, workshopId: null }],
  ...over,
});

describe('real sign-in → the screens that still run on browser data (Q69 default)', () => {
  beforeEach(fakeWindow);

  it('maps API roles to the screen a person lands on: staff → admin, everyone else → customer for now', () => {
    expect(demoRoleFor(me())).toBe('customer');
    expect(demoRoleFor(me({ roles: [{ role: 'ops_manager', shopId: null, workshopId: null }] }))).toBe(
      'admin',
    );
    // Partner portals still run on demo shops; a real partner lands on the account area until they move to the API.
    expect(demoRoleFor(me({ roles: [{ role: 'seller_owner', shopId: 's1', workshopId: null }] }))).toBe(
      'customer',
    );
  });

  it('signs the person in on this device under their phone number, once, and keeps their own edits', () => {
    const first = adoptRealAccount(me());
    expect(sessionSnapshot()?.id).toBe(first.id);
    expect(first).toMatchObject({
      phone: '9812345678',
      name: 'Ravi Sahu',
      email: 'ravi@example.com',
      role: 'customer',
    });
    expect(first.password).toBeUndefined(); // the real password lives only in Firebase

    const again = adoptRealAccount(me({ name: 'Ravi K. Sahu', language: 'en' }));
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ name: 'Ravi K. Sahu', language: 'en' });
  });

  it('an adopted account can never be opened with the demo password on this device', async () => {
    adoptRealAccount(me({ phone: '+919812300000' }));
    expect(await signInWithPassword('9812300000', DEMO_PASSWORD)).toMatchObject({ ok: false });
  });

  it('never adopts an account without an Indian mobile number', () => {
    expect(() => adoptRealAccount(me({ phone: null }))).toThrow();
  });
});
