/**
 * Cloudflare R2 usage (founder 2026-11-26; runbook monitoring.md "Usage & limits"). Storage bytes and object counts
 * per bucket from S3 ListObjectsV2 (path-style, SigV4-presigned with the existing signer and the R2_* keys; no SDK),
 * paginated and capped: past the page cap or the deadline the result is `partial` (the numbers are a floor). Each
 * listed page is itself one Class A operation, returned so the caller can count it.
 *
 * Exact Class A / B counts are not in the S3 API. With CLOUDFLARE_ANALYTICS_TOKEN (Account Analytics: Read) they come
 * from Cloudflare's GraphQL Analytics API (`r2OperationsAdaptiveGroups`); without it the caller uses our own counts
 * (estimated). Nothing secret is ever logged or returned.
 */
import type { UsageProviderStatus } from '@mechdost/shared/usage';
import { presign, type SigV4Credentials } from '../ustaad/media/sigv4';

export interface R2UsageConfig {
  accountId: string;
  credentials: SigV4Credentials;
  buckets: readonly string[];
  /** Override for tests. */
  endpoint?: string;
}

export interface R2UsageResult {
  status: UsageProviderStatus;
  bytes: number;
  objects: number;
  /** ListObjectsV2 calls made (Class A). */
  listCalls: number;
}

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Sizes, truncation flag and next token from one ListObjectsV2 page (only the fields we need). */
export function parseListPage(xml: string): { sizes: number[]; truncated: boolean; next: string | null } {
  const sizes = [...xml.matchAll(/<Size>(\d{1,20})<\/Size>/g)].map((m) => Number(m[1]));
  const truncated = xml.includes('<IsTruncated>true</IsTruncated>');
  const token = /<NextContinuationToken>([^<]{1,4096})<\/NextContinuationToken>/.exec(xml)?.[1];
  return { sizes, truncated, next: token ? unescapeXml(token) : null };
}

export async function measureR2(
  cfg: R2UsageConfig,
  fetchImpl: typeof fetch = fetch,
  opts: { deadlineMs?: number; maxPagesPerBucket?: number; now?: () => number } = {},
): Promise<R2UsageResult> {
  const endpoint = cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`;
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.deadlineMs ?? 20_000);
  const maxPages = opts.maxPagesPerBucket ?? 200;
  let bytes = 0;
  let objects = 0;
  let listCalls = 0;
  let partial = false;
  for (const bucket of cfg.buckets) {
    let token: string | null = null;
    for (let page = 0; ; page += 1) {
      if (page >= maxPages || now() > deadline) {
        partial = true;
        break;
      }
      const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000' };
      if (token) query['continuation-token'] = token;
      const p = presign({
        method: 'GET',
        endpoint,
        path: `/${bucket}`,
        region: 'auto',
        credentials: cfg.credentials,
        expiresSec: 60,
        query,
      });
      listCalls += 1;
      let res: Response;
      try {
        res = await fetchImpl(p.url, {
          method: 'GET',
          headers: p.headers,
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        return { status: 'failed', bytes: 0, objects: 0, listCalls };
      }
      // A refused or missing bucket (403/404) or a server error fails the provider: no partial number is stored.
      if (!res.ok) return { status: 'failed', bytes: 0, objects: 0, listCalls };
      const parsed = parseListPage(await res.text());
      bytes += parsed.sizes.reduce((a, b) => a + b, 0);
      objects += parsed.sizes.length;
      if (!parsed.truncated || !parsed.next) break;
      token = parsed.next;
    }
  }
  return { status: partial ? 'partial' : 'ok', bytes, objects, listCalls };
}

/**
 * Class A and B operations this month from Cloudflare's GraphQL Analytics API (optional; exact). `actionType` names
 * are classed as on https://developers.cloudflare.com/r2/pricing/ (checked 2026-11-26); free ones are left out.
 */
const CLASS_A = new Set([
  'ListBuckets',
  'PutBucket',
  'ListObjects',
  'ListObjectsV2',
  'PutObject',
  'CopyObject',
  'CompleteMultipartUpload',
  'CreateMultipartUpload',
  'LifecycleStorageTierTransition',
  'ListMultipartUploads',
  'UploadPart',
  'UploadPartCopy',
  'ListParts',
  'PutBucketEncryption',
  'PutBucketCors',
  'PutBucketLifecycleConfiguration',
]);
const CLASS_B = new Set([
  'HeadBucket',
  'HeadObject',
  'GetObject',
  'UsageSummary',
  'GetBucketEncryption',
  'GetBucketLocation',
  'GetBucketCors',
  'GetBucketLifecycleConfiguration',
]);

export async function r2OperationsThisMonth(
  input: { accountId: string; token: string; now: Date },
  fetchImpl: typeof fetch = fetch,
): Promise<{ classA: number; classB: number } | null> {
  const start = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), 1));
  const query = `query R2Ops($account: String!, $start: Time!, $end: Time!) {
    viewer { accounts(filter: { accountTag: $account }) {
      r2OperationsAdaptiveGroups(limit: 1000, filter: { datetime_geq: $start, datetime_leq: $end }) {
        sum { requests } dimensions { actionType }
      } } } }`;
  try {
    const res = await fetchImpl('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${input.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { account: input.accountId, start: start.toISOString(), end: input.now.toISOString() },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: {
        viewer?: {
          accounts?: {
            r2OperationsAdaptiveGroups?: {
              sum?: { requests?: number };
              dimensions?: { actionType?: string };
            }[];
          }[];
        };
      };
      errors?: unknown[];
    };
    if (body.errors && body.errors.length > 0) return null;
    const groups = body.data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups;
    if (!groups) return null;
    let classA = 0;
    let classB = 0;
    for (const g of groups) {
      const n = g.sum?.requests ?? 0;
      const action = g.dimensions?.actionType ?? '';
      if (CLASS_A.has(action)) classA += n;
      else if (CLASS_B.has(action)) classB += n;
    }
    return { classA, classB };
  } catch {
    return null;
  }
}
