import { describe, expect, it } from 'vitest';
import {
  FleetApplicationSchema,
  TradeApplicationSchema,
  FLEET_NEEDS,
  TRADE_BUSINESS_TYPES,
  TRADE_SPEND_BANDS,
  TRADE_REVOKE_REASONS,
} from '../src/business-applications';
import { businessApplicationMachine, tradeAccountMachine } from '../src/state';

const trade = {
  businessName: 'Sahu Motors',
  businessType: 'garage',
  gstin: '22ABVCS4888H1ZL',
  pincode: '492004',
  spendBand: '25k_to_1l',
  categories: ['engine-oil', 'brake-pads'],
  consent: true,
};
const fleet = {
  companyName: 'Raipur Cabs Pvt Ltd',
  fleet: { w2: 0, w3: 4, w4: 25 },
  pincode: '492004',
  contactName: 'Asha Verma',
  phone: '9876543210',
  email: 'Asha@Example.com',
  needs: ['scheduled_maintenance', 'monthly_billing'],
  note: 'Mostly sedans',
  consent: true,
};

describe('trade application (audience entry design item 3)', () => {
  it('parses a valid application; the GSTIN is normalised', () => {
    const a = TradeApplicationSchema.parse({ ...trade, gstin: ' 22abvcs4888h1zl ' });
    expect(a.gstin).toBe('22ABVCS4888H1ZL');
  });
  it('GSTIN is optional but checked when present (checksum)', () => {
    expect(TradeApplicationSchema.safeParse({ ...trade, gstin: undefined }).success).toBe(true);
    expect(TradeApplicationSchema.safeParse({ ...trade, gstin: '' }).success).toBe(true);
    expect(TradeApplicationSchema.parse({ ...trade, gstin: '' }).gstin).toBeUndefined();
    expect(TradeApplicationSchema.safeParse({ ...trade, gstin: '22ABVCS4888H1ZZ' }).success).toBe(false);
  });
  it('enums are codes; unknown values, duplicates and mass-assignment are refused', () => {
    expect(TradeApplicationSchema.safeParse({ ...trade, businessType: 'plumber' }).success).toBe(false);
    expect(TradeApplicationSchema.safeParse({ ...trade, spendBand: '5' }).success).toBe(false);
    expect(TradeApplicationSchema.safeParse({ ...trade, categories: [] }).success).toBe(false);
    expect(TradeApplicationSchema.safeParse({ ...trade, categories: ['a-b', 'a-b'] }).success).toBe(false);
    expect(TradeApplicationSchema.safeParse({ ...trade, categories: ['Bad Slug'] }).success).toBe(false);
    expect(TradeApplicationSchema.safeParse({ ...trade, status: 'approved' }).success).toBe(false);
    expect(TradeApplicationSchema.safeParse({ ...trade, userId: 'x' }).success).toBe(false);
    expect(TradeApplicationSchema.safeParse({ ...trade, consent: false }).success).toBe(false);
    expect(TradeApplicationSchema.safeParse({ ...trade, pincode: '12345' }).success).toBe(false);
  });
  it('lists are stable codes', () => {
    expect(TRADE_BUSINESS_TYPES).toContain('mechanic');
    expect(TRADE_SPEND_BANDS.length).toBeGreaterThan(2);
    expect(TRADE_REVOKE_REASONS).toContain('misuse');
  });
});

describe('fleet application', () => {
  it('parses; phone gets +91, email lower-cased', () => {
    const a = FleetApplicationSchema.parse(fleet);
    expect(a.phone).toBe('+919876543210');
    expect(a.email).toBe('asha@example.com');
  });
  it('needs at least one vehicle and one need; bounded ints', () => {
    expect(FleetApplicationSchema.safeParse({ ...fleet, fleet: { w2: 0, w3: 0, w4: 0 } }).success).toBe(
      false,
    );
    expect(FleetApplicationSchema.safeParse({ ...fleet, fleet: { w2: -1, w3: 0, w4: 3 } }).success).toBe(
      false,
    );
    expect(FleetApplicationSchema.safeParse({ ...fleet, fleet: { w2: 1.5, w3: 0, w4: 3 } }).success).toBe(
      false,
    );
    expect(FleetApplicationSchema.safeParse({ ...fleet, fleet: { w2: 100001, w3: 0, w4: 3 } }).success).toBe(
      false,
    );
    expect(FleetApplicationSchema.safeParse({ ...fleet, needs: [] }).success).toBe(false);
    expect(FleetApplicationSchema.safeParse({ ...fleet, needs: ['free_money'] }).success).toBe(false);
    expect(FLEET_NEEDS).toContain('priority_slots');
  });
  it('note is optional, bounded; extra keys refused', () => {
    expect(FleetApplicationSchema.safeParse({ ...fleet, note: undefined }).success).toBe(true);
    expect(FleetApplicationSchema.safeParse({ ...fleet, note: 'x'.repeat(501) }).success).toBe(false);
    expect(FleetApplicationSchema.safeParse({ ...fleet, userId: 'x' }).success).toBe(false);
  });
});

describe('state machines', () => {
  it('business application: review, decide, close (fleet lead)', () => {
    expect(businessApplicationMachine.canActor('new', 'in_review', 'admin')).toBe(true);
    expect(businessApplicationMachine.canActor('in_review', 'approved', 'admin')).toBe(true);
    expect(businessApplicationMachine.canActor('new', 'closed', 'admin')).toBe(true);
    expect(businessApplicationMachine.can('approved', 'rejected')).toBe(false);
    expect(businessApplicationMachine.isTerminal('closed')).toBe(true);
  });
  it('trade account: verified <-> revoked, staff only', () => {
    expect(tradeAccountMachine.canActor('verified', 'revoked', 'admin')).toBe(true);
    expect(tradeAccountMachine.canActor('revoked', 'verified', 'admin')).toBe(true);
    expect(tradeAccountMachine.canActor('verified', 'revoked', 'customer')).toBe(false);
  });
});
