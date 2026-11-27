import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PEHCHAAN_TONES } from '../src/components/ustaad/common/pehchaan-tones';

/**
 * Pehchaan tag finishes, Bench kit (visual language § 3.3/3.6/4): metal sheen on Naya (steel), Pakka (brass) and Master
 * (blackened steel, polished in dark), 1-4 grade lines like marks on a bolt head, edges that show on navy cards.
 * The sheen stops are tokens (no raw hex in the component); contrast of the label on BOTH stops is asserted here.
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const tokens = read('../../../packages/ui/src/tokens.css');
const tag = read('../src/components/ustaad/common/pehchaan-tag.tsx');
const tones = read('../src/components/ustaad/common/pehchaan-tones.ts');

function block(selector: string): string {
  const open = tokens.indexOf('{', tokens.indexOf(selector));
  return tokens.slice(open + 1, tokens.indexOf('}', open));
}
const colors = (b: string) =>
  Object.fromEntries([...b.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
const light = colors(block('@theme'));
const dark = { ...light, ...colors(block(":root[data-theme='dark']")) };

function lum(hex: string) {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [hi = 0, lo = 0] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const METALS = [
  { level: 'naya', fg: 'ink' },
  { level: 'pakka', fg: 'navy' },
  { level: 'master', fg: 'surface' },
] as const;

describe('metal sheen stops are tokens', () => {
  for (const [name, theme] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const m of METALS) {
      for (const end of ['top', 'bottom']) {
        it(`${m.level} ${end} (${name}): label >= 4.5:1`, () => {
          const stop = theme[`${m.level}-${end}`];
          const fg = m.level === 'pakka' ? '#101f34' : theme[m.fg];
          expect(stop, `--color-${m.level}-${end}`).toBeDefined();
          expect(ratio(fg ?? '#000000', stop ?? '#ffffff')).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
  it('the finishes use the tokens, and the demo values are the ones in tokens.css', () => {
    expect(light['naya-top']).toBe('#d6dde6');
    expect(light['naya-bottom']).toBe('#b4bfcc');
    expect(dark['naya-top']).toBe('#4a5d78');
    expect(dark['naya-bottom']).toBe('#33445c');
    expect(light['pakka-top']).toBe('#eeb94a');
    expect(light['pakka-bottom']).toBe('#d1961c');
    expect(light['master-top']).toBe('#1d3050');
    expect(dark['master-top']).toBe('#f4f7fb');
    expect(dark['master-bottom']).toBe('#cfd8e3');
    expect(tones).toMatch(/linear-gradient\(180deg,var\(--color-naya-top\),var\(--color-naya-bottom\)\)/);
    expect(tones).toMatch(/linear-gradient\(180deg,var\(--color-pakka-top\),var\(--color-pakka-bottom\)\)/);
    expect(tones).toMatch(/linear-gradient\(180deg,var\(--color-master-top\),var\(--color-master-bottom\)\)/);
  });
});

describe('edges on navy cards (tone light)', () => {
  it('a tag-edge-on-navy token clears 3:1 on navy in both themes; Master keeps its accent-light edge', () => {
    expect(ratio(light['tag-edge-on-navy'] ?? '#000000', light['navy'] ?? '#ffffff')).toBeGreaterThanOrEqual(
      3,
    );
    expect(ratio(dark['tag-edge-on-navy'] ?? '#000000', dark['navy'] ?? '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(ratio(light['accent-light'] ?? '#000000', light['navy'] ?? '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(ratio(dark['accent-light'] ?? '#000000', dark['navy'] ?? '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(tag).toContain('bg-tag-edge-on-navy');
    expect(tag).toContain('bg-accent-light');
  });
});

describe('component shape', () => {
  it('grade lines are 2 px wide, 9 px tall, 90 % opaque; 1-4 lines for Naya..Master', () => {
    expect(tag).toMatch(/h-\[9px\] w-\[2px\][^"]*opacity-90/);
    expect(PEHCHAAN_TONES.naya.lines).toBe(1);
    expect(PEHCHAAN_TONES.pakka.lines).toBe(2);
    expect(PEHCHAAN_TONES.bada.lines).toBe(3);
    expect(PEHCHAAN_TONES.master.lines).toBe(4);
  });
  it('tag is 26 px tall (28 px in Hindi) with 13 px / 14 px text', () => {
    expect(tag).toContain('min-h-[26px]');
    expect(tag).toContain('text-[13px]');
    expect(tag).toMatch(/\[&:lang\(hi\)\]:min-h-7/);
  });
  it('no raw hex in the component', () => {
    expect(tag).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
