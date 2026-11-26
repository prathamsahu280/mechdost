/**
 * Turnstile QA bypass (founder ruling R3, 2026-11-27; plan docs/qa/ustaad-simulation-plan-2026-11-27.md § 2.2; spec 13):
 * only allowlisted subjects (keyed hashes of a user id or a normalised sign-in identifier, never raw) skip the
 * Cloudflare check, only inside a hard window (≤ 12 h ahead; a malformed or longer window refuses to start), every use
 * writes one audit row (an audit failure means no bypass), the subject is worked out by the server (never a client
 * flag), and the rate limits are unchanged.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, recordSecurityAudit } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { parseSignInIdentifier } from '@mechdost/shared/auth';
import {
  loadQaTurnstileBypass,
  qaBypassHash,
  withQaTurnstileBypass,
  type QaBypassAudit,
  type QaTurnstileBypass,
} from '../src/auth/qa-turnstile-bypass';
import type { TurnstileVerifier } from '../src/auth/turnstile';
import { bearer, buildApp, FakePasswordAuthority, FakeTurnstile, testDb, type ErrorJson } from './helpers';

const KEY = 'k'.repeat(40);
const NOW = Date.parse('2026-11-27T18:00:00Z');
const in6h = new Date(NOW + 6 * 3600_000).toISOString();

class CountingTurnstile implements TurnstileVerifier {
  calls = 0;
  constructor(private readonly human: readonly string[]) {}
  verify(token: string): Promise<boolean> {
    this.calls += 1;
    return Promise.resolve(this.human.includes(token));
  }
  verifyFor(input: { token?: string | undefined; ip: string }): Promise<boolean> {
    return input.token ? this.verify(input.token) : Promise.resolve(false);
  }
}

describe('loadQaTurnstileBypass (start-up config)', () => {
  const env = (over: Record<string, string | undefined> = {}) => ({
    QA_TURNSTILE_BYPASS_IDS: qaBypassHash(KEY, {
      kind: 'user',
      userId: '0190a000-0000-7000-8000-000000000001',
    }),
    QA_TURNSTILE_BYPASS_KEY: KEY,
    QA_TURNSTILE_BYPASS_UNTIL: in6h,
    ...over,
  });

  it('is off when unset (every environment, production included)', () => {
    expect(loadQaTurnstileBypass({}, NOW)).toBeNull();
    expect(loadQaTurnstileBypass({ NODE_ENV: 'production' }, NOW)).toBeNull();
  });

  it('is off when only some of the three are set (never half on)', () => {
    expect(loadQaTurnstileBypass(env({ QA_TURNSTILE_BYPASS_KEY: undefined }), NOW)).toBeNull();
    expect(loadQaTurnstileBypass(env({ QA_TURNSTILE_BYPASS_UNTIL: '' }), NOW)).toBeNull();
  });

  it('is on inside a window of at most 12 h', () => {
    const cfg = loadQaTurnstileBypass(env({ NODE_ENV: 'production' }), NOW);
    expect(cfg?.until).toBe(Date.parse(in6h));
    expect(cfg?.hashes.size).toBe(1);
  });

  it('refuses to start with a window more than 12 h ahead or a malformed instant', () => {
    expect(() =>
      loadQaTurnstileBypass(
        env({ QA_TURNSTILE_BYPASS_UNTIL: new Date(NOW + 13 * 3600_000).toISOString() }),
        NOW,
      ),
    ).toThrow(/12 h/);
    expect(() => loadQaTurnstileBypass(env({ QA_TURNSTILE_BYPASS_UNTIL: 'tomorrow' }), NOW)).toThrow();
    expect(() =>
      loadQaTurnstileBypass(env({ QA_TURNSTILE_BYPASS_UNTIL: '2026-11-28T03:00:00' }), NOW),
    ).toThrow();
  });

  it('a window already over means off (a restart after the run must not take the API down)', () => {
    expect(
      loadQaTurnstileBypass(env({ QA_TURNSTILE_BYPASS_UNTIL: new Date(NOW - 60_000).toISOString() }), NOW),
    ).toBeNull();
  });

  it('refuses a short key, raw values (anything but 64-hex hashes) and more than 30 entries', () => {
    expect(() => loadQaTurnstileBypass(env({ QA_TURNSTILE_BYPASS_KEY: 'short' }), NOW)).toThrow();
    expect(() => loadQaTurnstileBypass(env({ QA_TURNSTILE_BYPASS_IDS: '+919876543210' }), NOW)).toThrow();
    const many = Array.from({ length: 31 }, (_, i) => qaBypassHash(KEY, { kind: 'user', userId: String(i) }));
    expect(() => loadQaTurnstileBypass(env({ QA_TURNSTILE_BYPASS_IDS: many.join(',') }), NOW)).toThrow();
  });
});

describe('qaBypassHash', () => {
  it('is keyed, hex, and separates the kinds (a user id never matches a phone hash)', () => {
    const phone = parseSignInIdentifier('98765 43210');
    if (!phone) throw new Error('phone');
    const h = qaBypassHash(KEY, { kind: 'identifier', ident: phone });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(qaBypassHash('x'.repeat(40), { kind: 'identifier', ident: phone }));
    expect(h).not.toBe(qaBypassHash(KEY, { kind: 'user', userId: phone.value }));
    // Normalised first: any way the number is typed gives the same hash.
    const again = parseSignInIdentifier('+91 98765-43210');
    if (!again) throw new Error('phone');
    expect(qaBypassHash(KEY, { kind: 'identifier', ident: again })).toBe(h);
  });

  it('is plain HMAC-SHA256 of the canonical line the runbook one-liner hashes', () => {
    const hmac = (line: string) => createHmac('sha256', KEY).update(line).digest('hex');
    const phone = parseSignInIdentifier('9876543210');
    const email = parseSignInIdentifier('QA@Example.com');
    if (!phone || !email) throw new Error('ident');
    expect(qaBypassHash(KEY, { kind: 'identifier', ident: phone })).toBe(hmac('phone:+919876543210'));
    expect(qaBypassHash(KEY, { kind: 'identifier', ident: email })).toBe(hmac('email:qa@example.com'));
    expect(qaBypassHash(KEY, { kind: 'user', userId: 'abc' })).toBe(hmac('user:abc'));
  });
});

describe('withQaTurnstileBypass (unit)', () => {
  const userId = '0190a000-0000-7000-8000-00000000000a';
  const cfg = (): QaTurnstileBypass => ({
    key: KEY,
    until: NOW + 3600_000,
    hashes: new Set([qaBypassHash(KEY, { kind: 'user', userId })]),
  });
  const audits: Parameters<QaBypassAudit>[0][] = [];
  const audit: QaBypassAudit = (row) => {
    audits.push(row);
    return Promise.resolve();
  };

  it('allowlisted user, no token → passes without Cloudflare, one audit row', async () => {
    const base = new CountingTurnstile(['ok-token']);
    const v = withQaTurnstileBypass(base, cfg(), audit, () => NOW);
    audits.length = 0;
    expect(
      await v.verifyFor({
        ip: '10.0.0.1',
        route: 'ustaad.join',
        requestId: 'r1',
        subject: { kind: 'user', userId },
      }),
    ).toBe(true);
    expect(base.calls).toBe(0);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ route: 'ustaad.join', subjectKind: 'user', userId, requestId: 'r1' });
  });

  it('another user → the old behaviour (Cloudflare asked; no token fails closed)', async () => {
    const base = new CountingTurnstile(['ok-token']);
    const v = withQaTurnstileBypass(base, cfg(), audit, () => NOW);
    const other = { kind: 'user' as const, userId: '0190a000-0000-7000-8000-00000000000b' };
    expect(await v.verifyFor({ ip: 'x', route: 'ustaad.join', subject: other })).toBe(false);
    expect(await v.verifyFor({ token: 'ok-token', ip: 'x', route: 'ustaad.join', subject: other })).toBe(
      true,
    );
    expect(base.calls).toBe(1);
  });

  it('after the window → the old behaviour, even for an allowlisted user', async () => {
    const base = new CountingTurnstile([]);
    const v = withQaTurnstileBypass(base, cfg(), audit, () => NOW + 3600_000);
    expect(await v.verifyFor({ ip: 'x', route: 'ustaad.join', subject: { kind: 'user', userId } })).toBe(
      false,
    );
  });

  it('when the audit row cannot be written, no bypass (fail closed)', async () => {
    const base = new CountingTurnstile([]);
    const broken: QaBypassAudit = () => Promise.reject(new Error('db down'));
    const v = withQaTurnstileBypass(base, cfg(), broken, () => NOW);
    expect(await v.verifyFor({ ip: 'x', route: 'ustaad.join', subject: { kind: 'user', userId } })).toBe(
      false,
    );
  });

  it('plain verify() is never bypassed', async () => {
    const base = new CountingTurnstile([]);
    const v = withQaTurnstileBypass(base, cfg(), audit, () => NOW);
    expect(await v.verify('anything', 'x')).toBe(false);
    expect(base.calls).toBe(1);
  });
});

describe('over HTTP: password sign-in and Ustaad join', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  let auth: FakePasswordAuthority;
  const QA_PHONE = '+919855500077';
  const OTHER_PHONE = '+919855500078';
  let qaUserId = '';

  beforeAll(async () => {
    const db = await testDb();
    const qa = await ensureUser(db, {
      firebaseUid: 'qa-bypass-1',
      phone: QA_PHONE,
      email: 'qa-bypass-1@example.com',
      emailVerified: true,
    });
    qaUserId = qa.id;
    await ensureUser(db, {
      firebaseUid: 'qa-bypass-2',
      phone: OTHER_PHONE,
      email: 'qa-bypass-2@example.com',
      emailVerified: true,
    });
    const ident = parseSignInIdentifier(QA_PHONE);
    if (!ident) throw new Error('ident');
    const bypass: QaTurnstileBypass = {
      key: KEY,
      until: Date.now() + 3600_000,
      hashes: new Set([qaBypassHash(KEY, { kind: 'identifier', ident })]),
    };
    auth = new FakePasswordAuthority();
    auth.add('qa-bypass-1@example.com', 'qa-bypass-1', 'Raipur@2026');
    auth.add('qa-bypass-2@example.com', 'qa-bypass-2', 'Raipur@2026');
    const turnstile = withQaTurnstileBypass(new FakeTurnstile(['human-token-123']), bypass, (row) =>
      recordSecurityAudit(db, {
        action: 'security.turnstile_bypassed',
        userId: row.userId,
        entity: 'turnstile',
        entityId: row.route,
        after: {
          route: row.route,
          subject_kind: row.subjectKind,
          ...(row.hmacPrefix ? { identifier_hmac_prefix: row.hmacPrefix } : {}),
          request_id: row.requestId,
        },
      }),
    );
    ctx = await buildApp({ passwordAuth: auth, turnstile });
  });

  const signIn = (body: Record<string, unknown>) =>
    ctx.app.request('/v1/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('an allowlisted identifier signs in without a token; one audit row with the hash prefix only', async () => {
    const r = await signIn({ identifier: '98555 00077', password: 'Raipur@2026' });
    expect(r.status).toBe(200);
    const rows = (await ctx.db.select().from(s.auditLog)).filter(
      (a) => a.action === 'security.turnstile_bypassed',
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain('98555');
    expect((rows[0]?.after as { identifier_hmac_prefix?: string }).identifier_hmac_prefix).toMatch(
      /^[0-9a-f]{8}$/,
    );
  });

  it('any other identifier without a token → 400 TURNSTILE_FAILED (old behaviour)', async () => {
    const r = await signIn({ identifier: OTHER_PHONE, password: 'Raipur@2026' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as ErrorJson).error.code).toBe('TURNSTILE_FAILED');
  });

  it('a client flag cannot ask for the bypass: unknown body fields are refused', async () => {
    const r = await signIn({ identifier: OTHER_PHONE, password: 'Raipur@2026', bypass: true });
    expect(r.status).toBe(400);
    expect(((await r.json()) as ErrorJson).error.code).not.toBe('TURNSTILE_FAILED');
  });

  it('the wrong password is still refused (the bypass only replaces the human check)', async () => {
    const r = await signIn({ identifier: QA_PHONE, password: 'wrong-password' });
    expect(r.status).toBe(401);
  });

  it('the per-identifier lock still answers 429 at the cap', async () => {
    for (let i = 0; i < 5; i++) await signIn({ identifier: QA_PHONE, password: `wrong-${String(i)}` });
    const locked = await signIn({ identifier: QA_PHONE, password: 'Raipur@2026' });
    expect(locked.status).toBe(429);
  });

  it('Ustaad join of a user not on the allowlist without a token is still refused (the gate first)', async () => {
    const token = ctx.verifier.add('token-qa-bypass-0000000002', {
      firebaseUid: 'qa-bypass-2',
      phone: OTHER_PHONE,
      email: 'qa-bypass-2@example.com',
      emailVerified: true,
    });
    const r = await ctx.app.request('/v1/ustaad/join', {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(404); // staff_preview: a non-tester never reaches the Turnstile step
    expect(qaUserId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('over HTTP: Ustaad join by preview testers (user-id hashes)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const JOIN_NO_TOKEN = {
    track: 'apprentice',
    specialities: ['two_wheeler'],
    displayName: 'Raju Verma',
    garageName: 'Verma Motors',
    showGarage: false,
    pincode: '492001',
    areaLabel: 'Pandri',
    yearsClaimed: 1,
    workPlace: 'shop',
    verifyMethods: ['owner'],
    consents: { ustaad_profile: true, ustaad_directory: false, ustaad_training: false, ustaad_offers: false },
  };
  const people: { id: string; token: string }[] = [];

  beforeAll(async () => {
    const db = await testDb();
    const [state] = await db
      .insert(s.states)
      .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
      .returning();
    if (!state) throw new Error('state');
    const [raipur] = await db
      .insert(s.cities)
      .values({ stateId: state.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
      .returning();
    if (!raipur) throw new Error('city');
    await db.insert(s.pincodes).values({ pincode: '492001', stateId: state.id, cityId: raipur.id });
    await db.insert(s.ustaadReachCities).values({ cityId: raipur.id });
    const identities = [1, 2].map((n) => ({
      firebaseUid: `qa-join-${String(n)}`,
      phone: `+91985550010${String(n)}`,
      email: `qa-join-${String(n)}@example.com`,
      emailVerified: true,
    }));
    const users: { id: string }[] = [];
    for (const identity of identities) {
      const u = await ensureUser(db, identity);
      users.push(u);
      // Both are preview testers (they pass the gate); only the first is on the bypass allowlist.
      await db.insert(s.ustaadPreviewTesters).values({ userId: u.id, reasonCode: 'qa_run' });
    }
    const [first] = users;
    if (!first) throw new Error('user');
    const bypass: QaTurnstileBypass = {
      key: KEY,
      until: Date.now() + 3600_000,
      hashes: new Set([qaBypassHash(KEY, { kind: 'user', userId: first.id })]),
    };
    const turnstile = withQaTurnstileBypass(new FakeTurnstile(['human-token-123']), bypass, (row) =>
      recordSecurityAudit(db, {
        action: 'security.turnstile_bypassed',
        userId: row.userId,
        entity: 'turnstile',
        entityId: row.route,
        after: { route: row.route, subject_kind: row.subjectKind, request_id: row.requestId },
      }),
    );
    app = await buildApp({ turnstile });
    identities.forEach((identity, i) => {
      const u = users[i];
      if (!u) return;
      people.push({ id: u.id, token: app.verifier.add(`token-qa-join-00000000000${String(i)}`, identity) });
    });
  });

  const join = (token: string) =>
    app.app.request('/v1/ustaad/join', {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify(JOIN_NO_TOKEN),
    });

  it('an allowlisted tester joins without a token: 201 and exactly one audit row with that user', async () => {
    const [a] = people;
    if (!a) throw new Error('person');
    const r = await join(a.token);
    expect(r.status).toBe(201);
    const rows = (await app.db.select().from(s.auditLog)).filter(
      (x) => x.action === 'security.turnstile_bypassed' && x.entityId === 'ustaad.join',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(a.id);
  });

  it('a tester not on the allowlist without a token → 400 TURNSTILE_FAILED', async () => {
    const b = people[1];
    if (!b) throw new Error('person');
    const r = await join(b.token);
    expect(r.status).toBe(400);
    expect(((await r.json()) as ErrorJson).error.code).toBe('TURNSTILE_FAILED');
  });
});

describe('key whitespace', () => {
  it('a trailing CR on the key (edited env file) does not break the hashes', () => {
    const userId = '0190a000-0000-7000-8000-0000000000cc';
    const cfg = loadQaTurnstileBypass(
      {
        QA_TURNSTILE_BYPASS_IDS: qaBypassHash(KEY, { kind: 'user', userId }),
        QA_TURNSTILE_BYPASS_KEY: `${KEY}\r`,
        QA_TURNSTILE_BYPASS_UNTIL: in6h,
      },
      NOW,
    );
    expect(cfg?.key).toBe(KEY);
  });
});

describe('shipped config (production)', () => {
  const parse = (text: string): Record<string, string> =>
    Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((l) => /^[A-Z0-9_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    );

  for (const file of ['../../../.env.example', '../../../deploy/env.server.example']) {
    it(`${file} lists the three variables, empty, so the bypass is off by default`, () => {
      const env = parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
      for (const k of ['QA_TURNSTILE_BYPASS_IDS', 'QA_TURNSTILE_BYPASS_KEY', 'QA_TURNSTILE_BYPASS_UNTIL'])
        expect(env[k]).toBe('');
      expect(loadQaTurnstileBypass({ ...env, NODE_ENV: 'production' }, Date.now())).toBeNull();
    });
  }

  it('no NEXT_PUBLIC_ variable names the bypass (never shipped to browsers)', () => {
    const text = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    expect(text).not.toMatch(/NEXT_PUBLIC_[A-Z_]*BYPASS/);
  });
});
