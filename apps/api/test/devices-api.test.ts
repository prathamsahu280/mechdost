/**
 * "Where you're signed in" (spec 01 § Devices, decision 2026-11-28): password sign-in writes a row and puts its key in
 * the token claim `mds`; the auth middleware ends a token whose row is ended (distinct code SESSION_ENDED) on the next
 * session load; the list, per-device sign-out and "sign out of all other devices" are the caller's own rows only.
 */
import { eq, sql } from '@mechdost/db/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole, hashSessionKey, startUserSession } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { SESSION_CLAIM, parseUserAgent, type DevicesView } from '@mechdost/shared/devices';
import type { GeoIpLookup } from '../src/auth/geoip';
import { MemoryRateLimiter } from '../src/rate-limit/limiter';
import { bearer, buildApp, FakePasswordAuthority, FakeTurnstile, type ErrorJson } from './helpers';

const HUMAN = 'turnstile-ok-0000000000';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const RAIPUR_IP = '203.0.113.9';

const geo: GeoIpLookup = {
  lookup: (ip) => (ip === RAIPUR_IP ? { countryCode: 'IN', region: 'Chhattisgarh', city: 'Raipur' } : null),
};

let ctx: Awaited<ReturnType<typeof buildApp>>;
let auth: FakePasswordAuthority;
let n = 0;

async function account(opts: { staff?: boolean } = {}) {
  n += 1;
  const id = String(n).padStart(2, '0');
  const firebaseUid = `dev-${id}`;
  const phone = `+9198666666${id}`;
  const email = `Dev-${id}@Example.com`;
  const user = await ensureUser(ctx.db, { firebaseUid, phone, email, emailVerified: true });
  auth.add(email, firebaseUid, 'Raipur@2026');
  if (opts.staff) await grantRole(ctx.db, { userId: user.id, role: 'super_admin', grantedBy: null });
  return { user, firebaseUid, phone, email };
}

type Acct = Awaited<ReturnType<typeof account>>;

async function signIn(a: Acct, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  const res = await ctx.app.request('/v1/auth/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ identifier: a.email, password: 'Raipur@2026', turnstileToken: HUMAN, ...extra }),
  });
  return res;
}

let tokenN = 0;
/** What Firebase would hand back after signInWithCustomToken: an ID token whose claims include `mds`. */
function idToken(a: Acct, sessionKey: string | null, over: { authTime?: number; staff2fa?: boolean } = {}) {
  tokenN += 1;
  return ctx.verifier.add(`dev-id-token-${String(tokenN).padStart(8, '0')}-abcdef`, {
    firebaseUid: a.firebaseUid,
    phone: a.phone,
    email: a.email,
    emailVerified: true,
    signInProvider: 'custom',
    sessionKey,
    ...(over.authTime ? { authTime: over.authTime } : {}),
    staff2fa: over.staff2fa ?? false,
  });
}

/** Signs in through the API and returns the ID token for that sign-in plus its row. */
async function device(a: Acct, ua: string, ip = RAIPUR_IP) {
  const res = await signIn(a, { 'user-agent': ua, 'x-forwarded-for': ip });
  expect(res.status).toBe(200);
  const issued = auth.issued.at(-1);
  const key = issued?.claims[SESSION_CLAIM];
  expect(typeof key).toBe('string');
  const sessionKey = String(key);
  const [row] = await ctx.db
    .select()
    .from(s.userSessions)
    .where(eq(s.userSessions.keyHash, hashSessionKey(sessionKey)));
  return { token: idToken(a, sessionKey), sessionKey, row: row! };
}

const list = async (token: string) => {
  const r = await ctx.app.request('/v1/me/devices', { headers: bearer(token) });
  return { res: r, body: (await r.json()) as DevicesView };
};
const post = (path: string, token: string) =>
  ctx.app.request(`/v1/me/devices/${path}`, { method: 'POST', headers: bearer(token) });
