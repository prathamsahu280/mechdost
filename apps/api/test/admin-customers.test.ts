/**
 * Customer blocks over HTTP: only verified staff with `customers:block` can block or lift; a `full` block refuses
 * every signed-in request (403 ACCOUNT_BLOCKED); an `orders` block refuses placing (403 ORDERS_BLOCKED).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;

async function person(
  n: string,
  role: 'super_admin' | 'support_agent' | 'city_manager' | null,
  cityId: string | null = null,
) {
  const phone = `+9198333333${n}`;
  const token = ctx.verifier.add(`token-blocks-00000${n}`, {
    firebaseUid: `bl-${n}`,
    phone,
    email: `bl-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `bl-${n}`,
    phone,
    email: `bl-${n}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

beforeAll(async () => {
  ctx = await buildApp();
});

describe('admin customer blocks', () => {
  it('needs customers:block; a full block locks the account out; lifting needs the version', async () => {
    const admin = await person('01', 'super_admin');
    const agent = await person('02', 'support_agent');
    const customer = await person('03', null);
    const url = `/v1/admin/customers/${customer.id}/blocks`;
    const body = JSON.stringify({
      level: 'full',
      reasonCode: 'payment_fraud',
      note: 'Chargebacks on 3 orders',
    });

    expect((await ctx.app.request(url, { method: 'POST', headers: customer.headers, body })).status).toBe(
      403,
    );
    expect((await ctx.app.request(url, { method: 'POST', headers: agent.headers, body })).status).toBe(403);
    const bad = await ctx.app.request(url, {
      method: 'POST',
      headers: admin.headers,
      body: JSON.stringify({ level: 'full', reasonCode: 'he was rude' }),
    });
    expect(bad.status).toBe(400); // reason must be a code (ML-ready)
    const created = await ctx.app.request(url, { method: 'POST', headers: admin.headers, body });
    expect(created.status).toBe(201);
    const { id, version } = (await created.json()) as { id: string; version: number };

    // A fresh app (new session cache) sees the block at once.
    const fresh = await buildApp();
    fresh.verifier.tokens.set('token-blocks-0000003', ctx.verifier.tokens.get('token-blocks-0000003')!);
    const me = await fresh.app.request('/v1/me', { headers: customer.headers });
    expect(me.status).toBe(403);
    expect(((await me.json()) as ErrorJson).error.code).toBe('ACCOUNT_BLOCKED');

    const history = (await (await ctx.app.request(url, { headers: agent.headers })).json()) as {
      blocks: { level: string; inForce: boolean }[];
    };
    expect(history.blocks).toEqual([expect.objectContaining({ level: 'full', inForce: true })]);

    const liftUrl = `/v1/admin/customers/blocks/${id}/lift`;
    const stale = await ctx.app.request(liftUrl, {
      method: 'POST',
      headers: admin.headers,
      body: JSON.stringify({ version: version + 1, reason: 'Bank confirmed the payments' }),
    });
    expect(stale.status).toBe(409);
    const lifted = await ctx.app.request(liftUrl, {
      method: 'POST',
      headers: admin.headers,
      body: JSON.stringify({ version, reason: 'Bank confirmed the payments' }),
    });
    expect(lifted.status).toBe(200);
  });

  it('city-scoped staff cannot read or change customer blocks yet (customers have no city)', async () => {
    const [state] = await ctx.db
      .insert(s.states)
      .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
      .returning();
    const [city] = await ctx.db
      .insert(s.cities)
      .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
      .returning();
    const manager = await person('04', 'city_manager', city!.id);
    const customer = await person('05', null);
    const res = await ctx.app.request(`/v1/admin/customers/${customer.id}/blocks`, {
      headers: manager.headers,
    });
    expect(((await res.json()) as ErrorJson).error.code).toBe('SCOPE_REQUIRED');
  });
});
