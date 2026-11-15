/**
 * Workshops tier 1 (spec 06, 07; design 2026-11-15): hourly slots with capacity (the last place goes to exactly one
 * proposal; cancel, decline and reschedule give it back once), the customer reschedule, the acceptance timeout, and the
 * owner's "My workshop" self-edit with staff-approved pin and GSTIN changes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { CreateServiceRequestInput } from '@mechdost/shared/service-requests';
import { WorkshopChangeSchema, WorkshopSelfEditSchema } from '@mechdost/shared/service-requests';
import { serviceRequestMachine } from '@mechdost/shared/state';
import { istDateString } from '@mechdost/shared/time';
import {
  cancelMyServiceRequest,
  createServiceRequest,
  decideProposal,
  decideWorkshopChange,
  declineRequest,
  expireDueServiceRequests,
  getAdminWorkshop,
  getMyServiceRequest,
  getWorkshopProfiles,
  listSlots,
  listWorkshopChanges,
  proposeSlot,
  receiveVehicle,
  requestWorkshopChange,
  rescheduleMyServiceRequest,
  saveWorkshopProfile,
  setSlotCapacity,
  type Tx,
} from '../src/repo';
import { rowsOf } from '../src/repo/sql-rows';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const W: Record<string, { id: string; slug: string }> = {};
let keyN = 0;

/** The first date from tomorrow on that is not a Sunday (the fixture workshops are open Monday to Saturday). */
function openDate(offset = 1): string {
  for (let i = offset; i < offset + 8; i += 1) {
    const d = istDateString(new Date(Date.now() + i * 86_400_000));
    if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) return d;
  }
  throw new Error('no open date');
}
const DAY = openDate();

async function request(workshop = 'main', userId = f.customer) {
  keyN += 1;
  const input: CreateServiceRequestInput = {
    workshopSlug: W[workshop]!.slug,
    vehicleType: '2W',
    vehicleId: null,
    vehicle: 'Honda Activa 6G',
    serviceKeys: ['routine2w'],
    concern: null,
    pincode: '492001',
    lat: null,
    lng: null,
    preferredDate: DAY,
    preferredSlot: 'morning',
    pickup: false,
  };
  return createServiceRequest(t(), {
    userId,
    idempotencyKey: `tier1-test-key-${String(keyN).padStart(6, '0')}`,
    request: input,
  });
}

const step = (code: string, version: number, key = 'main') => ({
  workshopIds: [W[key]!.id],
  code,
  expectedVersion: version,
  staffUserId: f.staff,
});
const propose = (code: string, version: number, hour: number | null, key = 'main', date = DAY) =>
  proposeSlot(t(), {
    ...step(code, version, key),
    date,
    ...(hour === null ? { slot: 'morning' as const } : { hour }),
    lowPaise: 80_000,
    highPaise: 150_000,
    note: null,
  });
const mine = (code: string) => getMyServiceRequest(t(), f.customer, code, 'en');
const booked = async (key: string, hour: number, date = DAY) => {
  const rows = await listSlots(t(), { workshopIds: [W[key]!.id], workshopId: W[key]!.id, date });
  return rows.find((r) => r.hour === hour);
};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  W.main = await addWorkshop(db, f);
  W.other = await addWorkshop(db, f);
  W.bhilai = await addWorkshop(db, f, { pincode: '490001', lat: 21.21, lng: 81.38 });
});
afterAll(async () => {
  await client.close();
});

