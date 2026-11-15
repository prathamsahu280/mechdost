/**
 * Workshops tier 1 over HTTP (spec 06, 07; design 2026-11-15): "My workshop" self-edit and its role-leak edges, hourly
 * slots with capacity (full hour = 409), the customer reschedule, and the staff decision on pin and GSTIN requests.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { istDateString } from '@mechdost/shared/time';
import { CHANGE_RATE } from '../src/routes/workshop-portal';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
const city: Record<string, string> = {};

interface Person {
  id: string;
  headers: Record<string, string>;
}

async function person(n: string, opts: { role?: string; cityId?: string } = {}): Promise<Person> {
  const identity = {
    firebaseUid: `t1-api-${n}`,
    phone: `+9198333333${n}`,
    email: `t1-api-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-t1-api-000000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  if (opts.role)
    await grantRole(ctx.db, {
      userId: user.id,
      role: opts.role,
      cityId: opts.cityId ?? null,
      grantedBy: null,
    });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const call = async (p: Person | null, method: string, path: string, payload?: unknown) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: { ...(p?.headers ?? {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const openDate = (offset: number) => {
  for (let i = offset; i < offset + 8; i += 1) {
    const d = istDateString(new Date(Date.now() + i * 86_400_000));
    if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) return d;
  }
  throw new Error('no open date');
};

const workshop = (slug: string, lat: number) => ({
  slug,
  name: `Workshop ${slug}`,
  nameHi: `वर्कशॉप ${slug}`,
  addressLine: 'GE Road, Raipur',
  addressLineHi: 'जीई रोड, रायपुर',
  area: 'Shankar Nagar',
  areaHi: 'शंकर नगर',
  pincode: '492001',
  lat,
  lng: 81.6296,
  phone: '+919811199999',
  vehicleTypes: ['2W'],
  hours: { open: '09:00', close: '19:00', days: [1, 2, 3, 4, 5, 6] },
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
});

let ops: Person;
let ownerA: Person;
let ownerB: Person;
let customer: Person;
let other: Person;
let idA = '';
let idB = '';
let keyN = 0;

async function book(slug: string) {
  keyN += 1;
  const res = await ctx.app.request('/v1/service-requests', {
    method: 'POST',
    headers: { ...customer.headers, 'idempotency-key': `t1-api-booking-${String(keyN).padStart(8, '0')}` },
    body: JSON.stringify({
      workshopSlug: slug,
      vehicleType: '2W',
      vehicle: 'Honda Activa 6G',
      serviceKeys: ['routine2w'],
      pincode: '492001',
      preferredDate: openDate(1),
      preferredSlot: 'morning',
    }),
  });
  const b = (await res.json()) as { code: string; version: number };
  expect(res.status).toBe(201);
  return b;
}

beforeAll(async () => {
  ctx = await buildApp();
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  for (const [code, slug] of [
    ['RPR', 'raipur'],
    ['BHI', 'bhilai'],
  ] as const) {
    const [row] = await ctx.db
      .insert(s.cities)
      .values({ stateId: state!.id, code, slug, name: slug, status: 'live' })
      .returning();
    city[code] = row!.id;
  }
  await ctx.db.insert(s.settings).values({ cityId: null, key: 'service.photos_required', value: false });
  await ctx.db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: city.RPR!,
    centroid: { lng: 81.6296, lat: 21.2514 },
  });
  ops = await person('01', { role: 'ops_manager' });
  ownerA = await person('02');
  ownerB = await person('03');
  customer = await person('04');
  other = await person('05');
  idA = String((await call(ops, 'POST', '/admin/workshops', workshop('t1-alpha', 21.2514))).body.id);
  idB = String((await call(ops, 'POST', '/admin/workshops', workshop('t1-beta', 21.2521))).body.id);
  for (const [id, phone] of [
    [idA, '+919833333302'],
    [idB, '+919833333303'],
  ] as const)
    expect(
      (await call(ops, 'POST', `/admin/workshops/${id}/members`, { phone, role: 'workshop_owner' })).status,
    ).toBe(200);
});

describe('My workshop (API)', () => {
  it('shows an owner only their own workshop and refuses customers and other roles', async () => {
    expect((await call(customer, 'GET', '/workshop/profile')).status).toBe(403);
    expect((await call(null, 'GET', '/workshop/profile')).status).toBe(401);
    const support = await person('06', { role: 'support_agent' });
    expect((await call(support, 'GET', '/workshop/profile')).status).toBe(403);
    const mine = await call(ownerA, 'GET', '/workshop/profile');
    expect(mine.status).toBe(200);
    expect((mine.body.workshops as { workshopId: string }[]).map((w) => w.workshopId)).toEqual([idA]);
  });

  it('saves text, hours, menu ranges, busy mode and capacity at once; strict body; stale version; foreign id', async () => {
    const mine = (await call(ownerA, 'GET', '/workshop/profile')).body.workshops as {
      version: number;
      slotCapacity: number;
    }[];
    expect(mine[0]?.slotCapacity).toBe(2);
    const saved = await call(ownerA, 'PUT', `/workshop/profile/${idA}`, {
      version: mine[0]!.version,
      name: 'Alpha Motors',
      nameHi: 'अल्फा मोटर्स',
      busy: true,
      slotCapacity: 1,
      hours: { open: '08:00', close: '20:00', days: [1, 2, 3, 4, 5, 6] },
      menu: [
        {
          key: 'routine2w',
          title: 'General service (2W)',
          titleHi: 'जनरल सर्विस (2W)',
          lowPaise: 90_000,
          highPaise: 170_000,
          minMinutes: 120,
          maxMinutes: 180,
          vehicleType: '2W',
        },
      ],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const after = (await call(ownerA, 'GET', '/workshop/profile')).body.workshops as {
      name: string;
      busy: boolean;
      slotCapacity: number;
      menu: { highPaise: number }[];
    }[];
    expect(after[0]).toMatchObject({ name: 'Alpha Motors', busy: true, slotCapacity: 1 });
    expect(after[0]?.menu[0]?.highPaise).toBe(170_000);
    const v = Number(saved.body.version);
    // Mass assignment: the pin, PIN code, GSTIN and publishing are not editable here.
    for (const extra of [
      { lat: 1, lng: 1 },
      { gstin: '22AAAAA0000A1Z5' },
      { published: false },
      { pincode: '492001' },
    ])
      expect((await call(ownerA, 'PUT', `/workshop/profile/${idA}`, { version: v, ...extra })).status).toBe(
        400,
      );
    expect(
      (await call(ownerA, 'PUT', `/workshop/profile/${idA}`, { version: v + 7, busy: false })).body.error
        .code,
    ).toBe('STALE_WORKSHOP');
    // Another owner's workshop is 404 for both reads and writes.
    expect((await call(ownerA, 'PUT', `/workshop/profile/${idB}`, { version: 1, busy: true })).status).toBe(
      404,
    );
    expect((await call(customer, 'PUT', `/workshop/profile/${idA}`, { version: 1, busy: true })).status).toBe(
      403,
    );
    await call(ownerA, 'PUT', `/workshop/profile/${idA}`, { version: v, busy: false, slotCapacity: 2 });
  });
});

describe('hourly slots (API)', () => {
  it('a proposal takes the hour; a full hour is 409; capacity edits are the owner only', async () => {
    const date = openDate(2);
    const slots = async (who: Person, id: string) =>
      call(who, 'GET', `/workshop/slots?workshopId=${id}&date=${date}`);
    expect((await slots(customer, idB)).status).toBe(403);
    expect((await slots(ownerB, idA)).status).toBe(404);
    const day = await slots(ownerB, idB);
    expect((day.body.slots as { hour: number }[]).map((x) => x.hour)).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    const cap = await call(ownerB, 'PUT', `/workshop/slots/${idB}`, { date, hour: 10, capacity: 1 });
    expect(cap.status, JSON.stringify(cap.body)).toBe(200);
    expect(
      (await call(ownerA, 'PUT', `/workshop/slots/${idB}`, { date, hour: 10, capacity: 5 })).status,
    ).toBe(404);
    expect(
      (await call(customer, 'PUT', `/workshop/slots/${idB}`, { date, hour: 10, capacity: 5 })).status,
    ).toBe(403);
    expect(
      (await call(ownerB, 'PUT', `/workshop/slots/${idB}`, { date, hour: 10, capacity: 99 })).status,
    ).toBe(400);

    const a = await book('t1-beta');
    const b = await book('t1-beta');
    const body = (v: number, hour: number) => ({
      date,
      hour,
      lowPaise: 80_000,
      highPaise: 150_000,
      version: v,
    });
    const first = await call(ownerB, 'POST', `/workshop/requests/${a.code}/propose`, body(a.version, 10));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await call(ownerB, 'POST', `/workshop/requests/${b.code}/propose`, body(b.version, 10));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SLOT_FULL');
    expect(
      (await call(ownerB, 'POST', `/workshop/requests/${b.code}/propose`, body(b.version, 22))).body.error
        .code,
    ).toBe('SLOT_CLOSED');
    expect(
      (
        await call(ownerB, 'POST', `/workshop/requests/${b.code}/propose`, {
          ...body(b.version, 11),
          hour: undefined,
        })
      ).status,
    ).toBe(400);
    const full = (await slots(ownerB, idB)).body.slots as { hour: number; free: number }[];
    expect(full.find((x) => x.hour === 10)?.free).toBe(0);
    expect((await call(customer, 'GET', `/service-requests/${a.code}`)).body.proposal).toMatchObject({
      hour: 10,
    });
  });
});

describe('customer reschedule (API)', () => {
  it('moves a confirmed booking; others and stale versions are refused; the history keeps both times', async () => {
    const r = await book('t1-alpha');
    const date = openDate(3);
    const proposed = await call(ownerA, 'POST', `/workshop/requests/${r.code}/propose`, {
      date,
      hour: 14,
      lowPaise: 80_000,
      highPaise: 150_000,
      version: r.version,
    });
    const confirmed = await call(customer, 'POST', `/service-requests/${r.code}/proposal`, {
      accept: true,
      version: proposed.body.version,
    });
    expect(confirmed.body.status).toBe('confirmed');
    const move = { date: openDate(5), slot: 'evening', version: confirmed.body.version };
    expect((await call(other, 'POST', `/service-requests/${r.code}/reschedule`, move)).status).toBe(404);
    // A workshop owner is not the customer of this booking: 404, never a way to move it.
    expect((await call(ownerA, 'POST', `/service-requests/${r.code}/reschedule`, move)).status).toBe(404);
    expect(
      (await call(customer, 'POST', `/service-requests/${r.code}/reschedule`, { ...move, version: 99 }))
        .status,
    ).toBe(409);
    expect(
      (await call(customer, 'POST', `/service-requests/${r.code}/reschedule`, { ...move, extra: 1 })).status,
    ).toBe(400);
    const done = await call(customer, 'POST', `/service-requests/${r.code}/reschedule`, move);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe('awaiting_workshop');
    const detail = await call(customer, 'GET', `/service-requests/${r.code}`);
    expect(detail.body.reschedule).toMatchObject({ count: 1, max: 2, from: { date, slot: 'afternoon' } });
    // The workshop sees it in its inbox again and can answer the new time.
    const inbox = await call(ownerA, 'GET', '/workshop/requests?view=new');
    expect((inbox.body.items as { code: string }[]).map((i) => i.code)).toContain(r.code);
    // The hour it held is free again.
    const day = await call(ownerA, 'GET', `/workshop/slots?workshopId=${idA}&date=${date}`);
    expect((day.body.slots as { hour: number; booked: number }[]).find((x) => x.hour === 14)?.booked).toBe(0);
  });
});

describe('pin and GSTIN requests (API)', () => {
  it('are filed by the owner, rate limited, and decided by staff with approval rights in the city', async () => {
    const pin = { kind: 'location', lat: 21.27, lng: 81.66 };
    const filed = await call(ownerA, 'POST', `/workshop/profile/${idA}/changes`, pin);
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    expect((await call(ownerA, 'POST', `/workshop/profile/${idA}/changes`, pin)).body.error.code).toBe(
      'CHANGE_PENDING',
    );
    expect((await call(ownerA, 'POST', `/workshop/profile/${idB}/changes`, pin)).status).toBe(404);
    expect(
      (await call(ownerA, 'POST', `/workshop/profile/${idA}/changes`, { kind: 'gstin', gstin: 'bad' }))
        .status,
    ).toBe(400);
    const stillLive = (await call(ops, 'GET', `/admin/workshops/${idA}`)).body as { lat: number };
    expect(stillLive.lat).toBe(21.2514);

    const support = await person('07', { role: 'support_agent' });
    // Support may read the list (like the workshop list) but cannot decide: that needs partners:approve.
    expect((await call(support, 'GET', '/admin/workshop-changes')).status).toBe(200);
    expect((await call(ownerA, 'GET', '/admin/workshop-changes')).status).toBe(403);
    const waiting = (await call(ops, 'GET', '/admin/workshop-changes')).body.changes as {
      id: string;
      version: number;
    }[];
    expect(waiting).toHaveLength(1);
    expect(
      (
        await call(support, 'POST', `/admin/workshop-changes/${waiting[0]!.id}/decide`, {
          approve: true,
          version: 1,
        })
      ).status,
    ).toBe(403);
    const bhilai = await person('08', { role: 'city_manager', cityId: city.BHI });
    expect(
      (
        await call(bhilai, 'POST', `/admin/workshop-changes/${waiting[0]!.id}/decide`, {
          approve: true,
          version: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(ops, 'POST', `/admin/workshop-changes/${waiting[0]!.id}/decide`, {
          approve: false,
          version: 1,
        })
      ).status,
    ).toBe(422);
    const ok = await call(ops, 'POST', `/admin/workshop-changes/${waiting[0]!.id}/decide`, {
      approve: true,
      version: waiting[0]!.version,
    });
    expect(ok.body.status).toBe('approved');
    const moved = (await call(ops, 'GET', `/admin/workshops/${idA}`)).body as {
      lat: number;
      locationVerified: boolean;
    };
    expect(moved).toMatchObject({ lat: 21.27, locationVerified: true });
  });

  it('are limited per user (a small hourly allowance)', async () => {
    let last = 0;
    for (let i = 0; i < CHANGE_RATE.limit + 2; i += 1)
      last = (await call(ownerB, 'POST', `/workshop/profile/${idB}/changes`, { kind: 'gstin', gstin: null }))
        .status;
    expect(last).toBe(429);
  });
});
