/**
 * Shared server plumbing for the OpenStreetMap Nominatim routes (`/api/geo/pincode`, `/api/geo/search`) until the
 * provider bake-off picks one (pending #7, Q12). Nominatim policy: at most one request per second, a real
 * User-Agent, results cached, and no search-as-you-type. Our server calls it, so visitors' IPs never reach it.
 */
import type { NextRequest } from 'next/server';

export const NOMINATIM_HEADERS = {
  'user-agent': 'MechDost/1.0 (+https://mechdost.com)',
  'accept-language': 'en',
};

/**
 * Client identity for rate limits, the same way the API does it (security review 2026-11-02): the leftmost
 * X-Forwarded-For entry is whatever the client sent, so count `TRUSTED_PROXY_HOPS` back from the right (entries
 * appended by our own proxies). Vercel's `x-real-ip` is set by the platform and cannot be spoofed.
 */
export function clientKey(req: NextRequest): string | null {
  const platform = process.env.VERCEL ? req.headers.get('x-real-ip') : null;
  if (platform) return platform;
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? '0');
  if (Number.isInteger(hops) && hops > 0) {
    const chain = (req.headers.get('x-forwarded-for') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return chain[chain.length - hops] ?? 'unknown';
  }
  // Route handlers cannot see the socket address. Without a trusted source every visitor would share one bucket
  // (one user could exhaust it for all), so production refuses to serve rather than fail open or shared.
  // The one exception is a direct local connection (the demo on this machine): no proxy header at all and a
  // loopback host. Any real deployment sits behind a proxy that adds X-Forwarded-For, so it still fails closed.
  const direct =
    !req.headers.has('x-forwarded-for') && ['localhost', '127.0.0.1', '[::1]'].includes(req.nextUrl.hostname);
  return process.env.NODE_ENV !== 'production' || direct ? 'local' : null;
}

/** Bounded map: evict the oldest entries one by one (a full clear would reset every limit at once). */
export function boundedSet<V>(map: Map<string, V>, key: string, value: V, max: number) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** Fixed-window limiter per client key (one per route). */
export function createLimiter(limitPerMinute: number) {
  const hits = new Map<string, { windowStart: number; count: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart > 60_000) {
      boundedSet(hits, key, { windowStart: now, count: 1 }, 10_000);
      return false;
    }
    entry.count += 1;
    return entry.count > limitPerMinute;
  };
}

let lastUpstream = 0;

/**
 * Wait for this instance's next upstream slot, one second apart across both routes. The slot is reserved
 * synchronously so parallel requests queue instead of waking together; a request that would wait over 5 s is
 * refused without pushing the queue (security review 2026-11-02).
 */
export async function upstreamSlot(): Promise<void> {
  const slot = Math.max(Date.now(), lastUpstream + 1000);
  const wait = slot - Date.now();
  if (wait > 5000) throw new Error('upstream busy');
  lastUpstream = slot;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
