/**
 * Business application form (audience entry design 2026-11-22, item 3 + accessibility requirements): the pure
 * checks, how an API refusal shows, the en + hi keys, and source guards for the accessibility points the design
 * names (labelled fields, fieldsets with legends, GSTIN hint by aria-describedby, error summary that takes focus,
 * focus on the success heading, sign-in prompt with loginHref).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import {
  businessErrorView,
  fleetBody,
  mobileDigits,
  tradeBody,
  validateFleet,
  validateTrade,
  type FleetValues,
  type TradeValues,
} from '../src/lib/business-apply-view';

const trade: TradeValues = {
  businessName: 'Sahu Motors',
  businessType: 'garage',
  gstin: '',
  pincode: '492004',
  spendBand: '25k_to_1l',
  categories: ['lubricants'],
  consent: true,
};
const fleet: FleetValues = {
  companyName: 'Raipur Cabs',
  w2: '',
  w3: '4',
  w4: '25',
  pincode: '492004',
  contactName: 'Asha Verma',
  phone: '+91 98765 43210',
  email: 'asha@example.com',
  needs: ['monthly_billing'],
  note: '',
  consent: true,
};

describe('trade checks', () => {
  it('a valid form has no errors and sends codes only (no status, no user)', () => {
    expect(validateTrade(trade)).toEqual({});
    expect(tradeBody({ ...trade, gstin: ' 22abvcs4888h1zl ' })).toEqual({
      businessName: 'Sahu Motors',
      businessType: 'garage',
      gstin: '22ABVCS4888H1ZL',
      pincode: '492004',
      spendBand: '25k_to_1l',
      categories: ['lubricants'],
      consent: true,
    });
    expect('gstin' in tradeBody(trade)).toBe(false);
  });
  it('flags every bad field with a message key', () => {
    expect(
      validateTrade({
        businessName: 'a',
        businessType: '',
        gstin: '22ABVCS4888H1ZZ',
        pincode: '12',
        spendBand: 'lots',
        categories: [],
        consent: false,
      }),
    ).toEqual({
      businessName: 'err_businessName',
      businessType: 'err_businessType',
      gstin: 'err_gstin',
      pincode: 'err_pincode',
      spendBand: 'err_spendBand',
      categories: 'err_categories',
      consent: 'err_consent',
    });
  });
});

describe('fleet checks', () => {
  it('valid; the number is cleaned, empty counts are zero', () => {
    expect(validateFleet(fleet)).toEqual({});
    expect(fleetBody(fleet)).toMatchObject({ phone: '9876543210', fleet: { w2: 0, w3: 4, w4: 25 } });
    expect(mobileDigits('+919876543210')).toBe('9876543210');
  });
  it('needs a vehicle, sane numbers, a valid email and a need', () => {
    expect(validateFleet({ ...fleet, w3: '0', w4: '' }).fleet).toBe('err_fleet');
    expect(validateFleet({ ...fleet, w3: '-1' }).fleet).toBe('err_fleet');
    expect(validateFleet({ ...fleet, w3: '1.5' }).fleet).toBe('err_fleet');
    expect(validateFleet({ ...fleet, w4: '100001' }).fleet).toBe('err_fleet');
    expect(validateFleet({ ...fleet, email: 'nope' }).email).toBe('err_email');
    expect(validateFleet({ ...fleet, phone: '12345' }).phone).toBe('err_phone');
    expect(validateFleet({ ...fleet, needs: [] }).needs).toBe('err_needs');
    expect(validateFleet({ ...fleet, needs: ['free_money'] }).needs).toBe('err_needs');
    expect(validateFleet({ ...fleet, note: 'x'.repeat(501) }).note).toBe('err_note');
  });
});

describe('API refusals show as messages, never raw codes', () => {
  it.each([
    ['TURNSTILE_FAILED', 'errForm_turnstile'],
    ['RATE_LIMITED', 'errForm_rate'],
    ['NETWORK', 'errForm_unavailable'],
    ['HTTP_503', 'errForm_unavailable'],
    ['TRADE_APPLICATION_OPEN', 'errForm_open'],
    ['TRADE_ALREADY_VERIFIED', 'errForm_verified'],
    ['VERIFICATION_REQUIRED', 'errForm_verify'],
    ['AUTH_REQUIRED', 'errForm_auth'],
    ['CATEGORIES', 'errForm_categories'],
    ['SOMETHING_NEW', 'errForm_generic'],
  ])('%s', (code, key) => {
    expect(businessErrorView(code)).toEqual({ form: key, pincode: false });
  });
  it('an unserved PIN code points at the PIN field', () => {
    expect(businessErrorView('PINCODE_NOT_SERVED')).toEqual({ form: null, pincode: true });
  });
});

interface Messages {
  business: Record<string, string>;
}
describe('locale files', () => {
  const keys = (m: Messages) => Object.keys(m.business).sort();
  it('en and hi have the same business keys, and Hindi is not the English text', () => {
    expect(keys(hi as Messages)).toEqual(keys(en as Messages));
    for (const k of keys(en)) {
      const h = (hi as Messages).business[k] ?? '';
      expect(h.length, k).toBeGreaterThan(0);
      if (/[a-z]{4,}/i.test((en as Messages).business[k] ?? '') && !/^(GSTIN|MechDost Uptime)$/.test(h))
        expect(h, k).not.toBe((en as Messages).business[k]);
    }
  });
  it('every enum code of the shared lists has a label', async () => {
    const codes = await import('@mechdost/shared/business-codes');
    const b = (en as Messages).business;
    for (const t of codes.TRADE_BUSINESS_TYPES) expect(b[`type_${t}`], t).toBeTruthy();
    for (const s of codes.TRADE_SPEND_BANDS) expect(b[`spend_${s}`], s).toBeTruthy();
    for (const n of codes.FLEET_NEEDS) expect(b[`need_${n}`], n).toBeTruthy();
    for (const r of codes.TRADE_REVOKE_REASONS) expect(b[`admin_revoke_${r}`], r).toBeTruthy();
  });
});

const read = (p: string) => readFileSync(resolve(__dirname, '..', 'src', p), 'utf8');

describe('accessibility source guards (design: Apply form)', () => {
  const form = ['business-apply-form', 'trade-form', 'fleet-form', 'form-parts']
    .map((f) => read(`components/business/${f}.tsx`))
    .join('\n');
  it('groups of choices are fieldsets with legends; every input has a visible label', () => {
    expect((form.match(/<fieldset/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((form.match(/<legend/g) ?? []).length).toBe((form.match(/<fieldset/g) ?? []).length);
    expect(form).toMatch(/<label[^>]*htmlFor=/);
    expect(form).not.toMatch(/placeholder=/);
  });
  it('required fields say so in text; the GSTIN hint is linked by aria-describedby; numbers are numeric', () => {
    expect(form).toMatch(/t\('required'\)/);
    expect(form).toMatch(/inputMode="numeric"/);
    expect(form).toMatch(/autoComplete="off"/);
    expect(form).toMatch(/hint=\{t\('gstinHint'\)\}/);
    expect(form).toMatch(/\$\{id\}-hint/);
    expect(form).toMatch(/aria-describedby/);
  });
  it('errors are inline (aria-invalid) and a focusable summary links to each field', () => {
    expect(form).toMatch(/aria-invalid/);
    expect(form).toMatch(/tabIndex=\{-1\}/);
    expect(form).toMatch(/summaryRef : formErrorRef\)\.current\?\.focus\(\)/);
    expect(form).toMatch(/href=\{`#/);
  });
  it('success moves focus to the heading that shows the application code as text', () => {
    expect(form).toMatch(/successRef\.current\?\.focus\(\)/);
    expect(form).toMatch(/codeLabel/);
  });
  it('signed-out trade shows a heading and a sign-in link returning here (loginHref)', () => {
    expect(form).toMatch(/loginHref\(/);
    expect(form).toMatch(/signinTitle/);
  });
  it('one primary action, no timeouts on input', () => {
    expect((form.match(/type="submit"/g) ?? []).length).toBe(1);
    expect(form).not.toMatch(/setTimeout\(/);
  });
  it('the page passes the business namespace and keeps the form off the shop and cart bundles', () => {
    const page = read('app/[locale]/business/apply/page.tsx');
    expect(page).toMatch(/namespaces=\{\[[^\]]*'business'/);
    for (const hot of ['app/[locale]/shop/page.tsx', 'app/[locale]/cart/page.tsx'])
      expect(read(hot)).not.toMatch(/business-apply|lib\/business-api/);
  });
});

describe('badge and checkout prefill wiring', () => {
  it('the account overview badge and the checkout prefill load lazily and never require the GSTIN', () => {
    const account = read('components/account/account-area.tsx');
    expect(account).toMatch(/trade-badge/);
    const checkout = read('components/commerce/checkout-form.tsx');
    expect(checkout).toMatch(/import\('@\/lib\/business-api'\)/);
    expect(checkout).toMatch(/tradeGstinNote/);
    expect(checkout).not.toMatch(/from '@\/lib\/business-api'/);
  });
});