const code = async (r: Response) => ((await r.json()) as ErrorJson).error.code;

beforeAll(async () => {
  auth = new FakePasswordAuthority();
  ctx = await buildApp({
    passwordAuth: auth,
    turnstile: new FakeTurnstile([HUMAN]),
    geoip: geo,
    env: { TRUSTED_PROXY_HOPS: '1' },
  });
});

describe('sign-in creates the row', () => {
  it('writes device codes and the rough place, puts the key in the claim, and stores no key, address or user agent', async () => {
    const a = await account();
    const d = await device(a, CHROME_ANDROID);
    expect(d.row).toMatchObject({
      userId: a.user.id,
      deviceKind: 'mobile',
      browser: 'chrome',
      os: 'android',
      countryCode: 'IN',
      region: 'Chhattisgarh',
      city: 'Raipur',
    });
    expect(d.row.keyHash).toBe(hashSessionKey(d.sessionKey));
    const stored = JSON.stringify(
      await ctx.db.select().from(s.userSessions).where(eq(s.userSessions.userId, a.user.id)),
    );
    expect(stored).not.toContain(d.sessionKey);
    expect(stored).not.toContain(RAIPUR_IP);
    expect(stored).not.toContain('Mozilla');
    const audits = JSON.stringify(await ctx.db.select().from(s.auditLog));
    expect(audits).not.toContain(d.sessionKey);
  });

  it('works without a place: an unknown address (or no lookup file) just leaves the place empty', async () => {
    const a = await account();
    const d = await device(a, EDGE_WINDOWS, '198.51.100.7');
    expect(d.row).toMatchObject({
      browser: 'edge',
      os: 'windows',
      deviceKind: 'desktop',
      region: null,
      city: null,
    });
    const bare = await buildApp({
      passwordAuth: auth,
      turnstile: new FakeTurnstile([HUMAN]),
      geoip: null,
      env: { TRUSTED_PROXY_HOPS: '1' },
    });
    const b = await account();
    const res = await bare.app.request('/v1/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': RAIPUR_IP },
      body: JSON.stringify({ identifier: b.email, password: 'Raipur@2026', turnstileToken: HUMAN }),
    });
    expect(res.status).toBe(200);
  });

  it('the staff phone-code step mints its token through the same path: both claims, one row', async () => {
    const a = await account({ staff: true });
    const phone = ctx.verifier.add(`phone-token-dev-staff-${String(n)}-000`, {
      firebaseUid: a.firebaseUid,
      phone: a.phone,
    });
    const res = await signIn(a, {
      authorization: `Bearer ${phone}`,
      'user-agent': CHROME_ANDROID,
      'x-forwarded-for': RAIPUR_IP,
    });
    expect(((await res.json()) as { status: string }).status).toBe('signed_in');
    const claims = auth.issued.at(-1)?.claims;
    expect(claims?.staff_2fa).toBe(true);
    expect(typeof claims?.[SESSION_CLAIM]).toBe('string');
    expect(
      await ctx.db.select().from(s.userSessions).where(eq(s.userSessions.userId, a.user.id)),
    ).toHaveLength(1);
  });

  it('a first staff call (password only, no code yet) writes no row', async () => {
    const a = await account({ staff: true });
    const res = await signIn(a, { 'user-agent': CHROME_ANDROID });
    expect(((await res.json()) as { status: string }).status).toBe('staff_code');
    expect(
      await ctx.db.select().from(s.userSessions).where(eq(s.userSessions.userId, a.user.id)),
    ).toHaveLength(0);
  });
});

