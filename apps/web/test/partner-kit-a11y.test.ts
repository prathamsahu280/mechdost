import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Accessibility guards for the partner kit (`components/partner/*`, design 2026-11-27 § 4). Source and CSS reads,
 * like the other portal tests: the behaviour that needs a browser is covered by the e2e axe/keyboard rows.
 */
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const css = src('app/[locale]/globals.css');
const lane = src('components/partner/lane-tabs.tsx');
const tabs = src('components/partner/partner-tabs.tsx');
const frame = src('components/partner/partner-frame.tsx');
const kpi = src('components/partner/kpi-tile.tsx');

describe('LaneTabs', () => {
  it('leaves room around the scroller for the 5 px focus ring (3 px outline + 2 px offset)', () => {
    const nav = /<nav aria-label=\{label\} className="([^"]+)"/.exec(lane)?.[1] ?? '';
    // At least 8 px padding on every side and the same scroll padding, so a scrolled-to lane is not flush.
    expect(nav).toMatch(/\bpx-2\b/);
    expect(nav).toMatch(/\bpy-2\b/);
    expect(nav).toMatch(/\bscroll-px-2\b/);
    expect(nav).not.toMatch(/\bpx-1\b/);
  });

  it('moves with Home and End as well as the arrows (arrows wrap)', () => {
    expect(lane).toMatch(/'Home'/);
    expect(lane).toMatch(/'End'/);
    expect(lane).toMatch(/'ArrowRight'/);
    expect(lane).toMatch(/'ArrowLeft'/);
  });
});

describe('partner bottom bar', () => {
  it('reserves its height plus the safe area as scroll padding so focus is never hidden (2.4.11)', () => {
    expect(css).toMatch(/--partner-tabbar-h:\s*calc\([^;]*env\(safe-area-inset-bottom\)[^;]*\)/);
    const rule = /html:has\(\[data-partner-tabbar\]\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/scroll-padding-bottom:\s*calc\(var\(--partner-tabbar-h\)/);
  });

  it('keeps the bar labels at 12 px, 13 px in Hindi, without changing the tile height', () => {
    expect(tabs).not.toMatch(/text-\[11px\]/);
    expect(tabs).toMatch(/partner-tab-label/);
    expect(tabs).toMatch(/min-h-\[52px\]/);
    expect(css).toMatch(/\.partner-tab-label\s*\{[^}]*font-size:\s*12px/);
    expect(css).toMatch(/:lang\(hi\)\s+\.partner-tab-label\s*\{[^}]*font-size:\s*13px/);
  });
});

describe('focus after a tab change', () => {
  it('moves focus to the page heading and announces it politely, only after a user tab click', () => {
    expect(frame).toMatch(/<h1[^>]*tabIndex=\{-1\}/);
    expect(frame).toMatch(/role="status"/);
    expect(frame).toMatch(/aria-live="polite"/);
    expect(frame).toMatch(/tabFocusPlan\(/);
    expect(tabs).toMatch(/onUserNavigate/);
  });
});

describe('review follow-ups (keyboard-navigator, 2026-11-28)', () => {
  it('leaves modified keys (Alt+Left, Ctrl+Home) to the browser in LaneTabs', () => {
    expect(lane).toMatch(/e\.altKey \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey/);
  });

  it('arms the focus move from any plain link click in the frame, not new-tab clicks', () => {
    expect(frame).toMatch(/onClickCapture=\{onFrameClick\}/);
    expect(frame).toMatch(/e\.button !== 0/);
  });

  it('does not move focus for modified clicks on a KpiTile hash link', () => {
    expect(kpi).toMatch(/e\.button !== 0/);
  });
});

describe('KpiTile hash links', () => {
  it('moves focus to the in-page target of its hash', () => {
    expect(kpi).toMatch(/focusHashTarget\(/);
  });
});
