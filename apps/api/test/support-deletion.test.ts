/**
 * Account deletion request over HTTP (design 2026-11-15 item 7; spec 01): the customer asks (one open request, rate
 * limited, blocked with reasons while an order is open), support confirms with the account-admin permission only.
 */
import { describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as schema from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

type Ctx = Awaited<ReturnType<typeof buildApp>>;

async function person(ctx: Ctx, n: string, role: 'support_agent' | 'super_admin' | null) {
  const phone = `+9198777777${n}`;
  const email = `sd-${n}@example.com`;
  const token = ctx.verifier.add(`token-deletion-flow-0000${n}`, {
    firebaseUid: `sd-${n}`,
    phone,
    email,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, { firebaseUid: `sd-${n}`, phone, email, emailVerified: true });
  if (role) await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

describe('account deletion request API', () => {
  it('opens one request, answers the same one again, and only the customer can ask', async () => {
    const ctx = await buildApp();
    const asha = await person(ctx, '01', null);
    const ask = (who: typeof asha, body: unknown = {}) =>
      ctx.app.request('/v1/support/deletion-request', {
        method: 'POST',
        headers: who.headers,
        body: JSON.stringify(body),
      });
    expect((await ctx.app.request('/v1/support/deletion-request', { method: 'POST' })).status).toBe(401);
    const first = await ask(asha, { note: 'Please close my account' });
    expect(first.status).toBe(201);
    const { code } = (await first.json()) as { code: string };
    const again = await ask(asha);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { code: string }).code).toBe(code);
    expect((await ask(asha, { role: 'staff' })).status).toBe(400);
    const mine = (await (
      await ctx.app.request(`/v1/support/tickets/${code}`, { headers: asha.headers })
    ).json()) as {
      kind: string;
      deletionConfirmedAt: string | null;
    };
    expect(mine).toMatchObject({ kind: 'deletion_request', deletionConfirmedAt: null });
  });

  it('is refused with the reasons while an order is open', async () => {
    const ctx = await buildApp();
    const ravi = await person(ctx, '02', null);
    const [state] = await ctx.db.select().from(schema.states);
    const st =
      state ??
      (
        await ctx.db
          .insert(schema.states)
          .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
          .returning()
      )[0];
    const [city] = await ctx.db
      .insert(schema.cities)
      .values({ stateId: st!.id, code: 'DEL', slug: 'deletion-city', name: 'Deletion City', status: 'live' })
      .returning();
    const [g] = await ctx.db
      .insert(schema.orderGroups)
      .values({
        code: 'MD-DEL-2026-D00001',
        userId: ravi.id,
        cityId: city!.id,
        paymentMethod: 'cod',
        paymentStatus: 'cod_pending',
        subtotalPaise: 50000,
        totalPaise: 50000,
        idempotencyKey: 'api-del-order-xxxxxxxxxxxx',
      })
      .returning();
    await ctx.db.insert(schema.orders).values({
      groupId: g!.id,
      subNo: 1,
      code: 'MD-DEL-2026-D00001-1',
      userId: ravi.id,
      cityId: city!.id,
      status: 'awaiting_shop',
      shippingAddress: { line1: 'Sarona', pincode: '492001' },
      pincode: '492001',
      subtotalPaise: 50000,
      totalPaise: 50000,
    });
    const res = await ctx.app.request('/v1/support/deletion-request', {
      method: 'POST',
      headers: ravi.headers,
      body: '{}',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorJson;
    expect(body.error.code).toBe('DELETION_BLOCKED');
    expect(body.error.details).toEqual({ blockers: ['OPEN_ORDERS'] });
  });

  it('is rate limited', async () => {
    const ctx = await buildApp();
    const user = await person(ctx, '03', null);
    let last = 0;
    for (let i = 0; i < 6; i += 1)
      last = (
        await ctx.app.request('/v1/support/deletion-request', {
          method: 'POST',
          headers: user.headers,
          body: '{}',
        })
      ).status;
    expect(last).toBe(429);
  });

  it('support confirms only with the account-admin permission; the customer sees the step', async () => {
    const ctx = await buildApp();
    const asha = await person(ctx, '04', null);
    const agent = await person(ctx, '05', 'support_agent');
    const admin = await person(ctx, '06', 'super_admin');
    const { code } = (await (
      await ctx.app.request('/v1/support/deletion-request', {
        method: 'POST',
        headers: asha.headers,
        body: '{}',
      })
    ).json()) as { code: string };
    const version = (
      (await (
        await ctx.app.request(`/v1/admin/support/tickets/${code}`, { headers: admin.headers })
      ).json()) as {
        version: number;
      }
    ).version;
    const confirm = (who: typeof asha, v = version) =>
      ctx.app.request(`/v1/admin/support/tickets/${code}/deletion/confirm`, {
        method: 'POST',
        headers: who.headers,
        body: JSON.stringify({ version: v }),
      });
    expect((await confirm(asha)).status).toBe(403);
    expect((await confirm(agent)).status).toBe(403);
    expect((await confirm(admin, version + 9)).status).toBe(409);
    expect((await confirm(admin)).status).toBe(200);
    const again = await confirm(admin, version + 1);
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorJson).error.code).toBe('DELETION_ALREADY_CONFIRMED');
    const mine = (await (
      await ctx.app.request(`/v1/support/tickets/${code}`, { headers: asha.headers })
    ).json()) as {
      deletionConfirmedAt: string | null;
    };
    expect(mine.deletionConfirmedAt).not.toBeNull();
  });
});
