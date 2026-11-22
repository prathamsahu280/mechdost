/**
 * Business applications over HTTP (audience entry design 2026-11-22, item 3): a trade application needs a signed-in
 * account; a fleet enquiry can be sent signed out (Turnstile + per-IP and per-phone limits); staff review in the
 * admin queue; approving a trade application verifies the account (/me and /me/trade show it); revoke needs a
 * reason; customers and the wrong staff roles never see the queue.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const HUMAN = 'turnstile-ok';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let ops: Record<string, string>;
let marketing: Record<string, string>;
let n = 0;

async function person(tag: string, phone: string, role?: string, opts: { verified?: boolean } = {}) {
  const verified = opts.verified ?? true;
  const token = ctx.verifier.add(`token-business-${tag}-0000000`, {
    firebaseUid: `biz-${tag}`,
    phone,
    email: `biz-${tag}@example.com`,
    emailVerified: verified,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `biz-${tag}`,
    phone,
    email: `biz-${tag}@example.com`,
    emailVerified: verified,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, shopId: null, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

const trade = (over: Record<string, unknown> = {}) => ({
  businessName: 'Sahu Motors',
  businessType: 'garage',
  gstin: '22ABVCS4888H1ZL',
  pincode: '492004',
  spendBand: '25k_to_1l',
  categories: ['lubricants', 'batteries'],
  consent: true,
  ...over,
});
const fleet = (over: Record<string, unknown> = {}) => {
  n += 1;
  return {
    companyName: 'Raipur Cabs',
    fleet: { w2: 0, w3: 4, w4: 25 },
    pincode: '492004',
    contactName: 'Asha Verma',
    phone: `+9198700100${String(n).padStart(2, '0')}`,
    email: `fleet${String(n)}@example.com`,
    needs: ['scheduled_maintenance'],
    consent: true,
    ...over,
  };
};
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = { 'content-type': 'application/json' },
) => ctx.app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
const get = (path: string, headers: Record<string, string>) => ctx.app.request(path, { headers });

beforeAll(async () => {
  ctx = await buildApp({ turnstile: new FakeTurnstile([HUMAN]) });
  await seedRaipurDemo(ctx.db, fixture);
  ops = await person('ops', '+919870199001', 'ops_manager');
  marketing = await person('mkt', '+919870199002', 'marketing');
});

describe('trade application: signed in only', () => {
  it('refuses a signed-out request, strict bodies and unknown codes', async () => {
    expect((await post('/v1/me/trade-application', { application: trade() })).status).toBe(401);
    const me = await person('t1', '+919870199101');
    expect(
      (await post('/v1/me/trade-application', { application: trade({ status: 'approved' }) }, me)).status,
    ).toBe(400);
    expect(
      (await post('/v1/me/trade-application', { application: trade({ businessType: 'plumber' }) }, me))
        .status,
    ).toBe(400);
    expect(
      (await post('/v1/me/trade-application', { application: trade({ gstin: '22ABVCS4888H1ZZ' }) }, me))
        .status,
    ).toBe(400);
    const unserved = await post(
      '/v1/me/trade-application',
      { application: trade({ pincode: '110001' }) },
      me,
    );
    expect(((await unserved.json()) as ErrorJson).error.code).toBe('PINCODE_NOT_SERVED');
  });

  it('accepts one, shows pending on /me, refuses a second, and the user id comes from the token only', async () => {
    const me = await person('t2', '+919870199102');
    const ok = await post('/v1/me/trade-application', { application: trade() }, me);
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { code: string }).code).toMatch(/^BA-RPR-/);
    const profile = (await (await get('/v1/me', me)).json()) as { trade: { status: string } };
    expect(profile.trade).toEqual({ status: 'pending' });
    const again = await post('/v1/me/trade-application', { application: trade() }, me);
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorJson).error.code).toBe('TRADE_APPLICATION_OPEN');
    // A body that names a user is refused (strict).
    const other = await person('t2b', '+919870199112');
    expect(
      (await post('/v1/me/trade-application', { application: trade(), userId: 'x' }, other)).status,
    ).toBe(400);
  });

  it('is rate limited per account', async () => {
    const fresh = await buildApp({ turnstile: new FakeTurnstile([HUMAN]) });
    await seedRaipurDemo(fresh.db, fixture);
    const token = fresh.verifier.add('token-business-rl-0000000000', {
      firebaseUid: 'biz-rl',
      phone: '+919870199150',
      email: 'rl@example.com',
      emailVerified: true,
    });
    await ensureUser(fresh.db, {
      firebaseUid: 'biz-rl',
      phone: '+919870199150',
      email: 'rl@example.com',
      emailVerified: true,
    });
    const h = { ...bearer(token), 'content-type': 'application/json' };
    let last = 0;
    for (let i = 0; i < 8; i++)
      last = (
        await fresh.app.request('/v1/me/trade-application', {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ application: trade({ pincode: '110001' }) }),
        })
      ).status;
    expect(last).toBe(429);
  });
});

describe('fleet enquiry', () => {
  it('signed out: needs Turnstile, validates, is rate limited per IP and per phone', async () => {
    expect((await post('/v1/business-applications/fleet', { application: fleet() })).status).toBe(400);
    const bot = await post('/v1/business-applications/fleet', {
      application: fleet(),
      turnstileToken: 'robot',
    });
    expect(((await bot.json()) as ErrorJson).error.code).toBe('TURNSTILE_FAILED');
    const bad = await post('/v1/business-applications/fleet', {
      application: fleet({ fleet: { w2: 0, w3: 0, w4: 0 } }),
      turnstileToken: HUMAN,
    });
    expect(bad.status).toBe(400);
    const fresh = await buildApp({ turnstile: new FakeTurnstile([HUMAN]) });
    await seedRaipurDemo(fresh.db, fixture);
    const send = (application: unknown) =>
      fresh.app.request('/v1/business-applications/fleet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ application, turnstileToken: HUMAN }),
      });
    const phone = '+919870100999';
    for (let i = 0; i < 3; i++) expect((await send(fleet({ phone }))).status).toBe(201);
    expect((await send(fleet({ phone }))).status).toBe(429);
    expect((await send(fleet({ phone: '+919870100998' }))).status).toBe(201);
    // 5 per IP per hour in total (the refused fourth counted too): the next different phone is refused.
    expect((await send(fleet({ phone: '+919870100997' }))).status).toBe(429);
  });

  it('signed in: no Turnstile, linked to the account', async () => {
    const me = await person('f1', '+919870199201');
    const ok = await post('/v1/me/fleet-application', { application: fleet() }, me);
    expect(ok.status).toBe(201);
    expect((await post('/v1/me/fleet-application', { application: fleet() })).status).toBe(401);
  });
});

describe('admin queue and decisions', () => {
  it('only the right staff see it; filters by kind; 404 for an unknown code', async () => {
    const customer = await person('c1', '+919870199301');
    expect((await get('/v1/admin/business-applications', customer)).status).toBe(403);
    expect((await get('/v1/admin/business-applications', marketing)).status).toBe(403);
    const list = await get('/v1/admin/business-applications?kind=fleet', ops);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: { kind: string; code: string }[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.kind === 'fleet')).toBe(true);
    expect((await get('/v1/admin/business-applications/BA-RPR-2026-ZZZZZZ', ops)).status).toBe(404);
    expect((await get('/v1/admin/business-applications?kind=bogus', ops)).status).toBe(400);
  });

  it('approving a trade application verifies the account; /me and /me/trade show it; revoke needs a reason', async () => {
    const me = await person('a1', '+919870199401');
    const sent = (await (await post('/v1/me/trade-application', { application: trade() }, me)).json()) as {
      code: string;
    };
    const detail = (await (await get(`/v1/admin/business-applications/${sent.code}`, ops)).json()) as {
      version: number;
      kind: string;
      gstin: string;
    };
    expect(detail).toMatchObject({ kind: 'trade', gstin: '22ABVCS4888H1ZL' });
    // Customers and marketing cannot decide.
    expect(
      (
        await post(
          `/v1/admin/business-applications/${sent.code}/decide`,
          { version: detail.version, decision: 'approved' },
          me,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          `/v1/admin/business-applications/${sent.code}/decide`,
          { version: detail.version, decision: 'approved' },
          marketing,
        )
      ).status,
    ).toBe(403);
    // Extra keys refused.
    expect(
      (
        await post(
          `/v1/admin/business-applications/${sent.code}/decide`,
          { version: detail.version, decision: 'approved', userId: 'x' },
          ops,
        )
      ).status,
    ).toBe(400);
    const done = await post(
      `/v1/admin/business-applications/${sent.code}/decide`,
      { version: detail.version, decision: 'approved' },
      ops,
    );
    expect(done.status).toBe(200);
    expect(((await (await get('/v1/me', me)).json()) as { trade: unknown }).trade).toEqual({
      status: 'verified',
    });
    expect(await (await get('/v1/me/trade', me)).json()).toEqual({
      status: 'verified',
      businessName: 'Sahu Motors',
      gstin: '22ABVCS4888H1ZL',
    });
    const after = (await (await get(`/v1/admin/business-applications/${sent.code}`, ops)).json()) as {
      tradeAccount: { version: number; status: string };
    };
    expect(after.tradeAccount.status).toBe('verified');
    const noReason = await post(
      `/v1/admin/business-applications/${sent.code}/trade-standing`,
      { version: after.tradeAccount.version, to: 'revoked' },
      ops,
    );
    expect(((await noReason.json()) as ErrorJson).error.code).toBe('REASON_CODE');
    const revoked = await post(
      `/v1/admin/business-applications/${sent.code}/trade-standing`,
      { version: after.tradeAccount.version, to: 'revoked', reasonCode: 'misuse' },
      ops,
    );
    expect(revoked.status).toBe(200);
    expect(((await (await get('/v1/me', me)).json()) as { trade: unknown }).trade).toEqual({
      status: 'revoked',
    });
    // A revoked account never leaks the GSTIN to the prefill endpoint.
    expect(await (await get('/v1/me/trade', me)).json()).toEqual({
      status: 'revoked',
      businessName: null,
      gstin: null,
    });
    const stale = await post(
      `/v1/admin/business-applications/${sent.code}/trade-standing`,
      { version: after.tradeAccount.version, to: 'verified' },
      ops,
    );
    expect(stale.status).toBe(409);
  });

  it('fleet leads cannot be approved; they are reviewed and closed', async () => {
    const sent = await post('/v1/business-applications/fleet', {
      application: fleet(),
      turnstileToken: HUMAN,
    });
    const { code } = (await sent.json()) as { code: string };
    const d = (await (await get(`/v1/admin/business-applications/${code}`, ops)).json()) as {
      version: number;
    };
    const approve = await post(
      `/v1/admin/business-applications/${code}/decide`,
      { version: d.version, decision: 'approved' },
      ops,
    );
    expect(approve.status).toBe(409);
    const close = await post(
      `/v1/admin/business-applications/${code}/decide`,
      { version: d.version, decision: 'closed' },
      ops,
    );
    expect(close.status).toBe(200);
  });
});

describe('/me/trade', () => {
  it('needs sign-in and shows nothing for a plain customer', async () => {
    expect((await ctx.app.request('/v1/me/trade')).status).toBe(401);
    const me = await person('plain', '+919870199501');
    expect(await (await get('/v1/me/trade', me)).json()).toEqual({
      status: 'none',
      businessName: null,
      gstin: null,
    });
    expect(((await (await get('/v1/me', me)).json()) as { trade: unknown }).trade).toEqual({
      status: 'none',
    });
  });
});
