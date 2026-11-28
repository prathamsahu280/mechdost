/**
 * "Use my location" → PIN code (spec 06; decisions 2026-11-28 "Use my location never guesses a PIN").
 *
 * Third-party reverse geocoders are wrong for Indian PINs (OpenStreetMap says 493332 for almost all of Raipur) and
 * PIN areas are irregular, so even the nearest MechDost PIN centroid is not safe to auto-fill (Sarona: real PIN
 * 492099, nearest centroid 492013). Inside a served area we therefore return a shortlist of the nearest MechDost
 * PINs for the person to pick from, and fill a PIN only when an authoritative provider (Ola Maps or Google, pending
 * Q12-B) names one of those active PINs. Outside served areas the provider's answer is the fallback (editable).
 */
export interface GeocodeHit {
  pincode: string | null;
  area: string | null;
}

/** One reverse-geocoding provider. Plug-in point for Q12-B: add an implementation and select it by env key. */
export interface ReverseGeocoder {
  id: 'osm';
  /** True only for a provider whose PINs are exact (Ola Maps, Google); OpenStreetMap's are not. */
  authoritative: boolean;
  reverse(lat: number, lng: number): Promise<GeocodeHit>;
}

export interface NearPin {
  pincode: string;
  area: string | null;
  distanceM: number;
}

export interface NearestPins {
  served: boolean;
  nearest: NearPin[];
}

export interface PincodeAnswer extends GeocodeHit {
  /** The nearest MechDost PINs to pick from (empty outside served areas, or when `pincode` is certain). */
  candidates: { pincode: string; area: string | null }[];
}

/** How many choices the person sees. */
export const CANDIDATES_SHOWN = 5;
/** How many the API is asked for, so an authoritative provider's PIN can be matched beyond the ones shown. */
export const CANDIDATES_FETCHED = 10;

export async function resolvePincode(
  at: { lat: number; lng: number },
  deps: { nearest: () => Promise<NearestPins>; geocoder: ReverseGeocoder },
): Promise<PincodeAnswer> {
  const { served, nearest } = await deps.nearest();
  if (!served || nearest.length === 0) {
    const hit = await deps.geocoder.reverse(at.lat, at.lng);
    return { ...hit, candidates: [] };
  }
  if (deps.geocoder.authoritative) {
    const hit = await deps.geocoder.reverse(at.lat, at.lng);
    const match = nearest.find((p) => p.pincode === hit.pincode);
    if (match) return { pincode: match.pincode, area: match.area, candidates: [] };
  }
  return {
    pincode: null,
    area: null,
    candidates: nearest.slice(0, CANDIDATES_SHOWN).map(({ pincode, area }) => ({ pincode, area })),
  };
}
