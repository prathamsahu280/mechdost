/**
 * Ustaad media pipeline units (spec 23 § 10, § 20; plan task A4): SigV4 presigning against the AWS SigV4 test suite
 * (`aws-c-auth` tests/aws-signing-test-suite/v4/get-vanilla, query variant), R2 uploads sign content-length and
 * content-type (SR-12), magic bytes (AT-UP-2, SR-17), container duration and atoms (AT-UP-4, AT-UP-5), image
 * re-encoding without EXIF GPS (AT-UP-1) and the decompression-bomb guard (AT-UP-3). No network: R2 runs on a fake fetch.
 */
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { mp4Check, mp4Facts, oggFacts, webmCheck } from '../src/ustaad/media/duration';
import { readWindow } from '../src/ustaad/media/host';
import { r2MediaHost } from '../src/ustaad/media/r2';
import { presign } from '../src/ustaad/media/sigv4';
import { matchesDeclared, sniff } from '../src/ustaad/media/sniff';
import { reencode, USTAAD_MAX_IMAGE_PIXELS } from '../src/ustaad/media/verify';

const ascii = (s: string) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, payload: number[]) => [...be32(8 + payload.length), ...ascii(type), ...payload];

describe('SigV4 presigning (AWS test suite get-vanilla, query-string variant)', () => {
  it('reproduces the canonical request and the signature exactly', () => {
    const p = presign({
      method: 'GET',
      endpoint: 'https://example.amazonaws.com',
      path: '/',
      region: 'us-east-1',
      service: 'service',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      },
      expiresSec: 3600,
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(p.canonicalRequest).toBe(
      [
        'GET',
        '/',
        'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDEXAMPLE%2F20150830%2Fus-east-1%2Fservice%2Faws4_request&X-Amz-Date=20150830T123600Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host',
        'host:example.amazonaws.com',
        '',
        'host',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ].join('\n'),
    );
    expect(p.signature).toBe('e93c787ed7f371d5c6b165c1b38ede9550f4dce4144713e844b25b7192d3865d');
  });
});

describe('R2 host on a fake fetch', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake: typeof fetch = (input, init) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url: u, init: init ?? {} });
    if (u.includes('uploads=')) return Promise.resolve(new Response('<x><UploadId>up-123</UploadId></x>'));
    if (init?.method === 'HEAD')
      return Promise.resolve(
        new Response(null, { headers: { 'content-length': '2048', 'content-type': 'video/mp4' } }),
      );
    return Promise.resolve(new Response('ok'));
  };
  const host = r2MediaHost(
    {
      accountId: '0123456789abcdef0123456789abcdef',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE0000000',
        secretAccessKey: 'secret-secret-secret-secret-secret',
      },
      buckets: { quarantine: 'q-bucket', media: 'm-bucket', docs: 'd-bucket', evidence: 'e-bucket' },
    },
    fake,
  );

  it('an upload URL signs content-length and content-type (a different size or type is refused by R2)', async () => {
    const put = await host.presignPut('quarantine', 'q/a/b.webp', { mime: 'image/webp', bytes: 12345 }, 600);
    expect(put.url).toContain('/q-bucket/q/a/b.webp?');
    expect(put.url).toContain('X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost');
    expect(put.url).toContain('X-Amz-Expires=600');
    expect(put.headers).toEqual({ 'content-type': 'image/webp', 'content-length': '12345' });
  });

  it('a part URL signs its exact length; multipart create parses the upload id; HEAD reads size and type', async () => {
    const part = await host.presignPart('quarantine', 'q/a/b.mp4', 'up-123', 2, 8 * 1024 * 1024, 600);
    expect(part.url).toContain('partNumber=2');
    expect(part.headers).toEqual({ 'content-length': String(8 * 1024 * 1024) });
    expect((await host.createMultipart('quarantine', 'q/a/b.mp4', 'video/mp4')).uploadId).toBe('up-123');
    expect(await host.head('quarantine', 'q/a/b.mp4')).toEqual({ bytes: 2048, mime: 'video/mp4' });
  });

  it('a document read URL is always an attachment', async () => {
    const url = await host.presignGet('docs', 'd/a/b.pdf', 600, {
      disposition: 'attachment',
      filename: 'bill.pdf',
    });
    expect(decodeURIComponent(url)).toContain('response-content-disposition=attachment; filename="bill.pdf"');
  });

  it('read URLs repeat inside one window and expire within the TTL', () => {
    const t = Date.UTC(2026, 10, 26, 10, 3, 0);
    const a = readWindow(t, 600);
    const b = readWindow(t + 60_000, 600);
    expect(a.signAt.getTime()).toBe(b.signAt.getTime());
    expect(a.expiresAt.getTime() - t).toBeLessThanOrEqual(600_000);
    const late = readWindow(Date.UTC(2026, 10, 26, 10, 9, 30), 600);
    expect(late.expiresAt.getTime() - Date.UTC(2026, 10, 26, 10, 9, 30)).toBe(600_000);
  });
});

