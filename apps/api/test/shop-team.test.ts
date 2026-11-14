/**
 * Shop portal next tier, part 1 over HTTP (design 2026-11-15; specs 07, 13): the busy toggle and the team are the
 * owner's alone. Role-leak matrix: the owner, a staff member of the same shop, the owner of another shop, a plain
 * customer, a MechDost staff account and no sign-in each get the right answer on every route; staff see no payout
 * money in their order lists; an invitee signing in with the invited phone becomes staff, and removal takes effect
 * on the next request.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import {
  ensureUser,
  grantRole,
  placeCodOrder,
  quoteCheckout,
  routeOrder,
  claimShopStaffInvites,
} from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
const shop: Record<string, string> = {};
interface Who {
  id: string;
  headers: Record<string, string>;
}

async function person(n: string, role: string | null, shopId: string | null = null): Promise<Who> {
  const phone = `+9198222222${n}`;
  const token = ctx.verifier.add(`token-shopteam-0000${n}`, {
    firebaseUid: `st-${n}`,
    phone,
    email: `st-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `st-${n}`,
    phone,
    email: `st-${n}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, shopId, grantedBy: null });
  if (role?.startsWith('seller_') && shopId)
    await ctx.db
      .insert(s.shopUsers)
      .values({ shopId, userId: user.id, role: role === 'seller_owner' ? 'owner' : 'staff' });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const call = (who: Who | null, method: string, path: string, body?: unknown) =>
  ctx.app.request(`/v1${path}`, {
    method,
    headers: who?.headers ?? { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const code = async (r: Response) => ((await r.json()) as ErrorJson).error.code;

beforeAll(async () => {
  ctx = await buildApp({});
  await seedRaipurDemo(ctx.db, fixture);
  for (const row of await ctx.db.select().from(s.shops)) shop[row.name] = row.id;
});

describe('shop team and busy: role-leak matrix', () => {
  it('owner may; same-shop staff is 403 OWNER_ONLY; another shop’s owner 404; customer 403; staff account 403; anonymous 401', async () => {
    const sharma = shop['Sharma Auto Parts']!;
    const owner = await person('01', 'seller_owner', sharma);
    const staff = await person('02', 'seller_staff', sharma);
    const other = await person('03', 'seller_owner', shop['Gupta Lubes & Spares']);
    const customer = await person('04', null);
    const support = await person('05', 'support_agent');

    const routes: [string, string, unknown?][] = [
      ['PUT', `/shop/busy/${sharma}`, { mode: 'hours', hours: 2 }],
      ['GET', `/shop/team/${sharma}`],
      ['POST', `/shop/team/${sharma}/invites`, { name: 'Mohan', phone: '9876543210' }],
      ['DELETE', `/shop/team/${sharma}/invites/00000000-0000-4000-8000-000000000001`],
      ['DELETE', `/shop/team/${sharma}/members/00000000-0000-4000-8000-000000000002`],
    ];
    for (const [method, path, body] of routes) {
      const label = `${method} ${path}`;
      expect((await call(null, method, path, body)).status, `anonymous ${label}`).toBe(401);
      expect((await call(customer, method, path, body)).status, `customer ${label}`).toBe(403);
      expect((await call(support, method, path, body)).status, `support ${label}`).toBe(403);
      const asStaff = await call(staff, method, path, body);
      expect(asStaff.status, `staff ${label}`).toBe(403);
      expect(await code(asStaff), `staff ${label}`).toBe('OWNER_ONLY');
      expect((await call(other, method, path, body)).status, `other owner ${label}`).toBe(404);
    }

    // The owner: all five work.
    const busy = await call(owner, 'PUT', `/shop/busy/${sharma}`, { mode: 'hours', hours: 2 });
    expect(busy.status).toBe(200);
    expect(((await busy.json()) as { busy: boolean }).busy).toBe(true);
    const me = (await (await call(owner, 'GET', '/shop/me')).json()) as {
      shops: { busy: boolean; busyUntil: string | null }[];
    };
    expect(me.shops[0]).toMatchObject({ busy: true });
    expect(me.shops[0]!.busyUntil).not.toBeNull();
    const cleared = await call(owner, 'PUT', `/shop/busy/${sharma}`, { mode: 'clear' });
    expect(((await cleared.json()) as { busy: boolean }).busy).toBe(false);
    expect((await call(owner, 'PUT', `/shop/busy/${sharma}`, { mode: 'hours', hours: 99 })).status).toBe(400);
    expect((await call(owner, 'PUT', `/shop/busy/${sharma}`, { mode: 'clear', extra: 1 })).status).toBe(400);
  });

  it('invite → invitee signs in with that phone → staff of that shop; removal ends it on the next request', async () => {
    const sharma = shop['Sharma Auto Parts']!;
    const owner = await person('11', 'seller_owner', sharma);
    const invited = await call(owner, 'POST', `/shop/team/${sharma}/invites`, {
      name: 'Mohan Lal',
      phone: '98222 22299',
    });
    expect(invited.status).toBe(200);
    const again = await call(owner, 'POST', `/shop/team/${sharma}/invites`, {
      name: 'Mohan Lal',
      phone: '+919822222299',
    });
    expect(again.status).toBe(409);
    expect(await code(again)).toBe('INVITE_OPEN');
    const team = (await (await call(owner, 'GET', `/shop/team/${sharma}`)).json()) as {
      invites: { name: string; phoneLast4: string }[];
      max: number;
    };
    expect(team.invites).toEqual([expect.objectContaining({ name: 'Mohan Lal', phoneLast4: '2299' })]);
    expect(team.max).toBe(10);
    // Never the full phone.
    expect(JSON.stringify(team)).not.toContain('9822222299');

    // Before: the invitee is a plain customer.
    const token = ctx.verifier.add('token-shopteam-00099', {
      firebaseUid: 'st-99',
      phone: '+919822222299',
      email: 'st-99@example.com',
      emailVerified: true,
    });
    const invitee: Who = { id: '', headers: { ...bearer(token), 'content-type': 'application/json' } };
    // The first signed-in request claims the invite (like an applicant owner), so the shop shows at once.
    const mine = await call(invitee, 'GET', '/shop/me');
    expect(mine.status).toBe(200);
    const shops = ((await mine.json()) as { shops: { id: string; isOwner: boolean }[] }).shops;
    expect(shops).toEqual([expect.objectContaining({ id: sharma, isOwner: false })]);
    // Staff cannot reach the owner's controls.
    expect((await call(invitee, 'GET', `/shop/team/${sharma}`)).status).toBe(403);

    const list = (await (await call(owner, 'GET', `/shop/team/${sharma}`)).json()) as {
      members: { userId: string; role: string; isYou: boolean; phoneLast4: string | null }[];
      invites: unknown[];
    };
    const member = list.members.find((m) => m.phoneLast4 === '2299')!;
    expect(list.invites).toEqual([]);
    expect(list.members.find((m) => m.isYou)?.role).toBe('owner');

    expect((await call(owner, 'DELETE', `/shop/team/${sharma}/members/${owner.id}`)).status).toBe(409);
    const removed = await call(owner, 'DELETE', `/shop/team/${sharma}/members/${member.userId}`);
    expect(removed.status).toBe(200);
    // Same token, next request: no shop any more (session cache dropped for them).
    expect((await call(invitee, 'GET', '/shop/me')).status).toBe(403);
  });

  it('a signed-in person who is not invited gets nothing; claiming twice is harmless', async () => {
    const stranger = await person('21', null);
    expect((await call(stranger, 'GET', '/shop/me')).status).toBe(403);
    expect(await claimShopStaffInvites(ctx.db, { userId: stranger.id, phone: '+9198222222' + '21' })).toBe(0);
  });

  it('staff see no payout money in the order lists; the owner does; cash to collect stays', async () => {
    const sharma = shop['Sharma Auto Parts']!;
    const owner = await person('31', 'seller_owner', sharma);
    const staff = await person('32', 'seller_staff', sharma);
    const ops = await person('33', 'ops_manager');
    const customer = await ensureUser(ctx.db, {
      firebaseUid: 'st-customer',
      phone: '+919822222298',
      email: 'st-customer@example.com',
      emailVerified: true,
    });
    const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
    const q = await quoteCheckout(ctx.db, { pincode: '492004', lines, locale: 'en' });
    const placed = await placeCodOrder(ctx.db, {
      userId: customer.id,
      idempotencyKey: 'shop-team-key-00000001',
      address: {
        contactName: 'Ravi',
        contactPhone: '+919822222298',
        line1: 'House 12, Pandri',
        line2: null,
        landmark: null,
        pincode: '492004',
      },
      lines,
      expectedTotalPaise: q.totalPaise,
      note: null,
      locale: 'en',
    });
    const orderCode = placed.orders[0]!.code;
    const o = (await ctx.db.select().from(s.orders)).find((r) => r.code === orderCode);
    await routeOrder(ctx.db, {
      scope: { all: true },
      code: orderCode,
      shopId: sharma,
      expectedVersion: o!.version,
      staffUserId: ops.id,
    });
    interface List {
      orders: {
        code: string;
        payoutPaise: number | null;
        collectPaise: number | null;
        items: { unitPaise: number | null }[];
        deliveryLocked: boolean;
      }[];
    }
    const ownerList = (await (await call(owner, 'GET', '/shop/orders')).json()) as List;
    const staffList = (await (await call(staff, 'GET', '/shop/orders')).json()) as List;
    const ownerRow = ownerList.orders.find((r) => r.code === orderCode)!;
    const staffRow = staffList.orders.find((r) => r.code === orderCode)!;
    expect(ownerRow.payoutPaise).toBeGreaterThan(0);
    expect(staffRow.payoutPaise).toBeNull();
    expect(staffRow.items.every((i) => i.unitPaise === null)).toBe(true);
    expect(staffRow.collectPaise).toBe(ownerRow.collectPaise);
    expect(staffRow.deliveryLocked).toBe(false);
    expect((await call(staff, 'GET', '/shop/offers/x')).status).not.toBe(500);
  });
});
