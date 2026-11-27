import { describe, expect, it } from 'vitest';
import { isCurrentUstaadTab } from '@/components/ustaad/shell/ustaad-nav';

// The Hindi dock/rail never marked the current tab (QA simulation 2026-11-27, audit #5): the pathname kept `/hi`.
describe('Ustaad dock: current tab in both languages', () => {
  it.each([
    ['/ustaad', '/ustaad', true],
    ['/hi/ustaad', '/ustaad', true],
    ['/en/ustaad', '/ustaad', true],
    ['/hi/ustaad/learn', '/ustaad/learn', true],
    ['/hi/ustaad/learn/abc', '/ustaad/learn', true],
    ['/hi/ustaad/learn', '/ustaad', false],
    ['/ustaad/me', '/ustaad/learn', false],
  ])('%s on tab %s → %s', (pathname, path, expected) => {
    expect(isCurrentUstaadTab(pathname, path)).toBe(expected);
  });
});
