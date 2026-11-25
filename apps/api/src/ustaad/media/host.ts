/**
 * Where Ustaad media bytes live (spec 23 § 10). One interface, two adapters: `r2MediaHost` (Cloudflare R2, S3-style
 * SigV4 presigning written in-house) and `supabaseMediaHost` (Supabase Storage signed uploads; the default until R2
 * keys exist, Q-U1). Three private buckets: quarantine (every upload lands here, never readable by a member, SR-12),
 * media (verified images, audio, video) and docs (PDFs, served only as downloads from a separate host, SR-16); the
 * evidence vault is a fourth bucket used only by the takedown path (workstream F).
 */
import type { UstaadMediaBucket, UstaadMediaHostId } from '@mechdost/shared/ustaad/codes';

export interface PresignedPut {
  url: string;
  /** Headers the phone must send exactly (the host refuses a different size or type where it can). */
  headers: Record<string, string>;
  method: 'PUT';
}

export interface MediaHost {
  readonly id: UstaadMediaHostId;
  /** Largest single file this host accepts (bytes); the declare step clamps every cap to it. */
  readonly maxFileBytes: number;
  /** Resumable 8 MB parts (R2). Supabase TUS resumable uploads are a follow-up: there every file is one PUT. */
  readonly supportsMultipart: boolean;
  presignPut(
    bucket: UstaadMediaBucket,
    key: string,
    file: { mime: string; bytes: number },
    ttlSec: number,
  ): Promise<PresignedPut>;
  createMultipart(bucket: UstaadMediaBucket, key: string, mime: string): Promise<{ uploadId: string }>;
  presignPart(
    bucket: UstaadMediaBucket,
    key: string,
    uploadId: string,
    partNo: number,
    bytes: number,
    ttlSec: number,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  completeMultipart(
    bucket: UstaadMediaBucket,
    key: string,
    uploadId: string,
    parts: readonly { partNo: number; etag: string }[],
  ): Promise<void>;
  head(bucket: UstaadMediaBucket, key: string): Promise<{ bytes: number; mime: string | null } | null>;
  /** Inclusive byte range. */
  getRange(bucket: UstaadMediaBucket, key: string, start: number, end: number): Promise<Uint8Array>;
  copy(fromBucket: UstaadMediaBucket, key: string, toBucket: UstaadMediaBucket, toKey: string): Promise<void>;
  presignGet(
    bucket: UstaadMediaBucket,
    key: string,
    ttlSec: number,
    opts?: { disposition?: 'inline' | 'attachment'; filename?: string; signAt?: Date },
  ): Promise<string>;
  put(bucket: UstaadMediaBucket, key: string, bytes: Uint8Array, mime: string): Promise<void>;
  remove(bucket: UstaadMediaBucket, key: string): Promise<void>;
}

/** Bucket names per host (from the environment; defaults for local development). */
export type BucketNames = Record<UstaadMediaBucket, string>;

export const DEFAULT_BUCKETS: BucketNames = {
  quarantine: 'ustaad-quarantine',
  media: 'ustaad-media',
  docs: 'ustaad-docs',
  evidence: 'ustaad-evidence',
};

/**
 * Signing time for a read URL (spec 23 § 10 step 6, SR-21): the start of the current `ttlSec` window, so every URL
 * for the same object within the window is identical and the browser cache works, and it expires at the window end,
 * never later than `ttlSec` from now. With under two minutes left in the window the URL is signed now instead (a
 * fresh full lifetime, still ≤ `ttlSec`).
 */
export function readWindow(
  nowMs: number,
  ttlSec: number,
): { signAt: Date; expiresSec: number; expiresAt: Date } {
  const w = ttlSec * 1000;
  const start = Math.floor(nowMs / w) * w;
  if (start + w - nowMs < 120_000)
    return { signAt: new Date(nowMs), expiresSec: ttlSec, expiresAt: new Date(nowMs + w) };
  return { signAt: new Date(start), expiresSec: ttlSec, expiresAt: new Date(start + w) };
}
