import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COIN_RULES,
  coinExpiry,
  coinLots,
  coinRedemption,
  expiredCoins,
  nextExpiry,
  orderRewardCoins,
  splitCoins,
  type CoinLotEntry,
} from '../src/coins';

describe('MechDost Coins redemption (spec 20)', () => {
  it('caps at 10% of the product subtotal by default (1 coin = ₹1)', () => {
    // ₹1,000 order → at most ₹100 off, even with 250 coins.
    expect(coinRedemption(250, 100_000)).toEqual({ coins: 100, discountPaise: 10_000 });
  });

  it('never uses more coins than the balance or than requested', () => {
    expect(coinRedemption(40, 100_000)).toEqual({ coins: 40, discountPaise: 4_000 });
    expect(coinRedemption(250, 100_000, DEFAULT_COIN_RULES, 25)).toEqual({ coins: 25, discountPaise: 2_500 });
  });

  it('uses whole coins only and rounds the cap down', () => {
    // ₹449 order → cap ₹44.90 → 44 coins.
    expect(coinRedemption(250, 44_900)).toEqual({ coins: 44, discountPaise: 4_400 });
    // 1 coin = ₹0.50 → cap ₹10 on ₹100 → 20 coins.
    expect(coinRedemption(250, 10_000, { ...DEFAULT_COIN_RULES, coinValuePaise: 50 })).toEqual({
      coins: 20,
      discountPaise: 1_000,
    });
  });

  it('gives nothing below the minimum order, with no balance, or when redemption is switched off', () => {
    expect(coinRedemption(250, 40_000, { ...DEFAULT_COIN_RULES, minOrderPaise: 50_000 })).toEqual({
      coins: 0,
      discountPaise: 0,
    });
    expect(coinRedemption(0, 100_000).coins).toBe(0);
    expect(coinRedemption(-5, 100_000).coins).toBe(0);
    expect(coinRedemption(250, 100_000, { ...DEFAULT_COIN_RULES, maxRedeemBp: 0 }).coins).toBe(0);
    expect(coinRedemption(250, 0).coins).toBe(0);
  });

  it('computes expiry from the earn date (180 days by default, Q24)', () => {
    expect(coinExpiry(new Date('2026-11-01T00:00:00Z')).toISOString()).toBe('2027-04-30T00:00:00.000Z');
  });
});

describe('splitting coins across sub-orders', () => {
  it('splits in proportion to the subtotals and always adds up', () => {
    expect(splitCoins(100, 100, [60_000, 40_000])).toEqual([60, 40]);
    const parts = splitCoins(7, 100, [10_000, 10_000, 10_000]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(7);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });

  it('never gives a sub-order more discount than its own subtotal', () => {
    // A ₹1 part and a ₹999 part: 100 coins cannot put 1 coin on the ₹1 part beyond its value.
    const parts = splitCoins(100, 100, [100, 99_900]);
    expect(parts[0]! * 100).toBeLessThanOrEqual(100);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(splitCoins(0, 100, [5_000])).toEqual([0]);
  });
});

describe('coin lots and expiry (first-expiring used first)', () => {
  const at = (iso: string) => new Date(iso);
  const entries: CoinLotEntry[] = [
    { id: 'a', delta: 100, kind: 'earn', expiresAt: at('2027-01-01T00:00:00Z') },
    { id: 'b', delta: 50, kind: 'earn', expiresAt: at('2027-06-01T00:00:00Z') },
    { id: 'c', delta: -70, kind: 'redeem', expiresAt: null },
  ];

  it('spending uses the earliest-expiring lot first', () => {
    expect(coinLots(entries).map((l) => l.remaining)).toEqual([30, 50]);
  });

  it('expires only what is left of lots past their date, once', () => {
    const now = at('2027-02-01T00:00:00Z');
    expect(expiredCoins(entries, now)).toEqual({ coins: 30, lastLotId: 'a' });
    const after: CoinLotEntry[] = [...entries, { id: 'd', delta: -30, kind: 'expire', expiresAt: null }];
    expect(expiredCoins(after, now)).toEqual({ coins: 0, lastLotId: 'a' });
    expect(nextExpiry(after, now)).toEqual({ coins: 50, at: at('2027-06-01T00:00:00Z') });
  });

  it('lots without an expiry never expire and are used last', () => {
    const e: CoinLotEntry[] = [
      { id: 'x', delta: 10, kind: 'adjust', expiresAt: null },
      { id: 'y', delta: 10, kind: 'earn', expiresAt: at('2027-01-01T00:00:00Z') },
      { id: 'z', delta: -5, kind: 'redeem', expiresAt: null },
    ];
    expect(expiredCoins(e, at('2030-01-01T00:00:00Z')).coins).toBe(5);
  });
});

describe('order rewards', () => {
  it('gives whole coins for the admin-set share of what the products cost', () => {
    // 2% of ₹1,249 = ₹24.98 → 24 coins at ₹1 each.
    expect(orderRewardCoins(124_900, 200, 100)).toBe(24);
    expect(orderRewardCoins(124_900, 0, 100)).toBe(0);
  });
});
