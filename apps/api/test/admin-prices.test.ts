/**
 * Admin price API (plan 2026-11-13, Q26): the price board, setting city and PIN prices, clearing a PIN override.
 * Rule failures are 422 with the rule's code, a stale version is 409, other roles get 403.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const SLUG = 'castrol-activ-4t-20w40-900ml';
const SKU = 'CAS-ACT4T-0900';

let ctx: Awaited<ReturnType<typeof buildApp>>;

async function staff(n: string, role: string) {
  const phone = `+9198777777${n}`;
  const token = ctx.verifier.add(`token-admin-prices-00${n}`, {
    firebaseUid: `pr-${n}`,
    phone,
    email: `pr-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `pr-${n}`,
    phone,
    email: `pr-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

interface Board {
  variants: {
    sku: string;
    mrpPaise: number;
    city: { pricePaise: number; version: number } | null;
    pins: {
      pincode: string;
      override: { pricePaise: number; version: number } | null;
      lowestShopPaise: number;
      highestShopPaise: number;
    }[];
  }[];
}

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
});

describe('admin prices API', () => {
  it('a catalogue manager reads the board and sets, updates and clears prices; marketing and catalogue are refused (user 2026-11-14)', async () => {
    const catalogue = await staff('01', 'catalogue_manager');
    const financeRole = await staff('03', 'finance');
    const marketing = await staff('02', 'marketing');
    const boardUrl = `/v1/admin/prices/products/${SLUG}?city=RPR`;
    expect((await ctx.app.request(boardUrl, { headers: marketing })).status).toBe(403);
    expect((await ctx.app.request(boardUrl, { headers: financeRole })).status).toBe(403);
    const res = await ctx.app.request(boardUrl, { headers: catalogue });
    expect(res.status).toBe(200);
    const board = (await res.json()) as Board;
    const v = board.variants[0]!;
    expect(v).toMatchObject({ sku: SKU, mrpPaise: 47_500, city: null });
    const pin = v.pins[0]!;

    const put = (body: unknown, headers = catalogue) =>
      ctx.app.request(`/v1/admin/prices/${SKU}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    expect(
      (await put({ city: 'RPR', pincode: null, pricePaise: 46_000, version: null }, marketing)).status,
    ).toBe(403);

    const above = await put({ city: 'RPR', pincode: null, pricePaise: 47_501, version: null });
    expect(above.status).toBe(422);
    expect(((await above.json()) as ErrorJson).error.code).toBe('MRP_EXCEEDED');
    const below = await put({
      city: 'RPR',
      pincode: pin.pincode,
      pricePaise: pin.lowestShopPaise - 1,
      version: null,
    });
    expect(below.status).toBe(422);
    expect(((await below.json()) as ErrorJson).error.code).toBe('BELOW_SHOP_PRICE');
    expect((await put({ city: 'RPR', pincode: null, pricePaise: 'x', version: null })).status).toBe(400);

    const created = await put({ city: 'RPR', pincode: null, pricePaise: 46_000, version: null });
    expect(created.status).toBe(200);
    const { version } = (await created.json()) as { version: number };
    expect((await put({ city: 'RPR', pincode: null, pricePaise: 46_500, version: null })).status).toBe(409);
    expect((await put({ city: 'RPR', pincode: null, pricePaise: 46_500, version })).status).toBe(200);

    const pinSet = await put({
      city: 'RPR',
      pincode: pin.pincode,
      pricePaise: pin.highestShopPaise,
      version: null,
    });
    expect(pinSet.status).toBe(200);
    const pinVersion = ((await pinSet.json()) as { version: number }).version;
    const del = (ver: number) =>
      ctx.app.request(`/v1/admin/prices/${SKU}/pins/${pin.pincode}?city=RPR&version=${String(ver)}`, {
        method: 'DELETE',
        headers: catalogue,
      });
    expect((await del(pinVersion + 9)).status).toBe(409);
    expect((await del(pinVersion)).status).toBe(204);

    const after = (await (await ctx.app.request(boardUrl, { headers: catalogue })).json()) as Board;
    expect(after.variants[0]!.city).toEqual({ pricePaise: 46_500, version: version + 1 });
    expect(after.variants[0]!.pins.find((p) => p.pincode === pin.pincode)!.override).toBeNull();
    expect(
      (await ctx.app.request(`/v1/admin/prices/products/nope?city=RPR`, { headers: catalogue })).status,
    ).toBe(404);
  });
});
