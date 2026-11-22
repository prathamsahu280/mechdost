import { describe, expect, it } from 'vitest';
import { resolveCategoryParam, shopUrl } from '../src/lib/catalogue/shop-state';

const categories = [
  { slug: 'lubricants', parentSlug: null, name: 'Lubricants' },
  { slug: 'car-engine-oil', parentSlug: 'lubricants', name: 'Car engine oil' },
  { slug: 'orphan', parentSlug: 'not-a-top-level', name: 'Orphan' },
];

describe('resolveCategoryParam (breadcrumb links to a sub-category slug)', () => {
  it('keeps a top-level slug as the category with no sub-category', () => {
    expect(resolveCategoryParam('lubricants', categories)).toEqual({
      category: 'lubricants',
      sub: undefined,
    });
  });
  it('maps a sub-category slug to its parent plus a removable sub filter', () => {
    expect(resolveCategoryParam('car-engine-oil', categories)).toEqual({
      category: 'lubricants',
      sub: { slug: 'car-engine-oil', name: 'Car engine oil' },
    });
  });
  it('ignores unknown slugs, orphans and empty input', () => {
    expect(resolveCategoryParam('nope', categories)).toEqual({ category: undefined, sub: undefined });
    expect(resolveCategoryParam('orphan', categories)).toEqual({ category: undefined, sub: undefined });
    expect(resolveCategoryParam(undefined, categories)).toEqual({ category: undefined, sub: undefined });
  });
});

describe('shopUrl', () => {
  it('writes the sub-category slug as the category parameter', () => {
    const sub = { slug: 'car-engine-oil', name: 'Car engine oil' };
    expect(
      shopUrl('/shop', { query: '', category: 'lubricants', sub, sort: 'popular', vehicle: undefined }),
    ).toBe('/shop?category=car-engine-oil');
    expect(
      shopUrl('/shop', {
        query: '',
        category: 'lubricants',
        sub: undefined,
        sort: 'popular',
        vehicle: undefined,
      }),
    ).toBe('/shop?category=lubricants');
  });
});
