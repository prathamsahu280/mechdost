/**
 * Home servicing over HTTP (spec 06, design 2026-11-15): the owner switches it on in the workshop portal (permission
 * `service_menu:write`, scoped to their workshop), the public listing in home mode uses each workshop's own radius, a
 * customer books at a pinned saved address with the fee they saw, the arrival code reaches only the customer, wrong
 * codes are returned (not thrown) and counted, the admin override needs `service:route`, and the move offer is answered
 * by the customer only.
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { istDateString } from '@mechdost/shared/time';
import { bearer, buildApp, type ErrorJson } from './helpers';

const k = () => randomBytes(32).toString('base64');
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${k()}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: k(),
});

let ctx: Awaited<ReturnType<typeof buildApp>>;
const TODAY = istDateString(new Date());

interface Person {
  id: string;
  headers: Record<string, string>;
}

async function person(n: string, opts: { role?: string; workshopId?: string } = {}): Promise<Person> {
  const identity = {
    firebaseUid: `home-api-${n}`,
    phone: `+9198333333${n}`,
    email: `home-api-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-home-api-000000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  if (opts.role)
    await grantRole(ctx.db, {
      userId: user.id,
      role: opts.role,
      workshopId: opts.workshopId ?? null,
      grantedBy: null,
    });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

/** A value inside a JSON answer by dotted path (numbers index arrays); undefined when absent. */
const at = (o: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (a, k) => (a !== null && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined),
      o,
    );

