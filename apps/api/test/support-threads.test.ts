/**
 * Order and request threads over HTTP (design 2026-11-15 "Support next tier", items 1 to 3; spec 09, spec 13 "Uploads"):
 * one open thread per order, issue codes, photo attachments through the one upload pipeline with a fake Storage
 * (magic bytes, count, EXIF gone, random keys, signed short-lived reads), the COD refund destination (validated,
 * encrypted, masked everywhere) and the manual refund request made from the ticket. Role-leak and rate-limit checks.
 */
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import type { PhotoStorage } from '../src/photos/storage';
import { signPhotoUrl } from '../src/photos/url-token';
import { bearer, buildApp, type ErrorJson } from './helpers';

const k = () => randomBytes(32).toString('base64');
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${k()}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: k(),
});

class FakeStorage implements PhotoStorage {
  readonly bucket = 'support-photos';
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
let cityId = '';
let shopId = '';
let orderN = 0;

interface Person {
  id: string;
  token: string;
  headers: Record<string, string>;
}

async function person(n: string, role?: string): Promise<Person> {
  const identity = {
    firebaseUid: `thread-${n}`,
    phone: `+9198333333${n}`,
    email: `thread-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-thread-000000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId: null, grantedBy: null });
  return { id: user.id, token, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

async function order(p: Person, method: 'cod' | 'online', status = 'delivered') {
  orderN += 1;
  const group = `MD-RPR-2026-TT${String(orderN).padStart(4, '0')}`.replace(/[ILOU]/g, 'X');
  const [g] = await ctx.db
    .insert(s.orderGroups)
    .values({
      code: group,
      userId: p.id,
      cityId,
      paymentMethod: method,
      paymentStatus: method === 'cod' ? 'cod_pending' : 'paid',
      subtotalPaise: 50000,
      totalPaise: 50000,
      idempotencyKey: `thread-${group}-xxxxxxxxxx`,
    })
    .returning();
  await ctx.db.insert(s.orders).values({
    groupId: g!.id,
    subNo: 1,
    code: `${group}-1`,
    userId: p.id,
    cityId,
    status,
    shopId,
    shippingAddress: { line1: 'Sarona', pincode: '492001' },
    pincode: '492001',
    subtotalPaise: 50000,
    totalPaise: 50000,
  });
  return { group, sub: `${group}-1` };
}

const jpeg = (w = 1600, h = 1200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#936' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-owner' } })
    .toBuffer();

interface Attachment {
  id: string;
  thumbUrl: string;
  largeUrl: string;
}
/** The answer fields these tests read (every route's body, loosely); anything else stays `unknown`. */
interface Body extends ErrorJson {
  code: string;
  id: string;
  reopened: boolean;
  messages: { attachments: Attachment[] }[];
  destination: unknown;
  refund: unknown;
  [key: string]: unknown;
}
interface Reply {
  status: number;
  body: Body;
}
async function read(res: Response): Promise<Reply> {
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Reply['body'] };
}

async function form(
  p: Person | null,
  path: string,
  fields: Record<string, string>,
  files: (Uint8Array | { name: string; bytes: Uint8Array })[] = [],
  app: typeof ctx = ctx,
): Promise<Reply> {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) f.set(key, value);
  files.forEach((file, i) => {
    const bytes = file instanceof Uint8Array ? file : file.bytes;
    f.append(
      'file',
      new Blob([bytes], { type: 'image/jpeg' }),
      file instanceof Uint8Array ? `p${String(i)}.jpg` : file.name,
    );
  });
  return read(await app.app.request(path, { method: 'POST', headers: p ? bearer(p.token) : {}, body: f }));
}

const json = async (
  p: Person | null,
  method: string,
  path: string,
  payload?: unknown,
  extra: Record<string, string> = {},
) =>
  read(
    await ctx.app.request(path, {
      method,
      headers: { ...(p?.headers ?? {}), ...extra },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  );

let asha: Person;
let ravi: Person;
let agent: Person;
let marketing: Person;

beforeAll(async () => {
  ctx = await buildApp({ keyring, photoStorage: storage });
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [rpr] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  cityId = rpr!.id;
  await ctx.db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId,
    centroid: { lng: 81.6296, lat: 21.2514 },
  });
  const [shop] = await ctx.db
    .insert(s.shops)
    .values({
      name: 'Thread Parts',
      nameHi: 'थ्रेड पार्ट्स',
      phone: '+919800000777',
      addressLine: 'Raipur',
      pincode: '492001',
      cityId,
      stateId: state!.id,
      location: { lng: 81.641, lat: 21.227 },
      status: 'approved',
    })
    .returning();
  shopId = shop!.id;
  asha = await person('01');
  ravi = await person('02');
  agent = await person('03', 'support_agent');
  marketing = await person('04', 'marketing');
}, 60_000);

// The daily limit (5 new requests) is its own rule (support.test.ts): age earlier requests out of its window.
beforeEach(async () => {
  await ctx.db.update(s.supportTickets).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) });
});

describe('opening a thread', () => {
  it('opens with an issue code and a photo; the thread lists it with a short-lived image URL that works once signed', async () => {
    const o = await order(asha, 'online');
    const before = storage.objects.size;
    const made = await form(
      asha,
      '/v1/support/threads',
      { issueCode: 'damaged', orderCode: o.group, body: 'The box was crushed.' },
      [await jpeg()],
    );
    expect(made.status).toBe(201);
    expect(made.body.reopened).toBe(false);
    expect(storage.objects.size).toBe(before + 2);
    const keys = [...storage.objects.keys()].slice(-2);
    for (const key of keys) expect(key).toMatch(/^ticket\/[0-9a-f-]{36}\/[0-9a-f-]{36}(-thumb)?\.webp$/);
    const meta = await sharp(storage.objects.get(keys[0] ?? '') ?? Buffer.alloc(0)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('webp');

    const mine = await json(asha, 'GET', `/v1/support/tickets/${made.body.code}`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ kind: 'order_issue', issueCode: 'damaged', orderCode: o.group });
    const att = mine.body.messages[0].attachments[0];
    expect(att.thumbUrl).toMatch(/^\/support-photos\/[0-9a-f-]{36}\/thumb\?e=\d+&s=/);
    expect(JSON.stringify(mine.body)).not.toMatch(/supabase|storage\/v1|ticket\/[0-9a-f-]{36}\//);

    const img = await ctx.app.request(`/v1${att.largeUrl}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    expect(img.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    // no signature, a forged one and an expired one are all plain 404s
    expect((await ctx.app.request(`/v1/support-photos/${att.id}/large`)).status).toBe(404);
    expect((await ctx.app.request(`/v1/support-photos/${att.id}/large?e=9999999999&s=forged`)).status).toBe(
      404,
    );
    const old = signPhotoUrl(keyring, att.id, Date.now() - 3_600_000);
    expect(
      (await ctx.app.request(`/v1/support-photos/${att.id}/large?e=${String(old.exp)}&s=${old.sig}`)).status,
    ).toBe(404);
    // a signature for another photo does not open this one
    const other = signPhotoUrl(keyring, '11111111-1111-4111-8111-111111111111');
    expect(
      (await ctx.app.request(`/v1/support-photos/${att.id}/large?e=${String(other.exp)}&s=${other.sig}`))
        .status,
    ).toBe(404);

    // staff see the same photos; another customer's request is 404 for the customer
    const staff = await json(agent, 'GET', `/v1/admin/support/tickets/${made.body.code}`);
    expect(staff.body.messages[0].attachments).toHaveLength(1);
    expect((await json(ravi, 'GET', `/v1/support/tickets/${made.body.code}`)).status).toBe(404);
  });

  it('a second help on the same order continues the same thread (200, reopened)', async () => {
    const o = await order(asha, 'online');
    const a = await form(asha, '/v1/support/threads', {
      issueCode: 'late',
      orderCode: o.group,
      body: 'Where is it?',
    });
    const b = await form(asha, '/v1/support/threads', {
      issueCode: 'late',
      orderCode: o.group,
      body: 'Hello?',
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body).toEqual({ code: a.body.code, reopened: true });
    const thread = await json(asha, 'GET', `/v1/support/tickets/${a.body.code}`);
    expect(thread.body.messages).toHaveLength(2);
  });

  it('validates: issue code, subject, message, order shape; foreign order is 404', async () => {
    const mine = await order(asha, 'online');
    const theirs = await order(ravi, 'online');
    const go = (fields: Record<string, string>) => form(asha, '/v1/support/threads', fields);
    expect((await go({ issueCode: 'nope', orderCode: mine.group, body: 'x' })).status).toBe(400);
    expect((await go({ issueCode: 'late', orderCode: 'bad', body: 'x' })).status).toBe(400);
    expect((await go({ issueCode: 'late', orderCode: mine.group, body: '' })).status).toBe(400);
    expect((await go({ issueCode: 'late', body: 'x' })).body.error.code).toBe('SUBJECT_REQUIRED');
    expect(
      (await go({ issueCode: 'workshop_issue', orderCode: mine.group, body: 'x' })).body.error.code,
    ).toBe('ISSUE_NOT_FOR_SUBJECT');
    expect((await go({ issueCode: 'late', orderCode: theirs.group, body: 'x' })).status).toBe(404);
    expect(
      (await go({ issueCode: 'workshop_issue', serviceCode: 'SR-RPR-2026-AAAAAA', body: 'x' })).status,
    ).toBe(404);
    // JSON instead of a form is refused, not guessed at
    const asJson = await json(asha, 'POST', '/v1/support/threads', { issueCode: 'late' });
    expect(asJson.status).toBe(422);
  });
});

describe('photo attachments', () => {
  it('refuses a fifth photo, non-images and HEIC, stores nothing, and creates no ticket', async () => {
    const o = await order(asha, 'online');
    const before = storage.objects.size;
    const fields = { issueCode: 'damaged', orderCode: o.group, body: 'Photos' };
    const five = await form(asha, '/v1/support/threads', fields, [
      await jpeg(200, 200),
      await jpeg(200, 200),
      await jpeg(200, 200),
      await jpeg(200, 200),
      await jpeg(200, 200),
    ]);
    expect(five.status).toBe(422);
    expect(five.body.error.code).toBe('ATTACHMENT_LIMIT');
    const text = await form(asha, '/v1/support/threads', fields, [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ]);
    expect(text.body.error.code).toBe('PHOTO_TYPE');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(32)]);
    expect((await form(asha, '/v1/support/threads', fields, [heic])).body.error.code).toBe('PHOTO_HEIC');
    expect(storage.objects.size).toBe(before);
    const rows = await ctx.db.select().from(s.supportTickets);
    expect(rows.filter((r) => r.orderId && r.issueCode === 'damaged' && r.userId === asha.id)).toHaveLength(
      1,
    );
  });

