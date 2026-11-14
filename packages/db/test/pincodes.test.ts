/**
 * Service-area PIN codes (spec 15 "PIN codes", 2026-11-14): admin add / edit / switch off with compare-and-set and
 * audit, an inactive PIN is not serviceable (checkout, nearby workshops, service requests, shop coverage), the
 * per-PIN free-delivery threshold (spec 03 "Delivery charges"), and the idempotent reference-data upsert that
 * never deletes and never overrides an admin's change. Runs on the Raipur demo catalogue.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import { upsertPincodes, type PincodeSeedFile } from '../src/pincodes-seed';
import {
  addPincode,
  defaultCoverage,
  findNearbyWorkshops,
  listActivePincodes,
  listCityPincodes,
  quoteCheckout,
  setPincodeActive,
  updatePincode,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const pinFile = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-pincodes.json', import.meta.url)), 'utf8'),
) as PincodeSeedFile;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let raipur = '';
let bilaspur = '';

const OIL = 'CAS-ACT4T-0900'; // ₹440 at the nearest shop, ₹40 delivery

const pin = async (pincode: string) =>
  (await db.select().from(s.pincodes).where(eq(s.pincodes.pincode, pincode)))[0]!;
const audits = async (pincode: string) =>
  db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.entity, 'pincode'), eq(s.auditLog.entityId, pincode)));

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  raipur = (await db.select().from(s.cities).where(eq(s.cities.code, 'RPR')))[0]!.id;
  const [state] = await db.select().from(s.states).where(eq(s.states.code, 'CG'));
  bilaspur = (
    await db
      .insert(s.cities)
      .values({
        stateId: state!.id,
        code: 'BSP',
        slug: 'bilaspur',
        name: 'Bilaspur',
        status: 'live',
        centroid: { lng: 82.15, lat: 22.08 },
      })
      .returning()
  )[0]!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-pincode-admin' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

describe('admin: add, edit, switch off', () => {
  it('adds a PIN with its centroid and both area names, audited, as an admin row', async () => {
    const r = await addPincode(t(), {
      cityId: raipur,
      pincode: '492015',
      lat: 21.2003,
      lng: 81.6981,
      areaEn: 'Tikrapara',
      areaHi: 'टिकरापारा',
      freeDeliveryMinPaise: null,
      staffUserId: staff,
    });
    expect(r).toEqual({ pincode: '492015', version: 1 });
    const row = await pin('492015');
    expect(row).toMatchObject({
      cityId: raipur,
      locality: 'Tikrapara',
      localityHi: 'टिकरापारा',
      active: true,
      source: 'admin',
    });
    const [a] = await audits('492015');
    expect(a).toMatchObject({ action: 'pincode.added', actorUserId: staff, actorRole: 'staff' });
  });

  it('refuses a duplicate, a malformed PIN, coordinates outside India or far from the city', async () => {
    const base = {
      cityId: raipur,
      lat: 21.25,
      lng: 81.63,
      areaEn: 'Somewhere',
      areaHi: 'कहीं',
      freeDeliveryMinPaise: null,
      staffUserId: staff,
    };
    await expect(addPincode(t(), { ...base, pincode: '492015' })).rejects.toMatchObject({
      code: 'PINCODE_EXISTS',
    });
    await expect(addPincode(t(), { ...base, pincode: '092015' })).rejects.toMatchObject({
      code: 'PINCODE_INVALID',
    });
    // Latitude and longitude swapped.
    await expect(
      addPincode(t(), { ...base, pincode: '492016', lat: 81.63, lng: 21.25 }),
    ).rejects.toMatchObject({ code: 'PINCODE_OUTSIDE_INDIA' });
    // Delhi's coordinates under a Raipur PIN.
    await expect(
      addPincode(t(), { ...base, pincode: '492016', lat: 28.63, lng: 77.22 }),
    ).rejects.toMatchObject({ code: 'PINCODE_FAR_FROM_CITY' });
    await expect(addPincode(t(), { ...base, pincode: '492016', areaHi: ' ' })).rejects.toMatchObject({
      code: 'PINCODE_AREA',
    });
  });

  it('edits the centroid, names and free-delivery threshold with compare-and-set; admin rows only', async () => {
    const before = await pin('492015');
    await expect(
      updatePincode(t(), {
        cityId: raipur,
        pincode: '492015',
        expectedVersion: before.version + 1,
        centroid: { lat: 21.201, lng: 81.699 },
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'STALE_PINCODE' });
    const r = await updatePincode(t(), {
      cityId: raipur,
      pincode: '492015',
      expectedVersion: before.version,
      centroid: { lat: 21.201, lng: 81.699 },
      area: { en: 'Tikrapara Chowk', hi: 'टिकरापारा चौक' },
      freeDeliveryMinPaise: 30000,
      staffUserId: staff,
    });
    expect(r.version).toBe(before.version + 1);
    expect(await pin('492015')).toMatchObject({
      locality: 'Tikrapara Chowk',
      localityHi: 'टिकरापारा चौक',
      freeDeliveryMinPaise: 30000,
    });
    expect((await audits('492015')).map((a) => a.action)).toContain('pincode.updated');
  });

  it("another city's PIN is not found (city scope), an unknown PIN too", async () => {
    const v = (await pin('492015')).version;
    await expect(
      updatePincode(t(), {
        cityId: bilaspur,
        pincode: '492015',
        expectedVersion: v,
        freeDeliveryMinPaise: 0,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      setPincodeActive(t(), {
        cityId: raipur,
        pincode: '400001',
        expectedVersion: 1,
        active: true,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('switches off with a reason code (and note), back on clears them; both audited', async () => {
    const v = (await pin('492015')).version;
    await expect(
      setPincodeActive(t(), {
        cityId: raipur,
        pincode: '492015',
        expectedVersion: v,
        active: false,
        reason: null,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'PINCODE_REASON' });
    const off = await setPincodeActive(t(), {
      cityId: raipur,
      pincode: '492015',
      expectedVersion: v,
      active: false,
      reason: 'no_partners',
      note: 'No shop here yet',
      staffUserId: staff,
    });
    expect(await pin('492015')).toMatchObject({
      active: false,
      inactiveReason: 'no_partners',
      inactiveNote: 'No shop here yet',
    });
    await setPincodeActive(t(), {
      cityId: raipur,
      pincode: '492015',
      expectedVersion: off.version,
      active: true,
      staffUserId: staff,
    });
    expect(await pin('492015')).toMatchObject({ active: true, inactiveReason: null, inactiveNote: null });
    const actions = (await audits('492015')).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['pincode.deactivated', 'pincode.activated']));
  });

  it('the database refuses an inactive row without a reason and a Hindi name without the English one', async () => {
    await expect(
      db.update(s.pincodes).set({ active: false }).where(eq(s.pincodes.pincode, '492015')),
    ).rejects.toThrow();
    await expect(
      db.update(s.pincodes).set({ locality: null }).where(eq(s.pincodes.pincode, '492015')),
    ).rejects.toThrow();
    await expect(
      db.update(s.pincodes).set({ freeDeliveryMinPaise: -1 }).where(eq(s.pincodes.pincode, '492015')),
    ).rejects.toThrow();
  });
});

describe('lists', () => {
  it("lists a city's PIN codes with names, centroid, state and how many shops cover each", async () => {
    const { city, pincodes: rows } = await listCityPincodes(t(), raipur);
    expect(city).toEqual({ code: 'RPR', name: 'Raipur', nameHi: 'रायपुर' });
    expect(rows.map((r) => r.pincode)).toEqual([...rows.map((r) => r.pincode)].sort());
    const covered = rows.find((r) => r.pincode === '492004');
    expect(covered?.shopsCovering).toBeGreaterThan(0);
    expect(covered?.lat).toBeCloseTo(21.26, 1);
    expect(rows.find((r) => r.pincode === '492015')).toMatchObject({
      areaEn: 'Tikrapara Chowk',
      active: true,
    });
    expect((await listCityPincodes(t(), bilaspur)).pincodes).toEqual([]);
  });

  it('the public list has active PINs of a live city only, names in the requested language', async () => {
    const v = (await pin('492015')).version;
    await setPincodeActive(t(), {
      cityId: raipur,
      pincode: '492015',
      expectedVersion: v,
      active: false,
      reason: 'not_launched_yet',
      staffUserId: staff,
    });
    const hi = await listActivePincodes(t(), 'RPR', 'hi');
    expect(hi.map((p) => p.pincode)).not.toContain('492015');
    expect(hi.length).toBeGreaterThan(0);
    await db.update(s.cities).set({ status: 'coming_soon' }).where(eq(s.cities.id, bilaspur));
    await expect(listActivePincodes(t(), 'BSP', 'en')).rejects.toMatchObject({ status: 404 });
    await expect(listActivePincodes(t(), 'XXX', 'en')).rejects.toMatchObject({ status: 404 });
  });
});

describe('an inactive PIN is not serviceable', () => {
  it('checkout, nearby workshops and default shop coverage refuse or skip it', async () => {
    const v = (await pin('492004')).version;
    const off = await setPincodeActive(t(), {
      cityId: raipur,
      pincode: '492004',
      expectedVersion: v,
      active: false,
      reason: 'operational_pause',
      staffUserId: staff,
    });
    await expect(
      quoteCheckout(t(), { pincode: '492004', lines: [{ sku: OIL, qty: 1 }], locale: 'en' }),
    ).rejects.toMatchObject({ code: 'PINCODE_NOT_SERVICEABLE' });
    await expect(
      findNearbyWorkshops(t(), { at: { pincode: '492004' }, radiusKm: 10, locale: 'en' }),
    ).rejects.toMatchObject({ code: 'PINCODE_UNKNOWN' });
    const coverage = await defaultCoverage(t(), '492001');
    expect(coverage.map((c) => c.pincode)).not.toContain('492004');
    expect(coverage.map((c) => c.pincode)).toContain('492001');
    await setPincodeActive(t(), {
      cityId: raipur,
      pincode: '492004',
      expectedVersion: off.version,
      active: true,
      staffUserId: staff,
    });
    const q = await quoteCheckout(t(), { pincode: '492004', lines: [{ sku: OIL, qty: 1 }], locale: 'en' });
    expect(q.groups.length).toBe(1);
  });
});

describe('free delivery per PIN (spec 03 "Delivery charges")', () => {
  const setPinMin = async (value: number | null) => {
    const v = (await pin('492004')).version;
    await updatePincode(t(), {
      cityId: raipur,
      pincode: '492004',
      expectedVersion: v,
      freeDeliveryMinPaise: value,
      staffUserId: staff,
    });
  };
  const shipping = async (qty: number) =>
    (await quoteCheckout(t(), { pincode: '492004', lines: [{ sku: OIL, qty }], locale: 'en' })).shippingPaise;

  it('0 = always free; a threshold applies to the group subtotal; NULL falls back to the city setting', async () => {
    await setPinMin(0);
    expect(await shipping(1)).toBe(0);
    await setPinMin(80000); // ₹800: one ₹440 oil pays delivery, two (₹880) ship free
    expect(await shipping(1)).toBe(4000);
    expect(await shipping(2)).toBe(0);
    // The PIN value wins over the city setting in both directions.
    await db.insert(s.settings).values({ key: 'checkout.free_delivery_min_paise', value: 40000 });
    expect(await shipping(1)).toBe(4000);
    await setPinMin(null);
    expect(await shipping(1)).toBe(0); // city ₹400 threshold now applies
    await db.delete(s.settings).where(eq(s.settings.key, 'checkout.free_delivery_min_paise'));
    expect(await shipping(1)).toBe(4000); // no threshold anywhere
  });
});

describe('reference data upsert (pnpm db:seed:pincodes)', () => {
  it('adds every PIN of the file, refreshes untouched seed rows, keeps admin rows and active flags', async () => {
    // A demo row an admin never touched (no names yet) and one an admin changed.
    const r1 = await upsertPincodes(t(), pinFile);
    expect(r1.inserted).toBeGreaterThan(0);
    const total = pinFile.pincodes.length;
    expect(r1.inserted + r1.refreshed + r1.unchanged + r1.keptAdmin).toBe(total);
    const p492001 = await pin('492001');
    const from = pinFile.pincodes.find((p) => p.pincode === '492001')!;
    expect(p492001).toMatchObject({ locality: from.areaEn, localityHi: from.areaHi, source: 'seed' });
    // 492015 was added by an admin: names and active flag are theirs.
    const p492015 = await pin('492015');
    expect(p492015).toMatchObject({ source: 'admin', locality: 'Tikrapara Chowk', active: false });
    // Inactive rows of the file come in switched off with their reason.
    const off = pinFile.pincodes.find((p) => !p.active);
    if (off) {
      const row = await pin(off.pincode);
      if (row.source === 'seed') expect(row).toMatchObject({ active: false, inactiveReason: off.reason });
    }
    // Idempotent: a second run changes nothing (no version churn).
    const versions = new Map((await db.select().from(s.pincodes)).map((r) => [r.pincode, r.version]));
    const r2 = await upsertPincodes(t(), pinFile);
    expect(r2).toMatchObject({ inserted: 0, refreshed: 0 });
    for (const r of await db.select().from(s.pincodes)) expect(r.version).toBe(versions.get(r.pincode));
  });

  it('never switches an existing PIN on or off and never deletes', async () => {
    const before = await db.select().from(s.pincodes);
    const v = (await pin('492001')).version;
    await db
      .update(s.pincodes)
      .set({ active: false, inactiveReason: 'operational_pause' })
      .where(and(eq(s.pincodes.pincode, '492001'), eq(s.pincodes.version, v)));
    await upsertPincodes(t(), { ...pinFile, pincodes: pinFile.pincodes.slice(0, 2) });
    expect((await pin('492001')).active).toBe(false);
    expect((await db.select().from(s.pincodes)).length).toBe(before.length);
  });

  it('refuses a file with a bad row before writing anything', async () => {
    const bad = { ...pinFile, pincodes: [{ ...pinFile.pincodes[0]!, pincode: '12345' }] };
    await expect(upsertPincodes(t(), bad)).rejects.toThrow(/PIN/);
  });
});
