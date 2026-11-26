/**
 * The SSRF-safe link-preview fetcher (spec 23 § 10a, SR-22/23): AT-SSRF-1 (metadata IP, IPv4-mapped IPv6, hex/decimal
 * IP forms, private ranges, a DNS-rebinding name, a redirect to localhost all refused; the connection goes to the
 * checked address), AT-SSRF-2 (3 s total timeout, 512 KB body cut), og:title / og:description parsing, text/html
 * only, at most 3 redirects. The resolver and the connector are injected, so nothing here touches the network except
 * the body-cap test, which serves bytes from a local server to the raw connector (the guard would refuse 127.0.0.1).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fetchLinkPreview,
  isBlockedAddress,
  nodePinnedRequest,
  parseOpenGraph,
  type PreviewDeps,
  type PreviewResponse,
} from '../src/ustaad/link-preview';

const html = (head: string): PreviewResponse => ({
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body: Buffer.from(`<html><head>${head}</head><body>x</body></html>`),
});

function deps(
  dns: Record<string, string[]>,
  pages: Record<string, PreviewResponse>,
  calls: { url: string; address: string }[] = [],
): PreviewDeps {
  return {
    resolve: (host) =>
      Promise.resolve(
        (dns[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
      ),
    request: ({ url, address }) => {
      calls.push({ url: url.href, address });
      const page = pages[url.href];
      return page ? Promise.resolve(page) : Promise.reject(new Error('no page'));
    },
    timeoutMs: 200,
  };
}

describe('address guard', () => {
  it('refuses private, loopback, link-local, metadata, CGNAT, ULA, multicast and IPv4-mapped IPv6', () => {
    for (const a of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.5.4',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::1',
      'not-an-ip',
    ])
      expect(isBlockedAddress(a), a).toBe(true);
    for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])
      expect(isBlockedAddress(a), a).toBe(false);
  });
});

describe('AT-SSRF-1', () => {
  it('the metadata IP, private ranges and a rebinding name (one private answer) are blocked before any request', async () => {
    const calls: { url: string; address: string }[] = [];
    const d = deps(
      {
        'meta.example.com': ['169.254.169.254'],
        'lan.example.com': ['10.0.0.1'],
        'mapped.example.com': ['::ffff:127.0.0.1'],
        'rebind.example.com': ['93.184.216.34', '127.0.0.1'],
        'nothing.example.com': [],
      },
      {},
      calls,
    );
    for (const host of ['meta', 'lan', 'mapped', 'rebind', 'nothing'])
      expect((await fetchLinkPreview(`https://${host}.example.com/`, d)).status, host).toBe('blocked');
    expect(calls).toHaveLength(0);
  });

  it('IP literals in any form (hex, decimal, bracketed IPv6) and localhost are refused', async () => {
    const d = deps({}, {});
    for (const url of [
      'http://0x7f000001/',
      'http://2130706433/',
      'http://[::ffff:127.0.0.1]/',
      'http://localhost/',
      'http://127.0.0.1/',
      'https://169.254.169.254/latest/meta-data/',
    ])
      expect((await fetchLinkPreview(url, d)).status, url).toBe('blocked');
  });

  it('connects to the checked address and re-checks every redirect (redirect to localhost → blocked)', async () => {
    const calls: { url: string; address: string }[] = [];
    const d = deps(
      { 'good.example.com': ['93.184.216.34'], 'evil.example.com': ['127.0.0.1'] },
      {
        'https://good.example.com/a': {
          status: 302,
          headers: { location: 'http://localhost/admin' },
          body: Buffer.alloc(0),
        },
        'https://good.example.com/b': {
          status: 301,
          headers: { location: 'https://evil.example.com/' },
          body: Buffer.alloc(0),
        },
      },
      calls,
    );
    expect((await fetchLinkPreview('https://good.example.com/a', d)).status).toBe('blocked');
    expect((await fetchLinkPreview('https://good.example.com/b', d)).status).toBe('blocked');
    expect(calls.every((c) => c.address === '93.184.216.34')).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(['https://good.example.com/a', 'https://good.example.com/b']);
  });

  it('at most 3 redirects', async () => {
    const hop = (to: string): PreviewResponse => ({
      status: 302,
      headers: { location: to },
      body: Buffer.alloc(0),
    });
    const d = deps(
      { 'r.example.com': ['93.184.216.34'] },
      {
        'https://r.example.com/1': hop('/2'),
        'https://r.example.com/2': hop('/3'),
        'https://r.example.com/3': hop('/4'),
        'https://r.example.com/4': hop('/5'),
        'https://r.example.com/5': html('<title>end</title>'),
      },
    );
    expect((await fetchLinkPreview('https://r.example.com/1', d)).status).toBe('failed');
    expect((await fetchLinkPreview('https://r.example.com/2', d)).status).toBe('ok');
  });
});

describe('AT-SSRF-2 and parsing', () => {
  it('a request that never answers fails at the total timeout', async () => {
    const d: PreviewDeps = {
      resolve: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
      request: () => new Promise(() => undefined),
      timeoutMs: 50,
    };
    const started = Date.now();
    expect((await fetchLinkPreview('https://slow.example.com/', d)).status).toBe('failed');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('keeps og:title and og:description (entities decoded, whitespace folded); falls back to <title>', async () => {
    const d = deps(
      { 'news.example.com': ['93.184.216.34'] },
      {
        'https://news.example.com/x': html(
          '<meta property="og:title" content="Brake  &amp; clutch\n guide"><meta content="How to bleed &quot;DOT 3&quot;" property="og:description"><meta property="og:image" content="http://10.0.0.1/a.png">',
        ),
        'https://news.example.com/y': html('<title> Plain title </title>'),
        'https://news.example.com/pdf': {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
          body: Buffer.from('%PDF'),
        },
      },
    );
    expect(await fetchLinkPreview('https://news.example.com/x', d)).toEqual({
      status: 'ok',
      finalHost: 'example.com',
      title: 'Brake & clutch guide',
      description: 'How to bleed "DOT 3"',
    });
    expect((await fetchLinkPreview('https://news.example.com/y', d)).title).toBe('Plain title');
    expect((await fetchLinkPreview('https://news.example.com/pdf', d)).status).toBe('failed');
    // Plain text out: markup stays text (the website renders it as text, SR-26).
    expect(parseOpenGraph('<meta name="og:title" content="&lt;b&gt;x&lt;/b&gt;">').title).toBe('<b>x</b>');
  });
});

describe('the pinned connector (local server)', () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'x-host': req.headers.host ?? '' });
      res.end(Buffer.alloc(1024 * 1024, 0x61));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => {
      server.close(() => {
        r();
      });
    });
  });

  it('connects to the given address (not a new lookup), sends the original Host and cuts the body at 512 KB', async () => {
    const ctrl = new AbortController();
    const res = await nodePinnedRequest({
      url: new URL(`http://unresolvable.invalid:${port}/page`),
      address: '127.0.0.1',
      family: 4,
      signal: ctrl.signal,
      maxBytes: 512 * 1024,
    });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(512 * 1024);
    expect(res.headers['x-host']).toBe(`unresolvable.invalid:${port}`);
  });
});
