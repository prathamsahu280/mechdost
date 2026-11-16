import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * The brand fonts for the bill PDF, from the `@fontsource` packages (OFL, data only, no scripts): DM Sans for body text,
 * Manrope for headings (the site's pairing), Noto Sans Devanagari for Hindi. fontkit shapes the Devanagari (conjuncts,
 * matras, reph) through the font's own OpenType tables; the Latin files carry no Devanagari and the Devanagari file
 * carries no ASCII, so the renderer picks the file per character run (`pdf/render.ts`).
 */
export type FontSlot = 'sans' | 'sansBold' | 'head' | 'devRegular' | 'devBold';

const FILES: Record<FontSlot, string> = {
  sans: '@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff',
  sansBold: '@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff',
  head: '@fontsource/manrope/files/manrope-latin-700-normal.woff',
  devRegular: '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff',
  devBold: '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff',
};

const nodeRequire = createRequire(import.meta.url);
const cache = new Map<FontSlot, Buffer>();

/** The font file's bytes, read once per process. */
export function fontBytes(slot: FontSlot): Buffer {
  let bytes = cache.get(slot);
  if (!bytes) {
    bytes = readFileSync(nodeRequire.resolve(FILES[slot]));
    cache.set(slot, bytes);
  }
  return bytes;
}

export const FONT_SLOTS = Object.keys(FILES) as FontSlot[];
