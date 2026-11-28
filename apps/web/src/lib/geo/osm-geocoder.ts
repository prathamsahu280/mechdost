import { NOMINATIM_HEADERS, upstreamSlot } from './nominatim-server';
import {
  CANDIDATES_FETCHED,
  type GeocodeHit,
  type NearestPins,
  type ReverseGeocoder,
} from './reverse-geocode';

interface NominatimReply {
  address?: {
    postcode?: string;
    suburb?: string;
    neighbourhood?: string;
    city_district?: string;
    city?: string;
  };
}

/**
 * OpenStreetMap Nominatim, called from our server (visitors' IPs never reach it), one request per second across
 * this instance (usage policy). Its Indian postcodes are often wrong, so it is not authoritative.
 */
export const osmGeocoder: ReverseGeocoder = {
  id: 'osm',
  authoritative: false,
  async reverse(lat: number, lng: number): Promise<GeocodeHit> {
    await upstreamSlot();
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${String(lat)}&lon=${String(lng)}`;
    const res = await fetch(url, {
      headers: NOMINATIM_HEADERS,
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
  },
};

/**
 * The provider in use. Q12-B (Ola Maps or Google, needs a founder key) plugs in here by env key without UI
 * changes; no key exists yet, so it is OpenStreetMap.
 */
export function selectGeocoder(): ReverseGeocoder {
  return osmGeocoder;
}

/** MechDost's own nearest PINs from the API (`GET /v1/geo/pincode-near`); not served when no API is configured. */
export async function fetchNearestPins(
  at: { lat: number; lng: number },
  locale: 'en' | 'hi',
): Promise<NearestPins> {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!base) return { served: false, nearest: [] };
  const qs = `lat=${String(at.lat)}&lng=${String(at.lng)}&locale=${locale}&limit=${String(CANDIDATES_FETCHED)}`;
  const res = await fetch(`${base}/v1/geo/pincode-near?${qs}`, {
    signal: AbortSignal.timeout(4000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`api ${String(res.status)}`);
  return (await res.json()) as NearestPins;
}
