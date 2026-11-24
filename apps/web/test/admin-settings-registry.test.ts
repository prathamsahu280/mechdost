import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTING_KEYS } from '@mechdost/shared/settings';
import {
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_IDS,
  categoryOfKey,
  matchesQuery,
  riskOfChange,
} from '@/lib/admin-settings-registry';

const messages = (lang: 'en' | 'hi') =>
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'i18n', `${lang}.json`),
      'utf8',
    ),
  ) as { adminSettings: Record<string, string> };

describe('settings categories (design 2026-11-24)', () => {
  it('puts every operational setting in a category that exists', () => {
    for (const key of SETTING_KEYS) expect(SETTINGS_CATEGORY_IDS).toContain(categoryOfKey(key));
  });

  it('leaves nothing in the catch-all today (a new key must be placed on purpose)', () => {
    expect(SETTING_KEYS.filter((k) => categoryOfKey(k) === 'other')).toEqual([]);
  });

  it('files money in and out under Payments and the rest of checkout under Orders', () => {
    expect(categoryOfKey('checkout.cod_cap_paise')).toBe('payments');
    expect(categoryOfKey('checkout.online_payment_minutes')).toBe('payments');
    expect(categoryOfKey('refunds.approval_sla_hours')).toBe('payments');
    expect(categoryOfKey('checkout.free_delivery_min_paise')).toBe('orders');
    expect(categoryOfKey('orders.acceptance_timeout_min')).toBe('orders');
    expect(categoryOfKey('coins.expiry_days')).toBe('coins');
    expect(categoryOfKey('api.ip_flood_per_minute')).toBe('limits');
  });

  it('takes a roadside key without any other change (the extension point)', () => {
    expect(categoryOfKey('roadside.advance_paise')).toBe('roadside');
    expect(categoryOfKey('something.new')).toBe('other');
  });

  it('has a name and a description for every category in English and Hindi', () => {
    for (const lang of ['en', 'hi'] as const) {
      const m = messages(lang).adminSettings;
      for (const c of SETTINGS_CATEGORIES) {
        expect(m[`cat_${c.id}`], `${lang} cat_${c.id}`).toBeTruthy();
        expect(m[`cat_${c.id}_help`], `${lang} cat_${c.id}_help`).toBeTruthy();
      }
    }
  });

  it('has a one-line help for every operational setting in both languages', () => {
    for (const lang of ['en', 'hi'] as const) {
      const m = messages(lang).adminSettings;
      for (const key of SETTING_KEYS)
        expect(m[`help_${key.replace('.', '_')}`], `${lang} ${key}`).toBeTruthy();
    }
  });

  it('has the same adminSettings keys in English and Hindi', () => {
    expect(Object.keys(messages('hi').adminSettings).toSorted()).toEqual(
      Object.keys(messages('en').adminSettings).toSorted(),
    );
  });
});

describe('settings search', () => {
  const text = 'Largest cash-on-delivery order Cash on delivery is not offered above this order total';
  it('matches every word, in any case', () => {
    expect(matchesQuery(text, 'cash DELIVERY')).toBe(true);
    expect(matchesQuery(text, 'cash refund')).toBe(false);
    expect(matchesQuery(text, '   ')).toBe(true);
  });
  it('matches Devanagari text', () => {
    const hi = 'कैश ऑन डिलीवरी बंद हो जाता है';
    expect(matchesQuery(hi, 'डिलीवरी')).toBe(true);
    expect(matchesQuery(hi, 'डिलीवरी रिफ़ंड')).toBe(false);
  });
});

describe('risky settings changes', () => {
  it('flags switching cash on delivery off, assistant off and coins off', () => {
    expect(riskOfChange('checkout.cod_cap_paise', 500_000, 0)).toBe('risk_codOff');
    expect(riskOfChange('assistant.daily_messages', 500, 0)).toBe('risk_assistantOff');
    expect(riskOfChange('coins.max_redeem_bp', 1000, 0)).toBe('risk_redeemOff');
  });
  it('flags turning on verified email and the seller agreement, but not turning them off', () => {
    expect(riskOfChange('customers.require_verified_email', false, true)).toBe('risk_verifiedEmail');
    expect(riskOfChange('customers.require_verified_email', true, false)).toBeNull();
    expect(riskOfChange('partners.agreement_required', false, true)).toBe('risk_agreement');
  });
  it('flags only a lower API limit', () => {
    expect(riskOfChange('api.signed_in_per_minute', 300, 100)).toBe('risk_apiLimit');
    expect(riskOfChange('api.signed_in_per_minute', 300, 600)).toBeNull();
  });
  it('is quiet for ordinary edits and unchanged values', () => {
    expect(riskOfChange('orders.acceptance_timeout_min', 15, 30)).toBeNull();
    expect(riskOfChange('checkout.cod_cap_paise', 0, 0)).toBeNull();
  });
});
