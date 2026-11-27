/**
 * Delivery COD simulation audit A1 (2026-11-27; founder approved the ranked improvements that night): the /partners
 * intro and "How joining works" spoke only to suppliers, workshops and mechanics. Delivery partners (riders) are a
 * partner type too, so the intro, the steps and the home teaser name them, in English and Hindi.
 */
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

describe('/partners copy includes delivery partners', () => {
  it('the intro names delivery partners', () => {
    expect(en.pages.partners.lead).toMatch(/delivery partners/i);
    expect(hi.pages.partners.lead).toMatch(/डिलीवरी पार्टनर/);
  });
  it('the set-up step tells riders what they add', () => {
    expect(en.pages.partners.step3Body).toMatch(/delivery partners/i);
    expect(hi.pages.partners.step3Body).toMatch(/डिलीवरी पार्टनर/);
  });
  it('the go-live step covers delivery offers', () => {
    expect(en.pages.partners.step4Body).toMatch(/deliver/i);
    expect(hi.pages.partners.step4Body).toMatch(/डिलीवरी/);
    expect(en.pages.partners.step4Body).toContain('{region}');
    expect(hi.pages.partners.step4Body).toContain('{region}');
  });
  it('the home teaser names delivery too', () => {
    expect(en.home.partners.body).toMatch(/deliver/i);
    expect(hi.home.partners.body).toMatch(/डिलीवरी/);
  });
});
