import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PEHCHAAN_TONES } from '../src/components/ustaad/common/pehchaan-tones';

/** Guards WCAG 2.2 AA contrast for every text/background pair, in light and dark themes (docs/design-system.md). */
const css = readFileSync(new URL('../../../packages/ui/src/tokens.css', import.meta.url), 'utf8');

function colors(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]),
  ) as Record<string, string>;
}

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Missing ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const light = colors(block('@theme'));
const darkExplicit = block(":root[data-theme='dark']");
const darkSystem = block(":root:not([data-theme='light'])");
const dark = { ...light, ...colors(darkExplicit) };

function luminance(hex: string) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(theme: Record<string, string>, fg: string, bg: string) {
  const value = (name: string) => {
    const v = name.startsWith('#') ? name : theme[name];
    if (!v) throw new Error(`Unknown token ${name}`);
    return v;
  };
  const [hi, lo] = [luminance(value(fg)), luminance(value(bg))].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [fg: string, bg: string][] = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['ink', 'surface-alt'],
  ['ink', 'pill'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'surface-alt'],
  ['#ffffff', 'accent-button'],
  ['#ffffff', 'accent-button-hover'],
  ['#ffffff', 'navy'],
  ['hero-copy', 'navy'],
  ['accent-light', 'navy'],
  ['accent-pale', 'navy'],
  ['accent-soft-text', 'accent-soft'],
  ['accent-soft-text', 'bg'],
  ['accent-soft-text', 'surface'],
  ['#ffffff', 'whatsapp'],
  ['ink', 'whatsapp-bg'],
  ['success', 'success-bg'],
  ['warning', 'warning-bg'],
  ['private', 'private-bg'],
  ['error', 'surface'],
  // Admin data colour (decision 2026-11-25): tinted tiles, badges and tables
  ['error', 'error-bg'],
  ['info', 'info-bg'],
  ['info', 'surface'],
  ['ink', 'error-bg'],
  ['ink', 'info-bg'],
  ['ink', 'success-bg'],
  ['ink', 'warning-bg'],
  ['success', 'surface'],
  ['warning', 'surface'],
  ['muted', 'error-bg'],
  ['muted', 'info-bg'],
  ['muted', 'success-bg'],
  ['muted', 'warning-bg'],
  // v4 chrome (decision 2026-11-23): nav chip, cart button and its badge, tinted footer panel
  ['ink', 'chip'],
  ['muted', 'chip'],
  ['muted', 'pill'],
  ['#ffffff', 'cart'],
  ['cart-badge-text', 'cart-badge'],
  ['accent-soft-text', 'pill'],
  // Site-wide light lift (V9): selected tint, sunken well, segment track
  ['selected-fg', 'selected-bg'],
  ['accent-soft-text', 'surface-alt'],
  ['muted', 'lift-track'],
  ['muted', 'accent-soft'],
  // Ustaad QA simulation 2026-11-27: WhatsApp share text on its tint (was 3.07:1 in dark)
  ['whatsapp-text', 'whatsapp-bg'],
  ['whatsapp-text', 'surface'],
  // Mechanic Network "Bench kit" (decision 2026-11-27 night): level word on its tag fill, Useful brass text
  ...Object.values(PEHCHAAN_TONES).map((t): [string, string] => [t.fg, t.fill]),
  ['brass-text', 'surface'],
  ['brass-text', 'bg'],
  // Metal sheen stops (decision 2026-11-28): the label must pass on both ends of every gradient
  ['ink', 'naya-top'],
  ['ink', 'naya-bottom'],
  ['#101f34', 'pakka-top'],
  ['#101f34', 'pakka-bottom'],
  ['surface', 'master-top'],
  ['surface', 'master-bottom'],
  // Network lift (decision 2026-11-28): page tone, sunken well, segment track, raised navy panel
  ['ink', 'lift-bg'],
  ['muted', 'lift-bg'],
  ['muted', 'lift-sunken'],
  ['muted', 'lift-track'],
  ['accent-soft-text', 'lift-bg'],
  ['#ffffff', 'navy-raised'],
  ['hero-copy', 'navy-raised'],
];