describe('GET /v1/me/devices', () => {
  it('is 401 without a sign-in', async () => {
    const r = await ctx.app.request('/v1/me/devices');
    expect(r.status).toBe(401);
  });

  it('lists the caller’s live sign-ins newest activity first, flags this one, hides the hash, never shows others', async () => {
    const a = await account();
    const other = await account();
    const phone = await device(a, CHROME_ANDROID);
    const desk = await device(a, EDGE_WINDOWS, '198.51.100.7');
    await device(other, CHROME_ANDROID);
    await ctx.db
      .update(s.userSessions)
      .set({ lastActiveAt: new Date(Date.now() - 3 * 3600_000) })
      .where(eq(s.userSessions.id, phone.row.id));
    const { res, body } = await list(desk.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(body.cap).toBe(50);
    expect(body.devices.map((d) => [d.id, d.current])).toEqual([
      [desk.row.id, true],
      [phone.row.id, false],
    ]);
    expect(body.devices[1]!.place).toMatchObject({
      city: 'Raipur',
      region: 'Chhattisgarh',
      gstStateCode: '22',
    });
    expect(JSON.stringify(body)).not.toMatch(/keyHash|key_hash/);
    expect(JSON.stringify(body)).not.toContain(phone.row.keyHash);
  });
});

describe('POST /v1/me/devices/:id/sign-out', () => {
  it('ends another device: it leaves the list, and its token is refused once its cached session lapses (about a minute)', async () => {
    const a = await account();
    const here = await device(a, CHROME_ANDROID);
    const there = await device(a, EDGE_WINDOWS);
    expect((await ctx.app.request('/v1/me', { headers: bearer(there.token) })).status).toBe(200);
    const out = await post(`${there.row.id}/sign-out`, here.token);
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ signedOut: 1 });
    expect((await list(here.token)).body.devices.map((d) => d.id)).toEqual([here.row.id]);
    // Still cached for up to 60 s (documented), then the next session load refuses it with a distinct code.
    expect((await ctx.app.request('/v1/me', { headers: bearer(there.token) })).status).toBe(200);
    // The next session load (the cache entry lapses, or a refreshed sign-in has a new cache key) refuses it.
    const reloaded = idToken(a, there.sessionKey, { authTime: Math.floor(Date.now() / 1000) - 30 });
    const refused = await ctx.app.request('/v1/me', { headers: bearer(reloaded) });
    expect(refused.status).toBe(401);
    expect(await code(refused)).toBe('SESSION_ENDED');
    expect((await ctx.app.request('/v1/me', { headers: bearer(here.token) })).status).toBe(200);
  });

  it('a session ended before its first request is refused at once with SESSION_ENDED', async () => {
    const a = await account();
    const here = await device(a, CHROME_ANDROID);
    const there = await device(a, EDGE_WINDOWS);
    await post(`${there.row.id}/sign-out`, here.token);
    const refused = await ctx.app.request('/v1/me', { headers: bearer(there.token) });
    expect(refused.status).toBe(401);
    expect(await code(refused)).toBe('SESSION_ENDED');
  });

  it('is 404 for someone else’s id (same as an unknown id) and leaves their row alone', async () => {
    const a = await account();
    const b = await account();
    const mine = await device(a, CHROME_ANDROID);
    const theirs = await device(b, CHROME_ANDROID);
    const foreign = await post(`${theirs.row.id}/sign-out`, mine.token);
    expect(foreign.status).toBe(404);
    const unknown = await post('0194c6a0-0000-7000-8000-000000000000/sign-out', mine.token);
    expect(unknown.status).toBe(404);
    expect(await code(foreign)).toBe(await code(unknown));
    expect((await list(theirs.token)).body.devices).toHaveLength(1);
  });

  it('is 409 CURRENT_DEVICE for the device making the request; 400 for a malformed id; 401 anonymous', async () => {
    const a = await account();
    const here = await device(a, CHROME_ANDROID);
    const self = await post(`${here.row.id}/sign-out`, here.token);
    expect(self.status).toBe(409);
    expect(await code(self)).toBe('CURRENT_DEVICE');
    expect((await post('not-a-uuid/sign-out', here.token)).status).toBe(400);
    expect((await ctx.app.request(`/v1/me/devices/${here.row.id}/sign-out`, { method: 'POST' })).status).toBe(
      401,
    );
    expect((await list(here.token)).body.devices).toHaveLength(1);
  });

  it('writes the audit row', async () => {
    const a = await account();
    const here = await device(a, CHROME_ANDROID);
    const there = await device(a, EDGE_WINDOWS);
    await post(`${there.row.id}/sign-out`, here.token);
    const rows = (await ctx.db.select().from(s.auditLog)).filter(
      (r) => r.action === 'auth.device_signed_out' && r.entityId === there.row.id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe(a.user.id);
  });
});

