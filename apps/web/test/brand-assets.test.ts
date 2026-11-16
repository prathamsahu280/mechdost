/**
 * Brand assets (Q172, 2026-11-16): the logo SVGs, icons and manifest exist, the header and footer use the SVGs with a
 * dark variant swapped by CSS, and the alt text is the brand name.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..');
const pub = (p: string) => join(web, 'public', p);
const read = (p: string) => readFileSync(join(web, p), 'utf8');

/** PNG width and height from the IHDR chunk. */
function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('logo SVGs', () => {
  for (const name of ['mechdost-logo', 'mechdost-logo-dark', 'mechdost-mark', 'mechdost-mark-dark']) {
    it(`${name}.svg has a viewBox, the MechDost title and no fixed size`, () => {
      const svg = readFileSync(pub(`brand/${name}.svg`), 'utf8');
      expect(svg).toMatch(/<svg [^>]*viewBox="0 0 [\d.]+ [\d.]+"/);
      expect(svg).toContain('<title>MechDost</title>');
      expect(svg).not.toMatch(/<svg [^>]*\s(width|height)=/);
      expect(svg).not.toMatch(/<metadata|<!--|<script/);
    });
  }

  it('keeps the logo colours exactly and turns only the navy white on dark', () => {
    const light = readFileSync(pub('brand/mechdost-logo.svg'), 'utf8');
    const dark = readFileSync(pub('brand/mechdost-logo-dark.svg'), 'utf8');
    expect(light).toContain('#092349');
    expect(light).toContain('#f67411');
    expect(dark).not.toContain('#092349');
    expect(dark).toContain('#f4f7fb');
    expect(dark).toContain('#f67411');
  });

  it('keeps the original source image for reference', () => {
    expect(existsSync(pub('brand/source/logo-source.jpeg'))).toBe(true);
  });
});

describe('icons and manifest', () => {
  it('has the PNG icons at the sizes the manifest and head promise', () => {
    const sizes: Record<string, number> = {
      'apple-touch-icon.png': 180,
      'icon-192.png': 192,
      'icon-512.png': 512,
      'icon-maskable-192.png': 192,
      'icon-maskable-512.png': 512,
      'favicon-32.png': 32,
    };
    for (const [file, side] of Object.entries(sizes)) {
      expect(pngSize(pub(`brand/icons/${file}`))).toEqual({ w: side, h: side });
    }
    expect(pngSize(pub('brand/icons/og-image.png'))).toEqual({ w: 1200, h: 630 });
    expect(pngSize(pub('brand/icons/email-logo.png')).w).toBe(320);
  });

  it('has a favicon.ico and an SVG favicon that follows the dark colour scheme', () => {
    expect(statSync(pub('favicon.ico')).size).toBeGreaterThan(100);
    expect(readFileSync(pub('brand/favicon.svg'), 'utf8')).toContain('prefers-color-scheme:dark');
  });

  it('lists 192/512 icons, including maskable ones, in the manifest', () => {
    const manifest = read('src/app/manifest.ts');
    for (const side of ['192x192', '512x512']) {
      expect(manifest).toContain(`sizes: '${side}'`);
    }
    expect(manifest).toContain("purpose: 'maskable'");
    expect(manifest).toContain("short_name: 'MechDost'");
  });

  it('wires the favicon, the apple touch icon and the share image into the page head', () => {
    const layout = read('src/app/[locale]/layout.tsx');
    expect(layout).toContain('/favicon.ico');
    expect(layout).toContain('/brand/favicon.svg');
    expect(layout).toContain('/brand/icons/apple-touch-icon.png');
    expect(layout).toContain('/brand/icons/og-image.png');
  });
});

describe('header and footer brand', () => {
  const header = read('src/components/site/header.tsx');

  it('shows both logo artworks with width, height and the brand name as alt, swapped by CSS', () => {
    expect(header).toContain("light: '/brand/mechdost-logo.svg'");
    expect(header).toContain("dark: '/brand/mechdost-logo-dark.svg'");
    expect(header).toContain('{...BRAND_LOGO_SIZE}');
    expect(header).toContain("alt={t('brand')}");
    expect(header).toContain('brand-logo-light');
    expect(header).toContain('brand-logo-dark');
    expect(header).not.toContain('m<span');
    // A plain <img> for the vector logo, not next/image: next/image adds ~6 KB of client JS to every page that has no
    // other image and does nothing for an unoptimized SVG (budget incident 2026-11-16, /shop 185.7 KB gz).
    expect(header).not.toContain("from 'next/image'");
    expect(header.match(/^\s*<img$/gm)?.length).toBe(2);
    expect(header).toContain('decoding="async"');
    // React 19 preloads every non-lazy <img> it renders: both logo files were preloaded on every page (CI shell gate
    // "preloads only the hero", 2026-11-16). Lazy: the visible one still loads at once, the hidden theme never does.
    expect(header.match(/loading="lazy"/g)?.length).toBe(2);
    // The logo link is a tap target: at 320 px the 132 px logo is 23.9 px tall, under the 24 px minimum.
    expect(header).toMatch(
      /className="group inline-flex min-h-6 min-w-0 shrink flex-col items-start justify-center"/,
    );
    const css = read('src/app/[locale]/globals.css');
    expect(css).toMatch(/:root\[data-theme='dark'\] \.brand-logo-light\s*\{\s*display: none/);
    expect(css).toMatch(/:root:not\(\[data-theme='light'\]\) \.brand-logo-dark\s*\{\s*display: block/);
  });

  it('the footer reuses the same brand lock-up', () => {
    expect(read('src/components/site/footer.tsx')).toContain('<BrandMark />');
  });

  it('the email header shows the logo image when the site origin is known', () => {
    const layout = readFileSync(join(web, '..', '..', 'packages/shared/src/email-layout.ts'), 'utf8');
    expect(layout).toContain('/brand/icons/email-logo.png');
    expect(layout).toContain('alt="MechDost"');
  });
});
