/**
 * Link previews without SSRF (spec 23 § 10a, SR-22/23; AT-SSRF-1/2). This module has no database or storage access:
 * it takes a URL and returns `{ status, finalHost, title, description }`; the caller stores it after the post's
 * transaction has committed, and a failure never blocks the post.
 *
 * Rules: http/https on the default ports with a real host name (`safeLinkUrl`); the host is resolved once and every
 * address is checked against the deny list (private, loopback, link-local incl. 169.254.169.254, CGNAT, ULA,
 * multicast, documentation, 6to4/NAT64/Teredo and every IPv4-mapped IPv6 address); the connection goes to the checked
 * address (the socket's `lookup` is pinned, so there is no second resolution and no DNS rebinding); at most 3
 * redirects, each checked the same way; 3 s in total; 512 KB of body; `text/html` only; no cookies; only `og:title`
 * and `og:description` (or `<title>`) are kept. The og:image is not fetched (next step: through the image pipeline).
 * v1 runs in the API process; a separate worker process is the documented next step (spec 23 § 21b D1).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { linkDisplayHost, safeLinkUrl } from '@mechdost/shared/ustaad/links';

export interface LinkPreview {
  status: 'ok' | 'blocked' | 'failed';
  finalHost: string | null;
  title: string | null;
  description: string | null;
}

export interface PreviewResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
}

export interface PinnedRequest {
  url: URL;
  address: string;
  family: number;
  signal: AbortSignal;
  maxBytes: number;
}

export interface PreviewDeps {
  resolve: (host: string) => Promise<{ address: string; family: number }[]>;
  request: (req: PinnedRequest) => Promise<PreviewResponse>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export const PREVIEW_TIMEOUT_MS = 3000;
export const PREVIEW_MAX_BYTES = 512 * 1024;
export const PREVIEW_MAX_REDIRECTS = 3;

// Two lists: a v4 check against a list holding `::ffff:0:0/96` would match every IPv4 address (Node maps them).
const deny4 = new BlockList();
const deny6 = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  deny4.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 96], // unspecified, loopback and the deprecated IPv4-compatible range
  ['::ffff:0:0', 96], // IPv4-mapped: never a public site
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48],
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const)
  deny6.addSubnet(net, bits, 'ipv6');

/** True when the address must never be connected to (anything that is not a public unicast address). */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return deny4.check(address, 'ipv4');
  if (family === 6) return deny6.check(address, 'ipv6');
  return true;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e: string) => {
    if (e.startsWith('#')) {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const clean = (s: string | undefined, max: number): string | null => {
  if (s === undefined) return null;
  // Control characters from the page become spaces.
  const v = decodeEntities(s)
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return v ? v.slice(0, max) : null;
};

/** `og:title` / `og:description` (or `<title>` / `description`) from the first part of an HTML page. Plain text out. */
export function parseOpenGraph(htmlText: string): { title: string | null; description: string | null } {
  const meta: Record<string, string> = {};
  for (const tag of htmlText.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) =>
      new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag) ?? undefined;
    const key = attr('property') ?? attr('name');
    const content = attr('content');
    const k = (key?.[2] ?? key?.[3])?.toLowerCase();
    if (k && content && !(k in meta)) meta[k] = content[2] ?? content[3] ?? '';
  }
  const title = /<title[^>]*>([\s\S]{0,1000}?)<\/title>/i.exec(htmlText)?.[1];
  return {
    title: clean(meta['og:title'] ?? title, 200),
    description: clean(meta['og:description'] ?? meta.description, 500),
  };
}

const header = (h: IncomingMessage['headers'][string]): string | undefined => (Array.isArray(h) ? h[0] : h);

/** The real connector: node:http(s) with the socket's lookup pinned to the checked address; reads ≤ maxBytes. */
export function nodePinnedRequest(req: PinnedRequest): Promise<PreviewResponse> {
  const { url, address, family, signal, maxBytes } = req;
  const pinned = ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    if (opts.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  }) as unknown as LookupFunction;
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<PreviewResponse>((resolve, reject) => {
    const r = send(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          'user-agent': 'MechDostLinkPreview/1.0 (+https://mechdost.in)',
          accept: 'text/html',
          'accept-encoding': 'identity',
        },
        lookup: pinned,
        ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
        agent: false,
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          const headers: Record<string, string | undefined> = {};
          for (const [k, v] of Object.entries(res.headers)) headers[k] = header(v);
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).subarray(0, maxBytes),
          });
        };
        res.on('data', (c: Buffer) => {
          size += c.length;
          chunks.push(c);
          if (size >= maxBytes) {
            finish();
            res.destroy();
          }
        });
        res.on('end', finish);
        res.on('error', (e) => {
          if (!settled) reject(e);
        });
      },
    );
    r.on('error', reject);
    r.end();
  });
}

export function defaultPreviewDeps(): PreviewDeps {
  return {
    resolve: async (host) => dnsLookup(host, { all: true, order: 'verbatim' }),
    request: nodePinnedRequest,
  };
}

const blocked = (): LinkPreview => ({ status: 'blocked', finalHost: null, title: null, description: null });
const failed = (host: string | null): LinkPreview => ({
  status: 'failed',
  finalHost: host,
  title: null,
  description: null,
});

async function run(start: string, deps: PreviewDeps, signal: AbortSignal): Promise<LinkPreview> {
  const maxRedirects = deps.maxRedirects ?? PREVIEW_MAX_REDIRECTS;
  const maxBytes = deps.maxBytes ?? PREVIEW_MAX_BYTES;
  let current = start;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const safe = safeLinkUrl(current);
    if (!safe) return blocked();
    const url = new URL(safe);
    const answers = await deps.resolve(url.hostname);
    if (answers.length === 0 || answers.some((a) => isBlockedAddress(a.address))) return blocked();
    const [first] = answers;
    if (!first) return blocked();
    const res = await deps.request({ url, address: first.address, family: first.family, signal, maxBytes });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location) return failed(linkDisplayHost(safe));
      current = new URL(location, url).href;
      continue;
    }
    if (res.status !== 200) return failed(linkDisplayHost(safe));
    if (!(res.headers['content-type'] ?? '').toLowerCase().startsWith('text/html'))
      return failed(linkDisplayHost(safe));
    const og = parseOpenGraph(res.body.subarray(0, maxBytes).toString('utf8'));
    return { status: 'ok', finalHost: linkDisplayHost(safe), ...og };
  }
  return failed(null);
}

/** Never throws: errors, timeouts and refusals come back as `failed` / `blocked`. */
export async function fetchLinkPreview(url: string, deps: PreviewDeps): Promise<LinkPreview> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<LinkPreview>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(failed(null));
    }, deps.timeoutMs ?? PREVIEW_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run(url, deps, ctrl.signal).catch(() => failed(null)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
