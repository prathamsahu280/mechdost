import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('cart pill keeps its size when the count changes (user 2026-11-22: top bar moving; v4 2026-11-23)', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'components', 'commerce', 'cart-pill.tsx'), 'utf8');
  it('the count badge has a fixed box independent of the count', () => {
    expect(src).toMatch(/grid size-\[18px\] place-items-center rounded-full/);
    expect(src).toMatch(/sm:size-6 sm:rounded-lg/);
    const conditional = src.slice(src.indexOf('count > 0 ?'), src.indexOf('count > 0 ?') + 80);
    // Only visibility changes with the count (phones hide a zero badge, it still holds its box).
    expect(conditional).not.toMatch(/px-|min-w|w-\[|size-/);
    expect(conditional).toContain('max-sm:invisible');
  });
  it('three-digit counts are capped so the width never grows', () => {
    expect(src).toContain("count > 99 ? '99+' : count");
  });
});
