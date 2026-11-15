/**
 * Live pings for service requests (design 2026-11-16, spec 06/10): a trigger writes one thin ping per change to a
 * request, and the relay resolves recipients from Postgres only: the customer, the users of the workshop holding the
 * request, and the city's staff who can read service requests. Nobody else.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { parseLivePing } from '@mechdost/shared/live';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { claimLiveBatch, grantRole, resolveLiveRecipients, syncRbacCatalogue, type Tx } from '../src/repo';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const U: Record<string, string> = {};
let ws = '';
let otherWs = '';
let n = 0;

async function mkUser(uid: string) {
  return (await db.insert(s.users).values({ firebaseUid: uid }).returning())[0]!.id;
}

async function mkRequest(workshopId: string | null = ws) {
  n += 1;
  return (
    await db
      .insert(s.serviceRequests)
      .values({
        code: `SR-RPR-2026-RT${String(n).padStart(4, '0')}`,
        userId: f.customer,
        cityId: f.raipur,
        workshopId,
        routingMode: 'chosen',
        vehicleType: '2W',
        vehicleText: 'Honda Activa 6G',
        vehicleKey: 'honda activa 6g',
        services: [],
        pincode: '492001',
        preferredDate: '2026-11-20',
        preferredSlot: 'morning',
        idempotencyKey: `live-request-${String(n).padStart(8, '0')}`,
      })
      .returning()
  )[0]!;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  ws = (await addWorkshop(db, f)).id;
  otherWs = (await addWorkshop(db, f)).id;
  U.owner = await mkUser('fb-lr-owner');
  U.otherOwner = await mkUser('fb-lr-other-owner');
  U.cityStaff = await mkUser('fb-lr-city');
  U.otherCityStaff = await mkUser('fb-lr-bhilai');
  U.marketing = await mkUser('fb-lr-marketing');
  await grantRole(t(), { userId: U.owner, role: 'workshop_owner', workshopId: ws, grantedBy: null });
  await grantRole(t(), {
    userId: U.otherOwner,
    role: 'workshop_owner',
    workshopId: otherWs,
    grantedBy: null,
  });
  await grantRole(t(), { userId: U.cityStaff, role: 'city_manager', cityId: f.raipur, grantedBy: null });
  await grantRole(t(), { userId: U.otherCityStaff, role: 'city_manager', cityId: f.bhilai, grantedBy: null });
  await grantRole(t(), { userId: U.marketing, role: 'marketing', grantedBy: null });
});
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  await db.execute(sql`delete from live_outbox`);
});

const uids = async (topic: string) =>
  (await resolveLiveRecipients(t(), topic)).map((x) => x.firebaseUid).sort();

describe('service request live pings', () => {
  it('writes one thin ping per change, with the request version', async () => {
    const r = await mkRequest();
    await db
      .update(s.serviceRequests)
      .set({ status: 'proposed', version: sql`${s.serviceRequests.version} + 1` })
      .where(eq(s.serviceRequests.id, r.id));
    const rows = await claimLiveBatch(t());
    expect(rows.map((x) => x.topic)).toEqual([`request:${r.id}`, `request:${r.id}`]);
    expect(rows.map((x) => x.ping.v)).toEqual([r.version, r.version + 1]);
    expect(parseLivePing(rows[0]?.ping)).toMatchObject({
      e: 'request.status_changed',
      k: 'request',
      id: r.id,
    });
  });

  it('a rolled-back change leaves no ping', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(s.serviceRequests).values({
          code: 'SR-RPR-2026-RT0000',
          userId: f.customer,
          cityId: f.raipur,
          workshopId: ws,
          routingMode: 'chosen',
          vehicleType: '2W',
          vehicleText: 'Honda Activa 6G',
          vehicleKey: 'honda activa 6g',
          services: [],
          pincode: '492001',
          preferredDate: '2026-11-20',
          preferredSlot: 'morning',
          idempotencyKey: 'live-request-00000099',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await claimLiveBatch(t())).toHaveLength(0);
  });

  it('goes to the customer, the holding workshop and the city staff, and nobody else', async () => {
    const r = await mkRequest();
    expect(await uids(`request:${r.id}`)).toEqual(['fb-lr-city', 'fb-lr-owner', 'svc-cust']);
  });

  it('a request nobody holds yet reaches the customer and city staff only', async () => {
    const r = await mkRequest(null);
    expect(await uids(`request:${r.id}`)).toEqual(['fb-lr-city', 'svc-cust']);
  });

  it('an unknown request resolves to nobody (fail closed)', async () => {
    expect(await uids('request:0192f3a4-5b6c-7d8e-9f01-23456789abcd')).toEqual([]);
  });

  it('a deactivated workshop user is not pinged', async () => {
    const r = await mkRequest();
    await db
      .update(s.users)
      .set({ status: 'deactivated' })
      .where(eq(s.users.id, U.owner ?? ''));
    expect(await uids(`request:${r.id}`)).not.toContain('fb-lr-owner');
    await db
      .update(s.users)
      .set({ status: 'active' })
      .where(eq(s.users.id, U.owner ?? ''));
  });
});
