import {
  DEVANAGARI_RE,
  FREE_DELIVERY_MAX_PAISE,
  INDIA_BOUNDS,
  isPincode,
  PINCODE_AREA_MAX,
  PINCODE_AREA_MIN,
} from '@mechdost/shared/geo';
import type { AdminPincodeDto } from '@mechdost/shared/geo-api';
import { parseRupees } from './money-input';

/**
 * Pure helpers for Admin → Settings → Service area (spec 15 "PIN codes"; real sign-in builds): read what staff type
 * (₹ amounts, coordinates, Devanagari digits), build the API bodies, and send only the fields that changed (L103).
 */
export interface PincodeForm {
  pincode: string;
  lat: string;
  lng: string;
  areaEn: string;
  areaHi: string;
  /** Rupees; blank = no PIN override (shop, then city setting). */
  freeDelivery: string;
}

export type PincodeField = keyof PincodeForm;

const DEVANAGARI_DIGIT = /[०-९]/g;
const latin = (v: string) => v.replace(DEVANAGARI_DIGIT, (d) => String(d.charCodeAt(0) - 0x0966));
const DECIMAL = /^-?\d{1,3}(?:\.\d{1,7})?$/;

/** A latitude or longitude inside India's box, else null. */
export function parseCoordinate(raw: string, kind: 'lat' | 'lng'): number | null {
  const v = latin(raw.trim());
  if (!DECIMAL.test(v)) return null;
  const n = Number(v);
  const [min, max] =
    kind === 'lat' ? [INDIA_BOUNDS.minLat, INDIA_BOUNDS.maxLat] : [INDIA_BOUNDS.minLng, INDIA_BOUNDS.maxLng];
  return n >= min && n <= max ? n : null;
}

/** Blank = no override (null); ₹0 = always free; otherwise integer paise up to ₹1,00,000. */
export function parseFreeDelivery(raw: string): { ok: true; paise: number | null } | { ok: false } {
  if (raw.trim() === '') return { ok: true, paise: null };
  const r = parseRupees(raw, { allowZero: true });
  return r.ok && r.paise <= FREE_DELIVERY_MAX_PAISE ? { ok: true, paise: r.paise } : { ok: false };
}

const areaOk = (v: string) => v.length >= PINCODE_AREA_MIN && v.length <= PINCODE_AREA_MAX;

type Parsed =
  | { ok: true; lat: number; lng: number; en: string; hi: string; freeMin: number | null }
  | { ok: false; field: PincodeField };

function parseForm(f: PincodeForm): Parsed {
  const lat = parseCoordinate(f.lat, 'lat');
  if (lat === null) return { ok: false, field: 'lat' };
  const lng = parseCoordinate(f.lng, 'lng');
  if (lng === null) return { ok: false, field: 'lng' };
  const en = f.areaEn.trim();
  if (!areaOk(en)) return { ok: false, field: 'areaEn' };
  const hi = f.areaHi.trim();
  if (!areaOk(hi) || !DEVANAGARI_RE.test(hi)) return { ok: false, field: 'areaHi' };
  const free = parseFreeDelivery(f.freeDelivery);
  if (!free.ok) return { ok: false, field: 'freeDelivery' };
  return { ok: true, lat, lng, en, hi, freeMin: free.paise };
}

export interface PincodeAddBody {
  city: string;
  pincode: string;
  lat: number;
  lng: number;
  areaEn: string;
  areaHi: string;
  freeDeliveryMinPaise: number | null;
}

export function pincodeAddBody(
  city: string,
  f: PincodeForm,
): { ok: true; body: PincodeAddBody } | { ok: false; field: PincodeField } {
  const pincode = latin(f.pincode.trim());
  if (!isPincode(pincode)) return { ok: false, field: 'pincode' };
  const p = parseForm(f);
  if (!p.ok) return p;
  return {
    ok: true,
    body: {
      city,
      pincode,
      lat: p.lat,
      lng: p.lng,
      areaEn: p.en,
      areaHi: p.hi,
      freeDeliveryMinPaise: p.freeMin,
    },
  };
}

export interface PincodeEditBody {
  city: string;
  version: number;
  centroid?: { lat: number; lng: number };
  area?: { en: string; hi: string };
  freeDeliveryMinPaise?: number | null;
}

/** Only the changed fields (null body = nothing to save). */
export function pincodeEditBody(
  city: string,
  row: AdminPincodeDto,
  f: PincodeForm,
): { ok: true; body: PincodeEditBody | null } | { ok: false; field: PincodeField } {
  const p = parseForm(f);
  if (!p.ok) return p;
  const body: PincodeEditBody = { city, version: row.version };
  if (p.lat !== row.lat || p.lng !== row.lng) body.centroid = { lat: p.lat, lng: p.lng };
  if (p.en !== row.areaEn || p.hi !== row.areaHi) body.area = { en: p.en, hi: p.hi };
  if (p.freeMin !== row.freeDeliveryMinPaise) body.freeDeliveryMinPaise = p.freeMin;
  const changed = body.centroid !== undefined || body.area !== undefined || 'freeDeliveryMinPaise' in body;
  return { ok: true, body: changed ? body : null };
}

/** The form as it starts for an existing row. */
export function formFromRow(row: AdminPincodeDto): PincodeForm {
  return {
    pincode: row.pincode,
    lat: row.lat === null ? '' : String(row.lat),
    lng: row.lng === null ? '' : String(row.lng),
    areaEn: row.areaEn ?? '',
    areaHi: row.areaHi ?? '',
    freeDelivery: row.freeDeliveryMinPaise === null ? '' : String(row.freeDeliveryMinPaise / 100),
  };
}

export const EMPTY_PINCODE_FORM: PincodeForm = {
  pincode: '',
  lat: '',
  lng: '',
  areaEn: '',
  areaHi: '',
  freeDelivery: '',
};

/** PIN or area name (either language), case-insensitive. */
export function filterPincodes<T extends Pick<AdminPincodeDto, 'pincode' | 'areaEn' | 'areaHi'>>(
  rows: readonly T[],
  query: string,
): T[] {
  const q = latin(query.trim()).toLowerCase();
  if (q === '') return [...rows];
  return rows.filter(
    (r) =>
      r.pincode.includes(q) || (r.areaEn ?? '').toLowerCase().includes(q) || (r.areaHi ?? '').includes(q),
  );
}
