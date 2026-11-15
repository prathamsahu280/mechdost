/**
 * A small QR Code encoder for the packing slip (design 2026-11-15, item 5): byte mode, error correction level L,
 * versions 1 to 4 (up to 78 bytes: an order code is about 20). No dependency, so the slip adds almost no JavaScript
 * and nothing to the supply chain (docs/research/security-vulnerabilities.md). Follows ISO/IEC 18004; the tests read
 * the symbol back (format bits, Reed-Solomon check, the text) rather than trusting the drawing.
 */

/** Data codewords and error-correction codewords at level L, one block each, versions 1 to 4. */
const VERSIONS = [
  { data: 19, ecc: 7 },
  { data: 34, ecc: 10 },
  { data: 55, ecc: 15 },
  { data: 80, ecc: 20 },
] as const;
export const QR_MAX_BYTES = 78;

const EXP: number[] = [];
const LOG: number[] = [];
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] ?? 0;
})();

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : (EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0);
}

/** Reed-Solomon remainder of `data` for a generator of degree `degree`. */
function rsRemainder(data: readonly number[], degree: number): number[] {
  let gen = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((c, j) => {
      next[j] = (next[j] ?? 0) ^ gfMul(c, EXP[i] ?? 0);
      next[j + 1] = (next[j + 1] ?? 0) ^ c;
    });
    gen = next;
  }
  // `gen` is lowest-degree first and monic; reverse for the long division below.
  const coeffs = gen.slice(0, degree).reverse();
  const rem = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (rem.shift() ?? 0);
    rem.push(0);
    coeffs.forEach((c, i) => {
      rem[i] = (rem[i] ?? 0) ^ gfMul(c, factor);
    });
  }
  return rem;
}

/** The data and error-correction codewords for `text` (UTF-8) and the version used; null when it does not fit. */
export function qrCodewords(text: string): { version: number; codewords: number[] } | null {
  const bytes = [...new TextEncoder().encode(text)];
  const index = VERSIONS.findIndex((v) => bytes.length + 2 <= v.data);
  const spec = VERSIONS[index];
  if (!spec || bytes.length > QR_MAX_BYTES) return null;
  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, spec.data * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < spec.data; pad ^= 0xec ^ 0x11) data.push(pad);
  return { version: index + 1, codewords: [...data, ...rsRemainder(data, spec.ecc)] };
}

const sizeOf = (version: number) => 17 + 4 * version;
const get = (m: boolean[][], x: number, y: number): boolean => m[y]?.[x] === true;
function put(m: boolean[][], x: number, y: number, dark: boolean): void {
  const row = m[y];
  if (row) row[x] = dark;
}

/** Which modules are fixed patterns (finders, timing, alignment, format) for a version; data goes in the rest. */
function functionMap(version: number): boolean[][] {
  const size = sizeOf(version);
  const f = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(f, x, y, true);
  };
  mark(0, 0, 9, 9);
  mark(size - 8, 0, 8, 9);
  mark(0, size - 8, 9, 8);
  mark(6, 0, 1, size);
  mark(0, 6, size, 1);
  if (version >= 2) mark(size - 9, size - 9, 5, 5);
  return f;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** 15 format bits: level L (01), the mask, a BCH(15,5) check, XOR 0x5412. */
function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function penalty(m: boolean[][]): number {
  const n = m.length;
  const at = (x: number, y: number) => get(m, x, y);
  let score = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) {
        const same = pass === 0 ? at(b, a) === at(b - 1, a) : at(a, b) === at(a, b - 1);
        if (same) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
      // Finder-like 1:1:3:1:1 runs with a light margin (rule 3).
      for (let b = 0; b + 10 < n; b++) {
        const cell = (k: number) => (pass === 0 ? at(b + k, a) : at(a, b + k));
        const core = [true, false, true, true, true, false, true].every((v, k) => cell(k + 4) === v);
        const left = core && [false, false, false, false].every((v, k) => cell(k) === v);
        const coreL = [true, false, true, true, true, false, true].every((v, k) => cell(k) === v);
        const right = coreL && [false, false, false, false].every((v, k) => cell(k + 7) === v);
        if (left) score += 40;
        if (right) score += 40;
      }
    }
  }
  for (let y = 0; y + 1 < n; y++)
    for (let x = 0; x + 1 < n; x++)
      if (at(x, y) === at(x + 1, y) && at(x, y) === at(x, y + 1) && at(x, y) === at(x + 1, y + 1)) score += 3;
  let dark = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (at(x, y)) dark++;
  score += Math.floor(Math.abs((dark * 20) / (n * n) - 10)) * 10;
  return score;
}

