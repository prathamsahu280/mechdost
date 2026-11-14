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

  it('sets typed attributes and pack sizes (product comparison, design 2026-11-13)', async () => {
    const manager = await staff('07', 'catalogue_manager');
    const marketing = await staff('08', 'marketing');
    const url = `/v1/admin/catalogue/products/${SLUG}/attributes`;
    const p = (await (
      await ctx.app.request(`/v1/admin/catalogue/products/${SLUG}`, { headers: manager })
    ).json()) as { version: number };
    const body = (attributes: unknown, version = p.version) => JSON.stringify({ version, attributes });
    const oil = { saeGrade: '20W40', apiClass: 'SL', jasoClass: 'MA2', baseType: 'mineral' };
    expect((await ctx.app.request(url, { method: 'PUT', headers: marketing, body: body(oil) })).status).toBe(
      403,
    );
    const bad = await ctx.app.request(url, {
      method: 'PUT',
      headers: manager,
      body: body({ saeGrade: '99W99' }),
    });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as ErrorJson).error.code).toBe('ATTRIBUTES');
    const saved = await ctx.app.request(url, { method: 'PUT', headers: manager, body: body(oil) });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ attributes: oil });
    expect((await ctx.app.request(url, { method: 'PUT', headers: manager, body: body(oil) })).status).toBe(
      409,
    );

    const sku = fixture.products.find((x) => x.slug === SLUG)?.sku ?? '';
    const packUrl = `/v1/admin/catalogue/variants/${sku}/net-quantity`;
    const pack = (netQuantity: unknown) => JSON.stringify({ netQuantity });
    expect(
      (await ctx.app.request(packUrl, { method: 'PUT', headers: manager, body: pack({ qty: 1, unit: 'l' }) }))
        .status,
    ).toBe(400);
    const packed = await ctx.app.request(packUrl, {
      method: 'PUT',
      headers: manager,
      body: pack({ qty: 900, unit: 'ml' }),
    });
    expect(packed.status).toBe(200);
    expect(await packed.json()).toEqual({ sku, netQuantity: { qty: 900, unit: 'ml' } });

    const page = (await (
      await ctx.app.request('/v1/catalogue/products?pincode=492001&locale=en&city=RPR&limit=48')
    ).json()) as { items: { slug: string; offer: { netQuantity: unknown } | null }[] };
    expect(page.items.find((i) => i.slug === SLUG)?.offer?.netQuantity).toEqual({ qty: 900, unit: 'ml' });
    const product = (await (
      await ctx.app.request(`/v1/catalogue/products/${SLUG}?pincode=492001&locale=en&city=RPR`)
    ).json()) as { attributes: unknown; attributeSet: unknown };
    expect(product).toMatchObject({ attributeSet: 'lubricants', attributes: oil });

    // The editor's detail carries the stored attributes and packs (admin catalogue screen, plan Task 5).
    const detail = await (
      await ctx.app.request(`/v1/admin/catalogue/products/${SLUG}`, { headers: manager })
    ).json();
    expect(detail).toMatchObject({
      attributes: oil,
      variants: [{ sku, mrpPaise: expect.any(Number) as number, netQuantity: { qty: 900, unit: 'ml' } }],
    });
  });
});

