import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';
import { deactivateUser, ensureUser, grantRole } from '@mechdost/db/repo';
import { SessionCache } from '../src/auth/session-cache';
import { TokenError } from '../src/auth/token-verifier';
import { handleError } from '../src/errors';
import { authenticate, requirePermission, requireVerified } from '../src/middleware/auth';
import { MemoryRateLimiter } from '../src/rate-limit/limiter';
import type { AppEnv } from '../src/types';
import { bearer, buildApp, type ErrorJson } from './helpers';

interface MeJson {
  id: string;
  name: string | null;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  language: string;
  version: number;
  roles: { role: string; shopId: string | null }[];
  permissions: string[];
}

const code = async (res: Response) => ((await res.json()) as ErrorJson).error.code;

describe('GET /v1/me', () => {
  it('requires a bearer token', async () => {
    const { app } = await buildApp();
    const res = await app.request('/v1/me');
    expect(res.status).toBe(401);
    expect(await code(res)).toBe('AUTH_REQUIRED');
  });

  it('rejects invalid, expired and revoked tokens with a sign-in-again code', async () => {
    const { app, verifier } = await buildApp();
    verifier.tokens.set('token-expired-0000000001', new TokenError('TOKEN_EXPIRED'));
    expect(await code(await app.request('/v1/me', { headers: bearer('token-unknown-0000000001') }))).toBe(
      'TOKEN_INVALID',
    );
    expect(await code(await app.request('/v1/me', { headers: bearer('token-expired-0000000001') }))).toBe(
      'TOKEN_EXPIRED',
    );
    expect((await app.request('/v1/me', { headers: { Authorization: 'Basic abc' } })).status).toBe(401);
  });

  // Security review 2026-11-14: no route asked Firebase about revocation, so a token stayed valid for up to an
  // hour after "sign out everywhere", a password reset or disabling the account in Firebase.
  it('asks Firebase about revocation whenever the session is not cached, on every route', async () => {
    const { app, verifier } = await buildApp();
    const revoked = verifier.add('token-revoked-000000001', { firebaseUid: 'rv-1', phone: '+919811111101' });
    verifier.revoked.set(revoked, 'TOKEN_REVOKED');
    const res = await app.request('/v1/me', { headers: bearer(revoked) });
    expect(res.status).toBe(401);
    expect(await code(res)).toBe('TOKEN_REVOKED');

    const disabled = verifier.add('token-disabled-00000001', { firebaseUid: 'rv-2', phone: '+919811111102' });
    verifier.revoked.set(disabled, 'USER_DISABLED');
    expect((await app.request('/v1/me', { headers: bearer(disabled) })).status).toBe(403);

    // A valid session pays for the network check once per cache period, not on every request.
    const ok = verifier.add('token-valid-0000000001', { firebaseUid: 'rv-3', phone: '+919811111103' });
    verifier.calls.length = 0;
    expect((await app.request('/v1/me', { headers: bearer(ok) })).status).toBe(200);
    expect((await app.request('/v1/me', { headers: bearer(ok) })).status).toBe(200);
    expect(verifier.calls.filter((c) => c.checkRevoked)).toHaveLength(1);
  });

  it('provisions the user on first call with the customer role only', async () => {
    const { app, verifier } = await buildApp();
    const token = verifier.add('token-first-call-00000001', { firebaseUid: 'me-1', phone: '+919822222221' });
    const res = await app.request('/v1/me', { headers: bearer(token) });
    expect(res.status).toBe(200);
    const me = (await res.json()) as MeJson;
    expect(me.phone).toBe('+919822222221');
    expect(me.phoneVerified).toBe(true);
    expect(me.emailVerified).toBe(false);
    expect(me.roles.map((r) => r.role)).toEqual(['customer']);
    expect(me.permissions).toContain('orders:place');
    expect(me.permissions).not.toContain('orders:route');
    // Signature check first, then one revocation check while the session is loaded (security review 2026-11-14).
    expect(verifier.calls.slice(-2)).toEqual([{ checkRevoked: false }, { checkRevoked: true }]);
  });

  it('refuses deactivated accounts', async () => {
    const { app, verifier, db } = await buildApp();
    const token = verifier.add('token-deactivated-000001', { firebaseUid: 'me-2', phone: '+919822222222' });
    const u = await ensureUser(db, {
      firebaseUid: 'me-2',
      phone: '+919822222222',
      email: null,
      emailVerified: false,
    });
    await deactivateUser(db, { userId: u.id, actorUserId: null, reason: 'test' });
    const res = await app.request('/v1/me', { headers: bearer(token) });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('ACCOUNT_DEACTIVATED');
  });

  it('maps disabled Firebase users to 403', async () => {
    const { app, verifier } = await buildApp();
    verifier.tokens.set('token-disabled-000000001', new TokenError('USER_DISABLED'));
    const res = await app.request('/v1/me', { headers: bearer('token-disabled-000000001') });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('ACCOUNT_DISABLED');
  });

  it('rate limits per user', async () => {
    let now = 5_000_000;
    const { app, verifier } = await buildApp({ rateLimiter: new MemoryRateLimiter(() => now) });
    const token = verifier.add('token-rate-user-00000001', { firebaseUid: 'me-3', phone: '+919822222223' });
    for (let i = 0; i < 120; i++)
      expect((await app.request('/v1/me', { headers: bearer(token) })).status).toBe(200);
    expect((await app.request('/v1/me', { headers: bearer(token) })).status).toBe(429);
    now += 60_001;
    expect((await app.request('/v1/me', { headers: bearer(token) })).status).toBe(200);
  });
});

