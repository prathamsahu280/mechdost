/**
 * Pauses with an end date resume by themselves (Q28, user 2026-11-13: "optional end date"). Open-ended pauses and
 * pauses that end later stay; suspensions are never touched. The resume is recorded like any status change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { resumeEndedPauses, setShopStanding, type Tx } from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let cityId = '';
let stateId = '';

async function shop(name: string): Promise<string> {
  const [row] = await db
    .insert(s.shops)
    .values({
      name,
      phone: '+919800000000',
      addressLine: 'Raipur',
      pincode: '492001',
      cityId,
      stateId,
      location: { lng: 81.64, lat: 21.227 },
      status: 'approved',
    })
    .returning();
  return row!.id;
}
const version = async (id: string) =>
  (await db.select({ v: s.shops.version }).from(s.shops).where(eq(s.shops.id, id)))[0]!.v;
const status = async (id: string) =>
  (await db.select({ st: s.shops.status }).from(s.shops).where(eq(s.shops.id, id)))[0]!.st;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  stateId = (
    await db.insert(s.states).values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' }).returning()
  )[0]!.id;
  cityId = (
    await db
      .insert(s.cities)
      .values({
        stateId,
        code: 'RPR',
        slug: 'raipur',
        name: 'Raipur',
        status: 'live',
        centroid: { lng: 81.64, lat: 21.227 },
      })
      .returning()
  )[0]!.id;
  await db
    .insert(s.pincodes)
    .values({ pincode: '492001', stateId, cityId, centroid: { lng: 81.64, lat: 21.227 } });
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-pause-staff' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('resumeEndedPauses', () => {
  it('resumes only pauses whose end date has passed, with history and a system audit entry', async () => {
    const ended = await shop('Ended Pause Auto');
    const later = await shop('Later Pause Auto');
    const open = await shop('Open Pause Auto');
    const suspended = await shop('Suspended Auto');
    const now = new Date('2026-11-20T10:00:00Z');
    const pause = async (id: string, until: Date | null) =>
      setShopStanding(t(), {
        shopId: id,
        to: 'paused',
        reason: 'Stock audit this week',
        staffUserId: staff,
        expectedVersion: await version(id),
        pausedUntil: until,
      });
    await pause(ended, new Date('2026-11-20T09:00:00Z'));
    await pause(later, new Date('2026-11-21T09:00:00Z'));
    await pause(open, null);
    await setShopStanding(t(), {
      shopId: suspended,
      to: 'suspended',
      reason: 'Repeated wrong parts',
      staffUserId: staff,
      expectedVersion: await version(suspended),
    });

    expect(await resumeEndedPauses(t(), now)).toBe(1);
    expect(await status(ended)).toBe('approved');
    expect(await status(later)).toBe('paused');
    expect(await status(open)).toBe('paused');
    expect(await status(suspended)).toBe('suspended');

    const [row] = await db.select().from(s.shops).where(eq(s.shops.id, ended));
    expect(row).toMatchObject({ pausedUntil: null, statusReason: 'The pause ended' });
    const events = await db
      .select()
      .from(s.partnerStatusEvents)
      .where(eq(s.partnerStatusEvents.partnerId, ended));
    expect(events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      ['approved', 'paused'],
      ['paused', 'approved'],
    ]);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, ended));
    expect(audit.at(-1)).toMatchObject({ action: 'partner.pause_ended', actorRole: 'system' });

    // Running again does nothing (idempotent sweep).
    expect(await resumeEndedPauses(t(), now)).toBe(0);
  });
});

describe('counterfeit_confirmed (the "genuine parts only" clause, 2026-11-15)', () => {
  it('suspends a shop with the code, which is kept in its history', async () => {
    const id = await shop('Fake Parts Seller');
    await setShopStanding(t(), {
      shopId: id,
      to: 'suspended',
      reason: 'A counterfeit filter was confirmed',
      reasonCode: 'counterfeit_confirmed',
      staffUserId: staff,
      expectedVersion: await version(id),
    });
    expect(await status(id)).toBe('suspended');
    const [event] = await db
      .select()
      .from(s.partnerStatusEvents)
      .where(eq(s.partnerStatusEvents.partnerId, id));
    expect(event?.reasonCode).toBe('counterfeit_confirmed');
  });
});
