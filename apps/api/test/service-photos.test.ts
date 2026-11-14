/**
 * Job photos over HTTP (spec 06 "Job photos", spec 13 "Uploads", design 2026-11-15) with a fake Storage: the upload
 * pipeline (magic bytes, size, re-encode, EXIF gone, random keys), the gate on `vehicle-received`, who may upload, list
 * and view, the short-lived image URLs, the public gallery switch, no Storage secrets in answers, and the 503 when
 * Storage is not configured.
 */
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { istDateString } from '@mechdost/shared/time';
import type { PhotoStorage } from '../src/photos/storage';
import { sniffImage } from '../src/photos/image';
import { signPhotoUrl } from '../src/photos/url-token';
import { bearer, buildApp, type ErrorJson } from './helpers';

const k = () => randomBytes(32).toString('base64');
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${k()}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: k(),
});

class FakeStorage implements PhotoStorage {
  readonly bucket = 'service-photos';
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
const city: Record<string, string> = {};
const TODAY = istDateString(new Date());

interface Person {
  id: string;
  token: string;
  headers: Record<string, string>;
}

async function person(n: string, opts: { role?: string } = {}): Promise<Person> {
  const identity = {
    firebaseUid: `photo-api-${n}`,
    phone: `+9198444444${n}`,
    email: `photo-api-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-photo-api-000000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  if (opts.role) await grantRole(ctx.db, { userId: user.id, role: opts.role, cityId: null, grantedBy: null });
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

async function upload(
  p: Person,
  code: string,
  file: Uint8Array | null,
  opts: { stage?: string; type?: string; name?: string; app?: typeof ctx } = {},
) {
  const form = new FormData();
  if (opts.stage !== '') form.set('stage', opts.stage ?? 'before');
  if (file) form.set('file', new Blob([file], { type: opts.type ?? 'image/jpeg' }), opts.name ?? 'photo.jpg');
  const res = await (opts.app ?? ctx).app.request(`/v1/workshop/requests/${code}/photos`, {
    method: 'POST',
    headers: bearer(p.token),
    body: form,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
}

/** A real camera-style JPEG: big, rotated by EXIF, with GPS and a copyright string in its metadata. */
const jpegWithExif = () =>
  sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#c33' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-owner', Orientation: '6' } })
    .toBuffer();

const WORKSHOP = {
  slug: 'photo-garage',
  name: 'Photo Garage',
  nameHi: 'फ़ोटो गैराज',
  addressLine: 'GE Road',
  addressLineHi: 'जीई रोड',
  area: 'Shankar Nagar',
  areaHi: 'शंकर नगर',
  pincode: '492001',
  lat: 21.2514,
  lng: 81.6296,
  phone: '+919811199998',
  vehicleTypes: ['2W'],
  evBasic: false,
  pickup: false,
  hours: { open: '09:00', close: '20:00', days: [1, 2, 3, 4, 5, 6] },
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

let ops: Person;
let owner: Person;
let stranger: Person;
let customer: Person;
let other: Person;
let support: Person;
let code = '';
let version = 1;

beforeAll(async () => {
  ctx = await buildApp({ keyring, photoStorage: storage });
  noStorage = await buildApp({ keyring, photoStorage: null });
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [rpr] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  city.RPR = rpr!.id;
  await ctx.db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: rpr!.id,
    centroid: { lng: 81.6296, lat: 21.2514 },
  });
  ops = await person('01', { role: 'ops_manager' });
  owner = await person('02');
  customer = await person('03');
  other = await person('04');
  stranger = await person('05');
  support = await person('06', { role: 'support_agent' });
  const created = await call(ops, 'POST', '/admin/workshops', WORKSHOP);
  const workshopId = String(created.body.id);
  await call(ops, 'POST', `/admin/workshops/${workshopId}/members`, {
    phone: '+919844444402',
    role: 'workshop_owner',
  });
  const second = await call(ops, 'POST', '/admin/workshops', {
    ...WORKSHOP,
    slug: 'other-garage',
    name: 'Other',
  });
  await call(ops, 'POST', `/admin/workshops/${String(second.body.id)}/members`, {
    phone: '+919844444405',
    role: 'workshop_owner',
  });
}, 60_000);

describe('setup', () => {
  it('books and confirms a request (headers need the idempotency key)', async () => {
    const res = await ctx.app.request('/v1/service-requests', {
      method: 'POST',
      headers: { ...customer.headers, 'idempotency-key': 'photo-api-booking-0001' },
      body: JSON.stringify({
        workshopSlug: WORKSHOP.slug,
        vehicleType: '2W',
        vehicle: 'Honda Activa 6G',
        serviceKeys: ['routine2w'],
        pincode: '492001',
        preferredDate: TODAY,
        preferredSlot: 'morning',
      }),
    });
    expect(res.status).toBe(201);
    const made = (await res.json()) as { code: string; version: number };
    code = made.code;
    const proposed = await call(owner, 'POST', `/workshop/requests/${code}/propose`, {
      date: TODAY,
      slot: 'morning',
      lowPaise: 80_000,
      highPaise: 150_000,
      version: made.version,
    });
    expect(proposed.status).toBe(200);
    const accepted = await call(customer, 'POST', `/service-requests/${code}/proposal`, {
      accept: true,
      version: Number(proposed.body.version),
    });
    expect(accepted.status).toBe(200);
    version = Number(accepted.body.version);
  });
});

describe('upload pipeline', () => {
  it('re-encodes to WebP (large and thumbnail), drops EXIF, uses random keys and never echoes storage details', async () => {
    const res = await upload(owner, code, await jpegWithExif());
    expect(res.status).toBe(201);
    const photo = res.body.photo as Record<string, unknown>;
    expect(photo.stage).toBe('before');
    expect(Math.max(Number(photo.width), Number(photo.height))).toBe(1600);
    expect(JSON.stringify(res.body)).not.toMatch(/supabase|storage\/v1|job\/[0-9a-f]{8}/);
    const keys = [...storage.objects.keys()];
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(key).toMatch(/^job\/[0-9a-f-]{36}\/[0-9a-f-]{36}(-thumb)?\.webp$/);
    const large = [...storage.objects.entries()].find(([key]) => !key.includes('-thumb'))![1];
    const thumb = [...storage.objects.entries()].find(([key]) => key.includes('-thumb'))![1];
    for (const buf of [large, thumb]) {
      const meta = await sharp(buf).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(buf.toString('latin1')).not.toContain('secret-owner');
    }
    const tm = await sharp(thumb).metadata();
    expect(Math.max(tm.width, tm.height)).toBeLessThanOrEqual(480);
    const [row] = await ctx.db.select().from(s.mediaObjects);
    expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.mime).toBe('image/webp');
  });

  it('trusts the first bytes, not the name or MIME type: SVG, GIF, text and HEIC are refused', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const a = await upload(owner, code, svg, { type: 'image/jpeg', name: 'photo.jpg' });
    expect([a.status, a.body.error.code]).toEqual([422, 'PHOTO_TYPE']);
    const gif = Buffer.from('GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;', 'latin1');
    expect((await upload(owner, code, gif, { type: 'image/png', name: 'a.png' })).body.error.code).toBe(
      'PHOTO_TYPE',
    );
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(32)]);
    const h = await upload(owner, code, heic, { type: 'image/heic', name: 'IMG_1.heic' });
    expect([h.status, h.body.error.code]).toEqual([422, 'PHOTO_HEIC']);
    // JPEG signature on top of a PNG body: the decoder disagrees with the header
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    expect(sniffImage(png)).toBe('png');
    // A truncated JPEG: right header, not decodable
    const jpeg = await jpegWithExif();
    const cut = await upload(owner, code, jpeg.subarray(0, 600));
    expect([cut.status, cut.body.error.code]).toEqual([422, 'PHOTO_UNREADABLE']);
  });

  it('refuses a file over 8 MB while streaming (413), and a missing file or stage', async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9 * 1024 * 1024)]);
    const res = await upload(owner, code, big);
    expect([res.status, res.body.error.code]).toEqual([413, 'PHOTO_TOO_LARGE']);
    expect((await upload(owner, code, null)).status).toBe(422);
    expect((await upload(owner, code, await jpegWithExif(), { stage: '' })).status).toBe(422);
    expect((await upload(owner, code, await jpegWithExif(), { stage: 'during' })).status).toBe(422);
  });

  it('answers 503 PHOTOS_UNAVAILABLE without Storage, and cleans up when Storage fails mid-way', async () => {
    for (const [t, v] of ctx.verifier.tokens) noStorage.verifier.tokens.set(t, v);
    const res = await upload(owner, code, await jpegWithExif(), { app: noStorage });
    expect([res.status, res.body.error.code]).toEqual([503, 'PHOTOS_UNAVAILABLE']);
    const before = storage.objects.size;
    storage.failPut = true;
    const failed = await upload(owner, code, await jpegWithExif());
    storage.failPut = false;
    expect([failed.status, failed.body.error.code]).toEqual([503, 'PHOTOS_UNAVAILABLE']);
    expect(storage.objects.size).toBe(before);
  });
});

describe('who may upload, list and view', () => {
  it("another workshop's owner and a customer cannot upload (404 / 403); anonymous is 401", async () => {
    const jpeg = await jpegWithExif();
    expect((await upload(stranger, code, jpeg)).status).toBe(404); // owner of the other workshop
    const second = await person('07');
    expect((await upload(second, code, jpeg)).status).toBe(403); // no workshop grant at all
    expect((await upload(customer, code, jpeg)).status).toBe(403);
    const res = await ctx.app.request(`/v1/workshop/requests/${code}/photos`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('lists to the customer, the workshop and staff; others get 404; URLs are signed and expire', async () => {
    const mine = await call(customer, 'GET', `/service-requests/${code}/photos`);
    expect(mine.status).toBe(200);
    const photos = mine.body.photos as { thumbUrl: string; largeUrl: string; id: string }[];
    expect(photos).toHaveLength(1);
    expect(mine.body.required).toBe(true);
    expect(mine.body.maxPerStage).toBe(6);
    expect((await call(other, 'GET', `/service-requests/${code}/photos`)).status).toBe(404);
    expect((await call(owner, 'GET', `/workshop/requests/${code}/photos`)).status).toBe(200);
    expect((await call(support, 'GET', `/admin/service-requests/${code}/photos`)).status).toBe(200);
    expect((await call(customer, 'GET', `/admin/service-requests/${code}/photos`)).status).toBe(403);
    expect((await call(null, 'GET', `/service-requests/${code}/photos`)).status).toBe(401);

    // the signed URL works without a token, once; a tampered or unsigned one is 404
    const img = await ctx.app.request(`/v1${photos[0]!.thumbUrl}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    expect(img.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(sniffImage(new Uint8Array(await img.arrayBuffer()))).toBe('webp');
    const tampered = photos[0]!.largeUrl.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'));
    expect((await ctx.app.request(`/v1${tampered}`)).status).toBe(404);
    expect((await ctx.app.request(`/v1${photos[0]!.largeUrl.split('?')[0]!}`)).status).toBe(404);
    const [media] = await ctx.db.select().from(s.mediaObjects);
    const old = signPhotoUrl(keyring, media!.id, Date.now() - 3_600_000);
    expect(
      (await ctx.app.request(`/v1/service-photos/${media!.id}/large?e=${String(old.exp)}&s=${old.sig}`))
        .status,
    ).toBe(404);
    // a foreign id and a bad variant
    expect(
      (await ctx.app.request('/v1/service-photos/00000000-0000-4000-8000-000000000000/thumb')).status,
    ).toBe(404);
    expect((await ctx.app.request(`/v1${photos[0]!.thumbUrl.replace('thumb', 'original')}`)).status).toBe(
      404,
    );
  });

  it('the workshop removes a photo (the other workshop cannot) and it disappears', async () => {
    const list = (await call(owner, 'GET', `/workshop/requests/${code}/photos`)).body.photos as {
      id: string;
    }[];
    const o2 = stranger;
    expect((await call(o2, 'DELETE', `/workshop/requests/${code}/photos/${list[0]!.id}`)).status).toBe(404);
    expect((await call(customer, 'DELETE', `/workshop/requests/${code}/photos/${list[0]!.id}`)).status).toBe(
      403,
    );
    expect((await call(owner, 'DELETE', `/workshop/requests/${code}/photos/${list[0]!.id}`)).status).toBe(
      200,
    );
    expect(
      ((await call(customer, 'GET', `/service-requests/${code}/photos`)).body.photos as unknown[]).length,
    ).toBe(0);
    const [media] = await ctx.db.select().from(s.mediaObjects);
    expect((await ctx.app.request(`/v1/service-photos/${media!.id}/thumb`)).status).toBe(404);
  });
});