describe('adding products (plan 2026-11-14 Stream B)', () => {
  const sample = readFileSync(
    fileURLToPath(new URL('../../../docs/runbooks/catalogue-import-sample.csv', import.meta.url)),
    'utf8',
  );
  const body = {
    categorySlug: 'batteries',
    brand: 'Livguard',
    name: 'LG 12V 5Ah scooter battery',
    nameHi: 'LG 12V 5Ah स्कूटर बैटरी',
    vehicleTypes: ['2W'],
    attributes: { voltage: 12, capacityAh: 5, batteryType: 'vrla' },
    sku: 'lg-12v5ah',
    mrpPaise: 165_000,
    hsn: '8507',
    gstRateBp: 1800,
    netQuantity: { qty: 1, unit: 'piece' },
  };
  const post = (url: string, headers: Record<string, string>, b: unknown) =>
    ctx.app.request(url, { method: 'POST', headers, body: JSON.stringify(b) });
  const code = async (r: Response) => ((await r.json()) as ErrorJson).error.code;

  it('creates a draft (or live with publish), refuses duplicates, bad bodies and other roles', async () => {
    const manager = await staff('11', 'catalogue_manager');
    const marketing = await staff('12', 'marketing');
    const url = '/v1/admin/catalogue/products';
    expect((await post(url, marketing, body)).status).toBe(403);
    expect((await post(url, manager, { ...body, status: 'live' })).status).toBe(400); // no mass assignment
    expect((await post(url, manager, { ...body, gstRateBp: 1700 })).status).toBe(400);
    expect((await post(url, manager, { ...body, mrpPaise: 10.5 })).status).toBe(400);

    const created = await post(url, manager, body);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      slug: 'livguard-lg-12v-5ah-scooter-battery',
      sku: 'LG-12V5AH',
      status: 'draft',
      version: 1,
    });
    const dupSku = await post(url, manager, { ...body, slug: 'another-one' });
    expect(dupSku.status).toBe(409);
    expect(await code(dupSku)).toBe('SKU_TAKEN');
    expect(await code(await post(url, manager, { ...body, sku: 'LG-OTHER' }))).toBe('SLUG_TAKEN');
    const badAttr = await post(url, manager, {
      ...body,
      sku: 'LG-X',
      slug: 'lg-x',
      attributes: { voltage: 99 },
    });
    expect(badAttr.status).toBe(422);
    expect(await code(badAttr)).toBe('ATTRIBUTE_VALUE');

    const live = await post(url, manager, { ...body, sku: 'LG-LIVE', slug: 'lg-live', publish: true });
    expect(await live.json()).toMatchObject({ status: 'live' });
    const shown = await ctx.app.request('/v1/catalogue/products/lg-live?locale=hi&city=RPR');
    expect(shown.status).toBe(200);
    expect(await shown.json()).toMatchObject({ name: 'LG 12V 5Ah स्कूटर बैटरी' });
    const draft = await ctx.app.request(
      '/v1/catalogue/products/livguard-lg-12v-5ah-scooter-battery?locale=en&city=RPR',
    );
    expect(draft.status).toBe(404); // drafts stay off the storefront
  });

  it('imports a CSV: dry run first, then one transaction; re-running skips the SKUs already there', async () => {
    const manager = await staff('13', 'catalogue_manager');
    const marketing = await staff('14', 'marketing');
    const url = '/v1/admin/catalogue/import';
    expect((await post(url, marketing, { csv: sample })).status).toBe(403);
    const skus = [
      'SAMPLE-CAS-ACT4T-0900',
      'SAMPLE-EXI-XLTZ4A',
      'SAMPLE-MRF-ZFS-909017',
      'SAMPLE-BOS-F002H20001',
    ];
    const stored = async () =>
      Promise.all(
        skus.map(async (_, i) => {
          const slugs = [
            'castrol-activ-4t-20w-40-engine-oil-900-ml',
            'exide-xltz4a-2w-battery-12-v-3-ah',
            'mrf-zapper-fs-90-90-17-tubeless-tyre',
            'bosch-oil-filter-f-002-h20-001',
          ];
          return (
            await ctx.app.request(`/v1/admin/catalogue/products/${slugs[i] ?? ''}`, { headers: manager })
          ).status;
        }),
      );

    const dry = await post(url, manager, { csv: sample, dryRun: true });
    expect(dry.status).toBe(200);
    const dryReport = (await dry.json()) as { dryRun: boolean; created: { sku: string }[] };
    expect(dryReport.dryRun).toBe(true);
    expect(dryReport.created.map((r) => r.sku)).toEqual(skus);
    expect(await stored()).toEqual([404, 404, 404, 404]);

    const real = await post(url, manager, { csv: sample });
    expect(real.status).toBe(200);
    expect(await real.json()).toMatchObject({ dryRun: false, status: 'draft', skipped: [] });
    expect(await stored()).toEqual([200, 200, 200, 200]);

    const again = (await (await post(url, manager, { csv: sample })).json()) as {
      created: unknown[];
      skipped: { sku: string; reason: string }[];
    };
    expect(again.created).toEqual([]);
    expect(again.skipped.map((s) => s.sku)).toEqual(skus);
  });

  it('one bad row → 422 with every problem by row and column, nothing written', async () => {
    const manager = await staff('15', 'catalogue_manager');
    const csv = [
      'category,brand,name,sku,mrp_rupees,hsn,gst_rate_percent,attributes',
      'batteries,Amaron,Good battery one,AMR-GOOD-1,1200,8507,18,voltage=12',
      'batteries,Amaron,Bad battery,AMR-BAD,twelve hundred,85,18,voltage=12',
      'nope,Amaron,No category,AMR-NOCAT,1200,8507,18,',
      ',Amaron,No category given,AMR-EMPTY,1200,8507,18,',
    ].join('\n');
    const r = await post('/v1/admin/catalogue/import', manager, { csv });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({
      error: {
        code: 'IMPORT_ROWS_INVALID',
        details: {
          errors: [
            { row: 3, field: 'mrp_rupees', code: 'INVALID' },
            { row: 3, field: 'hsn', code: 'INVALID' },
            { row: 4, field: 'category', code: 'UNKNOWN_CATEGORY' },
            { row: 5, field: 'category', code: 'REQUIRED' },
          ],
        },
      },
    });
    const good = await ctx.app.request('/v1/admin/catalogue/products/amaron-good-battery-one', {
      headers: manager,
    });
    expect(good.status).toBe(404);
  });

  it('refuses unreadable files, more than 500 rows, and too many imports per hour', async () => {
    const manager = await staff('16', 'catalogue_manager');
    const url = '/v1/admin/catalogue/import';
    const header = 'category,brand,name,sku,mrp_rupees,hsn,gst_rate_percent';
    const rows = Array.from(
      { length: 501 },
      (_, i) => `batteries,B,Name ${String(i)},S-${String(i)},1,8507,18`,
    );
    const big = await post(url, manager, { csv: [header, ...rows].join('\n') });
    expect(big.status).toBe(422);
    expect(await big.json()).toMatchObject({
      error: { code: 'IMPORT_FILE', details: { reason: 'TOO_MANY_ROWS' } },
    });
    // Exactly the limit is fine: 500 products in one transaction, well inside the request timeout.
    const limit = await post(url, manager, { csv: [header, ...rows.slice(0, 500)].join('\n') });
    expect(limit.status).toBe(200);
    expect(((await limit.json()) as { created: unknown[] }).created).toHaveLength(500);
    expect(await (await post(url, manager, { csv: 'category,brand,price\na,b,1' })).json()).toMatchObject({
      error: { code: 'IMPORT_FILE', details: { reason: 'HEADER', unknown: ['price'] } },
    });
    let last = 0;
    for (let i = 0; i < 27; i++) last = (await post(url, manager, { csv: header })).status;
    expect(last).toBe(422);
    expect((await post(url, manager, { csv: header })).status).toBe(429);
  });
});
