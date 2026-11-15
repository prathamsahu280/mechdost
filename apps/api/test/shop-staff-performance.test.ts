/**
 * Shop staff performance and earnings over HTTP (design 2026-11-16, specs 07, 13). Role-leak matrix: the owner sees the
 * whole team and the ledger, a staff member of the shop only their own row, another shop's people a 404, customers and
 * MechDost support a 403, nobody a 401. Staff bodies carry no other member and no shop money.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import type { ShopStaffPerformanceDto } from '@mechdost/shared/shop-staff-performance';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const SHARMA = 'Sharma Auto Parts';
const GUPTA = 'Gupta Lubes & Spares';

let ctx: Awaited<ReturnType<typeof buildApp>>;
const shop: Record<string, string> = {};
interface Who {
  id: string;
  token: string;
}

async function person(n: string, role: string | null, shopId: string | null = null): Promise<Who> {
  const phone = `+9198555555${n}`;
  const token = ctx.verifier.add(`token-staffperf-0000${n}`, {
    firebaseUid: `sfp-${n}`,
    phone,
    email: `sfp-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `sfp-${n}`,
    phone,
    email: `sfp-${n}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, shopId, grantedBy: null });
  if (role?.startsWith('seller_') && shopId)
    await ctx.db
      .insert(s.shopUsers)
      .values({ shopId, userId: user.id, role: role === 'seller_owner' ? 'owner' : 'staff' });
  return { id: user.id, token };
}

const get = (who: Who | null, path: string) =>
  ctx.app.request(`/v1${path}`, { headers: who ? bearer(who.token) : {} });
const body = async (r: Response) => (await r.json()) as ShopStaffPerformanceDto;
const code = async (r: Response) => ((await r.json()) as ErrorJson).error.code;

beforeAll(async () => {
  ctx = await buildApp({});
  await seedRaipurDemo(ctx.db, fixture);
  for (const row of await ctx.db.select().from(s.shops)) shop[row.name] = row.id;
});

describe('shop staff performance routes', () => {
  it('role-leak matrix: anonymous 401, customer and support 403, other shop 404, members 200', async () => {
    const path = `/shop/staff-performance/${shop[SHARMA]}?days=30`;
    const owner = await person('01', 'seller_owner', shop[SHARMA]);
    const staff = await person('02', 'seller_staff', shop[SHARMA]);
    const other = await person('03', 'seller_owner', shop[GUPTA]);
    const otherStaff = await person('04', 'seller_staff', shop[GUPTA]);
    const customer = await person('05', null);
    const support = await person('06', 'support_agent');
    expect((await get(null, path)).status).toBe(401);
    expect((await get(customer, path)).status).toBe(403);
    expect((await get(support, path)).status).toBe(403);
    expect((await get(other, path)).status).toBe(404);
    expect((await get(otherStaff, path)).status).toBe(404);
    expect((await get(owner, path)).status).toBe(200);
    expect((await get(staff, path)).status).toBe(200);
    // Same refusal whether the shop exists or not: nothing tells the caller which shops there are.
    const missing = await get(other, '/shop/staff-performance/01890000-0000-7000-8000-000000000000?days=30');
    expect(missing.status).toBe(404);
  });

  it('the owner sees every member, the shop totals and the ledger', async () => {
    const owner = await person('11', 'seller_owner', shop[SHARMA]);
    await person('12', 'seller_staff', shop[SHARMA]);
    const r = await body(await get(owner, `/shop/staff-performance/${shop[SHARMA]}?days=90`));
    expect(r).toMatchObject({ scope: 'owner', days: 90, onTimeHours: 24 });
    expect(r.members.length).toBeGreaterThanOrEqual(3);
    expect(r.members.filter((m) => m.isYou)).toHaveLength(1);
    expect(r.shop).not.toBeNull();
    expect(r.earnings).toMatchObject({ totalPaise: 0, byKind: [], byDay: [] });
  });

  it('a staff member gets their own row only: no other member, no shop numbers, no ledger', async () => {
    const owner = await person('21', 'seller_owner', shop[SHARMA]);
    const staff = await person('22', 'seller_staff', shop[SHARMA]);
    const r = await body(await get(staff, `/shop/staff-performance/${shop[SHARMA]}`));
    expect(r.scope).toBe('self');
    expect(r.days).toBe(30);
    expect(r.members.map((m) => m.userId)).toEqual([staff.id]);
    expect(r.shop).toBeNull();
    expect(r.earnings).toBeNull();
    expect(JSON.stringify(r)).not.toContain(owner.id);
  });

  it('refuses a bad window and a bad shop id', async () => {
    const owner = await person('31', 'seller_owner', shop[SHARMA]);
    for (const days of ['7', '0', 'x', '30.5'])
      expect((await get(owner, `/shop/staff-performance/${shop[SHARMA]}?days=${days}`)).status, days).toBe(
        400,
      );
    expect(await code(await get(owner, `/shop/staff-performance/${shop[SHARMA]}?days=7`))).toBe('VALIDATION');
    expect((await get(owner, '/shop/staff-performance/not-a-uuid')).status).toBe(400);
  });
});
