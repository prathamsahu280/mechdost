import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { ProductGallery } from '../src/components/catalogue/product-gallery';
import { ProductPhoto } from '../src/components/catalogue/product-photo';
import { indexFromScroll, stepIndex } from '../src/lib/gallery-nav';

/**
 * Product gallery (user, 2026-11-24: photos opened the raw API image in a new tab, no way to switch the big photo).
 * The interactive parts are plain functions (stepIndex, indexFromScroll); the markup is checked on the server render.
 */
const mk = (n: number) => ({
  path: `p${String(n)}`,
  alt: `Exide Mileage battery, view ${String(n)} of a very long product name that wraps over several lines`,
  width: 800,
  height: 800,
  lqip: null,
});

function render(count: number, locale: 'en' | 'hi' = 'en'): string {
  const photos = Array.from({ length: count }, (_, i) => mk(i + 1));
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: locale === 'en' ? en : hi,
      children: createElement(ProductGallery, {
        photos,
        slides: photos.map((p, i) =>
          createElement(ProductPhoto, {
            key: p.path,
            photo: p,
            size: 'hero',
            sizes: '560px',
            priority: i === 0,
          }),
        ),
        thumbs: photos.map((p) =>
          createElement(ProductPhoto, { key: p.path, photo: p, size: 'thumb', sizes: '80px' }),
        ),
      }),
    }),
  );
}

describe('stepIndex (arrow keys and arrows)', () => {
  it('moves one photo left or right', () => {
    expect(stepIndex(2, 5, 'ArrowRight')).toBe(3);
    expect(stepIndex(2, 5, 'ArrowLeft')).toBe(1);
  });
  it('does not wrap: the ends stay put', () => {
    expect(stepIndex(0, 5, 'ArrowLeft')).toBeNull();
    expect(stepIndex(4, 5, 'ArrowRight')).toBeNull();
  });
  it('ignores other keys and a single photo', () => {
    expect(stepIndex(1, 5, 'Enter')).toBeNull();
    expect(stepIndex(0, 1, 'ArrowRight')).toBeNull();
  });
});

describe('indexFromScroll (swipe)', () => {
  it('rounds the scroll position to the nearest photo', () => {
    expect(indexFromScroll(0, 400, 3)).toBe(0);
    expect(indexFromScroll(210, 400, 3)).toBe(1);
    expect(indexFromScroll(800, 400, 3)).toBe(2);
  });
  it('is null before layout or past the last photo', () => {
    expect(indexFromScroll(0, 0, 3)).toBeNull();
    expect(indexFromScroll(1600, 400, 3)).toBeNull();
  });
});

describe('ProductGallery markup', () => {
  it('many photos: every photo has a thumbnail button (the first too), the first is current, "1 / 5" counter, arrows', () => {
    const html = render(5);
    expect((html.match(/aria-label="Show photo \d of 5"/g) ?? []).length).toBe(5);
    expect(html).toMatch(/aria-label="Show photo 1 of 5"[^>]*aria-current="true"/);
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
    expect(html).toContain('1 / 5');
    expect(html).toContain('aria-label="Previous photo"');
    expect(html).toContain('aria-label="Next photo"');
    expect(html).toMatch(/aria-label="Previous photo"[^>]*disabled/);
    expect(html).toContain('role="status"');
    expect(html).toContain('Photo 1 of 5');
  });
  it('the big picture opens the full view; only the active slide is reachable', () => {
    const html = render(3);
    expect(html).toContain('aria-label="View photo 1 of 3 larger"');
    expect((html.match(/inert=""/g) ?? []).length).toBe(2);
  });
  it('only the first big photo loads eagerly (LCP); the others and every thumbnail are lazy', () => {
    const html = render(3);
    // 3 big + 3 thumbs = 6 images; the one eager image is the first big photo.
    expect((html.match(/loading="lazy"/g) ?? []).length).toBe(5);
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('loading="lazy"'));
  });
  it('one photo: no strip, no arrows, no counter, but it still opens the full view', () => {
    const html = render(1);
    expect(html).not.toContain('Show photo');
    expect(html).not.toContain('Previous photo');
    expect(html).not.toContain('Next photo');
    expect(html).not.toContain('1 / 1');
    expect(html).toContain('aria-label="View photo 1 of 1 larger"');
  });
  it('never links anywhere: no anchor, no new tab, no API address', () => {
    const html = render(4);
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('target=');
    expect(html).not.toContain('href=');
  });
  it('every control is a button with a name; thumbnails are at least 24 px', () => {
    const html = render(4);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b).toContain('type="button"');
      expect(b).toContain('aria-label=');
    }
    expect(html).toContain('size-16');
  });
  it('Hindi: every label and the counter come from the Hindi file', () => {
    const html = render(3, 'hi');
    expect(html).toContain('aria-label="3 में से फ़ोटो 2 दिखाएँ"');
    expect(html).toContain('aria-label="पिछली फ़ोटो"');
    expect(html).toContain('aria-label="अगली फ़ोटो"');
    expect(html).not.toContain('Show photo');
  });
  it('long names do not break the layout: alt text is on the image, labels stay short', () => {
    expect(render(2)).toContain('very long product name');
  });
});

describe('source guards', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf8');
  it('the gallery and viewer never open a tab or link to the API', () => {
    for (const src of [
      read('components', 'catalogue', 'product-gallery.tsx'),
      read('components', 'catalogue', 'product-photo-viewer.tsx'),
    ]) {
      expect(src).not.toContain('_blank');
      expect(src).not.toContain('window.open');
      expect(src).not.toContain('<a ');
    }
  });
  it('the full view is a lazy chunk, loaded on first open, and not imported eagerly', () => {
    const src = read('components', 'catalogue', 'product-gallery.tsx');
    expect(src).toMatch(/import\('\.\/product-photo-viewer'\)/);
    expect(src).not.toMatch(/^import \{[^}]*\} from '\.\/product-photo-viewer'/m);
  });
  it('the page no longer builds raw image links', () => {
    expect(read('app', '[locale]', 'shop', '[slug]', 'page.tsx')).not.toContain('width: 1600');
  });
  it('the old new-tab label is gone from both locale files', () => {
    expect(JSON.stringify(en)).not.toContain('"photoOpens"');
    expect(JSON.stringify(hi)).not.toContain('"photoOpens"');
  });
});