  it('a photo over 8 MB is 413 before anything is decoded', async () => {
    const o = await order(asha, 'online');
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(8 * 1024 * 1024 + 10)]);
    const res = await form(
      asha,
      '/v1/support/threads',
      { issueCode: 'damaged', orderCode: o.group, body: 'Big' },
      [big],
    );
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PHOTO_TOO_LARGE');
  });

  it('adds photos to a message on the own request; foreign and closed requests are refused before image work', async () => {
    const o = await order(asha, 'online');
    const { body } = await form(asha, '/v1/support/threads', {
      issueCode: 'wrong_part',
      orderCode: o.group,
      body: 'Wrong one.',
    });
    const before = storage.objects.size;
    const ok = await form(
      asha,
      `/v1/support/tickets/${body.code}/photo-messages`,
      { body: 'Here is the label.' },
      [await jpeg(800, 600), await jpeg(800, 600)],
    );
    expect(ok.status).toBe(200);
    expect(storage.objects.size).toBe(before + 4);
    const thread = await json(asha, 'GET', `/v1/support/tickets/${body.code}`);
    expect(thread.body.messages.at(-1)?.attachments).toHaveLength(2);
    const foreign = await form(
      ravi,
      `/v1/support/tickets/${body.code}/photo-messages`,
      { body: 'Not mine' },
      [await jpeg(200, 200)],
    );
    expect(foreign.status).toBe(404);
    expect(
      (await form(asha, `/v1/support/tickets/${body.code}/photo-messages`, { body: 'No photo' })).status,
    ).toBe(422);
    expect(storage.objects.size).toBe(before + 4);
  });

  it('a Storage outage is 503, leaves no object and no ticket', async () => {
    const o = await order(asha, 'online');
    const before = storage.objects.size;
    const ticketsBefore = (await ctx.db.select().from(s.supportTickets)).length;
    storage.failPut = true;
    const res = await form(
      asha,
      '/v1/support/threads',
      { issueCode: 'damaged', orderCode: o.group, body: 'x' },
      [await jpeg(300, 300)],
    );
    storage.failPut = false;
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PHOTOS_UNAVAILABLE');
    expect(storage.objects.size).toBe(before);
    expect(await ctx.db.select().from(s.supportTickets)).toHaveLength(ticketsBefore);
  });

  it('without Storage configured a photo is 503 and a text-only thread still opens', async () => {
    const bare = await buildApp({ keyring, photoStorage: null });
    const identity = {
      firebaseUid: 'thread-bare',
      phone: '+919833333388',
      email: 'bare@example.com',
      emailVerified: true,
    };
    const token = bare.verifier.add('token-thread-bare-000001', identity);
    const user = await ensureUser(bare.db, identity);
    // (the test database is shared by every app built in this file, so the same order helper works)
    const who: Person = { id: user.id, token, headers: bearer(token) };
    const o = await order(who, 'online');
    const fields = { issueCode: 'late', orderCode: o.group, body: 'x' };
    const withPhoto = await form(who, '/v1/support/threads', fields, [await jpeg(100, 100)], bare);
    expect(withPhoto.status).toBe(503);
    expect(withPhoto.body.error.code).toBe('PHOTOS_UNAVAILABLE');
    expect((await form(who, '/v1/support/threads', fields, [], bare)).status).toBe(201);
  });
});

