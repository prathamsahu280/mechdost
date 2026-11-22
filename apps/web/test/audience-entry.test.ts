import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { HOME_SECTIONS as SHARED_SECTIONS } from '@mechdost/shared/site-layout';
import { HOME_SECTIONS as WEB_SECTIONS } from '@/lib/site-layout';
import { STATIC_PATHS } from '@/lib/sitemap-entries';

const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
type Bag = Record<string, unknown>;
const at = (root: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Bag)[k] : undefined), root);
const strings = (o: unknown): string[] =>
  typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o as Bag).flatMap(strings) : [];

describe('home audience band', () => {
  const band = src('components/home/audience-band.tsx');
  it('is a server component with no client code', () => {
    expect(band).not.toContain("'use client'");
    expect(band).not.toMatch(/use(State|Effect)\(/);
  });
  it('is a labelled section with an h2 and a list of single-link cards', () => {
    expect(band).toMatch(/<section[^>]*aria-labelledby="audiences-title"/);
    expect(band).toMatch(/<h2[^>]*id="audiences-title"/);
    expect(band).toContain('<ul');
    expect(band).toContain('after:absolute after:inset-0');
    expect(band).toContain('aria-hidden="true"');
  });
  it('carries the analytics ids and links', () => {
    for (const id of ['home_audience_retail', 'home_audience_garages', 'home_audience_fleets'])
      expect(band).toContain(id);
    for (const href of ['/shop', '/business/garages', '/business/fleets']) expect(band).toContain(href);
  });
  it('is wired into the home page and the demo layout list agrees with the shared one', () => {
    expect(src('app/[locale]/page.tsx')).toMatch(/audiences: <AudienceBand/);
    expect([...WEB_SECTIONS]).toEqual([...SHARED_SECTIONS]);
    expect(WEB_SECTIONS[0]).toBe('audiences');
  });
  it('is documented in the analytics spec', () => {
    const spec = readFileSync(new URL('../../../docs/specs/12-analytics-events.md', import.meta.url), 'utf8');
    for (const id of ['home_audience_retail', 'home_audience_garages', 'home_audience_fleets'])
      expect(spec).toContain(id);
  });
});

const PAGES = [
  { path: '/business/garages', ns: 'pages.businessGarages', seo: 'businessGaragesTitle' },
  { path: '/business/fleets', ns: 'pages.businessFleets', seo: 'businessFleetsTitle' },
] as const;

describe.each(PAGES)('landing page $path', ({ path, ns, seo }) => {
  const file = `app/[locale]${path}/page.tsx`;
  it('exists as a server page with SEO metadata, in the sitemap', () => {
    expect(existsSync(new URL(`../src/${file}`, import.meta.url))).toBe(true);
    const s = src(file);
    expect(s).not.toContain("'use client'");
    expect(s).toContain('alternatesFor(');
    expect(s).toContain('openGraphFor(');
    expect(STATIC_PATHS).toContain(path);
  });
  it('has one h1 and an h2 per benefit', () => {
    const s = src(file);
    expect(s.match(/<h1\b|<PageIntro\b/g)).toHaveLength(1);
    expect(s).toContain('<Benefit');
    expect(src('components/business/business-parts.tsx')).toContain('<h2');
  });
  it('has copy in English and Devanagari, with SEO strings', () => {
    for (const bundle of [en, hi]) {
      expect(strings(at(bundle, ns)).length).toBeGreaterThan(8);
      expect(typeof at(bundle, `seo.${seo}`)).toBe('string');
      expect(typeof at(bundle, `seo.${seo.replace('Title', 'Description')}`)).toBe('string');
    }
    for (const s of strings(at(hi, ns)))
      expect(s.replace(/MechDost|GSTIN|GST/g, '')).not.toMatch(/[A-Za-z]{3,}/);
  });
  it('never says "GST invoice" (Q97)', () => {
    for (const bundle of [en, hi])
      for (const s of strings(at(bundle, ns))) expect(s).not.toMatch(/GST invoice/i);
    expect(src(file)).not.toMatch(/GST invoice/i);
  });
});

describe('landing page links', () => {
  it('garages: apply, bulk orders and order again; status is text', () => {
    const s = src('app/[locale]/business/garages/page.tsx');
    expect(s).toContain('/business/apply?kind=trade');
    expect(s).toContain('/quotes/new');
    expect(s).toContain('/account/orders');
    expect(s).toContain('statusLive');
    expect(s).toContain('statusSoon');
  });
  it('fleets: talk to us goes to the fleet application and the brand word is lang=en', () => {
    const s = src('app/[locale]/business/fleets/page.tsx');
    expect(s).toContain('/business/apply?kind=fleet');
    expect(s).toContain('lang="en"');
  });
});

describe('For business navigation', () => {
  it('footer has a labelled For business nav with the three links', () => {
    const f = src('components/site/footer.tsx');
    for (const href of ['/business/garages', '/business/fleets', '/quotes/new']) expect(f).toContain(href);
    expect(f).toContain("t('colBusiness')");
    expect(f).toContain('aria-labelledby={`footer-col-${col.id}`}');
  });
  it('header nav gets one For business item (no new client file); the tab bar stays at four', () => {
    const nav = src('lib/nav.ts');
    expect(nav).toContain("key: 'business'");
    expect(nav.match(/key: '/g)).toHaveLength(5);
    expect(src('components/site/nav-links.tsx')).toContain("aria-current={active ? 'page' : undefined}");
    const layout = src('app/[locale]/layout.tsx');
    expect(layout).toContain('BUSINESS_NAV');
    // The tab bar is built from PRIMARY_NAV only.
    expect(layout).toMatch(/tabItems = PRIMARY_NAV\.map/);
    expect(src('components/site/mobile-tab-bar.tsx')).toContain('grid-cols-4');
  });
  it('the nav label exists in en and hi', () => {
    expect(at(en, 'nav.business')).toBe('For business');
    expect(typeof at(hi, 'nav.business')).toBe('string');
  });
});

describe('admin layout labels', () => {
  it('names the audiences section in en and hi', () => {
    expect(typeof at(en, 'portal.section_audiences')).toBe('string');
    expect(typeof at(hi, 'portal.section_audiences')).toBe('string');
  });
});
