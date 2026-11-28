/**
 * Ustaad media over HTTP with an in-memory media host (spec 23 § 10; plan task A4): declare → upload → complete →
 * signed read; rejections for a wrong size, a renamed HTML file and an over-long declaration before any upload; the
 * read check (owner only for unlinked media); 503 without a host; non-members never reach the routes.
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { eq } from '@mechdost/db/testing';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';
import { MemoryHost } from './ustaad-memory-host';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let host: MemoryHost;
let n = 0;
interface Person {
  id: string;
  headers: Record<string, string>;
}
async function person(role?: string): Promise<Person> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const identity = {
    firebaseUid: `ustaad-media-${id}`,
    phone: `+9196000${id.padStart(5, '0')}`,
    email: null,
    emailVerified: false,
  };
  const token = ctx.verifier.add(`token-ustaad-media-0000${id}`, identity);
  const user = await ensureUser(ctx.db, identity);
  if (role) await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}
const call = async (p: Person, method: string, path: string, payload?: unknown) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: p.headers,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const JOIN = {
  track: 'ustaad',
  specialities: ['two_wheeler'],
  displayName: 'Media Mistri',
  showGarage: false,
  pincode: '492001',
  areaLabel: 'Pandri',
  yearsClaimed: 3,
  workPlace: 'shop',
  verifyMethods: [],
  consents: { ustaad_profile: true, ustaad_directory: false, ustaad_training: false, ustaad_offers: false },
  turnstileToken: 'human-token-123',
};

let owner: Person;
let other: Person;
let outsider: Person;
let photo: Uint8Array;

beforeAll(async () => {
  host = new MemoryHost();
  ctx = await buildApp({ turnstile: new FakeTurnstile(['human-token-123']), mediaHost: host });
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  if (!state) throw new Error('state');
  const [raipur] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  if (!raipur) throw new Error('city');
  await ctx.db.insert(s.pincodes).values({ pincode: '492001', stateId: state.id, cityId: raipur.id });
  await ctx.db.insert(s.ustaadReachCities).values({ cityId: raipur.id });
  // Staff preview by default: the members here are staff testers (a catalogue manager each).
  owner = await person('catalogue_manager');
  other = await person('catalogue_manager');
  outsider = await person();
  expect((await call(owner, 'POST', '/ustaad/join', JOIN)).status).toBe(201);
  expect((await call(other, 'POST', '/ustaad/join', JOIN)).status).toBe(201);
  photo = new Uint8Array(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: '#101f34' } })
      .jpeg()
      .toBuffer(),
  );
});

async function declareAndUpload(p: Person, bytes: Uint8Array, mime = 'image/jpeg', uploaded = bytes) {
  const d = await call(p, 'POST', '/ustaad/media', {
    kind: 'image',
    mime,
    bytes: bytes.byteLength,
    sha256: sha(bytes),
  });
  expect(d.status).toBe(201);
  const put = d.body.put as { url: string };
  host.upload(put.url, uploaded, mime);
  return d.body.mediaId as string;
}

describe('Ustaad media API', () => {
  it('declare → upload → complete → the owner gets a signed URL (img_480 variant too)', async () => {
    const id = await declareAndUpload(owner, photo);
    const done = await call(owner, 'POST', `/ustaad/media/${id}/complete`, {});
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'verified', kind: 'image', width: 640 });
    const url = await call(owner, 'GET', `/ustaad/media/${id}/url?variant=img_480`);
    expect(url.status).toBe(200);
    expect(String(url.body.url)).toMatch(/^memory:\/\/media\/m\//);
    // The quarantine original is gone.
    expect([...host.objects.keys()].some((k) => k.startsWith('quarantine:') && k.includes(id))).toBe(false);
  });

  it('SIM-P3: a repeated complete answers the same verified row (a lost answer never forces a re-upload)', async () => {
    const id = await declareAndUpload(owner, photo);
    const first = await call(owner, 'POST', `/ustaad/media/${id}/complete`, {});
    const again = await call(owner, 'POST', `/ustaad/media/${id}/complete`, {});
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id, status: 'verified' });
    // Someone else's repeat is still a 404.
    expect((await call(other, 'POST', `/ustaad/media/${id}/complete`, {})).status).toBe(404);
  });

  it('another member cannot read unlinked media or complete my upload (404)', async () => {
    const id = await declareAndUpload(owner, photo);
    expect((await call(other, 'POST', `/ustaad/media/${id}/complete`, {})).status).toBe(404);
    expect((await call(owner, 'POST', `/ustaad/media/${id}/complete`, {})).status).toBe(200);
    expect((await call(other, 'GET', `/ustaad/media/${id}/url`)).status).toBe(404);
  });

  it('a different size than declared is rejected and deleted', async () => {
    const id = await declareAndUpload(owner, photo, 'image/jpeg', photo.subarray(0, photo.byteLength - 10));
    const r = await call(owner, 'POST', `/ustaad/media/${id}/complete`, {});
    expect(r.status).toBe(422);
    expect((r.body.error.details as { reason: string }).reason).toBe('size_mismatch');
    const [row] = await ctx.db.select().from(s.ustaadMedia).where(eq(s.ustaadMedia.id, id));
    expect(row?.status).toBe('rejected');
  });

  it('bytes other than the declared sha256 are rejected (hash_mismatch)', async () => {
    const other = new Uint8Array(photo);
    other[other.length - 3] = (other[other.length - 3] ?? 0) ^ 0xff;
    const d = await call(owner, 'POST', '/ustaad/media', {
      kind: 'image',
      mime: 'image/jpeg',
      bytes: photo.byteLength,
      sha256: sha(photo),
    });
    host.upload((d.body.put as { url: string }).url, other, 'image/jpeg');
    const r = await call(owner, 'POST', `/ustaad/media/${String(d.body.mediaId)}/complete`, {});
    expect(r.status).toBe(422);
    expect((r.body.error.details as { reason: string }).reason).toBe('hash_mismatch');
  });

  it('a file swapped at the upload URL during verification never becomes the live file (TOCTOU)', async () => {
    const d = await call(owner, 'POST', '/ustaad/media', {
      kind: 'image',
      mime: 'image/jpeg',
      bytes: photo.byteLength,
      sha256: sha(photo),
    });
    const put = d.body.put as { url: string };
    host.upload(put.url, photo, 'image/jpeg');
    const evil = new TextEncoder().encode('<!DOCTYPE html><html>swapped</html>');
    // The moment the server has taken its private copy, the attacker overwrites the upload URL again.
    let swapped = false;
    host.afterCopy = (from) => {
      if (from.startsWith('quarantine:') && !swapped) {
        host.upload(put.url, evil, 'image/jpeg');
        swapped = true;
      }
    };
    const r = await call(owner, 'POST', `/ustaad/media/${String(d.body.mediaId)}/complete`, {});
    host.afterCopy = null;
    expect(swapped).toBe(true);
    expect(r.status).toBe(200);
    const live = [...host.objects.entries()].filter(([k]) => k.startsWith('media:'));
    for (const [, o] of live) expect(new TextDecoder().decode(o.bytes)).not.toContain('swapped');
    // Nothing the client can still write to is ever promoted: the upload key holds the attacker's bytes, unused.
    const [row] = await ctx.db
      .select()
      .from(s.ustaadMedia)
      .where(eq(s.ustaadMedia.id, String(d.body.mediaId)));
    expect(row?.status).toBe('verified');
    expect(row?.bucket).toBe('media');
  });

  it('an HTML file renamed .jpg is rejected by its magic bytes (AT-UP-2)', async () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html><script>alert(1)</script></html>');
    const id = await declareAndUpload(owner, html);
    const r = await call(owner, 'POST', `/ustaad/media/${id}/complete`, {});
    expect(r.status).toBe(422);
    expect((r.body.error.details as { reason: string }).reason).toBe('magic_mismatch');
  });

  it('SVG and an over-long video are refused at declaration, before any upload', async () => {
    const svg = await call(owner, 'POST', '/ustaad/media', {
      kind: 'image',
      mime: 'image/svg+xml',
      bytes: 100,
      sha256: 'a'.repeat(64),
    });
    expect(svg.status).toBe(400);
    const long = await call(owner, 'POST', '/ustaad/media', {
      kind: 'video',
      mime: 'video/mp4',
      bytes: 5_000_000,
      sha256: 'a'.repeat(64),
      durationMs: 181_500,
    });
    expect(long.status).toBe(422);
    expect(long.body.error.code).toBe('MEDIA_TOO_LONG');
  });

  it('a video declared with a typed summary and captions keeps both; a photo cannot carry them (spec 23 § 10a)', async () => {
    const v = await call(owner, 'POST', '/ustaad/media', {
      kind: 'video',
      mime: 'video/mp4',
      bytes: 900_000,
      sha256: 'c'.repeat(64),
      durationMs: 12_000,
      summary: ' Activa brake pads, step by step ',
      captions: { lang: 'hi', text: '0:00 — पुराने पैड निकालो\n0:06 — नए पैड लगाओ' },
    });
    expect(v.status).toBe(201);
    const [row] = await ctx.db
      .select()
      .from(s.ustaadMedia)
      .where(eq(s.ustaadMedia.id, v.body.mediaId as string));
    expect(row?.summary).toBe('Activa brake pads, step by step');
    expect(row?.captionsLang).toBe('hi');
    const photoWithText = await call(owner, 'POST', '/ustaad/media', {
      kind: 'image',
      mime: 'image/jpeg',
      bytes: 100,
      sha256: 'a'.repeat(64),
      summary: 'not for photos',
    });
    expect(photoWithText.status).toBe(400);
  });

  it('non-members never reach the media routes (preview: unknown-path 404)', async () => {
    const r = await call(outsider, 'POST', '/ustaad/media', { kind: 'image' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });
});

describe('without a media host', () => {
  it('declare answers 503 MEDIA_UNAVAILABLE', async () => {
    const plain = await buildApp({ turnstile: new FakeTurnstile(['human-token-123']) });
    const token = plain.verifier.add('token-ustaad-media-nohost-01', {
      firebaseUid: 'ustaad-media-0001',
      phone: '+919600000001',
      email: null,
      emailVerified: false,
    });
    const res = await plain.app.request('/v1/ustaad/media', {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'image', mime: 'image/jpeg', bytes: 100, sha256: 'a'.repeat(64) }),
    });
    expect(res.status).toBe(503);
  });
});
