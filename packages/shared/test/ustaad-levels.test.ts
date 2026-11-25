/**
 * Ustaad level, Izzat, badge, vouch/attestation and ring engines (spec 23 § 9, § 14, SR-6–SR-10; plan task B5).
 * Pure functions: the repositories feed them facts read in one query and write the outcome with conditional UPDATEs.
 */
import { describe, expect, it } from 'vitest';
import { badgesToAward } from '../src/ustaad/badges';
import { izzatPoints } from '../src/ustaad/izzat';
import {
  DEFAULT_LEVEL_RULES,
  levelFor,
  levelRuleRefusal,
  perksActive,
  qualifiedFollowers,
  type FollowerFacts,
  type LevelStats,
} from '../src/ustaad/levels';
import { detectRings } from '../src/ustaad/rings';
import { attestationRefusal, vouchRefusal, vouchesSufficient } from '../src/ustaad/verify';
import { ustaadDefaults } from '../src/ustaad/settings';

const NOW = new Date('2026-11-26T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const follower = (over: Partial<FollowerFacts> = {}): FollowerFacts => ({
  followerId: 'f',
  verified: true,
  accountCreatedAt: daysAgo(90),
  workshopId: 'w-other',
  status: 'active',
  counted: true,
  ...over,
});
const qOpts = { minAgeDays: 30, excludeSameGarage: true, followeeWorkshopId: 'w-mine' };

describe('qualifiedFollowers (SR-9, AT-LEVEL-1)', () => {
  it('AT-LEVEL-1: 600 followers from < 30-day or same-garage accounts → 0 qualified', () => {
    const young = Array.from({ length: 300 }, (_, i) =>
      follower({ followerId: `y${String(i)}`, accountCreatedAt: daysAgo(10) }),
    );
    const sameGarage = Array.from({ length: 300 }, (_, i) =>
      follower({ followerId: `g${String(i)}`, workshopId: 'w-mine' }),
    );
    expect(qualifiedFollowers([...young, ...sameGarage], NOW, qOpts)).toBe(0);
  });

  it('unverified, ring-flagged (counted = false), banned and departed followers never count', () => {
    const list = [
      follower({ followerId: 'a', verified: false }),
      follower({ followerId: 'b', counted: false }),
      follower({ followerId: 'c', status: 'banned' }),
      follower({ followerId: 'd', status: 'left' }),
      follower({ followerId: 'e' }),
      follower({ followerId: 'f2', status: 'restricted' }),
    ];
    expect(qualifiedFollowers(list, NOW, qOpts)).toBe(2);
  });

  it('follower_exclude_same_garage off → same-garage followers count', () => {
    const list = [follower({ workshopId: 'w-mine' }), follower({ followerId: 'z', workshopId: 'w-mine' })];
    expect(qualifiedFollowers(list, NOW, qOpts)).toBe(0);
    expect(qualifiedFollowers(list, NOW, { ...qOpts, excludeSameGarage: false })).toBe(2);
  });

  it('a follower with no garage is never "same garage"; a followee with no garage excludes nobody', () => {
    expect(qualifiedFollowers([follower({ workshopId: null })], NOW, qOpts)).toBe(1);
    expect(
      qualifiedFollowers([follower({ workshopId: null })], NOW, { ...qOpts, followeeWorkshopId: null }),
    ).toBe(1);
  });

  it('exactly min_age_days old counts; one second younger does not', () => {
    expect(qualifiedFollowers([follower({ accountCreatedAt: daysAgo(30) })], NOW, qOpts)).toBe(1);
    const young = new Date(daysAgo(30).getTime() + 1000);
    expect(qualifiedFollowers([follower({ accountCreatedAt: young })], NOW, qOpts)).toBe(0);
  });
});

const stats = (over: Partial<LevelStats> = {}): LevelStats => ({
  level: 'naya',
  verified: true,
  qualifiedFollowers: 0,
  bestAnswers: 0,
  helpfulPct: 0,
  verifiedYears: 0,
  videos: 0,
  recommendations: 0,
  ...over,
});

