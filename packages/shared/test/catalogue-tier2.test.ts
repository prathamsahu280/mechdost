/**
 * Shapes of catalogue tier 2 (design 2026-11-15 items 4, 6, 7): recommendation rules need both languages and two
 * different categories, the recommendation query takes only real slugs, the waitlist takes a PIN and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { RecoQuerySchema, RecoRuleInputSchema, RECO_SOURCES_MAX } from '../src/recommendations';
import { WaitlistJoinBodySchema } from '../src/waitlist';

const A = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';
const B = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c';
const rule = {
  triggerCategoryId: A,
  suggestCategoryId: B,
  label: 'Goes well with your oil',
  labelHi: 'आपके ऑयल के साथ अच्छा चलता है',
  priority: 5,
  active: true,
};

describe('recommendation rule input', () => {
  it('accepts a rule with English and Hindi reasons', () => {
    expect(RecoRuleInputSchema.safeParse(rule).success).toBe(true);
  });
  it('refuses a Hindi reason in Latin script, a self-suggesting rule and unknown fields', () => {
    expect(RecoRuleInputSchema.safeParse({ ...rule, labelHi: 'goes well' }).success).toBe(false);
    expect(RecoRuleInputSchema.safeParse({ ...rule, suggestCategoryId: A }).success).toBe(false);
    expect(RecoRuleInputSchema.safeParse({ ...rule, createdBy: A }).success).toBe(false);
    expect(RecoRuleInputSchema.safeParse({ ...rule, priority: 0 }).success).toBe(false);
  });
});

describe('recommendation query', () => {
  it('splits slugs and refuses anything that is not a slug or is too many', () => {
    const ok = RecoQuerySchema.parse({ slot: 'cart', slugs: 'a-b,c-d' });
    expect(ok.slugs).toEqual(['a-b', 'c-d']);
    expect(RecoQuerySchema.safeParse({ slot: 'cart', slugs: "x'; drop" }).success).toBe(false);
    const many = Array.from({ length: RECO_SOURCES_MAX + 1 }, (_, i) => `p${String(i)}`).join(',');
    expect(RecoQuerySchema.safeParse({ slot: 'cart', slugs: many }).success).toBe(false);
  });
});

describe('waitlist body', () => {
  it('takes a six-digit PIN and nothing else (no typed email or phone)', () => {
    expect(WaitlistJoinBodySchema.safeParse({ pincode: '492001' }).success).toBe(true);
    expect(WaitlistJoinBodySchema.safeParse({ pincode: '012345' }).success).toBe(false);
    expect(WaitlistJoinBodySchema.safeParse({ pincode: '492001', email: 'a@b.co' }).success).toBe(false);
  });
});
