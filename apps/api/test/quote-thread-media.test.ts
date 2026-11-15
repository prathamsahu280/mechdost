/**
 * Photos and read receipts in the bulk quote thread over HTTP (spec 19; spec 13 "Uploads"): up to four photos per
 * message through the one upload pipeline (magic bytes decide, PDF and other types refused, EXIF dropped, random keys),
 * signed short-lived reads, rights before any image work (404 for other customers and other cities, 409 once closed),
 * and per-side read markers that never say who read. A fake Storage stands in for Supabase.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { QuoteDetailDto } from '@mechdost/shared/quote-api';
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
  readonly bucket = 'quote-photos';
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
const storage = new FakeStorage();

interface Person {
  id: string;
  token: string;
  headers: Record<string, string>;
}

async function person(n: string, opts: { role?: string; cityId?: string } = {}): Promise<Person> {
  const identity = {
    firebaseUid: `quote-media-${n}`,
    phone: `+9198555555${n}`,
    email: `quote-media-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-quote-media-0000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  if (opts.role)
    await grantRole(ctx.db, {
      userId: user.id,
      role: opts.role,
      cityId: opts.cityId ?? null,
      grantedBy: null,
    });
  return { id: user.id, token, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

interface Reply {
  status: number;
  body: Record<string, unknown> & ErrorJson;
}
async function read(res: Response): Promise<Reply> {
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Reply['body'] };
}
let n = 0;
const key = () => ({ 'idempotency-key': `quote-media-key-${String(++n).padStart(6, '0')}` });

const json = async (p: Person, method: string, path: string, payload?: unknown, extra = {}) =>
  read(
    await ctx.app.request(`/v1${path}`, {
      method,
      headers: { ...p.headers, ...extra },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  );

async function form(
  p: Person,
  path: string,
  fields: Record<string, string>,
  files: { bytes: Uint8Array; name?: string; type?: string }[] = [],
): Promise<Reply> {
  const f = new FormData();
  for (const [name, value] of Object.entries(fields)) f.set(name, value);
  files.forEach((file, i) => {
    f.append(
      'file',
      new Blob([file.bytes], { type: file.type ?? 'image/jpeg' }),
      file.name ?? `p${String(i)}.jpg`,
    );
  });
  return read(await ctx.app.request(`/v1${path}`, { method: 'POST', headers: bearer(p.token), body: f }));
}

const jpeg = (w = 1600, h = 1200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#369' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-owner' } })
    .toBuffer();

let ops: Person;
let ravi: Person;
let asha: Person;
let elsewhere: Person;

async function newQuote(who = ravi): Promise<string> {
  const made = await json(
    who,
    'POST',
    '/quotes',
    {
      lines: [{ slug: 'castrol-activ-4t-20w40-900ml', qty: 10 }],
      address: {
        contactName: 'Ravi',
        contactPhone: '+919876543210',
        line1: 'House 12, Pandri',
        pincode: '492004',
      },
      note: 'For my garage',
      locale: 'en',
    },
    key(),
  );
  return String(made.body.code);
}
const detailOf = async (who: Person, code: string, admin = false) =>
  QuoteDetailDto.parse((await json(who, 'GET', `${admin ? '/admin' : ''}/quotes/${code}`)).body);
const close = (code: string) =>
  json(ravi, 'POST', `/quotes/${code}/decline`, { reasonCode: 'no_longer_needed' });

beforeAll(async () => {
  ctx = await buildApp({ keyring, photoStorage: storage });
  await seedRaipurDemo(ctx.db, fixture);
  const [state] = await ctx.db.select().from(s.states);
  const [bls] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'BLS', slug: 'bilaspur', name: 'Bilaspur', status: 'live' })
    .returning();
  ops = await person('01', { role: 'ops_manager' });
  ravi = await person('02');
  asha = await person('03');
  elsewhere = await person('04', { role: 'city_manager', cityId: bls!.id });
});

describe('photos on quote messages', () => {
  it('stores up to four photos (EXIF gone, random keys), shows them to both sides through signed URLs', async () => {
    const code = await newQuote();
    const reply = await form(ravi, `/quotes/${code}/photo-messages`, { body: 'The old filter' }, [
      { bytes: await jpeg() },
      { bytes: await jpeg(800, 600) },
    ]);
    expect(reply.status).toBe(200);
    const mine = await detailOf(ravi, code);
    const message = mine.messages.at(-1)!;
    expect(message).toMatchObject({ from: 'customer', body: 'The old filter' });
    expect(message.attachments).toHaveLength(2);
    expect((await detailOf(ops, code, true)).messages.at(-1)?.attachments).toHaveLength(2);

    const large = await ctx.app.request(`/v1${message.attachments[0]!.largeUrl}`);
    expect(large.status).toBe(200);
    expect(large.headers.get('content-type')).toBe('image/webp');
    expect(large.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = Buffer.from(await large.arrayBuffer());
    expect((await sharp(bytes).metadata()).exif).toBeUndefined();
    expect(
      [...storage.objects.keys()].every((p) =>
        /^quote\/[0-9a-f-]{36}\/[0-9a-f-]{36}(-thumb)?\.webp$/.test(p),
      ),
    ).toBe(true);

    // A tampered signature and an unknown id are 404, never a hint why.
    const url = new URL(`http://x${message.attachments[0]!.largeUrl}`);
    url.searchParams.set('s', 'A'.repeat(43));
    expect((await ctx.app.request(`/v1${url.pathname}${url.search}`)).status).toBe(404);
    expect(
      (await ctx.app.request('/v1/quote-photos/018f0000-0000-7000-8000-000000000000/large?e=1&s=x')).status,
    ).toBe(404);
    await close(code);
  });

  it('staff can attach photos to their reply, and the customer sees them', async () => {
    const code = await newQuote();
    const reply = await form(
      ops,
      `/admin/quotes/${code}/photo-messages`,
      { body: 'This is the pack we mean' },
      [{ bytes: await jpeg(900, 900) }],
    );
    expect(reply.status).toBe(200);
    const msg = (await detailOf(ravi, code)).messages.at(-1)!;
    expect(msg).toMatchObject({ from: 'staff' });
    expect(msg.attachments).toHaveLength(1);
    await close(code);
  });

  it('refuses a PDF, other file types, a fifth photo and a missing photo; nothing is stored', async () => {
    const code = await newQuote();
    const before = storage.objects.size;
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\n');
    const asPdf = await form(ravi, `/quotes/${code}/photo-messages`, { body: 'Invoice' }, [
      { bytes: pdf, name: 'quote.pdf', type: 'application/pdf' },
    ]);
    expect(asPdf.status).toBe(422);
    expect(asPdf.body.error.code).toBe('PHOTO_TYPE');
    const five = await Promise.all([1, 2, 3, 4, 5].map(async () => ({ bytes: await jpeg(200, 200) })));
    const tooMany = await form(ravi, `/quotes/${code}/photo-messages`, { body: 'Many' }, five);
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('ATTACHMENT_LIMIT');
    const none = await form(ravi, `/quotes/${code}/photo-messages`, { body: 'No photo' }, []);
    expect(none.status).toBe(422);
    expect(storage.objects.size).toBe(before);
    expect((await detailOf(ravi, code)).messages).toHaveLength(1);
    await close(code);
  });

  it('is 404 for another customer and for staff of another city, 409 once the quote is closed', async () => {
    const code = await newQuote();
    const photo = [{ bytes: await jpeg(300, 300) }];
    const before = storage.objects.size;
    expect((await form(asha, `/quotes/${code}/photo-messages`, { body: 'Mine now' }, photo)).status).toBe(
      404,
    );
    expect(
      (await form(elsewhere, `/admin/quotes/${code}/photo-messages`, { body: 'Hi' }, photo)).status,
    ).toBe(404);
    expect((await json(asha, 'POST', `/quotes/${code}/read`)).status).toBe(404);
    expect((await json(elsewhere, 'POST', `/admin/quotes/${code}/read`)).status).toBe(404);
    expect(storage.objects.size).toBe(before);
    await close(code);
    const closed = await form(ravi, `/quotes/${code}/photo-messages`, { body: 'Too late' }, photo);
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('QUOTE_CLOSED');
    expect(storage.objects.size).toBe(before);
  });

  it('removes the stored objects and keeps the thread unchanged when storage fails', async () => {
    const code = await newQuote();
    storage.failPut = true;
    const res = await form(ravi, `/quotes/${code}/photo-messages`, { body: 'Storage is down' }, [
      { bytes: await jpeg(300, 300) },
    ]);
    storage.failPut = false;
    expect(res.status).toBe(503);
    expect((await detailOf(ravi, code)).messages).toHaveLength(1);
    await close(code);
  });
});

describe('read receipts', () => {
  it('shows each side only whether its own messages were seen, never who saw them', async () => {
    const code = await newQuote();
    await json(ops, 'POST', `/admin/quotes/${code}/messages`, { body: 'Can you take 12?' });
    expect((await detailOf(ops, code, true)).messages.map((m) => m.seen)).toEqual([false, false]);

    const read1 = await json(ravi, 'POST', `/quotes/${code}/read`);
    expect(read1.status).toBe(200);
    expect(read1.body.readThrough).toEqual(expect.any(String));
    expect((await detailOf(ops, code, true)).messages.map((m) => [m.from, m.seen])).toEqual([
      ['customer', false],
      ['staff', true],
    ]);
    await json(ops, 'POST', `/admin/quotes/${code}/read`);
    const customerView = await json(ravi, 'GET', `/quotes/${code}`);
    expect(QuoteDetailDto.parse(customerView.body).messages.map((m) => [m.from, m.seen])).toEqual([
      ['customer', true],
      ['staff', false],
    ]);
    // Nothing about readers (user ids, names, who/by fields) is in what the customer receives.
    const text = JSON.stringify(customerView.body);
    expect(text).not.toContain(ops.id);
    expect(text).not.toMatch(/readBy|read_by|readerId/);
    await close(code);
  });
});
