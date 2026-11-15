/**
 * Side-bar clicks in the portals never jump to the top (user rule 2026-11-16 "no page may feel like a reload"). Next's
 * own scroll-on-navigation sent the page to the top in 2-3 of 10 runs (account and admin alike), so the side-bar link
 * turns it off and the frame reveals the new section itself, only when its top is out of view.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { needsReveal } from '../src/lib/reveal-section';

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('portal section scroll', () => {
  it('reveals a section only when its top is out of view', () => {
    expect(needsReveal(69, 480)).toBe(false);
    expect(needsReveal(-300, 480)).toBe(true);
    expect(needsReveal(600, 480)).toBe(true);
    expect(needsReveal(479, 480)).toBe(false);
  });
  it('the side-bar link turns off Next scrolling', () => {
    expect(read('components/portal/portal-nav-link.tsx')).toMatch(/<Link scroll=\{false\} \{\.\.\.rest\}/);
  });
  it('both frames reveal their section and both section roots are marked', () => {
    expect(read('components/portal/admin-console.tsx')).toMatch(/useRevealSection\(/);
    expect(read('components/account/account-area.tsx')).toMatch(/useRevealSection\(/);
    expect(read('components/portal/admin-console.tsx')).toMatch(/data-portal-section/);
    expect(read('components/account/account-area.tsx')).toMatch(/data-portal-section/);
  });
});
