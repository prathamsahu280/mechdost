/**
 * Container checks without decoding (spec 23 § 10 step 3; SR-13 v1 stand-in, SR-15, AT-UP-4, AT-UP-5). **Allowlists
 * that fail closed** (security review 2026-11-26): v1 cannot remux, so a file may contain only the structures a plain
 * recording needs; anything else (udta, meta, uuid/XMP, ilst, Matroska Tags, Attachments, Chapters, a Title, Ogg
 * comments other than the encoder, or any unknown box or element) refuses it with the friendly MEDIA_LOCATION message
 * ("this video has extra details, like location; record it in the app"). In-app recordings (MediaRecorder) pass;
 * server-side remux/strip is the v2 step (decisions 2026-11-26). Durations come from the structure (MP4: mvhd as a
 * direct child of moov, cross-checked with every tkhd and mdhd; WebM: Info/Duration cross-checked with the last block,
 * or the last block alone when MediaRecorder wrote no Duration). Unreadable → refuse. Reads are ranged and buffered;
 * nothing here opens a network connection or a file of its own.
 */

export type ContainerProblem = 'location_atom' | 'external_reference' | 'unreadable';
export interface ContainerFacts {
  durationMs: number | null;
  problem: ContainerProblem | null;
}
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

const UNREADABLE: ContainerFacts = { durationMs: null, problem: 'unreadable' };
const EXTRA: ContainerFacts = { durationMs: null, problem: 'location_atom' };

const u32 = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) * 2 ** 24 + ((b[o + 1] ?? 0) << 16) + ((b[o + 2] ?? 0) << 8) + (b[o + 3] ?? 0)) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const le32 = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) + (b[o + 1] ?? 0) * 256 + (b[o + 2] ?? 0) * 65_536 + (b[o + 3] ?? 0) * 16_777_216) >>> 0;
const type4 = (b: Uint8Array, o: number) =>
  String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);
/** ASCII names only (4-character codes, tag keys), so code units are the bytes. */
const bytesOf = (s: string) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

