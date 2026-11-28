/**
 * "Sign out of all devices" (founder 2026-11-28): the web call to `POST /v1/me/sessions/revoke-all`, the answers it
 * maps, and the Account → Profile → Security section (real sign-in only, inline confirm, live region, en + hi).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let token: string | null = 'id-token';
vi.mock('../src/lib/auth/firebase-client', () => ({ currentIdToken: () => Promise.resolve(token) }));

const calls: { url: string; init: RequestInit }[] = [];
let answer: { status: number; body: unknown } | 'network' = { status: 200, body: { revoked: true } };

beforeEach(() => {
  token = 'id-token';
  calls.length = 0;
  answer = { status: 200, body: { revoked: true } };
  process.env.NEXT_PUBLIC_API_URL = 'https://api.test';
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const now = answer;
    if (now === 'network') return Promise.reject(new Error('down'));
    return Promise.resolve({
      status: now.status,
      ok: now.status < 400,
      json: () => Promise.resolve(now.body),
    });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function run() {
  vi.resetModules();
  const m = await import('../src/lib/auth/sign-out-all');
  return m.revokeAllSessions('en');
}

describe('revokeAllSessions', () => {
  it('posts with the bearer token and no body', async () => {
    expect(await run()).toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://api.test/v1/me/sessions/revoke-all');
    expect(calls[0]?.init.method).toBe('POST');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
  });
  it('treats "already signed out" as done (nothing left to end)', async () => {
    token = null;
    expect(await run()).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });
  it('maps 429, 503, other failures and a dead network', async () => {
    answer = { status: 429, body: { error: { code: 'RATE_LIMITED' } } };
    expect(await run()).toEqual({ ok: false, reason: 'rate' });
    answer = { status: 503, body: { error: { code: 'UNAVAILABLE' } } };
    expect(await run()).toEqual({ ok: false, reason: 'unavailable' });
    answer = { status: 500, body: {} };
    expect(await run()).toEqual({ ok: false, reason: 'unavailable' });
    answer = 'network';
    expect(await run()).toEqual({ ok: false, reason: 'network' });
  });
  it('a revoked-token answer counts as done', async () => {
    answer = { status: 401, body: { error: { code: 'TOKEN_REVOKED' } } };
    expect(await run()).toEqual({ ok: true });
  });
});

describe('Security card section', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
  const json = (l: string) =>
    JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'i18n', l), 'utf8'),
    ) as { account: Record<string, string>; auth: Record<string, string> };
  const card = src('components/account/security-card.tsx');
  it('confirms inline, announces errors in a live region, then runs the local sign-out', () => {
    expect(card).toContain("t('signOutAllTitle')");
    expect(card).toContain("t('signOutAllSure')");
    expect(card).toContain('aria-live="polite"');
    expect(card).toMatch(/import\('@\/lib\/auth\/sign-out-all'\)/);
    expect(card).toMatch(/import\('@\/lib\/auth\/sign-out'\)/);
    expect(card).toContain('signOutEverywhere');
    expect(card).not.toMatch(/from '@\/lib\/auth\/(sign-out-all|sign-out|firebase-client)'/);
    expect(card).toContain('data-track="signout_all_open"');
  });
  it('has every string in English and Hindi', () => {
    const keys = [
      'signOutAllTitle',
      'signOutAllHelp',
      'signOutAllButton',
      'signOutAllSure',
      'signOutAllConfirm',
      'signOutAllCancel',
      'signOutAllBusy',
      'signOutAllErr_rate',
      'signOutAllErr_network',
      'signOutAllErr_unavailable',
    ];
    for (const l of ['en.json', 'hi.json']) {
      const j = json(l);
      for (const k of keys) expect(j.account[k], `${l} account.${k}`).toBeTruthy();
      expect(j.auth.sessionEndedNotice, `${l} auth.sessionEndedNotice`).toBeTruthy();
    }
    expect(json('en.json').account.signOutAllHelp).toBe(
      "Signs you out on every phone and computer, including this one. Use it if you lost a phone or signed in somewhere you don't trust.",
    );
  });
});
