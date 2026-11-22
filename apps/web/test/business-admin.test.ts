/**
 * Admin console, business applications (audience entry QA 2026-11-22, bugs 3, 4 and 6): a staff member deciding their
 * own application gets a clear message, "Parts bought" shows category labels (not raw codes), focus lands on the status
 * line after revoke/restore/decide, and checkout never promises a "GST invoice" before invoices are issued (Q97).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { adminBusinessErrorKey, categoryLabels } from '../src/lib/business-apply-view';

const read = (p: string) => readFileSync(resolve(__dirname, '..', 'src', p), 'utf8');
interface Msgs {
  business: Record<string, string>;
}

describe('admin refusals on a business application', () => {
  it('staff deciding their own application or trade account is explained, not "try again in a moment"', () => {
    expect(adminBusinessErrorKey('STAFF_SELF_CHANGE')).toBe('admin_err_selfDecision');
    expect(adminBusinessErrorKey('NOT_A_TRADE_APPLICATION')).toBe('admin_err_notTrade');
    expect(adminBusinessErrorKey('SOMETHING_ELSE')).toBeNull();
  });
  it('the message tells them to ask another staff member, in English and Hindi', () => {
    expect((en as Msgs).business.admin_err_selfDecision).toMatch(/another staff member/);
    expect((hi as Msgs).business.admin_err_selfDecision).toMatch(/[ऀ-ॿ]/);
    expect((hi as Msgs).business.admin_err_selfDecision).not.toBe(
      (en as Msgs).business.admin_err_selfDecision,
    );
  });
  it('the card uses it', () => {
    expect(read('components/portal/admin-business-api.tsx')).toMatch(/adminBusinessErrorKey\(/);
  });
});

describe('trade "Parts bought"', () => {
  const options = [
    { slug: 'tyres', name: 'Tyres' },
    { slug: 'lubricants', name: 'Lubricants' },
  ];
  it('shows the labels customers see, and falls back to the code only for a category no longer listed', () => {
    expect(categoryLabels(['tyres', 'lubricants'], options)).toBe('Tyres, Lubricants');
    expect(categoryLabels(['tyres', 'gone'], options)).toBe('Tyres, gone');
    expect(categoryLabels([], options)).toBe('');
  });
  it('the details load the labels in the admin language', () => {
    const src = read('components/portal/admin-business-api.tsx');
    expect(src).toMatch(/fetchCategoryOptions\(locale\)/);
    expect(src).toMatch(/categoryLabels\(/);
    expect(src).not.toMatch(/app\.categories\.join/);
  });
});

describe('focus after a decision (accessibility)', () => {
  const src = read('components/portal/admin-business-api.tsx');
  it('a polite status line with tabIndex -1 takes focus once an action succeeds', () => {
    expect(src).toMatch(/role="status"/);
    expect(src).toMatch(/tabIndex=\{-1\}/);
    expect(src).toMatch(/statusRef\.current\?\.focus\(\)/);
  });
  it('the done messages exist in English and Hindi', () => {
    for (const k of ['admin_done_decided', 'admin_done_revoked', 'admin_done_restored']) {
      expect((en as Msgs).business[k], `en ${k}`).toBeTruthy();
      expect((hi as Msgs).business[k], `hi ${k}`).toMatch(/[ऀ-ॿ]/);
    }
  });
});

describe('no promise of a "GST invoice" (Q97, ruling R4)', () => {
  it('no customer-facing string says "GST invoice" or the Hindi "GST इनवॉइस"', () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        // Admin and account-deletion text about records the law makes us keep is not a promise to the customer.
        if (/GST invoice|GST इनवॉइस|जीएसटी इनवॉइस/i.test(node) && !path.includes('deletion'))
          offenders.push(path);
      } else if (node && typeof node === 'object')
        for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(en, 'en');
    walk(hi, 'hi');
    expect(offenders).toEqual([]);
  });
});
