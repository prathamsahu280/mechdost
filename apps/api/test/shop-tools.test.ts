/**
 * Shop portal next tier, part 2 over HTTP (design 2026-11-15 items 4 to 7; specs 07, 13). Role-leak matrix on the CSV,
 * the packing slip and performance (owner, same-shop staff, another shop's owner, customer, MechDost staff, nobody);
 * multipart upload limits and the hourly limit; the slip carries no prices or street address; performance is the
 * owner's alone; the public status lookup needs a phone proved by a token, shows the stage only, and is rate limited.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole, placeCodOrder, quoteCheckout, routeOrder } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900';

let ctx: Awaited<ReturnType<typeof buildApp>>;
const shop: Record<string, string> = {};
interface Who {
  id: string;
  token: string;
}

async function person(
  n: string,
  role: string | null,
  shopId: string | null = null,
  phone?: string,
): Promise<Who> {
  const p = phone ?? `+9198333333${n}`;
  const token = ctx.verifier.add(`token-shoptools-0000${n}`, {
    firebaseUid: `stl-${n}`,
    phone: p,
    email: `stl-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `stl-${n}`,
    phone: p,
    email: `stl-${n}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, shopId, grantedBy: null });
  if (role?.startsWith('seller_') && shopId)
    await ctx.db
      .insert(s.shopUsers)
      .values({ shopId, userId: user.id, role: role === 'seller_owner' ? 'owner' : 'staff' });
  return { id: user.id, token };
}

const call = (who: Who | null, method: string, path: string, body?: unknown) =>
  ctx.app.request(`/v1${path}`, {
    method,
    headers: { ...(who ? bearer(who.token) : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const upload = (who: Who | null, path: string, text: string, field = 'file') => {
  const form = new FormData();
  form.set(field, new File([text], 'stock.csv', { type: 'text/csv' }));
  return ctx.app.request(`/v1${path}`, {
    method: 'POST',
    headers: who ? bearer(who.token) : {},
    body: form,
  });
};
const code = async (r: Response) => ((await r.json()) as ErrorJson).error.code;
const csv = (...lines: string[]) => ['sku,stock,active,requested_price', ...lines].join('\n');

let orderCode = '';

beforeAll(async () => {
  ctx = await buildApp({});
  await seedRaipurDemo(ctx.db, fixture);
  for (const row of await ctx.db.select().from(s.shops)) shop[row.name] = row.id;
  const staffUser = await ensureUser(ctx.db, {
    firebaseUid: 'stl-seed-staff',
    phone: '+919833000001',
    email: null,
    emailVerified: false,
  });
  const [raipur] = (await ctx.db.select().from(s.cities)).filter((c) => c.code === 'RPR');
  const variants = await ctx.db.select().from(s.productVariants);
  await ctx.db.insert(s.adminPrices).values(
    variants.map((v) => ({
      variantId: v.id,
      cityId: raipur!.id,
      sellingPaise: v.mrpPaise,
      updatedBy: staffUser.id,
    })),
  );
  const customer = await ensureUser(ctx.db, {
    firebaseUid: 'stl-seed-cust',
    phone: '+919833000002',
    email: null,
    emailVerified: false,
  });
  const lines = [{ sku: OIL, qty: 1 }];
  const q = await quoteCheckout(ctx.db, { pincode: '492004', lines, locale: 'en' });
  const placed = await placeCodOrder(ctx.db, {
    userId: customer.id,
    idempotencyKey: 'shop-tools-api-key-00001',
    address: {
      contactName: 'Meena Verma',
      contactPhone: '+919811223344',
      line1: 'Flat 4, Tatibandh',
      line2: null,
      landmark: null,
      pincode: '492004',
    },
    lines,
    expectedTotalPaise: q.totalPaise,
    note: null,
    locale: 'en',
  });
  orderCode = placed.orders[0]!.code;
  const o = (await ctx.db.select().from(s.orders)).find((r) => r.code === orderCode);
  const routed = await routeOrder(ctx.db, {
    scope: { all: true },
    code: orderCode,
    shopId: shop['Sharma Auto Parts']!,
    expectedVersion: o!.version,
    staffUserId: staffUser.id,
  });
  const owner = await person('90', 'seller_owner', shop['Sharma Auto Parts']);
  const res = await call(owner, 'POST', `/shop/offers/${routed.assignmentId}/accept`);
  expect(res.status).toBe(200);
});

describe('role-leak matrix', () => {
  it('csv, slip and performance: owner/staff/other owner/customer/support/anonymous', async () => {
    const sharma = shop['Sharma Auto Parts']!;
    const owner = await person('01', 'seller_owner', sharma);
    const staff = await person('02', 'seller_staff', sharma);
    const other = await person('03', 'seller_owner', shop['Gupta Lubes & Spares']);
    const customer = await person('04', null);
    const support = await person('05', 'support_agent');

    const shopScoped: [string, string][] = [
      ['GET', `/shop/csv/${sharma}/template`],
      ['POST', `/shop/csv/${sharma}/preview`],
      ['POST', `/shop/csv/${sharma}/apply`],
      ['GET', `/shop/performance/${sharma}`],
    ];
    const hit = (who: Who | null, method: string, path: string) =>
      method === 'POST' ? upload(who, path, csv(`${OIL},,,`)) : call(who, method, path);
    for (const [method, path] of shopScoped) {
      const label = `${method} ${path}`;
      expect((await hit(null, method, path)).status, `anonymous ${label}`).toBe(401);
      expect((await hit(customer, method, path)).status, `customer ${label}`).toBe(403);
      expect((await hit(support, method, path)).status, `support ${label}`).toBe(403);
      expect((await hit(other, method, path)).status, `other owner ${label}`).toBe(404);
    }
    // The slip is an order of this shop: a foreign shop's owner gets 404, others the same refusals.
    const slipPath = `/shop/slip/${orderCode}`;
    expect((await call(null, 'GET', slipPath)).status).toBe(401);
    expect((await call(customer, 'GET', slipPath)).status).toBe(403);
    expect((await call(support, 'GET', slipPath)).status).toBe(403);
    expect((await call(other, 'GET', slipPath)).status).toBe(404);

    // Owner and staff of the shop: CSV and slip work; performance is the owner's.
    for (const who of [owner, staff]) {
      expect((await call(who, 'GET', `/shop/csv/${sharma}/template`)).status).toBe(200);
      expect((await upload(who, `/shop/csv/${sharma}/preview`, csv(`${OIL},,,`))).status).toBe(200);
      expect((await call(who, 'GET', slipPath)).status).toBe(200);
    }
    expect((await call(owner, 'GET', `/shop/performance/${sharma}`)).status).toBe(200);
    const asStaff = await call(staff, 'GET', `/shop/performance/${sharma}`);
    expect(asStaff.status).toBe(403);
    expect(await code(asStaff)).toBe('OWNER_ONLY');
  });
});

describe('csv upload', () => {
  it('previews, applies and refuses the whole file on one bad line', async () => {
    const sharma = shop['Sharma Auto Parts']!;
    const owner = await person('06', 'seller_owner', sharma);
    const preview = await upload(
      owner,
      `/shop/csv/${sharma}/preview`,
      csv(`${OIL},77,,400`, 'NO-SUCH-SKU,1,,'),
    );
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as {
      errors: { line: number; code: string }[];
      changes: { sku: string }[];
      counts: { stock: number };
    };
    expect(body.errors).toEqual([{ line: 3, column: 'sku', code: 'UNKNOWN_SKU' }]);
    expect(body.counts.stock).toBe(1);
    expect(JSON.stringify(body)).not.toContain('NO-SUCH-SKU');

    const refused = await upload(
      owner,
      `/shop/csv/${sharma}/apply`,
      csv(`${OIL},77,,400`, 'NO-SUCH-SKU,1,,'),
    );
    expect(refused.status).toBe(422);
    expect(await code(refused)).toBe('CSV_HAS_ERRORS');

    const ok = await upload(owner, `/shop/csv/${sharma}/apply`, csv(`${OIL},77,,400`));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ stock: 1, active: 0, priceRequests: 1 });
    const offers = (await (await call(owner, 'GET', `/shops/${sharma}/inventory`)).json()) as {
      offers: { sku: string; onHand: number; sellingPaise: number }[];
    };
    expect(offers.offers.find((o) => o.sku === OIL)?.onHand).toBe(77);
  });

  it('refuses a file over 1 MB, a wrong form, formula cells and unreadable files', async () => {
    const sharma = shop['Sharma Auto Parts']!;
    const owner = await person('07', 'seller_owner', sharma);
    const big = await upload(
      owner,
      `/shop/csv/${sharma}/preview`,
      `sku,stock\n${'AB-12,1\n'.repeat(140_000)}`,
    );
    expect(big.status).toBe(413);
    expect(await code(big)).toBe('CSV_TOO_LARGE');
    expect((await upload(owner, `/shop/csv/${sharma}/preview`, csv(`${OIL},1,,`), 'other')).status).toBe(422);
    const json = await call(owner, 'POST', `/shop/csv/${sharma}/preview`, { csv: 'x' });
    expect(json.status).toBe(422);
    const formula = (await (await upload(owner, `/shop/csv/${sharma}/preview`, csv('=1+1,1,,'))).json()) as {
      errors: { code: string }[];
    };
    expect(formula.errors[0]?.code).toBe('FORMULA_CELL');
    const header = await upload(owner, `/shop/csv/${sharma}/preview`, 'a,b\n1,2');
    expect(header.status).toBe(422);
    expect(await code(header)).toBe('CSV_HEADER');
  });

  it('is limited per user per hour', async () => {
    const sharma = shop['Sharma Auto Parts']!;
    const owner = await person('08', 'seller_owner', sharma);
    let last = 200;
    for (let i = 0; i < 31; i++)
      last = (await upload(owner, `/shop/csv/${sharma}/preview`, csv(`${OIL},,,`))).status;
    expect(last).toBe(429);
  });

  it('the template downloads as a CSV with the shop’s offers', async () => {
    const sharma = shop['Sharma Auto Parts']!;
    const owner = await person('09', 'seller_owner', sharma);
    const r = await call(owner, 'GET', `/shop/csv/${sharma}/template`);
    expect(r.headers.get('content-type')).toContain('text/csv');
    expect(r.headers.get('content-disposition')).toContain('attachment');
    expect(await r.text()).toContain('sku,stock,active,requested_price');
  });
});

describe('packing slip and performance bodies', () => {
  it('the slip has first name, masked phone, PIN and items; no prices, no street, no full phone', async () => {
    const owner = await person('10', 'seller_owner', shop['Sharma Auto Parts']);
    const r = await call(owner, 'GET', `/shop/slip/${orderCode}`);
    const slip = (await r.json()) as Record<string, unknown>;
    expect(slip).toMatchObject({ code: orderCode, firstName: 'Meena', pincode: '492004' });
    const text = JSON.stringify(slip);
    for (const leak of ['Verma', 'Tatibandh', '9811223344', 'Paise', 'price', 'deliveryCode'])
      expect(text).not.toContain(leak);
    expect((slip.phoneMasked as string).endsWith('3344')).toBe(true);
    expect((await call(owner, 'GET', '/shop/slip/not-a-code')).status).toBe(400);
  });

  it('performance returns 30 and 90 day windows with the shop’s numbers', async () => {
    const owner = await person('11', 'seller_owner', shop['Sharma Auto Parts']);
    const r = (await (await call(owner, 'GET', `/shop/performance/${shop['Sharma Auto Parts']}`)).json()) as {
      windows: { days: number; mine: { offers: number; acceptanceBp: number | null }; city: unknown }[];
    };
    expect(r.windows.map((w) => w.days)).toEqual([30, 90]);
    expect(r.windows[0]?.mine).toMatchObject({ offers: 1, acceptanceBp: 10_000 });
  });
});

describe('public application status', () => {
  const lookup = (token: string | null, codeValue: string) =>
    ctx.app.request('/v1/partner-applications/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? bearer(token) : {}) },
      body: JSON.stringify({ code: codeValue }),
    });

  beforeAll(async () => {
    await ctx.db.insert(s.partnerApplications).values({
      code: 'PA-RPR-2026-STAT42',
      kind: 'garage',
      name: 'Sunita',
      phone: '+919844444444',
      pincode: '492001',
      details: 'Two-bay garage',
      status: 'in_review',
      reviewNote: 'internal only note',
      consentAt: new Date(),
    });
  });

  it('shows the stage to the phone that applied; the same 404 for a wrong phone or reference', async () => {
    const right = ctx.verifier.add('token-status-right-00001', {
      firebaseUid: 'ps-1',
      phone: '+919844444444',
    });
    const wrong = ctx.verifier.add('token-status-wrong-00001', {
      firebaseUid: 'ps-2',
      phone: '+919855555555',
    });
    const ok = await lookup(right, 'PA-RPR-2026-STAT42');
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['code', 'kind', 'stage', 'updatedAt']);
    expect(body.stage).toBe('in_review');
    expect(JSON.stringify(body)).not.toContain('internal only');
    const a = await lookup(wrong, 'PA-RPR-2026-STAT42');
    const b = await lookup(right, 'PA-RPR-2026-NOPE99');
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    const strip = async (r: Response) => ({ ...((await r.json()) as ErrorJson).error, requestId: '' });
    expect(await strip(a)).toEqual(await strip(b));
    // No account was created for the applicant by looking.
    const users = (await ctx.db.select().from(s.users)).filter((u) => u.firebaseUid === 'ps-1');
    expect(users).toHaveLength(0);
  });

  it('needs a token with a verified phone; bad references are refused before any lookup', async () => {
    expect((await lookup(null, 'PA-RPR-2026-STAT42')).status).toBe(401);
    expect((await lookup('token-not-registered-0001', 'PA-RPR-2026-STAT42')).status).toBe(401);
    const noPhone = ctx.verifier.add('token-status-nophone-0001', { firebaseUid: 'ps-3', phone: null });
    const r = await lookup(noPhone, 'PA-RPR-2026-STAT42');
    expect(r.status).toBe(403);
    expect(await code(r)).toBe('PHONE_REQUIRED');
    const right = ctx.verifier.add('token-status-right-00002', {
      firebaseUid: 'ps-4',
      phone: '+919844444444',
    });
    expect((await lookup(right, "x'; drop table users;--")).status).toBe(400);
  });

  it('is limited per phone (10 an hour)', async () => {
    const t = ctx.verifier.add('token-status-limit-00001', { firebaseUid: 'ps-5', phone: '+919866666666' });
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await lookup(t, 'PA-RPR-2026-STAT42')).status;
    expect(last).toBe(429);
  });
});
