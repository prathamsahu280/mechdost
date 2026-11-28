import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Bench kit lifted surfaces (visual language § 3.6 craft pass, § 3.7; founder 2026-11-28 "V0-V8 approved, V9
 * site-wide NOT approved"): the network gets tinted page tone, floating post cards, framed photos, a pill behind the
 * current dock icon, heavier names; dark mode gets raised navy surfaces with a top-light edge. Everything is scoped
 * under the network marker `html:has([data-shell-compact])`; nothing here may touch the storefront.
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/app/[locale]/globals.css');
const tokens = read('../../../packages/ui/src/tokens.css');

const START = '/* Bench kit lift (network only)';
const END = '/* end Bench kit lift */';
const section = css.slice(css.indexOf(START), css.indexOf(END));

function block(selector: string): string {
  const open = tokens.indexOf('{', tokens.indexOf(selector));
  return tokens.slice(open + 1, tokens.indexOf('}', open));
}
const colors = (b: string): Record<string, string> =>
  Object.fromEntries(
    [...b.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]),
  ) as Record<string, string>;
const light = colors(block('@theme'));
const dark = { ...light, ...colors(block(":root[data-theme='dark']")) };
function lum(hex: string) {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a = '#000000', b = '#ffffff') => {
  const [hi = 0, lo = 0] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('lift tokens (light, with dark counterparts)', () => {
  it('page tone, sunken tone and segment track, light values from § 3.7', () => {
    expect(light['lift-bg']).toBe('#eef2f7');
    expect(light['lift-sunken']).toBe('#f5f7fa');
    expect(light['lift-track']).toBe('#e3e9f1');
  });
  it('muted and ink stay >= 4.5:1 on the new tones, both themes', () => {
    for (const theme of [light, dark])
      for (const tone of ['lift-bg', 'lift-sunken', 'lift-track']) {
        expect(ratio(theme.muted, theme[tone]), `muted on ${tone}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(theme.ink, theme[tone]), `ink on ${tone}`).toBeGreaterThanOrEqual(4.5);
      }
  });
  it('dark: raised navy panel (#16294a) carries white and hero copy; tag and accent edges show on it', () => {
    expect(dark['navy-raised']).toBe('#16294a');
    expect(ratio('#ffffff', dark['navy-raised'])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark['hero-copy'], dark['navy-raised'])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark['tag-edge-on-navy'], dark['navy-raised'])).toBeGreaterThanOrEqual(3);
    expect(ratio(dark['accent-light'], dark['navy-raised'])).toBeGreaterThanOrEqual(3);
    expect(ratio('#ffffff', light['navy-raised'])).toBeGreaterThanOrEqual(4.5);
  });
  it('both dark blocks carry the new tokens and the lift shadows (system and explicit stay identical)', () => {
    const a = block(":root[data-theme='dark']");
    const b = block(":root:not([data-theme='light'])");
    for (const name of ['--color-lift-bg', '--color-navy-raised', '--shadow-lift', '--shadow-lift-chrome-up'])
      expect(a, name).toContain(name);
    for (const name of ['--color-lift-bg', '--color-navy-raised', '--shadow-lift', '--shadow-lift-chrome-up'])
      expect(b, name).toContain(name);
  });
  it('light card shadow is the layered hairline; dark is a top-light edge', () => {
    expect(tokens).toMatch(
      /--shadow-lift:\s*0 0 0 1px #101f340d, 0 1px 2px #101f340f, 0 10px 28px -18px #101f3433/,
    );
    expect(block(":root[data-theme='dark']")).toMatch(/--shadow-lift:\s*inset 0 1px 0 #ffffff12/);
  });
});

describe('lift rules are scoped to the network marker', () => {
  it('the section exists and every rule starts with html:has([data-shell-compact])', () => {
    expect(css.indexOf(START)).toBeGreaterThan(0);
    expect(css.indexOf(END)).toBeGreaterThan(css.indexOf(START));
    // Strip comments, then check each selector list entry at brace depth 0 (or inside @media).
    const body = section.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...body.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => (m[2] ?? '').trim());
    expect(selectors.length).toBeGreaterThan(10);
    for (const list of selectors)
      for (const sel of list.split(','))
        expect(sel.trim(), sel).toMatch(/^html:has\(\[data-shell-compact\]\)/);
  });
  it('covers post cards, framed photos, the dock pill, header, navy panels, stories and the segmented control', () => {
    for (const needle of [
      '[data-post-kind]',
      '[data-post-photo]',
      "[data-ustaad-dock] a[aria-current='page'] > svg",
      '[data-ustaad-header]',
      '[data-navy-panel]',
      '.story-ring',
      '.ustaad-seg',
      'var(--shadow-lift)',
      'var(--color-lift-bg)',
    ])
      expect(section, needle).toContain(needle);
  });
  it('the storefront rules above it are untouched: no unscoped body or .bg-surface override added', () => {
    expect(section).not.toMatch(/^\s*body\s*\{/m);
    expect(section).not.toMatch(/^\s*:root/m);
  });
});

describe('type and spacing (network only)', () => {
  const card = read('../src/components/ustaad/feed/post-card.tsx');
  const list = read('../src/components/ustaad/feed/feed-list.tsx');
  it('names 16/800; post body 16 (Hindi 17) at 1.6 line-height via data-post-body', () => {
    expect(card).toMatch(/text-base font-extrabold/);
    expect(card).toContain('ClampedBody');
    expect(read('../src/components/ustaad/feed/clamped-body.tsx')).toContain('data-post-body');
    expect(section).toMatch(/\[data-post-body\]\s*\{[^}]*font-size:\s*16px[^}]*line-height:\s*1\.6/);
    expect(section).toMatch(/:lang\(hi\) \[data-post-body\]\s*\{[^}]*font-size:\s*17px/);
  });
  it('post padding 16, card gap 10', () => {
    expect(card).toContain('px-4 pt-4');
    expect(list).toMatch(/<ul className="grid gap-2\.5">/);
  });
});

describe('no raw hex in the changed components', () => {
  for (const f of [
    'feed/post-card.tsx',
    'feed/feed-list.tsx',
    'feed/post-media.tsx',
    'shell/ustaad-nav.tsx',
    'card/my-card.tsx',
    'qa/question-thread.tsx',
    'common/pehchaan-tag.tsx',
  ])
    it(f, () => {
      expect(read(`../src/components/ustaad/${f}`)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
  it('layout header is marked and carries no hex', () => {
    const layout = read('../src/app/[locale]/ustaad/layout.tsx');
    expect(layout).toContain('data-ustaad-header');
    expect(layout).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('navy panels are marked', () => {
    expect(read('../src/components/ustaad/card/my-card.tsx')).toContain('data-navy-panel');
    expect(read('../src/components/ustaad/qa/question-thread.tsx')).toContain('data-navy-panel');
  });
  it('photos are marked for framing', () => {
    expect(read('../src/components/ustaad/feed/post-media.tsx')).toContain('data-post-photo');
  });
});
