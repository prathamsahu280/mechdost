/**
 * Verify an upload after it landed in quarantine (spec 23 § 10 step 3; SR-12–17, AT-UP-1…6, AT-UP-10). In order:
 * owner and window (repository) → multipart completion → `HEAD` size and type must equal the declaration → magic bytes
 * of the first 64 KB must match the declared kind → per kind: images are downloaded (≤ 3 MB), the pixel count checked
 * from the header before decoding (decompression bomb), re-encoded into `img_1080`, `img_480` and a 24 px LQIP with all
 * metadata gone (EXIF GPS too) and written to the media bucket; video and audio are not transcoded (provider ruling 3):
 * their container duration must be within the cap (+1 s) and MP4 location atoms or external references reject the
 * file, then the bytes are copied to the media bucket under a new random key; PDFs are copied to the docs bucket. Any
 * failure deletes the object and marks the media `rejected` with a reason code.
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  markUstaadMediaUploaded,
  markUstaadMediaVerified,
  pendingUstaadMediaOf,
  rejectUstaadMedia,
  saveUstaadMediaVariants,
  ustaadMediaCaps,
  ustaadObjectKey,
  ustaadMediaById,
  type Tx,
  type UstaadMediaRow,
} from '@mechdost/db/repo';
import type { UstaadMediaKind } from '@mechdost/shared/ustaad/codes';
import { ApiError } from '../../errors';
import { mp4Facts, mp4TopBoxes, oggFacts, webmFacts, type ContainerFacts } from './duration';
import type { MediaHost } from './host';
import { matchesDeclared, sniff } from './sniff';

/** Largest image decoded (pixels): a header above this is a decompression bomb (AT-UP-3). */
export const USTAAD_MAX_IMAGE_PIXELS = 40_000_000;
const HEAD_BYTES = 64 * 1024;
const MOOV_MAX = 8 * 1024 * 1024;

type Reason = NonNullable<UstaadMediaRow['rejectReasonCode']>;
class Reject extends Error {
  constructor(readonly reason: Reason) {
    super(reason);
  }
}

const ERROR_FOR: Partial<Record<Reason, string>> = {
  location_atom: 'MEDIA_LOCATION',
  too_long: 'MEDIA_TOO_LONG',
  too_large: 'MEDIA_TOO_LARGE',
  type_mismatch: 'MEDIA_TYPE',
  decompression_bomb: 'MEDIA_MISMATCH',
};

export interface VerifyDeps {
  db: Tx;
  host: MediaHost;
}

export async function completeAndVerify(
  deps: VerifyDeps,
  input: { mediaId: string; memberId: string; parts?: readonly { partNo: number; etag: string }[] },
): Promise<UstaadMediaRow> {
  const row = await pendingUstaadMediaOf(deps.db, input);
  const kind = row.kind as UstaadMediaKind;
  const q = 'quarantine' as const;
  // TOCTOU (security review 2026-11-26): the phone can keep writing to its upload key until the URL expires, so the
  // server first copies the upload to a private key nobody was ever given, deletes the upload key, and checks and
  // promotes only that private copy (size, magic bytes, sha256 against the declaration, container facts).
  const privateKey = ustaadObjectKey('quarantine', row.ownerMemberId, row.declaredMime);
  let copied = false;
  try {
    if (row.uploadId) {
      if (!input.parts || input.parts.length === 0) throw new Reject('size_mismatch');
      await deps.host.completeMultipart(q, row.objectKey, row.uploadId, input.parts);
    }
    const uploadedHead = await deps.host.head(q, row.objectKey);
    if (!uploadedHead) throw new Reject('unreadable');
    if (uploadedHead.bytes !== row.declaredBytes) throw new Reject('size_mismatch');
    await deps.host.copy(q, row.objectKey, q, privateKey);
    copied = true;
    await deps.host.remove(q, row.objectKey);
    const head = await deps.host.head(q, privateKey);
    if (!head) throw new Reject('unreadable');
    if (head.bytes !== row.declaredBytes) throw new Reject('size_mismatch');
    if (head.mime && head.mime.split(';')[0]?.trim() !== row.declaredMime) throw new Reject('type_mismatch');
    if ((await sha256Of(deps.host, privateKey, row.declaredBytes)) !== row.sha256)
      throw new Reject('hash_mismatch');
    const uploaded = await markUstaadMediaUploaded(deps.db, row);
    const first = await deps.host.getRange(q, privateKey, 0, Math.min(HEAD_BYTES, row.declaredBytes) - 1);
    if (!matchesDeclared(kind, row.declaredMime, sniff(first))) throw new Reject('magic_mismatch');
    const caps = await ustaadMediaCaps(deps.db, kind);

    if (kind === 'image') {
      const bytes = await deps.host.getRange(q, privateKey, 0, row.declaredBytes - 1);
      const out = await reencode(Buffer.from(bytes));
      const k1080 = ustaadObjectKey('media', row.ownerMemberId, 'image/webp');
      const k480 = ustaadObjectKey('media', row.ownerMemberId, 'image/webp');
      await deps.host.put('media', k1080, out.large.data, 'image/webp');
      await deps.host.put('media', k480, out.small.data, 'image/webp');
      await deps.host.remove(q, privateKey);
      const verified = await markUstaadMediaVerified(deps.db, uploaded, {
        bucket: 'media',
        objectKey: k1080,
        durationMs: null,
        width: out.large.width,
        height: out.large.height,
        lqip: out.lqip || null,
      });
      await saveUstaadMediaVariants(deps.db, row.id, [
        {
          variant: 'img_1080',
          objectKey: k1080,
          bytes: out.large.data.byteLength,
          width: out.large.width,
          height: out.large.height,
        },
        {
          variant: 'img_480',
          objectKey: k480,
          bytes: out.small.data.byteLength,
          width: out.small.width,
          height: out.small.height,
        },
      ]);
      return verified;
    }

    let durationMs: number | null = null;
    if (kind === 'video' || kind === 'audio') {
      const facts = await containerFacts(deps.host, privateKey, row.declaredBytes, first);
      if (facts.problem) throw new Reject(facts.problem);
      if (facts.durationMs === null || caps.maxMs === null || facts.durationMs > caps.maxMs + 1000)
        throw new Reject('too_long');
      durationMs = facts.durationMs;
    }
    const target = kind === 'document' ? 'docs' : 'media';
    const liveKey = ustaadObjectKey(target, row.ownerMemberId, row.declaredMime);
    await deps.host.copy(q, privateKey, target, liveKey);
    await deps.host.remove(q, privateKey);
    return await markUstaadMediaVerified(deps.db, uploaded, {
      bucket: target,
      objectKey: liveKey,
      durationMs,
      width: row.width,
      height: row.height,
      lqip: null,
    });
  } catch (err) {
    if (!(err instanceof Reject)) throw err;
    await deps.host.remove(q, row.objectKey).catch(() => undefined);
    if (copied) await deps.host.remove(q, privateKey).catch(() => undefined);
    const fresh = await pendingOrUploaded(deps.db, row);
    if (fresh) await rejectUstaadMedia(deps.db, fresh, err.reason);
    throw new ApiError(422, ERROR_FOR[err.reason] ?? 'MEDIA_MISMATCH', 'This file could not be used', {
      reason: err.reason,
    });
  }
}

