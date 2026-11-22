import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('compare shows the real product photo (live check 2026-11-22)', () => {
  it('renders ProductPhoto when the product has a photo, artwork otherwise', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'components', 'catalogue', 'compare-table.tsx'),
      'utf8',
    );
    expect(src).toMatch(/p\.photo \? \(\s*<ProductPhoto photo=\{p\.photo\}/);
    expect(src).toMatch(/<ProductVisual category=\{p\.category\.key\}/);
  });
});

describe('product page trust line (live check 2026-11-22)', () => {
  it('"from a verified shop" shows only when a shop offers the product', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'app', '[locale]', 'shop', '[slug]', 'page.tsx'),
      'utf8',
    );
    expect(src).toMatch(/\{onRequest \? null : \(\s*<TrustLine\s+placement="product"/);
  });
});
