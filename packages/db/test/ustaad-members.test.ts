/**
 * Ustaad membership and settings repositories (spec 23 § 4 flow 1, § 15; plan task A3): join, region, rejoin after
 * leave (review focus 3), disabled city (review focus 4), settings with invariants and the access switch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { Join } from '@mechdost/shared/ustaad/dto/members';
import {
  joinUstaad,
  leaveUstaad,
  loadGrants,
  readUstaadAccess,
  readUstaadSettings,
  saveUstaadSetting,
  syncRbacCatalogue,
  ustaadMemberOfUser,
  ustaadRegionFor,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;

const join = (over: Partial<Join> = {}): Join => ({
  track: 'ustaad',
  specialities: ['two_wheeler', 'electrical'],
  displayName: 'Ramesh Sahu',
  garageName: 'Sahu Auto Works',
  showGarage: false,
  pincode: '492001',
  areaLabel: 'Pandri',
  yearsClaimed: 8,
  workPlace: 'shop',
  verifyMethods: ['owner'],
  consents: { ustaad_profile: true, ustaad_directory: false, ustaad_training: true, ustaad_offers: false },
  turnstileToken: 'human-token-123',
  ...over,
});

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values([{ cityId: f.raipur }, { cityId: f.bhilai, enabled: false }]);
});

afterAll(async () => {
  await client.close();
});

describe('region (SR-46)', () => {
  it('a PIN in an enabled city returns that city; an unknown PIN (Nagpur) and a disabled city return null', async () => {
    expect(await ustaadRegionFor(t(), { pincode: '492001' })).toBe(f.raipur);
    expect(await ustaadRegionFor(t(), { pincode: '440001' })).toBeNull();
    expect(await ustaadRegionFor(t(), { pincode: '490001' })).toBeNull();
  });
});

describe('join', () => {
  it('creates an Ustaad · to verify member with a verification request, specialities, counters, consents and the mechanic grant', async () => {
    const m = await joinUstaad(t(), { userId: f.customer }, join(), { via: 'ustaad' });
    expect(m).toMatchObject({
      track: 'ustaad',
      level: 'ustaad_pending',
      status: 'active',
      verificationState: 'pending_verification',
      cityCode: 'RPR',
      specialities: ['electrical', 'two_wheeler'],
      showGarage: false,
      dmMode: 'request',
    });
    expect(m.handle).toMatch(/^[a-z0-9_]{3,24}$/);
    expect(JSON.stringify(m)).not.toContain('+91');
    const grants = await loadGrants(t(), f.customer);
    expect(grants.map((g) => g.role)).toContain('mechanic');
    expect(grants.find((g) => g.role === 'mechanic')?.permissions).toContain('ustaad:use');
    const [counters] = await db
      .select()
      .from(s.ustaadMemberCounters)
      .where(eq(s.ustaadMemberCounters.memberId, m.id));
    expect(counters?.followers).toBe(0);
    const consents = await db
      .select({ purpose: s.consents.purpose, granted: s.consents.granted })
      .from(s.consents)
      .where(eq(s.consents.userId, f.customer));
    expect(consents).toEqual(
      expect.arrayContaining([
        { purpose: 'ustaad_profile', granted: true },
        { purpose: 'ustaad_directory', granted: false },
        { purpose: 'ustaad_training', granted: true },
        { purpose: 'ustaad_offers', granted: false },
      ]),
    );
    const verifications = await db
      .select()
      .from(s.ustaadVerifications)
      .where(eq(s.ustaadVerifications.memberId, m.id));
    expect(verifications).toHaveLength(1);
    expect(verifications[0]?.proofKinds).toEqual(['owner']);
    const events = await db
      .select({ name: sql<string>`event` })
      .from(sql`events`)
      .where(sql`event = 'ustaad_joined'`);
    expect(events.length).toBe(1);
  });

  it('"Do it later" makes an unverified member; a Chhotu starts at apprentice', async () => {
    const m = await joinUstaad(
      t(),
      { userId: f.other },
      join({ track: 'apprentice', verifyMethods: [], displayName: 'Chhotu Ram' }),
      { via: 'partners_apply' },
    );
    expect(m).toMatchObject({ track: 'apprentice', level: 'apprentice', verificationState: 'unverified' });
  });

  it('joining twice is refused', async () => {
    await expectCode(
      joinUstaad(t(), { userId: f.customer }, join(), { via: 'ustaad' }),
      'USTAAD_ALREADY_MEMBER',
    );
  });

  it('a PIN outside the enabled cities is refused with USTAAD_REGION (AT-REGION-1)', async () => {
    await expectCode(
      joinUstaad(t(), { userId: f.staff }, join({ pincode: '440001' }), { via: 'ustaad' }),
      'USTAAD_REGION',
    );
    await expectCode(
      joinUstaad(t(), { userId: f.staff }, join({ pincode: '490001' }), { via: 'ustaad' }),
      'USTAAD_REGION',
    );
  });

  it('the certificate proof is refused while it is off', async () => {
    await expectCode(
      joinUstaad(t(), { userId: f.staff }, join({ verifyMethods: ['certificate'] }), { via: 'ustaad' }),
      'USTAAD_METHOD_OFF',
    );
  });
});

describe('rejoin after leave (review focus 3)', () => {
  it('keeps the handle, re-asks consents, never doubles counters, and removes then restores the grant', async () => {
    const before = await ustaadMemberOfUser(t(), f.customer);
    if (!before) throw new Error('member');
    await leaveUstaad(t(), { userId: f.customer });
    const left = await ustaadMemberOfUser(t(), f.customer);
    expect(left?.status).toBe('left');
    expect((await loadGrants(t(), f.customer)).map((g) => g.role)).not.toContain('mechanic');
    await expectCode(leaveUstaad(t(), { userId: f.customer }), 'NOT_FOUND');

    const again = await joinUstaad(t(), { userId: f.customer }, join({ displayName: 'Ramesh S' }), {
      via: 'ustaad',
    });
    expect(again.id).toBe(before.id);
    expect(again.handle).toBe(before.handle);
    expect(again.status).toBe('active');
    expect(again.displayName).toBe('Ramesh S');
    const counters = await db
      .select()
      .from(s.ustaadMemberCounters)
      .where(eq(s.ustaadMemberCounters.memberId, before.id));
    expect(counters).toHaveLength(1);
    const profileConsents = await db
      .select({ granted: s.consents.granted })
      .from(s.consents)
      .where(and(eq(s.consents.userId, f.customer), eq(s.consents.purpose, 'ustaad_profile')));
    // join (granted) → leave (withdrawn) → rejoin (granted again).
    expect(profileConsents.map((r) => r.granted)).toEqual([true, false, true]);
    expect((await loadGrants(t(), f.customer)).map((g) => g.role)).toContain('mechanic');
  });
});

describe('disabled city (review focus 4)', () => {
  it('members already in a city stay when it is switched off; new joins from it are refused', async () => {
    await db
      .update(s.ustaadReachCities)
      .set({ enabled: false })
      .where(eq(s.ustaadReachCities.cityId, f.raipur));
    expect((await ustaadMemberOfUser(t(), f.customer))?.status).toBe('active');
    await expectCode(joinUstaad(t(), { userId: f.staff }, join(), { via: 'ustaad' }), 'USTAAD_REGION');
    await db
      .update(s.ustaadReachCities)
      .set({ enabled: true })
      .where(eq(s.ustaadReachCities.cityId, f.raipur));
  });
});

describe('Ustaad settings (spec 23 § 15, SR-40)', () => {
  it('reads defaults; access is staff_preview until changed', async () => {
    expect(await readUstaadAccess(t())).toBe('staff_preview');
    const all = await readUstaadSettings(t());
    expect(all.values['ustaad.zones.hide_below']).toBe(5);
  });

  it('saves with compare-and-set and audits; access changes record an analytics event', async () => {
    const r = await saveUstaadSetting(t(), {
      key: 'ustaad.access',
      value: 'open',
      expectedVersion: null,
      staffUserId: f.staff,
      actorRole: 'super_admin',
    });
    expect(r.version).toBe(1);
    expect(await readUstaadAccess(t())).toBe('open');
    await expectCode(
      saveUstaadSetting(t(), {
        key: 'ustaad.access',
        value: 'off',
        expectedVersion: 7,
        staffUserId: f.staff,
        actorRole: 'super_admin',
      }),
      'STALE_SETTING',
    );
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'setting.saved'), eq(s.auditLog.entityId, 'ustaad.access')));
    expect(audit).toHaveLength(1);
    const ev = await db.execute(sql`select props from events where event = 'admin_ustaad_access_changed'`);
    expect(ev.rows).toHaveLength(1);
    await saveUstaadSetting(t(), {
      key: 'ustaad.access',
      value: 'staff_preview',
      expectedVersion: 1,
      staffUserId: f.staff,
      actorRole: 'super_admin',
    });
  });

  it('refuses a bad value (range/type) and a locked floor (invariant), and records the refusal', async () => {
    const base = { expectedVersion: null, staffUserId: f.staff, actorRole: 'super_admin' } as const;
    await expectCode(
      saveUstaadSetting(t(), { ...base, key: 'ustaad.access', value: 'everyone' }),
      'SETTING_RANGE',
    );
    await expectCode(
      saveUstaadSetting(t(), { ...base, key: 'ustaad.posts.max_photos', value: 'six' }),
      'SETTING_TYPE',
    );
    await expectCode(
      saveUstaadSetting(t(), { ...base, key: 'ustaad.zones.hide_below', value: 4 }),
      'SETTING_INVARIANT',
    );
    await expectCode(
      saveUstaadSetting(t(), { ...base, key: 'ustaad.feed.w_follows', value: 29 }),
      'SETTING_RELATION',
    );
    await expectCode(
      saveUstaadSetting(t(), { ...base, key: 'ustaad.correction.default_mode', value: 'auto' }),
      'SETTING_INVARIANT',
    );
    await expectCode(
      saveUstaadSetting(t(), {
        ...base,
        key: 'ustaad.posts.video_max_s',
        value: 240,
        actorRole: 'community_manager',
      }),
      'SETTING_INVARIANT',
    );
    const ok = await saveUstaadSetting(t(), {
      ...base,
      key: 'ustaad.posts.video_max_s',
      value: 240,
      reasonCode: 'training_content',
    });
    expect(ok.version).toBe(1);
    const refused = await db.execute(
      sql`select count(*)::int as n from events where event = 'admin_ustaad_invariant_refused'`,
    );
    expect((refused.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(4);
  });
});
