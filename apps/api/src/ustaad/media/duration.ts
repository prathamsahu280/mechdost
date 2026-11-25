/**
 * Container checks without decoding (spec 23 § 10 step 3; SR-13 v1 stand-in, SR-15, AT-UP-4, AT-UP-5). Pure functions
 * over bytes the caller read with ranged GETs; nothing here opens a network connection or a file. **Fail closed**
 * (security review 2026-11-26): the MP4 box tree is walked properly (the `mvhd` must be a direct child of `moov`, every
 * `trak` needs `tkhd` and `mdia/mdhd`, and their durations must agree with `mvhd`); WebM needs EBML → Segment → Info →
 * Duration in place; anything unexpected is `unreadable`. v1 cannot remux, so any location metadata refuses the file
 * (`©xyz`, `loci`, the Apple `com.apple.quicktime.location.*` keys, any Matroska `Tags` element): in-app recordings
 * (MediaRecorder) carry none; a phone-gallery video with location gets the friendly MEDIA_LOCATION message. Server-side
 * remux/strip is the v2 step (decisions 2026-11-26).
 */

export type ContainerProblem = 'location_atom' | 'external_reference' | 'unreadable';
export interface ContainerFacts {
  durationMs: number | null;
  problem: ContainerProblem | null;
}

const UNREADABLE: ContainerFacts = { durationMs: null, problem: 'unreadable' };

const u32 = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) * 2 ** 24 + ((b[o + 1] ?? 0) << 16) + ((b[o + 2] ?? 0) << 8) + (b[o + 3] ?? 0)) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const type4 = (b: Uint8Array, o: number) =>
  String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);

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
    if (size < 8 || offset + size > totalBytes) break;
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
/** ASCII names only (4-character codes, metadata keys), so code units are the bytes. */
const bytesOf = (s: string) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));

interface Box {
  type: string;
  /** Payload start and end (exclusive) inside the buffer. */
  start: number;
  end: number;
}

/** The direct children of a box payload, or null when a size does not fit (malformed → refuse). */
function children(b: Uint8Array, start: number, end: number): Box[] | null {
  const out: Box[] = [];
  let o = start;
  while (o < end) {
    if (o + 8 > end) return null;
    let size = u32(b, o);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) return null;
      size = u64(b, o + 8);
      header = 16;
    }
    if (size < header || o + size > end) return null;
    out.push({ type: type4(b, o + 4), start: o + header, end: o + size });
    o += size;
  }
  return out;
}

const one = (list: Box[], type: string) => {
  const hits = list.filter((x) => x.type === type);
  return hits.length === 1 ? hits[0] : undefined;
};

/** `mvhd` / `mdhd`: timescale and duration (versions 0 and 1). */
function timeBox(b: Uint8Array, box: Box): { timescale: number; duration: number } | null {
  const v = b[box.start];
  const need = v === 1 ? 32 : 20;
  if (box.end - box.start < need || (v !== 0 && v !== 1)) return null;
  const timescale = v === 1 ? u32(b, box.start + 20) : u32(b, box.start + 12);
  const duration = v === 1 ? u64(b, box.start + 24) : u32(b, box.start + 16);
  return timescale > 0 ? { timescale, duration } : null;
}

/** `tkhd` duration in the movie timescale (versions 0 and 1); all-ones = unknown → null. */
function tkhdDuration(b: Uint8Array, box: Box): number | null {
  const v = b[box.start];
  if (v === 1) return box.end - box.start >= 36 ? u64(b, box.start + 28) : null;
  if (v !== 0 || box.end - box.start < 24) return null;
  const d = u32(b, box.start + 20);
  return d === 0xffffffff ? null : d;
}

const LOCATION_KEYS = [[0xa9, ...bytesOf('xyz')], bytesOf('loci'), bytesOf('com.apple.quicktime.location')];

