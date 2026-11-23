import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductPhoto } from '../src/components/catalogue/product-photo';

/**
 * Photos are never shown larger than they are (live audit 2026-11-22 item 4: a 349 px photo drawn 541 px wide looked
 * soft). The frame keeps its aspect ratio (no layout shift) and the picture sits in its middle at most at its own size.
 */
const photo = { path: 'p1', alt: 'Gulf oil', width: 349, height: 420, lqip: null };

describe('ProductPhoto', () => {
  for (const size of ['card', 'hero', 'thumb'] as const) {
    it(`${size}: caps the picture at its own width and height, centred in a fixed frame`, () => {
      const html = renderToStaticMarkup(createElement(ProductPhoto, { photo, sizes: '300px', size }));
      expect(html).toContain('max-width:min(100%, 349px)');
      expect(html).toContain('max-height:min(100%, 420px)');
      expect(html).toMatch(/width="349"/);
      expect(html).toMatch(/height="420"/);
      expect(html).toContain('aspect-');
      expect(html).toContain('items-center');
      expect(html).not.toContain('size-full');
    });
  }
});

describe('a photo can never be wider than its card (live 2026-11-23: overlapping cards, sideways scroll on /shop)', () => {
  const src = readFileSync(
    join(__dirname, '..', 'src', 'components', 'catalogue', 'product-photo.tsx'),
    'utf8',
  );
  it('caps with min(100%, Npx), never a bare px max-width/height that overrides max-w-full', () => {
    expect(src).toMatch(/maxWidth: `min\(100%, \$\{String\(photo\.width\)\}px\)`/);
    expect(src).toMatch(/maxHeight: `min\(100%, \$\{String\(photo\.height\)\}px\)`/);
    expect(src).not.toMatch(/maxWidth: photo\.width\b/);
    expect(src).not.toMatch(/maxHeight: photo\.height\b/);
  });
  it('the frame cannot be pushed open by its image (grid cell min-content)', () => {
    expect(src).toContain('relative flex w-full min-w-0 items-center justify-center overflow-hidden');
  });
});

describe('photo size never depends on the browser’s srcset density guess (live 2026-11-23: tiny photos on a Mac)', () => {
  it('fills its capped box with object-contain instead of auto width/height', () => {
    const html = renderToStaticMarkup(
      createElement(ProductPhoto, {
        photo: { ...photo, width: 300, height: 300 },
        sizes: '25vw',
        size: 'card',
      }),
    );
    const img = /<img[^>]*>/.exec(html)?.[0] ?? '';
    expect(img).toMatch(/class="[^"]*\bh-full\b[^"]*\bw-full\b/);
    expect(img).toContain('object-contain');
    expect(img).not.toMatch(/\bw-auto\b|\bh-auto\b/);
    expect(img).toContain('max-width:min(100%, 300px)');
  });
  it('the blur placeholder is sized like the photo (contain), never a haze filling the box', () => {
    const html = renderToStaticMarkup(
      createElement(ProductPhoto, {
        photo: { ...photo, lqip: 'data:image/webp;base64,AAAA' },
        sizes: '25vw',
        size: 'card',
      }),
    );
    expect(html).toContain('background-size:contain');
    expect(html).not.toContain('background-size:cover');
  });
});
