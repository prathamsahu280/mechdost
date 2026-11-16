/** Real-API QA pass 5 (2026-11-16): the three notes, one describe per note (docs/qa/real-api-pass-5-2026-11-16.md). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { anyApproved } from '../src/lib/estimate-summary';
import { acceptBlocked } from '../src/lib/quote-views';

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const both = (ns: string, key: string) => {
  const e = (en as unknown as Record<string, Record<string, string>>)[ns]?.[key];
  const h = (hi as unknown as Record<string, Record<string, string>>)[ns]?.[key];
  return { e, h };
};
const deva = /[ऀ-ॿ]/;

describe('note 1: a quote that cannot be accepted for lack of stock disables "Accept and pay"', () => {
  it('blocks only on the stock error', () => {
    expect(acceptBlocked('api_err_stock')).toBe(true);
    expect(acceptBlocked('api_err_codCap')).toBe(false);
    expect(acceptBlocked('stale')).toBe(false);
    expect(acceptBlocked(null)).toBe(false);
  });
  it('the offer card disables the button and links the reason with aria-describedby', () => {
    const src = read('components/quotes/quote-thread-api.tsx');
    expect(src).toContain('acceptBlocked(problem)');
    // Blocked: the primary button becomes the next action (message MechDost) and points at the reason.
    expect(src).toContain("t('api_askSource')");
    expect(src).toContain("aria-describedby={blocked ? 'quote-accept-problem'");
    expect(src).toContain("document.getElementById('quote-message')?.focus()");
    expect(src).toContain('id="quote-accept-problem"');
  });
  it('offers the next action (message MechDost) in en and hi', () => {
    const { e, h } = both('quote', 'api_askSource');
    expect(e).toBeTruthy();
    expect(h).toMatch(deva);
  });
});

describe('note 2: the unpaid service bill has one primary way to pay', () => {
  it('the bill card hides its "pay at the workshop" banner when online payment is offered', () => {
    expect(read('components/workshops/service-estimate.tsx')).toContain('onlinePay');
    expect(read('components/workshops/request-view-api.tsx')).toContain('onlinePay');
  });
  it('the online block mentions the workshop once, as the secondary line', () => {
    const { e, h } = both('request', 'api_payOnlineHint');
    expect(e).not.toMatch(/workshop/i);
    expect(h).not.toContain('वर्कशॉप');
    const alt = both('request', 'api_payAtWorkshopAlt');
    expect(alt.e).toBe('Or pay at the workshop when you collect your vehicle.');
    expect(alt.h).toMatch(deva);
    expect(read('components/workshops/pay-bill-api.tsx')).toContain('api_payAtWorkshopAlt');
  });
});

describe('note 3: no "Approved total: ₹0" before a line is approved', () => {
  it('anyApproved', () => {
    expect(anyApproved({})).toBe(false);
    expect(anyApproved({ a: 'declined' })).toBe(false);
    expect(anyApproved({ a: 'declined', b: 'approved' })).toBe(true);
  });
  it('both estimate cards show the hint instead', () => {
    for (const f of ['service-estimate.tsx', 'service-estimate-api.tsx'])
      expect(read(`components/workshops/${f}`)).toContain('approvedTotalHint');
    const { e, h } = both('request', 'approvedTotalHint');
    expect(e).toBe('Approve the lines you want; the total appears here.');
    expect(h).toMatch(deva);
  });
});
