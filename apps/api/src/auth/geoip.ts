import { isIP } from 'node:net';
import { open, type CityResponse } from 'maxmind';
import type { SessionPlace } from '@mechdost/db/repo';
import { log, safeError } from '../logger';

/**
 * Rough place of a client address for the device list (decision 2026-11-28): "Near Raipur, Chhattisgarh". An offline
 * lookup in the DB-IP City Lite file (CC BY 4.0, attribution shown on the device list), read in memory at sign-in
 * only. The address is never stored or logged; only the place names are. Indian mobile networks share gateways, so
 * the city can be wrong by hundreds of km and the screen says "near" and "approximate".
 */
export interface GeoIpLookup {
  /** The place for an IP address, or null (private address, no match, unreadable record). Never throws. */
  lookup(ip: string): SessionPlace | null;
}

const MAX_NAME = 80;
const clean = (v: string | undefined) => {
  const s = v
    ?.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME);
  return s ? s : null;
};

/** Reads one record into the stored shape; exported for tests that use a fake reader. */
export function placeOf(record: CityResponse | null): SessionPlace | null {
  if (!record) return null;
  const iso = record.country?.iso_code;
  const countryCode = typeof iso === 'string' && /^[A-Z]{2}$/.test(iso) ? iso : null;
  const region = clean(record.subdivisions?.[0]?.names.en);
  const city = clean(record.city?.names.en);
  return countryCode || region || city ? { countryCode, region, city } : null;
}

export function geoIpFromReader(reader: { get(ip: string): CityResponse | null }): GeoIpLookup {
  return {
    lookup(ip) {
      if (!isIP(ip)) return null;
      try {
        return placeOf(reader.get(ip));
      } catch {
        return null;
      }
    },
  };
}

/**
 * Opens the .mmdb at `path` (the file is replaced monthly; the reader reloads it without a restart). A missing or
 * unreadable file is logged once and answers null: sign-in and everything else work without places.
 */
export async function openGeoIp(path: string | null): Promise<GeoIpLookup | null> {
  if (!path) return null;
  try {
    const reader = await open<CityResponse>(path, { watchForUpdatesNonPersistent: true });
    log('info', 'geoip_ready', { path });
    return geoIpFromReader(reader);
  } catch (err) {
    log('warn', 'geoip_unavailable', safeError(err));
    return null;
  }
}