/** Facts from the `moov` box bytes (the whole box, header included). */
export function mp4Facts(moovBox: Uint8Array): ContainerFacts {
  if (LOCATION_KEYS.some((k) => find(moovBox, k) >= 0)) return { durationMs: null, problem: 'location_atom' };
  const top = children(moovBox, 0, moovBox.length);
  const moov = top?.length === 1 && top[0]?.type === 'moov' ? top[0] : undefined;
  if (!moov) return UNREADABLE;
  const kids = children(moovBox, moov.start, moov.end);
  if (!kids) return UNREADABLE;
  const mvhdBox = one(kids, 'mvhd');
  const mvhd = mvhdBox ? timeBox(moovBox, mvhdBox) : null;
  const traks = kids.filter((k) => k.type === 'trak');
  if (!mvhd || traks.length === 0) return UNREADABLE;
  const movieMs = (d: number) => Math.round((d / mvhd.timescale) * 1000);
  const totalMs = movieMs(mvhd.duration);
  const slack = Math.max(1000, totalMs * 0.02);
  for (const trak of traks) {
    const tk = children(moovBox, trak.start, trak.end);
    const tkhd = tk ? one(tk, 'tkhd') : undefined;
    const mdia = tk ? one(tk, 'mdia') : undefined;
    const md = mdia ? children(moovBox, mdia.start, mdia.end) : null;
    const mdhdBox = md ? one(md, 'mdhd') : undefined;
    const trackDur = tkhd ? tkhdDuration(moovBox, tkhd) : null;
    const media = mdhdBox ? timeBox(moovBox, mdhdBox) : null;
    if (trackDur === null || !media) return UNREADABLE;
    const trackMs = movieMs(trackDur);
    const mediaMs = Math.round((media.duration / media.timescale) * 1000);
    if (Math.abs(trackMs - totalMs) > slack || mediaMs > totalMs + slack) return UNREADABLE;
  }
  // `dref` entries (`url `, `urn `, `alis`): flag 0x000001 = media in this same file; anything else points outside.
  for (let at = find(moovBox, bytesOf('dref')); at >= 0;) {
    const boxStart = at - 4;
    const count = u32(moovBox, boxStart + 12);
    let entry = boxStart + 16;
    for (let i = 0; i < count && entry + 12 <= moovBox.length; i += 1) {
      const size = u32(moovBox, entry);
      const kind = type4(moovBox, entry + 4);
      const flags = u32(moovBox, entry + 8) & 0xffffff;
      if ((kind === 'url ' || kind === 'urn ' || kind === 'alis') && (flags & 1) === 0)
        return { durationMs: null, problem: 'external_reference' };
      if (size < 12) return UNREADABLE;
      entry += size;
    }
    const next = find(moovBox.subarray(at + 4), bytesOf('dref'));
    at = next < 0 ? -1 : at + 4 + next;
  }
  return { durationMs: totalMs, problem: null };
}

/** EBML variable-length integer at `o`: its value and length (marker bit removed when `strip`); unknown size = -1. */
function vint(b: Uint8Array, o: number, strip: boolean): { value: number; len: number } | null {
  const first = b[o];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && (first & (0x80 >> (len - 1))) === 0) len += 1;
  if (len > 8 || o + len > b.length) return null;
  let value = strip ? first & (0xff >> len) : first;
  let allOnes = value === 0xff >> len;
  for (let i = 1; i < len; i += 1) {
    const byte = b[o + i] ?? 0;
    value = value * 256 + byte;
    allOnes = allOnes && byte === 0xff;
  }
  return { value: strip && allOnes ? -1 : value, len };
}

interface Element {
  id: number;
  start: number;
  end: number;
}
function element(b: Uint8Array, o: number, limit: number): Element | null {
  const id = vint(b, o, false);
  if (!id) return null;
  const size = vint(b, o + id.len, true);
  if (!size) return null;
  const start = o + id.len + size.len;
  const end = size.value < 0 ? limit : start + size.value;
  return start <= limit ? { id: id.value, start, end: Math.min(end, limit) } : null;
}

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const CLUSTER = 0x1f43b675;
const TAGS = [0x12, 0x54, 0xc3, 0x67];

/** WebM/Matroska: EBML → Segment → Info → `TimecodeScale` (default 1 ms) and `Duration`; any `Tags` refuses. */
export function webmFacts(head: Uint8Array, tail: Uint8Array): ContainerFacts {
  if (find(head, TAGS) >= 0 || find(tail, TAGS) >= 0) return { durationMs: null, problem: 'location_atom' };
  const header = element(head, 0, head.length);
  if (header?.id !== EBML) return UNREADABLE;
  const segment = element(head, header.end, head.length);
  if (segment?.id !== SEGMENT) return UNREADABLE;
  let info: Element | null = null;
  for (let o = segment.start; o < segment.end;) {
    const el = element(head, o, segment.end);
    if (!el || el.id === CLUSTER) break;
    if (el.id === INFO) {
      info = el;
      break;
    }
    o = el.end;
  }
  if (!info) return UNREADABLE;
  let scaleNs = 1_000_000;
  let duration: number | null = null;
  for (let o = info.start; o < info.end;) {
    const el = element(head, o, info.end);
    if (!el) return UNREADABLE;
    const len = el.end - el.start;
    if (el.id === 0x2ad7b1) {
      let v = 0;
      for (let i = 0; i < len; i += 1) v = v * 256 + (head[el.start + i] ?? 0);
      scaleNs = v;
    } else if (el.id === 0x4489) {
      const view = new DataView(head.buffer, head.byteOffset + el.start, len);
      duration = len === 4 ? view.getFloat32(0) : len === 8 ? view.getFloat64(0) : null;
    }
    o = el.end;
  }
  if (duration === null || !Number.isFinite(duration) || duration <= 0 || scaleNs <= 0) return UNREADABLE;
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
  if (!rate) return UNREADABLE;
  let last = -1;
  for (let at = find(tail, bytesOf('OggS')); at >= 0;) {
    last = at;
    const next = find(tail.subarray(at + 4), bytesOf('OggS'));
    at = next < 0 ? -1 : at + 4 + next;
  }
  if (last < 0 || last + 14 > tail.length) return UNREADABLE;
  let granule = 0;
  for (let i = 7; i >= 0; i -= 1) granule = granule * 256 + (tail[last + 6 + i] ?? 0);
  return { durationMs: Math.max(0, Math.round(((granule - preSkip) / rate) * 1000)), problem: null };
}
