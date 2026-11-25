/**
 * Admin → Ustaad settings contracts (spec 23 § 15, SR-40, SR-41, SR-8; task G1). Locked items are not settings: a
 * save that names one is refused with SETTING_INVARIANT (AT-PROMO-1, AT-LEVEL-2). Write bodies are strict.
 */
import { describe, expect, it } from 'vitest';
import {
  BadgeWriteDto,
  LevelRuleWriteDto,
  PromotionWriteDto,
  TagWriteDto,
  TutorialCardWriteDto,
  USTAAD_LOCKED_ITEMS,
  UstaadSettingsSaveDto,
  WordWriteDto,
  isUstaadLockedItem,
  normaliseUstaadPhrase,
  promotionMoveAllowed,
} from '../src/ustaad/dto/admin';
import { ustaadDefaults, ustaadSettingInvariant } from '../src/ustaad/settings';

describe('locked items (SR-8, SR-41, SR-29)', () => {
  it('names staff final approval, the Sponsored label and the distance bands', () => {
    expect(USTAAD_LOCKED_ITEMS.map((l) => l.item)).toEqual([
      'ustaad.verify.staff_final_approval',
      'ustaad.promo.label',
      'ustaad.loc.distance_bands',
    ]);
    expect(isUstaadLockedItem('ustaad.promo.label')).toBe(true);
    expect(isUstaadLockedItem('ustaad.posts.per_day')).toBe(false);
  });

  it('the Sponsored label is "Sponsored" / "प्रायोजित"', () => {
    const label = USTAAD_LOCKED_ITEMS.find((l) => l.item === 'ustaad.promo.label');
    expect(label?.value).toEqual({ en: 'Sponsored', hi: 'प्रायोजित' });
  });
});

describe('settings save body', () => {
  it('takes a batch of changes with a version each and an optional reason code', () => {
    const ok = UstaadSettingsSaveDto.safeParse({
      changes: [
        { key: 'ustaad.feed.w_follows', value: 20, version: 1 },
        { key: 'ustaad.feed.w_city', value: 35, version: null },
      ],
      reasonCode: 'pilot',
    });
    expect(ok.success).toBe(true);
  });

  it('refuses unknown fields, an empty batch, the same key twice and an unknown reason', () => {
    const one = { key: 'ustaad.posts.per_day', value: 5, version: null };
    expect(UstaadSettingsSaveDto.safeParse({ changes: [one], extra: 1 }).success).toBe(false);
    expect(UstaadSettingsSaveDto.safeParse({ changes: [] }).success).toBe(false);
    expect(UstaadSettingsSaveDto.safeParse({ changes: [one, one] }).success).toBe(false);
    expect(UstaadSettingsSaveDto.safeParse({ changes: [one], reasonCode: 'because' }).success).toBe(false);
  });

  it('lets a locked item through the shape check so the server can answer SETTING_INVARIANT', () => {
    expect(
      UstaadSettingsSaveDto.safeParse({
        changes: [{ key: 'ustaad.promo.label', value: 'Ad', version: null }],
      }).success,
    ).toBe(true);
  });
});

describe('video above 180 s only where the video key changes (sticky reason)', () => {
  const v = { ...ustaadDefaults(), 'ustaad.posts.video_max_s': 240 };
  it('a later save of another key needs no reason', () => {
    expect(
      ustaadSettingInvariant(v, 'community_manager', { changedKeys: ['ustaad.posts.per_day'] }),
    ).toBeNull();
  });
  it('changing the video key itself still needs a super admin and a reason', () => {
    expect(ustaadSettingInvariant(v, 'super_admin', { changedKeys: ['ustaad.posts.video_max_s'] })).toEqual({
      key: 'ustaad.posts.video_max_s',
      code: 'SETTING_INVARIANT',
    });
  });
});

