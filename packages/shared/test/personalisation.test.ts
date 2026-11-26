import { describe, expect, it } from 'vitest';
import { CLIENT_EVENT_SCHEMAS } from '../src/analytics';
import { PRIVACY_PURPOSES } from '../src/privacy-api';
import { RECO_SLOTS, RECO_SUGGEST_KINDS, RecoRuleInputSchema } from '../src/recommendations';
import {
  mergeRecent,
  parseRecent,
  pushRecent,
  RECENT_MAX,
  RECENT_MIN_HOME,
  removeRecent,
  serialiseRecent,
} from '../src/recently-viewed';
import { RecentViewsBodySchema, RecentlyViewedDto } from '../src/recently-viewed-api';

/** Shopping personalisation phases 2 and 3 (design 2026-11-25, founder approval 2026-11-26). */
describe('recently viewed list (browser copy)', () => {
  const t0 = Date.UTC(2026, 10, 26, 10, 0, 0);

  it('puts the newest view first, once per product, at most RECENT_MAX', () => {
    let list = pushRecent([], 'a', t0);
    list = pushRecent(list, 'b', t0 + 1000);
    list = pushRecent(list, 'a', t0 + 2000);
    expect(list.map((e) => e.slug)).toEqual(['a', 'b']);
    expect(list[0]?.at).toBe(t0 + 2000);
    for (let i = 0; i < 20; i++) list = pushRecent(list, `p-${String(i)}`, t0 + 10_000 + i);
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]?.slug).toBe('p-19');
    expect(RECENT_MAX).toBe(10);
    expect(RECENT_MIN_HOME).toBe(2);
  });

  it('ignores anything that is not a product slug', () => {
    expect(pushRecent([], 'Bad Slug!', t0)).toEqual([]);
    expect(pushRecent([], '', t0)).toEqual([]);
  });

  it('reads stored text defensively: broken JSON, wrong shapes and bad slugs give what is valid', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{nope')).toEqual([]);
    expect(parseRecent('{"v":1}')).toEqual([]);
    const raw = JSON.stringify([
      { slug: 'ok-1', at: t0 },
      { slug: 'BAD', at: t0 },
      { slug: 'ok-2', at: 'x' },
      { slug: 'ok-1', at: t0 - 5 },
      'string',
    ]);
    expect(parseRecent(raw)).toEqual([{ slug: 'ok-1', at: t0 }]);
    const many = JSON.stringify(
      Array.from({ length: 40 }, (_, i) => ({ slug: `s-${String(i)}`, at: t0 - i })),
    );
    expect(parseRecent(many)).toHaveLength(RECENT_MAX);
  });

  it('round-trips through storage text', () => {
    const list = pushRecent(pushRecent([], 'a', t0), 'b', t0 + 1);
    expect(parseRecent(serialiseRecent(list))).toEqual(list);
  });

  it('merges a device list into the account list by the latest view of each product', () => {
    const local = [
      { slug: 'a', at: t0 + 50 },
      { slug: 'c', at: t0 + 10 },
    ];
    const server = [
      { slug: 'b', at: t0 + 40 },
      { slug: 'a', at: t0 + 5 },
    ];
    expect(mergeRecent(local, server)).toEqual([
      { slug: 'a', at: t0 + 50 },
      { slug: 'b', at: t0 + 40 },
      { slug: 'c', at: t0 + 10 },
    ]);
  });

  it('removes one product', () => {
    const list = pushRecent(pushRecent([], 'a', t0), 'b', t0 + 1);
    expect(removeRecent(list, 'a').map((e) => e.slug)).toEqual(['b']);
  });
});

describe('recently viewed API shapes', () => {
  it('accepts up to RECENT_MAX views with UTC times, strict', () => {
    const ok = RecentViewsBodySchema.safeParse({
      views: [{ slug: 'castrol-activ-4t-20w40-900ml', viewedAt: '2026-11-26T10:00:00.000Z' }],
      city: 'RPR',
    });
    expect(ok.success).toBe(true);
    expect(RecentViewsBodySchema.safeParse({ views: [], city: 'RPR' }).success).toBe(false);
    expect(
      RecentViewsBodySchema.safeParse({
        views: Array.from({ length: RECENT_MAX + 1 }, (_, i) => ({
          slug: `p-${String(i)}`,
          viewedAt: '2026-11-26T10:00:00.000Z',
        })),
        city: 'RPR',
      }).success,
    ).toBe(false);
    expect(
      RecentViewsBodySchema.safeParse({
        views: [{ slug: 'a', viewedAt: '2026-11-26T10:00:00.000Z' }],
        city: 'RPR',
        userId: 'x',
      }).success,
    ).toBe(false);
  });

  it('describes the stored list with its consent state', () => {
    expect(
      RecentlyViewedDto.safeParse({
        stored: true,
        items: [{ slug: 'a', viewedAt: '2026-11-26T10:00:00.000Z' }],
      }).success,
    ).toBe(true);
  });
});