/** sha256 of an object, read in 8 MB ranges (never the whole video in memory at once). */
async function sha256Of(host: MediaHost, key: string, bytes: number): Promise<string> {
  const h = createHash('sha256');
  const step = 8 * 1024 * 1024;
  for (let at = 0; at < bytes; at += step)
    h.update(await host.getRange('quarantine', key, at, Math.min(at + step, bytes) - 1));
  return h.digest('hex');
}

/** The row as it is now (it may have moved to `uploaded` before the failure). */
async function pendingOrUploaded(db: Tx, row: UstaadMediaRow): Promise<UstaadMediaRow | null> {
  const now = await ustaadMediaById(db, row.id);
  return now && (now.status === 'pending_upload' || now.status === 'uploaded') ? now : null;
}

async function containerFacts(
  host: MediaHost,
  key: string,
  bytes: number,
  first: Uint8Array,
): Promise<ContainerFacts> {
  const read = (a: number, b: number) => host.getRange('quarantine', key, a, b);
  const tail = () => read(Math.max(0, bytes - HEAD_BYTES), bytes - 1);
  const s = sniff(first);
  if (s === 'mp4') {
    const boxes = await mp4TopBoxes(read, bytes);
    const moovs = boxes.filter((b) => b.type === 'moov');
    const moov = moovs.length === 1 ? moovs[0] : undefined;
    if (!moov || moov.size > MOOV_MAX) return { durationMs: null, problem: 'unreadable' };
    return mp4Facts(await read(moov.offset, moov.offset + moov.size - 1));
  }
  if (s === 'webm') return webmFacts(first, await tail());
  if (s === 'audio/ogg') return oggFacts(first, await tail());
  return { durationMs: null, problem: 'unreadable' };
}

export interface ReencodedImage {
  large: { data: Uint8Array; width: number; height: number };
  small: { data: Uint8Array; width: number; height: number };
  lqip: string;
}

/** Decode once (bomb guard from the header first), rotate from EXIF, re-encode WebP without any metadata. */
export async function reencode(input: Buffer): Promise<ReencodedImage> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(input, { limitInputPixels: false }).metadata();
  } catch {
    throw new Reject('unreadable');
  }
  if (meta.width * meta.height > USTAAD_MAX_IMAGE_PIXELS) throw new Reject('decompression_bomb');
  try {
    const base = () =>
      sharp(input, { limitInputPixels: USTAAD_MAX_IMAGE_PIXELS, failOn: 'error', animated: false }).rotate();
    const fit = (n: number) => ({ width: n, height: n, fit: 'inside' as const, withoutEnlargement: true });
    const large = await base().resize(fit(1080)).webp({ quality: 75 }).toBuffer({ resolveWithObject: true });
    const small = await base().resize(fit(480)).webp({ quality: 72 }).toBuffer({ resolveWithObject: true });
    const tiny = await base().resize(fit(24)).webp({ quality: 40 }).toBuffer();
    return {
      large: { data: large.data, width: large.info.width, height: large.info.height },
      small: { data: small.data, width: small.info.width, height: small.info.height },
      // ≤ 400 bytes (CHECK ustaad_media_lqip_size); a larger one is simply left out.
      lqip: tiny.byteLength <= 280 ? tiny.toString('base64') : '',
    };
  } catch {
    throw new Reject('unreadable');
  }
}
