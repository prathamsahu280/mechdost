import sharp from 'sharp';

/**
 * Evens out the product pictures of an import (Tata Green import, user 2026-11-24: "you might have to edit the images
 * maybe if their sizes dont matter"). The source pictures come in 20 different sizes with very different white margins;
 * on a product card that makes the batteries look big or small at random. Each picture is
 *  1. flattened onto white (transparency),
 *  2. trimmed of a plain border, only when its four corners agree on one colour (a picture whose corners differ is a
 *     scene, not a cut-out, and is never cropped), and only when what is left is a sensible part of the picture,
 *  3. scaled so the product fills the same share of a square canvas (never more than `maxUpscale` times larger,
 *     never above `maxEdge` px),
 *  4. centred on that square canvas with the same padding all round.
 * The canvas is white; a picture whose plain background is not near white (a black matte baked into a JPEG) keeps its
 * own background colour, so no hard rectangle appears. Nothing is painted out and no part of the product is edited:
 * only plain border pixels are removed and only padding is added. The source file is never touched.
 */
export const NORMALISE = {
  /** Longest side of the output square. */
  maxEdge: 1600,
  /** Padding on each side, as a share of the canvas. */
  padRatio: 0.08,
  /** A small picture is enlarged at most this much. */
  maxUpscale: 2,
  /** A pixel differs from the background by more than this (largest channel difference) to count as product. */
  contentThreshold: 16,
  /** The four corners must agree within this (largest channel difference) for the border to be trimmed. */
  cornerTolerance: 12,
  /** A row or column needs this many product pixels to count (JPEG noise is not product). */
  minPixelsPerLine: 2,
  /** What is left after trimming must be at least this share of the picture in both directions (a speck is not a product). */
  minKeepRatio: 0.1,
  /** A background with every channel at or above this is "white". */
  whiteFrom: 245,
} as const;

export interface NormalisedPicture {
  /** PNG of the square canvas. */
  data: Buffer;
  /** Size of the square canvas. */
  size: number;
  /** Size of the source picture. */
  sourceWidth: number;
  sourceHeight: number;
  /** Whether a plain border was removed. */
  trimmed: boolean;
  /** Enlargement (>1) or reduction (<1) of the trimmed picture. */
  scale: number;
  /** `white` canvas, or `matte`: the picture's own plain background colour. */
  background: 'white' | 'matte';
}

type Rgb = [number, number, number];

const maxDiff = (a: Rgb, b: Rgb) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** The plain background colour (mean of the four corners) or null when the corners disagree. */
function plainBackground(px: Buffer, w: number, h: number): Rgb | null {
  const at = (x: number, y: number): Rgb => {
    const i = (y * w + x) * 3;
    return [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0];
  };
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const mean: Rgb = [0, 1, 2].map((c) => Math.round(corners.reduce((n, p) => n + (p[c] ?? 0), 0) / 4)) as Rgb;
  return corners.every((p) => maxDiff(p, mean) <= NORMALISE.cornerTolerance) ? mean : null;
}

/** The box of everything that is not background (null = nothing found). */
function contentBox(px: Buffer, w: number, h: number, bg: Rgb) {
  const rows = new Uint32Array(h);
  const cols = new Uint32Array(w);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3;
      if (maxDiff([px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0], bg) > NORMALISE.contentThreshold) {
        rows[y] = (rows[y] ?? 0) + 1;
        cols[x] = (cols[x] ?? 0) + 1;
      }
    }
  const min = NORMALISE.minPixelsPerLine;
  const first = (a: Uint32Array) => a.findIndex((n) => n >= min);
  const last = (a: Uint32Array) => a.findLastIndex((n) => n >= min);
  const top = first(rows);
  const left = first(cols);
  if (top < 0 || left < 0) return null;
  return { left, top, width: last(cols) - left + 1, height: last(rows) - top + 1 };
}

export async function normaliseProductPicture(input: Buffer): Promise<NormalisedPicture> {
  const { data: px, info } = await sharp(input, { failOn: 'error', animated: false })
    .rotate()
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;

  const bg = plainBackground(px, w, h);
  let box = { left: 0, top: 0, width: w, height: h };
  let trimmed = false;
  if (bg) {
    const found = contentBox(px, w, h, bg);
    if (
      found &&
      found.width >= w * NORMALISE.minKeepRatio &&
      found.height >= h * NORMALISE.minKeepRatio &&
      (found.width < w || found.height < h)
    ) {
      box = found;
      trimmed = true;
    }
  }

  const white = bg === null || bg.every((c) => c >= NORMALISE.whiteFrom);
  const canvasColour: Rgb = bg !== null && !white ? bg : [255, 255, 255];

  const target = NORMALISE.maxEdge * (1 - 2 * NORMALISE.padRatio);
  const longest = Math.max(box.width, box.height);
  const scale = Math.min(NORMALISE.maxUpscale, target / longest);
  const newW = Math.max(1, Math.round(box.width * scale));
  const newH = Math.max(1, Math.round(box.height * scale));
  const size = Math.min(NORMALISE.maxEdge, Math.ceil(Math.max(newW, newH) / (1 - 2 * NORMALISE.padRatio)));

  const product = await sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .extract(box)
    .resize(newW, newH, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const data = await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: canvasColour[0], g: canvasColour[1], b: canvasColour[2] },
    },
  })
    .composite([{ input: product, left: Math.floor((size - newW) / 2), top: Math.floor((size - newH) / 2) }])
    .png({ compressionLevel: 6 })
    .toBuffer();
  return {
    data,
    size,
    sourceWidth: w,
    sourceHeight: h,
    trimmed,
    scale,
    background: white ? 'white' : 'matte',
  };
}
