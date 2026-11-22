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
      expect(html).toContain('max-width:349px');
      expect(html).toContain('max-height:420px');
      expect(html).toMatch(/width="349"/);
      expect(html).toMatch(/height="420"/);
      expect(html).toContain('aspect-');
      expect(html).toContain('items-center');
      expect(html).not.toContain('size-full');
    });
  }
});