describe('levelFor (§ 9.2, SR-8)', () => {
  it('Naya by group A (3 verified years) or group B (1 recommendation + 10 videos) — OR groups', () => {
    expect(levelFor(stats({ level: 'apprentice', verifiedYears: 3 }), DEFAULT_LEVEL_RULES)).toMatchObject({
      level: 'naya',
      needsReview: false,
    });
    expect(
      levelFor(stats({ level: 'apprentice', recommendations: 1, videos: 10 }), DEFAULT_LEVEL_RULES),
    ).toMatchObject({ level: 'naya' });
    // Half of group B is not enough.
    expect(
      levelFor(stats({ level: 'apprentice', recommendations: 1, videos: 9 }), DEFAULT_LEVEL_RULES),
    ).toMatchObject({ level: 'apprentice', needsReview: false, needsVerification: false });
  });

  it('a Chhotu without an approved verification who meets Naya gets a verification request, not a promotion', () => {
    expect(
      levelFor(
        stats({ level: 'apprentice', verified: false, recommendations: 1, videos: 10 }),
        DEFAULT_LEVEL_RULES,
      ),
    ).toEqual({ level: 'apprentice', needsReview: false, needsVerification: true, reviewLevel: null });
  });

  it('ustaad_pending is never promoted by the engine (staff approval moves it)', () => {
    expect(levelFor(stats({ level: 'ustaad_pending', verifiedYears: 10 }), DEFAULT_LEVEL_RULES).level).toBe(
      'ustaad_pending',
    );
  });

  it('Pakka at 100 qualified followers + 25 best answers; 99 is not enough', () => {
    expect(levelFor(stats({ qualifiedFollowers: 100, bestAnswers: 25 }), DEFAULT_LEVEL_RULES).level).toBe(
      'pakka',
    );
    expect(levelFor(stats({ qualifiedFollowers: 99, bestAnswers: 25 }), DEFAULT_LEVEL_RULES).level).toBe(
      'naya',
    );
  });

  it('Bada and Master always queue a staff review instead of promoting (locked)', () => {
    const r = levelFor(
      stats({ level: 'pakka', qualifiedFollowers: 500, bestAnswers: 100, helpfulPct: 80 }),
      DEFAULT_LEVEL_RULES,
    );
    expect(r).toEqual({ level: 'pakka', needsReview: true, reviewLevel: 'bada', needsVerification: false });
    // Even when an admin row says needsStaffReview = false for bada (the DB CHECK refuses it; the engine too).
    const tampered = DEFAULT_LEVEL_RULES.map((x) =>
      x.level === 'bada' ? { ...x, needsStaffReview: false } : x,
    );
    expect(
      levelFor(stats({ level: 'pakka', qualifiedFollowers: 500, bestAnswers: 100, helpfulPct: 80 }), tampered)
        .needsReview,
    ).toBe(true);
  });

  it('one step at a time: a Naya with Master numbers goes to Pakka first', () => {
    expect(
      levelFor(stats({ qualifiedFollowers: 5000, bestAnswers: 500, helpfulPct: 95 }), DEFAULT_LEVEL_RULES)
        .level,
    ).toBe('pakka');
  });

  it('never drops: a Pakka below every threshold stays Pakka', () => {
    expect(levelFor(stats({ level: 'pakka' }), DEFAULT_LEVEL_RULES)).toMatchObject({
      level: 'pakka',
      needsReview: false,
    });
  });

  it('needsStaffReview on Pakka (editable) queues a review', () => {
    const rules = DEFAULT_LEVEL_RULES.map((x) =>
      x.level === 'pakka' ? { ...x, needsStaffReview: true } : x,
    );
    expect(levelFor(stats({ qualifiedFollowers: 100, bestAnswers: 25 }), rules)).toMatchObject({
      level: 'naya',
      needsReview: true,
      reviewLevel: 'pakka',
    });
  });
});

describe('levelRuleRefusal (spec 20 coin guard, SR-8)', () => {
  it('coin_multiplier_bp > 10000 → COIN_GUARD_REQUIRED; 10000 ok', () => {
    const pakka = DEFAULT_LEVEL_RULES.find((r) => r.level === 'pakka');
    expect(pakka).toBeDefined();
    if (!pakka) return;
    expect(levelRuleRefusal({ ...pakka, coinMultiplierBp: 15_000 })).toBe('COIN_GUARD_REQUIRED');
    expect(levelRuleRefusal({ ...pakka, coinMultiplierBp: 10_000 })).toBeNull();
  });
  it('turning staff review off for Bada or Master → SETTING_INVARIANT', () => {
    const bada = DEFAULT_LEVEL_RULES.find((r) => r.level === 'bada');
    if (!bada) throw new Error('seed');
    expect(levelRuleRefusal({ ...bada, needsStaffReview: false })).toBe('SETTING_INVARIANT');
  });
});

describe('perksActive (§ 9.2 inactivity, SR-2 freeze)', () => {
  it('paused after inactive_pause_days and during a security freeze; level untouched elsewhere', () => {
    expect(perksActive({ lastActiveAt: daysAgo(10), perksFrozenUntil: null }, NOW, 90)).toBe(true);
    expect(perksActive({ lastActiveAt: daysAgo(91), perksFrozenUntil: null }, NOW, 90)).toBe(false);
    expect(perksActive({ lastActiveAt: daysAgo(1), perksFrozenUntil: daysAgo(-1) }, NOW, 90)).toBe(false);
    expect(perksActive({ lastActiveAt: null, perksFrozenUntil: null }, NOW, 90)).toBe(false);
  });
});

