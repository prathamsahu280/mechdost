/**
 * Staff sign-in speed (2026-11-25): the invisible reCAPTCHA verifier for the phone code is made and rendered while
 * the person types the password, so the send after the password step reuses it. Timing note: with the warm verifier
 * `sendPhoneCode` makes no verifier of its own (0 constructions, 0 renders) before asking Firebase to send; and no
 * SMS is requested by warming.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ made: 0, rendered: 0, cleared: 0, sends: 0, renderFails: false }));

vi.mock('@firebase/app', () => ({ getApps: () => [{}], initializeApp: () => ({}) }));
vi.mock('@firebase/auth', () => {
  class RecaptchaVerifier {
    constructor() {
      calls.made += 1;
    }
    render() {
      calls.rendered += 1;
      return calls.renderFails ? Promise.reject(new Error('offline')) : Promise.resolve(1);
    }
    clear() {
      calls.cleared += 1;
    }
  }
  return {
    RecaptchaVerifier,
    getAuth: () => ({ languageCode: null }),
    connectAuthEmulator: () => undefined,
    signInWithPhoneNumber: () => {
      calls.sends += 1;
      return Promise.resolve({ confirm: () => Promise.resolve({ user: { providerData: [] } }) });
    },
    // The rest of the module's imports are unused here.
    applyActionCode: 0,
    checkActionCode: 0,
    confirmPasswordReset: 0,
    EmailAuthProvider: {},
    linkWithCredential: 0,
    onAuthStateChanged: 0,
    reauthenticateWithCredential: 0,
    signInWithCustomToken: 0,
    signOut: 0,
    updatePassword: 0,
    verifyPasswordResetCode: 0,
  };
});

interface FakeNode {
  isConnected: boolean;
  children: FakeNode[];
  replaceChildren: () => void;
  appendChild: (n: FakeNode) => void;
}
const node = (): FakeNode => {
  const n: FakeNode = {
    isConnected: true,
    children: [],
    replaceChildren: () => {
      for (const c of n.children) c.isConnected = false;
      n.children = [];
    },
    appendChild: (c) => n.children.push(c),
  };
  return n;
};

let container: FakeNode;

beforeEach(() => {
  vi.resetModules();
  calls.made = calls.rendered = calls.cleared = calls.sends = 0;
  calls.renderFails = false;
  container = node();
  vi.stubGlobal('document', { getElementById: () => container, createElement: () => node() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('warm reCAPTCHA verifier', () => {
  it('is made and rendered before the send, and the send reuses it without sending anything early', async () => {
    const c = await import('../src/lib/auth/firebase-client');
    c.warmRecaptcha('en', 'login-recaptcha');
    expect(calls).toMatchObject({ made: 1, rendered: 1, sends: 0 }); // warming sends no SMS
    c.warmRecaptcha('en', 'login-recaptcha'); // typing more does not make another
    expect(calls.made).toBe(1);

    const sent = await c.sendPhoneCode('+919000000005', 'en', 'login-recaptcha');
    expect(sent.ok).toBe(true);
    expect(calls).toMatchObject({ made: 1, rendered: 1, sends: 1 }); // reused, not rebuilt

    c.warmRecaptcha('en', 'login-recaptcha'); // a verifier is in use for the send: nothing replaces it
    expect(calls.made).toBe(1);
  });

  it('without warming, the send makes its own (the previous behaviour)', async () => {
    const c = await import('../src/lib/auth/firebase-client');
    await c.sendPhoneCode('+919000000005', 'en', 'login-recaptcha');
    expect(calls).toMatchObject({ made: 1, sends: 1 });
  });

  it('a warm verifier whose host left the page is replaced, and a failed render is dropped silently', async () => {
    const c = await import('../src/lib/auth/firebase-client');
    c.warmRecaptcha('en', 'login-recaptcha');
    container.replaceChildren(); // the host is gone
    await c.sendPhoneCode('+919000000005', 'en', 'login-recaptcha');
    expect(calls.made).toBe(2);

    vi.resetModules();
    calls.made = 0;
    calls.renderFails = true;
    const d = await import('../src/lib/auth/firebase-client');
    d.warmRecaptcha('en', 'login-recaptcha');
    await Promise.resolve();
    await Promise.resolve();
    await d.sendPhoneCode('+919000000005', 'en', 'login-recaptcha');
    expect(calls.made).toBe(2); // the failed warm one was dropped; the send built its own
  });
});
