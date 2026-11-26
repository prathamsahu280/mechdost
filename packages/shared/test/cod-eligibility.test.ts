import { describe, expect, it } from 'vitest';
import {
  COD_DECISION_REASONS,
  COD_REQUEST_REASONS,
  COD_REVOKE_REASONS,
  codCartRule,
  codEligibility,
  type CodEligibilityInput,
  type CodSwitches,
  ustaadLevelMeets,
} from '../src/cod-eligibility';
import { codRequestMachine } from '../src/state';

const DEFAULTS: CodSwitches = { everyone: false, approved: true, ustaad: true, ustaadMinLevel: 0 };
const base = (over: Partial<CodEligibilityInput> = {}): CodEligibilityInput => ({
  switches: DEFAULTS,
  signedIn: true,
  approval: { state: 'none', capPaise: null, canRequestAgainAt: null },
  ustaad: null,
  now: new Date('2026-11-26T10:00:00Z'),
  ...over,
});
const verified = {
  verificationState: 'verified',
  status: 'active',
  level: 'naya',
  restrictedMode: 'none',
  perksFrozenUntil: null,
} as const;

describe('codEligibility — the rule matrix (founder ruling 2026-11-26)', () => {
  it('a normal signed-in customer gets no cash on delivery by default and may ask for it', () => {
    expect(codEligibility(base())).toEqual({
      eligible: false,
      via: null,
      reason: 'not_approved',
      canRequest: true,
      capPaise: null,
    });
  });

  it('"everyone" on brings back the old behaviour, also for guests', () => {
    const r = codEligibility(base({ signedIn: false, switches: { ...DEFAULTS, everyone: true } }));
    expect(r).toMatchObject({ eligible: true, via: 'everyone' });
  });

  it('a guest is asked to sign in while any personal route is on', () => {
    expect(codEligibility(base({ signedIn: false }))).toMatchObject({
      eligible: false,
      reason: 'sign_in_required',
      canRequest: false,
    });
  });

  it('every switch off: nobody, and nothing to ask for', () => {
    const off = { everyone: false, approved: false, ustaad: false, ustaadMinLevel: 0 };
    expect(codEligibility(base({ switches: off }))).toMatchObject({
      eligible: false,
      reason: 'disabled',
      canRequest: false,
    });
    expect(codEligibility(base({ switches: off, signedIn: false }))).toMatchObject({ reason: 'disabled' });
  });

  it('an approved customer is eligible with their personal cap', () => {
    const r = codEligibility(
      base({ approval: { state: 'approved', capPaise: 200_000, canRequestAgainAt: null } }),
    );
    expect(r).toEqual({
      eligible: true,
      via: 'approved',
      reason: null,
      canRequest: false,
      capPaise: 200_000,
    });
  });

  it('an approval does not count when the approved-customers switch is off', () => {
    const r = codEligibility(
      base({
        switches: { ...DEFAULTS, approved: false, ustaad: false },
        approval: { state: 'approved', capPaise: null, canRequestAgainAt: null },
      }),
    );
    expect(r).toMatchObject({ eligible: false, reason: 'disabled', canRequest: false });
  });

  it('a pending request says so and cannot be sent twice', () => {
    expect(
      codEligibility(base({ approval: { state: 'pending', capPaise: null, canRequestAgainAt: null } })),
    ).toMatchObject({
      reason: 'request_pending',
      canRequest: false,
    });
  });

  it('rejected and revoked wait for the reapply date; expired may ask again at once', () => {
    const later = new Date('2026-11-30T00:00:00Z');
    const earlier = new Date('2026-11-20T00:00:00Z');
    expect(
      codEligibility(base({ approval: { state: 'rejected', capPaise: null, canRequestAgainAt: later } })),
    ).toMatchObject({
      reason: 'rejected',
      canRequest: false,
    });
    expect(
      codEligibility(base({ approval: { state: 'rejected', capPaise: null, canRequestAgainAt: earlier } })),
    ).toMatchObject({
      reason: 'rejected',
      canRequest: true,
    });
    expect(
      codEligibility(base({ approval: { state: 'revoked', capPaise: null, canRequestAgainAt: later } })),
    ).toMatchObject({
      reason: 'revoked',
      canRequest: false,
    });
    expect(
      codEligibility(base({ approval: { state: 'expired', capPaise: null, canRequestAgainAt: null } })),
    ).toMatchObject({
      reason: 'expired',
      canRequest: true,
    });
  });

  it('a verified, active Ustaad member is eligible', () => {
    expect(codEligibility(base({ ustaad: verified }))).toMatchObject({
      eligible: true,
      via: 'ustaad',
      capPaise: null,
    });
  });

  it('an Ustaad member who is not verified is pointed at verification (approval route also off)', () => {
    const r = codEligibility(
      base({
        switches: { ...DEFAULTS, approved: false },
        ustaad: { ...verified, verificationState: 'pending_verification' },
      }),
    );
    expect(r).toMatchObject({ eligible: false, reason: 'ustaad_not_verified', canRequest: false });
  });

  it('with only the Ustaad route on, a non-member is told to join', () => {
    const r = codEligibility(base({ switches: { ...DEFAULTS, approved: false } }));
    expect(r).toMatchObject({ eligible: false, reason: 'ustaad_not_member', canRequest: false });
  });

  it('banned, left, restricted, frozen or minor-report members do not get the perk', () => {
    const now = new Date('2026-11-26T10:00:00Z');
    for (const m of [
      { ...verified, status: 'banned' },
      { ...verified, status: 'left' },
      { ...verified, status: 'restricted' },
      { ...verified, restrictedMode: 'minor_report' },
      { ...verified, perksFrozenUntil: new Date('2026-12-01T00:00:00Z') },
    ])
      expect(codEligibility(base({ now, ustaad: m })).eligible).toBe(false);
    // A freeze that has ended no longer counts.
    expect(
      codEligibility(
        base({ now, ustaad: { ...verified, perksFrozenUntil: new Date('2026-11-01T00:00:00Z') } }),
      ).eligible,
    ).toBe(true);
  });

  it('a minimum level keeps lower levels out', () => {
    const sw = { ...DEFAULTS, approved: false, ustaadMinLevel: 1 };
    expect(codEligibility(base({ switches: sw, ustaad: verified }))).toMatchObject({
      eligible: false,
      reason: 'ustaad_level_low',
    });
    expect(codEligibility(base({ switches: sw, ustaad: { ...verified, level: 'pakka' } })).eligible).toBe(
      true,
    );
    expect(ustaadLevelMeets('master', 3)).toBe(true);
    expect(ustaadLevelMeets('apprentice', 0)).toBe(false);
    expect(ustaadLevelMeets('ustaad_pending', 0)).toBe(false);
  });

  it('a pending request wins over the Ustaad hint (the customer already acted)', () => {
    const r = codEligibility(
      base({
        approval: { state: 'pending', capPaise: null, canRequestAgainAt: null },
        ustaad: { ...verified, verificationState: 'unverified' },
      }),
    );
    expect(r.reason).toBe('request_pending');
  });
});

