/**
 * Bug 2026-11-28 (founder): the admin page said "Signed in as QA Admin" while every panel said "Sign in again to
 * continue". The site keeps its own saved session next to the Firebase one; when Firebase ended its session elsewhere
 * (password change on another device, staff role removed, account disabled) the site session stayed, `currentIdToken()`
 * returned null and "Try again" could never work. Now a helper that finds no Firebase user while the site says
 * "signed in", or an API answer that the session was revoked, clears the site session once and leaves a one-shot note.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { session: true, cleared: 0, firebaseSignedOut: 0, mode: 'firebase' as 'firebase' | 'demo' };
const store = new Map<string, string>();

vi.mock('../src/lib/auth/mode', () => ({
  get AUTH_MODE() {
    return state.mode;
  },
}));
vi.mock('../src/demo/session', () => ({
  sessionSnapshot: () => (state.session ? { id: 'a1' } : null),
}));
vi.mock('../src/lib/auth/sign-out', () => ({
  forgetAccountOnDevice: () => {
    state.session = false;
    state.cleared += 1;
  },
}));
vi.mock('../src/lib/auth/firebase-client', () => ({
  signOutReal: () => {
    state.firebaseSignedOut += 1;
    return Promise.resolve();
  },
}));

beforeEach(() => {
  state.session = true;
  state.cleared = 0;
  state.firebaseSignedOut = 0;
  state.mode = 'firebase';
  store.clear();
  vi.stubGlobal('window', {
    dispatchEvent: () => true,
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
  });
  vi.stubGlobal('CustomEvent', vi.fn());
});

async function load() {
  vi.resetModules();
  const ended = await import('../src/lib/auth/session-ended');
  const flag = await import('../src/lib/auth/session-ended-flag');
  return { ended, flag };
}

describe('session ended elsewhere (regression 2026-11-28 stale "Signed in as")', () => {
  it('clears the site session and leaves the note when Firebase has no user but the site says signed in', async () => {
    const { ended, flag } = await load();
    ended.noteFirebaseUser(null);
    expect(state.cleared).toBe(1);
    expect(flag.sessionEndedNow()).toBe(true);
  });

  it('does nothing while a Firebase user exists', async () => {
    const { ended, flag } = await load();
    ended.noteFirebaseUser('uid-1');
    expect(state.cleared).toBe(0);
    expect(flag.sessionEndedNow()).toBe(false);
  });

  it('does nothing for a visitor who was never signed in (no site session)', async () => {
    state.session = false;
    const { ended, flag } = await load();
    ended.noteFirebaseUser(null);
    expect(state.cleared).toBe(0);
    expect(flag.sessionEndedNow()).toBe(false);
  });

  it('does nothing in demo mode (no Firebase there)', async () => {
    state.mode = 'demo';
    const { ended } = await load();
    ended.noteFirebaseUser(null);
    ended.noteApiAnswer(401, 'TOKEN_REVOKED');
    expect(state.cleared).toBe(0);
  });

  it('a revoked-token answer ends the session and signs Firebase out locally', async () => {
    const { ended, flag } = await load();
    ended.noteApiAnswer(401, 'TOKEN_REVOKED');
    await new Promise((r) => setTimeout(r, 0));
    expect(state.cleared).toBe(1);
    expect(state.firebaseSignedOut).toBe(1);
    expect(flag.sessionEndedNow()).toBe(true);
  });

  it('other answers never end the session (plain sign-in required, forbidden, server errors)', async () => {
    const { ended } = await load();
    ended.noteApiAnswer(401, 'AUTH_REQUIRED');
    ended.noteApiAnswer(403, 'TOKEN_REVOKED');
    ended.noteApiAnswer(500, 'TOKEN_REVOKED');
    ended.noteApiAnswer(0, 'NETWORK');
    expect(state.cleared).toBe(0);
  });

  it('a second report does not clear twice or loop', async () => {
    const { ended } = await load();
    ended.noteFirebaseUser(null);
    ended.noteFirebaseUser(null);
    expect(state.cleared).toBe(1);
  });

  it('the note is one-shot: a new sign-in clears it', async () => {
    const { ended, flag } = await load();
    ended.noteFirebaseUser(null);
    flag.clearSessionEnded();
    expect(flag.sessionEndedNow()).toBe(false);
  });
});

describe('where it is wired', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
  it('currentIdToken reports a missing user only after Firebase finished restoring the session', () => {
    const client = src('lib/auth/firebase-client.ts');
    const body = /export async function currentIdToken[\s\S]*?\n}\n/.exec(client)?.[0] ?? '';
    expect(body.indexOf('authStateReady')).toBeGreaterThan(-1);
    expect(body.indexOf('noteFirebaseUser')).toBeGreaterThan(body.indexOf('authStateReady'));
  });
  it('the admin and order API helpers report session-invalid answers', () => {
    expect(src('lib/admin-api.ts')).toContain('noteApiAnswer');
    expect(src('lib/orders-api.ts')).toContain('noteApiAnswer');
  });
  it('a new sign-in clears the note, and the sign-in cards show it', () => {
    expect(src('demo/session.ts')).toContain('clearSessionEnded');
    expect(src('components/portal/portal-guard.tsx')).toContain('SessionEndedNotice');
    expect(src('components/auth/login-flow.tsx')).toContain('SessionEndedNotice');
  });
  it('does not make Firebase load on pages that do not already load it', () => {
    for (const f of ['lib/auth/session-ended.ts', 'lib/auth/session-ended-flag.ts']) {
      expect(src(f)).not.toMatch(/from '(@firebase|firebase)\//);
      expect(src(f)).not.toMatch(/from '\.\/firebase-client'/);
    }
  });
});
