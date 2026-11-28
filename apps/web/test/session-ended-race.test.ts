/**
 * Race guard for the stale "Signed in as" fix (2026-11-28): `currentIdToken` must never read "no Firebase user yet"
 * as "signed out". While Firebase is still restoring the browser session (`authStateReady` pending) or when the user
 * exists (normal sign-in: Firebase first, the site session written after), the site session stays; only a finished
 * restore with no user ends it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = {
  user: null as { uid: string; getIdToken: () => Promise<string> } | null,
  ready: Promise.resolve(),
  cleared: 0,
};

vi.mock('../src/lib/auth/mode', () => ({ AUTH_MODE: 'firebase' }));
vi.mock('../src/demo/session', () => ({ sessionSnapshot: () => ({ id: 'a1' }) }));
vi.mock('../src/lib/auth/sign-out', () => ({
  forgetAccountOnDevice: () => {
    fake.cleared += 1;
  },
}));
vi.mock('@firebase/app', () => ({ getApps: () => [{}], initializeApp: () => ({}) }));
vi.mock('@firebase/auth', () => {
  const noop = () => undefined;
  return {
    applyActionCode: noop,
    checkActionCode: noop,
    confirmPasswordReset: noop,
    connectAuthEmulator: noop,
    EmailAuthProvider: {},
    getAuth: () => ({
      languageCode: '',
      authStateReady: () => fake.ready,
      get currentUser() {
        return fake.user;
      },
    }),
    linkWithCredential: noop,
    onAuthStateChanged: noop,
    reauthenticateWithCredential: noop,
    RecaptchaVerifier: vi.fn(),
    signInWithCustomToken: noop,
    signInWithPhoneNumber: noop,
    signOut: noop,
    updatePassword: noop,
    verifyPasswordResetCode: noop,
  };
});

beforeEach(() => {
  fake.user = null;
  fake.ready = Promise.resolve();
  fake.cleared = 0;
  vi.stubGlobal('window', {
    dispatchEvent: () => true,
    sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  vi.stubGlobal('CustomEvent', vi.fn());
});

describe('currentIdToken and the saved site session', () => {
  it('waits for Firebase to finish restoring before it judges', async () => {
    let finish: () => void = () => undefined;
    fake.ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { currentIdToken } = await import('../src/lib/auth/firebase-client');
    const pending = currentIdToken('en');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.cleared).toBe(0); // restore still running: no verdict yet
    fake.user = { uid: 'u1', getIdToken: () => Promise.resolve('tok') };
    finish();
    expect(await pending).toBe('tok');
    expect(fake.cleared).toBe(0); // the user came back: the site session stays
  });

  it('a normal sign-in (Firebase user present) never clears the site session', async () => {
    fake.user = { uid: 'u1', getIdToken: () => Promise.resolve('tok') };
    const { currentIdToken } = await import('../src/lib/auth/firebase-client');
    expect(await currentIdToken('en')).toBe('tok');
    expect(fake.cleared).toBe(0);
  });

  it('a finished restore with no user ends the site session once and returns null', async () => {
    const { currentIdToken } = await import('../src/lib/auth/firebase-client');
    expect(await currentIdToken('en')).toBeNull();
    expect(fake.cleared).toBe(1);
  });
});
