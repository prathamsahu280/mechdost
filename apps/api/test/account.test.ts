/**
 * The customer's saved addresses, vehicles and profile over HTTP (design 2026-11-15): sign-in required, strict
 * bodies (no mass assignment, no city/state from the client), PIN checked against the database, another customer's
 * ids are 404, stale versions 409, limits 422, per-user write rate limit, and every answer matches the shared schemas
 * the website validates with.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { MAX_ACCOUNT_ITEMS } from '@mechdost/shared/account';
import { AddressDto, AddressesDto, DeletedDto, VehicleDto, VehiclesDto } from '@mechdost/shared/account-api';
import { ACCOUNT_WRITE_RATE } from '../src/routes/account';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;

interface Person {
  id: string;
  headers: Record<string, string>;
}

async function person(n: string): Promise<Person> {
  const identity = {
    firebaseUid: `acct-api-${n}`,
    phone: `+9198444444${n}`,
    email: `acct-api-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-acct-api-000000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
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

const newAddress = (over: Record<string, unknown> = {}) => ({
  label: 'home',
  contactName: 'Ravi Verma',
  contactPhone: '+919811100001',
  line1: '12 Shankar Nagar',
  pincode: '492001',
  ...over,
});
const newVehicle = (over: Record<string, unknown> = {}) => ({
  type: '2W',
  fuel: 'petrol',
  make: 'Honda',
  model: 'Activa',
  year: 2020,
  ...over,
});

beforeAll(async () => {
  ctx = await buildApp();
  const [st] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const [city] = await ctx.db
    .insert(s.cities)
    .values({ stateId: st!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  await ctx.db.insert(s.pincodes).values({ pincode: '492001', stateId: st!.id, cityId: city!.id });
});

describe('addresses', () => {
  it('needs a signed-in customer', async () => {
    expect((await call(null, 'GET', '/me/addresses')).status).toBe(401);
    expect((await call(null, 'POST', '/me/addresses', newAddress())).status).toBe(401);
  });

  it('creates, lists, edits, sets a default and deletes — answers match the shared schemas', async () => {
    const me = await person('1');
    const created = await call(me, 'POST', '/me/addresses', newAddress());
    expect(created.status).toBe(201);
    const a = AddressDto.parse(created.body);
    expect(a).toMatchObject({ cityName: 'Raipur', isDefaultShipping: true, serviceable: true });

    const second = AddressDto.parse(
      (await call(me, 'POST', '/me/addresses', newAddress({ label: 'work' }))).body,
    );
    const list = AddressesDto.parse((await call(me, 'GET', '/me/addresses')).body);
    expect(list.addresses.map((x) => x.id)).toEqual([a.id, second.id]);

    const edited = await call(me, 'PATCH', `/me/addresses/${a.id}`, {
      version: 1,
      landmark: 'Near the temple',
    });
    expect(edited.status).toBe(200);
    expect(AddressDto.parse(edited.body)).toMatchObject({ landmark: 'Near the temple', version: 2 });
    expect((await call(me, 'PATCH', `/me/addresses/${a.id}`, { version: 1, landmark: 'x' })).status).toBe(
      409,
    );

    const dflt = await call(me, 'POST', `/me/addresses/${second.id}/default`, { version: second.version });
    expect(AddressDto.parse(dflt.body).isDefaultShipping).toBe(true);

    const gone = await call(me, 'DELETE', `/me/addresses/${a.id}?version=3`);
    expect(gone.status).toBe(200);
    expect(DeletedDto.parse(gone.body)).toEqual({ deleted: true });
    expect(AddressesDto.parse((await call(me, 'GET', '/me/addresses')).body).addresses).toHaveLength(1);
  });

  it('refuses unknown fields, a city sent by the client, a bad phone and an unknown PIN', async () => {
    const me = await person('2');
    for (const bad of [
      { ...newAddress(), userId: '00000000-0000-7000-8000-000000000000' },
      { ...newAddress(), cityId: '00000000-0000-7000-8000-000000000000' },
      { ...newAddress(), isDefaultShipping: 'yes' },
      newAddress({ contactPhone: '9811100001' }),
      newAddress({ pincode: '12345' }),
      newAddress({ lat: 21.2 }),
    ])
      expect([400, 422]).toContain((await call(me, 'POST', '/me/addresses', bad)).status);
    const unknown = await call(me, 'POST', '/me/addresses', newAddress({ pincode: '999999' }));
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('UNKNOWN_PINCODE');
  });

  it("another customer's address is 404 for edit, default and delete", async () => {
    const mine = await person('3');
    const theirs = await person('4');
    const a = AddressDto.parse((await call(theirs, 'POST', '/me/addresses', newAddress())).body);
    expect(
      (await call(mine, 'PATCH', `/me/addresses/${a.id}`, { version: 1, line1: 'Hijack road 1' })).status,
    ).toBe(404);
    expect((await call(mine, 'POST', `/me/addresses/${a.id}/default`, { version: 1 })).status).toBe(404);
    expect((await call(mine, 'DELETE', `/me/addresses/${a.id}?version=1`)).status).toBe(404);
    expect((await call(mine, 'GET', '/me/addresses')).body.addresses).toEqual([]);
  });

  it('stops at 10 addresses with a typed error', async () => {
    const me = await person('5');
    for (let i = 0; i < MAX_ACCOUNT_ITEMS; i++)
      expect((await call(me, 'POST', '/me/addresses', newAddress())).status).toBe(201);
    const over = await call(me, 'POST', '/me/addresses', newAddress());
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('LIMIT_REACHED');
  });
});

describe('vehicles', () => {
  it('creates, lists, edits and deletes; the registration is normalised', async () => {
    const me = await person('6');
    const created = await call(me, 'POST', '/me/vehicles', newVehicle({ registration: 'cg 04-ab 1234' }));
    expect(created.status).toBe(201);
    const v = VehicleDto.parse(created.body);
    expect(v.registration).toBe('CG04AB1234');
    const edited = await call(me, 'PATCH', `/me/vehicles/${v.id}`, { version: 1, odometerKm: 15000 });
    expect(VehicleDto.parse(edited.body)).toMatchObject({ odometerKm: 15000, version: 2 });
    expect(VehiclesDto.parse((await call(me, 'GET', '/me/vehicles')).body).vehicles).toHaveLength(1);
    expect((await call(me, 'DELETE', `/me/vehicles/${v.id}?version=2`)).status).toBe(200);
    expect(VehiclesDto.parse((await call(me, 'GET', '/me/vehicles')).body).vehicles).toEqual([]);
  });

  it('refuses a bad type, fuel, year, registration and extra fields; duplicates are 409', async () => {
    const me = await person('7');
    for (const bad of [
      newVehicle({ type: '6W' }),
      newVehicle({ fuel: 'steam' }),
      newVehicle({ year: 1950 }),
      newVehicle({ year: 2999 }),
      newVehicle({ registration: '!!' }),
      newVehicle({ odometerKm: -5 }),
      { ...newVehicle(), userId: '00000000-0000-7000-8000-000000000000' },
    ])
      expect([400, 422]).toContain((await call(me, 'POST', '/me/vehicles', bad)).status);
    await call(me, 'POST', '/me/vehicles', newVehicle({ registration: 'CG04AB7777' }));
    const dup = await call(me, 'POST', '/me/vehicles', newVehicle({ registration: 'cg04ab7777' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_REGISTRATION');
  });

  it("another customer's vehicle is 404; the 11th is refused", async () => {
    const mine = await person('8');
    const theirs = await person('9');
    const v = VehicleDto.parse((await call(theirs, 'POST', '/me/vehicles', newVehicle())).body);
    expect((await call(mine, 'PATCH', `/me/vehicles/${v.id}`, { version: 1, make: 'Hijack' })).status).toBe(
      404,
    );
    expect((await call(mine, 'DELETE', `/me/vehicles/${v.id}?version=1`)).status).toBe(404);
    for (let i = 0; i < MAX_ACCOUNT_ITEMS; i++) await call(mine, 'POST', '/me/vehicles', newVehicle());
    expect((await call(mine, 'POST', '/me/vehicles', newVehicle())).body.error.code).toBe('LIMIT_REACHED');
  });
});

describe('profile and limits', () => {
  it('PATCH /me cleans the name (NFKC, 2–60), saves the language and refuses a stale version', async () => {
    const me = await person('10');
    const ok = await call(me, 'PATCH', '/me', { version: 1, name: '  Ｐriya   Singh ', language: 'hi' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: 'Priya Singh', language: 'hi', version: 2 });
    expect((await call(me, 'PATCH', '/me', { version: 1, name: 'Another Name' })).status).toBe(409);
    expect((await call(me, 'PATCH', '/me', { version: 2, name: 'A' })).status).toBe(400);
    expect((await call(me, 'PATCH', '/me', { version: 2, name: 'x'.repeat(61) })).status).toBe(400);
    expect((await call(me, 'PATCH', '/me', { version: 2, phone: '+919000000000' })).status).toBe(400);
  });

  it('limits writes per customer per hour', async () => {
    const me = await person('11');
    for (let i = 0; i < ACCOUNT_WRITE_RATE.limit; i++)
      await call(me, 'DELETE', `/me/vehicles/${me.id}?version=1`);
    expect((await call(me, 'POST', '/me/vehicles', newVehicle())).status).toBe(429);
    // Reads are not part of the write limit.
    expect((await call(me, 'GET', '/me/vehicles')).status).toBe(200);
  });
});
