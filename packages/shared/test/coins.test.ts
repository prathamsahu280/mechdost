import { describe, expect, it } from 'vitest';
import { DEFAULT_COIN_RULES, coinExpiry, coinRedemption } from '../src/coins';

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

  it('computes expiry from the earn date', () => {
    expect(coinExpiry(new Date('2026-11-01T00:00:00Z')).toISOString()).toBe('2027-11-01T00:00:00.000Z');
  });
});
