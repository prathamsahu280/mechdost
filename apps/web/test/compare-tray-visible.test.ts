import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPARE_TRAY_MIN, trayVisible } from '../src/lib/compare/tray-visible';

describe('compare tray visibility (decision 2026-11-15: the bar appears from two products)', () => {
  it('stays hidden with no product or one product', () => {
    expect(trayVisible({ count: 0, hiddenPage: false, asking: false })).toBe(false);
    expect(trayVisible({ count: 1, hiddenPage: false, asking: false })).toBe(false);
  });

  it('shows from two products', () => {
    expect(COMPARE_TRAY_MIN).toBe(2);
    expect(trayVisible({ count: 2, hiddenPage: false, asking: false })).toBe(true);
    expect(trayVisible({ count: 4, hiddenPage: false, asking: false })).toBe(true);
  });

  it('shows while a question or notice is open, even with one product', () => {
    expect(trayVisible({ count: 1, hiddenPage: false, asking: true })).toBe(true);
  });

  it('never shows on the compare, checkout and portal pages', () => {
    expect(trayVisible({ count: 3, hiddenPage: true, asking: true })).toBe(false);
  });
});

describe('compare page scroll padding (audit 2026-11-16, CMP-TABLE)', () => {
  const css = readFileSync(new URL('../src/app/[locale]/globals.css', import.meta.url), 'utf8');
  const islands = readFileSync(
    new URL('../src/components/catalogue/compare-islands.tsx', import.meta.url),
    'utf8',
  );
  const table = readFileSync(
    new URL('../src/components/catalogue/compare-table.tsx', import.meta.url),
    'utf8',
  );

  it('adds the sticky product strip height to the top scroll padding', () => {
    expect(css).toMatch(
      /html:has\(\[data-compare-head\]\)\s*\{[^}]*scroll-padding-top:[^;]*var\(--compare-head-h/,
    );
  });

  it('publishes the strip height from its measured size and marks the strip', () => {
    expect(islands).toContain('--compare-head-h');
    expect(islands).toContain('ResizeObserver');
    expect(table).toContain('data-compare-head');
  });
});
