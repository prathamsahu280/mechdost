import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

/** Latin words that are left once the file's own column names and values (marked `<code>`) are taken out. */
const outsideCode = (text: string) => text.replace(/<code>[^<]*<\/code>/g, '');

describe('stock file copy (hard rule 10)', () => {
  it.each([
    ['en', en],
    ['hi', hi],
  ] as const)('%s: column names and yes/no values are marked as code', (_n, locale) => {
    const rules = locale.shopTier2.csvRules;
    for (const name of ['sku', 'stock', 'active', 'requested_price', 'yes', 'no'])
      expect(rules, name).toContain(`<code>${name}</code>`);
  });

  it('Hindi sentences around the code names hold no Latin letters', () => {
    expect(outsideCode(hi.shopTier2.csvRules).replace(/MB|{rows}/g, '')).not.toMatch(/[A-Za-z]/);
    expect(hi.shopTier2.csvErr_ACTIVE_INVALID).not.toMatch(/[A-Za-z]/);
  });

  it('a paused coupon shows its reason apart from the label (the reason is staff-typed text)', () => {
    expect(en.coupons.a_paused_why).not.toContain('{');
    expect(hi.coupons.a_paused_why).not.toContain('{');
  });
});