describe('who may do what', () => {
  it('needs sign-in; staff-only routes refuse customers and roles without ticket rights', async () => {
    const o = await order(asha, 'cod');
    expect(
      (await form(null, '/v1/support/threads', { issueCode: 'late', orderCode: o.group, body: 'x' })).status,
    ).toBe(401);
    const { body } = await form(asha, '/v1/support/threads', {
      issueCode: 'late',
      orderCode: o.group,
      body: 'x',
    });
    const refund = { amountPaise: 1000, reasonCode: 'faulty' };
    const key = { 'idempotency-key': 'abcdefghijklmnop0001' };
    expect(
      (await json(asha, 'POST', `/v1/admin/support/tickets/${body.code}/refund`, refund, key)).status,
    ).toBe(403);
    expect(
      (await json(marketing, 'POST', `/v1/admin/support/tickets/${body.code}/refund`, refund, key)).status,
    ).toBe(403);
    expect(
      (await json(null, 'POST', `/v1/admin/support/tickets/${body.code}/refund`, refund, key)).status,
    ).toBe(401);
    // a staff member is not a customer thread owner: the customer routes 404 on a foreign code
    expect(
      (
        await form(agent, `/v1/support/tickets/${body.code}/photo-messages`, { body: 'x' }, [
          await jpeg(100, 100),
        ])
      ).status,
    ).toBe(404);
  });

  it('the thread opener is rate limited per customer', async () => {
    const limited = await buildApp({ keyring, photoStorage: storage });
    const p = ((): Promise<Person> => {
      const identity = {
        firebaseUid: 'thread-rl',
        phone: '+919833333399',
        email: 'thread-rl@example.com',
        emailVerified: true,
      };
      const token = limited.verifier.add('token-thread-rate-limit-0001', identity);
      return ensureUser(limited.db, identity).then((u) => ({ id: u.id, token, headers: bearer(token) }));
    })();
    const who = await p;
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      last = (await form(who, '/v1/support/threads', { issueCode: 'late', body: 'x' }, [], limited)).status;
    }
    expect(last).toBe(429);
  });
});