describe('hourly slots', () => {
  it('lists the open hours of a day with the default capacity of 2 and nothing on a closed day', async () => {
    const rows = await listSlots(t(), { workshopIds: [W.main!.id], workshopId: W.main!.id, date: DAY });
    expect(rows.map((r) => r.hour)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(rows.every((r) => r.capacity === 2 && r.booked === 0 && r.free === 2)).toBe(true);
    const sunday = istDateString(new Date(Date.now() + (7 - new Date().getUTCDay()) * 86_400_000));
    expect(await listSlots(t(), { workshopIds: [W.main!.id], workshopId: W.main!.id, date: sunday })).toEqual(
      [],
    );
  });

  it('a proposal with an hour takes one place; the part of the day is derived', async () => {
    const r = await request();
    await propose(r.code, r.version, 10);
    expect((await booked('main', 10))?.booked).toBe(1);
    const view = await mine(r.code);
    expect(view.proposal).toMatchObject({ hour: 10, slot: 'morning', status: 'pending' });
    const r2 = await request();
    await propose(r2.code, r2.version, 15, 'main');
    expect((await mine(r2.code)).proposal?.slot).toBe('afternoon');
  });

  it('refuses a closed hour, a closed day, an hour already over today, and another workshop id', async () => {
    const r = await request();
    await expect(propose(r.code, r.version, 22)).rejects.toMatchObject({ code: 'SLOT_CLOSED' });
    const sunday = istDateString(new Date(Date.now() + (7 - new Date().getUTCDay() || 7) * 86_400_000));
    await expect(propose(r.code, r.version, 10, 'main', sunday)).rejects.toMatchObject({
      code: 'SLOT_CLOSED',
    });
    // Today, hour 0 is closed for any workshop: past-hour logic is covered with an injected clock below.
    const noon = new Date(`${DAY}T06:30:00Z`); // 12:00 IST on DAY
    await expect(
      proposeSlot(t(), {
        ...step(r.code, r.version),
        date: DAY,
        hour: 11,
        lowPaise: 1,
        highPaise: 2,
        note: null,
        now: noon,
      }),
    ).rejects.toMatchObject({ code: 'SLOT_PAST' });
    // Slots of one workshop cannot be listed with another workshop's grants (404).
    await expect(
      listSlots(t(), { workshopIds: [W.other!.id], workshopId: W.main!.id, date: DAY }),
    ).rejects.toMatchObject({ status: 404 });
    // The failed attempts left no place taken.
    expect((await booked('main', 11))?.booked).toBe(0);
  });

  it('capacity race: parallel proposals into the last place give it to exactly one', async () => {
    const date = openDate(3);
    await setSlotCapacity(t(), {
      workshopIds: [W.other!.id],
      workshopId: W.other!.id,
      date,
      hour: 12,
      capacity: 1,
      userId: f.staff,
    });
    const rs = await Promise.all([request('other'), request('other'), request('other'), request('other')]);
    const results = await Promise.allSettled(rs.map((r) => propose(r.code, r.version, 12, 'other', date)));
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const lost = results.filter((x) => x.status === 'rejected');
    expect(lost).toHaveLength(3);
    for (const l of lost) expect((l as PromiseRejectedResult).reason).toMatchObject({ code: 'SLOT_FULL' });
    const row = await booked('other', 12, date);
    expect(row).toMatchObject({ capacity: 1, booked: 1, free: 0 });
    // Losers stay waiting for the workshop (the whole proposal rolled back).
    const states = await Promise.all(rs.map((r) => mine(r.code).then((v) => v.status)));
    expect(states.filter((x) => x === 'awaiting_workshop')).toHaveLength(3);
  });

  it('the capacity cannot drop below what is booked, and the database CHECK holds', async () => {
    const date = openDate(4);
    const a = await request('main');
    const b = await request('main');
    await propose(a.code, a.version, 13, 'main', date);
    await propose(b.code, b.version, 13, 'main', date);
    await expect(
      setSlotCapacity(t(), {
        workshopIds: [W.main!.id],
        workshopId: W.main!.id,
        date,
        hour: 13,
        capacity: 1,
        userId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'CAPACITY_BELOW_BOOKED' });
    await expect(
      db.execute(
        sql`update workshop_slots set booked = capacity + 1 where hour = 13 and slot_date = ${date}`,
      ),
    ).rejects.toThrow();
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'workshop.slot_capacity'));
    expect(audit.length).toBeGreaterThan(0);
  });

  it('gives the place back once on cancel, customer decline and reschedule', async () => {
    const date = openDate(5);
    const slots = () => booked('main', 16, date);
    const base = (await slots())?.booked ?? 0;
    const a = await request('main');
    const va = (await propose(a.code, a.version, 16, 'main', date)).version;
    expect((await slots())?.booked).toBe(base + 1);
    // Customer turns the proposal down.
    await decideProposal(t(), { userId: f.customer, code: a.code, accept: false, expectedVersion: va });
    expect((await slots())?.booked).toBe(base);
    // Propose again, confirm, then cancel.
    const v2 = (await mine(a.code)).version;
    const p2 = await propose(a.code, v2, 16, 'main', date);
    expect((await slots())?.booked).toBe(base + 1);
    const v3 = (
      await decideProposal(t(), {
        userId: f.customer,
        code: a.code,
        accept: true,
        expectedVersion: p2.version,
      })
    ).version;
    await cancelMyServiceRequest(t(), {
      userId: f.customer,
      code: a.code,
      reasonCode: 'changed_mind',
      expectedVersion: v3,
    });
    expect((await slots())?.booked).toBe(base);
    // Reschedule from confirmed.
    const b = await request('main');
    const pb = await propose(b.code, b.version, 16, 'main', date);
    const cb = await decideProposal(t(), {
      userId: f.customer,
      code: b.code,
      accept: true,
      expectedVersion: pb.version,
    });
    expect((await slots())?.booked).toBe(base + 1);
    await rescheduleMyServiceRequest(t(), {
      userId: f.customer,
      code: b.code,
      date: openDate(6),
      slot: 'evening',
      expectedVersion: cb.version,
    });
    expect((await slots())?.booked).toBe(base);
    // A proposal row is released only once: nothing is left to give back.
    const open = rowsOf<{ n: number }>(
      await db.execute(
        sql`select count(*)::int as n from service_proposals where slot_released_at is null and slot_hour is not null and status in ('declined', 'withdrawn') and request_id in (select id from service_requests where code in (${a.code}, ${b.code}))`,
      ),
    );
    expect(open[0]?.n).toBe(0);
  });

  it('the vehicle arriving keeps its place booked', async () => {
    const date = openDate(2);
    const before = (await booked('main', 17, date))?.booked ?? 0;
    const r = await request('main');
    const p = await propose(r.code, r.version, 17, 'main', date);
    const c = await decideProposal(t(), {
      userId: f.customer,
      code: r.code,
      accept: true,
      expectedVersion: p.version,
    });
    await receiveVehicle(t(), { ...step(r.code, c.version), odometerKm: 5_000 });
    expect((await booked('main', 17, date))?.booked).toBe(before + 1);
  });

  it('an older hourless proposal still works and takes no capacity', async () => {
    const r = await request('main');
    await propose(r.code, r.version, null);
    expect((await mine(r.code)).proposal).toMatchObject({ hour: null, slot: 'morning' });
  });
});