const call = async (p: Person | null, method: string, path: string, payload?: unknown, extra = {}) => {
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
  slug: 'home-visit-garage',
  name: 'Home Visit Garage',
  nameHi: 'होम विज़िट गैराज',
  addressLine: 'GE Road, Shankar Nagar',
  addressLineHi: 'जीई रोड, शंकर नगर',
  area: 'Shankar Nagar',
  areaHi: 'शंकर नगर',
  pincode: '492001',
  lat: 21.2514,
  lng: 81.6296,
  phone: '+919811199999',
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

let ops: Person;
let owner: Person;
let stranger: Person;
let customer: Person;
let other: Person;
let support: Person;
let workshopId = '';
let addressId = '';
let version = 1;

beforeAll(async () => {
  ctx = await buildApp({ keyring });
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [city] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  await ctx.db
    .insert(s.pincodes)
    .values([
      { pincode: '492001', stateId: state!.id, cityId: city!.id, centroid: { lng: 81.6296, lat: 21.2514 } },
    ]);
  ops = await person('01', { role: 'ops_manager' });
  support = await person('02', { role: 'support_agent' });
  customer = await person('03');
  other = await person('04');
  const created = await call(ops, 'POST', '/admin/workshops', WORKSHOP);
  workshopId = String(created.body.id);
  owner = await person('05');
  expect(
    (
      await call(ops, 'POST', `/admin/workshops/${workshopId}/members`, {
        phone: '+919833333305',
        role: 'workshop_owner',
      })
    ).status,
  ).toBe(200);
  const other2 = await call(ops, 'POST', '/admin/workshops', {
    ...WORKSHOP,
    slug: 'second-garage',
    name: 'Second Garage',
    nameHi: 'दूसरा गैराज',
    gstin: null,
  });
  stranger = await person('06');
  await call(ops, 'POST', `/admin/workshops/${String(other2.body.id)}/members`, {
    phone: '+919833333306',
    role: 'workshop_owner',
  });
  const [a] = await ctx.db
    .insert(s.addresses)
    .values({
      userId: customer.id,
      contactName: 'Ravi',
      contactPhone: '+919833333303',
      line1: '12 Lal Bagh',
      pincode: '492001',
      cityId: city!.id,
      stateId: state!.id,
      location: { lat: 21.2514, lng: 81.6296 },
    })
    .returning({ id: s.addresses.id });
  addressId = a!.id;
});

describe('workshop home settings (portal)', () => {
  it('only the owner of that workshop edits them; a stranger and a customer are refused', async () => {
    expect((await call(customer, 'GET', '/workshop/home-settings')).status).toBe(403);
    const mine = await call(owner, 'GET', '/workshop/home-settings');
    expect(mine.status).toBe(200);
    expect(mine.body.workshops).toHaveLength(1);
    const w = at(mine.body, 'workshops.0') as Record<string, unknown>;
    expect(w).toMatchObject({
      homeService: false,
      homeRadiusKm: 5,
      homeVisitFeePaise: 9900,
      maxFeePaise: 50000,
    });
    version = Number(w.version);
    const body = {
      homeService: true,
      homeRadiusKm: 5,
      homeVisitFeePaise: 9900,
      homeServiceKeys: ['routine2w'],
      version,
    };
    expect((await call(stranger, 'PUT', `/workshop/home-settings/${workshopId}`, body)).status).toBe(404);
    expect(
      (await call(owner, 'PUT', `/workshop/home-settings/${workshopId}`, { ...body, homeRadiusKm: 40 }))
        .status,
    ).toBe(400);
    expect(
      (await call(owner, 'PUT', `/workshop/home-settings/${workshopId}`, { ...body, extra: 1 })).status,
    ).toBe(400);
    const saved = await call(owner, 'PUT', `/workshop/home-settings/${workshopId}`, body);
    expect(saved.status).toBe(200);
    expect((await call(owner, 'PUT', `/workshop/home-settings/${workshopId}`, body)).body.error.code).toBe(
      'STALE_WORKSHOP',
    );
  });

  it('the public home listing needs a pin and uses the workshop radius', async () => {
    const q = '/workshops?mode=home&lat=21.2514&lng=81.6296&vehicleType=2W';
    const home = await call(null, 'GET', q);
    expect(home.status).toBe(200);
    expect(home.body.workshops).toEqual([
      expect.objectContaining({ slug: WORKSHOP.slug, home: { radiusKm: 5, visitFeePaise: 9900 } }),
    ]);
    expect((await call(null, 'GET', '/workshops?mode=home&pincode=492001')).body.error.code).toBe(
      'HOME_NEEDS_PIN',
    );
    expect((await call(null, 'GET', '/workshops?mode=home&lat=21.4&lng=81.6296')).body.workshops).toEqual([]);
  });
});

describe('home booking and the arrival code', () => {
  const booking = () => ({
    workshopSlug: WORKSHOP.slug,
    vehicleType: '2W',
    vehicle: 'Honda Activa 6G',
    serviceKeys: ['routine2w'],
    pincode: '492001',
    preferredDate: TODAY,
    preferredSlot: 'morning',
    mode: 'home',
    addressId,
    visitFeePaise: 9900,
  });
  const key = { 'idempotency-key': 'home-api-booking-0000001' };
  let code = '';
  let jobVersion = 0;

  it('refuses a stale fee, another customer address and a booking that mixes home with pickup', async () => {
    const stale = await call(
      customer,
      'POST',
      '/service-requests',
      { ...booking(), visitFeePaise: 100 },
      key,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('FEE_CHANGED');
    expect(
      (
        await call(other, 'POST', '/service-requests', booking(), {
          'idempotency-key': 'home-api-booking-0000002',
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(customer, 'POST', '/service-requests', { ...booking(), pickup: true }, key)).status,
    ).toBe(400);
  });

  it('books, the workshop names the mechanic, the customer confirms and alone reads the code', async () => {
    const made = await call(customer, 'POST', '/service-requests', booking(), key);
    expect(made.status).toBe(201);
    code = String(made.body.code);
    const noName = await call(owner, 'POST', `/workshop/requests/${code}/propose`, {
      date: TODAY,
      slot: 'morning',
      lowPaise: 80_000,
      highPaise: 150_000,
      version: Number(at(made.body, 'version')),
    });
    expect(noName.body.error.code).toBe('MECHANIC_REQUIRED');
    const proposed = await call(owner, 'POST', `/workshop/requests/${code}/propose`, {
      date: TODAY,
      slot: 'morning',
      lowPaise: 80_000,
      highPaise: 150_000,
      mechanicName: 'Sunil',
      version: Number(at(made.body, 'version')),
    });
    expect(proposed.status).toBe(200);
    const confirmed = await call(customer, 'POST', `/service-requests/${code}/proposal`, {
      accept: true,
      version: Number(at(proposed.body, 'version')),
    });
    expect(confirmed.status).toBe(200);
    jobVersion = Number(at(confirmed.body, 'version'));
    const mine = await call(customer, 'GET', `/service-requests/${code}`);
    expect(mine.body.home).toMatchObject({ visitFeePaise: 9900, mechanicName: 'Sunil' });
    expect(at(mine.body, 'home.arrivalCode')).toMatch(/^\d{4}$/);
    expect(at(mine.body, 'workshop.ratingCount')).toBe(0);
    const theirs = await call(owner, 'GET', `/workshop/requests/${code}`);
    expect(at(theirs.body, 'home.arrivalCode')).toBeNull();
    expect(JSON.stringify(theirs.body)).not.toContain(String(at(mine.body, 'home.arrivalCode')));
    const admin = await call(ops, 'GET', `/admin/service-requests/${code}`);
    expect(at(admin.body, 'home.arrivalCode')).toBeNull();
  });

  it('a wrong code is a 200 with attempts left; the right one marks arrival; a stranger gets 404', async () => {
    const mine = await call(customer, 'GET', `/service-requests/${code}`);
    const right = String(at(mine.body, 'home.arrivalCode'));
    const wrong = right === '0000' ? '1111' : '0000';
    const path = `/workshop/requests/${code}/vehicle-received`;
    expect(
      (await call(stranger, 'POST', path, { odometerKm: 1000, arrivalCode: right, version: jobVersion }))
        .status,
    ).toBe(404);
    expect((await call(owner, 'POST', path, { odometerKm: 1000, version: jobVersion })).body.error.code).toBe(
      'ARRIVAL_CODE_FORMAT',
    );
    const bad = await call(owner, 'POST', path, {
      odometerKm: 1000,
      arrivalCode: wrong,
      version: jobVersion,
    });
    expect(bad.status).toBe(200);
    expect(bad.body).toEqual({ ok: false, reason: 'wrong', attemptsLeft: 4 });
    const good = await call(owner, 'POST', path, {
      odometerKm: 1000,
      arrivalCode: right,
      version: jobVersion,
    });
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ ok: true, status: 'vehicle_received' });
    jobVersion = Number(at(good.body, 'version'));
  });

  it('the move offer: only the workshop offers, only the customer answers, accepting makes it a workshop job', async () => {
    const offer = await call(owner, 'POST', `/workshop/requests/${code}/move`, {
      reasonCode: 'needs_lift',
      transport: 'customer_drops',
      version: jobVersion,
    });
    expect(offer.status).toBe(200);
    const body = { accept: true, version: jobVersion };
    expect((await call(owner, 'POST', `/service-requests/${code}/move`, body)).status).toBe(404); // not their request
    expect((await call(other, 'POST', `/service-requests/${code}/move`, body)).status).toBe(404);
    const accepted = await call(customer, 'POST', `/service-requests/${code}/move`, body);
    expect(accepted.status).toBe(200);
    const mine = await call(customer, 'GET', `/service-requests/${code}`);
    expect(mine.body.serviceMode).toBe('workshop');
    expect(at(mine.body, 'home.move.status')).toBe('accepted');
  });

  it('the waive step and the arrival override are permissioned', async () => {
    expect(
      (
        await call(customer, 'POST', `/workshop/requests/${code}/waive-visit-fee`, {
          reasonCode: 'goodwill',
          version: 1,
        })
      ).status,
    ).toBe(403);
    const waived = await call(owner, 'POST', `/workshop/requests/${code}/waive-visit-fee`, {
      reasonCode: 'goodwill',
      version: Number(at((await call(owner, 'GET', `/workshop/requests/${code}`)).body, 'version')),
    });
    expect(waived.status).toBe(200);
    expect(
      (
        await call(support, 'POST', `/admin/service-requests/${code}/arrival-override`, {
          reason: 'Customer unreachable',
          odometerKm: 1,
          version: 1,
        })
      ).status,
    ).toBe(403);
  });
});
