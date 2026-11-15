import { describe, expect, it } from 'vitest';
import { buildCases } from '../e2e/state-audit/cases.ts';
import { mocksFor } from '../e2e/state-audit/api-mode/fixtures.ts';
import { filledFieldValue } from '../e2e/state-audit/fill-values.ts';
import { latinOffenders } from './hindi-allowlist.ts';

const hiCases = (code: string) =>
  buildCases().filter((c) => c.realApi && c.code === code && c.locale === 'hi');

function bodiesOf(code: string): string {
  const out: string[] = [];
  for (const c of hiCases(code))
    for (const mock of mocksFor(c)) {
      const r = mock.reply({ c, method: mock.method, path: '/x', query: new URLSearchParams(), body: null });
      if (r.body) out.push(JSON.stringify(r.body));
    }
  return out.join('\n');
}

describe('batch 3c-4: Hindi fixtures answer the Hindi field of the real DTO', () => {
  it('the quote thread line title is Hindi on /hi (QuoteLineDto.title is in the request locale)', () => {
    const text = bodiesOf('API-QUOTE-THREAD');
    expect(text).not.toContain('Audit engine oil');
    expect(text).toContain('ऑडिट इंजन ऑयल');
  });

  it('the admin shop inventory product name is Hindi on /hi (the API takes ?locale=hi)', () => {
    const text = bodiesOf('API-ADM-SHOPS');
    expect(text).not.toMatch(/Engine oil/);
    expect(text).toContain('इंजन ऑयल');
  });

  it('an address typed into a filled form is Hindi on /hi and unchanged on /en', () => {
    expect(latinOffenders(filledFieldValue('text', 'addressLine', 'hi'))).toEqual([]);
    expect(filledFieldValue('text', 'addressLine', 'en')).toBe(
      'Plot 14, Near Hanuman Mandir, Shankar Nagar Main Road',
    );
  });

  it('typed phone, email, PIN and GSTIN stay codes in both locales', () => {
    expect(filledFieldValue('tel', 'x', 'hi')).toBe('9876543210');
    expect(filledFieldValue('email', 'x', 'hi')).toBe('ravi.sahu@example.com');
    expect(filledFieldValue('text', 'pincode', 'hi')).toBe('492001');
    expect(filledFieldValue('text', 'gstin', 'hi')).toBe('22ABVCS4888H1ZL');
  });
});
