import { describe, expect, it } from 'vitest';
import { codChoice, codNextAction } from '../src/lib/cod-view';

const eligible = {
  eligible: true,
  via: 'approved' as const,
  reason: null,
  canRequest: false,
  capPaise: null,
};
const quote = (over: Record<string, unknown> = {}) => ({
  totalPaise: 100_000,
  cod: {
    allowed: true,
    reason: null,
    capPaise: 500_000,
    eligibility: eligible,
    cartReason: null,
    minOrderPaise: 0,
    minItems: 1,
    ...over,
  },
});

describe('codChoice — what checkout shows for cash on delivery (founder ruling 2026-11-26)', () => {
  it('available when the person is eligible and the cart fits', () => {
    expect(codChoice(quote(), { discountPaise: 0, pieces: 1 })).toEqual({
      available: true,
      reason: null,
      canRequest: false,
    });
  });

  it('the person comes first: not approved, with the request action', () => {
    const q = quote({
      eligibility: { ...eligible, eligible: false, via: null, reason: 'not_approved', canRequest: true },
    });
    expect(codChoice(q, { discountPaise: 0, pieces: 1 })).toEqual({
      available: false,
      reason: 'not_approved',
      canRequest: true,
    });
  });

  it('PIN rule, then cap after discounts, then the minimum order and pieces after discounts', () => {
    expect(codChoice(quote({ reason: 'pincode' }), { discountPaise: 0, pieces: 1 }).reason).toBe('pincode');
    expect(codChoice(quote({ capPaise: 90_000 }), { discountPaise: 0, pieces: 1 }).reason).toBe('over_cap');
    expect(codChoice(quote({ capPaise: 90_000 }), { discountPaise: 20_000, pieces: 1 }).available).toBe(true);
    expect(codChoice(quote({ minOrderPaise: 90_000 }), { discountPaise: 20_000, pieces: 1 }).reason).toBe(
      'below_min_order',
    );
    expect(codChoice(quote({ minItems: 2 }), { discountPaise: 0, pieces: 1 }).reason).toBe('below_min_items');
  });

  it('an older API without eligibility keeps the old rule', () => {
    const old = { totalPaise: 100_000, cod: { allowed: true, reason: null, capPaise: 500_000 } };
    expect(codChoice(old, { discountPaise: 0, pieces: 1 }).available).toBe(true);
  });
});

describe('codNextAction — the one next step', () => {
  it('maps each reason to at most one action', () => {
    expect(codNextAction('sign_in_required', false)).toBe('sign_in');
    expect(codNextAction('not_approved', true)).toBe('request');
    expect(codNextAction('rejected', false)).toBeNull();
    expect(codNextAction('rejected', true)).toBe('request');
    expect(codNextAction('request_pending', false)).toBeNull();
    expect(codNextAction('ustaad_not_verified', false)).toBe('ustaad_verify');
    expect(codNextAction('ustaad_not_member', false)).toBe('ustaad_join');
    expect(codNextAction('over_cap', false)).toBeNull();
    expect(codNextAction('disabled', false)).toBeNull();
  });
});
