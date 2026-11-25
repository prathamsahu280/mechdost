/**
 * Supabase Storage `MediaHost` (the default until R2 keys exist, Q-U1; spec 23 § 10). REST API with the server
 * SECRET key (never sent to a browser). Limits of this host, recorded in spec 23 § 10:
 *  - a signed upload URL lasts 2 hours (Supabase's fixed lifetime) and does not bind size or type, so the size and
 *    type rules are enforced by the bucket's own `file_size_limit` / `allowed_mime_types`, by the `HEAD` check at
 *    `complete` (size and type must equal the declaration, else the object is deleted) and by our 10-minute window
 *    (an upload completed after it is rejected; an object written late never leaves quarantine and is purged);
 *  - one PUT per file (TUS resumable uploads are a follow-up), up to the project's per-file limit
 *    (`SUPABASE_MAX_UPLOAD_MB`, default 50, the free plan): a larger video waits for R2 (`MEDIA_TOO_LARGE`).
 */
import type { UstaadMediaBucket } from '@mechdost/shared/ustaad/codes';
import type { BucketNames, MediaHost } from './host';

export interface SupabaseMediaConfig {
  url: string;
  secretKey: string;
  buckets: BucketNames;
  maxFileBytes: number;
}

const TIMEOUT_MS = 10_000;

export function supabaseMediaHost(cfg: SupabaseMediaConfig, fetchImpl: typeof fetch = fetch): MediaHost {
  const base = `${cfg.url}/storage/v1`;
  const auth: Record<string, string> = { apikey: cfg.secretKey };
  if (cfg.secretKey.startsWith('eyJ')) auth.Authorization = `Bearer ${cfg.secretKey}`;
  const enc = (key: string) => key.split('/').map(encodeURIComponent).join('/');
  const ref = (bucket: UstaadMediaBucket, key: string) => `${cfg.buckets[bucket]}/${enc(key)}`;
  const call = (
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array },
  ) =>
    fetchImpl(url, {
      ...init,
      headers: { ...auth, ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  const ok = (res: Response, what: string) => {
    if (!res.ok) throw new Error(`storage ${what} failed (${String(res.status)})`);
    return res;
  };
  const absolute = (path: string) =>
    path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;

  return {
    id: 'supabase',
    maxFileBytes: cfg.maxFileBytes,
    supportsMultipart: false,
    async presignPut(bucket, key, file) {
      const res = ok(
        await call(`${base}/object/upload/sign/${ref(bucket, key)}`, { method: 'POST' }),
        'sign upload',
      );
      const body = (await res.json()) as { url?: unknown };
      if (typeof body.url !== 'string') throw new Error('storage sign upload: no url');
      return {
        url: absolute(body.url),
        headers: { 'content-type': file.mime, 'x-upsert': 'false' },
        method: 'PUT' as const,
      };
    },
    createMultipart() {
      return Promise.reject(new Error('resumable uploads are not available on this host'));
    },
    presignPart() {
      return Promise.reject(new Error('resumable uploads are not available on this host'));
    },
    completeMultipart() {
      return Promise.reject(new Error('resumable uploads are not available on this host'));
    },
    async head(bucket, key) {
      const res = await call(`${base}/object/${ref(bucket, key)}`, { method: 'HEAD' });
      if (res.status === 404 || res.status === 400) return null;
      ok(res, 'head');
      const bytes = Number(res.headers.get('content-length') ?? NaN);
      return Number.isFinite(bytes) ? { bytes, mime: res.headers.get('content-type') } : null;
    },
    async getRange(bucket, key, start, end) {
      const res = ok(
        await call(`${base}/object/${ref(bucket, key)}`, {
          method: 'GET',
          headers: { range: `bytes=${String(start)}-${String(end)}` },
        }),
        'get',
      );
      return new Uint8Array(await res.arrayBuffer());
    },
    async copy(fromBucket, key, toBucket, toKey) {
      ok(
        await call(`${base}/object/copy`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bucketId: cfg.buckets[fromBucket],
            sourceKey: key,
            destinationBucket: cfg.buckets[toBucket],
            destinationKey: toKey,
          }),
        }),
        'copy',
      );
    },
    async presignGet(bucket, key, ttlSec, opts = {}) {
      const res = ok(
        await call(`${base}/object/sign/${ref(bucket, key)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expiresIn: ttlSec }),
        }),
        'sign',
      );
      const body = (await res.json()) as { signedURL?: unknown };
      if (typeof body.signedURL !== 'string') throw new Error('storage sign: no url');
      const url = absolute(body.signedURL);
      return opts.disposition === 'attachment'
        ? `${url}&download=${encodeURIComponent(opts.filename ?? 'document.pdf')}`
        : url;
    },
    async put(bucket, key, bytes, mime) {
      ok(
        await call(`${base}/object/${ref(bucket, key)}`, {
          method: 'POST',
          headers: { 'content-type': mime, 'x-upsert': 'false' },
          body: bytes,
        }),
        'put',
      );
    },
    async remove(bucket, key) {
      const res = await call(`${base}/object/${ref(bucket, key)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`storage delete failed (${String(res.status)})`);
    },
  };
}
