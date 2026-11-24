/**
 * Picture normalising for the battery imports (Tata Green, user 2026-11-24): plain borders trimmed where safe, the
 * product centred on a square canvas with equal padding, never enlarged more than twice, never above 1600 px, a
 * non-white plain background kept as is, a scene (corners differ) never cropped.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { NORMALISE, normaliseProductPicture } from '../src/photos/normalise';

interface Rgb {
  r: number;
  g: number;
  b: number;
}
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** A `w`×`h` picture of `bg` with a `cw`×`ch` red block centred. */
async function block(
  w: number,
  h: number,
  cw: number,
  ch: number,
  bg: Rgb = WHITE,
  format: 'jpeg' | 'png' = 'png',
) {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: bg } }).composite([
    {
      input: {
        create: { width: cw, height: ch, channels: 3, background: { r: 200, g: 30, b: 30 } },
      },
      left: Math.floor((w - cw) / 2),
      top: Math.floor((h - ch) / 2),
    },
  ]);
  return format === 'jpeg' ? img.jpeg({ quality: 92 }).toBuffer() : img.png().toBuffer();
}

async function pixel(buf: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 3;
  return [data[i], data[i + 1], data[i + 2]];
}

/** The box of red pixels in a result. */
async function redBox(buf: Buffer) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1)
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * 3;
      if ((data[i] ?? 0) > 150 && (data[i + 1] ?? 255) < 90) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

describe('normaliseProductPicture', () => {
  it('trims a plain white border and centres the product on a square canvas', async () => {
    const out = await normaliseProductPicture(await block(572, 622, 200, 300));
    expect(out.trimmed).toBe(true);
    const meta = await sharp(out.data).metadata();
    expect(meta.width).toBe(meta.height);
    expect(meta.width).toBe(out.size);
    const box = await redBox(out.data);
    // Centred: the same space on both sides (within a pixel of rounding).
    expect(Math.abs(box.minX - (out.size - 1 - box.maxX))).toBeLessThanOrEqual(2);
    expect(Math.abs(box.minY - (out.size - 1 - box.maxY))).toBeLessThanOrEqual(2);
    // The product keeps its proportions (200:300) and fills the same share whatever the source margins were.
    expect(box.height / box.width).toBeCloseTo(1.5, 1);
    expect(box.height / out.size).toBeCloseTo(1 - 2 * NORMALISE.padRatio, 1);
    expect(await pixel(out.data, 0, 0)).toEqual([255, 255, 255]);
  });

  it('gives the same product share for a tight picture and a loose one', async () => {
    const tight = await normaliseProductPicture(await block(300, 300, 280, 280));
    const loose = await normaliseProductPicture(await block(1600, 1600, 280, 280));
    expect(tight.size).toBe(loose.size);
    const a = await redBox(tight.data);
    const b = await redBox(loose.data);
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(2);
  });

  it('never makes a picture larger than 1600 px, large sources are reduced', async () => {
    const out = await normaliseProductPicture(await block(3200, 2400, 3000, 2200, WHITE, 'jpeg'));
    expect(out.size).toBeLessThanOrEqual(NORMALISE.maxEdge);
    expect(out.size).toBe(1600);
    expect(out.scale).toBeLessThan(1);
  });

  it('does not enlarge a small picture beyond twice its size', async () => {
    const out = await normaliseProductPicture(await block(130, 110, 120, 100));
    expect(out.scale).toBe(2);
    const box = await redBox(out.data);
    expect(box.width).toBeLessThanOrEqual(240);
    expect(out.size).toBeLessThan(NORMALISE.maxEdge);
  });

  it('keeps a black background (a matte baked into a JPEG) instead of putting a black box on white', async () => {
    const out = await normaliseProductPicture(await block(600, 400, 300, 200, { r: 0, g: 0, b: 0 }, 'jpeg'));
    expect(out.background).toBe('matte');
    expect(out.trimmed).toBe(true);
    const [r, g, b] = await pixel(out.data, 2, 2);
    expect(Math.max(r ?? 255, g ?? 255, b ?? 255)).toBeLessThan(10);
  });

  it('never crops a scene: corners of different colours mean no trimming', async () => {
    const left = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        {
          input: { create: { width: 200, height: 300, channels: 3, background: { r: 20, g: 20, b: 120 } } },
          left: 200,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const out = await normaliseProductPicture(left);
    expect(out.trimmed).toBe(false);
    expect(out.background).toBe('white');
    expect(out.sourceWidth).toBe(400);
  });

  it('flattens transparency onto white and trims the empty border', async () => {
    const png = await sharp({
      create: { width: 500, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: {
            create: { width: 100, height: 200, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } },
          },
          left: 200,
          top: 150,
        },
      ])
      .png()
      .toBuffer();
    const out = await normaliseProductPicture(png);
    expect(out.trimmed).toBe(true);
    expect(out.background).toBe('white');
    expect(await pixel(out.data, 1, 1)).toEqual([255, 255, 255]);
  });

  it('keeps a blank picture as it is (nothing to trim) and does not fail', async () => {
    const blank = await sharp({
      create: { width: 200, height: 200, channels: 3, background: WHITE },
    })
      .png()
      .toBuffer();
    const out = await normaliseProductPicture(blank);
    expect(out.trimmed).toBe(false);
    expect(out.size).toBeGreaterThan(0);
  });

  it('rejects a file that is not a picture', async () => {
    await expect(normaliseProductPicture(Buffer.from('not a picture'))).rejects.toThrow();
  });
});