describe('POST /v1/me/devices/sign-out-others', () => {
  it('ends every other listed device and keeps this one', async () => {
    const a = await account();
    const b = await account();
    const here = await device(a, CHROME_ANDROID);
    await device(a, EDGE_WINDOWS);
    await device(a, EDGE_WINDOWS);
    const bOwn = await device(b, CHROME_ANDROID);
    const r = await post('sign-out-others', here.token);
    expect(await r.json()).toEqual({ signedOut: 2 });
    expect((await list(here.token)).body.devices.map((d) => d.id)).toEqual([here.row.id]);
    expect((await list(bOwn.token)).body.devices).toHaveLength(1);
    expect((await post('sign-out-others', here.token)).status).toBe(200);
    const audits = (await ctx.db.select().from(s.auditLog)).filter(
      (x) => x.action === 'auth.devices_signed_out_others' && x.entityId === a.user.id,
    );
    expect(audits).toHaveLength(1);
  });

  it('is 401 anonymous', async () => {
    expect((await ctx.app.request('/v1/me/devices/sign-out-others', { method: 'POST' })).status).toBe(401);
  });
});

describe('POST /v1/me/devices/current/sign-out', () => {
  it('ends this device’s own row, once', async () => {
    const a = await account();
    const here = await device(a, CHROME_ANDROID);
    const again = await device(a, EDGE_WINDOWS);
    expect(await (await post('current/sign-out', here.token)).json()).toEqual({ signedOut: 1 });
    const fresh = idToken(a, here.sessionKey, { authTime: Math.floor(Date.now() / 1000) - 5 });
    const refused = await ctx.app.request('/v1/me', { headers: bearer(fresh) });
    expect(await code(refused)).toBe('SESSION_ENDED');
    expect((await list(again.token)).body.devices.map((d) => d.id)).toEqual([again.row.id]);
  });
});

describe('earlier sign-ins (no session key)', () => {
  it('keep working, are not listed, and "sign out of the others" ends the listed rows only', async () => {
    const a = await account();
    const row = await device(a, EDGE_WINDOWS);
    const legacy = idToken(a, null);
    expect((await ctx.app.request('/v1/me', { headers: bearer(legacy) })).status).toBe(200);
    const { body } = await list(legacy);
    expect(body.devices.map((d) => [d.id, d.current])).toEqual([[row.row.id, false]]);
    expect(await (await post('sign-out-others', legacy)).json()).toEqual({ signedOut: 1 });
    expect(await (await post('current/sign-out', legacy)).json()).toEqual({ signedOut: 0 });
    expect((await ctx.app.request('/v1/me', { headers: bearer(legacy) })).status).toBe(200);
  });
});

