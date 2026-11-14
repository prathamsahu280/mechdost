/**
 * Workshops and service requests over HTTP (spec 06): staff add a workshop and give its owner access; the public
 * finds it nearby; a verified customer books (idempotent), the workshop runs the job card through bill and payment,
 * staff route and reject. Permission refusals: unverified customers, non-staff on admin routes, people without a
 * workshop grant on the portal, other customers and other workshops (404), strict bodies (400).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { istDateString } from '@mechdost/shared/time';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
const city: Record<string, string> = {};
const TODAY = istDateString(new Date());

interface Person {
  id: string;
  headers: Record<string, string>;
}

async function person(
  n: string,
  opts: { role?: string; cityId?: string; verified?: boolean } = {},
): Promise<Person> {
  const phone = `+9198222222${n}`;
  const identity = {
    firebaseUid: `svc-api-${n}`,
    phone,
    email: `svc-api-${n}@example.com`,
    emailVerified: opts.verified ?? true,
  };
  const token = ctx.verifier.add(`token-svc-api-000000${n}`, identity);
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

const call = async (
  p: Person | null,
  method: string,
  path: string,
  payload?: unknown,
  extra: Record<string, string> = {},
) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: { ...(p?.headers ?? {}), ...extra },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const WORKSHOP = {
  slug: 'shankar-nagar-auto-hub',
  name: 'Shankar Nagar Auto Hub',
  nameHi: 'शंकर नगर ऑटो हब',
  addressLine: 'GE Road, Shankar Nagar',
  addressLineHi: 'जीई रोड, शंकर नगर',
  area: 'Shankar Nagar',
  areaHi: 'शंकर नगर',
  pincode: '492001',
  lat: 21.2514,
  lng: 81.6296,
  phone: '+919811199999',
  vehicleTypes: ['2W', '4W'],
  evBasic: true,
  pickup: true,
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
let customer: Person;
let other: Person;
let workshopId = '';

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
  await ctx.db.insert(s.pincodes).values([
    { pincode: '492001', stateId: state!.id, cityId: city.RPR!, centroid: { lng: 81.6296, lat: 21.2514 } },
    { pincode: '490001', stateId: state!.id, cityId: city.BHI!, centroid: { lng: 81.38, lat: 21.21 } },
  ]);
  ops = await person('01', { role: 'ops_manager' });
  owner = await person('02');
  customer = await person('03');
  other = await person('04');
});

describe('workshops API', () => {
  it('staff add a workshop (others are refused), give its owner access, and the public finds it', async () => {
    const support = await person('05', { role: 'support_agent' });
    expect((await call(support, 'POST', '/admin/workshops', WORKSHOP)).status).toBe(403);
    expect((await call(customer, 'GET', '/admin/workshops')).status).toBe(403);
    const bhilaiManager = await person('06', { role: 'city_manager', cityId: city.BHI });
    expect((await call(bhilaiManager, 'POST', '/admin/workshops', WORKSHOP)).status).toBe(404);
    expect((await call(ops, 'POST', '/admin/workshops', { ...WORKSHOP, owner: 'x' })).status).toBe(400);

    const created = await call(ops, 'POST', '/admin/workshops', WORKSHOP);
    expect(created.status).toBe(201);
    workshopId = String(created.body.id);
    expect((await call(ops, 'POST', '/admin/workshops', WORKSHOP)).body.error.code).toBe('SLUG_TAKEN');
    const listed = await call(ops, 'GET', '/admin/workshops');
    expect(listed.body.workshops).toEqual([
      expect.objectContaining({ slug: WORKSHOP.slug, missingHindi: [] }),
    ]);
    expect((await call(bhilaiManager, 'GET', `/admin/workshops/${workshopId}`)).status).toBe(404);

    const member = await call(ops, 'POST', `/admin/workshops/${workshopId}/members`, {
      phone: '+919822222202',
      role: 'workshop_owner',
    });
    expect(member.status).toBe(200);

    const near = await call(null, 'GET', '/workshops?pincode=492001&vehicleType=2W&locale=hi');
    expect(near.status).toBe(200);
    expect(near.body.workshops).toEqual([
      expect.objectContaining({ slug: WORKSHOP.slug, name: 'शंकर नगर ऑटो हब', distanceKm: 0 }),
    ]);
    expect(
      (await call(null, 'GET', '/workshops?lat=21.2514&lng=81.6296&vehicleType=3W')).body.workshops,
    ).toEqual([]);
    expect((await call(null, 'GET', '/workshops')).status).toBe(400);
    expect((await call(null, 'GET', `/workshops/${WORKSHOP.slug}`)).body.services).toHaveLength(1);
    expect((await call(null, 'GET', '/workshops/no-such-workshop')).status).toBe(404);
  });
});

describe('service requests API', () => {
  const booking = {
    workshopSlug: WORKSHOP.slug,
    vehicleType: '2W',
    vehicle: 'Honda Activa 6G',
    serviceKeys: ['routine2w'],
    pincode: '492001',
    preferredDate: TODAY,
    preferredSlot: 'morning',
  };
  const key = { 'idempotency-key': 'svc-api-booking-0000001' };

  it('books (verified only, idempotent) and runs the whole job card to paid', async () => {
    const unverified = await person('07', { verified: false });
    const refused = await call(unverified, 'POST', '/service-requests', booking, key);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('VERIFICATION_REQUIRED');
    expect((await call(customer, 'POST', '/service-requests', booking)).status).toBe(400); // no key
    expect((await call(customer, 'POST', '/service-requests', { ...booking, price: 1 }, key)).status).toBe(
      400,
    );

    const made = await call(customer, 'POST', '/service-requests', booking, key);
    expect(made.status).toBe(201);
    const code = String(made.body.code);
    const replay = await call(customer, 'POST', '/service-requests', booking, key);
    expect(replay.status).toBe(200);
    expect(replay.body.code).toBe(code);

    // Scope: other customers and people without a workshop grant.
    expect((await call(other, 'GET', `/service-requests/${code}`)).status).toBe(404);
    expect((await call(customer, 'GET', '/workshop/requests')).status).toBe(403);
    expect((await call(customer, 'GET', '/admin/service-requests')).status).toBe(403);

    const inbox = await call(owner, 'GET', '/workshop/requests?view=new');
    expect(inbox.body.items).toEqual([expect.objectContaining({ code, status: 'awaiting_workshop' })]);
    let version = Number(made.body.version);
    const step = async (
      who: Person,
      path: string,
      payload: Record<string, unknown>,
      expectStatus: string,
    ) => {
      const r = await call(who, 'POST', path, { ...payload, version });
      expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.status).toBe(expectStatus);
      version = Number(r.body.version);
      return r.body;
    };
    await step(
      owner,
      `/workshop/requests/${code}/propose`,
      { date: TODAY, slot: 'evening', lowPaise: 80_000, highPaise: 150_000 },
      'proposed',
    );
    // The customer cannot act on the workshop's side.
    expect(
      (
        await call(customer, 'POST', `/workshop/requests/${code}/vehicle-received`, {
          odometerKm: 1,
          version,
        })
      ).status,
    ).toBe(403);
    await step(customer, `/service-requests/${code}/proposal`, { accept: true }, 'confirmed');
    await step(
      owner,
      `/workshop/requests/${code}/vehicle-received`,
      { odometerKm: 12_345 },
      'vehicle_received',
    );
    const sent = await step(
      owner,
      `/workshop/requests/${code}/estimates`,
      {
        lines: [
          { description: 'Labour', serviceKey: 'routine2w', qty: 1, unitPaise: 80_000, gstRateBp: 1800 },
          { description: 'Air filter', qty: 1, unitPaise: 35_000, gstRateBp: 2800 },
        ],
      },
      'estimate_sent',
    );
    expect(sent.revision).toBe(1);
    const detail = await call(customer, 'GET', `/service-requests/${code}`);
    const items = (detail.body.estimate as { items: { id: string }[] }).items;
    expect(detail.body.workshop).toMatchObject({ phone: '+919811199999' });
    expect(
      (
        await call(customer, 'POST', `/service-requests/${code}/estimate`, {
          revision: 1,
          version,
          consent: false,
          decisions: [],
        })
      ).status,
    ).toBe(400);
    await step(
      customer,
      `/service-requests/${code}/estimate`,
      {
        revision: 1,
        consent: true,
        decisions: [
          { itemId: items[0]!.id, decision: 'approved' },
          { itemId: items[1]!.id, decision: 'declined' },
        ],
      },
      'approved',
    );
    await step(owner, `/workshop/requests/${code}/start`, {}, 'in_progress');
    await step(owner, `/workshop/requests/${code}/ready`, {}, 'ready');
    const billed = await step(owner, `/workshop/requests/${code}/bill`, {}, 'billed');
    expect(billed.totalPaise).toBe(94_400); // ₹800 + 18 % GST
    await step(owner, `/workshop/requests/${code}/mark-paid`, { method: 'cash' }, 'completed');
    const done = await call(customer, 'GET', `/service-requests/${code}`);
    expect(done.body.bill).toMatchObject({
      totalPaise: 94_400,
      method: 'cash',
      cgstPaise: 7_200,
      sgstPaise: 7_200,
    });
    expect(typeof (done.body.bill as { paidAt: unknown }).paidAt).toBe('string');
    const mine = await call(customer, 'GET', '/service-requests');
    expect(mine.body.items).toEqual([expect.objectContaining({ code, status: 'completed' })]);
    const closed = await call(ops, 'GET', '/admin/service-requests?view=closed');
    expect(closed.body.items).toEqual([expect.objectContaining({ code })]);
    // A stale version is a conflict, not a 500.
    expect((await call(owner, 'POST', `/workshop/requests/${code}/start`, { version: 1 })).status).toBe(409);
  });

  it('"Let MechDost choose" goes to staff, who reassign or reject it', async () => {
    const choose = { ...booking, workshopSlug: null, serviceKeys: [], concern: 'Brakes squeal when wet' };
    const a = await call(customer, 'POST', '/service-requests', choose, {
      'idempotency-key': 'svc-api-booking-0000002',
    });
    expect(a.body.status).toBe('needs_routing');
    const queue = await call(ops, 'GET', '/admin/service-requests?view=needs_routing');
    expect(queue.body.items).toEqual([expect.objectContaining({ code: a.body.code })]);
    const moved = await call(ops, 'POST', `/admin/service-requests/${String(a.body.code)}/reassign`, {
      workshopId,
      version: a.body.version,
    });
    expect(moved.body.status).toBe('awaiting_workshop');
    const declined = await call(owner, 'POST', `/workshop/requests/${String(a.body.code)}/decline`, {
      reasonCode: 'fully_booked',
      version: moved.body.version,
    });
    expect(declined.body.status).toBe('needs_routing');
    const rejected = await call(ops, 'POST', `/admin/service-requests/${String(a.body.code)}/reject`, {
      reasonCode: 'all_workshops_declined',
      message: 'Sorry, every workshop nearby is fully booked this week.',
      version: declined.body.version,
    });
    expect(rejected.body.status).toBe('rejected');
    const cancelLater = await call(customer, 'POST', `/service-requests/${String(a.body.code)}/cancel`, {
      reasonCode: 'changed_mind',
      version: rejected.body.version,
    });
    expect(cancelLater.status).toBe(409);
  });
});
