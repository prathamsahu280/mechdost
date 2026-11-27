import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Bench kit motion M1-M6 (visual language § 5; founder 2026-11-28 "A Bench kit, V0-V8"): CSS only, transform and
 * opacity only, every animation behind `prefers-reduced-motion: no-preference` (or `motion-safe:`), 0 KB of new JS.
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/app/[locale]/globals.css');
const tokens = read('../../../packages/ui/src/tokens.css');
const tag = read('../src/components/ustaad/common/pehchaan-tag.tsx');
const card = read('../src/components/ustaad/feed/post-card.tsx');
const nav = read('../src/components/ustaad/shell/ustaad-nav.tsx');
const qa = read('../src/components/ustaad/qa/question-thread.tsx');
const story = read('../src/components/ustaad/feed/story-viewer.tsx');

/** The text of `@keyframes name { ... }`, or '' when missing. */
function keyframes(name: string): string {
  const start = css.indexOf(`@keyframes ${name} `);
  if (start < 0) return '';
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  return '';
}

/** True when the first occurrence of `selector` sits inside a `prefers-reduced-motion: no-preference` block. */
function guarded(selector: string): boolean {
  const at = css.indexOf(selector);
  if (at < 0) return false;
  const open = css.slice(0, at).lastIndexOf('@media (prefers-reduced-motion: no-preference)');
  if (open < 0) return false;
  let depth = 0;
  for (let i = css.indexOf('{', open); i < at; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') depth--;
  }
  return depth > 0;
}

describe('motion tokens (§ 5)', () => {
  it('spring easing with a cubic fallback, tap, sheet and swing durations', () => {
    expect(tokens).toMatch(/--ease-spring-snappy:\s*cubic-bezier\(0\.34,\s*1\.56,\s*0\.64,\s*1\)/);
    expect(tokens).toMatch(/@supports \(transition-timing-function: linear\(0, 1\)\)/);
    expect(tokens).toMatch(/--duration-tap:\s*90ms/);
    expect(tokens).toMatch(/--duration-sheet:\s*260ms/);
    expect(tokens).toMatch(/--duration-swing:\s*420ms/);
  });
});

describe('keyframes animate transform and opacity only', () => {
  for (const name of ['ustaad-tick', 'ustaad-count-in', 'ustaad-tag-swing', 'ustaad-stamp', 'new-posts-in']) {
    it(`${name} exists and touches nothing else`, () => {
      const k = keyframes(name);
      expect(k, `missing @keyframes ${name}`).not.toBe('');
      const props = [...k.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(['transform', 'opacity']).toContain(p);
    });
  }
  it('tick is a .7 to 1 spring; swing is -9, 5, -2 degrees; stamp is 1.35 to 1 at -8 to -2 degrees', () => {
    expect(keyframes('ustaad-tick')).toMatch(/scale\(0?\.7\)/);
    expect(keyframes('ustaad-tag-swing')).toMatch(
      /rotate\(-9deg\)[\s\S]*rotate\(5deg\)[\s\S]*rotate\(-2deg\)/,
    );
    expect(keyframes('ustaad-stamp')).toMatch(/scale\(1\.35\) rotate\(-8deg\)[\s\S]*rotate\(-2deg\)/);
  });
});

describe('reduced motion', () => {
  it.each([
    ['.ustaad-tick', 'M1 icon'],
    ['.ustaad-count-in', 'M1 count roll'],
    ['.ustaad-tag-swing', 'M2'],
    ['.ustaad-stamp-press', 'M5'],
    ['.new-posts-pill', 'M4'],
  ])('%s (%s) animates only under no-preference', (sel) => {
    expect(guarded(`${sel} {`)).toBe(true);
  });
  it('the dock indicator slides only under motion-safe', () => {
    expect(nav).toMatch(/motion-safe:transition-transform/);
  });
  it('story progress follows the 100 ms tick linearly, motion-safe', () => {
    expect(story).toMatch(/motion-safe:transition-transform/);
    expect(story).toMatch(/motion-safe:ease-linear/);
  });
});

describe('applied in the components', () => {
  it('M1: like and useful tick the icon and roll the count only after a tap (no animation on first paint)', () => {
    expect(card).toMatch(/data-ticked/);
    expect(card).toContain('ustaad-tick');
    expect(card).toContain('ustaad-count-in');
    expect(css).toMatch(/\[data-ticked\][^{]*\.ustaad-tick/);
  });
  it('M2: the level tag swings on its hole before the sheet opens, and not at all under reduced motion', () => {
    expect(tag).toContain('ustaad-tag-swing');
    expect(tag).toContain('prefers-reduced-motion');
    expect(tag).toMatch(/setTimeout\([^)]*SHEET_OPEN_MS/);
  });
  it('M3: one indicator that slides by the tab index', () => {
    expect(nav).toMatch(/translateX\(\$\{[^`]*\* 100\)\}%\)/);
  });
  it('M5: the stamp presses only when the answer became best on this screen', () => {
    expect(qa).toContain('ustaad-stamp-press');
    expect(qa).toMatch(/wasBest/);
  });
  it('no animation library', () => {
    for (const src of [tag, card, nav, qa]) expect(src).not.toMatch(/framer-motion|gsap|motion\/react/);
  });
});