describe('sniff (AT-UP-2, SR-17)', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it('recognises the allowed kinds', () => {
    expect(sniff(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]))).toBe('image/webp');
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniff(new Uint8Array([0, 0, 0, 24, ...ascii('ftypisom'), 0, 0]))).toBe('mp4');
    expect(sniff(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe('webm');
    expect(sniff(enc('OggS'))).toBe('audio/ogg');
    expect(sniff(enc('%PDF-1.7'))).toBe('application/pdf');
  });
  it('refuses SVG, HTML renamed .jpg, ZIP, EXE and an HLS playlist', () => {
    expect(sniff(enc('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe('svg');
    expect(sniff(enc('<!DOCTYPE html><html>'))).toBe('html');
    expect(sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
    expect(sniff(new Uint8Array([0x4d, 0x5a, 0x90, 0]))).toBe('executable');
    expect(sniff(enc('#EXTM3U\n#EXTINF:10,\nhttp://x/seg.ts'))).toBe('hls');
    expect(matchesDeclared('image', 'image/jpeg', sniff(enc('<html>')))).toBe(false);
    expect(matchesDeclared('video', 'video/mp4', 'webm')).toBe(false);
    expect(matchesDeclared('audio', 'audio/mp4', 'mp4')).toBe(true);
  });
});

describe('container facts (AT-UP-4, AT-UP-5; review 2026-11-26: allowlists, fail closed)', () => {
  const full = (type: string, version: number, payload: number[]) =>
    box(type, [version, 0, 0, 0, ...payload]);
  const mvhd = (timescale: number, duration: number) =>
    full('mvhd', 0, [
      ...be32(0),
      ...be32(0),
      ...be32(timescale),
      ...be32(duration),
      ...new Array<number>(80).fill(0),
    ]);
  const tkhd = (duration: number) =>
    full('tkhd', 0, [
      ...be32(0),
      ...be32(0),
      ...be32(1),
      ...be32(0),
      ...be32(duration),
      ...new Array<number>(60).fill(0),
    ]);
  const mdhd = (timescale: number, duration: number) =>
    full('mdhd', 0, [...be32(0), ...be32(0), ...be32(timescale), ...be32(duration), 0, 0, 0, 0]);
  const minf = (extra: number[] = []) =>
    box('minf', [
      ...full('smhd', 0, [0, 0, 0, 0]),
      ...extra,
      ...box('stbl', box('stsd', [0, 0, 0, 0, ...be32(0)])),
    ]);
  const trak = (movieDuration: number, mediaScale: number, mediaDuration: number, minfExtra: number[] = []) =>
    box('trak', [
      ...tkhd(movieDuration),
      ...box('mdia', [
        ...mdhd(mediaScale, mediaDuration),
        ...full('hdlr', 0, new Array<number>(20).fill(0)),
        ...minf(minfExtra),
      ]),
    ]);
  const moov = (...children: number[][]) => new Uint8Array(box('moov', children.flat()));
  const good = () => [mvhd(1000, 180_000), trak(180_000, 48_000, 180 * 48_000)];
  const file = (...tops: number[][]) => new Uint8Array(tops.flat());
  const reader = (f: Uint8Array) => (a: number, b: number) => Promise.resolve(f.subarray(a, b + 1));
  const ftyp = () => box('ftyp', ascii('isom'));
  const mdat = () => box('mdat', new Array<number>(64).fill(1));

  it('accepts a clean MP4: allowed top-level boxes, mvhd/tkhd/mdhd agree', async () => {
    const f = file(ftyp(), mdat(), box('moov', good().flat()), box('free', [0, 0, 0, 0]));
    expect(await mp4Check(reader(f), f.length)).toEqual({ durationMs: 180_000, problem: null });
    expect(mp4Facts(moov(mvhd(600, 108_600), trak(108_600, 600, 108_600))).durationMs).toBe(181_000);
  });

  it('refuses XMP in a top-level uuid box and a top-level meta box (extra details)', async () => {
    const xmp = box('uuid', [
      ...new Array<number>(16).fill(0xbe),
      ...ascii('<x:xmpmeta GPSLatitude="21.25"/>'),
    ]);
    for (const extra of [xmp, box('meta', [0, 0, 0, 0])]) {
      const f = file(ftyp(), mdat(), box('moov', good().flat()), extra);
      expect((await mp4Check(reader(f), f.length)).problem).toBe('location_atom');
    }
  });

  // SIM-F6 (live QA 2026-11-27): `ffmpeg -map_metadata -1 -fflags +bitexact` still writes moov/udta/meta with an
  // encoder tag and no location; a phone MP4 carries udta too. Only real location data refuses the file.
  const ffmpegUdta = () =>
    box(
      'udta',
      box('meta', [
        0,
        0,
        0,
        0,
        ...box('hdlr', [...new Array<number>(8).fill(0), ...ascii('mdir'), ...new Array<number>(13).fill(0)]),
        ...box('ilst', box('©too', box('data', [0, 0, 0, 1, 0, 0, 0, 0, ...ascii('Lavf61.7.100')]))),
      ]),
    );
  it('accepts udta / meta without location (ffmpeg metadata strip, phone recordings; SIM-F6)', () => {
    expect(mp4Facts(moov(...good(), ffmpegUdta())).problem).toBeNull();
    expect(mp4Facts(moov(...good(), box('meta', [0, 0, 0, 0]))).problem).toBeNull();
    expect(mp4Facts(moov(mvhd(1000, 1000), box('trak', [...tkhd(1000), ...box('udta', [])]))).problem).toBe(
      'unreadable', // no mdia: refused for the missing track data, not for udta
    );
  });

  // Founder 2026-11-28: "don't check at all" — phone videos are no longer refused for location data in udta/meta.
  it('accepts location data in udta / meta (©xyz, loci, Apple location keys); still refuses unknown boxes in moov', () => {
    expect(mp4Facts(moov(...good(), box('udta', box('©xyz', ascii('+21.25+081.63/'))))).problem).toBeNull();
    expect(
      mp4Facts(moov(...good(), box('udta', box('loci', new Array<number>(20).fill(0))))).problem,
    ).toBeNull();
    const appleKeys = box('meta', [
      0,
      0,
      0,
      0,
      ...box('keys', [0, 0, 0, 0, ...be32(1), ...box('mdta', ascii('com.apple.quicktime.location.ISO6709'))]),
    ]);
    expect(mp4Facts(moov(...good(), appleKeys)).problem).toBeNull();
    expect(mp4Facts(moov(...good(), box('zzzz', [0, 0, 0, 0]))).problem).toBe('location_atom');
  });

  it('refuses an mvhd that is not a direct child of moov, and durations that disagree', () => {
    expect(mp4Facts(moov(box('mvex', mvhd(1000, 1000)), trak(1000, 1000, 1000))).problem).not.toBeNull();
    expect(mp4Facts(moov(mvhd(1000, 10_000), trak(180_000, 1000, 10_000))).problem).toBe('unreadable');
    expect(mp4Facts(moov(mvhd(1000, 10_000), trak(10_000, 1000, 180_000))).problem).toBe('unreadable');
    expect(mp4Facts(moov(mvhd(1000, 10_000))).problem).toBe('unreadable');
  });

  it('refuses an external data reference; a self-contained one is fine', () => {
    const urlEntry = box('url ', [0, 0, 0, 0, ...ascii('http://evil.example/media')]);
    const ext = box('dinf', full('dref', 0, [...be32(1), ...urlEntry]));
    expect(mp4Facts(moov(mvhd(1000, 1000), trak(1000, 1000, 1000, ext))).problem).toBe('external_reference');
    const self = box('dinf', full('dref', 0, [...be32(1), ...box('url ', [0, 0, 0, 1])]));
    expect(mp4Facts(moov(mvhd(1000, 1000), trak(1000, 1000, 1000, self))).problem).toBeNull();
  });

  // WebM / Matroska ----------------------------------------------------------------------------------------------
  const size = (n: number) => (n < 0x7f ? [0x80 | n] : [0x40 | (n >> 8), n & 0xff]);
  const el = (id: number[], payload: number[]) => [...id, ...size(payload.length), ...payload];
  const unknownSize = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x86], [0x01]));
  const info = (extra: number[] = []) =>
    el(
      [0x15, 0x49, 0xa9, 0x66],
      [...el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), ...el([0x4d, 0x80], ascii('Chrome')), ...extra],
    );
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], el([0xd7], [0x01])));
  const block = (ms: number) => el([0xa3], [0x81, (ms >> 8) & 0xff, ms & 0xff, 0x80, 1, 2, 3]);
  const cluster = (tc: number, blocks: number[]) => [
    0x1f,
    0x43,
    0xb6,
    0x75,
    ...unknownSize,
    ...el([0xe7], be32(tc)),
    ...blocks.flatMap(block),
  ];
  const webm = (...segmentChildren: number[][]) =>
    new Uint8Array([...header, 0x18, 0x53, 0x80, 0x67, ...unknownSize, ...segmentChildren.flat()]);
  const durationEl = (ms: number) => {
    const d = new Uint8Array(8);
    new DataView(d.buffer).setFloat64(0, ms);
    return el([0x44, 0x89], [...d]);
  };

  it('accepts a MediaRecorder-style WebM (unknown sizes, no Duration): duration from the last block', async () => {
    const f = webm(info(), tracks, cluster(0, [0, 1000]), cluster(2000, [500]));
    expect(await webmCheck(reader(f), f.length)).toEqual({ durationMs: 2500, problem: null });
    const g = webm(info(durationEl(2500)), tracks, cluster(0, [0, 1000]), cluster(2000, [500]));
    expect((await webmCheck(reader(g), g.length)).problem).toBeNull();
  });

  it('refuses Tags anywhere (also mid-file between clusters), Attachments, Chapters and unknown elements', async () => {
    const tags = el([0x12, 0x54, 0xc3, 0x67], ascii('LOCATION'));
    const attachments = el([0x19, 0x41, 0xa4, 0x69], [0]);
    const chapters = el([0x10, 0x43, 0xa7, 0x70], [0]);
    for (const bad of [tags, attachments, chapters]) {
      const f = webm(info(), tracks, cluster(0, [0, 1000]), bad, cluster(2000, [500]));
      expect((await webmCheck(reader(f), f.length)).problem).not.toBeNull();
    }
    const titled = webm(info(el([0x7b, 0xa9], ascii('Raipur garage'))), tracks, cluster(0, [0]));
    expect((await webmCheck(reader(titled), titled.length)).problem).toBe('location_atom');
  });

  it('refuses a Duration that disagrees with the blocks, an Info outside the Segment, and junk', async () => {
    const lie = webm(info(durationEl(170_000)), tracks, cluster(0, [0, 1000]));
    expect((await webmCheck(reader(lie), lie.length)).problem).toBe('unreadable');
    const outside = new Uint8Array([...header, ...info(), 0x18, 0x53, 0x80, 0x67, ...unknownSize, ...tracks]);
    expect((await webmCheck(reader(outside), outside.length)).problem).not.toBeNull();
    const junk = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0xff]);
    expect((await webmCheck(reader(junk), junk.length)).problem).toBe('unreadable');
  });

  it('Ogg Opus: duration from the last granule; any tag other than the encoder refuses', () => {
    const tagsPacket = (comments: string[]) => [
      ...ascii('OpusTags'),
      ...[3, 0, 0, 0],
      ...ascii('lib'),
      ...[comments.length, 0, 0, 0],
      ...comments.flatMap((c) => [c.length, 0, 0, 0, ...ascii(c)]),
    ];
    const head = (comments: string[]) =>
      new Uint8Array([
        ...ascii('OggS'),
        ...new Array<number>(24).fill(0),
        ...ascii('OpusHead'),
        1,
        1,
        0x38,
        0x01,
        ...new Array<number>(8).fill(0),
        ...ascii('OggS'),
        ...new Array<number>(24).fill(0),
        ...tagsPacket(comments),
      ]);
    const granule = 48_000 * 60 + 312;
    const g = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => Math.floor(granule / 256 ** i) % 256);
    const tail = new Uint8Array([...ascii('OggS'), 0, 0, ...g, 0, 0, 0, 0]);
    expect(oggFacts(head(['ENCODER=Mozilla']), tail)).toEqual({ durationMs: 60_000, problem: null });
    expect(oggFacts(head(['LOCATION=21.25,81.63']), tail).problem).toBe('location_atom');
  });
});

