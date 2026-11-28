import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Bug 2026-11-28 22:49 (founder, screen recording): with the account menu open, a second press on the avatar re-opened
 * the menu instead of closing it. The panel's "press outside closes" listener (pointerdown) did not count the avatar
 * button as inside, so it closed the menu, then the button's click toggled it open again.
 * Rule: the outside-press check skips the button that opens the menu; the button's own click does the toggle.
 * (The bell is safe: its outside check wraps the button and the panel in one root.)
 */
const read = (p: string) => readFileSync(new URL(`../src/components/${p}`, import.meta.url), 'utf8');
const menu = read('auth/account-menu.tsx');
const panel = read('auth/account-menu-panel.tsx');

describe('account menu: a second press on the avatar closes it', () => {
  it('the menu hands its avatar button to the panel', () => {
    expect(menu).toMatch(/<Panel[\s\S]*?trigger=\{button\}/);
    expect(panel).toMatch(/trigger: RefObject<HTMLElement \| null>/);
  });

  it('the outside-press listener ignores presses on that button', () => {
    const handler = /const onPointer = \(e: PointerEvent\) => \{([\s\S]*?)\n {4}\};/.exec(panel)?.[1] ?? '';
    expect(handler).toMatch(/trigger\.current\?\.contains\(e\.target\)/);
    expect(handler).toMatch(/onClose\(false\)/);
  });

  it('the avatar button still toggles', () => {
    expect(menu).toMatch(/setOpen\(\(o\) => !o\)/);
  });
});