describe('codCartRule — minimum order and pieces for eligible customers', () => {
  it('defaults (₹0, 1 piece) never refuse', () => {
    expect(codCartRule({ payablePaise: 100, pieces: 1, minOrderPaise: 0, minItems: 1 })).toBeNull();
  });
  it('below the minimum order or the minimum pieces', () => {
    expect(codCartRule({ payablePaise: 49_999, pieces: 3, minOrderPaise: 50_000, minItems: 1 })).toBe(
      'below_min_order',
    );
    expect(codCartRule({ payablePaise: 90_000, pieces: 1, minOrderPaise: 50_000, minItems: 2 })).toBe(
      'below_min_items',
    );
  });
});

describe('codRequestMachine', () => {
  it('pending → approved | rejected | withdrawn; approved → revoked | expired; terminal states stay', () => {
    expect(codRequestMachine.canActor('pending', 'approved', 'admin')).toBe(true);
    expect(codRequestMachine.canActor('pending', 'approved', 'customer')).toBe(false);
    expect(codRequestMachine.canActor('pending', 'rejected', 'admin')).toBe(true);
    expect(codRequestMachine.canActor('pending', 'withdrawn', 'customer')).toBe(true);
    expect(codRequestMachine.canActor('approved', 'revoked', 'admin')).toBe(true);
    expect(codRequestMachine.canActor('approved', 'expired', 'system')).toBe(true);
    expect(codRequestMachine.can('rejected', 'approved')).toBe(false);
    expect(codRequestMachine.can('revoked', 'approved')).toBe(false);
  });
});

describe('codes are ML-ready enums', () => {
  it('reason lists are non-empty and end with other', () => {
    for (const list of [COD_REQUEST_REASONS, COD_DECISION_REASONS, COD_REVOKE_REASONS]) {
      expect(list.length).toBeGreaterThan(2);
      expect(list.at(-1)).toBe('other');
    }
  });
});
