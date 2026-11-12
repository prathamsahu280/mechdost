/**
 * Admin catalogue API: catalogue managers edit English + Hindi texts (strict body: no price/status/HSN by
 * PATCH), marketing cannot, publishing needs products:publish, one rate-limit count per request.
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

let ctx: Awaited<ReturnType<typeof buildApp>>;

async function staff(n: string, role: string) {
  const phone = `+9198666666${n}`;
  const token = ctx.verifier.add(`token-catalogue-00${n}`, {
    firebaseUid: `ca-${n}`,
    phone,
    email: `ca-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `ca-${n}`,
    phone,
    email: `ca-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
});

describe('admin catalogue API', () => {
  it('edits texts with the version, refuses other fields and other roles', async () => {
    const manager = await staff('01', 'catalogue_manager');
    const marketing = await staff('02', 'marketing');
    const url = `/v1/admin/catalogue/products/${SLUG}`;
    expect((await ctx.app.request(url, { headers: marketing })).status).toBe(403);

    const remaining = async () =>
      Number((await ctx.app.request(url, { headers: manager })).headers.get('RateLimit-Remaining'));
    const r1 = await remaining();
    expect(await remaining()).toBe(r1 - 1);

    const p = (await (await ctx.app.request(url, { headers: manager })).json()) as {
      version: number;
      nameHi: string;
    };
    const sneaky = await ctx.app.request(url, {
      method: 'PATCH',
      headers: manager,
      body: JSON.stringify({ version: p.version, status: 'archived' }),
    });
    expect(sneaky.status).toBe(400); // no mass assignment
    const saved = await ctx.app.request(url, {
      method: 'PATCH',
      headers: manager,
      body: JSON.stringify({
        version: p.version,
        descriptionHi: 'दोपहिया इंजन के लिए भरोसेमंद ऑयल।',
        description: 'Trusted oil for 2W engines.',
      }),
    });
    expect(saved.status).toBe(200);
    const stale = await ctx.app.request(url, {
      method: 'PATCH',
      headers: manager,
      body: JSON.stringify({ version: p.version, description: 'Again' }),
    });
    expect(((await stale.json()) as ErrorJson).error.code).toBe('STALE_PRODUCT');

    const list = (await (
      await ctx.app.request('/v1/admin/catalogue/products?missingHindi=true', { headers: manager })
    ).json()) as {
      items: { slug: string }[];
    };
    expect(list.items.map((i) => i.slug)).not.toContain(SLUG);
  });

  it('sets the vehicle types a product is for; the public catalogue filters on them (decision 2026-11-12)', async () => {
    const manager = await staff('05', 'catalogue_manager');
    const marketing = await staff('06', 'marketing');
    const url = `/v1/admin/catalogue/products/${SLUG}/vehicle-types`;
    const listed = async (vehicle: string) =>
      (
        (await (await ctx.app.request(`/v1/catalogue/products?vehicle=${vehicle}&locale=en`)).json()) as {
          items: { slug: string; vehicleTypes: string[] }[];
        }
      ).items;
    expect((await listed('3W')).map((i) => i.slug)).not.toContain(SLUG);
    const p = (await (
      await ctx.app.request(`/v1/admin/catalogue/products/${SLUG}`, { headers: manager })
    ).json()) as {
      version: number;
      vehicleTypes: string[];
    };
    expect(p.vehicleTypes).toEqual(['2W']);
    const body = (types: unknown) => JSON.stringify({ version: p.version, vehicleTypes: types });
    expect(
      (await ctx.app.request(url, { method: 'PUT', headers: marketing, body: body(['3W']) })).status,
    ).toBe(403);
    expect((await ctx.app.request(url, { method: 'PUT', headers: manager, body: body(['EV']) })).status).toBe(
      400,
    );
    const saved = await ctx.app.request(url, { method: 'PUT', headers: manager, body: body(['3W', '2W']) });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ vehicleTypes: ['2W', '3W'] });
    expect((await ctx.app.request(url, { method: 'PUT', headers: manager, body: body([]) })).status).toBe(
      409,
    );
    const threeWheelers = await listed('3W');
    expect(threeWheelers.find((i) => i.slug === SLUG)?.vehicleTypes).toEqual(['2W', '3W']);
  });
});
