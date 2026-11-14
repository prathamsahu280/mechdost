/**
 * MechDost Coins over HTTP (spec 20): a customer sees only their own balance and history; checkout spends coins
 * inside the order (409 COINS_CHANGED when the number is no longer allowed); staff read with `coins:read` and adjust
 * with `coins:adjust` (reason code, version, Idempotency-Key); coin rules are site-wide settings needing `coins:rules`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { earnCoins, ensureUser, grantRole } from '@mechdost/db/repo';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900'; // ₹440 → at most 44 coins

let ctx: Awaited<ReturnType<typeof buildApp>>;

async function person(n: string, role: 'super_admin' | 'support_agent' | 'marketing' | null) {
  const phone = `+9198555555${n}`;
  const token = ctx.verifier.add(`token-coins-api-00000${n}`, {
    firebaseUid: `coins-${n}`,
    phone,
    email: `coins-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `coins-${n}`,
    phone,
    email: `coins-${n}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId: null, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const address = {
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  pincode: '492004',
};

async function quoteTotal(lines: { sku: string; qty: number }[]) {
  const res = await ctx.app.request('/v1/checkout/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pincode: '492004', lines }),
  });
  return ((await res.json()) as { totalPaise: number }).totalPaise;
}

let n = 0;
const idem = () => `coins-api-key-${String((n += 1)).padStart(6, '0')}`;

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
});

describe('customer coins', () => {
  it('needs sign-in; shows the caller’s own balance, rules and history', async () => {
    expect((await ctx.app.request('/v1/me/coins')).status).toBe(401);
    const ravi = await person('01', null);
    const asha = await person('02', null);
    const empty = await ctx.app.request('/v1/me/coins', { headers: ravi.headers });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({
      balance: 0,
      pendingCoins: 0,
      nextExpiry: null,
      rules: { coinValuePaise: 100, maxRedeemBp: 1_000, unlockDays: 8, expiryDays: 180, earnOrderBp: 0 },
    });
    await earnCoins(ctx.db, {
      userId: ravi.id,
      coins: 100,
      reason: 'Test coins',
      idemKey: 'earn:api-test:ravi-0001',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
    const mine = (await (await ctx.app.request('/v1/me/coins', { headers: ravi.headers })).json()) as {
      balance: number;
      nextExpiry: { coins: number; at: string } | null;
    };
    expect(mine.balance).toBe(100);
    expect(mine.nextExpiry).toEqual({ coins: 100, at: '2030-01-01T00:00:00.000Z' });
    const theirs = await ctx.app.request('/v1/me/coins/ledger', { headers: asha.headers });
    expect(await theirs.json()).toEqual({ entries: [], nextCursor: null });
    const bad = await ctx.app.request('/v1/me/coins/ledger?cursor=not-a-cursor', { headers: ravi.headers });
    expect(bad.status).toBe(422);
  });

  it('spends coins inside the order; a number no longer allowed is 409 COINS_CHANGED', async () => {
    const ravi = await person('01', null);
    const lines = [{ sku: OIL, qty: 1 }];
    const total = await quoteTotal(lines);
    const place = (coins: number, expected: number) =>
      ctx.app.request('/v1/orders', {
        method: 'POST',
        headers: { ...ravi.headers, 'idempotency-key': idem() },
        body: JSON.stringify({ address, lines, expectedTotalPaise: expected, paymentMethod: 'cod', coins }),
      });
    const tooMany = await place(45, total - 4_500);
    expect(tooMany.status).toBe(409);
    expect(((await tooMany.json()) as ErrorJson).error.code).toBe('COINS_CHANGED');
    const ok = await place(40, total - 4_000);
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({
      totalPaise: total - 4_000,
      coinsRedeemed: 40,
      coinDiscountPaise: 4_000,
    });
    const ledger = (await (
      await ctx.app.request('/v1/me/coins/ledger', { headers: ravi.headers })
    ).json()) as {
      entries: { kind: string; delta: number; orderCode: string | null; reasonCode: string | null }[];
    };
    expect(ledger.entries[0]).toMatchObject({ kind: 'redeem', delta: -40, reasonCode: 'order_redeem' });
    expect(ledger.entries[0]?.orderCode).toMatch(/^MD-RPR-/);
    const bad = await ctx.app.request('/v1/orders', {
      method: 'POST',
      headers: { ...ravi.headers, 'idempotency-key': idem() },
      body: JSON.stringify({ address, lines, expectedTotalPaise: total, paymentMethod: 'cod', coins: -1 }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('admin coins', () => {
  it('coins:read to view, coins:adjust to change (reason code, version, idempotency key)', async () => {
    const customer = await person('01', null);
    const support = await person('11', 'support_agent');
    const marketing = await person('12', 'marketing');
    const url = `/v1/admin/coins/accounts/${customer.id}`;
    expect((await ctx.app.request(url, { headers: customer.headers })).status).toBe(403);
    const view = await ctx.app.request(url, { headers: support.headers });
    expect(view.status).toBe(200);
    const acct = (await view.json()) as { balance: number; version: number | null; entries: unknown[] };
    expect(acct.entries.length).toBeGreaterThan(0);
    expect(
      (
        await ctx.app.request('/v1/admin/coins/accounts/01900000-0000-7000-8000-000000000000', {
          headers: support.headers,
        })
      ).status,
    ).toBe(404);

    const adjust = (who: { headers: Record<string, string> }, body: unknown, key = idem()) =>
      ctx.app.request(`${url}/adjust`, {
        method: 'POST',
        headers: { ...who.headers, 'idempotency-key': key },
        body: JSON.stringify(body),
      });
    const body = { delta: 25, reasonCode: 'goodwill', note: 'Late delivery', version: acct.version };
    expect((await adjust(support, body)).status).toBe(403);
    expect((await adjust(marketing, { ...body, reasonCode: 'he asked nicely' })).status).toBe(400);
    const key = idem();
    const first = await adjust(marketing, body, key);
    expect(first.status).toBe(200);
    const entry = (await first.json()) as { id: string; balanceAfter: number };
    expect(entry.balanceAfter).toBe(acct.balance + 25);
    const replay = await adjust(marketing, body, key);
    expect(((await replay.json()) as { id: string }).id).toBe(entry.id);
    const stale = await adjust(marketing, body);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as ErrorJson).error.code).toBe('STALE_COINS');

    const activity = await ctx.app.request('/v1/admin/coins/activity?limit=5', { headers: support.headers });
    expect(activity.status).toBe(200);
    expect(((await activity.json()) as { entries: { userId: string }[] }).entries[0]?.userId).toBe(
      customer.id,
    );
  });

  it('coin rules are site-wide settings (no city override)', async () => {
    const admin = await person('21', 'super_admin');
    const save = (city: string | null) =>
      ctx.app.request('/v1/admin/settings/coins.earn_order_bp', {
        method: 'PUT',
        headers: admin.headers,
        body: JSON.stringify({ city, value: 200, version: null }),
      });
    expect((await save('RPR')).status).toBe(422);
    expect((await save(null)).status).toBe(200);
    const customer = await person('01', null);
    const mine = (await (await ctx.app.request('/v1/me/coins', { headers: customer.headers })).json()) as {
      rules: { earnOrderBp: number };
    };
    expect(mine.rules.earnOrderBp).toBe(200);
  });
});