describe('personalisation consent', () => {
  it('is a purpose a person can switch in Privacy', () => {
    expect(PRIVACY_PURPOSES).toContain('personalisation');
  });
});

describe('suggestions (phase 3)', () => {
  const cat = '01a1db2d-e45a-7f47-8659-9433601cf99d';
  const cat2 = '01a1db2d-e45a-7f47-8659-9433601cf99e';
  const prod = '01a1db2d-e45a-7f47-8659-9433601cf9a0';
  const prod2 = '01a1db2d-e45a-7f47-8659-9433601cf9a1';
  const base = { label: 'Tube for your tyre', labelHi: 'आपके टायर के लिए ट्यूब', priority: 10, active: true };

  it('has a similar-options slot and three kinds of "goes well with"', () => {
    expect(RECO_SLOTS).toContain('similar');
    expect(RECO_SUGGEST_KINDS).toEqual(['category', 'product', 'workshop_fitting']);
  });

  it('accepts category → category (the old shape), product → product and → workshop fitting rules', () => {
    expect(
      RecoRuleInputSchema.safeParse({ ...base, triggerCategoryId: cat, suggestCategoryId: cat2 }).success,
    ).toBe(true);
    expect(
      RecoRuleInputSchema.safeParse({
        ...base,
        triggerProductId: prod,
        suggestKind: 'product',
        suggestProductId: prod2,
      }).success,
    ).toBe(true);
    expect(
      RecoRuleInputSchema.safeParse({ ...base, triggerCategoryId: cat, suggestKind: 'workshop_fitting' })
        .success,
    ).toBe(true);
  });

  it('refuses a rule that suggests what triggers it, two triggers, or a suggestion without its id', () => {
    expect(
      RecoRuleInputSchema.safeParse({
        ...base,
        triggerProductId: prod,
        suggestKind: 'product',
        suggestProductId: prod,
      }).success,
    ).toBe(false);
    expect(
      RecoRuleInputSchema.safeParse({ ...base, triggerCategoryId: cat, suggestKind: 'category' }).success,
    ).toBe(false);
    expect(
      RecoRuleInputSchema.safeParse({
        ...base,
        triggerCategoryId: cat,
        triggerProductId: prod,
        suggestCategoryId: cat2,
      }).success,
    ).toBe(false);
    expect(
      RecoRuleInputSchema.safeParse({
        ...base,
        triggerCategoryId: cat,
        suggestKind: 'workshop_fitting',
        suggestCategoryId: cat2,
      }).success,
    ).toBe(false);
  });
});

describe('suggestion and recently viewed events (spec 12)', () => {
  it('records impressions and clicks per surface and algorithm, codes only', () => {
    expect(
      CLIENT_EVENT_SCHEMAS.reco_impression.safeParse({ surface: 'product', algo: 'similar', count: 4 })
        .success,
    ).toBe(true);
    expect(
      CLIENT_EVENT_SCHEMAS.reco_click.safeParse({
        surface: 'cart',
        algo: 'recent',
        slug: 'castrol-activ-4t-20w40-900ml',
        position: 1,
      }).success,
    ).toBe(true);
    expect(
      CLIENT_EVENT_SCHEMAS.reco_click.safeParse({
        surface: 'product',
        algo: 'fitting',
        slug: null,
        position: 1,
      }).success,
    ).toBe(true);
    expect(
      CLIENT_EVENT_SCHEMAS.reco_impression.safeParse({ surface: 'product', algo: 'magic', count: 4 }).success,
    ).toBe(false);
  });

  it('records clearing and switching the list', () => {
    expect(
      CLIENT_EVENT_SCHEMAS.recently_viewed_cleared.safeParse({ surface: 'account', count: 3 }).success,
    ).toBe(true);
    expect(CLIENT_EVENT_SCHEMAS.recently_viewed_toggled.safeParse({ on: false }).success).toBe(true);
    expect(CLIENT_EVENT_SCHEMAS.list_position_restored.safeParse({ pages: 2 }).success).toBe(true);
  });
});