describe('PATCH /v1/me', () => {
  const patch = (app: Awaited<ReturnType<typeof buildApp>>['app'], token: string, body: unknown) =>
    app.request('/v1/me', {
      method: 'PATCH',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('updates name and language with optimistic locking', async () => {
    const { app, verifier } = await buildApp();
    const token = verifier.add('token-patch-me-000000001', { firebaseUid: 'me-4', phone: '+919822222224' });
    const me = (await (await app.request('/v1/me', { headers: bearer(token) })).json()) as MeJson;

    const res = await patch(app, token, { version: me.version, name: '  Ravi Sahu ', language: 'hi' });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as MeJson;
    expect(updated.name).toBe('Ravi Sahu');
    expect(updated.language).toBe('hi');

    const stale = await patch(app, token, { version: me.version, name: 'Other tab' });
    expect(stale.status).toBe(409);
    expect(await code(stale)).toBe('STALE_PROFILE');

    // The cached session was invalidated: the next read shows the new version.
    const again = (await (await app.request('/v1/me', { headers: bearer(token) })).json()) as MeJson;
    expect(again.version).toBe(updated.version);
  });

  it('rejects unknown fields (no mass assignment) and invalid values', async () => {
    const { app, verifier } = await buildApp();
    const token = verifier.add('token-mass-assign-000001', { firebaseUid: 'me-5', phone: '+919822222225' });
    const r1 = await patch(app, token, { version: 1, name: 'A', status: 'active' });
    expect(r1.status).toBe(400);
    expect(await code(r1)).toBe('VALIDATION');
    expect((await patch(app, token, { version: 1, language: 'fr' })).status).toBe(400);
    expect((await patch(app, token, { version: 1 })).status).toBe(400);
    const notJson = await app.request('/v1/me', {
      method: 'PATCH',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(notJson.status).toBe(400);
  });
});

describe('permission and verification gates', () => {
  async function gatedApp() {
    const built = await buildApp();
    const cache = new SessionCache();
    const gated = new OpenAPIHono<AppEnv>();
    gated.onError(handleError);
    gated.use('*', async (c, next) => {
      c.set('requestId', 'test');
      await next();
    });
    const appDeps = { db: built.db, verifier: built.verifier };
    gated.get('/route-orders', authenticate(appDeps, cache), requirePermission('orders:route'), (c) =>
      c.json({ ok: true }),
    );
    gated.get(
      '/shops/:shopId/respond',
      authenticate(appDeps, cache),
      requirePermission('assignments:respond', (c) => ({ shopId: c.req.param('shopId') })),
      (c) => c.json({ ok: true }),
    );
    gated.post('/checkout', authenticate(appDeps, cache), requireVerified, (c) => c.json({ ok: true }));
    gated.post('/refund', authenticate(appDeps, cache, { checkRevoked: true }), (c) => c.json({ ok: true }));
    return { gated, ...built };
  }

  it('denies staff routes to customers and allows them to staff', async () => {
    const { gated, verifier, db } = await gatedApp();
    const cust = verifier.add('token-gate-customer-0001', { firebaseUid: 'g-1', phone: '+919833333331' });
    expect((await gated.request('/route-orders', { headers: bearer(cust) })).status).toBe(403);

    const ops = verifier.add('token-gate-ops-000000001', { firebaseUid: 'g-2', phone: '+919833333332' });
    const u = await ensureUser(db, {
      firebaseUid: 'g-2',
      phone: '+919833333332',
      email: null,
      emailVerified: false,
    });
    await grantRole(db, { userId: u.id, role: 'ops_manager', grantedBy: null });
    expect((await gated.request('/route-orders', { headers: bearer(ops) })).status).toBe(200);
  });

  it('a new sign-in sees a role granted moments ago; refreshes of the old session may stay cached', async () => {
    const { gated, verifier, db } = await gatedApp();
    const identity = { firebaseUid: 'g-9', phone: '+919833333339' };
    const old = verifier.add('token-gate-new-signin-01', { ...identity, authTime: 1_900_000_000 });
    expect((await gated.request('/route-orders', { headers: bearer(old) })).status).toBe(403);

    const u = await ensureUser(db, { ...identity, email: null, emailVerified: false });
    await grantRole(db, { userId: u.id, role: 'ops_manager', grantedBy: null });
    // Same sign-in (token refresh): served from the session cache for up to 60 s (spec 13).
    expect((await gated.request('/route-orders', { headers: bearer(old) })).status).toBe(403);
    // A fresh sign-in (new auth_time) loads roles again, on every instance.
    const fresh = verifier.add('token-gate-new-signin-02', { ...identity, authTime: 1_900_000_060 });
    expect((await gated.request('/route-orders', { headers: bearer(fresh) })).status).toBe(200);
  });

  it('scopes shop permissions to the shop in the path', async () => {
    const { gated, verifier, db } = await gatedApp();
    const token = verifier.add('token-gate-seller-000001', { firebaseUid: 'g-3', phone: '+919833333333' });
    const u = await ensureUser(db, {
      firebaseUid: 'g-3',
      phone: '+919833333333',
      email: null,
      emailVerified: false,
    });
    const shopA = '0190f000-0000-7000-8000-00000000000a';
    const shopB = '0190f000-0000-7000-8000-00000000000b';
    await grantRole(db, { userId: u.id, role: 'seller_staff', shopId: shopA, grantedBy: null });
    expect((await gated.request(`/shops/${shopA}/respond`, { headers: bearer(token) })).status).toBe(200);
    expect((await gated.request(`/shops/${shopB}/respond`, { headers: bearer(token) })).status).toBe(403);
  });

  it('requires phone and email verification for checkout', async () => {
    const { gated, verifier } = await gatedApp();
    const unverified = verifier.add('token-gate-unverified-01', {
      firebaseUid: 'g-4',
      phone: '+919833333334',
      email: 'g4@example.com',
      emailVerified: false,
    });
    const res = await gated.request('/checkout', { method: 'POST', headers: bearer(unverified) });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorJson;
    expect(body.error.code).toBe('VERIFICATION_REQUIRED');
    expect(body.error.details).toEqual({ phoneVerified: true, emailVerified: false });

    const verified = verifier.add('token-gate-verified-0001', {
      firebaseUid: 'g-4',
      phone: '+919833333334',
      email: 'g4@example.com',
      emailVerified: true,
    });
    expect((await gated.request('/checkout', { method: 'POST', headers: bearer(verified) })).status).toBe(
      200,
    );
  });

  it('checks token revocation on sensitive routes', async () => {
    const { gated, verifier } = await gatedApp();
    const token = verifier.add('token-gate-revoked-00001', { firebaseUid: 'g-5', phone: '+919833333335' });
    await gated.request('/refund', { method: 'POST', headers: bearer(token) });
    expect(verifier.calls.at(-1)).toEqual({ checkRevoked: true });
  });
});