/** The symbol as rows of dark (true) and light modules, or null when the text is too long. */
export function qrMatrix(text: string): boolean[][] | null {
  const made = qrCodewords(text);
  if (!made) return null;
  const { version, codewords } = made;
  const size = sizeOf(version);
  const fn = functionMap(version);
  const base = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    put(base, x, y, dark);
  };
  // Finder patterns with their separators, timing lines.
  for (const [cx, cy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ] as const)
    for (let dy = 0; dy < 7; dy++)
      for (let dx = 0; dx < 7; dx++) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        set(cx + dx, cy + dy, ring !== 2);
      }
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  if (version >= 2)
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        set(size - 7 + dx, size - 7 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  set(8, size - 8, true);

  // Data bits, zigzag from the bottom right, two columns at a time, skipping the vertical timing line.
  const place: [number, number][] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!get(fn, x, y)) place.push([x, y]);
      }
  }
  place.forEach(([x, y], i) => {
    const byte = codewords[i >>> 3];
    if (byte !== undefined) set(x, y, ((byte >>> (7 - (i & 7))) & 1) === 1);
  });

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const test = base.map((row) => [...row]);
    const rule = MASKS[mask];
    if (!rule) continue;
    for (const [x, y] of place) if (rule(x, y)) put(test, x, y, !get(test, x, y));
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    const fmt = (x: number, y: number, dark: boolean) => {
      put(test, x, y, dark);
    };
    for (let i = 0; i <= 5; i++) fmt(8, i, bit(i));
    fmt(8, 7, bit(6));
    fmt(8, 8, bit(7));
    fmt(7, 8, bit(8));
    for (let i = 9; i < 15; i++) fmt(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) fmt(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) fmt(8, size - 15 + i, bit(i));
    fmt(8, size - 8, true);
    const score = penalty(test);
    if (score < bestScore) {
      bestScore = score;
      best = test;
    }
  }
  return best;
}

/** SVG path data (one square per dark module, 1 unit each, with a 4-module quiet zone) and the side length. */
export function qrSvg(text: string): { d: string; side: number } | null {
  const m = qrMatrix(text);
  if (!m) return null;
  const quiet = 4;
  let d = '';
  m.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${String(x + quiet)} ${String(y + quiet)}h1v1h-1z`;
    });
  });
  return { d, side: m.length + quiet * 2 };
}

/** Test helper: read the codewords back out of a finished symbol (unmask using the format bits, then un-zigzag). */
export function readQr(m: boolean[][]): {
  mask: number;
  formatOk: boolean;
  version: number;
  codewords: number[];
} {
  const size = m.length;
  const version = (size - 17) / 4;
  const at = (x: number, y: number) => get(m, x, y);
  const first: boolean[] = [];
  for (let i = 0; i <= 5; i++) first[i] = at(8, i);
  first[6] = at(8, 7);
  first[7] = at(8, 8);
  first[8] = at(7, 8);
  for (let i = 9; i < 15; i++) first[i] = at(14 - i, 8);
  const second: boolean[] = [];
  for (let i = 0; i < 8; i++) second[i] = at(size - 1 - i, 8);
  for (let i = 8; i < 15; i++) second[i] = at(8, size - 15 + i);
  const num = (b: boolean[]) => b.reduce((acc, v, i) => acc | ((v ? 1 : 0) << i), 0);
  const raw = num(first);
  let mask = -1;
  for (let k = 0; k < 8; k++) if (formatBits(k) === raw) mask = k;
  const fn = functionMap(version);
  const rule = MASKS[mask];
  const out: number[] = [];
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (get(fn, x, y)) continue;
        const dark = at(x, y) !== (rule ? rule(x, y) : false);
        out[bit >>> 3] = (out[bit >>> 3] ?? 0) | ((dark ? 1 : 0) << (7 - (bit & 7)));
        bit++;
      }
  }
  const total = (VERSIONS[version - 1]?.data ?? 0) + (VERSIONS[version - 1]?.ecc ?? 0);
  return {
    mask,
    formatOk: mask >= 0 && num(second) === raw,
    version,
    codewords: out.slice(0, total),
  };
}

/** Test helper: true when every Reed-Solomon syndrome of the codewords is zero. */
export function rsValid(codewords: readonly number[], eccCount: number): boolean {
  for (let i = 0; i < eccCount; i++) {
    let s = 0;
    for (const c of codewords) s = gfMul(s, EXP[i] ?? 0) ^ c;
    if (s !== 0) return false;
  }
  return true;
}