function find(b: Uint8Array, pattern: readonly number[], from = 0): number {
  outer: for (let i = from; i + pattern.length <= b.length; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) if (b[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

// ── MP4 / ISO BMFF ────────────────────────────────────────────────────────────────────────────────────────────────
const TOP = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'moof', 'mfra', 'sidx', 'styp']);
/** Container boxes we descend into and the children each may hold; every other box listed is a leaf we accept. */
const TREE: Record<string, ReadonlySet<string>> = {
  moov: new Set(['mvhd', 'trak', 'mvex']),
  trak: new Set(['tkhd', 'edts', 'mdia']),
  edts: new Set(['elst']),
  mdia: new Set(['mdhd', 'hdlr', 'minf']),
  minf: new Set(['vmhd', 'smhd', 'dinf', 'stbl']),
  dinf: new Set(['dref']),
  stbl: new Set([
    'stsd',
    'stts',
    'ctts',
    'stsc',
    'stsz',
    'stz2',
    'stco',
    'co64',
    'stss',
    'sdtp',
    'sgpd',
    'sbgp',
    'cslg',
  ]),
  mvex: new Set(['mehd', 'trex']),
};

/** Walk every top-level box; only allowed types; then check `moov` (exactly one). */
export async function mp4Check(
  read: RangeReader,
  totalBytes: number,
  maxMoovBytes = 8 * 1024 * 1024,
): Promise<ContainerFacts> {
  let offset = 0;
  let moov: { offset: number; size: number } | null = null;
  for (let i = 0; offset < totalBytes; i += 1) {
    if (i >= 256 || offset + 8 > totalBytes) return UNREADABLE;
    const h = await read(offset, Math.min(offset + 16, totalBytes) - 1);
    let size = u32(h, 0);
    const type = type4(h, 4);
    if (size === 1) size = u64(h, 8);
    else if (size === 0) size = totalBytes - offset;
    if (size < 8 || offset + size > totalBytes) return UNREADABLE;
    if (!TOP.has(type)) return EXTRA;
    if (type === 'moov') {
      if (moov) return UNREADABLE;
      moov = { offset, size };
    }
    offset += size;
  }
  if (!moov || moov.size > maxMoovBytes) return UNREADABLE;
  return mp4Facts(await read(moov.offset, moov.offset + moov.size - 1));
}

interface Box {
  type: string;
  start: number;
  end: number;
}

/** Direct children of a payload, or null when a size does not fit (malformed → refuse). */
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

/** Recursively check that every box under `box` is allowed. */
function allowedTree(b: Uint8Array, box: Box): 'ok' | 'extra' | 'unreadable' {
  const allowed = TREE[box.type];
  if (!allowed) return 'ok'; // a leaf we accept as a whole (its payload is codec or table data)
  const kids = children(b, box.start, box.end);
  if (!kids) return 'unreadable';
  for (const k of kids) {
    if (!allowed.has(k.type)) return 'extra';
    const r = allowedTree(b, k);
    if (r !== 'ok') return r;
  }
  return 'ok';
}

const only = (list: Box[], type: string) => {
  const hits = list.filter((x) => x.type === type);
  return hits.length === 1 ? hits[0] : undefined;
};

function timeBox(b: Uint8Array, box: Box): { timescale: number; duration: number } | null {
  const v = b[box.start];
  if ((v !== 0 && v !== 1) || box.end - box.start < (v === 1 ? 32 : 20)) return null;
  const timescale = v === 1 ? u32(b, box.start + 20) : u32(b, box.start + 12);
  const duration = v === 1 ? u64(b, box.start + 24) : u32(b, box.start + 16);
  return timescale > 0 ? { timescale, duration } : null;
}

function tkhdDuration(b: Uint8Array, box: Box): number | null {
  const v = b[box.start];
  if (v === 1) return box.end - box.start >= 36 ? u64(b, box.start + 28) : null;
  if (v !== 0 || box.end - box.start < 24) return null;
  const d = u32(b, box.start + 20);
  return d === 0xffffffff ? null : d;
}

/** Facts from the `moov` box bytes (the whole box, header included). */
export function mp4Facts(moovBox: Uint8Array): ContainerFacts {
  const top = children(moovBox, 0, moovBox.length);
  const moov = top?.length === 1 && top[0]?.type === 'moov' ? top[0] : undefined;
  if (!moov) return UNREADABLE;
  const tree = allowedTree(moovBox, moov);
  if (tree === 'extra') return EXTRA;
  if (tree === 'unreadable') return UNREADABLE;
  const kids = children(moovBox, moov.start, moov.end) ?? [];
  const mvhdBox = only(kids, 'mvhd');
  const mvhd = mvhdBox ? timeBox(moovBox, mvhdBox) : null;
  const traks = kids.filter((k) => k.type === 'trak');
  if (!mvhd || traks.length === 0) return UNREADABLE;
  const totalMs = Math.round((mvhd.duration / mvhd.timescale) * 1000);
  const slack = Math.max(1000, totalMs * 0.02);
  for (const trak of traks) {
    const tk = children(moovBox, trak.start, trak.end) ?? [];
    const tkhd = only(tk, 'tkhd');
    const mdia = only(tk, 'mdia');
    const md = mdia ? (children(moovBox, mdia.start, mdia.end) ?? []) : [];
    const mdhdBox = only(md, 'mdhd');
    const trackDur = tkhd ? tkhdDuration(moovBox, tkhd) : null;
    const media = mdhdBox ? timeBox(moovBox, mdhdBox) : null;
    if (trackDur === null || !media) return UNREADABLE;
    const trackMs = Math.round((trackDur / mvhd.timescale) * 1000);
    const mediaMs = Math.round((media.duration / media.timescale) * 1000);
    if (Math.abs(trackMs - totalMs) > slack || mediaMs > totalMs + slack) return UNREADABLE;
    // Data references: flag 0x000001 = media in this same file; anything else points outside (AT-UP-5).
    const minf = only(md, 'minf');
    const mi = minf ? (children(moovBox, minf.start, minf.end) ?? []) : [];
    const dinf = only(mi, 'dinf');
    const dref = dinf ? only(children(moovBox, dinf.start, dinf.end) ?? [], 'dref') : undefined;
    if (dref) {
      const entries = children(moovBox, dref.start + 8, dref.end);
      if (!entries) return UNREADABLE;
      for (const e of entries) {
        if (e.type !== 'url ' && e.type !== 'urn ')
          return { durationMs: null, problem: 'external_reference' };
        const flags = u32(moovBox, e.start) & 0xffffff;
        if ((flags & 1) === 0) return { durationMs: null, problem: 'external_reference' };
      }
    }
  }
  return { durationMs: totalMs, problem: null };
}

// ── WebM / Matroska ──────────────────────────────────────────────────────────────────────────────────────────────
const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const SEEK_HEAD = 0x114d9b74;
const INFO = 0x1549a966;
const TRACKS = 0x1654ae6b;
const CLUSTER = 0x1f43b675;
const CUES = 0x1c53bb6b;
const VOID = 0xec;
const SEGMENT_CHILDREN = new Set([SEEK_HEAD, INFO, TRACKS, CLUSTER, CUES, VOID]);
const INFO_CHILDREN = new Set([0x2ad7b1, 0x4489, 0x4d80, 0x5741, 0x73a4, 0x4461, VOID]);
const CLUSTER_CHILDREN = new Set([0xe7, 0xa3, 0xa0, 0xab, 0xa7, VOID]);

/** A buffered ranged reader: 1 MB windows, so walking thousands of blocks costs a few reads. */
function buffered(read: RangeReader, total: number) {
  const WINDOW = 1024 * 1024;
  let start = -1;
  let buf: Uint8Array = new Uint8Array();
  return async (at: number, n: number): Promise<Uint8Array> => {
    if (at < 0 || at >= total) return new Uint8Array();
    if (start < 0 || at < start || at + Math.min(n, total - at) > start + buf.length) {
      start = at;
      buf = await read(at, Math.min(total, at + Math.max(WINDOW, n)) - 1);
    }
    return buf.subarray(at - start, at - start + n);
  };
}

function vintAt(
  b: Uint8Array,
  o: number,
  strip: boolean,
): { value: number; len: number; unknown: boolean } | null {
  const first = b[o];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && (first & (0x80 >> (len - 1))) === 0) len += 1;
  if (len > 8 || o + len > b.length) return null;
  let value = strip ? first & (0xff >> len) : first;
  let ones = value === 0xff >> len;
  for (let i = 1; i < len; i += 1) {
    const byte = b[o + i] ?? 0;
    value = value * 256 + byte;
    ones = ones && byte === 0xff;
  }
  return { value, len, unknown: strip && ones };
}

