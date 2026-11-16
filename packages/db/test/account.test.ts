/**
 * Customer account (design 2026-11-15): saved addresses and vehicles are actor-scoped (a foreign id is 404), limited
 * to 10 each under a user-row lock, compare-and-set on version (409), audited with a server event in the same
 * transaction, never carry personal data in events, and derive city/state from the PIN (never from the client).
 */
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_ACCOUNT_ITEMS } from '@mechdost/shared/account';
import {
  createAddress,
  createVehicle,
  deleteAddress,
  deleteVehicle,
  listAddresses,
  listVehicles,
  setDefaultAddress,
  updateAddress,
  updateProfile,
  updateVehicle,
  type Tx,
} from '../src/repo';
import { ConflictError, NotFoundError, ValidationError } from '../src/repo/errors';
import { rowsOf } from '../src/repo/sql-rows';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let f: Fixture;
const t = () => db as unknown as Tx;
let n = 0;

const addr = (over: Record<string, unknown> = {}) => ({
  label: 'home' as const,
  contactName: 'Ravi Verma',
  contactPhone: '+919811100001',
  line1: '12 Shankar Nagar',
  line2: null,
  landmark: null,
  pincode: '492001',
  lat: null,
  lng: null,
  ...over,
});
const veh = (over: Record<string, unknown> = {}) => ({
  type: '2W' as const,
  fuel: 'petrol' as const,
  make: 'Honda',
  model: 'Activa',
  variant: null,
  year: 2020,
  registration: null,
  odometerKm: null,
  ...over,
});

async function freshUser(): Promise<string> {
  n += 1;
  const [u] = await db
    .insert(s.users)
    .values({ firebaseUid: `acct-${String(n)}`, phone: `+9198222000${String(n).padStart(2, '0')}` })
    .returning();
  return u!.id;
}

beforeAll(async () => {
  ({ db } = await createTestDb());
  f = await seedServiceFixture(db);
});

