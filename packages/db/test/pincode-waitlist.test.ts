/**
 * "Notify me" for a PIN that is not served (spec 15 waitlist, design 2026-11-15 item 7): only a signed-in customer with
 * a verified phone or email may join, a served PIN is refused, joining twice is one row, at most five waits per
 * person, the worker tells people once when their PIN is switched on (in their language), and the launch checklist
 * counts waiting customers per PIN within the staff member's city scope.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  joinWaitlist,
  leaveWaitlist,
  listMyWaitlist,
  notifyServedWaitlist,
  waitlistDemand,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let ravi = '';
let asha = '';
let guestish = '';
let raipurId = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  const verified = new Date();
  const users = await db
    .insert(s.users)
    .values([
      { firebaseUid: 'fb-wl-ravi', phone: '+919876500011', phoneVerifiedAt: verified },
      { firebaseUid: 'fb-wl-asha', email: 'asha@example.com', emailVerifiedAt: verified, language: 'hi' },
      { firebaseUid: 'fb-wl-unverified', phone: '+919876500013' },
    ])
    .returning();
  [ravi, asha, guestish] = users.map((u) => u.id) as [string, string, string];
  const [city] = await db.select({ id: s.cities.id }).from(s.cities).where(eq(s.cities.code, 'RPR'));
  raipurId = city?.id ?? '';
});

afterAll(async () => {
  await client.close();
});

describe('joining', () => {
  it('needs a verified phone or email on the account', async () => {
    await expect(joinWaitlist(t(), { userId: guestish, pincode: '110001' })).rejects.toMatchObject({
      status: 403,
      code: 'CONTACT_NOT_VERIFIED',
    });
  });

  it('refuses a PIN that is served already', async () => {
    await expect(joinWaitlist(t(), { userId: ravi, pincode: '492004' })).rejects.toMatchObject({
      code: 'ALREADY_SERVICEABLE',
    });
  });

  it('is one row however many times it is asked, and can be left and joined again', async () => {
    const a = await joinWaitlist(t(), { userId: ravi, pincode: '110001' });
    const b = await joinWaitlist(t(), { userId: ravi, pincode: '110001' });
    expect(a).toMatchObject({ pincode: '110001', status: 'waiting' });
    expect(b.createdAt).toBe(a.createdAt);
    expect(await db.select().from(s.pincodeWaitlist).where(eq(s.pincodeWaitlist.userId, ravi))).toHaveLength(
      1,
    );
    await leaveWaitlist(t(), { userId: ravi, pincode: '110001' });
    expect((await listMyWaitlist(t(), ravi))[0]?.status).toBe('cancelled');
    expect(await joinWaitlist(t(), { userId: ravi, pincode: '110001' })).toMatchObject({ status: 'waiting' });
    await expect(leaveWaitlist(t(), { userId: ravi, pincode: '999999' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('allows five waits at a time, not six', async () => {
    for (const pin of ['110002', '110003', '110004', '110005'])
      await joinWaitlist(t(), { userId: ravi, pincode: pin });
    await expect(joinWaitlist(t(), { userId: ravi, pincode: '110006' })).rejects.toMatchObject({
      code: 'WAITLIST_FULL',
    });
    await leaveWaitlist(t(), { userId: ravi, pincode: '110005' });
    await expect(joinWaitlist(t(), { userId: ravi, pincode: '110006' })).resolves.toBeDefined();
  });

  it('shows a person only their own waits', async () => {
    expect(await listMyWaitlist(t(), asha)).toEqual([]);
  });
});

describe('launch checklist counts', () => {
  it('counts waiting customers per PIN and respects the city scope', async () => {
    await joinWaitlist(t(), { userId: asha, pincode: '110001' });
    const all = await waitlistDemand(t(), { all: true });
    const row = all.rows.find((r) => r.pincode === '110001');
    expect(row).toMatchObject({ waiting: 2, notified: 0, cityCode: null, servedNow: false });
    expect(all.totalWaiting).toBeGreaterThanOrEqual(2);
    // The most wanted PIN comes first.
    expect(all.rows[0]?.pincode).toBe('110001');
    // A city manager sees only PINs of their own city; PINs with no city are for all-cities staff.
    const raipur = await waitlistDemand(t(), { all: false, cityIds: [raipurId] });
    expect(raipur.rows.find((r) => r.pincode === '110001')).toBeUndefined();
    expect(await waitlistDemand(t(), { all: false, cityIds: [] })).toEqual({ rows: [], totalWaiting: 0 });
  });
});

describe('telling people when their PIN is switched on', () => {
  it('notifies once, in the person’s language, when a waiting PIN becomes served', async () => {
    // A PIN of Raipur that is listed but switched off: a customer waits, then staff switch it on.
    await db.execute(sql`update pincodes set active = false, inactive_reason = 'not_launched_yet'
      where pincode = '492004'`);
    await joinWaitlist(t(), { userId: asha, pincode: '492004' });
    const before = await notifyServedWaitlist(t(), {});
    expect(before).toBe(0); // still off
    const row = (await waitlistDemand(t(), { all: true })).rows.find((r) => r.pincode === '492004');
    expect(row).toMatchObject({ cityCode: 'RPR', waiting: 1, servedNow: false });

    await db.execute(sql`update pincodes set active = true, inactive_reason = null where pincode = '492004'`);
    expect(await notifyServedWaitlist(t(), {})).toBe(1);
    expect(await notifyServedWaitlist(t(), {})).toBe(0); // told once
    const [entry] = await db.select().from(s.pincodeWaitlist).where(eq(s.pincodeWaitlist.pincode, '492004'));
    expect(entry).toMatchObject({ status: 'notified' });
    const notices = await db.select().from(s.notifications).where(eq(s.notifications.userId, asha));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe('account.pin_served');
    expect(notices[0]?.title).toContain('492004');
    expect(notices[0]?.title).toMatch(/[ऀ-ॿ]/); // Hindi account gets Hindi
    const events = await db.execute(
      sql`select count(*)::int as n from events where event = 'waitlist_notified'`,
    );
    expect((events.rows[0] as { n: number }).n).toBe(1);
  });
});
