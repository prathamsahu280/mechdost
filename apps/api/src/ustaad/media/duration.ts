/**
 * Container checks without decoding (spec 23 § 10 step 3; SR-13 v1 stand-in, SR-15, AT-UP-4, AT-UP-5): the duration
 * from the MP4 `mvhd` box, the WebM `Duration` element or the last Ogg granule; MP4 location atoms (`©xyz`, `loci`)
 * and external references (`dref` entries that are not self-contained) are refused. Pure functions over bytes the
 * caller read with ranged GETs; nothing here opens a network connection or a file (AT-UP-5).
 */

export type ContainerProblem = 'location_atom' | 'external_reference' | 'unreadable';
export interface ContainerFacts {
  durationMs: number | null;
  problem: ContainerProblem | null;
}

const u32 = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) * 2 ** 24 + ((b[o + 1] ?? 0) << 16) + ((b[o + 2] ?? 0) << 8) + (b[o + 3] ?? 0)) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const type4 = (b: Uint8Array, o: number) => String.fromCharCode(...b.subarray(o, o + 4));

/** Top-level MP4 boxes from a reader: name, offset and size (walks headers only). */
export async function mp4TopBoxes(
  read: (start: number, end: number) => Promise<Uint8Array>,
  totalBytes: number,
): Promise<{ type: string; offset: number; size: number }[]> {
  const out: { type: string; offset: number; size: number }[] = [];
  let offset = 0;
  for (let i = 0; i < 64 && offset + 8 <= totalBytes; i += 1) {
    const h = await read(offset, Math.min(offset + 16, totalBytes) - 1);
    let size = u32(h, 0);
    const type = type4(h, 4);
    if (size === 1) size = u64(h, 8);
    else if (size === 0) size = totalBytes - offset;
    if (size < 8) break;
    out.push({ type, offset, size });
    offset += size;
  }
  return out;
}

function find(b: Uint8Array, pattern: readonly number[]): number {
  outer: for (let i = 0; i + pattern.length <= b.length; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) if (b[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}
/** ASCII box names only (4-character codes), so code units are the bytes. */
const bytesOf = (s: string) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));

/** Facts from the `moov` box bytes (the whole box, header included). */
export function mp4Facts(moov: Uint8Array): ContainerFacts {
  if (find(moov, [0xa9, ...bytesOf('xyz')]) >= 0 || find(moov, bytesOf('loci')) >= 0)
    return { durationMs: null, problem: 'location_atom' };
  // `dref` entries (`url `, `urn `, `alis`): flag 0x000001 = media in this same file; anything else points outside.
  for (let at = find(moov, bytesOf('dref')); at >= 0;) {
    const boxStart = at - 4;
    const count = u32(moov, boxStart + 12);
    let entry = boxStart + 16;
    for (let i = 0; i < count && entry + 12 <= moov.length; i += 1) {
      const size = u32(moov, entry);
      const kind = type4(moov, entry + 4);
      const flags = u32(moov, entry + 8) & 0xffffff;
      if ((kind === 'url ' || kind === 'urn ' || kind === 'alis') && (flags & 1) === 0)
        return { durationMs: null, problem: 'external_reference' };
      if (size < 12) break;
      entry += size;
    }
    const next = find(moov.subarray(at + 4), bytesOf('dref'));
    at = next < 0 ? -1 : at + 4 + next;
  }
  const mvhd = find(moov, bytesOf('mvhd'));
  if (mvhd < 0) return { durationMs: null, problem: 'unreadable' };
  const v = moov[mvhd + 4];
  const timescale = v === 1 ? u32(moov, mvhd + 4 + 20) : u32(moov, mvhd + 4 + 12);
  const duration = v === 1 ? u64(moov, mvhd + 4 + 24) : u32(moov, mvhd + 4 + 16);
  if (!timescale) return { durationMs: null, problem: 'unreadable' };
  return { durationMs: Math.round((duration / timescale) * 1000), problem: null };
}

/** EBML variable-length integer at `o`: its value and length (marker bit removed when `strip`). */
function vint(b: Uint8Array, o: number, strip: boolean): { value: number; len: number } | null {
  const first = b[o];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && (first & (0x80 >> (len - 1))) === 0) len += 1;
  if (len > 8 || o + len > b.length) return null;
  let value = strip ? first & (0xff >> len) : first;
  for (let i = 1; i < len; i += 1) value = value * 256 + (b[o + i] ?? 0);
  return { value, len };
}

/** WebM/Matroska: `Info` (0x1549A966) → `TimecodeScale` (0x2AD7B1, default 1 ms) and `Duration` (0x4489, float). */
export function webmFacts(head: Uint8Array): ContainerFacts {
  const info = find(head, [0x15, 0x49, 0xa9, 0x66]);
  if (info < 0) return { durationMs: null, problem: 'unreadable' };
  const size = vint(head, info + 4, true);
  if (!size) return { durationMs: null, problem: 'unreadable' };
  const start = info + 4 + size.len;
  const end = Math.min(head.length, start + size.value);
  let scaleNs = 1_000_000;
  let duration: number | null = null;
  for (let o = start; o < end;) {
    const id = vint(head, o, false);
    if (!id) break;
    const len = vint(head, o + id.len, true);
    if (!len) break;
    const data = o + id.len + len.len;
    const view = new DataView(head.buffer, head.byteOffset + data, Math.min(len.value, head.length - data));
    if (id.value === 0x2ad7b1) {
      let v = 0;
      for (let i = 0; i < len.value; i += 1) v = v * 256 + (head[data + i] ?? 0);
      scaleNs = v;
    } else if (id.value === 0x4489) {
      duration = len.value === 4 ? view.getFloat32(0) : len.value === 8 ? view.getFloat64(0) : null;
    }
    o = data + len.value;
  }
  if (duration === null || !Number.isFinite(duration)) return { durationMs: null, problem: 'unreadable' };
  return { durationMs: Math.round((duration * scaleNs) / 1_000_000), problem: null };
}

/** Ogg (Opus or Vorbis): the granule of the last page in `tail` over the sample rate from the first page in `head`. */
export function oggFacts(head: Uint8Array, tail: Uint8Array): ContainerFacts {
  const opus = find(head, bytesOf('OpusHead'));
  const vorbis = find(head, [0x01, ...bytesOf('vorbis')]);
  let rate = 0;
  let preSkip = 0;
  if (opus >= 0) {
    rate = 48_000; // Opus granules are always at 48 kHz.
    preSkip = (head[opus + 10] ?? 0) + (head[opus + 11] ?? 0) * 256;
  } else if (vorbis >= 0) {
    const o = vorbis + 12;
    rate =
      (head[o] ?? 0) +
      (head[o + 1] ?? 0) * 256 +
      (head[o + 2] ?? 0) * 65_536 +
      (head[o + 3] ?? 0) * 16_777_216;
  }
  if (!rate) return { durationMs: null, problem: 'unreadable' };
  let last = -1;
  for (let at = find(tail, bytesOf('OggS')); at >= 0;) {
    last = at;
    const next = find(tail.subarray(at + 4), bytesOf('OggS'));
    at = next < 0 ? -1 : at + 4 + next;
  }
  if (last < 0 || last + 14 > tail.length) return { durationMs: null, problem: 'unreadable' };
  let granule = 0;
  for (let i = 7; i >= 0; i -= 1) granule = granule * 256 + (tail[last + 6 + i] ?? 0);
  return { durationMs: Math.max(0, Math.round(((granule - preSkip) / rate) * 1000)), problem: null };
}