describe('customer reschedule', () => {
  it('moves a confirmed booking back to the workshop with the old and the new time in the history', async () => {
    const r = await request('main');
    const p = await propose(r.code, r.version, 9);
    const c = await decideProposal(t(), {
      userId: f.customer,
      code: r.code,
      accept: true,
      expectedVersion: p.version,
    });
    const to = openDate(9);
    const out = await rescheduleMyServiceRequest(t(), {
      userId: f.customer,
      code: r.code,
      date: to,
      slot: 'afternoon',
      expectedVersion: c.version,
    });
    expect(out.status).toBe('awaiting_workshop');
    const v = await mine(r.code);
    expect(v.preferredDate).toBe(to);
    expect(v.preferredSlot).toBe('afternoon');
    expect(v.proposal).toBeNull();
    expect(v.reschedule).toMatchObject({ count: 1, max: 2, from: { date: DAY, slot: 'morning' } });
    const [ev] = await db
      .select()
      .from(s.serviceEvents)
      .where(
        sql`${s.serviceEvents.requestId} = (select id from service_requests where code = ${r.code}) and ${s.serviceEvents.payload} ->> 'reschedule' = 'true'`,
      );
    expect(ev).toMatchObject({
      fromStatus: 'confirmed',
      toStatus: 'awaiting_workshop',
      actorType: 'customer',
    });
    expect(ev?.payload).toMatchObject({ toDate: to, toSlot: 'afternoon', count: 1 });
    // The workshop answers the new time like any request; the customer may move twice, not three times.
    const p2 = await propose(r.code, out.version, 14, 'main', to);
    const c2 = await decideProposal(t(), {
      userId: f.customer,
      code: r.code,
      accept: true,
      expectedVersion: p2.version,
    });
    const second = await rescheduleMyServiceRequest(t(), {
      userId: f.customer,
      code: r.code,
      date: openDate(10),
      slot: 'morning',
      expectedVersion: c2.version,
    });
    const p3 = await propose(r.code, second.version, 10, 'main', openDate(10));
    const c3 = await decideProposal(t(), {
      userId: f.customer,
      code: r.code,
      accept: true,
      expectedVersion: p3.version,
    });
    await expect(
      rescheduleMyServiceRequest(t(), {
        userId: f.customer,
        code: r.code,
        date: openDate(11),
        slot: 'morning',
        expectedVersion: c3.version,
      }),
    ).rejects.toMatchObject({ code: 'RESCHEDULE_LIMIT' });
  });

  it('works from "proposed", refuses the same time, a foreign customer, a stale version and after the vehicle arrived', async () => {
    const r = await request('main');
    const p = await propose(r.code, r.version, 11);
    const args = { userId: f.customer, code: r.code, date: openDate(12), slot: 'evening' as const };
    await expect(
      rescheduleMyServiceRequest(t(), { ...args, userId: f.other, expectedVersion: p.version }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      rescheduleMyServiceRequest(t(), { ...args, expectedVersion: p.version + 5 }),
    ).rejects.toMatchObject({ code: 'STALE_REQUEST' });
    await expect(
      rescheduleMyServiceRequest(t(), { ...args, date: DAY, slot: 'morning', expectedVersion: p.version }),
    ).rejects.toMatchObject({ code: 'RESCHEDULE_SAME' });
    const out = await rescheduleMyServiceRequest(t(), { ...args, expectedVersion: p.version });
    expect(out.status).toBe('awaiting_workshop');
    expect((await booked('main', 11))?.booked).toBe(0);

    const q = await request('main');
    const pq = await propose(q.code, q.version, 12);
    const cq = await decideProposal(t(), {
      userId: f.customer,
      code: q.code,
      accept: true,
      expectedVersion: pq.version,
    });
    const rv = await receiveVehicle(t(), { ...step(q.code, cq.version), odometerKm: 7_000 });
    await expect(
      rescheduleMyServiceRequest(t(), { ...args, code: q.code, expectedVersion: rv.version }),
    ).rejects.toMatchObject({ code: 'WRONG_STEP' });
    await expect(
      rescheduleMyServiceRequest(t(), { ...args, date: '2020-01-01', code: q.code, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'DATE_OUT_OF_RANGE' });
  });

  it('the machine lets only the customer reopen a confirmed booking', () => {
    expect(serviceRequestMachine.canActor('confirmed', 'awaiting_workshop', 'customer')).toBe(true);
    expect(serviceRequestMachine.canActor('confirmed', 'awaiting_workshop', 'workshop')).toBe(false);
    expect(serviceRequestMachine.canActor('vehicle_received', 'awaiting_workshop', 'customer')).toBe(false);
  });
});

describe('acceptance timeout', () => {
  /** The test clock: events are append-only, so the rows are aged with triggers switched off for one statement. */
  async function age(code: string, minutes: number) {
    await client.exec('SET session_replication_role = replica');
    await db.execute(
      sql`update service_events set created_at = created_at - make_interval(mins => ${minutes})
        where request_id = (select id from service_requests where code = ${code})`,
    );
    await client.exec('SET session_replication_role = DEFAULT');
  }

  it('sends a request nobody answered back to routing with an event, and only after the deadline', async () => {
    const r = await request('main');
    await age(r.code, 30);
    expect((await expireDueServiceRequests(t())).expired).toBe(0);
    expect((await mine(r.code)).status).toBe('awaiting_workshop');
    await age(r.code, 40); // 70 minutes in total, past the default 60
    const sweep = await expireDueServiceRequests(t());
    expect(sweep.failed).toEqual([]);
    expect(sweep.expired).toBeGreaterThanOrEqual(1);
    const v = await mine(r.code);
    expect(v.status).toBe('needs_routing');
    expect(v.workshop).toBeNull();
    const events = await db
      .select()
      .from(s.serviceEvents)
      .where(
        sql`${s.serviceEvents.requestId} = (select id from service_requests where code = ${r.code}) and ${s.serviceEvents.toStatus} = 'needs_routing'`,
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: 'system', visibleToCustomer: false });
    expect(events[0]?.payload).toMatchObject({
      reason: 'acceptance_timeout',
      expiredWorkshopId: W.main!.id,
    });
    // Run again: nothing left to expire for it.
    expect((await expireDueServiceRequests(t())).expired).toBe(0);
  });

  it('honours the city setting and leaves answered requests alone', async () => {
    const answered = await request('main');
    await propose(answered.code, answered.version, 9, 'main', DAY);
    const waiting = await request('main');
    await age(answered.code, 500);
    await age(waiting.code, 15);
    await db
      .insert(s.settings)
      .values({ cityId: f.raipur, key: 'service.acceptance_timeout_min', value: 10 });
    const sweep = await expireDueServiceRequests(t());
    expect(sweep.expired).toBeGreaterThanOrEqual(1);
    expect((await mine(waiting.code)).status).toBe('needs_routing');
    expect((await mine(answered.code)).status).toBe('proposed');
    await db.delete(s.settings).where(eq(s.settings.key, 'service.acceptance_timeout_min'));
  });

  it('a request that went back to awaiting_workshop restarts the clock', async () => {
    const r = await request('main');
    const p = await propose(r.code, r.version, 10);
    await age(r.code, 500);
    await decideProposal(t(), {
      userId: f.customer,
      code: r.code,
      accept: false,
      expectedVersion: p.version,
    });
    const swept = await expireDueServiceRequests(t());
    expect(swept.failed).toEqual([]);
    expect((await mine(r.code)).status).toBe('awaiting_workshop');
  });

  it('a workshop that declines first is not counted as an expiry', async () => {
    const r = await request('main');
    await declineRequest(t(), { ...step(r.code, r.version), reasonCode: 'too_busy' });
    const expired = await db
      .select()
      .from(s.serviceEvents)
      .where(
        sql`${s.serviceEvents.payload} ->> 'reason' = 'acceptance_timeout' and ${s.serviceEvents.requestId} = (select id from service_requests where code = ${r.code})`,
      );
    expect(expired).toHaveLength(0);
  });
});

describe('"My workshop" self-edit', () => {
  it('lets the owner edit text in both languages, hours, menu ranges, busy mode and capacity, audited', async () => {
    const [profile] = await getWorkshopProfiles(t(), [W.other!.id]);
    expect(profile?.slotCapacity).toBe(2);
    const out = await saveWorkshopProfile(t(), {
      workshopIds: [W.other!.id],
      workshopId: W.other!.id,
      userId: f.staff,
      edit: {
        version: profile!.workshop.version,
        name: 'Sharma Motors',
        nameHi: 'शर्मा मोटर्स',
        hours: { open: '08:00', close: '20:00', days: [1, 2, 3, 4, 5, 6, 0] },
        busy: true,
        slotCapacity: 3,
        menu: [
          {
            key: 'routine2w',
            title: 'General service (2W)',
            titleHi: 'जनरल सर्विस (2W)',
            lowPaise: 90_000,
            highPaise: 160_000,
            minMinutes: 120,
            maxMinutes: 180,
            active: true,
          },
        ],
      },
    });
    expect(out.version).toBeGreaterThan(profile!.workshop.version);
    const w = await getAdminWorkshop(t(), { all: true }, W.other!.id);
    expect(w).toMatchObject({ name: 'Sharma Motors', nameHi: 'शर्मा मोटर्स', busy: true });
    expect(w.menu.find((m) => m.key === 'routine2w')).toMatchObject({ lowPaise: 90_000, highPaise: 160_000 });
    expect(w.menu.find((m) => m.key === 'diagnosis')?.active).toBe(false);
    const [after] = await getWorkshopProfiles(t(), [W.other!.id]);
    expect(after?.slotCapacity).toBe(3);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'workshop.profile_saved'));
    expect(audit.length).toBeGreaterThan(0);
  });

  it('refuses a stale version and another workshop (404), and the schema rejects pin and GSTIN fields', async () => {
    const [profile] = await getWorkshopProfiles(t(), [W.main!.id]);
    await expect(
      saveWorkshopProfile(t(), {
        workshopIds: [W.main!.id],
        workshopId: W.main!.id,
        userId: f.staff,
        edit: { version: profile!.workshop.version + 9, busy: true },
      }),
    ).rejects.toMatchObject({ code: 'STALE_WORKSHOP' });
    await expect(
      saveWorkshopProfile(t(), {
        workshopIds: [W.main!.id],
        workshopId: W.other!.id,
        userId: f.staff,
        edit: { version: 1, busy: true },
      }),
    ).rejects.toMatchObject({ status: 404 });
    for (const extra of [
      { lat: 21.1, lng: 81.1 },
      { gstin: '22AAAAA0000A1Z5' },
      { published: true },
      { locationVerified: true },
      { pincode: '492004' },
    ])
      expect(WorkshopSelfEditSchema.safeParse({ version: 1, ...extra }).success).toBe(false);
    expect(WorkshopSelfEditSchema.safeParse({ version: 1, busy: false }).success).toBe(true);
  });

  it('a pin or GSTIN change waits for staff; the live values stay until they approve', async () => {
    const own = { workshopIds: [W.main!.id], workshopId: W.main!.id, userId: f.staff };
    const before = await getAdminWorkshop(t(), { all: true }, W.main!.id);
    const pin = await requestWorkshopChange(t(), {
      ...own,
      change: { kind: 'location', lat: 21.27, lng: 81.66, pincode: '492004' },
    });
    await requestWorkshopChange(t(), { ...own, change: { kind: 'gstin', gstin: '22AAAAA0000A1Z5' } });
    await expect(
      requestWorkshopChange(t(), { ...own, change: { kind: 'gstin', gstin: '22BBBBB0000B1Z5' } }),
    ).rejects.toMatchObject({ code: 'CHANGE_PENDING' });
    const stillLive = await getAdminWorkshop(t(), { all: true }, W.main!.id);
    expect(stillLive).toMatchObject({ lat: before.lat, lng: before.lng, gstin: null, gstRegistered: false });
    const [profile] = await getWorkshopProfiles(t(), [W.main!.id]);
    expect(profile?.pending.map((p) => p.kind).sort()).toEqual(['gstin', 'location']);
    // Another workshop's grants cannot file for this one.
    await expect(
      requestWorkshopChange(t(), {
        ...own,
        workshopIds: [W.other!.id],
        change: { kind: 'gstin', gstin: null },
      }),
    ).rejects.toMatchObject({ status: 404 });

    // Staff: a city scope that does not include Raipur sees nothing; with Raipur they decide.
    expect(await listWorkshopChanges(t(), { all: false, cityIds: [f.bhilai] })).toEqual([]);
    const waiting = await listWorkshopChanges(t(), { all: false, cityIds: [f.raipur] });
    const locationReq = waiting.find((c) => c.id === pin.id)!;
    await expect(
      decideWorkshopChange(t(), {
        scope: { all: false, cityIds: [f.bhilai] },
        changeId: locationReq.id,
        approve: true,
        note: null,
        version: 1,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      decideWorkshopChange(t(), {
        scope: { all: true },
        changeId: locationReq.id,
        approve: false,
        note: null,
        version: 1,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'NOTE_REQUIRED' });
    await expect(
      decideWorkshopChange(t(), {
        scope: { all: true },
        changeId: locationReq.id,
        approve: true,
        note: null,
        version: 9,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'STALE_REQUEST' });
    expect(
      await decideWorkshopChange(t(), {
        scope: { all: true },
        changeId: locationReq.id,
        approve: true,
        note: null,
        version: 1,
        staffUserId: f.staff,
      }),
    ).toEqual({ status: 'approved' });
    const moved = await getAdminWorkshop(t(), { all: true }, W.main!.id);
    expect(moved).toMatchObject({ lat: 21.27, lng: 81.66, pincode: '492004', locationVerified: true });
    // Decided once only.
    await expect(
      decideWorkshopChange(t(), {
        scope: { all: true },
        changeId: locationReq.id,
        approve: true,
        note: null,
        version: 2,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
    const gstinReq = (await listWorkshopChanges(t(), { all: true })).find(
      (c) => c.workshopId === W.main!.id && c.kind === 'gstin',
    )!;
    await decideWorkshopChange(t(), {
      scope: { all: true },
      changeId: gstinReq.id,
      approve: true,
      note: 'GST portal checked',
      version: 1,
      staffUserId: f.staff,
    });
    expect(await getAdminWorkshop(t(), { all: true }, W.main!.id)).toMatchObject({
      gstin: '22AAAAA0000A1Z5',
      gstRegistered: true,
    });
  });

  it('validates change bodies strictly', () => {
    expect(WorkshopChangeSchema.safeParse({ kind: 'gstin', gstin: 'nope' }).success).toBe(false);
    expect(WorkshopChangeSchema.safeParse({ kind: 'location', lat: 200, lng: 1 }).success).toBe(false);
    expect(WorkshopChangeSchema.safeParse({ kind: 'gstin', gstin: null, extra: 1 }).success).toBe(false);
    expect(WorkshopChangeSchema.safeParse({ kind: 'gstin', gstin: null }).success).toBe(true);
  });
});
