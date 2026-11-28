import { sql } from 'drizzle-orm';
import type { Tx } from './orders';
import { num, rowsOf } from './sql-rows';

export interface NearPincode {
  pincode: string;
  area: string | null;
  distanceM: number;
}

/**
 * The nearest active PIN centroids of live cities to a point, nearest first, within `maxM` metres (PostGIS KNN
 * `<->` on the GIST index `pincodes_centroid_gix`, `ST_DWithin` as the bound). A shortlist, never an answer: PIN
 * areas are irregular, so the nearest post office is often not the person's PIN (spec 06 "Use my location";
 * Sarona 2026-11-28). An empty list means the point is outside every live city's PINs. Names come in the requested
 * language (Hindi falls back to English). Read-only; no actor (public reference data).
 */
export async function findNearestPincodes(
  db: Tx,
  input: { lat: number; lng: number; locale: 'en' | 'hi'; limit: number; maxM: number },
): Promise<NearPincode[]> {
  const point = sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography`;
  const rows = rowsOf<{
    pincode: string;
    locality: string | null;
    locality_hi: string | null;
    distance_m: unknown;
  }>(
    await db.execute(sql`
      select p.pincode, p.locality, p.locality_hi, ST_Distance(p.centroid, ${point}) as distance_m
      from pincodes p
      join cities c on c.id = p.city_id and c.status = 'live'
      where p.active and p.centroid is not null and ST_DWithin(p.centroid, ${point}, ${input.maxM})
      order by p.centroid <-> ${point}, p.pincode
      limit ${input.limit}`),
  );
  return rows.map((r) => ({
    pincode: r.pincode,
    area: input.locale === 'hi' ? (r.locality_hi ?? r.locality) : r.locality,
    distanceM: Math.round(num(r.distance_m)),
  }));
}