describe('the middleware', () => {
  it('refuses a key with no row, and a key that belongs to another person', async () => {
    const a = await account();
    const b = await account();
    const theirs = await device(b, CHROME_ANDROID);
    const unknown = idToken(a, 'k'.repeat(43));
    expect(await code(await ctx.app.request('/v1/me', { headers: bearer(unknown) }))).toBe('SESSION_ENDED');
    const stolen = idToken(a, theirs.sessionKey);
    expect(await code(await ctx.app.request('/v1/me', { headers: bearer(stolen) }))).toBe('SESSION_ENDED');
  });

  it('refreshes last active at most once an hour, and a failure there never fails the request', async () => {
    const a = await account();
    const d = await device(a, CHROME_ANDROID);
    const rowNow = async () =>
      (await ctx.db.select().from(s.userSessions).where(eq(s.userSessions.id, d.row.id)))[0]!;
    // Fresh row: a new session load does not write.
    const v0 = (await rowNow()).version;
    await ctx.app.request('/v1/me', {
      headers: bearer(idToken(a, d.sessionKey, { authTime: Math.floor(Date.now() / 1000) - 1 })),
    });
    expect((await rowNow()).version).toBe(v0);
    // Two hours quiet: the next session load writes once.
    await ctx.db
      .update(s.userSessions)
      .set({ lastActiveAt: new Date(Date.now() - 2 * 3600_000) })
      .where(eq(s.userSessions.id, d.row.id));
    const stale = (await rowNow()).lastActiveAt.getTime();
    const ok = await ctx.app.request('/v1/me', {
      headers: bearer(idToken(a, d.sessionKey, { authTime: Math.floor(Date.now() / 1000) - 2 })),
    });
    expect(ok.status).toBe(200);
    const after = (await rowNow()).lastActiveAt.getTime();
    expect(after).toBeGreaterThan(stale + 3600_000);
    // And not again within the hour.
    await ctx.app.request('/v1/me', {
      headers: bearer(idToken(a, d.sessionKey, { authTime: Math.floor(Date.now() / 1000) - 3 })),
    });
    expect((await rowNow()).lastActiveAt.getTime()).toBe(after);
    // The write failing (a trigger that raises) is swallowed: the request still succeeds.
    await ctx.db
      .update(s.userSessions)
      .set({ lastActiveAt: new Date(Date.now() - 2 * 3600_000) })
      .where(eq(s.userSessions.id, d.row.id));
    await ctx.db.execute(
      sql`create or replace function public.fail_touch() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`,
    );
    await ctx.db.execute(
      sql`create trigger fail_touch_t before update on public.user_sessions for each row execute function public.fail_touch()`,
    );
    try {
      const survived = await ctx.app.request('/v1/me', {
        headers: bearer(idToken(a, d.sessionKey, { authTime: Math.floor(Date.now() / 1000) - 4 })),
      });
      expect(survived.status).toBe(200);
    } finally {
      await ctx.db.execute(sql`drop trigger fail_touch_t on public.user_sessions`);
    }
  });
});

describe('rate limits', () => {
  it('limits ending devices per person (60 an hour) and keeps the list available', async () => {
    const limited = await buildApp({
      passwordAuth: auth,
      turnstile: new FakeTurnstile([HUMAN]),
      rateLimiter: new MemoryRateLimiter(),
      geoip: geo,
      env: { TRUSTED_PROXY_HOPS: '1' },
    });
    const prev = ctx;
    ctx = limited;
    try {
      const a = await account();
      const here = await device(a, CHROME_ANDROID);
      let last = 200;
      for (let i = 0; i < 61; i += 1) last = (await post('sign-out-others', here.token)).status;
      expect(last).toBe(429);
      expect((await ctx.app.request('/v1/me/devices', { headers: bearer(here.token) })).status).toBe(200);
    } finally {
      ctx = prev;
    }
  });
});

describe('user agent and the stored row agree', () => {
  it('maps the same codes the shared parser gives', () => {
    expect(parseUserAgent(CHROME_ANDROID)).toEqual({
      deviceKind: 'mobile',
      browser: 'chrome',
      os: 'android',
    });
  });
  it('startUserSession is what sign-in uses (a row per call)', async () => {
    const a = await account();
    const key = await startUserSession(ctx.db, {
      userId: a.user.id,
      device: parseUserAgent(EDGE_WINDOWS),
      place: null,
    });
    expect(key).toHaveLength(43);
  });
});
