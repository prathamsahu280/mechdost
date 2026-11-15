/**
 * Product photos over HTTP (spec 02 "Product photos", design 2026-11-15 item 1) with a fake Storage: staff upload,
 * list, reorder, edit alt text and remove; the upload pipeline (magic bytes, re-encode to three variants, EXIF gone,
 * random keys, placeholder); the public image route (approved photos only, long cache, 404 for anything else, signed
 * preview URLs for pending ones); the shop path behind the setting and the approval queue; role-leak checks; and the
 * 503 when Storage is not configured.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import type { PhotoStorage } from '../src/photos/storage';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const k = () => randomBytes(32).toString('base64');
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${k()}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: k(),
});

class FakeStorage implements PhotoStorage {
  readonly bucket = 'photos';
  readonly objects = new Map<string, Buffer>();
  failPut = false;
  put(path: string, bytes: Buffer) {
    if (this.failPut) return Promise.reject(new Error('storage down'));
    this.objects.set(path, bytes);
    return Promise.resolve();
  }
  get(path: string) {
    return Promise.resolve(this.objects.get(path) ?? null);
  }
  remove(path: string) {
    this.objects.delete(path);
    return Promise.resolve();
  }
  ensureBucket() {
    return Promise.resolve();
  }
}

let ctx: Awaited<ReturnType<typeof buildApp>>;
let noStorage: Awaited<ReturnType<typeof buildApp>>;
const storage = new FakeStorage();
const OIL = 'CAS-ACT4T-0900';
let slug = '';
let productId = '';
const shop: Record<string, string> = {};

interface Person {
  id: string;
  token: string;
  headers: Record<string, string>;
}
async function person(n: string, role: string, shopId: string | null = null): Promise<Person> {
  const identity = {
    firebaseUid: `pp-${n}`,
    phone: `+9198666000${n}`,
    email: `pp-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-product-photos-00${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  await grantRole(ctx.db, { userId: user.id, role, shopId, grantedBy: null });
  return { id: user.id, token, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const call = async (p: Person | null, method: string, path: string, payload?: unknown) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: p?.headers ?? {},
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const jpeg = () =>
  sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#c33' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-owner', Orientation: '6' } })
    .toBuffer();

async function upload(
  p: Person | null,
  path: string,
  file: Uint8Array | null,
  opts: { alt?: string | null; altHi?: string | null; type?: string; app?: typeof ctx } = {},
) {
  const form = new FormData();
  if (opts.alt !== null) form.set('alt', opts.alt ?? 'Front of the oil can');
  if (opts.altHi !== null) form.set('altHi', opts.altHi ?? 'तेल के डिब्बे का सामने का हिस्सा');
  if (file) form.set('file', new Blob([file], { type: opts.type ?? 'image/jpeg' }), 'photo.jpg');
  const res = await (opts.app ?? ctx).app.request(`/v1${path}`, {
    method: 'POST',
    headers: p ? bearer(p.token) : {},
    body: form,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
}

const image = (path: string, headers: Record<string, string> = {}) =>
  ctx.app.request(`/v1${path}`, { headers });
const setting = async (on: boolean) => {
  await ctx.db
    .insert(s.settings)
    .values({ cityId: null, key: 'catalogue.shop_photo_uploads', value: on })
    .onConflictDoUpdate({ target: [s.settings.cityId, s.settings.key], set: { value: on } });
};

interface PhotoJson {
  id: string;
  status: string;
  sort: number;
  previewUrl: string;
  version: number;
  lqip: string | null;
  width: number;
}
const photosOf = (r: { body: Record<string, unknown> }) => r.body.photos as PhotoJson[];

let admin: Person;
let ops: Person;
let owner: Person;
let rival: Person;

beforeAll(async () => {
  ctx = await buildApp({ keyring, photoStorage: storage });
  noStorage = await buildApp({ keyring: null, photoStorage: null });
  await seedRaipurDemo(ctx.db, fixture);
  for (const row of await ctx.db.select().from(s.shops)) shop[row.name] = row.id;
  const v = (await ctx.db.select().from(s.productVariants)).find((x) => x.sku === OIL);
  const p = (await ctx.db.select().from(s.products)).find((x) => x.id === v?.productId);
  slug = p!.slug;
  productId = p!.id;
  admin = await person('01', 'catalogue_manager');
  ops = await person('02', 'support_agent');
  owner = await person('03', 'seller_owner', shop['Sharma Auto Parts']);
  rival = await person('04', 'seller_owner', shop['Gupta Lubes & Spares']);
});

describe('staff upload and list', () => {
  const base = () => `/admin/catalogue/products/${slug}/photos`;

  it('needs sign-in and the products permission', async () => {
    expect((await upload(null, base(), await jpeg())).status).toBe(401);
    expect((await upload(ops, base(), await jpeg())).status).toBe(403);
    expect((await call(null, 'GET', base())).status).toBe(401);
    expect((await call(ops, 'GET', base())).status).toBe(403);
  });

  it('stores three variants under random keys, strips EXIF, and lists the photo', async () => {
    const before = storage.objects.size;
    const r = await upload(admin, base(), await jpeg());
    expect(r.status).toBe(201);
    const photo = r.body.photo as PhotoJson;
    expect(photo).toMatchObject({ status: 'approved', sort: 0 });
    expect(photo.lqip).toMatch(/^data:image\/webp;base64,/);
    expect(storage.objects.size - before).toBe(3);
    const keys = [...storage.objects.keys()].slice(-3);
    for (const key of keys) {
      expect(key).toMatch(/^product\/[0-9a-f-]{36}\/[0-9a-f-]{36}(-thumb|-640)?\.webp$/);
      expect(key).not.toContain('photo.jpg');
    }
    for (const bytes of [...storage.objects.values()].slice(-3)) {
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(1600);
    }
    const list = await call(admin, 'GET', base());
    expect(photosOf(list)).toHaveLength(1);
    expect(list.body.max).toBe(8);
    expect(list.body.shopUploadsEnabled).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain('product/');
  });

  it('refuses a missing description, a non-image and an oversize body; keeps nothing', async () => {
    const objects = storage.objects.size;
    expect((await upload(admin, base(), await jpeg(), { alt: null })).status).toBe(422);
    expect((await upload(admin, base(), await jpeg(), { altHi: 'x' })).status).toBe(422);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    const bad = await upload(admin, base(), svg, { type: 'image/jpeg' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('PHOTO_TYPE');
    expect((await upload(admin, base(), null)).status).toBe(422);
    const big = Buffer.alloc(8 * 1024 * 1024 + 70 * 1024, 1);
    expect((await upload(admin, base(), big)).status).toBe(413);
    expect(storage.objects.size).toBe(objects);
    expect(
      (await upload(admin, '/admin/catalogue/products/no-such-product/photos', await jpeg())).status,
    ).toBe(404);
  });

  it('answers 503 and keeps no row when Storage is not configured or fails', async () => {
    const rows = (await ctx.db.select().from(s.productPhotos)).length;
    // Same database, an app without Storage keys (Q112): a clear 503, not a 500, and nothing written.
    noStorage.verifier.add(admin.token, {
      firebaseUid: 'pp-01',
      phone: '+919866600001',
      email: 'pp-01@example.com',
      emailVerified: true,
    });
    const none = await upload(admin, base(), await jpeg(), { app: noStorage });
    expect(none.status).toBe(503);
    expect(none.body.error.code).toBe('PHOTOS_UNAVAILABLE');
    storage.failPut = true;
    const down = await upload(admin, base(), await jpeg());
    storage.failPut = false;
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe('PHOTOS_UNAVAILABLE');
    expect((await ctx.db.select().from(s.productPhotos)).length).toBe(rows);
  });

  it('serves approved photos publicly with a year-long cache, only the three widths', async () => {
    const list = photosOf(await call(admin, 'GET', base()));
    const id = list[0]!.id;
    for (const w of [320, 640, 1600]) {
      const res = await image(`/product-photos/${id}/${String(w)}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/webp');
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
    expect((await image(`/product-photos/${id}/500`)).status).toBe(404);
    expect((await image(`/product-photos/${randomUUID()}/640`)).status).toBe(404);
    expect((await image('/product-photos/not-a-uuid/640')).status).toBe(404);
  });

  it('adds up to eight, refuses a ninth, reorders, edits the description and removes', async () => {
    for (let i = 0; i < 7; i += 1) expect((await upload(admin, base(), await jpeg())).status).toBe(201);
    const ninth = await upload(admin, base(), await jpeg());
    expect(ninth.status).toBe(409);
    expect(ninth.body.error.code).toBe('PRODUCT_PHOTO_LIMIT');
    const list = photosOf(await call(admin, 'GET', base()));
    expect(list.map((p) => p.sort)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const ids = list.map((p) => p.id);
    const reversed = [...ids].reverse();
    const re = await call(admin, 'PUT', `${base()}/order`, { ids: reversed });
    expect(re.status).toBe(200);
    expect(photosOf(re).map((p) => p.id)).toEqual(reversed);
    expect((await call(admin, 'PUT', `${base()}/order`, { ids: ids.slice(1) })).status).toBe(422);
    expect((await call(ops, 'PUT', `${base()}/order`, { ids: reversed })).status).toBe(403);

    const first = photosOf(re)[0]!;
    const patched = await call(admin, 'PATCH', `${base()}/${first.id}`, {
      version: first.version,
      alt: 'Back of the can',
      altHi: 'डिब्बे का पिछला हिस्सा',
    });
    expect(patched.status).toBe(200);
    expect(
      (
        await call(admin, 'PATCH', `${base()}/${first.id}`, {
          version: first.version,
          alt: 'Stale edit',
          altHi: 'पुराना बदलाव',
        })
      ).status,
    ).toBe(409);

    const objects = storage.objects.size;
    expect((await call(admin, 'DELETE', `${base()}/${first.id}`)).status).toBe(200);
    expect(storage.objects.size).toBe(objects - 3);
    expect((await image(`/product-photos/${first.id}/640`)).status).toBe(404);
    expect(photosOf(await call(admin, 'GET', base()))).toHaveLength(7);
  });

  it('shows approved photos, with Hindi text, in the public catalogue answer', async () => {
    const res = await ctx.app.request(`/v1/catalogue/products/${slug}?city=RPR&locale=hi`);
    const body = (await res.json()) as { photos: { path: string; alt: string; lqip: string | null }[] };
    expect(res.status).toBe(200);
    expect(body.photos.length).toBeGreaterThan(0);
    expect(body.photos[0]?.alt).toMatch(/[ऀ-ॿ]/);
    expect(body.photos[0]?.lqip).toMatch(/^data:image\/webp/);
  });
});

describe('shop photos', () => {
  const shopBase = () => `/shop/products/${slug}/photos`;
  const adminBase = () => `/admin/catalogue/products/${slug}/photos`;

  it('are refused while the setting is off', async () => {
    // make room: remove all but three photos
    const list = photosOf(await call(admin, 'GET', adminBase()));
    for (const p of list.slice(3)) await call(admin, 'DELETE', `${adminBase()}/${p.id}`);
    await setting(false);
    const r = await upload(owner, shopBase(), await jpeg());
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PRODUCT_PHOTO_SHOP_UPLOADS_OFF');
  });

  it('wait in a queue until staff approve, and are signed-preview only meanwhile', async () => {
    await setting(true);
    expect((await upload(null, shopBase(), await jpeg())).status).toBe(401);
    expect((await upload(ops, shopBase(), await jpeg())).status).toBe(403);
    const r = await upload(owner, shopBase(), await jpeg());
    expect(r.status).toBe(201);
    const photo = r.body.photo as PhotoJson;
    expect(photo.status).toBe('pending');

    // not public, not in the catalogue
    expect((await image(`/product-photos/${photo.id}/640`)).status).toBe(404);
    const tampered = photo.previewUrl.replace(/s=[^&]+/, 's=AAAA');
    expect((await image(tampered)).status).toBe(404);
    expect((await image(photo.previewUrl)).status).toBe(200);
    const pub = (await (await ctx.app.request(`/v1/catalogue/products/${slug}?city=RPR`)).json()) as {
      photos: { path: string }[];
    };
    expect(pub.photos.map((p) => p.path)).not.toContain(photo.id);

    // the queue is for staff with publish rights
    expect((await call(admin, 'GET', '/admin/catalogue/photo-queue')).status).toBe(200);
    expect((await call(ops, 'GET', '/admin/catalogue/photo-queue')).status).toBe(403);
    expect((await call(owner, 'GET', '/admin/catalogue/photo-queue')).status).toBe(403);
    const queue = await call(admin, 'GET', '/admin/catalogue/photo-queue');
    const items = queue.body.items as { photoId: string; productSlug: string; shopName: string }[];
    expect(items.find((i) => i.photoId === photo.id)).toMatchObject({
      productSlug: slug,
      shopName: 'Sharma Auto Parts',
    });

    expect((await call(ops, 'POST', `/admin/catalogue/photos/${photo.id}/approve`)).status).toBe(403);
    expect((await call(owner, 'POST', `/admin/catalogue/photos/${photo.id}/approve`)).status).toBe(403);
    expect((await call(admin, 'POST', `/admin/catalogue/photos/${photo.id}/approve`)).status).toBe(200);
    expect((await image(`/product-photos/${photo.id}/640`)).status).toBe(200);
    expect((await call(admin, 'POST', `/admin/catalogue/photos/${photo.id}/approve`)).status).toBe(409);
  });

  it('can be refused with a reason code, which removes the photo and its files', async () => {
    const r = await upload(owner, shopBase(), await jpeg());
    const photo = r.body.photo as PhotoJson;
    const objects = storage.objects.size;
    expect((await call(admin, 'POST', `/admin/catalogue/photos/${photo.id}/reject`, {})).status).toBe(400);
    expect(
      (await call(admin, 'POST', `/admin/catalogue/photos/${photo.id}/reject`, { reasonCode: 'made_up' }))
        .status,
    ).toBe(400);
    const out = await call(admin, 'POST', `/admin/catalogue/photos/${photo.id}/reject`, {
      reasonCode: 'low_quality',
    });
    expect(out.status).toBe(200);
    expect(storage.objects.size).toBe(objects - 3);
    expect((await image(photo.previewUrl)).status).toBe(404);
  });

  it('are the shop’s own business: another shop gets 404 or a clear refusal, and may not remove others’', async () => {
    const mine = await upload(owner, shopBase(), await jpeg());
    const photo = mine.body.photo as PhotoJson;
    const sells = (await ctx.db.select().from(s.shopInventory)).filter(
      (r) => r.shopId === shop['Gupta Lubes & Spares'],
    );
    // the rival either does not sell the product (422) or does (and then it must not reach another shop's photo)
    const own = await call(owner, 'GET', shopBase());
    expect(photosOf(own).map((p) => p.id)).toContain(photo.id);
    expect((await call(rival, 'DELETE', `${shopBase()}/${photo.id}`)).status).toBe(404);
    if (sells.length === 0) {
      expect((await call(rival, 'GET', shopBase())).status).toBe(404);
      const no = await upload(rival, shopBase(), await jpeg());
      expect(no.status).toBe(422);
      expect(no.body.error.code).toBe('PRODUCT_PHOTO_NOT_SOLD');
    }
    expect((await call(owner, 'DELETE', `${shopBase()}/${photo.id}`)).status).toBe(200);
    expect(productId).not.toBe('');
  });
});