describe('fragmented MP4 and read caps (review 2026-11-26)', () => {
  const box2 = (type: string, payload: number[]) => box(type, payload);
  const reader = (f: Uint8Array) => (a: number, b: number) => Promise.resolve(f.subarray(a, b + 1));

  it('refuses a fragmented MP4 (moof, sidx, styp, mfra at the top; mvex in moov)', async () => {
    for (const frag of ['moof', 'sidx', 'styp', 'mfra']) {
      const f = new Uint8Array([...box2('ftyp', ascii('isom')), ...box2(frag, [0, 0, 0, 0])]);
      expect((await mp4Check(reader(f), f.length)).problem, frag).toBe('location_atom');
    }
    expect(
      mp4Facts(new Uint8Array(box2('moov', box2('mvex', box2('trex', new Array<number>(24).fill(0))))))
        .problem,
    ).toBe('location_atom');
  });

  it('refuses a WebM whose Info claims more than 64 KB, before reading it', async () => {
    const reads: number[] = [];
    const header = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01];
    const seg = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
    // Info with a 4-byte size of 50 MB.
    const info = [0x15, 0x49, 0xa9, 0x66, 0x13, 0x00, 0x00, 0x00];
    const f = new Uint8Array([...header, ...seg, ...info, ...new Array<number>(32).fill(0)]);
    const read = (a: number, b: number) => {
      reads.push(b - a + 1);
      return Promise.resolve(f.subarray(a, b + 1));
    };
    expect((await webmCheck(read, 60 * 1024 * 1024)).problem).toBe('unreadable');
    expect(Math.max(...reads)).toBeLessThanOrEqual(1024 * 1024);
  });
});