describe('addresses', () => {
  it('creates one, derives city and state from the PIN, and makes the first one the default', async () => {
    const u = await freshUser();
    const a = await createAddress(t(), u, addr({ lat: 21.25, lng: 81.63 }), 'en');
    expect(a).toMatchObject({
      pincode: '492001',
      cityName: 'Raipur',
      stateName: 'Chhattisgarh',
      isDefaultShipping: true,
      isDefaultBilling: false,
      serviceable: true,
      lat: 21.25,
      lng: 81.63,
      version: 1,
    });
    const second = await createAddress(t(), u, addr({ label: 'work' }), 'en');
    expect(second.isDefaultShipping).toBe(false);
    expect((await listAddresses(t(), u, 'en')).map((x) => x.id)).toEqual([a.id, second.id]);
  });

  it('answers in Hindi when asked and rejects an unknown PIN', async () => {
    const u = await freshUser();
    await db.update(s.cities).set({ nameHi: 'रायपुर' }).where(eq(s.cities.id, f.raipur));
    expect((await createAddress(t(), u, addr(), 'hi')).cityName).toBe('रायपुर');
    await expect(createAddress(t(), u, addr({ pincode: '999999' }), 'en')).rejects.toMatchObject({
      code: 'UNKNOWN_PINCODE',
    });
  });

  it('a PIN with no live city saves but is not serviceable', async () => {
    const u = await freshUser();
    const [pc] = await db.select().from(s.pincodes).where(eq(s.pincodes.pincode, '492001'));
    await db.insert(s.pincodes).values({ pincode: '110001', stateId: pc!.stateId, cityId: null });
    expect(await createAddress(t(), u, addr({ pincode: '110001' }), 'en')).toMatchObject({
      cityName: null,
      serviceable: false,
    });
  });

  it('enforces the limit of 10 even when creates race', async () => {
    const u = await freshUser();
    await Promise.allSettled(Array.from({ length: 14 }, () => createAddress(t(), u, addr(), 'en')));
    expect(await listAddresses(t(), u, 'en')).toHaveLength(MAX_ACCOUNT_ITEMS);
    await expect(createAddress(t(), u, addr(), 'en')).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
  });

  it('a foreign id is 404 for update, default and delete (and nothing changes)', async () => {
    const mine = await freshUser();
    const theirs = await freshUser();
    const a = await createAddress(t(), theirs, addr(), 'en');
    await expect(
      updateAddress(t(), mine, a.id, 1, { line1: 'Hijacked road 1' }, 'en'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(setDefaultAddress(t(), mine, a.id, 1, 'shipping', 'en')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteAddress(t(), mine, a.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listAddresses(t(), theirs, 'en'))[0]).toMatchObject({
      line1: '12 Shankar Nagar',
      version: 1,
    });
  });

  it('edit is compare-and-set: a stale version is 409; re-deriving the PIN changes the city', async () => {
    const u = await freshUser();
    const a = await createAddress(t(), u, addr(), 'en');
    const b = await updateAddress(t(), u, a.id, 1, { pincode: '490001', landmark: 'Near the temple' }, 'en');
    expect(b).toMatchObject({ cityName: 'Bhilai', landmark: 'Near the temple', version: 2 });
    await expect(updateAddress(t(), u, a.id, 1, { line1: 'Another street 9' }, 'en')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('setting a default clears the old one in one step; there is never more than one', async () => {
    const u = await freshUser();
    const a = await createAddress(t(), u, addr(), 'en');
    const b = await createAddress(t(), u, addr({ label: 'work' }), 'en');
    await setDefaultAddress(t(), u, b.id, b.version, 'shipping', 'en');
    const list = await listAddresses(t(), u, 'en');
    expect(list.filter((x) => x.isDefaultShipping).map((x) => x.id)).toEqual([b.id]);
    expect(list.find((x) => x.id === a.id)?.isDefaultShipping).toBe(false);
    await expect(setDefaultAddress(t(), u, a.id, 1, 'shipping', 'en')).rejects.toBeInstanceOf(ConflictError);
  });

  it('delete is soft, compare-and-set and frees a slot', async () => {
    const u = await freshUser();
    const a = await createAddress(t(), u, addr(), 'en');
    await expect(deleteAddress(t(), u, a.id, 7)).rejects.toBeInstanceOf(ConflictError);
    await deleteAddress(t(), u, a.id, a.version);
    expect(await listAddresses(t(), u, 'en')).toEqual([]);
    const [row] = await db.select().from(s.addresses).where(eq(s.addresses.id, a.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    await expect(deleteAddress(t(), u, a.id, a.version)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('writes an audit row and a server event per change, with no personal data', async () => {
    const u = await freshUser();
    const a = await createAddress(
      t(),
      u,
      addr({ line1: 'Secret lane 77', contactName: 'Secret Name' }),
      'en',
    );
    await updateAddress(t(), u, a.id, 1, { label: 'garage' }, 'en');
    await deleteAddress(t(), u, a.id, 2);
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.entity, 'address'), eq(s.auditLog.entityId, a.id)));
    expect(audit.map((x) => x.action)).toEqual(['address.created', 'address.updated', 'address.deleted']);
    const events = rowsOf<{ event: string; props: Record<string, unknown> }>(
      await db.execute(sql`select event, props from events where user_id = ${u} order by occurred_at, id`),
    );
    expect(events.map((e) => e.event)).toEqual(['address_saved', 'address_saved', 'address_deleted']);
    const everything = JSON.stringify([audit, events]);
    for (const secret of ['Secret lane', 'Secret Name', '919811100001'])
      expect(everything).not.toContain(secret);
  });
});

describe('vehicles', () => {
  it('creates, lists, edits (compare-and-set) and soft-deletes', async () => {
    const u = await freshUser();
    const v = await createVehicle(t(), u, veh({ registration: 'CG04AB1234', odometerKm: 12000 }));
    expect(v).toMatchObject({ make: 'Honda', registration: 'CG04AB1234', odometerKm: 12000, version: 1 });
    const edited = await updateVehicle(t(), u, v.id, 1, { odometerKm: 13000, variant: 'DLX' });
    expect(edited).toMatchObject({ odometerKm: 13000, variant: 'DLX', version: 2 });
    await expect(updateVehicle(t(), u, v.id, 1, { odometerKm: 1 })).rejects.toBeInstanceOf(ConflictError);
    await deleteVehicle(t(), u, v.id, 2);
    expect(await listVehicles(t(), u)).toEqual([]);
  });

  it('a foreign id is 404 and the same registration twice is a conflict', async () => {
    const mine = await freshUser();
    const theirs = await freshUser();
    const v = await createVehicle(t(), theirs, veh({ registration: 'CG04AB9999' }));
    await expect(updateVehicle(t(), mine, v.id, 1, { make: 'Hijack' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteVehicle(t(), mine, v.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createVehicle(t(), theirs, veh({ registration: 'CG04AB9999' }))).rejects.toMatchObject({
      code: 'DUPLICATE_REGISTRATION',
    });
    // Another customer may have the same number (e.g. a sold vehicle).
    await expect(createVehicle(t(), mine, veh({ registration: 'CG04AB9999' }))).resolves.toBeDefined();
  });

  it('enforces the limit of 10 even when creates race', async () => {
    const u = await freshUser();
    await Promise.allSettled(Array.from({ length: 14 }, () => createVehicle(t(), u, veh())));
    expect(await listVehicles(t(), u)).toHaveLength(MAX_ACCOUNT_ITEMS);
    await expect(createVehicle(t(), u, veh())).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps the registration out of audit rows and events', async () => {
    const u = await freshUser();
    const v = await createVehicle(t(), u, veh({ registration: 'CG04ZZ4321' }));
    await updateVehicle(t(), u, v.id, 1, { registration: 'CG04ZZ4322' });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, v.id));
    expect(audit.map((x) => x.action)).toEqual(['vehicle.created', 'vehicle.updated']);
    const events = rowsOf<{ event: string; props: unknown }>(
      await db.execute(sql`select event, props from events where user_id = ${u}`),
    );
    expect(events.map((e) => e.event)).toEqual(['vehicle_saved', 'vehicle_saved']);
    // Only the fields that could carry the registration: random ids and timestamps once contained '4321' by chance
    // and failed CI (2026-11-16).
    const carried = JSON.stringify([
      audit.map((x) => ({ before: x.before, after: x.after, reason: x.reason, ip: x.ipTruncated })),
      events.map((e) => e.props),
    ]);
    expect(carried).not.toContain('4321');
    expect(carried).not.toContain('4322');
    expect(JSON.stringify([audit, events])).not.toMatch(/ZZ432[12]/);
  });
});

describe('profile', () => {
  it('records a profile_updated event with the field names only', async () => {
    const u = await freshUser();
    await updateProfile(t(), {
      userId: u,
      expectedVersion: 1,
      patch: { name: 'Priya Singh', language: 'hi' },
    });
    const [e] = rowsOf<{ props: { fields: string[] } }>(
      await db.execute(sql`select props from events where user_id = ${u} and event = 'profile_updated'`),
    );
    expect(e?.props.fields.sort()).toEqual(['language', 'name']);
    expect(JSON.stringify(e)).not.toContain('Priya');
  });
});
