import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// SIM-LEAD-9 (live QA 2026-11-27): "← Back to partners" on /partners/apply/* was 18 px tall; WCAG 2.5.8 needs a
// 24 px target. Every back link on the page carries a min-height of 24 px (inline-flex so the height applies).
describe('partners apply back link is a 24 px target (SIM-LEAD-9)', () => {
  const src = readFileSync(
    new URL('../src/app/[locale]/partners/apply/[kind]/page.tsx', import.meta.url),
    'utf8',
  );
  it('every back link has min-h-6 and inline-flex', () => {
    const links = src.match(/<LocalLink\s+href="\/partners"[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toMatch(/inline-flex[^"]*min-h-6|min-h-6[^"]*inline-flex/);
  });
});
