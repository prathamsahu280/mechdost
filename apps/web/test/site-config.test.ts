import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { deliveryFeePaise } from '../src/demo/catalogue';
import {
  DEFAULT_CONFIG,
  DEFAULT_SETTINGS,
  cleanText,
  isEmoji,
  resetArea,
  saveCategories,
  saveContent,
  saveLayout,
  saveSettings,
  siteConfig,
} from '../src/demo/site-config';
import { HOME_SECTIONS, SITE_CONFIG_KEY, SITE_LAYOUT_SCRIPT } from '../src/lib/site-layout';

/** Minimal browser stand-in: the store only needs localStorage and storage-event listeners. */
function fakeWindow() {
  const data = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  Object.assign(globalThis, {
    window: { localStorage, addEventListener: () => undefined, removeEventListener: () => undefined },
  });
  return data;
}

let storage: Map<string, string>;
beforeEach(() => {
  storage = fakeWindow();
});

describe('site config (admin customisation, spec 08)', () => {
  it('falls back to defaults for missing or corrupt storage', () => {
    expect(siteConfig()).toEqual(DEFAULT_CONFIG);
    storage.set(SITE_CONFIG_KEY, '{not json');
    expect(siteConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('validates and clamps everything read from storage', () => {
    storage.set(
      SITE_CONFIG_KEY,
      JSON.stringify({
        layout: { order: ['faq', 'bogus', 'faq'], hidden: ['route', 'nope'] },
        featured: ['tyres', 'batteries'], // fewer than 3 → default six
        emoji: { tyres: '🚗', batteries: 'abc', filters: '<b>' },
        settings: {
          acceptMinutes: 1,
          bulkMinUnits: 99_999,
          deliveryFeePaise: 'x',
          freeDeliveryFromPaise: 50_000,
        },
        content: { 'hero.titleLine1': { en: '  Hello\u0000  world ', hi: 42 }, unknown: { en: 'x' } },
      }),
    );
    const c = siteConfig();
    expect(c.layout.order[0]).toBe('faq');
    expect(new Set(c.layout.order)).toEqual(new Set(HOME_SECTIONS)); // every section exactly once
    expect(c.layout.order).toHaveLength(HOME_SECTIONS.length);
    expect(c.layout.hidden).toEqual(['route']);
    expect(c.featured).toBeNull();
    expect(c.emoji).toEqual({ tyres: '🚗' });
    expect(c.settings).toEqual({
      ...DEFAULT_SETTINGS,
      acceptMinutes: 5,
      bulkMinUnits: 500,
      deliveryFeePaise: DEFAULT_SETTINGS.deliveryFeePaise,
      freeDeliveryFromPaise: 50_000,
    });
    expect(c.content).toEqual({ 'hero.titleLine1': { en: 'Hello world' } });
  });

  it('accepts single emoji (incl. ZWJ sequences) and rejects text or markup', () => {
    expect(isEmoji('🔋')).toBe(true);
    expect(isEmoji('🛠️')).toBe(true);
    expect(isEmoji('🧑‍🔧')).toBe(true);
    expect(isEmoji('ab')).toBe(false);
    expect(isEmoji('🔋 x')).toBe(false);
    expect(isEmoji('<script>')).toBe(false);
    expect(cleanText('hero.eyebrow', 'x'.repeat(500))).toHaveLength(80);
  });

  it('saves with a per-area version check: a stale editor cannot overwrite newer changes', () => {
    expect(saveSettings(0, 'Ops', { ...DEFAULT_SETTINGS, acceptMinutes: 30 })).toBe(true);
    expect(siteConfig().settings.acceptMinutes).toBe(30);
    // A second tab still holding version 0 of settings is refused.
    expect(saveSettings(0, 'Other tab', { ...DEFAULT_SETTINGS, acceptMinutes: 45 })).toBe(false);
    expect(siteConfig().settings.acceptMinutes).toBe(30);
    // Other areas keep their own versions, so an unrelated editor is not blocked.
    expect(saveLayout(0, 'Ops', { order: [...HOME_SECTIONS].reverse(), hidden: ['faq'] })).toBe(true);
    expect(siteConfig().versions).toMatchObject({ settings: 1, layout: 1, content: 0 });
  });

  it('records every change in the audit trail, newest first', () => {
    saveContent(0, 'Ops', { 'hero.titleLine1': { en: 'Parts in Raipur', hi: 'रायपुर में पार्ट्स' } });
    resetArea(1, 'Ops', 'content');
    const [latest, first] = siteConfig().audit;
    expect(latest).toMatchObject({ area: 'content', action: 'reset', actor: 'Ops' });
    expect(first).toMatchObject({ area: 'content', action: 'save', fields: ['hero.titleLine1'] });
    expect(siteConfig().content).toEqual({});
  });

  it('refuses a featured-category list outside 3–6 and drops invalid emoji', () => {
    expect(saveCategories(0, 'Ops', ['tyres', 'batteries'], {})).toBe(false);
    expect(saveCategories(0, 'Ops', ['tyres', 'batteries', 'filters'], { tyres: '🛞', filters: 'no' })).toBe(
      true,
    );
    expect(siteConfig().featured).toEqual(['tyres', 'batteries', 'filters']);
    expect(siteConfig().emoji).toEqual({ tyres: '🛞' });
  });

  it('clamps settings on save and the delivery rule uses them', () => {
    saveSettings(0, 'Ops', {
      ...DEFAULT_SETTINGS,
      acceptMinutes: 9_999,
      bulkMinUnits: 0,
      deliveryFeePaise: 2_900,
      freeDeliveryFromPaise: 50_000,
    });
    const s = siteConfig().settings;
    expect(s).toMatchObject({ acceptMinutes: 120, bulkMinUnits: 2 });
    expect(deliveryFeePaise(49_900, s)).toBe(2_900);
    expect(deliveryFeePaise(50_000, s)).toBe(0);
    expect(deliveryFeePaise(0, s)).toBe(0);
  });

  it('the labour promise is off by default, accepts 0 or 7 to 90 days and raises 1 to 6 to a week', () => {
    expect(DEFAULT_SETTINGS.labourPromiseDays).toBe(0);
    for (const [asked, kept] of [
      [0, 0],
      [3, 7],
      [7, 7],
      [30, 30],
      [500, 90],
    ] as const) {
      saveSettings(siteConfig().versions.settings, 'Ops', { ...DEFAULT_SETTINGS, labourPromiseDays: asked });
      expect(siteConfig().settings.labourPromiseDays, String(asked)).toBe(kept);
    }
  });

  it('trust lines are content keys: saved per language, "-" kept as the hide marker, trimmed and capped', () => {
    expect(
      saveContent(siteConfig().versions.content, 'Ops', {
        'trust.homeBill': { en: '-', hi: 'हर ऑर्डर के साथ बिल' },
        'trust.checkout': { en: `  Only   original parts ${'x'.repeat(400)}` },
      }),
    ).toBe(true);
    const c = siteConfig().content;
    expect(c['trust.homeBill']).toEqual({ en: '-', hi: 'हर ऑर्डर के साथ बिल' });
    expect(c['trust.checkout']?.en?.startsWith('Only original parts')).toBe(true);
    expect(c['trust.checkout']?.en?.length).toBe(140);
  });

  it('the pre-paint script only lets plain keys into CSS selectors', () => {
    let css = '';
    const style = {
      id: '',
      set textContent(v: string) {
        css = v;
      },
    };
    const doc = {
      getElementById: () => null,
      createElement: () => style,
      head: { appendChild: () => undefined },
    };
    const win: { __mdSiteCss?: (c: unknown) => void; localStorage: { getItem: () => null } } = {
      localStorage: { getItem: () => null },
    };
    // Run the exact script text in an isolated VM context with fake window/document.
    runInNewContext(SITE_LAYOUT_SCRIPT, { window: win, document: doc, localStorage: win.localStorage });
    win.__mdSiteCss?.({
      layout: { order: ['faq', 'trust"]{}body{display:none}/*'], hidden: ['route'] },
      featured: ['tyres', 'x y'],
    });
    expect(css).toContain('[data-home-section="faq"]{order:1!important}');
    expect(css).toContain('[data-home-section="route"]{display:none!important}');
    expect(css).toContain('[data-home-category="tyres"]{display:block!important}');
    expect(css).not.toContain('body');
    expect(css).not.toContain('x y');
  });
});