describe('image re-encoding (AT-UP-1, AT-UP-3)', () => {
  it('drops EXIF GPS and makes the 1080 and 480 variants', async () => {
    const jpeg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#ea5728' } })
      .jpeg()
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '21/1 15/1 0/1' } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const out = await reencode(jpeg);
    expect(out.large.width).toBe(1080);
    expect(out.small.width).toBe(480);
    for (const v of [out.large.data, out.small.data]) {
      const meta = await sharp(Buffer.from(v)).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
    }
  });

  it('refuses a decompression bomb from the header, before decoding', async () => {
    // A PNG whose header claims 10000 × 10000 (100 MP) but carries one tiny IDAT.
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (bytes: number[]) => {
      let c = 0xffffffff;
      for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: number[]) => [
      ...be32(data.length),
      ...ascii(type),
      ...data,
      ...be32(crc([...ascii(type), ...data])),
    ];
    const ihdr = [...be32(10_000), ...be32(10_000), 8, 2, 0, 0, 0];
    const png = Buffer.from([
      0x89,
      ...ascii('PNG'),
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk('IHDR', ihdr),
      ...chunk('IDAT', [...deflateSync(Buffer.from([0, 0, 0, 0]))]),
      ...chunk('IEND', []),
    ]);
    expect(10_000 * 10_000).toBeGreaterThan(USTAAD_MAX_IMAGE_PIXELS);
    await expect(reencode(png)).rejects.toMatchObject({ reason: 'decompression_bomb' });
  });
});
