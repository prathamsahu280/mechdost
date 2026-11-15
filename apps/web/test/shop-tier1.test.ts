/**
 * Shop portal next tier, part 1 (design 2026-11-15): expired offers leave the list at their end time, API codes map
 * to texts that exist in English and Hindi, the form checks match the API, and the confirmation per step.
 */
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import {
  isValidIndianMobile,
  isValidStaffName,
  liveOffers,
  stepFlashKey,
  tier1ErrorKey,
} from '../src/lib/shop-tier1';

const NOW = Date.parse('2026-11-16T10:00:00Z');

describe('open offers', () => {
  it('drops an offer exactly at its expiry, keeps later ones and ones with no end time', () => {
    const offers = [
      { code: 'a', expiresAt: '2026-11-16T09:59:59Z' },
      { code: 'b', expiresAt: '2026-11-16T10:00:00Z' },
      { code: 'c', expiresAt: '2026-11-16T10:00:01Z' },
      { code: 'd', expiresAt: null },
    ];
    expect(liveOffers(offers, NOW).map((o) => o.code)).toEqual(['c', 'd']);
  });
});

describe('texts', () => {
  it('every API code maps to a key present in en and hi; unknown codes get the generic line', () => {
    const codes = [
      'INVITE_OPEN',
      'ALREADY_MEMBER',
      'TEAM_FULL',
      'INVITE_INVALID',
      'OWNER_ONLY',
      'CANNOT_REMOVE_SELF',
      'CANNOT_REMOVE_OWNER',
      'NOT_FOUND',
      'INVITE_USED',
      'INVITE_CLOSED',
      'INVITE_EXPIRED',
      'MEMBER_IS_STAFF',
      'NETWORK',
      'RATE_LIMITED',
      'HTTP_500',
    ];
    for (const code of codes) {
      const key = tier1ErrorKey(code);
      expect(en.shopTier1).toHaveProperty(key);
      expect(hi.shopTier1).toHaveProperty(key);
    }
    expect(tier1ErrorKey('HTTP_500')).toBe('err_generic');
  });

  it('en and hi carry the same keys under shopTier1', () => {
    expect(Object.keys(hi.shopTier1).sort()).toEqual(Object.keys(en.shopTier1).sort());
  });
});

describe('forms and steps', () => {
  it('checks the staff name length and the Indian mobile like the API', () => {
    expect(isValidStaffName(' Mo ')).toBe(true);
    expect(isValidStaffName('M')).toBe(false);
    expect(isValidStaffName('x'.repeat(61))).toBe(false);
    expect(isValidIndianMobile('98765 43210')).toBe(true);
    expect(isValidIndianMobile('+91-98765-43210')).toBe(true);
    expect(isValidIndianMobile('5876543210')).toBe(false);
    expect(isValidIndianMobile('98765')).toBe(false);
  });

  it('says "packed" after packing and "out for delivery" after the hand-over steps', () => {
    expect(stepFlashKey('packed')).toBe('flashPacked');
    expect(stepFlashKey('shipped')).toBe('flashOut');
    expect(stepFlashKey('out_for_delivery')).toBe('flashOut');
  });
});
