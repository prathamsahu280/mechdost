/**
 * JS budget guard for the smart search (spec 16 incident 2026-11-22: /shop 180.8 and /cart 180.7 KB gz). The search
 * parser, vocabulary, ranker and the suggestion panel load lazily (on the first focus / after the page loads), so
 * nothing reachable from the layout, `/`, `/shop` or `/cart` may import them statically.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

const root = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** Imports that are not `import type` (those vanish at build time). */
const valueImports = (src: string): string[] =>
  [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1] ?? '');

describe('smart search stays out of the first load', () => {
  const lazyOnly = [
    '@mechdost/shared/search',
    '@/demo/smart-search',
    './search-suggest',
    '@/components/catalogue/search-suggest',
    './admin-search-synonyms',
    '../demo/smart-search',
    './smart-search',
  ];
  const allowed = new Set([
    'demo/smart-search.ts', // the lazy matcher itself
    'components/catalogue/search-suggest.tsx', // the lazy panel itself
    'components/portal/admin-search-synonyms.tsx', // the lazy admin chunk
  ]);

  it('no file imports the parser, the demo matcher or the panel statically (only dynamic import())', () => {
    const offenders: string[] = [];
    for (const file of files(root)) {
      const rel = relative(root, file).replace(/\\/g, '/');
      if (allowed.has(rel)) continue;
      const bad = valueImports(readFileSync(file, 'utf8')).filter((spec) => lazyOnly.includes(spec));
      if (bad.length > 0) offenders.push(`${rel}: ${bad.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  }, 30_000);

  it('the shop loads the panel and the matcher with import() only', () => {
    const shop = read('components/catalogue/shop-browser.tsx');
    expect(shop).toMatch(/import\('\.\/search-suggest'\)/);
    expect(shop).toMatch(/import\('@\/demo\/smart-search'\)/);
    expect(valueImports(shop)).not.toContain('./search-suggest');
  });

  it('the panel loads only on focus (armed by onFocus), never on mount', () => {
    const shop = read('components/catalogue/shop-browser.tsx');
    expect(shop).toMatch(/onFocus=\{armSuggest\}/);
    expect(shop).not.toMatch(/useEffect\([^)]*search-suggest/s);
  });

  it('the admin editor is its own dynamic chunk', () => {
    expect(read('components/portal/admin-catalogue.tsx')).toMatch(/import\('\.\/admin-search-synonyms'\)/);
  });
});

describe('suggestion messages are precompiled-safe', () => {
  it('every placeholder is given a value where the message is used', () => {
    expect(read('components/catalogue/search-suggest.tsx')).toMatch(/t\('suggestCount', \{ count/);
    expect(read('components/catalogue/shop-browser.tsx')).toMatch(/c\('didYouMean', \{ suggestion/);
    expect(read('components/portal/admin-search-synonyms.tsx')).toMatch(/t\('syn_more', \{ count/);
  });
  it('English and Hindi carry the same keys with the same placeholders', () => {
    const keys = (tree: Record<string, string>, prefix: string) =>
      Object.keys(tree).filter((k) => k.startsWith(prefix));
    for (const [ns, prefix] of [
      ['catalogue', 'suggest'],
      ['catalogue', 'didYouMean'],
      ['portal', 'syn_'],
    ] as const) {
      const a = en[ns] as Record<string, string>;
      const b = hi[ns] as Record<string, string>;
      expect(keys(b, prefix)).toEqual(keys(a, prefix));
      for (const k of keys(a, prefix)) {
        const holes = (s: string) => [...s.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]).sort();
        expect(holes(b[k] ?? ''), k).toEqual(holes(a[k] ?? ''));
      }
    }
  });
});
