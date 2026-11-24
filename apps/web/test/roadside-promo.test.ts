import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { ROADSIDE_NAV } from '@/lib/nav';

/**
 * Roadside help is promoted where people look for it (spec 22 "Where it shows", user 2026-11-24). Every surface reads
 * the one city answer `publishedRoadside`, so a city without roadside never shows a dead end.
 */
const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
type Bag = Record<string, unknown>;
const at = (root: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Bag)[k] : undefined), root);

describe('roadside promotion', () => {
  it('every surface is gated by the city answer', () => {
    expect(src('app/[locale]/layout.tsx')).toMatch(/if \(roadside\.enabled\)/);
    expect(src('app/[locale]/layout.tsx')).toContain('roadside.enabled');
    expect(src('app/[locale]/page.tsx')).toMatch(/roadside\.enabled \? <RoadsideBand/);
    expect(src('app/[locale]/workshops/page.tsx')).toMatch(/roadside\.enabled \? <RoadsideCard/);
    expect(src('app/[locale]/shop/page.tsx')).toMatch(/roadside\.enabled \? <RoadsideCard/);
    // The card follows the words on screen (typing without a page load), not only the URL the server rendered.
    expect(src('components/catalogue/shop-browser.tsx')).toMatch(/matchesRoadsideIntent\(state\.query\)/);
    expect(src('components/site/footer.tsx')).toMatch(/roadside \? \[\{ href: '\/roadside'/);
    expect(src('components/site/header.tsx')).toMatch(/roadside\s*\?\s*\{/);
  });

  it('the answer comes from the cached public API and is hidden when it fails (never a dead end)', () => {
    const s = src('lib/site-config-content.ts');
    expect(s).toContain("'/v1/roadside/city'");
    expect(s).toMatch(/enabled: field\(body, 'enabled'\) === true/);
  });

  it('the band and card are server components (no client JS)', () => {
    const p = src('components/roadside/roadside-promo.tsx');
    expect(p).not.toContain("'use client'");
    expect(p).toContain('data-track="home_roadside"');
    expect(p).toContain('min-h-11');
  });

  it('the tab bar keeps the five-tab maximum and the nav item is accent-coloured', () => {
    expect(ROADSIDE_NAV.href).toBe('/roadside');
    expect(src('components/site/mobile-tab-bar.tsx')).toContain('grid-cols-5');
    expect(src('components/site/nav-links.tsx')).toContain('accent-soft-text');
  });

  it('has every string in en and hi', () => {
    for (const key of [
      'nav.roadside',
      'tabs.roadside',
      'regions.raipur',
      'roadside.promoTitle',
      'roadside.promoBodyAlways',
      'roadside.promoBody',
      'roadside.promoCta',
      'roadside.searchTitle',
      'roadside.searchBody',
      'roadside.searchKind',
      'roadside.shopCardTitle',
      'roadside.workshopsCardBody',
      'portal.section_roadside',
    ]) {
      expect(typeof at(en, key), `en ${key}`).toBe('string');
      expect(typeof at(hi, key), `hi ${key}`).toBe('string');
    }
  });

  it('the search palette puts the suggestion above everything and counts a click', () => {
    const s = src('components/site/header-search.tsx');
    expect(s).toContain('matchesRoadsideIntent(typed)');
    expect(s).toContain("id: 'header_search_roadside'");
  });
});
