// Builds the raster brand icons (favicon, apple-touch, PWA, OG) from the SVGs in public/brand.
// Run: node apps/web/scripts/make-brand-icons.mjs   (uses `sharp` from apps/api; adds no dependency to the web app).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const brand = join(publicDir, 'brand');
const require = createRequire(join(here, '..', '..', 'api', 'package.json'));
const sharp = require('sharp');

const NAVY = '#092349';
const logoDarkSvg = readFileSync(join(brand, 'mechdost-logo-dark.svg'), 'utf8');
const markSvg = readFileSync(join(brand, 'mechdost-mark.svg'), 'utf8');
const markDarkSvg = readFileSync(join(brand, 'mechdost-mark-dark.svg'), 'utf8');
const logoSvg = readFileSync(join(brand, 'mechdost-logo.svg'), 'utf8');

/** Mark centred on a square, `fill` the share of the side it covers. */
async function squareIcon(size, { fill, background, svg }) {
  const inner = Math.round(size * fill);
  const mark = await sharp(Buffer.from(svg), { density: 600 })
    .resize({ width: inner, height: inner, fit: 'inside' })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const white = '#ffffff';
const icons = join(brand, 'icons');
mkdirSync(icons, { recursive: true });
const out = (name, buf) => writeFileSync(join(icons, name), buf);

out('apple-touch-icon.png', await squareIcon(180, { fill: 0.72, background: white, svg: markSvg }));
out('icon-192.png', await squareIcon(192, { fill: 0.72, background: white, svg: markSvg }));
out('icon-512.png', await squareIcon(512, { fill: 0.72, background: white, svg: markSvg }));
// Maskable: the mark stays inside the 80 % safe zone (fill 0.5 of the canvas) on a solid navy field.
out('icon-maskable-192.png', await squareIcon(192, { fill: 0.5, background: NAVY, svg: markDarkSvg }));
out('icon-maskable-512.png', await squareIcon(512, { fill: 0.5, background: NAVY, svg: markDarkSvg }));
const fav32 = await squareIcon(32, { fill: 0.92, background: { r: 0, g: 0, b: 0, alpha: 0 }, svg: markSvg });
out('favicon-32.png', fav32);
// A PNG-in-ICO container (single 32x32 image) for browsers that ask for /favicon.ico.
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(32, 6);
header.writeUInt8(32, 7);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(fav32.length, 14);
header.writeUInt32LE(22, 18);
writeFileSync(join(publicDir, 'favicon.ico'), Buffer.concat([header, fav32]));

// SVG favicon: the mark, with the navy turning near-white under a dark browser theme.
writeFileSync(
  join(brand, 'favicon.svg'),
  markSvg
    .replace(
      '<title>MechDost</title>',
      '<title>MechDost</title><style>.n{fill:' +
        NAVY +
        '}@media(prefers-color-scheme:dark){.n{fill:#f4f7fb}}</style>',
    )
    .replace(`fill="${NAVY}"`, 'class="n"'),
);

// Email header logo (white + orange on the navy header), 2x of 160x29 for sharp retina rendering.
out(
  'email-logo.png',
  await sharp(Buffer.from(logoDarkSvg), { density: 600 })
    .resize({ width: 320 })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

// Share image 1200x630: logo on white.
const logo = await sharp(Buffer.from(logoSvg), { density: 600 }).resize({ width: 760 }).png().toBuffer();
out(
  'og-image.png',
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: white } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer(),
);
console.log('brand icons written to', icons);
