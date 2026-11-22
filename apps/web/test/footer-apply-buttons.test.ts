import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('footer "Apply as" links are prominent buttons (user 2026-11-22)', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'components', 'site', 'footer.tsx'), 'utf8');
  it('the three apply links are flagged prominent and styled as accent pills', () => {
    for (const t of ['footer_apply_seller', 'footer_apply_garage', 'footer_apply_mechanic'])
      expect(src).toMatch(new RegExp(String.raw`${t}',\s+prominent: true`));
    expect(src).toContain('rounded-pill bg-accent-button px-4 text-sm font-bold text-white');
  });
});
