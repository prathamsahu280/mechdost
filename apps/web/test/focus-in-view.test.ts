/**
 * Bug 2026-11-24 (user): "if i select a few items for compare and then press clear it like navigates me up on that
 * page for no reason". The tray's Clear moved focus to the FIRST compare toggle on the page (`main
 * [data-compare-toggle]`), and the browser scrolled up to it. Focus now goes to a toggle that is already on screen,
 * else to the main region, always without scrolling.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { focusInView } from '../src/lib/focus-in-view';

function el(top: number, height = 24, connected = true) {
  const calls: (FocusOptions | undefined)[] = [];
  return {
    isConnected: connected,
    getBoundingClientRect: () => ({ top, bottom: top + height }) as DOMRect,
    focus: (o?: FocusOptions) => calls.push(o),
    calls,
  };
}

describe('focus moves without scrolling the page', () => {
  it('picks the first candidate that is on screen, not the first on the page', () => {
    const above = el(-900);
    const visible = el(400);
    const below = el(2000);
    const fallback = el(-200);
    const picked = focusInView(
      [above, visible, below] as unknown as HTMLElement[],
      fallback as unknown as HTMLElement,
      844,
    );
    expect(picked).toBe(visible);
    expect(visible.calls).toEqual([{ preventScroll: true }]);
    expect(above.calls).toEqual([]);
  });

  it('falls back to the main region, still without scrolling, when no candidate is visible', () => {
    const above = el(-900);
    const fallback = el(-3000, 5000);
    focusInView([above] as unknown as HTMLElement[], fallback as unknown as HTMLElement, 844);
    expect(fallback.calls).toEqual([{ preventScroll: true }]);
  });

  it('skips elements that left the page', () => {
    const gone = el(300, 24, false);
    const fallback = el(0, 5000);
    focusInView([gone] as unknown as HTMLElement[], fallback as unknown as HTMLElement, 844);
    expect(gone.calls).toEqual([]);
    expect(fallback.calls).toEqual([{ preventScroll: true }]);
  });

  it('the tray Clear button uses it (no jump to the first toggle on the page)', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'components', 'catalogue', 'compare-tray.tsx'),
      'utf8',
    );
    const clear = src.slice(src.indexOf('data-track="compare_tray_clear"'), src.indexOf('{labels.clear}'));
    expect(clear).toContain('focusInView(');
    expect(clear).not.toContain("querySelector<HTMLElement>('main [data-compare-toggle]')");
  });
});