describe('the gate over HTTP', () => {
  it('vehicle-received is 409 PHOTOS_REQUIRED without a before photo and works with one', async () => {
    const refused = await call(owner, 'POST', `/workshop/requests/${code}/vehicle-received`, {
      odometerKm: 5000,
      version,
    });
    expect([refused.status, refused.body.error.code]).toEqual([409, 'PHOTOS_REQUIRED']);
    expect((await upload(owner, code, await jpegWithExif())).status).toBe(201);
    const ok = await call(owner, 'POST', `/workshop/requests/${code}/vehicle-received`, {
      odometerKm: 5000,
      version,
    });
    expect(ok.status).toBe(200);
  });
});

describe('the public gallery switch', () => {
  it('is disabled by default and empty; on, it lists only completed jobs (none yet)', async () => {
    const off = await call(null, 'GET', `/workshops/${WORKSHOP.slug}/photos`);
    expect(off.body).toEqual({ enabled: false, photos: [] });
    await ctx.db.insert(s.settings).values({ cityId: null, key: 'service.photos_public', value: true });
    const on = await call(null, 'GET', `/workshops/${WORKSHOP.slug}/photos`);
    expect(on.body).toEqual({ enabled: true, photos: [] });
    // the job is not completed: its photo is not public
    const [media] = await ctx.db.select().from(s.mediaObjects).limit(5);
    const img = await ctx.app.request(`/v1/service-photos/${media!.id}/thumb`);
    expect(img.status).toBe(404);
  });
});
