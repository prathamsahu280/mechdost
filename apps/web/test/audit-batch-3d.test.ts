/**
 * Audit 2026-11-16, batch 3d: one test per real finding class of the second GitHub re-run. Geometry is measured by
 * `e2e/state-audit`; these pin the rules that make the geometry and the Hindi gate hold.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { AdminCouponDto } from '../../../packages/shared/src/coupon-api';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const e2e = (p: string) => readFileSync(join(__dirname, '..', 'e2e', p), 'utf8');

describe('CHR-ASSIST: no half-hidden launcher, panel always found', () => {
  const launcher = src('components/assistant/assistant-launcher.tsx');
  it('the launcher disappears at once when the panel opens (no fade that leaves a pointer-less ghost over the page)', () => {
    const open = /open\s*\?\s*'([^']*)'/.exec(launcher)?.[1] ?? '';
    expect(open).toContain('invisible');
    expect(open).not.toMatch(/opacity-0|translate-y-2/);
    // the transition belongs to the closed (coming back) branch only
    expect(launcher).not.toMatch(/duration-\[var\(--duration-base\)\][^`]*\$\{/);
    expect(launcher).toMatch(/:\s*'[^']*transition-\[opacity,transform\]/);
  });
  it('the audit waits for the lazily loaded panel after pressing the launcher', () => {
    expect(e2e('state-audit/harness.ts')).toMatch(/#assistant-panel['"]\)\s*\.waitFor/);
  });
});

describe('CART-LINES-017: Remove stays inside the line at 320 px with big prices', () => {
  it('the price + Remove group wraps instead of overflowing', () => {
    expect(src('components/commerce/cart-view.tsx')).toContain(
      '<div className="flex flex-wrap items-center gap-x-3 gap-y-1">',
    );
  });
});

describe('CHR-FLOAT: bulk quote link has a 24 px target', () => {
  it('is an inline-flex link with min-h-6', () => {
    const page = src('app/[locale]/shop/[slug]/page.tsx');
    const at = page.indexOf('data-track="product_bulk_quote"');
    expect(page.slice(at, at + 200)).toMatch(/inline-flex min-h-6 items-center/);
  });
});

describe('API-ADM-COUPONS: the category of a coupon carries its Hindi name', () => {
  it('the DTO has nameHi and the list uses localName', () => {
    const cat = AdminCouponDto.shape.category.unwrap();
    expect(Object.keys(cat.shape)).toContain('nameHi');
    expect(src('components/portal/admin-coupons-api.tsx')).toContain('localName(c.category, locale)');
  });
});

describe('API-QUOTE-THREAD: a <dl> holds only dt/dd groups', () => {
  for (const f of ['components/quotes/quote-thread-api.tsx', 'components/quotes/quote-thread.tsx']) {
    it(`${f}: the saving line sits outside the list`, () => {
      expect(src(f)).not.toMatch(/<dl[\s\S]*?<p className="text-right[\s\S]*?<\/dl>/);
    });
  }
});

describe('SHOP-FILTERS-010: the SKU code on the product visual is marked as Latin', () => {
  it('has lang="en"', () => {
    expect(src('components/catalogue/product-visual.tsx')).toMatch(/<span\s+lang="en"[^>]*>\s*\{sku\}/);
  });
});

describe('API-SHOP-TIER2: the CSV column named in an error line is a marked code', () => {
  it('csvErrorLine wraps the column in <code> and the component renders it with lang="en"', () => {
    expect(en.shopTier2.csvErrorLine).toContain('<code>{column}</code>');
    expect(hi.shopTier2.csvErrorLine).toContain('<code>{column}</code>');
    expect(src('components/portal/shop-csv-api.tsx')).toMatch(
      /t\.rich\('csvErrorLine'[\s\S]*?<code lang="en">/,
    );
  });
});
