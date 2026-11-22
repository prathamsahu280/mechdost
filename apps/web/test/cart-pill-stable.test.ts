import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('cart pill keeps its size when the count changes (user 2026-11-22: top bar moving)', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'components', 'commerce', 'cart-pill.tsx'), 'utf8');
  it('the count badge has a fixed width and padding independent of the count', () => {
    expect(src).toMatch(/inline-block w-\[1\.75rem\] rounded-full px-0\.5/);
    const conditional = src.slice(src.indexOf('count > 0 ?'), src.indexOf('count > 0 ?') + 80);
    expect(conditional).not.toMatch(/px-|min-w|w-\[/);
  });
  it('three-digit counts are capped so the width never grows', () => {
    expect(src).toContain("count > 99 ? '99+' : count");
  });
});
