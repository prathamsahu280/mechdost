/**
 * The demo catalogue's smart search (spec 02 "Smart search"): same understanding as the API, on the demo products.
 */
import { describe, expect, it } from 'vitest';
import { demoDidYouMean, demoSuggestions, smartSearchProducts } from '../src/demo/smart-search';
import { PRODUCT_HI } from '../src/demo/i18n/hi-products';

const label = (k: string) => k;
const top = (query: string, n = 3) =>
  smartSearchProducts({ query, categoryLabel: label, hi: PRODUCT_HI })
    .slice(0, n)
    .map((p) => p.slug);

describe('smart search over the demo catalogue', () => {
  it('"20w40 bike oil" lists the 20W-40 two-wheeler oils first', () => {
    const r = top('20w40 bike oil', 4);
    expect(r.length).toBeGreaterThan(0);
    for (const slug of r.slice(0, 2)) expect(slug).toMatch(/20w40/);
  });
  it('every viscosity spelling finds the same oils', () => {
    const base = top('20w40', 10);
    expect(base.length).toBeGreaterThan(0);
    for (const q of ['20 w 40', '20W-40', '20w-40']) expect(top(q, 10)).toEqual(base);
  });
  it('"castrol 900ml" puts the 900 ml pack first', () => {
    expect(top('castrol 900ml', 1)[0]).toBe('castrol-activ-4t-20w40-900ml');
  });
  it('Hinglish and Hindi words: baitri, बैटरी, tel', () => {
    const batteries = smartSearchProducts({ query: 'baitri', categoryLabel: label, hi: PRODUCT_HI });
    expect(batteries.length).toBeGreaterThan(0);
    expect(batteries.every((p) => p.category === 'batteries' || /batter/i.test(p.name + p.spec))).toBe(true);
    expect(top('बैटरी', 50).length).toBeGreaterThan(0);
    expect(top('tel', 5).length).toBeGreaterThan(0);
  });
  it('a typo still finds the brand', () => {
    expect(top('castrl', 5).length).toBeGreaterThan(0);
  });
  it('no query keeps the popular order; nonsense finds nothing', () => {
    expect(smartSearchProducts({}).length).toBeGreaterThan(5);
    expect(top('qwzxv')).toEqual([]);
  });
  it('suggestions: at most 8, brands first, in the page language', () => {
    const items = demoSuggestions('cast', label, PRODUCT_HI, 'en');
    expect(items.length).toBeLessThanOrEqual(8);
    expect(items[0]).toMatchObject({ kind: 'brand', label: 'Castrol' });
    expect(demoSuggestions('c', label, PRODUCT_HI, 'en')).toEqual([]);
  });
  it('did you mean', () => {
    expect(demoDidYouMean('castroll', label)).toBe('Castrol');
    expect(demoDidYouMean('qwzxv', label)).toBeNull();
  });
});
