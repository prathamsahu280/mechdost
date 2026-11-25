/**
 * Role-leak matrix for the product editor behind the storefront "Edit" shortcut (user 2026-11-25; spec 08, spec 13).
 * The button is only a link; these tests pin the server authority: reading a product for edit and every save route
 * refuse anonymous callers (401) and every role without `products:write` (403), whatever the browser showed. And
 * `GET /v1/me`, which the button asks, lists the permission for exactly the roles that may edit.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const SLUG = 'castrol-activ-4t-20w40-900ml';

const WORKSHOP = {
  slug: 'leak-test-garage',
  name: 'Leak Test Garage',
  nameHi: 'लीक टेस्ट गैराज',
  addressLine: 'GE Road, Shankar Nagar',
  addressLineHi: 'जीई रोड, शंकर नगर',
  area: 'Shankar Nagar',
  areaHi: 'शंकर नगर',
  pincode: '492001',
  lat: 21.2514,
  lng: 81.6296,
  phone: '+919811188888',
  vehicleTypes: ['2W'],
  evBasic: false,
  pickup: false,
  hours: { open: '09:00', close: '20:00', days: [0, 1, 2, 3, 4, 5, 6] },
  gstin: '22AAAAA0000A1Z5',
  locationVerified: true,
  published: true,
  menu: [
    {
      key: 'routine2w',
      title: 'General service (2W)',
      titleHi: 'जनरल सर्विस (2W)',
      lowPaise: 80_000,
      highPaise: 150_000,
      minMinutes: 120,
      maxMinutes: 180,
      vehicleType: '2W',
    },
  ],
};

let ctx: Awaited<ReturnType<typeof buildApp>>;
let shopId = '';
let workshopId = '';

type Headers = Record<string, string>;

async function person(
  n: string,
  role: string | null,
  scope: { shopId?: string; workshopId?: string } = {},
): Promise<Headers> {
  const phone = `+9198555555${n}`;
  const token = ctx.verifier.add(`token-catalogue-leak-00${n}`, {
    firebaseUid: `cl-${n}`,
    phone,
    email: `cl-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `cl-${n}`,
    phone,
    email: `cl-${n}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, grantedBy: null, ...scope });
  return { ...bearer(token), 'content-type': 'application/json' };
}

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  shopId = (await ctx.db.select().from(s.shops).limit(1))[0]?.id ?? '';
  // The demo fixture has no workshop: operations creates one through the API, as in production.
  const ops = await person('18', 'ops_manager');
  const made = await ctx.app.request('/v1/admin/workshops', {
    method: 'POST',
    headers: ops,
    body: JSON.stringify(WORKSHOP),
  });
  workshopId = ((await made.json()) as { id: string }).id;
});

/** The editor's routes: the read that opens it and the writes behind its tabs. */
const EDITOR_CALLS: { method: string; path: string; body?: unknown }[] = [
  { method: 'GET', path: `/admin/catalogue/products/${SLUG}` },
  { method: 'GET', path: '/admin/catalogue/products' },
  { method: 'PATCH', path: `/admin/catalogue/products/${SLUG}`, body: { version: 1, nameHi: 'x' } },
  {
    method: 'PUT',
    path: `/admin/catalogue/products/${SLUG}/vehicle-types`,
    body: { version: 1, vehicleTypes: ['2W'] },
  },
  { method: 'POST', path: `/admin/catalogue/products/${SLUG}/status`, body: { version: 1, status: 'draft' } },
  { method: 'POST', path: `/admin/catalogue/products/${SLUG}/variants`, body: { sku: 'leak-1' } },
];

const call = (headers: Headers | null, c: (typeof EDITOR_CALLS)[number]) =>
  ctx.app.request(`/v1${c.path}`, {
    method: c.method,
    headers: headers ?? { 'content-type': 'application/json' },
    ...(c.body === undefined ? {} : { body: JSON.stringify(c.body) }),
  });

describe('product editor: who may open and save it', () => {
  it('refuses a signed-out caller on every editor route', async () => {
    for (const c of EDITOR_CALLS) expect((await call(null, c)).status, `${c.method} ${c.path}`).toBe(401);
  });

  it.each([
    ['customer', null, '11'],
    ['shop owner', 'seller_owner', '12'],
    ['workshop owner', 'workshop_owner', '13'],
    ['support agent', 'support_agent', '14'],
    ['finance', 'finance', '15'],
    ['marketing', 'marketing', '16'],
    ['operations manager', 'ops_manager', '17'],
  ])('refuses a %s on every editor route (403)', async (_name, role, n) => {
    const who = await person(
      n,
      role,
      role === 'seller_owner' ? { shopId } : role === 'workshop_owner' ? { workshopId } : {},
    );
    for (const c of EDITOR_CALLS) expect((await call(who, c)).status, `${c.method} ${c.path}`).toBe(403);
  });

  it('lets a catalogue manager and a super admin open the editor', async () => {
    const manager = await person('61', 'catalogue_manager');
    const admin = await person('62', 'super_admin');
    for (const who of [manager, admin]) {
      const r = await call(who, EDITOR_CALLS[0] as (typeof EDITOR_CALLS)[number]);
      expect(r.status).toBe(200);
    }
  });

  it('answers a catalogue manager 404 for a slug that does not exist (the editor shows not found)', async () => {
    const manager = await person('61', 'catalogue_manager');
    const r = await call(manager, { method: 'GET', path: '/admin/catalogue/products/no-such-product' });
    expect(r.status).toBe(404);
  });
});

describe('GET /v1/me lists products:write only for roles that may edit', () => {
  const perms = async (who: Headers) =>
    ((await (await ctx.app.request('/v1/me', { headers: who })).json()) as { permissions: string[] })
      .permissions;

  it('is present for catalogue manager and super admin, absent for everyone else', async () => {
    expect(await perms(await person('61', 'catalogue_manager'))).toContain('products:write');
    expect(await perms(await person('62', 'super_admin'))).toContain('products:write');
    expect(await perms(await person('63', null))).not.toContain('products:write');
    expect(await perms(await person('64', 'support_agent'))).not.toContain('products:write');
    expect(await perms(await person('65', 'finance'))).not.toContain('products:write');
    expect(await perms(await person('66', 'seller_owner', { shopId }))).not.toContain('products:write');
  });
});