interface Header {
  id: number;
  dataStart: number;
  /** null = unknown size (MediaRecorder writes the Segment and Clusters this way). */
  size: number | null;
}

async function headerAt(
  at: (o: number, n: number) => Promise<Uint8Array>,
  o: number,
): Promise<Header | null> {
  const h = await at(o, 12);
  const id = vintAt(h, 0, false);
  if (!id) return null;
  const size = vintAt(h, id.len, true);
  if (!size) return null;
  return { id: id.value, dataStart: o + id.len + size.len, size: size.unknown ? null : size.value };
}

function parseInfo(info: Uint8Array): { scaleNs: number; declared: number | null } | 'extra' | null {
  let scaleNs = 1_000_000;
  let declared: number | null = null;
  for (let p = 0; p < info.length;) {
    const id = vintAt(info, p, false);
    const sz = id ? vintAt(info, p + id.len, true) : null;
    if (!id || !sz || sz.unknown) return null;
    if (!INFO_CHILDREN.has(id.value)) return 'extra'; // e.g. Title
    const s = p + id.len + sz.len;
    if (s + sz.value > info.length) return null;
    if (id.value === 0x2ad7b1) {
      let v = 0;
      for (let i = 0; i < sz.value; i += 1) v = v * 256 + (info[s + i] ?? 0);
      scaleNs = v;
    } else if (id.value === 0x4489) {
      const view = new DataView(info.buffer, info.byteOffset + s, sz.value);
      declared = sz.value === 4 ? view.getFloat32(0) : sz.value === 8 ? view.getFloat64(0) : null;
    }
    p = s + sz.value;
  }
  return { scaleNs, declared };
}

