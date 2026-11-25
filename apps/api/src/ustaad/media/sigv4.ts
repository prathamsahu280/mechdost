/**
 * AWS Signature Version 4 query-string presigning (S3-compatible; Cloudflare R2), written over `node:crypto` with no
 * SDK dependency (spec 23 § 10, decision 2026-11-26). Used for PUT (upload, with `content-length` and `content-type`
 * signed so the host refuses any other size or type, SR-12), UploadPart and GET. Path-style URLs
 * (`https://{endpoint}/{bucket}/{key}`), `UNSIGNED-PAYLOAD`.
 */
import { createHash, createHmac } from 'node:crypto';

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface PresignInput {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE' | 'POST';
  /** `https://<account>.r2.cloudflarestorage.com` (no trailing slash). */
  endpoint: string;
  /** Path after the host, already starting with `/` (e.g. `/bucket/q/…/x.webp`); encoded here per segment. */
  path: string;
  region: string;
  service?: string;
  credentials: SigV4Credentials;
  /** Seconds the URL stays valid (1–604800). */
  expiresSec: number;
  /** Extra headers that must be sent exactly (lower-case names); `host` is always signed. */
  signedHeaders?: Record<string, string>;
  /** Extra query parameters signed with the request (e.g. partNumber, uploadId, response-content-disposition). */
  query?: Record<string, string>;
  /** Payload hash in the canonical request; `UNSIGNED-PAYLOAD` for presigned uploads (the default). */
  payloadHash?: string;
  now?: Date;
}

const sha256Hex = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 encoding as AWS wants it (`~` kept; everything else outside unreserved escaped). */
export function awsEncode(value: string, keepSlash = false): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? encoded.replace(/%2F/g, '/') : encoded;
}

/** `20130524T000000Z` and `20130524`. */
export function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export interface Presigned {
  url: string;
  /** Headers the client must send (signed ones, minus host). */
  headers: Record<string, string>;
  /** Exposed for tests: the canonical request that was signed. */
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

export function presign(input: PresignInput): Presigned {
  const service = input.service ?? 's3';
  const now = input.now ?? new Date();
  const { amzDate, dateStamp } = amzDates(now);
  const host = new URL(input.endpoint).host;
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const headers: Record<string, string> = { host, ...lowerKeys(input.signedHeaders ?? {}) };
  const headerNames = Object.keys(headers).sort();
  const signedHeaderList = headerNames.join(';');
  const query: Record<string, string> = {
    ...(input.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresSec),
    'X-Amz-SignedHeaders': signedHeaderList,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${awsEncode(k)}=${awsEncode(query[k] ?? '')}`)
    .join('&');
  const canonicalPath = input.path
    .split('/')
    .map((seg) => awsEncode(seg))
    .join('/');
  const canonicalHeaders = headerNames.map((n) => `${n}:${(headers[n] ?? '').trim()}\n`).join('');
  const canonicalRequest = [
    input.method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderList,
    input.payloadHash ?? 'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac(
    'sha256',
    signingKey(input.credentials.secretAccessKey, dateStamp, input.region, service),
  )
    .update(stringToSign, 'utf8')
    .digest('hex');
  const url = `${input.endpoint}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  const { host: _host, ...clientHeaders } = headers;
  return { url, headers: clientHeaders, canonicalRequest, stringToSign, signature };
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
}