describe('COD refund destination', () => {
  // A customer of its own: the thread opener is limited to 20 an hour per customer (tested above).
  let asha: Person;
  beforeAll(async () => {
    asha = await person('05');
  });
  const upi = { kind: 'upi', upiId: 'ravi.kumar@okhdfcbank' };
  const bank = {
    kind: 'bank',
    accountName: 'Ravi Kumar',
    accountNumber: '123456789012',
    ifsc: 'HDFC0001234',
  };

  it('validates the formats, stores it masked, and never returns the full value to anyone', async () => {
    const o = await order(asha, 'cod');
    const { body } = await form(asha, '/v1/support/threads', {
      issueCode: 'damaged',
      orderCode: o.group,
      body: 'Refund me',
    });
    const path = `/v1/support/tickets/${body.code}/refund-destination`;
    expect((await json(asha, 'PUT', path, { kind: 'upi', upiId: 'not-a-upi' })).status).toBe(400);
    expect(
      (await json(asha, 'PUT', path, { kind: 'bank', accountName: 'R K', accountNumber: '12', ifsc: 'bad' }))
        .status,
    ).toBe(400);
    expect((await json(asha, 'PUT', path, { ...upi, extra: 1 })).status).toBe(400);
    const saved = await json(asha, 'PUT', path, upi);
    expect(saved.status).toBe(200);
    expect(saved.body.destination).toEqual({ kind: 'upi', masked: 'ra***@okhdfcbank' });
    expect(JSON.stringify(saved.body)).not.toContain('ravi.kumar');
    const mine = await json(asha, 'GET', `/v1/support/tickets/${body.code}`);
    expect(mine.body.refund).toEqual({
      eligible: true,
      destination: { kind: 'upi', masked: 'ra***@okhdfcbank' },
    });
    const staff = await json(agent, 'GET', `/v1/admin/support/tickets/${body.code}`);
    expect(JSON.stringify(staff.body)).not.toContain('ravi.kumar');
    const list = await json(agent, 'GET', '/v1/admin/support/tickets');
    expect(JSON.stringify(list.body)).not.toContain('ravi.kumar');
    const [row] = await ctx.db.select().from(s.supportTickets);
    expect(JSON.stringify(row)).not.toContain('ravi.kumar');
    const replaced = await json(asha, 'PUT', path, bank);
    expect(replaced.body.destination).toEqual({ kind: 'bank', masked: '••••9012 · HDFC0001234' });
    expect(JSON.stringify(replaced.body)).not.toContain('123456789012');
    // the audit log holds the kind, never the value
    const log = await ctx.db.select().from(s.auditLog);
    expect(JSON.stringify(log)).not.toMatch(/ravi\.kumar|123456789012/);
  });

  it('is refused for an order paid online, for a foreign ticket and without a keyring', async () => {
    const paid = await order(asha, 'online');
    const t1 = await form(asha, '/v1/support/threads', {
      issueCode: 'damaged',
      orderCode: paid.group,
      body: 'x',
    });
    const r1 = await json(asha, 'PUT', `/v1/support/tickets/${t1.body.code}/refund-destination`, upi);
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe('DESTINATION_NOT_COD');
    const cod = await order(asha, 'cod');
    const t2 = await form(asha, '/v1/support/threads', {
      issueCode: 'damaged',
      orderCode: cod.group,
      body: 'x',
    });
    expect(
      (await json(ravi, 'PUT', `/v1/support/tickets/${t2.body.code}/refund-destination`, upi)).status,
    ).toBe(404);
    expect(
      (await json(null, 'PUT', `/v1/support/tickets/${t2.body.code}/refund-destination`, upi)).status,
    ).toBe(401);
  });

  it('staff create the manual refund from the ticket; it replays by key and then locks the destination', async () => {
    const o = await order(asha, 'cod');
    const { body } = await form(asha, '/v1/support/threads', {
      issueCode: 'damaged',
      orderCode: o.group,
      body: 'Broken',
    });
    const refundPath = `/v1/admin/support/tickets/${body.code}/refund`;
    const key = { 'idempotency-key': `from-ticket-${body.code}` };
    const need = await json(agent, 'POST', refundPath, { amountPaise: 2000, reasonCode: 'faulty' }, key);
    expect(need.status).toBe(422);
    expect(need.body.error.code).toBe('REFUND_NEEDS_DESTINATION');
    await json(asha, 'PUT', `/v1/support/tickets/${body.code}/refund-destination`, upi);
    expect(
      (await json(agent, 'POST', refundPath, { amountPaise: 2000, reasonCode: 'faulty', extra: 1 }, key))
        .status,
    ).toBe(400);
    const made = await json(agent, 'POST', refundPath, { amountPaise: 2000, reasonCode: 'faulty' }, key);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      mode: 'bank_upi',
      status: 'requested',
      destinationMasked: 'ra***@okhdfcbank',
      orderCode: o.sub,
    });
    expect(JSON.stringify(made.body)).not.toContain('ravi.kumar');
    const again = await json(agent, 'POST', refundPath, { amountPaise: 2000, reasonCode: 'faulty' }, key);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(made.body.id);
    const locked = await json(asha, 'PUT', `/v1/support/tickets/${body.code}/refund-destination`, bank);
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('DESTINATION_LOCKED');
    expect(
      (
        await json(
          agent,
          'POST',
          refundPath,
          { amountPaise: 2000, reasonCode: 'faulty' },
          { 'idempotency-key': 'short' },
        )
      ).status,
    ).toBe(400);
  });
});
