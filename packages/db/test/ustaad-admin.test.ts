/**
 * Admin → Ustaad settings and tables (spec 23 § 15, SR-8, SR-40, SR-41; task G1): a batch save checks the invariants
 * on the merged set once, compare-and-sets every key in one transaction (all or nothing) and writes one audit row per
 * key; the tables refuse what their CHECKs would refuse with typed errors, never a database error.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  createUstaadBadge,
  createUstaadCoachmark,
  createUstaadLevelRule,
  listUstaadLevelRules,
  createUstaadPromotion,
  createUstaadReason,
  createUstaadTag,
  createUstaadTutorialCard,
  createUstaadWord,
  joinUstaad,
  listUstaadReachCities,
  listUstaadReasons,
  listUstaadTags,
  mergeUstaadTag,
  moveUstaadPromotion,
  readUstaadSettings,
  saveUstaadSettings,
  setUstaadReachCity,
  syncRbacCatalogue,
  updateUstaadLevelRule,
  updateUstaadReason,
  updateUstaadTutorialCard,
  updateUstaadWord,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ code });
}

const staff = () => ({ staffUserId: f.staff, actorRole: 'super_admin' as const });

async function versionsOf(keys: string[]) {
  const view = await readUstaadSettings(t());
  return Object.fromEntries(keys.map((k) => [k, view.versions[k as keyof typeof view.versions] ?? null]));
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values({ cityId: f.raipur });
  // Migration `ustaad_identity_seed` (workstream B) seeds level rules, badges, tutorial cards and coach-marks; these
  // CRUD tests start from empty tables.
  await db.delete(s.ustaadLevelRules);
  await db.delete(s.ustaadBadges);
  await db.delete(s.ustaadTutorialCards);
  await db.delete(s.ustaadCoachmarks);
});

afterAll(async () => {
  await client.close();
});

describe('batch settings save', () => {
  it('saves linked keys together: two feed weights that only sum to 100 as a pair', async () => {
    const r = await saveUstaadSettings(t(), {
      ...staff(),
      changes: [
        { key: 'ustaad.feed.w_follows', value: 20, version: null },
        { key: 'ustaad.feed.w_city', value: 35, version: null },
      ],
    });
    expect(Object.keys(r.versions).sort()).toEqual(['ustaad.feed.w_city', 'ustaad.feed.w_follows']);
    const view = await readUstaadSettings(t());
    expect(view.values['ustaad.feed.w_follows']).toBe(20);
    expect(view.values['ustaad.feed.w_city']).toBe(35);
  });

  it('writes one setting.saved audit row per key and one saved event', async () => {
    const rows = await db
      .select()
      .from(s.auditLog)
      .where(sql`${s.auditLog.action} = 'setting.saved' and ${s.auditLog.entityId} like 'ustaad.feed.%'`);
    expect(rows.length).toBe(2);
    const events = await db.execute(
      sql`select props from events where event = 'admin_ustaad_settings_saved'`,
    );
    expect(events.rows.length).toBe(1);
  });

  it('moves hide_below and exact_from together; hide_below 4 is SETTING_INVARIANT and recorded', async () => {
    await saveUstaadSettings(t(), {
      ...staff(),
      changes: [
        { key: 'ustaad.zones.exact_from', value: 40, version: null },
        { key: 'ustaad.zones.hide_below', value: 30, version: null },
      ],
    });
    const v = await versionsOf(['ustaad.zones.hide_below']);
    await expectCode(
      saveUstaadSettings(t(), {
        ...staff(),
        changes: [
          { key: 'ustaad.zones.hide_below', value: 4, version: v['ustaad.zones.hide_below'] ?? null },
        ],
      }),
      'SETTING_INVARIANT',
    );
    const refused = await db.execute(
      sql`select 1 from events where event = 'admin_ustaad_invariant_refused'`,
    );
    expect(refused.rows.length).toBe(1);
  });

  it('a stale version in one change saves nothing (all or nothing)', async () => {
    const v = await versionsOf(['ustaad.feed.w_follows', 'ustaad.feed.w_city']);
    await expectCode(
      saveUstaadSettings(t(), {
        ...staff(),
        changes: [
          { key: 'ustaad.posts.per_day', value: 7, version: null },
          { key: 'ustaad.feed.w_follows', value: 25, version: (v['ustaad.feed.w_follows'] ?? 0) + 5 },
          { key: 'ustaad.feed.w_city', value: 30, version: v['ustaad.feed.w_city'] ?? null },
        ],
      }),
      'STALE_SETTING',
    );
    const view = await readUstaadSettings(t());
    expect(view.values['ustaad.posts.per_day']).toBe(20);
    expect(view.values['ustaad.feed.w_follows']).toBe(20);
  });

  it('a second "first save" of a key (version null) is STALE_SETTING, never a silent overwrite', async () => {
    const change = [{ key: 'ustaad.qa.best_per_week', value: 4, version: null }];
    await saveUstaadSettings(t(), { ...staff(), changes: change });
    await expectCode(
      saveUstaadSettings(t(), { ...staff(), changes: [{ ...change[0], value: 6 }] as typeof change }),
      'STALE_SETTING',
    );
    expect((await readUstaadSettings(t())).values['ustaad.qa.best_per_week']).toBe(4);
  });

  it('locked items are refused with SETTING_INVARIANT (AT-PROMO-1 label, AT-LEVEL-2 staff approval)', async () => {
    for (const key of [
      'ustaad.promo.label',
      'ustaad.verify.staff_final_approval',
      'ustaad.loc.distance_bands',
    ])
      await expectCode(
        saveUstaadSettings(t(), { ...staff(), changes: [{ key, value: 'x', version: null }] }),
        'SETTING_INVARIANT',
      );
    await expectCode(
      saveUstaadSettings(t(), {
        ...staff(),
        changes: [{ key: 'ustaad.general.mechanics_only', value: false, version: null }],
      }),
      'SETTING_INVARIANT',
    );
  });

  it('an unknown key is SETTING_UNKNOWN; a wrong type SETTING_TYPE; out of range SETTING_RANGE', async () => {
    await expectCode(
      saveUstaadSettings(t(), { ...staff(), changes: [{ key: 'ustaad.nope', value: 1, version: null }] }),
      'SETTING_UNKNOWN',
    );
    await expectCode(
      saveUstaadSettings(t(), {
        ...staff(),
        changes: [{ key: 'ustaad.posts.per_day', value: true, version: null }],
      }),
      'SETTING_TYPE',
    );
    await expectCode(
      saveUstaadSettings(t(), {
        ...staff(),
        changes: [{ key: 'ustaad.posts.per_day', value: 500, version: null }],
      }),
      'SETTING_RANGE',
    );
  });

  it('video above 180 s: refused for a community manager and without a reason; a super admin with one saves and the reason is audited', async () => {
    const change = [{ key: 'ustaad.posts.video_max_s', value: 240, version: null }];
    await expectCode(
      saveUstaadSettings(t(), {
        staffUserId: f.staff,
        actorRole: 'community_manager',
        reasonCode: 'pilot',
        changes: change,
      }),
      'SETTING_INVARIANT',
    );
    await expectCode(saveUstaadSettings(t(), { ...staff(), changes: change }), 'SETTING_INVARIANT');
    await saveUstaadSettings(t(), { ...staff(), reasonCode: 'pilot', changes: change });
    const [row] = await db
      .select()
      .from(s.auditLog)
      .where(sql`${s.auditLog.entityId} = 'ustaad.posts.video_max_s'`);
    expect(row?.reason).toBe('pilot');
  });

  it('after a raise, saving another key needs no reason (the rule is not sticky)', async () => {
    await saveUstaadSettings(t(), {
      ...staff(),
      changes: [{ key: 'ustaad.posts.max_photos', value: 5, version: null }],
    });
    expect((await readUstaadSettings(t())).values['ustaad.posts.max_photos']).toBe(5);
  });

  it('auto correction needs an active protected word', async () => {
    await expectCode(
      saveUstaadSettings(t(), {
        ...staff(),
        changes: [{ key: 'ustaad.correction.default_mode', value: 'auto', version: null }],
      }),
      'SETTING_INVARIANT',
    );
  });
});

describe('word lists', () => {
  it('stores the normalised phrase; a duplicate in the same list is DUPLICATE', async () => {
    const w = await createUstaadWord(t(), f.staff, {
      list: 'protected',
      phrase: 'Splendor',
      lang: 'any',
      active: true,
    });
    expect(w.phrase).toBe('Splendor');
    await expectCode(
      createUstaadWord(t(), f.staff, { list: 'protected', phrase: '  SPLENDOR ', lang: 'any', active: true }),
      'DUPLICATE',
    );
  });

  it('the last active protected word cannot go while auto correction is on', async () => {
    await saveUstaadSettings(t(), {
      ...staff(),
      changes: [{ key: 'ustaad.correction.default_mode', value: 'auto', version: null }],
    });
    const [only] = await db.select().from(s.ustaadWordLists).where(eq(s.ustaadWordLists.list, 'protected'));
    if (!only) throw new Error('no word');
    await expectCode(
      updateUstaadWord(t(), f.staff, only.id, {
        phrase: only.phrase,
        lang: 'any',
        active: false,
        version: only.version,
      }),
      'SETTING_INVARIANT',
    );
  });

  it('a stale edit is STALE', async () => {
    const [only] = await db.select().from(s.ustaadWordLists).where(eq(s.ustaadWordLists.list, 'protected'));
    if (!only) throw new Error('no word');
    await expectCode(
      updateUstaadWord(t(), f.staff, only.id, {
        phrase: 'Splendor+',
        lang: 'any',
        active: true,
        version: only.version + 3,
      }),
      'STALE',
    );
  });
});

describe('level rules (SR-8)', () => {
  const rule = {
    level: 'bada' as const,
    ruleGroup: 'A',
    minFollowers: 50,
    minBestAnswers: 10,
    minHelpfulPct: 70,
    minVerifiedYears: 2,
    minVideos: 0,
    minRecommendations: 0,
    needsStaffReview: true,
    perkEn: '',
    perkHi: '',
    coinMultiplierBp: 10_000,
    nameEn: 'Bada Ustaad',
    nameHi: 'बड़ा उस्ताद',
    position: 4,
  };
  it('Bada without the staff review is SETTING_INVARIANT; with it saves; an edit turning it off too', async () => {
    await expectCode(
      createUstaadLevelRule(t(), f.staff, { ...rule, needsStaffReview: false }),
      'SETTING_INVARIANT',
    );
    const r = await createUstaadLevelRule(t(), f.staff, rule);
    await expectCode(
      updateUstaadLevelRule(t(), f.staff, r.id, { ...rule, needsStaffReview: false, version: r.version }),
      'SETTING_INVARIANT',
    );
    const u = await updateUstaadLevelRule(t(), f.staff, r.id, {
      ...rule,
      minFollowers: 60,
      version: r.version,
    });
    expect(u.minFollowers).toBe(60);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, r.id));
    expect(audit.map((a) => a.action).sort()).toEqual([
      'ustaad.level_rule.created',
      'ustaad.level_rule.updated',
    ]);
  });

  // Spec 23 § 9.2 / spec 20: money perks stay off until PENDING #19 (order-reward guard) is decided.
  it('a coin multiplier above 1× is COIN_GUARD_REQUIRED on create and on edit', async () => {
    await expectCode(
      createUstaadLevelRule(t(), f.staff, { ...rule, ruleGroup: 'C', coinMultiplierBp: 12_000 }),
      'COIN_GUARD_REQUIRED',
    );
    const [r] = await listUstaadLevelRules(t());
    if (!r) throw new Error('seed');
    await expectCode(
      updateUstaadLevelRule(t(), f.staff, r.id, { ...rule, coinMultiplierBp: 10_001, version: r.version }),
      'COIN_GUARD_REQUIRED',
    );
  });

  it('the same level and group twice is DUPLICATE', async () => {
    await expectCode(createUstaadLevelRule(t(), f.staff, rule), 'DUPLICATE');
  });
});

describe('report reasons', () => {
  it('the seed has every reason; "other" cannot be switched off; another one can', async () => {
    const reasons = await listUstaadReasons(t());
    expect(reasons.length).toBe(12); // 11 from 0093 + ncii_impersonation (0096, F2)
    const other = reasons.find((r) => r.code === 'other');
    if (!other) throw new Error('no other');
    await expectCode(
      updateUstaadReason(t(), f.staff, 'other', {
        labelEn: other.labelEn,
        labelHi: other.labelHi,
        active: false,
        defaultClock: 'standard_24h',
        version: other.version,
      }),
      'SETTING_INVARIANT',
    );
    const spam = reasons.find((r) => r.code === 'spam');
    if (!spam) throw new Error('no spam');
    const off = await updateUstaadReason(t(), f.staff, 'spam', {
      labelEn: spam.labelEn,
      labelHi: spam.labelHi,
      active: false,
      defaultClock: 'standard_24h',
      version: spam.version,
    });
    expect(off.active).toBe(false);
    await expectCode(
      createUstaadReason(t(), f.staff, {
        code: 'spam',
        labelEn: 'Spam',
        labelHi: 'स्पैम',
        active: true,
        defaultClock: 'standard_24h',
      }),
      'DUPLICATE',
    );
  });
});

describe('tags', () => {
  it('merge moves the follows and aliases to the target and retires the source', async () => {
    const member = await joinUstaad(
      t(),
      { userId: f.customer },
      {
        track: 'ustaad',
        specialities: ['two_wheeler'],
        displayName: 'Ramesh Sahu',
        garageName: null,
        showGarage: false,
        pincode: '492001',
        areaLabel: 'Pandri',
        yearsClaimed: 8,
        workPlace: 'shop',
        verifyMethods: [],
        consents: {
          ustaad_profile: true,
          ustaad_directory: false,
          ustaad_training: false,
          ustaad_offers: false,
        },
        turnstileToken: 'human-token-123',
      },
      { via: 'ustaad' },
    );
    const from = await createUstaadTag(t(), f.staff, {
      slug: 'battri',
      nameEn: 'Battri',
      nameHi: 'बैट्री',
      group: 'part',
      aliases: ['batri'],
      active: true,
    });
    const into = await createUstaadTag(t(), f.staff, {
      slug: 'battery',
      nameEn: 'Battery',
      nameHi: 'बैटरी',
      group: 'part',
      aliases: [],
      active: true,
    });
    await db.insert(s.ustaadTagFollows).values([
      { memberId: member.id, tagId: from.id },
      { memberId: member.id, tagId: into.id },
    ]);
    await expectCode(
      mergeUstaadTag(t(), f.staff, from.id, { intoId: from.id, version: from.version }),
      'TAG_MERGE',
    );
    await mergeUstaadTag(t(), f.staff, from.id, { intoId: into.id, version: from.version });
    const tags = await listUstaadTags(t());
    const merged = tags.find((x) => x.id === from.id);
    expect(merged).toMatchObject({ active: false, mergedIntoId: into.id });
    expect(tags.find((x) => x.id === into.id)?.aliases.sort()).toEqual(['batri', 'battri']);
    const follows = await db
      .select()
      .from(s.ustaadTagFollows)
      .where(eq(s.ustaadTagFollows.memberId, member.id));
    expect(follows.map((x) => x.tagId)).toEqual([into.id]);
    // Merging into a merged tag is refused.
    const third = await createUstaadTag(t(), f.staff, {
      slug: 'bttry',
      nameEn: 'Bttry',
      nameHi: 'बैटरी २',
      group: 'part',
      aliases: [],
      active: true,
    });
    await expectCode(
      mergeUstaadTag(t(), f.staff, third.id, { intoId: from.id, version: third.version }),
      'TAG_MERGE',
    );
  });
});

describe('reach cities, promotions, badges, tutorial', () => {
  it('a city is switched on and off with compare-and-set', async () => {
    const before = await listUstaadReachCities(t());
    const bhilai = before.find((c) => c.cityId === f.bhilai);
    const on = await setUstaadReachCity(t(), f.staff, f.bhilai, {
      enabled: true,
      version: bhilai?.version ?? null,
    });
    expect(on.enabled).toBe(true);
    await expectCode(setUstaadReachCity(t(), f.staff, f.bhilai, { enabled: false, version: null }), 'STALE');
  });

  it('promotions start as drafts and move draft → scheduled → ended, never back', async () => {
    const p = await createUstaadPromotion(t(), f.staff, {
      slot: 'feed',
      titleEn: 'Exide',
      titleHi: 'एक्साइड',
      bodyEn: '',
      bodyHi: '',
      target: 'url_internal',
      targetId: '/shop/exide',
      cityIds: [],
      segmentCodes: [],
      startsAt: '2026-12-01T00:00:00.000Z',
      endsAt: '2026-12-08T00:00:00.000Z',
    });
    expect(p.status).toBe('draft');
    const sch = await moveUstaadPromotion(t(), f.staff, p.id, { to: 'scheduled', version: p.version });
    const end = await moveUstaadPromotion(t(), f.staff, p.id, { to: 'ended', version: sch.version });
    await expectCode(
      moveUstaadPromotion(t(), f.staff, p.id, { to: 'draft', version: end.version }),
      'BAD_MOVE',
    );
  });

  it('badges and coach-marks are created; a duplicate code is DUPLICATE', async () => {
    const b = {
      code: 'battery_king',
      nameEn: 'Battery king',
      nameHi: 'बैटरी किंग',
      ruleEn: '10 best answers with #battery',
      ruleHi: '#battery पर 10 बेस्ट जवाब',
      icon: 'battery',
      kind: 'speciality' as const,
      rule: { schema_version: 1 as const, kind: 'best_answers_with_tag' as const, tag: 'battery', count: 10 },
      active: true,
    };
    await createUstaadBadge(t(), f.staff, b);
    await expectCode(createUstaadBadge(t(), f.staff, b), 'DUPLICATE');
    const c = await createUstaadCoachmark(t(), f.staff, {
      target: 'mic',
      textEn: 'Hold to ask',
      textHi: 'दबाकर पूछें',
      position: 1,
      active: true,
    });
    expect(c.target).toBe('mic');
  });

  it('tutorial cards: create, edit with version, stale refused', async () => {
    const card = {
      code: 'welcome',
      position: 1,
      titleEn: 'Welcome',
      titleHi: 'स्वागत है',
      bodyEn: 'Ask, show, learn.',
      bodyHi: 'पूछो, दिखाओ, सीखो।',
      active: true,
    };
    const c = await createUstaadTutorialCard(t(), f.staff, card);
    const u = await updateUstaadTutorialCard(t(), f.staff, c.id, {
      ...card,
      titleEn: 'Hello',
      version: c.version,
    });
    expect(u.titleEn).toBe('Hello');
    await expectCode(updateUstaadTutorialCard(t(), f.staff, c.id, { ...card, version: c.version }), 'STALE');
  });
});
