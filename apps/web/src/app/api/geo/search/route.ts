/**
 * Address search for the seller location picker (plan 2026-11-13 Task 6). Runs only when the seller presses
 * Search, never as they type (Nominatim usage policy), limited to India, five results, cached for a day, rate
 * limited per client. Returns labels and coordinates only; the seller then drags the pin to the exact spot.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  boundedSet,
  clientKey,
  createLimiter,
  NOMINATIM_HEADERS,
  upstreamSlot,
} from '@/lib/geo/nominatim-server';

export const dynamic = 'force-dynamic';

interface SearchResult {
  label: string;
  lat: number;
  lng: number;
}

const CACHE_MS = 24 * 3600_000;
const cache = new Map<string, { at: number; results: SearchResult[] }>();
const limited = createLimiter(10);

interface NominatimPlace {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
}

function toResult(p: NominatimPlace): SearchResult | null {
  const lat = Number(p.lat);
  const lng = Number(p.lon);
  if (typeof p.display_name !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 6 || lat > 37.5 || lng < 68 || lng > 97.5) return null;
  return { label: p.display_name.slice(0, 160), lat, lng };
}

export async function GET(req: NextRequest) {
  const client = clientKey(req);
  if (client === null) {
    console.error('geo_search_misconfigured: set VERCEL or TRUSTED_PROXY_HOPS');
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  if (limited(client)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '60' } });
  }
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().replace(/\s+/g, ' ');
  if (q.length < 3 || q.length > 120) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const key = q.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(
      { results: cached.results },
      { headers: { 'cache-control': 'private, max-age=3600' } },
    );
  }
  try {
    await upstreamSlot();
    const params = new URLSearchParams({ format: 'jsonv2', q, countrycodes: 'in', limit: '5' });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: NOMINATIM_HEADERS,
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`upstream ${String(res.status)}`);
    const body = (await res.json()) as unknown;
    const results = (Array.isArray(body) ? (body as NominatimPlace[]) : [])
      .map(toResult)
      .filter((r): r is SearchResult => r !== null);
    boundedSet(cache, key, { at: Date.now(), results }, 5000);
    return NextResponse.json({ results }, { headers: { 'cache-control': 'private, max-age=3600' } });
  } catch {
    return NextResponse.json({ results: [] }, { status: 502 });
  }
}
