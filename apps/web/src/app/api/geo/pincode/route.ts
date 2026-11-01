/**
 * "Use my location" → PIN code (user 2026-11-02). Reverse geocoding until the provider bake-off picks one
 * (pending decision #7, inbox Q12): OpenStreetMap Nominatim, called from our server so the user's IP never reaches
 * a third party, with coordinates rounded to ~100 m (data minimisation), an identifying User-Agent and at most one
 * upstream request per second (Nominatim usage policy), results cached for a day. Production swaps this file's
 * `lookup` for the chosen provider behind the same response shape. Rate limited per client (hard rule 4).
 */
import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

interface PincodeResponse {
  pincode: string | null;
  /** Locality for display ("Sarona"), never the full address. */
  area: string | null;
}

const INDIA = { minLat: 6, maxLat: 37.5, minLng: 68, maxLng: 97.5 };
const CACHE_MS = 24 * 3600_000;
const cache = new Map<string, { at: number; value: PincodeResponse }>();
const hits = new Map<string, { windowStart: number; count: number }>();
const LIMIT = 10; // per client per minute
let lastUpstream = 0;

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded && forwarded.length > 0 ? forwarded : 'local';
}

function limited(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.windowStart > 60_000) {
    hits.set(key, { windowStart: now, count: 1 });
    if (hits.size > 10_000) hits.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > LIMIT;
}

function parseCoord(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^-?\d{1,3}(\.\d{1,8})?$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? Math.round(n * 1000) / 1000 : null;
}

interface NominatimReply {
  address?: {
    postcode?: string;
    suburb?: string;
    neighbourhood?: string;
    city_district?: string;
    city?: string;
  };
}

async function lookup(lat: number, lng: number): Promise<PincodeResponse> {
  // One request per second across this server instance (Nominatim policy).
  const wait = lastUpstream + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastUpstream = Date.now();
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'MechDost/1.0 (+https://mechdost.com)', 'accept-language': 'en' },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`upstream ${String(res.status)}`);
  const body = (await res.json()) as NominatimReply;
  const raw = body.address?.postcode?.replace(/\s/g, '') ?? '';
  const a = body.address;
  return {
    pincode: /^[1-9][0-9]{5}$/.test(raw) ? raw : null,
    area: a?.suburb ?? a?.neighbourhood ?? a?.city_district ?? a?.city ?? null,
  };
}

export async function GET(req: NextRequest) {
  if (limited(clientKey(req))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '60' } });
  }
  const lat = parseCoord(req.nextUrl.searchParams.get('lat'), INDIA.minLat, INDIA.maxLat);
  const lng = parseCoord(req.nextUrl.searchParams.get('lng'), INDIA.minLng, INDIA.maxLng);
  if (lat === null || lng === null) {
    return NextResponse.json({ error: 'invalid_location' }, { status: 400 });
  }
  const key = `${String(lat)},${String(lng)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.value, { headers: { 'cache-control': 'private, max-age=3600' } });
  }
  try {
    const value = await lookup(lat, lng);
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 5000) cache.clear();
    return NextResponse.json(value, { headers: { 'cache-control': 'private, max-age=3600' } });
  } catch {
    return NextResponse.json({ pincode: null, area: null } satisfies PincodeResponse, { status: 502 });
  }
}
