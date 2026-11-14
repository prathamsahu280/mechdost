/**
 * Workshops (spec 06 acceptance: nearby ordering and radius; spec 08: staff create/edit/publish, standing with
 * history, portal access). Only bookable workshops are listed: published, location verified, approved, not busy.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  addWorkshopMember,
  findNearbyWorkshops,
  getAdminWorkshop,
  getPublicWorkshop,
  listAdminWorkshops,
  loadGrants,
  setWorkshopStanding,
  syncRbacCatalogue,
  updateWorkshop,
  workshopIdsFrom,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { addWorkshop, MENU, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const W: Record<string, { id: string; slug: string }> = {};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  // ~0 km, ~3.5 km and ~9 km from the 492001 centroid; plus four that must never be listed.
  W.near = await addWorkshop(db, f, { name: 'Near', lat: 21.2514, lng: 81.6296 });
  W.mid = await addWorkshop(db, f, { name: 'Mid', lat: 21.2621, lng: 81.6612, pickup: true, evBasic: true });
  W.far = await addWorkshop(db, f, { name: 'Far', lat: 21.17, lng: 81.62, vehicleTypes: ['4W'] });
  W.hidden = await addWorkshop(db, f, { name: 'Unpublished', published: false });
  W.unverified = await addWorkshop(db, f, { name: 'Unverified', published: false, locationVerified: false });
  W.paused = await addWorkshop(db, f, { name: 'Paused' });
  W.busy = await addWorkshop(db, f, { name: 'Busy' });
  const paused = await getAdminWorkshop(t(), { all: true }, W.paused.id);
  await setWorkshopStanding(t(), {
    scope: { all: true },
    staffUserId: f.staff,
    workshopId: W.paused.id,
    status: 'paused',
    reason: 'Quality complaints under review',
    expectedVersion: paused.version,
  });
  const busy = await getAdminWorkshop(t(), { all: true }, W.busy.id);
  await updateWorkshop(t(), {
    scope: { all: true },
    staffUserId: f.staff,
    workshopId: W.busy.id,
    patch: { version: busy.version, busy: true },
  });
});

afterAll(async () => {
  await client.close();
});

const nearby = (over: Partial<Parameters<typeof findNearbyWorkshops>[1]> = {}) =>
  findNearbyWorkshops(t(), { at: { pincode: '492001' }, radiusKm: 15, locale: 'en', ...over });

describe('nearby workshops', () => {
  it('lists bookable workshops nearest first within the radius, with the active menu', async () => {
    const r = await nearby();
    expect(r.workshops.map((w) => w.slug)).toEqual([W.near!.slug, W.mid!.slug, W.far!.slug]);
    const [first, second, third] = r.workshops;
    expect(first!.distanceKm).toBeLessThan(second!.distanceKm);
    expect(second!.distanceKm).toBeLessThan(third!.distanceKm);
    expect(first!.services.map((m) => m.key)).toEqual(['diagnosis', 'routine2w']);
    const tight = await nearby({ radiusKm: 5 });
    expect(tight.workshops.map((w) => w.slug)).toEqual([W.near!.slug, W.mid!.slug]);
  });

  it('starts from a point when given, and filters by vehicle type, pickup, EV and menu key', async () => {
    const fromMid = await nearby({ at: { lat: 21.2621, lng: 81.6612 } });
    expect(fromMid.workshops[0]!.slug).toBe(W.mid!.slug);
    expect((await nearby({ vehicleType: '2W' })).workshops.map((w) => w.slug)).toEqual([
      W.near!.slug,
      W.mid!.slug,
    ]);
    expect((await nearby({ pickup: true })).workshops.map((w) => w.slug)).toEqual([W.mid!.slug]);
    expect((await nearby({ ev: true })).workshops.map((w) => w.slug)).toEqual([W.mid!.slug]);
    expect((await nearby({ serviceKey: 'nope' })).workshops).toEqual([]);
  });

  it('shows Hindi names on /hi with the English fallback, and refuses a PIN without a centroid', async () => {
    const hi = await nearby({ locale: 'hi' });
    expect(hi.workshops[0]!.area).toBe('शंकर नगर');
    expect(hi.workshops[0]!.services[0]!.title).toBe('जाँच और निदान');
    await expect(nearby({ at: { pincode: '492009' } })).rejects.toMatchObject({ code: 'PINCODE_UNKNOWN' });
  });

  it('a public page exists only for a bookable workshop', async () => {
    expect((await getPublicWorkshop(t(), W.near!.slug, 'en')).name).toBe('Near');
    for (const key of ['hidden', 'unverified', 'paused', 'busy'])
      await expect(getPublicWorkshop(t(), W[key]!.slug, 'en')).rejects.toMatchObject({ status: 404 });
  });
});

describe('admin workshops', () => {
  it('refuses a duplicate slug, a PIN outside MechDost, a foreign city and a published unverified workshop', async () => {
    await expect(addWorkshop(db, f, { slug: W.near!.slug })).rejects.toMatchObject({ code: 'SLUG_TAKEN' });
    await expect(addWorkshop(db, f, { pincode: '110001' })).rejects.toMatchObject({
      code: 'PINCODE_NOT_SERVED',
    });
    await expect(addWorkshop(db, f, { published: true, locationVerified: false })).rejects.toMatchObject({
      code: 'CHECK_VIOLATION',
    });
    const bhilaiOnly = { all: false as const, cityIds: [f.bhilai] };
    await expect(getAdminWorkshop(t(), bhilaiOnly, W.near!.id)).rejects.toMatchObject({ status: 404 });
    expect(await listAdminWorkshops(t(), bhilaiOnly)).toEqual([]);
  });

  it('edits with compare-and-set; moving the pin un-verifies and unpublishes; the menu is replaced by key', async () => {
    const before = await getAdminWorkshop(t(), { all: true }, W.far!.id);
    expect(before.missingHindi).toEqual([]);
    const saved = await updateWorkshop(t(), {
      scope: { all: true },
      staffUserId: f.staff,
      workshopId: W.far!.id,
      patch: {
        version: before.version,
        lat: 21.18,
        lng: 81.62,
        gstin: '22AAAAA0000A1Z5',
        menu: [{ ...MENU[0]!, title: 'Inspection', titleHi: null }],
      },
    });
    const after = await getAdminWorkshop(t(), { all: true }, W.far!.id);
    expect(after).toMatchObject({ locationVerified: false, published: false, gstRegistered: true });
    expect(after.version).toBe(saved.version);
    expect(after.menu.map((m) => [m.key, m.active])).toEqual([
      ['diagnosis', true],
      ['routine2w', false],
    ]);
    expect(after.missingHindi).toEqual(['menu.diagnosis.title']);
    await expect(
      updateWorkshop(t(), {
        scope: { all: true },
        staffUserId: f.staff,
        workshopId: W.far!.id,
        patch: { version: before.version, name: 'Stale' },
      }),
    ).rejects.toMatchObject({ code: 'STALE_WORKSHOP' });
  });

  it('keeps standing history and refuses the same standing twice', async () => {
    const rows = await db
      .select()
      .from(s.partnerStatusEvents)
      .where(
        and(
          eq(s.partnerStatusEvents.partnerKind, 'workshop'),
          eq(s.partnerStatusEvents.partnerId, W.paused!.id),
        ),
      );
    expect(rows).toEqual([expect.objectContaining({ fromStatus: 'approved', toStatus: 'paused' })]);
    const w = await getAdminWorkshop(t(), { all: true }, W.paused!.id);
    await expect(
      setWorkshopStanding(t(), {
        scope: { all: true },
        staffUserId: f.staff,
        workshopId: W.paused!.id,
        status: 'paused',
        reason: 'Again please',
        expectedVersion: w.version,
      }),
    ).rejects.toMatchObject({ code: 'SAME_STANDING' });
  });

  it('gives a signed-up person workshop access by phone; an unknown phone is 404', async () => {
    await addWorkshopMember(t(), {
      scope: { all: true },
      staffUserId: f.staff,
      workshopId: W.near!.id,
      phone: '+919811100002',
      role: 'workshop_owner',
    });
    const grants = await loadGrants(t(), f.other);
    expect(workshopIdsFrom(grants, 'service:work')).toEqual([W.near!.id]);
    await expect(
      addWorkshopMember(t(), {
        scope: { all: true },
        staffUserId: f.staff,
        workshopId: W.near!.id,
        phone: '+919811177777',
        role: 'workshop_staff',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
