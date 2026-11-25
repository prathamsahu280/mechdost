/**
 * Cloudflare R2 `MediaHost` (S3 API, region `auto`; spec 23 § 10, provider ruling 3). No SDK: every call, the
 * server's own included, is a short-lived SigV4-presigned request (`sigv4.ts`). Uploads sign `content-type` and
 * `content-length`, so R2 refuses a different size or type (SR-12); each multipart part signs its exact length. Not
 * used until the R2 keys exist (Q-U1); tested against a fake `fetch`.
 */
import type { UstaadMediaBucket } from '@mechdost/shared/ustaad/codes';
import { MEDIA_HARD_CAP_BYTES } from '@mechdost/shared/ustaad/codes';
import type { BucketNames, MediaHost } from './host';
import { presign, type SigV4Credentials } from './sigv4';

export interface R2Config {
  accountId: string;
  credentials: SigV4Credentials;
  buckets: BucketNames;
  /** Override for tests / a custom domain for the S3 endpoint. */
  endpoint?: string;
}

const SERVER_TTL = 60;
const TIMEOUT_MS = 10_000;

export function r2MediaHost(cfg: R2Config, fetchImpl: typeof fetch = fetch): MediaHost {
  const endpoint = cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`;
  const path = (bucket: UstaadMediaBucket, key: string) => `/${cfg.buckets[bucket]}/${key}`;
  const sign = (
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE' | 'POST',
    bucket: UstaadMediaBucket,
    key: string,
    ttl: number,
    extra: { headers?: Record<string, string>; query?: Record<string, string>; now?: Date } = {},
  ) =>
    presign({
      method,
      endpoint,
      path: path(bucket, key),
      region: 'auto',
      credentials: cfg.credentials,
      expiresSec: ttl,
      ...(extra.headers ? { signedHeaders: extra.headers } : {}),
      ...(extra.query ? { query: extra.query } : {}),
      ...(extra.now ? { now: extra.now } : {}),
    });
  const call = async (
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE' | 'POST',
    bucket: UstaadMediaBucket,
    key: string,
    opts: {
      headers?: Record<string, string>;
      query?: Record<string, string>;
      body?: Uint8Array | string;
      range?: string;
    } = {},
  ) => {
    const p = sign(method, bucket, key, SERVER_TTL, opts);
    return fetchImpl(p.url, {
      method,
      headers: { ...p.headers, ...(opts.range ? { range: opts.range } : {}) },
      ...(opts.body === undefined ? {} : { body: opts.body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };
  const ok = (res: Response, what: string) => {
    if (!res.ok) throw new Error(`r2 ${what} failed (${String(res.status)})`);
    return res;
  };

  return {
    id: 'r2',
    maxFileBytes: MEDIA_HARD_CAP_BYTES.video,
    supportsMultipart: true,
    presignPut(bucket, key, file, ttlSec) {
      const p = sign('PUT', bucket, key, ttlSec, {
        headers: { 'content-type': file.mime, 'content-length': String(file.bytes) },
      });
      return Promise.resolve({ url: p.url, headers: p.headers, method: 'PUT' as const });
    },
    async createMultipart(bucket, key, mime) {
      const res = ok(
        await call('POST', bucket, key, { query: { uploads: '' }, headers: { 'content-type': mime } }),
        'create multipart',
      );
      const id = /<UploadId>([^<]{1,512})<\/UploadId>/.exec(await res.text())?.[1];
      if (!id) throw new Error('r2 create multipart: no upload id');
      return { uploadId: id };
    },
    presignPart(bucket, key, uploadId, partNo, bytes, ttlSec) {
      const p = sign('PUT', bucket, key, ttlSec, {
        headers: { 'content-length': String(bytes) },
        query: { partNumber: String(partNo), uploadId },
      });
      return Promise.resolve({ url: p.url, headers: p.headers });
    },
    async completeMultipart(bucket, key, uploadId, parts) {
      const xml = `<CompleteMultipartUpload>${parts
        .map(
          (x) =>
            `<Part><PartNumber>${String(x.partNo)}</PartNumber><ETag>${x.etag.replace(/[<>&]/g, '')}</ETag></Part>`,
        )
        .join('')}</CompleteMultipartUpload>`;
      ok(await call('POST', bucket, key, { query: { uploadId }, body: xml }), 'complete multipart');
    },
    async head(bucket, key) {
      const res = await call('HEAD', bucket, key);
      if (res.status === 404) return null;
      ok(res, 'head');
      const bytes = Number(res.headers.get('content-length') ?? NaN);
      return Number.isFinite(bytes) ? { bytes, mime: res.headers.get('content-type') } : null;
    },
    async getRange(bucket, key, start, end) {
      const res = ok(
        await call('GET', bucket, key, { range: `bytes=${String(start)}-${String(end)}` }),
        'get',
      );
      return new Uint8Array(await res.arrayBuffer());
    },
    async copy(fromBucket, key, toBucket, toKey) {
      ok(
        await call('PUT', toBucket, toKey, {
          headers: { 'x-amz-copy-source': `/${cfg.buckets[fromBucket]}/${key}` },
        }),
        'copy',
      );
    },
    presignGet(bucket, key, ttlSec, opts = {}) {
      const query: Record<string, string> = {};
      if (opts.disposition === 'attachment')
        query['response-content-disposition'] =
          `attachment; filename="${(opts.filename ?? 'document.pdf').replace(/[^A-Za-z0-9._-]/g, '_')}"`;
      return Promise.resolve(
        sign('GET', bucket, key, ttlSec, { query, ...(opts.signAt ? { now: opts.signAt } : {}) }).url,
      );
    },
    async put(bucket, key, bytes, mime) {
      ok(
        await call('PUT', bucket, key, {
          headers: { 'content-type': mime, 'content-length': String(bytes.byteLength) },
          body: bytes,
        }),
        'put',
      );
    },
    async remove(bucket, key) {
      const res = await call('DELETE', bucket, key);
      if (!res.ok && res.status !== 404) throw new Error(`r2 delete failed (${String(res.status)})`);
    },
  };
}