const NON_TEXT_PAIRS: [fg: string, bg: string][] = [
  ['focus', 'bg'],
  ['focus', 'surface'],
  ['focus', 'navy'],
  ['accent', 'surface'],
  ['input-border', 'surface'],
  ['input-border', 'bg'],
  ['star', 'surface'],
  ['star', 'bg'],
  // Chart marks and icon chips of the admin data colours (decision 2026-11-25)
  ['info', 'surface'],
  ['success', 'surface'],
  ['error', 'surface'],
  ['info', 'info-bg'],
  ['success', 'success-bg'],
  ['error', 'error-bg'],
  ['warning', 'warning-bg'],
  // Pehchaan tag edges on the page surface (visual language § 3.2: every tag has a 1 px edge)
  ...Object.values(PEHCHAAN_TONES).map((t): [string, string] => [t.edge, 'surface']),
  ['tag-edge-on-navy', 'navy'],
  ['tag-edge-on-navy', 'navy-raised'],
  ['accent-light', 'navy-raised'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast (WCAG 2.2 AA)', (_name, theme) => {
  it.each(TEXT_PAIRS)('text %s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrast(theme, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)('non-text %s on %s ≥ 3:1', (fg, bg) => {
    expect(contrast(theme, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});

function contrastOf(theme: Record<string, string>, fg: string, bg: string) {
  return contrast(theme, fg, bg);
}

/** Site-wide light lift (visual language § 3.8, founder 2026-11-28 "Yes, whole site", decision V9): light only. */
describe('site-wide light lift (V9)', () => {
  it('lifts the page tone and the sunken well in light only', () => {
    expect(light.bg).toBe('#eef2f7');
    expect(light['surface-alt']).toBe('#f5f7fa');
    expect(dark.bg).toBe('#0a1424');
    expect(dark['surface-alt']).toBe('#0d192b');
  });

  it('keeps muted >= 5.0 and ink >= 7 on the new tones', () => {
    expect(contrastOf(light, 'muted', 'bg')).toBeGreaterThanOrEqual(5);
    expect(contrastOf(light, 'muted', 'surface-alt')).toBeGreaterThanOrEqual(5);
    expect(contrastOf(light, 'ink', 'bg')).toBeGreaterThanOrEqual(7);
    expect(contrastOf(light, 'ink', 'surface-alt')).toBeGreaterThanOrEqual(7);
  });

  it('selected state is the accent-soft pair in light and the old chip pair in dark', () => {
    expect(light['selected-bg']).toBe(light['accent-soft']);
    expect(light['selected-fg']).toBe(light['accent-soft-text']);
    expect(dark['selected-bg']).toBe('#243752');
    expect(dark['selected-fg']).toBe('#e8eef5');
    expect(contrastOf(light, 'selected-fg', 'selected-bg')).toBeGreaterThanOrEqual(4.5);
    expect(contrastOf(dark, 'selected-fg', 'selected-bg')).toBeGreaterThanOrEqual(4.5);
  });

  it('uses one card shadow (hairline + layered) and leaves the dark shadow alone', () => {
    expect(css).toContain(
      '--shadow-card: 0 0 0 1px #101f340d, 0 1px 2px #101f340f, 0 10px 28px -18px #101f3433;',
    );
    expect(css).toContain('--shadow-tab-bar:');
    expect(block(":root[data-theme='dark']")).toContain('--shadow-card: 0 4px 16px #00000033;');
  });

  it('drops the card border colour in light only (the shadow carries the edge)', () => {
    expect(css).toMatch(/--card-edge:\s*transparent;/);
    expect(block(":root[data-theme='dark']")).toContain('--card-edge: var(--color-line-card);');
  });
});

describe('dark theme definition', () => {
  it('is identical for the toggle and for the system preference', () => {
    const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(normalise(darkSystem)).toBe(normalise(darkExplicit));
  });

  it('overrides every surface and text colour', () => {
    const overrides = colors(darkExplicit);
    for (const key of ['ink', 'bg', 'surface', 'surface-alt', 'muted', 'line', 'pill']) {
      expect(overrides[key], key).toBeDefined();
    }
  });
});
