/**
 * Post-deploy warm-up (spec 16 "Budget incident 2026-11-22 cold renders"). A deploy replaces the web container, and
 * the page cache (ISR) lives inside it, so the first visit to every shop and product page after a deploy is a full
 * render (API calls + React render on a small server). This script visits the public catalogue pages once, slowly,
 * so customers and crawlers meet warm pages. Paced on purpose: the API allows 240 catalogue requests a minute per
 * address, and a product page makes about three uncached ones, so one page a second stays well under it.
 *
 *   node apps/web/scripts/warm-cache.mjs [https://mechdost.com] [--max-seconds 600] [--gap-ms 1000]
 *
 * GET only, never writes anything. Exits 0 even when pages fail (a warm-up is never a reason to fail a deploy);
 * the summary line shows how many answered 200.
 */
import { pathToFileURL } from 'node:url';

/** The page URLs listed in a sitemap, shop pages first so the busiest pages are warm earliest. */
export function warmUrls(xml, origin) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const host = new URL(origin).host;
  const sameHost = [...new Set(locs)].filter((u) => {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  });
  const rank = (u) => {
    const path = new URL(u).pathname.replace(/^\/hi(?=\/|$)/, '');
    if (path === '/' || path === '') return 0;
    if (path === '/shop') return 1;
    if (path.startsWith('/shop/')) return 3;
    return 2;
  };
  return sameHost.sort((a, b) => rank(a) - rank(b));
}

/** Milliseconds to wait before starting the next request so that `gapMs` passes between starts. */
export function waitBeforeNext(startedAt, now, gapMs) {
  return Math.max(0, startedAt + gapMs - now);
}

async function main() {
  const args = process.argv.slice(2);
  const origin = (args.find((a) => a.startsWith('http')) ?? 'https://mechdost.com').replace(/\/$/, '');
  const num = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && Number(args[i + 1]) > 0 ? Number(args[i + 1]) : fallback;
  };
  const maxMs = num('--max-seconds', 600) * 1000;
  const gapMs = num('--gap-ms', 1000);
  const t0 = Date.now();

  const res = await fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    console.log(`warm-up skipped: sitemap answered ${String(res.status)}`);
    return;
  }
  const urls = warmUrls(await res.text(), origin);
  let ok = 0;
  let failed = 0;
  for (const url of urls) {
    if (Date.now() - t0 > maxMs) break;
    const started = Date.now();
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { 'user-agent': 'mechdost-warmup' },
      });
      await r.arrayBuffer();
      if (r.ok) ok += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
    const wait = waitBeforeNext(started, Date.now(), gapMs);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  console.log(
    `warm-up: ${String(ok)} ok, ${String(failed)} failed of ${String(urls.length)} pages in ${String(
      Math.round((Date.now() - t0) / 1000),
    )} s`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.log(`warm-up stopped: ${e instanceof Error ? e.message : String(e)}`);
  });
}