describe('table write bodies', () => {
  it('level rules: Bada and Master always need the staff review (SR-8)', () => {
    const base = {
      level: 'bada',
      ruleGroup: 'A',
      minFollowers: 50,
      minBestAnswers: 10,
      minHelpfulPct: 70,
      minVerifiedYears: 2,
      minVideos: 0,
      minRecommendations: 0,
      needsStaffReview: false,
      perkEn: '',
      perkHi: '',
      coinMultiplierBp: 12_000,
      nameEn: 'Bada Ustaad',
      nameHi: 'बड़ा उस्ताद',
      position: 4,
    };
    expect(LevelRuleWriteDto.safeParse(base).success).toBe(true);
    expect(LevelRuleWriteDto.safeParse({ ...base, coinMultiplierBp: 9_000 }).success).toBe(false);
    expect(LevelRuleWriteDto.safeParse({ ...base, official: true }).success).toBe(false);
  });

  it('badges carry a typed rule with a schema version', () => {
    const badge = {
      code: 'battery_king',
      nameEn: 'Battery king',
      nameHi: 'बैटरी किंग',
      ruleEn: '10 best answers with #battery',
      ruleHi: '#battery पर 10 बेस्ट जवाब',
      icon: 'battery',
      kind: 'speciality',
      rule: { schema_version: 1, kind: 'best_answers_with_tag', tag: 'battery', count: 10 },
      active: true,
    };
    expect(BadgeWriteDto.safeParse(badge).success).toBe(true);
    expect(BadgeWriteDto.safeParse({ ...badge, rule: { kind: 'founding' } }).success).toBe(false);
    expect(BadgeWriteDto.safeParse({ ...badge, code: 'Bad Code' }).success).toBe(false);
  });

  it('tags: slug format, Hindi name required, aliases normalised', () => {
    const tag = TagWriteDto.parse({
      slug: 'battery',
      nameEn: 'Battery',
      nameHi: 'बैटरी',
      group: 'part',
      aliases: ['  Battri ', 'BATTERY'],
      active: true,
    });
    expect(tag.aliases).toEqual(['battri', 'battery']);
    expect(TagWriteDto.safeParse({ ...tag, nameHi: '' }).success).toBe(false);
    expect(TagWriteDto.safeParse({ ...tag, slug: '#battery' }).success).toBe(false);
  });

  it('words: a replacement only on the correction list', () => {
    expect(WordWriteDto.safeParse({ list: 'banned', phrase: 'x', lang: 'any', active: true }).success).toBe(
      true,
    );
    expect(
      WordWriteDto.safeParse({ list: 'banned', phrase: 'x', replacement: 'y', lang: 'any', active: true })
        .success,
    ).toBe(false);
    expect(
      WordWriteDto.safeParse({ list: 'correction', phrase: 'battri', lang: 'any', active: true }).success,
    ).toBe(false);
    expect(
      WordWriteDto.safeParse({
        list: 'correction',
        phrase: 'battri',
        replacement: 'battery',
        lang: 'any',
        active: true,
      }).success,
    ).toBe(true);
  });

  it('phrase normaliser: NFC, lower case, single spaces', () => {
    expect(normaliseUstaadPhrase('  Pay   TO Join ')).toBe('pay to join');
    expect(normaliseUstaadPhrase('किन')).toBe('किन'.normalize('NFC'));
  });

  it('promotions: an internal path only, a window, and no label field (AT-PROMO-1 is a 422 on the server)', () => {
    const promo = {
      slot: 'feed',
      titleEn: 'Exide batteries',
      titleHi: 'एक्साइड बैटरी',
      bodyEn: '',
      bodyHi: '',
      target: 'url_internal',
      targetId: '/shop/exide',
      cityIds: [],
      segmentCodes: [],
      startsAt: '2026-12-01T00:00:00.000Z',
      endsAt: '2026-12-08T00:00:00.000Z',
    };
    expect(PromotionWriteDto.safeParse(promo).success).toBe(true);
    expect(PromotionWriteDto.safeParse({ ...promo, targetId: 'https://evil.example' }).success).toBe(false);
    expect(PromotionWriteDto.safeParse({ ...promo, endsAt: promo.startsAt }).success).toBe(false);
    // `label` is accepted by the shape only so the route can refuse it with SETTING_INVARIANT.
    const withLabel = PromotionWriteDto.safeParse({ ...promo, label: 'Ad' });
    expect(withLabel.success).toBe(true);
  });

  it('promotion moves: draft ⇄ scheduled, scheduled or live → ended, nothing back from ended', () => {
    expect(promotionMoveAllowed('draft', 'scheduled')).toBe(true);
    expect(promotionMoveAllowed('scheduled', 'draft')).toBe(true);
    expect(promotionMoveAllowed('live', 'ended')).toBe(true);
    expect(promotionMoveAllowed('draft', 'live')).toBe(false);
    expect(promotionMoveAllowed('ended', 'draft')).toBe(false);
  });

  it('tutorial cards keep the column length limits', () => {
    const card = {
      code: 'welcome',
      position: 1,
      titleEn: 'Welcome',
      titleHi: 'स्वागत है',
      bodyEn: 'Ask, show, learn.',
      bodyHi: 'पूछो, दिखाओ, सीखो।',
      active: true,
    };
    expect(TutorialCardWriteDto.safeParse(card).success).toBe(true);
    expect(TutorialCardWriteDto.safeParse({ ...card, titleEn: 'x'.repeat(81) }).success).toBe(false);
  });
});