describe('izzatPoints (§ 9.1)', () => {
  const v = ustaadDefaults();
  it('setting-driven reasons take their points from the settings', () => {
    expect(izzatPoints('best_answer', v)).toBe(10);
    expect(izzatPoints('answer_posted', v)).toBe(2);
    expect(izzatPoints('answer_posted', { ...v, 'ustaad.izzat.answer_posted': 5 })).toBe(5);
  });
  it('video_completed defaults to 0 → nothing is written', () => {
    expect(izzatPoints('video_completed', v)).toBe(0);
  });
  it('sponsored or MechDost-authored content earns nothing (locked)', () => {
    expect(izzatPoints('best_answer', v, { sponsored: true })).toBe(0);
  });
  it('strike is negative and clamped to −500…−50; reversal and correction carry their own non-zero delta', () => {
    expect(izzatPoints('strike', v, { delta: -100 })).toBe(-100);
    expect(izzatPoints('strike', v, { delta: -10 })).toBe(-50);
    expect(izzatPoints('strike', v, { delta: -9000 })).toBe(-500);
    expect(izzatPoints('strike', v, { delta: 20 })).toBe(-50);
    expect(izzatPoints('reversal', v, { delta: -10 })).toBe(-10);
    expect(izzatPoints('reversal', v)).toBe(0);
  });
});

describe('vouchRefusal / vouchesSufficient (SR-7)', () => {
  const base = {
    voucher: { level: 'pakka' as const, accountCreatedAt: daysAgo(90) },
    reciprocal: false,
    vouchesThisMonth: 0,
    now: NOW,
    minLevel: 'pakka' as const,
    minAccountDays: 60,
    perMonth: 3,
  };
  it('a Pakka+ voucher ≥ 60 days old with < 3 vouches this month may vouch', () => {
    expect(vouchRefusal(base)).toBeNull();
  });
  it('below Pakka, under 60 days, reciprocal or the 4th this month → refused with a stable code', () => {
    expect(vouchRefusal({ ...base, voucher: { ...base.voucher, level: 'naya' } })).toBe('VOUCH_LEVEL');
    expect(vouchRefusal({ ...base, voucher: { ...base.voucher, accountCreatedAt: daysAgo(59) } })).toBe(
      'VOUCH_ACCOUNT_AGE',
    );
    expect(vouchRefusal({ ...base, reciprocal: true })).toBe('VOUCH_RECIPROCAL');
    expect(vouchRefusal({ ...base, vouchesThisMonth: 3 })).toBe('VOUCH_MONTHLY_CAP');
  });
  it('vouches need ≥ needed givers from ≥ 2 different garages (no garage = one shared bucket)', () => {
    expect(vouchesSufficient([{ voucherWorkshopId: 'a' }, { voucherWorkshopId: 'b' }], 2)).toBe(true);
    expect(vouchesSufficient([{ voucherWorkshopId: 'a' }, { voucherWorkshopId: 'a' }], 2)).toBe(false);
    expect(vouchesSufficient([{ voucherWorkshopId: null }, { voucherWorkshopId: null }], 2)).toBe(false);
    expect(vouchesSufficient([{ voucherWorkshopId: 'a' }], 2)).toBe(false);
    expect(vouchesSufficient([{ voucherWorkshopId: 'a' }], 1)).toBe(true);
  });
});

describe('attestationRefusal (SR-6)', () => {
  const base = {
    ownerIsPartner: true,
    businessId: null,
    photoDistanceM: null,
    thisQuarter: 0,
    perQuarter: 10,
    maxM: 200,
  };
  it('a verified workshop partner confirms', () => {
    expect(attestationRefusal(base)).toBeNull();
  });
  it('a non-partner owner needs a GSTIN/Udyam number and a shop photo within 200 m', () => {
    const np = { ...base, ownerIsPartner: false };
    expect(attestationRefusal(np)).toBe('ATTEST_BUSINESS_ID');
    expect(attestationRefusal({ ...np, businessId: '22AAAAA0000A1Z5' })).toBe('ATTEST_PHOTO');
    expect(attestationRefusal({ ...np, businessId: '22AAAAA0000A1Z5', photoDistanceM: 250 })).toBe(
      'ATTEST_PHOTO',
    );
    expect(attestationRefusal({ ...np, businessId: '22AAAAA0000A1Z5', photoDistanceM: 150 })).toBeNull();
  });
  it('the 11th attestation by one owner in a quarter is refused', () => {
    expect(attestationRefusal({ ...base, thisQuarter: 10 })).toBe('ATTEST_QUARTER_CAP');
  });
});

