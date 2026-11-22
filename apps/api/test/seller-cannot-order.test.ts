/**
 * Seller accounts cannot buy (user 2026-11-22: "a seller login wont have option to order stuff from the website at
 * all"). Every customer buying route refuses a shop owner or shop staff with 403 SELLER_CANNOT_ORDER, enforced in
 * the API (hard rule 4); customers, MechDost staff and anonymous guests are unaffected.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
let sharma = '';

async function person(n: string, role: string | null, shopId: string | null = null) {
  const phone = `+9198333333${n}`;
  const token = ctx.verifier.add(`token-sellerblock-00${n}`, {
    firebaseUid: `sb-${n}`,
    phone,
    email: `sb-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `sb-${n}`,
    phone,
    email: `sb-${n}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, shopId, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' } as Record<string, string>;
}

const call = (headers: Record<string, string> | null, method: string, path: string, body: unknown = {}) =>
  ctx.app.request(`/v1${path}`, {
    method,
    headers: headers ?? { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
const codeOf = async (r: Response) => {
  const j = (await r.json().catch(() => ({}))) as Partial<ErrorJson>;
  return j.error?.code ?? '';
};

const BUYING: [string, string][] = [
  ['POST', '/me/cart/merge'],
  ['POST', '/me/cart/reorder'],
  ['POST', '/me/cart/lines/some-sku/add'],
  ['PUT', '/me/cart/lines/some-sku'],
  ['POST', '/checkout/quote'],
  ['POST', '/orders'],
  ['POST', '/checkout/coupon'],
  ['POST', '/quotes'],
  ['POST', '/quotes/QT-RPR-2026-AAAAAA/accept'],
  ['POST', '/quotes/QT-RPR-2026-AAAAAA/messages'],
];

beforeAll(async () => {
  ctx = await buildApp({});
  await seedRaipurDemo(ctx.db, fixture);
  sharma = (await ctx.db.select().from(s.shops)).find((r) => r.name === 'Sharma Auto Parts')?.id ?? '';
});

describe('sellers cannot place orders', () => {
  it('a shop owner and shop staff get 403 SELLER_CANNOT_ORDER on every buying route', async () => {
    const owner = await person('01', 'seller_owner', sharma);
    const staff = await person('02', 'seller_staff', sharma);
    for (const who of [owner, staff])
      for (const [method, path] of BUYING) {
        const res = await call(who, method, path);
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(await codeOf(res), `${method} ${path}`).toBe('SELLER_CANNOT_ORDER');
      }
  });

  it('a seller who also holds a MechDost staff role is still blocked', async () => {
    const both = await person('03', 'seller_owner', sharma);
    const user = (await ctx.db.select().from(s.users)).find((u) => u.firebaseUid === 'sb-03');
    if (user) await grantRole(ctx.db, { userId: user.id, role: 'support_agent', grantedBy: null });
    const res = await call(both, 'POST', '/orders');
    expect(await codeOf(res)).toBe('SELLER_CANNOT_ORDER');
  });

  it('a customer, a MechDost staff account and a guest are not refused for this reason', async () => {
    const customer = await person('04', null);
    const support = await person('05', 'support_agent');
    for (const who of [customer, support])
      for (const [method, path] of BUYING)
        expect(await codeOf(await call(who, method, path)), `${method} ${path}`).not.toBe(
          'SELLER_CANNOT_ORDER',
        );
    // The guest quote stays public.
    expect(await codeOf(await call(null, 'POST', '/checkout/quote'))).not.toBe('SELLER_CANNOT_ORDER');
  });

  it('a seller signed in on the public quote route is refused; a bad token is treated as a guest', async () => {
    const owner = await person('06', 'seller_owner', sharma);
    expect(await codeOf(await call(owner, 'POST', '/checkout/quote'))).toBe('SELLER_CANNOT_ORDER');
    const bad = { authorization: 'Bearer not-a-real-token-0000000000', 'content-type': 'application/json' };
    expect(await codeOf(await call(bad, 'POST', '/checkout/quote'))).not.toBe('SELLER_CANNOT_ORDER');
  });

  it('a seller can still read the catalogue and their own cart and quotes', async () => {
    const owner = await person('07', 'seller_owner', sharma);
    expect((await call(owner, 'GET', '/me/cart', undefined)).status).toBe(200);
    expect((await call(owner, 'GET', '/quotes', undefined)).status).toBe(200);
  });
});
