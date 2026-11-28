/**
 * "Use my location" → PIN code (user 2026-11-02; reworked 2026-11-28 after the Sarona report). Inside a served
 * city this never guesses: it returns the nearest MechDost PINs as choices (`candidates`) and fills `pincode` only
 * when an authoritative provider names one of them; outside served cities it falls back to the reverse geocoder
 * (OpenStreetMap today, pending decision #7 / Q12-B). See `lib/geo/reverse-geocode.ts`. Our server calls upstream,
 * coordinates are rounded to ~100 m (data minimisation), results are cached for a day, rate limited per client.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { boundedSet, clientKey, createLimiter } from '@/lib/geo/nominatim-server';
import { fetchNearestPins, selectGeocoder } from '@/lib/geo/osm-geocoder';
import { resolvePincode, type PincodeAnswer } from '@/lib/geo/reverse-geocode';

export const dynamic = 'force-dynamic';

const INDIA = { minLat: 6, maxLat: 37.5, minLng: 68, maxLng: 97.5 };
const CACHE_MS = 24 * 3600_000;
const cache = new Map<string, { at: number; value: PincodeAnswer }>();
const limited = createLimiter(10); // per client per minute
const EMPTY: PincodeAnswer = { pincode: null, area: null, candidates: [] };

function parseCoord(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^-?\d{1,3}(\.\d{1,8})?$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? Math.round(n * 1000) / 1000 : null;
}

export async function GET(req: NextRequest) {
  const client = clientKey(req);
  if (client === null) {
    console.error('geo_pincode_misconfigured: set VERCEL or TRUSTED_PROXY_HOPS');
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  if (limited(client)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '60' } });
  }
  const lat = parseCoord(req.nextUrl.searchParams.get('lat'), INDIA.minLat, INDIA.maxLat);
  const lng = parseCoord(req.nextUrl.searchParams.get('lng'), INDIA.minLng, INDIA.maxLng);
  if (lat === null || lng === null) {
    return NextResponse.json({ error: 'invalid_location' }, { status: 400 });
  }
  const locale = req.nextUrl.searchParams.get('locale') === 'hi' ? 'hi' : 'en';
  const key = `${String(lat)},${String(lng)},${locale}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.value, { headers: { 'cache-control': 'private, max-age=3600' } });
  }
  try {
    const value = await resolvePincode(
      { lat, lng },
      { nearest: () => fetchNearestPins({ lat, lng }, locale), geocoder: selectGeocoder() },
    );
    boundedSet(cache, key, { at: Date.now(), value }, 5000);
    return NextResponse.json(value, { headers: { 'cache-control': 'private, max-age=3600' } });
  } catch {
    return NextResponse.json(EMPTY, { status: 502 });
  }
}
