/**
 * UI state audit batch 1a (2026-11-16): the product card's badges never sit over the SKU on the picture, product
 * names in the compare header and the workshop finder's service list are never cut with "...", and ticking the first
 * product to compare gives a visible, announced hint. Source guards (the geometry itself is measured by the audit).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const src = (p: string) => read('src', p);
const locale = (l: 'en' | 'hi') =>
  JSON.parse(read('..', '..', 'packages', 'shared', 'src', 'i18n', `${l}.json`)) as {
    compare: Record<string, string>;
  };

describe('product card badges and the SKU (audit item 1)', () => {
  const card = src('components/catalogue/product-card.tsx');
  it('the badges are in normal flow under the picture, not absolutely placed over it', () => {
    const m = /data-slot="card-badges"\s+className="([^"]*)"/.exec(card);
    expect(m).not.toBeNull();
    const cls = m?.[1] ?? '';
    expect(cls).not.toMatch(/\babsolute\b/);
    expect(cls).toMatch(/\bflex-wrap\b/);
  });
  it('the card keeps one `contents` body (eight grid rows)', () => {
    expect(card.match(/<div className="contents">/g)?.length).toBe(1);
  });
});

describe('product names and services are never truncated (audit items 2, 3)', () => {
  it.each([
    'components/catalogue/compare-table.tsx',
    'components/workshops/workshop-finder.tsx',
    'components/workshops/workshop-finder-api.tsx',
  ])('%s has no line-clamp', (f) => {
    expect(src(f)).not.toMatch(/line-clamp/);
  });
});

describe('compare hint with one product (audit item 4)', () => {
  const toggle = src('components/catalogue/compare-toggle.tsx');
  it('renders a data-compare-hint element only for the single ticked product, and announces it', () => {
    expect(toggle).toMatch(/data-compare-hint/);
    expect(toggle).toMatch(/slugs\.length === 1/);
    expect(toggle).toMatch(/labels\.hint/);
  });
  it.each(['en', 'hi'] as const)('%s has the hint wording without an ellipsis', (l) => {
    const hint = locale(l).compare.hint;
    expect(hint).toBeTruthy();
    expect(hint).not.toMatch(/\.\.\.|…/);
  });
  it('both callers pass the hint label', () => {
    expect(src('components/catalogue/product-card.tsx')).toMatch(/hint: cmp\('hint'\)/);
    expect(src('app/[locale]/shop/[slug]/page.tsx')).toMatch(/hint: cmp\('hint'\)/);
  });
});
