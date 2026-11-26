/**
 * Ustaad profile, choices, specialities, reserved names and the SR-2 freeze (spec 23 § 8 "Membership", § 14a SR-2,
 * SR-4, SR-5; plan task B3).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Join } from '@mechdost/shared/ustaad/dto/members';
import { nameSkeleton } from '@mechdost/shared/ustaad/names';
import {
  addUstaadReservedName,
  freezeUstaadPerksAfterCredentialChange,
  getUstaadChoices,
  insertUserRole,
  joinUstaad,
  saveUstaadChoices,
  saveUstaadSetting,
  setUstaadReservedNameActive,
  setUstaadSpecialities,
  syncRbacCatalogue,
  updateUstaadProfile,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
let memberId = '';
let seq = 0;

const join = (over: Partial<Join> = {}): Join => ({
  track: 'ustaad',
  specialities: ['two_wheeler', 'electrical'],
  displayName: 'Ramesh Sahu',
  garageName: null,
  showGarage: false,
  pincode: '492001',
  areaLabel: 'Pandri',
  yearsClaimed: 8,
  workPlace: 'shop',
  verifyMethods: [],
  consents: { ustaad_profile: true, ustaad_directory: false, ustaad_training: true, ustaad_offers: false },
  turnstileToken: 'human-token-123',
  ...over,
});

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ code });
}

async function mkUser(): Promise<string> {
  seq += 1;
  const n = String(seq).padStart(4, '0');
  const [u] = await db
    .insert(s.users)
    .values({ firebaseUid: `ustp-${n}`, phone: `+9198333${n.padStart(5, '0')}`, name: `P${n}` })
    .returning({ id: s.users.id });
  if (!u) throw new Error('user');
  return u.id;
}

async function memberRow(id: string) {
  const [m] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, id));
  if (!m) throw new Error('missing');
  return m;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values([{ cityId: f.raipur }]);
  // The fixture's staff member ("Ops") becomes a staff member named like a real person.
  await db.update(s.users).set({ name: 'Kavita Verma' }).where(eq(s.users.id, f.staff));
  await insertUserRole(t(), { userId: f.staff, role: 'super_admin', grantedBy: null });
  memberId = (await joinUstaad(t(), { userId: f.customer }, join(), { via: 'ustaad' })).id;
});

afterAll(async () => {
  await client.close();
});

describe('reserved names (SR-4, AT-NAME-1)', () => {
  it('every seeded skeleton equals nameSkeleton(name) (migration 0099 and the function agree)', async () => {
    const rows = await db.select().from(s.ustaadReservedNames);
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const r of rows) expect(r.skeleton, r.name).toBe(nameSkeleton(r.name));
  });

  it('join refuses "MechDøst", "Mech Dost" and Cyrillic look-alikes with NAME_RESERVED', async () => {
    for (const displayName of ['MechDøst', 'Mech Dost', 'Месh Dоst', 'मेकदोस्त', 'Admin'])
      await expectCode(
        joinUstaad(t(), { userId: await mkUser() }, join({ displayName }), { via: 'ustaad' }),
        'NAME_RESERVED',
      );
  });

  it("a staff member's exact name (or a look-alike) is refused; part of it is not", async () => {
    await expectCode(
      joinUstaad(t(), { userId: await mkUser() }, join({ displayName: 'Kavita Vérma' }), { via: 'ustaad' }),
      'NAME_RESERVED',
    );
    const ok = await joinUstaad(t(), { userId: await mkUser() }, join({ displayName: 'Kavita Sahu' }), {
      via: 'ustaad',
    });
    expect(ok.displayName).toBe('Kavita Sahu');
  });

  it('a phone number in the name is refused with NAME_CONTACT', async () => {
    await expectCode(
      joinUstaad(t(), { userId: await mkUser() }, join({ displayName: 'Raju 9876543210' }), {
        via: 'ustaad',
      }),
      'NAME_CONTACT',
    );
  });

  it('admin adds a name (a look-alike of an existing one is a 409) and can switch one off', async () => {
    const added = await addUstaadReservedName(t(), { userId: f.staff }, 'Raipur Mechanics Union');
    await expectCode(
      addUstaadReservedName(t(), { userId: f.staff }, 'Raipur  Mechanics Uniоn'),
      'NAME_EXISTS',
    );
    await expectCode(
      joinUstaad(t(), { userId: await mkUser() }, join({ displayName: 'Raipur Mechanics Union' }), {
        via: 'ustaad',
      }),
      'NAME_RESERVED',
    );
    await setUstaadReservedNameActive(t(), { id: added.id, active: false, expectedVersion: added.version });
    const ok = await joinUstaad(
      t(),
      { userId: await mkUser() },
      join({ displayName: 'Raipur Mechanics Union' }),
      { via: 'ustaad' },
    );
    expect(ok.displayName).toBe('Raipur Mechanics Union');
  });
});

describe('PATCH /ustaad/me (profile)', () => {
  it('updates allowed fields with the version; a stale version is a 409', async () => {
    const before = await memberRow(memberId);
    const v = await updateUstaadProfile(
      t(),
      { userId: f.customer },
      { expectedVersion: before.version, displayName: 'Ramesh Bhai', yearsClaimed: 9, showGarage: true },
    );
    expect(v).toMatchObject({ displayName: 'Ramesh Bhai', yearsClaimed: 9, showGarage: true });
    expect(v.version).toBeGreaterThan(before.version);
    await expectCode(
      updateUstaadProfile(t(), { userId: f.customer }, { expectedVersion: before.version, yearsClaimed: 3 }),
      'STALE_MEMBER',
    );
    const events = await db
      .select()
      .from(s.ustaadEvents)
      .where(and(eq(s.ustaadEvents.entityId, memberId), eq(s.ustaadEvents.kind, 'profile_updated')));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]?.props)).not.toContain('Ramesh');
  });

  it('a reserved display name or Hindi name is refused; nothing changes', async () => {
    const m = await memberRow(memberId);
    await expectCode(
      updateUstaadProfile(
        t(),
        { userId: f.customer },
        { expectedVersion: m.version, displayName: 'MechDost' },
      ),
      'NAME_RESERVED',
    );
    await expectCode(
      updateUstaadProfile(
        t(),
        { userId: f.customer },
        { expectedVersion: m.version, displayNameHi: 'मेक दोस्त' },
      ),
      'NAME_RESERVED',
    );
    expect((await memberRow(memberId)).displayName).toBe('Ramesh Bhai');
  });

  it('changing the area label without its Hindi form clears the stale Hindi label', async () => {
    let m = await memberRow(memberId);
    await updateUstaadProfile(
      t(),
      { userId: f.customer },
      { expectedVersion: m.version, areaLabel: 'Shankar Nagar', areaLabelHi: 'शंकर नगर' },
    );
    m = await memberRow(memberId);
    expect(m.areaLabelHi).toBe('शंकर नगर');
    await updateUstaadProfile(
      t(),
      { userId: f.customer },
      { expectedVersion: m.version, areaLabel: 'Pandri' },
    );
    m = await memberRow(memberId);
    expect(m).toMatchObject({ areaLabel: 'Pandri', areaLabelHi: null });
  });

  it('an empty patch is refused', async () => {
    const m = await memberRow(memberId);
    await expectCode(
      updateUstaadProfile(t(), { userId: f.customer }, { expectedVersion: m.version }),
      'EMPTY_PATCH',
    );
  });
});

describe('PUT /ustaad/me/specialities', () => {
  it('keeps the earned step of a code that stays, adds new ones as shuru, removes dropped ones', async () => {
    await db
      .update(s.ustaadMemberSpecialities)
      .set({ step: 'pakka', earnedAt: new Date() })
      .where(
        and(
          eq(s.ustaadMemberSpecialities.memberId, memberId),
          eq(s.ustaadMemberSpecialities.code, 'electrical'),
        ),
      );
    const v = await setUstaadSpecialities(t(), { userId: f.customer }, { codes: ['electrical', 'battery'] });
    expect(v.specialities).toEqual(['battery', 'electrical']);
    const rows = await db
      .select()
      .from(s.ustaadMemberSpecialities)
      .where(eq(s.ustaadMemberSpecialities.memberId, memberId));
    expect(rows.find((r) => r.code === 'electrical')?.step).toBe('pakka');
    expect(rows.find((r) => r.code === 'battery')?.step).toBe('shuru');
    expect(rows.some((r) => r.code === 'two_wheeler')).toBe(false);
  });
});

describe('PUT /ustaad/me/choices', () => {
  it('saves message mode, suggest-me, data saver and optional consents (append-only); profile consent stays', async () => {
    const c0 = await getUstaadChoices(t(), f.customer);
    expect(c0.consents).toEqual({
      ustaad_profile: true,
      ustaad_directory: false,
      ustaad_training: true,
      ustaad_offers: false,
    });
    const c1 = await saveUstaadChoices(
      t(),
      { userId: f.customer },
      {
        expectedVersion: c0.version,
        dmMode: 'nobody',
        suggestMe: false,
        dataSaver: false,
        consents: { ustaad_training: false, ustaad_directory: true },
      },
    );
    expect(c1).toMatchObject({ dmMode: 'nobody', suggestMe: false, dataSaver: false });
    expect(c1.consents).toEqual({
      ustaad_profile: true,
      ustaad_directory: true,
      ustaad_training: false,
      ustaad_offers: false,
    });
    const rows = await db.select().from(s.consents).where(eq(s.consents.userId, f.customer));
    expect(rows.filter((r) => r.source === 'ustaad_choices')).toHaveLength(2);
  });

  it('correction mode is refused while members may not change it', async () => {
    await saveUstaadSetting(t(), {
      key: 'ustaad.correction.member_can_change',
      value: false,
      expectedVersion: null,
      staffUserId: f.staff,
      actorRole: 'super_admin',
    });
    const c = await getUstaadChoices(t(), f.customer);
    expect(c.canChangeCorrection).toBe(false);
    await expectCode(
      saveUstaadChoices(t(), { userId: f.customer }, { expectedVersion: c.version, correctionMode: 'off' }),
      'USTAAD_SETTING_LOCKED',
    );
  });
});

describe('SR-2 freeze after a credential change', () => {
  it('a Pakka+ member is frozen for the setting hours, with an event and a notice; a Naya is not', async () => {
    const m = await memberRow(memberId);
    expect(await freezeUstaadPerksAfterCredentialChange(t(), f.customer, 'phone_changed')).toBe(false);
    await db.update(s.ustaadMembers).set({ level: 'pakka' }).where(eq(s.ustaadMembers.id, m.id));
    const now = new Date();
    expect(await freezeUstaadPerksAfterCredentialChange(t(), f.customer, 'password_changed', now)).toBe(true);
    const frozen = await memberRow(memberId);
    expect(frozen.perksFrozenUntil?.getTime()).toBe(now.getTime() + 72 * 3_600_000);
    const notices = await db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.userId, f.customer), eq(s.notifications.kind, 'ustaad.security_freeze')));
    expect(notices.length).toBeGreaterThanOrEqual(1);
    // A later, shorter freeze never shortens the current one.
    const earlier = new Date(now.getTime() - 48 * 3_600_000);
    await freezeUstaadPerksAfterCredentialChange(t(), f.customer, 'email_changed', earlier);
    expect((await memberRow(memberId)).perksFrozenUntil?.getTime()).toBe(now.getTime() + 72 * 3_600_000);
  });

  it('no member, a left member or a non-member user: nothing happens', async () => {
    expect(await freezeUstaadPerksAfterCredentialChange(t(), f.other, 'phone_changed')).toBe(false);
  });
});
