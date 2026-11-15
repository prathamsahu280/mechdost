/**
 * The packing slip's QR code is drawn by our own small encoder, so the tests read the symbol back like a scanner would:
 * the two format copies agree and decode a mask, the codewords unmask cleanly, Reed-Solomon checks pass and the
 * bytes are the order code.
 */
import { describe, expect, it } from 'vitest';
import { QR_MAX_BYTES, qrCodewords, qrMatrix, qrSvg, readQr, rsValid } from '../src/qr';

const decode = (codewords: number[]) => {
  // Byte mode: 4-bit mode, 8-bit count, then the bytes.
  const bits = codewords.map((c) => c.toString(2).padStart(8, '0')).join('');
  const count = parseInt(bits.slice(4, 12), 2);
  const bytes = Array.from({ length: count }, (_, i) => parseInt(bits.slice(12 + i * 8, 20 + i * 8), 2));
  return { mode: bits.slice(0, 4), text: new TextDecoder().decode(new Uint8Array(bytes)) };
};

describe('qr encoder', () => {
  it.each(['MD-RPR-2026-ABC234-1', 'MD-RPR-2026-K7M2QX-12', 'A', 'x'.repeat(40), 'y'.repeat(QR_MAX_BYTES)])(
    'round-trips %s',
    (text) => {
      const m = qrMatrix(text);
      expect(m).not.toBeNull();
      if (!m) return;
      const read = readQr(m);
      expect(read.formatOk).toBe(true);
      expect(read.mask).toBeGreaterThanOrEqual(0);
      const eccCount = [7, 10, 15, 20][read.version - 1] ?? 0;
      expect(rsValid(read.codewords, eccCount)).toBe(true);
      const out = decode(read.codewords);
      expect(out.mode).toBe('0100');
      expect(out.text).toBe(text);
    },
  );

  it('draws the three finder patterns, timing lines and the dark module', () => {
    const m = qrMatrix('MD-RPR-2026-ABC234-1');
    expect(m).not.toBeNull();
    if (!m) return;
    const n = m.length;
    expect(n).toBe(25); // version 2
    const dark = (x: number, y: number) => m[y]?.[x] === true;
    for (const [cx, cy] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ] as const) {
      expect(dark(cx, cy)).toBe(true);
      expect(dark(cx + 3, cy + 3)).toBe(true);
      expect(dark(cx + 1, cy + 1)).toBe(false);
    }
    expect(dark(8, n - 8)).toBe(true);
    expect(dark(8, 6)).toBe(true);
    expect(dark(9, 6)).toBe(false);
  });

  it('chooses the smallest version and refuses text that does not fit', () => {
    expect(qrCodewords('hi')?.version).toBe(1);
    expect(qrCodewords('x'.repeat(30))?.version).toBe(2);
    expect(qrCodewords('x'.repeat(QR_MAX_BYTES + 1))).toBeNull();
    expect(qrMatrix('x'.repeat(200))).toBeNull();
  });

  it('gives SVG path data with a quiet zone', () => {
    const svg = qrSvg('MD-RPR-2026-ABC234-1');
    expect(svg?.side).toBe(25 + 8);
    expect(svg?.d.startsWith('M')).toBe(true);
  });
});