/** Walk EBML → Segment → children (allowlist), Info children (allowlist), Clusters to the last block time. */
export async function webmCheck(read: RangeReader, total: number): Promise<ContainerFacts> {
  const at = buffered(read, total);
  const ebml = await headerAt(at, 0);
  if (ebml?.id !== EBML || ebml.size === null) return UNREADABLE;
  const seg = await headerAt(at, ebml.dataStart + ebml.size);
  if (seg?.id !== SEGMENT) return UNREADABLE;
  const segEnd = seg.size === null ? total : Math.min(total, seg.dataStart + seg.size);
  let scaleNs = 1_000_000;
  let declared: number | null = null;
  let lastTicks = -1;
  let clusterTc = 0;
  let inCluster = false;
  let o = seg.dataStart;
  for (let steps = 0; o < segEnd; steps += 1) {
    if (steps > 200_000) return UNREADABLE;
    const h = await headerAt(at, o);
    if (!h) return UNREADABLE;
    if (inCluster && CLUSTER_CHILDREN.has(h.id)) {
      if (h.size === null) return UNREADABLE;
      const data = await at(h.dataStart, Math.min(h.size, 16));
      if (h.id === 0xe7) {
        clusterTc = 0;
        for (let i = 0; i < h.size; i += 1) clusterTc = clusterTc * 256 + (data[i] ?? 0);
      } else if (h.id === 0xa3) {
        const track = vintAt(data, 0, true);
        if (!track) return UNREADABLE;
        const raw = ((data[track.len] ?? 0) << 8) | (data[track.len + 1] ?? 0);
        const rel = raw >= 0x8000 ? raw - 0x10000 : raw;
        lastTicks = Math.max(lastTicks, clusterTc + rel);
      }
      o = h.dataStart + h.size;
      continue;
    }
    if (!SEGMENT_CHILDREN.has(h.id)) return EXTRA; // Tags, Attachments, Chapters or anything unknown
    inCluster = h.id === CLUSTER;
    if (inCluster) {
      // Sized or unknown-size cluster: its children are walked one by one, like MediaRecorder writes them.
      clusterTc = 0;
      o = h.dataStart;
      continue;
    }
    if (h.size === null) return UNREADABLE;
    if (h.id === INFO) {
      const parsed = parseInfo(await at(h.dataStart, h.size));
      if (parsed === 'extra') return EXTRA;
      if (!parsed) return UNREADABLE;
      ({ scaleNs, declared } = parsed);
    }
    o = h.dataStart + h.size;
  }
  if (scaleNs <= 0 || lastTicks < 0) return UNREADABLE;
  const blocksMs = Math.round((lastTicks * scaleNs) / 1_000_000);
  if (declared === null) return { durationMs: blocksMs, problem: null };
  if (!Number.isFinite(declared) || declared <= 0) return UNREADABLE;
  const declaredMs = Math.round((declared * scaleNs) / 1_000_000);
  if (Math.abs(declaredMs - blocksMs) > Math.max(1000, declaredMs * 0.02)) return UNREADABLE;
  return { durationMs: Math.max(declaredMs, blocksMs), problem: null };
}

// ── Ogg (Opus / Vorbis) ──────────────────────────────────────────────────────────────────────────────────────────
/** Comments allowed in the Opus/Vorbis tags packet: the encoder name only (any other key is extra detail). */
function commentsAllowed(b: Uint8Array, at: number): boolean {
  const vendorLen = le32(b, at);
  let p = at + 4 + vendorLen;
  const count = le32(b, p);
  p += 4;
  if (count > 32) return false;
  for (let i = 0; i < count; i += 1) {
    const len = le32(b, p);
    if (len > 1024 || p + 4 + len > b.length) return false;
    if (
      !ascii(b, p + 4, p + 4 + len)
        .toUpperCase()
        .startsWith('ENCODER=')
    )
      return false;
    p += 4 + len;
  }
  return true;
}

/** Ogg (Opus or Vorbis): duration = last granule over the rate; tags other than the encoder refuse the file. */
export function oggFacts(head: Uint8Array, tail: Uint8Array): ContainerFacts {
  const opus = find(head, bytesOf('OpusHead'));
  const vorbis = find(head, [0x01, ...bytesOf('vorbis')]);
  let rate = 0;
  let preSkip = 0;
  if (opus >= 0) {
    rate = 48_000; // Opus granules are always at 48 kHz.
    preSkip = (head[opus + 10] ?? 0) + (head[opus + 11] ?? 0) * 256;
    const tags = find(head, bytesOf('OpusTags'));
    if (tags < 0) return UNREADABLE;
    if (!commentsAllowed(head, tags + 8)) return EXTRA;
  } else if (vorbis >= 0) {
    rate = le32(head, vorbis + 12);
    const tags = find(head, [0x03, ...bytesOf('vorbis')]);
    if (tags < 0) return UNREADABLE;
    if (!commentsAllowed(head, tags + 7)) return EXTRA;
  }
  if (!rate) return UNREADABLE;
  let last = -1;
  for (let at = find(tail, bytesOf('OggS')); at >= 0; at = find(tail, bytesOf('OggS'), at + 4)) last = at;
  if (last < 0 || last + 14 > tail.length) return UNREADABLE;
  let granule = 0;
  for (let i = 7; i >= 0; i -= 1) granule = granule * 256 + (tail[last + 6 + i] ?? 0);
  return { durationMs: Math.max(0, Math.round(((granule - preSkip) / rate) * 1000)), problem: null };
}
