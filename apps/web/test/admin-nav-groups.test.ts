/**
 * Admin side bar (design 2026-11-24): sections are grouped under headings, every section sits in exactly one group,
 * and the side bar and the settings page follow one scroll model (the page is the only vertical scroller; the side
 * bar sticks under the header and scrolls itself only when it is taller than the window).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_NAV_GROUPS, groupAdminSections } from '../src/lib/admin-nav-groups';
import { ALL_ADMIN_SECTIONS } from '../src/lib/sections';
import { revealCurrentIn } from '../src/lib/use-center-current';

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('admin side bar groups', () => {
  it('places every admin section in exactly one group', () => {
    const placed = ADMIN_NAV_GROUPS.flatMap((g) => g.sections);
    expect([...placed].sort()).toEqual([...ALL_ADMIN_SECTIONS].sort());
  });

  it('keeps only the sections shown in this build and drops empty groups', () => {
    const groups = groupAdminSections(['overview', 'orders', 'settings']);
    expect(groups.map((g) => g.id)).toEqual(['home', 'operations', 'system']);
    expect(groups.flatMap((g) => g.sections)).toEqual(['overview', 'orders', 'settings']);
  });

  it('only the first group goes without a heading', () => {
    expect(ADMIN_NAV_GROUPS[0]?.heading).toBeNull();
    expect(ADMIN_NAV_GROUPS.slice(1).every((g) => g.heading === g.id)).toBe(true);
  });
});

describe('admin scroll model', () => {
  it('the side bar sticks under the header and is its own scroller only when taller than the window', () => {
    const src = read('components/portal/admin-console.tsx');
    expect(src).toMatch(/data-scroll="sidebar"/);
    expect(src).toMatch(/nav:sticky/);
    expect(src).toMatch(/nav:max-h-\[calc\(100dvh-/);
    expect(src).toMatch(/nav:overflow-y-auto/);
  });

  it('the side bar uses icons, not emoji', () => {
    const src = read('components/portal/admin-console.tsx');
    expect(src).not.toMatch(/SECTION_EMOJI/);
    const start = src.indexOf('const SECTION_ICON');
    const end = src.indexOf('function Overview');
    expect(start).toBeGreaterThan(0);
    expect(src.slice(start, end)).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('reveals the current item inside a tall side bar without touching the page', () => {
    const bar = (top: number) => ({
      scrollHeight: 1000,
      clientHeight: 500,
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 100, bottom: 600 }),
      querySelector: () => ({ getBoundingClientRect: () => ({ top, bottom: top + 40 }) }),
    });
    const below = bar(700);
    revealCurrentIn(below);
    expect(below.scrollTop).toBe(700 + 40 - 600 + 8);
    const above = bar(50);
    revealCurrentIn(above);
    expect(above.scrollTop).toBe(50 - 100 - 8);
    const inside = bar(300);
    revealCurrentIn(inside);
    expect(inside.scrollTop).toBe(0);
    const fits = { ...bar(900), scrollHeight: 500 };
    revealCurrentIn(fits);
    expect(fits.scrollTop).toBe(0);
  });

  it('the settings categories do not stick: one sticky rail only (the side bar)', () => {
    const src = read('components/portal/admin-settings-workbench.tsx');
    expect(src).not.toMatch(/min-\[1200px\]:sticky/);
  });

  it('no admin section scrolls inside a box (max-height with overflow)', () => {
    for (const f of ['components/portal/admin-console.tsx', 'components/portal/admin-quotes-api.tsx']) {
      expect(read(f)).not.toMatch(/max-h-\d+[^"]*overflow-y-auto/);
    }
    expect(read('components/portal/admin-catalogue-bulk.tsx')).not.toMatch(/max-h-96/);
  });
});
