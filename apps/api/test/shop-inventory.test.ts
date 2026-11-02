/**
 * Shop offers over HTTP: an owner edits only their own shop (another shop → 404), staff edit shops in their
 * cities, price above MRP is refused, strict bodies, one rate-limit count per request.
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
const OIL = 'CAS-ACT4T-0900';

let ctx: Awaited<ReturnType<typeof buildApp>>;
const shop: Record<string, string> = {};

async function person(n: string, role: string, shopId: string | null = null) {
  const phone = `+9198555000${n}`;
  const token = ctx.verifier.add(`token-inventory-00${n}`, {
    firebaseUid: `in-${n}`,
    phone,
    email: `in-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `in-${n}`,
    phone,
    email: `in-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, shopId, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  for (const row of await ctx.db.select().from(s.shops)) shop[row.name] = row.id;
});

describe('shop inventory API', () => {
  it('owners edit their own shop; staff edit shops in their cities; MRP is a ceiling', async () => {
    const owner = await person('01', 'seller_owner', shop['Sharma Auto Parts']);
    const ops = await person('02', 'ops_manager');
    const mine = `/v1/shops/${shop['Sharma Auto Parts']!}/inventory`;
    const theirs = `/v1/shops/${shop['Gupta Lubes & Spares']!}/inventory`;

    const remaining = async () =>
      Number((await ctx.app.request(mine, { headers: owner })).headers.get('RateLimit-Remaining'));
    const r1 = await remaining();
    expect(await remaining()).toBe(r1 - 1);

    expect((await ctx.app.request(theirs, { headers: owner })).status).toBe(404);
    expect((await ctx.app.request(mine, { headers: ops })).status).toBe(403); // staff use /admin/shops
    const offers = (await (await ctx.app.request(mine, { headers: owner })).json()) as {
      offers: { sku: string; version: number }[];
    };
    const oil = offers.offers.find((o) => o.sku === OIL)!;

    const above = await ctx.app.request(`${mine}/${OIL}`, {
      method: 'PATCH',
      headers: owner,
      body: JSON.stringify({ version: oil.version, sellingPaise: 99_00_000 }),
    });
    expect(((await above.json()) as ErrorJson).error.code).toBe('PRICE_ABOVE_MRP');
    const sneaky = await ctx.app.request(`${mine}/${OIL}`, {
      method: 'PATCH',
      headers: owner,
      body: JSON.stringify({ version: oil.version, reserved: 0 }),
    });
    expect(sneaky.status).toBe(400);
    const ok = await ctx.app.request(`${mine}/${OIL}`, {
      method: 'PATCH',
      headers: owner,
      body: JSON.stringify({ version: oil.version, sellingPaise: 43500, onHand: 20 }),
    });
    expect(ok.status).toBe(200);
    const { version } = (await ok.json()) as { version: number };

    const staffEdit = await ctx.app.request(
      `/v1/admin/shops/${shop['Sharma Auto Parts']!}/inventory/${OIL}`,
      {
        method: 'PATCH',
        headers: ops,
        body: JSON.stringify({ version, sellingPaise: 44000 }),
      },
    );
    expect(staffEdit.status).toBe(200);
  });
});