describe('detectRings (§ 14, SR-10, AT-VOUCH-1)', () => {
  const t0 = daysAgo(5);
  const at = (h: number) => new Date(t0.getTime() + h * 3_600_000);
  it('flags a member when > 30 % of new followers are reciprocal follows within 24 h, and returns those edges', () => {
    // m has 4 new followers; 2 of them (a, b) are mutual within 24 h → 50 %.
    const edges = [
      { followerId: 'a', followeeId: 'm', createdAt: at(0) },
      { followerId: 'm', followeeId: 'a', createdAt: at(2) },
      { followerId: 'b', followeeId: 'm', createdAt: at(0) },
      { followerId: 'm', followeeId: 'b', createdAt: at(20) },
      { followerId: 'c', followeeId: 'm', createdAt: at(0) },
      { followerId: 'd', followeeId: 'm', createdAt: at(0) },
    ];
    const r = detectRings(edges, { now: NOW, windowDays: 30, reciprocityPct: 30, minFollowers: 3 });
    expect(r.flaggedMembers).toContain('m');
    expect(r.uncountedEdges).toEqual(
      expect.arrayContaining([
        { followerId: 'a', followeeId: 'm' },
        { followerId: 'm', followeeId: 'a' },
        { followerId: 'b', followeeId: 'm' },
        { followerId: 'm', followeeId: 'b' },
      ]),
    );
    expect(r.uncountedEdges).not.toContainEqual({ followerId: 'c', followeeId: 'm' });
  });

  it('a mutual follow more than 24 h apart is ordinary, not a burst', () => {
    const edges = [
      { followerId: 'a', followeeId: 'm', createdAt: at(0) },
      { followerId: 'm', followeeId: 'a', createdAt: at(30) },
      { followerId: 'c', followeeId: 'm', createdAt: at(0) },
      { followerId: 'd', followeeId: 'm', createdAt: at(0) },
    ];
    expect(
      detectRings(edges, { now: NOW, windowDays: 30, reciprocityPct: 30, minFollowers: 3 }).flaggedMembers,
    ).toEqual([]);
  });

  it('flags a dense cluster (everyone mutually following inside 24 h) even when each member has few followers', () => {
    const ids = ['p', 'q', 'r', 's'];
    const edges = ids.flatMap((x) =>
      ids.filter((y) => y !== x).map((y) => ({ followerId: x, followeeId: y, createdAt: at(1) })),
    );
    const r = detectRings(edges, { now: NOW, windowDays: 30, reciprocityPct: 30, minFollowers: 10 });
    expect([...r.flaggedMembers].sort()).toEqual(ids);
    expect(r.uncountedEdges).toHaveLength(12);
  });

  it('old follows outside the window are ignored', () => {
    const old = daysAgo(60);
    const edges = [
      { followerId: 'a', followeeId: 'm', createdAt: old },
      { followerId: 'm', followeeId: 'a', createdAt: old },
    ];
    expect(
      detectRings(edges, { now: NOW, windowDays: 30, reciprocityPct: 30, minFollowers: 1 }).flaggedMembers,
    ).toEqual([]);
  });
});

describe('badgesToAward (§ 9.3)', () => {
  const badges = [
    { code: 'first_post', rule: { schema_version: 1, kind: 'first_post' } },
    { code: 'pehla_jawab', rule: { schema_version: 1, kind: 'first_answer' } },
    { code: 'founding_ustaad', rule: { schema_version: 1, kind: 'founding' } },
    {
      code: 'battery_expert',
      rule: { schema_version: 1, kind: 'best_answers_with_tag', tag: 'battery', min: 10 },
    },
    {
      code: 'two_wheeler_doctor',
      rule: { schema_version: 1, kind: 'helpful_answers_in_segment', segment: 'two_wheeler', min: 25 },
    },
    { code: 'helping_hand', rule: { schema_version: 1, kind: 'apprentice_answers_in_week', min: 5 } },
    { code: 'broken', rule: { schema_version: 1, kind: 'unknown_kind' } },
  ];
  const facts = {
    posts: 1,
    questions: 0,
    answers: 3,
    founding: false,
    bestAnswersByTag: { battery: 10 },
    helpfulBySegment: { two_wheeler: 24 },
    apprenticeAnswersThisWeek: 5,
  };
  it('awards every met rule once (already held are skipped); unknown rule kinds award nothing', () => {
    expect(badgesToAward(badges, facts, new Set(['first_post'])).sort()).toEqual([
      'battery_expert',
      'helping_hand',
      'pehla_jawab',
    ]);
  });
});
