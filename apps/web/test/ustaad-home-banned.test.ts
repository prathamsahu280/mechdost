import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// SIM-RT1 (live retest 2026-11-27): a banned member saw the normal network Home with a panel of raw
// `ustaad.standing.*` keys — MemberGate wrapped only the feed and the page did not load the standing messages.
const page = readFileSync(new URL('../src/app/[locale]/ustaad/page.tsx', import.meta.url), 'utf8');
const common = readFileSync(new URL('../src/components/ustaad/common.tsx', import.meta.url), 'utf8');

describe('banned member on the network Home', () => {
  it('the whole Home sits inside BannedGate with the standing messages loaded', () => {
    expect(common).toMatch(/export function BannedGate\(/);
    const gate = page.indexOf('<BannedGate>');
    expect(gate).toBeGreaterThan(-1);
    expect(page.indexOf('ustaad-stories')).toBeGreaterThan(gate);
    expect(page.indexOf('ustaad-feed')).toBeGreaterThan(gate);
    expect(page.slice(0, gate)).toMatch(/'ustaad\.standing'/);
  });
  it('the feed gate also has the standing messages (limited banner / banned screen)', () => {
    const feed = page.slice(page.indexOf('ustaad-feed'));
    const ns = feed.slice(feed.indexOf('<ClientMessages'), feed.indexOf('<MemberGate>'));
    expect(ns).toMatch(/'ustaad\.standing'/);
  });
});

// SIM-RT2: links stored in bell rows before the SIM-P19 fix must still land on a real page.
describe('old Ustaad bell links redirect', () => {
  it.each([
    ['../src/app/[locale]/ustaad/notifications/page.tsx', '/notifications'],
    ['../src/app/[locale]/ustaad/me/verify/page.tsx', '/ustaad/me'],
  ])('%s → %s', (file, target) => {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(src).toContain(`redirect(localePath('${target}', locale))`);
  });
});
