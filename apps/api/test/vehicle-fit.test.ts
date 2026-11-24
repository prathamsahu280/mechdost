/**
 * "Fits your vehicle" for sizes over HTTP (user 2026-11-24): sign-in required, the caller's own saved vehicles only,
 * the answer is one SKU plus the vehicle's make and model (never the fitment), unknown products are 404.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { VehicleFitDto } from '@mechdost/shared/account-api';
import { bearer, buildApp } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;

async function person(n: string) {
  const identity = {
    firebaseUid: `fit-api-${n}`,
    phone: `+9198555555${n}`,
    email: `fit-api-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-fit-api-0000000${n}`, identity);
  await ensureUser(ctx.db, identity);
  return { ...bearer(token), 'content-type': 'application/json' };
}

const get = async (h: Record<string, string> | null, path: string) => {
  const res = await ctx.app.request(`/v1${path}`, { method: 'GET', headers: h ?? {} });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  ctx = await buildApp();
  const [cat] = await ctx.db.insert(s.categories).values({ slug: 'tyres', name: 'Tyres' }).returning();
  const [brand] = await ctx.db.insert(s.brands).values({ slug: 'ceat', name: 'CEAT' }).returning();
  const [p] = await ctx.db
    .insert(s.products)
    .values({
      slug: 'ceat-milaze-x3',
      name: 'Milaze X3',
      brandId: brand!.id,
      categoryId: cat!.id,
      hsn: '4011',
      gstRateBp: 1800,
      status: 'live',
      spec: {
        variantSpecs: {
          'CEAT-A': { fitment: [{ vehicleType: 'car', make: 'Honda', model: 'City' }] },
          'CEAT-B': { fitment: [{ vehicleType: 'car', make: 'Maruti Suzuki', model: 'Swift' }] },
        },
      },
    })
    .returning();
  await ctx.db.insert(s.productVariants).values([
    { productId: p!.id, sku: 'CEAT-A', mrpPaise: 300_000, options: { size: '175/65 R14' } },
    { productId: p!.id, sku: 'CEAT-B', mrpPaise: 350_000, options: { size: '185/65 R15' } },
  ]);
});

describe('GET /v1/me/vehicles/fit', () => {
  it('needs a signed-in customer', async () => {
    expect((await get(null, '/me/vehicles/fit?product=ceat-milaze-x3')).status).toBe(401);
  });

  it('answers the size that fits a saved vehicle, and only make and model of the vehicle', async () => {
    const me = await person('1');
    const empty = await get(me, '/me/vehicles/fit?product=ceat-milaze-x3');
    expect(VehicleFitDto.parse(empty.body)).toEqual({ fitsVariantSku: null, vehicle: null });
    const saved = await ctx.app.request('/v1/me/vehicles', {
      method: 'POST',
      headers: me,
      body: JSON.stringify({ type: '4W', fuel: 'petrol', make: 'Maruti Suzuki', model: 'Swift' }),
    });
    expect(saved.status).toBe(201);
    const res = await get(me, '/me/vehicles/fit?product=ceat-milaze-x3');
    expect(res.status).toBe(200);
    expect(VehicleFitDto.parse(res.body)).toEqual({
      fitsVariantSku: 'CEAT-B',
      vehicle: { make: 'Maruti Suzuki', model: 'Swift' },
    });
    expect(JSON.stringify(res.body)).not.toContain('fitment');
  });

  it('does not use another customer vehicles', async () => {
    const other = await person('2');
    const res = await get(other, '/me/vehicles/fit?product=ceat-milaze-x3');
    expect(VehicleFitDto.parse(res.body).fitsVariantSku).toBeNull();
  });

  it('a bad or unknown product is refused', async () => {
    const me = await person('3');
    expect((await get(me, '/me/vehicles/fit?product=No Such')).status).toBe(400);
    expect((await get(me, '/me/vehicles/fit?product=no-such-product')).status).toBe(404);
    expect((await get(me, '/me/vehicles/fit')).status).toBe(400);
  });
});
