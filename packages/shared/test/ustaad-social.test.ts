import { describe, expect, it } from 'vitest';
import { ustaadThreadMachine } from '../src/state';
import {
  DISCOVER_PAGE_SIZE,
  discoverScore,
  dmTextCheck,
  orderedPair,
  promotionHref,
  rankDiscover,
  SPONSORED_LABEL,
  wilsonLower,
} from '../src/ustaad/social-rules';

describe('orderedPair', () => {
  it('stores the smaller id first whichever way round it is called', () => {
    expect(orderedPair('b', 'a')).toEqual({ lowId: 'a', highId: 'b' });
    expect(orderedPair('a', 'b')).toEqual({ lowId: 'a', highId: 'b' });
  });
});

describe('dmTextCheck (SR-33, AT-DM-1)', () => {
  it('a link in a request is refused, in every common shape', () => {
    for (const t of [
      'dekho https://evil.example/x',
      'www.example.com pe aao',
      'bit.ly/abc',
      'wa.me/919876543210',
      'HTTP://X.IN',
      'ｈｔｔｐｓ://full-width.example',
    ])
      expect(dmTextCheck(t, { requested: true }).link, t).toBe(true);
  });

  it('plain workshop talk is not a link (decimal numbers, sizes, codes)', () => {
    for (const t of ['175/65 R14 hai', 'oil 3.5 l dalo', 'UQ-RPR-2026-ABCDEF dekho', 'bhai.kaise ho'])
      expect(dmTextCheck(t, { requested: true }).link, t).toBe(false);
  });

  it('phone numbers, emails and UPI ids are masked in a request, Devanagari digits too', () => {
    const r = dmTextCheck('call 98765 43210 ya ९८७६५४३२१० ya a@b.com ya ramesh@okaxis', { requested: true });
    expect(r.text).not.toMatch(/98765|९८७|a@b\.com|okaxis/);
    expect(r.text).toContain('#');
  });

  it('after acceptance the text is kept as typed (a member may share their own number)', () => {
    expect(dmTextCheck('mera number 9876543210', { requested: false }).text).toBe('mera number 9876543210');
  });

  it('a fee phrase, a UPI id or a pay-app ask holds the message in any state', () => {
    expect(dmTextCheck('registration fee 500 bhejo', { requested: false }).hold).toBe(true);
    expect(dmTextCheck('ramesh@okaxis pe bhejo', { requested: false }).hold).toBe(true);
    expect(dmTextCheck('kal milte hain', { requested: false }).hold).toBe(false);
    expect(dmTextCheck('kal milte hain', { requested: false, scamPhrases: ['milte hain'] }).hold).toBe(true);
  });
});

describe('thread machine: unblock restores, never opens a request', () => {
  it('allows blocked → requested | open | declined and refuses requested → open by system', () => {
    expect(() => {
      ustaadThreadMachine.assert('blocked', 'requested', 'member');
    }).not.toThrow();
    expect(() => {
      ustaadThreadMachine.assert('blocked', 'declined', 'member');
    }).not.toThrow();
    expect(() => {
      ustaadThreadMachine.assert('requested', 'open', 'system');
    }).toThrow();
  });
});

describe('Discover score (spec 23 § 9.4)', () => {
  const w = { helpful: 45, best: 25, breadth: 15, trust: 10, newcomer: 5 };
  const base = {
    answers: 0,
    helpfulAnswers: 0,
    bestAnswers: 0,
    bestAnswers30d: 0,
    distinctAskers: 0,
    verified: false,
    level: 'apprentice',
    daysSinceJoin: 100,
    followers: 0,
  };

  it('Wilson lower bound: more evidence at the same rate ranks higher; zero answers is 0', () => {
    expect(wilsonLower(0, 0)).toBe(0);
    expect(wilsonLower(9, 10)).toBeLessThan(wilsonLower(90, 100));
    expect(wilsonLower(10, 10)).toBeLessThan(1);
  });

  it('followers have weight 0: a member with 10 000 followers and no help ranks below a helper', () => {
    const famous = discoverScore({ ...base, followers: 10_000 }, w);
    const helper = discoverScore({ ...base, answers: 20, helpfulAnswers: 15, bestAnswers: 5 }, w);
    expect(helper).toBeGreaterThan(famous);
    expect(discoverScore({ ...base, followers: 10_000 }, w)).toBe(discoverScore(base, w));
  });

  it('rank keeps new-member slots on a page and pages by position with no repeats', () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({
      id: `m${String(i).padStart(2, '0')}`,
      score: 100 - i,
      isNew: i >= 40,
    }));
    const p1 = rankDiscover(rows, { newSlots: 2, offset: 0 });
    expect(p1.ids).toHaveLength(DISCOVER_PAGE_SIZE);
    expect(p1.ids.filter((id) => Number(id.slice(1)) >= 40)).toHaveLength(2);
    const p2 = rankDiscover(rows, { newSlots: 2, offset: p1.nextOffset ?? 0 });
    expect(p2.ids.some((id) => p1.ids.includes(id))).toBe(false);
    const p3 = rankDiscover(rows, { newSlots: 2, offset: p2.nextOffset ?? 0 });
    expect(new Set([...p1.ids, ...p2.ids, ...p3.ids]).size).toBe(45);
    expect(p3.nextOffset).toBeNull();
  });
});

describe('promotions', () => {
  it('the Sponsored label is locked and bilingual (SR-41)', () => {
    expect(SPONSORED_LABEL).toEqual({ en: 'Sponsored', hi: 'प्रायोजित' });
  });

  it('links resolve to MechDost internal paths only (open-redirect safe)', () => {
    expect(promotionHref('product', 'bosch-wiper-14')).toBe('/shop/bosch-wiper-14');
    expect(promotionHref('category', 'batteries')).toBe('/shop?category=batteries');
    expect(promotionHref('coupon', 'DIWALI50')).toBe('/offers');
    expect(promotionHref('learning', '0190f0a0-0000-7000-8000-000000000001')).toBe(
      '/ustaad/learn?resource=0190f0a0-0000-7000-8000-000000000001',
    );
    expect(promotionHref('url_internal', '/ustaad/learn')).toBe('/ustaad/learn');
    for (const bad of ['//evil.com', 'https://evil.com', '/ok\n//evil', '/a\\b', 'javascript:alert(1)'])
      expect(promotionHref('url_internal', bad), bad).toBeNull();
    expect(promotionHref('product', '../admin')).toBeNull();
  });
});
