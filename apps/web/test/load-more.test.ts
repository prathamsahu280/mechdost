import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { appendFresh, MAX_LIST_PAGES, withPages } from '../src/lib/catalogue/load-more';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const c = (...slugs: string[]) => slugs.map((slug) => ({ slug }));

describe('appendFresh', () => {
  it('drops slugs already shown or repeated inside the page', () => {
    expect(appendFresh(['a', 'b'], c('c'), c('b', 'c', 'd', 'd', 'e'))).toEqual(c('d', 'e'));
  });
  it('keeps order and returns nothing for an all-duplicate page', () => {
    expect(appendFresh(['a'], [], c('a'))).toEqual([]);
    expect(appendFresh([], [], c('z', 'y'))).toEqual(c('z', 'y'));
  });
});

describe('withPages', () => {
  it('sets pages next to the filters and leaves them alone', () => {
    expect(withPages('/shop?category=tyres&sort=price_asc', 3)).toBe(
      '/shop?category=tyres&sort=price_asc&pages=3',
    );
  });
  it('replaces an existing value, omits page 1 and caps at the maximum', () => {
    expect(withPages('/shop?pages=2', 4)).toBe('/shop?pages=4');
    expect(withPages('/shop?pages=2', 1)).toBe('/shop');
    expect(withPages('/shop', 99)).toBe(`/shop?pages=${MAX_LIST_PAGES}`);
  });
});

describe('shop Load more source guards', () => {
  const shop = src('src/components/catalogue/shop-browser.tsx');
  it('only the address changes after a page arrives (no server re-render of the list)', () => {
    expect(shop).toMatch(/window\.history\.replaceState/);
    expect(shop).not.toMatch(/router\.replace/);
  });
  it('is busy, announced and does not scroll', () => {
    expect(shop).toMatch(/aria-busy=\{loadState === 'loading'/);
    expect(shop).toMatch(/focus\(\{ preventScroll: true \}\)/);
    expect(shop).toMatch(/aria-disabled=\{loadState === 'loading'/);
    expect(shop).toMatch(/c\('loadedMore'/);
    expect(shop).toMatch(/c\('endOfList'/);
  });
  it('the page and the helper share one cap', () => {
    expect(src('src/app/[locale]/shop/page.tsx')).toMatch(/MAX_LIST_PAGES/);
  });
  it('every message exists in both languages', () => {
    for (const m of [en, hi]) {
      for (const k of ['loadingMore', 'loadedMore', 'loadMoreFailed', 'endOfList'] as const)
        expect(m.catalogue[k]).toBeTruthy();
    }
  });
});

describe('after Load more the new products are on screen (user 2026-11-23: "takes me to the footer and leaves me there")', () => {
  const browser = src('src/components/catalogue/shop-browser.tsx');
  it('scrolls the first new card to the top below the header, then focuses it without a second jump', () => {
    const effect = browser.slice(browser.indexOf('After "Load more"'));
    expect(effect).toMatch(/useLayoutEffect\(/);
    expect(effect).toMatch(/scrollIntoView\(\{ block: 'start'/);
    expect(effect).toMatch(/focus\(\{ preventScroll: true \}\)/);
    expect(effect.indexOf('scrollIntoView')).toBeLessThan(effect.indexOf('focus({ preventScroll: true })'));
  });
  it('cards stop below the sticky header and honour reduced motion', () => {
    expect(browser).toMatch(/className="[^"]*\bscroll-mt-\[/);
    expect(browser).toMatch(/prefers-reduced-motion: reduce/);
  });
});
