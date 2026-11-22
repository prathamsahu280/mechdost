import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The "Apply as …" links (user 2026-11-22: "needs to be properly visible"), restyled by the approved v4 footer
 * (2026-11-23): not orange pills any more, but the three rows of the fifth column "For partners", a softly tinted panel
 * with a small icon tile before each label, plus "How partnering works". Still prominent, still 40 px+ targets.
 */
describe('footer "For partners" panel (v4, user-approved 2026-11-23)', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'components', 'site', 'footer.tsx'), 'utf8');

  it('holds the three apply links, each with an icon tile and its click id', () => {
    for (const t of ['footer_apply_seller', 'footer_apply_garage', 'footer_apply_mechanic'])
      expect(src).toMatch(new RegExp(String.raw`${t}',\s+icon: tile\(`));
    expect(src).toContain('bg-accent-soft text-accent-soft-text');
  });

  it('is the fifth column: a tinted panel after the four link columns, with a "How partnering works" link', () => {
    expect(src).toContain('aria-labelledby="footer-col-partners"');
    expect(src).toContain('min-[1100px]:grid-cols-[repeat(4,minmax(0,1fr))_minmax(210px,1.35fr)]');
    expect(src).toContain('rounded-2xl bg-bg');
    expect(src).toContain("chrome('howPartnering')");
    expect(src).toContain('data-track="footer_partners"');
  });

  it('no longer uses the orange pill buttons', () => {
    expect(src).not.toContain('rounded-pill bg-accent-button');
    expect(src).not.toContain('prominent');
  });
});
