import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Member profile `/ustaad/u/[handle]` in the approved network look (spec 23 § 21i-L, batch D2; design
 * 2026-11-27-ustaad-ui-upgrade § 3.8 "same card in surface style"). Source-level checks, like the other Mechanic
 * Network view tests: the header uses the key-tag level badge, a 16/800 name, the handle line and the Me stat row;
 * the actions stay the ones the page always had; the page still guards first.
 */
const screen = readFileSync(
  new URL('../src/components/ustaad/feed/profile-screen.tsx', import.meta.url),
  'utf8',
);
const page = readFileSync(new URL('../src/app/[locale]/ustaad/u/[handle]/page.tsx', import.meta.url), 'utf8');

describe('profile header', () => {
  it('shows the level as the key-tag badge, not a plain pill', () => {
    expect(screen).toContain("from '../common/pehchaan-tag'");
    expect(screen).toMatch(/<PehchaanTag[^>]*level=\{p\.member\.level\}/);
    expect(screen).not.toMatch(/rounded-full bg-pill px-2\.5 py-0\.5/);
  });
  it('sets the name at 16 px / 800 and prints the handle', () => {
    const h1 = /<h1[^>]*id="profile-name"[^>]*className="([^"]*)"/s.exec(screen)?.[1] ?? '';
    expect(h1).toContain('text-base');
    expect(h1).toContain('font-extrabold');
    expect(h1).toContain('font-heading');
    expect(screen).toContain('@{p.member.handle}');
  });
  it('keeps the Me stat row look: one divided list of counts with words, no tiles', () => {
    expect(screen).toContain('<dl');
    expect(screen).toContain('[&>div]:border-l');
    expect(screen).not.toContain('bg-surface-alt');
  });
  it('uses tokens only', () => {
    expect(screen).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(screen).not.toMatch(/\b(?:bg|text|border)-\[#/);
  });
});

describe('profile actions', () => {
  it('has exactly the existing actions: Follow, Connect, Message, More, and Mute / Block / Report in the sheet', () => {
    for (const key of [
      "t('follow')",
      "t('connect')",
      "t('message')",
      "t('moreActions')",
      "t('mute')",
      "t('block')",
      "t('report')",
    ])
      expect(screen, key).toContain(key);
    expect(screen).not.toMatch(/track\(/);
  });
});

describe('profile page', () => {
  it('still starts with the page guard', () => {
    const body = /export default async function \w+\([^)]*\) \{\s*await guardUstaadPage\(\);/.exec(page);
    expect(body).not.toBeNull();
  });
});
