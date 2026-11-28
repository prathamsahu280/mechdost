/**
 * "Where you're signed in" (spec 01 § Devices, decision 2026-11-28). One row per password sign-in; the device list
 * shows what the browser said it was (kind, browser, OS as short codes, never the raw User-Agent) and a rough place
 * from an offline IP lookup done once at sign-in. The IP address itself is never stored.
 */
import { z } from 'zod';

/** Custom-claim name carrying the session key in the Firebase token (not a reserved Firebase claim). */
export const SESSION_CLAIM = 'mds';

export const DEVICE_KINDS = ['mobile', 'tablet', 'desktop', 'other'] as const;
export const DEVICE_BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'samsung', 'opera', 'other'] as const;
export const DEVICE_OSES = ['android', 'ios', 'windows', 'macos', 'linux', 'other'] as const;
/** Why a session ended (ML-ready code, never free text). */
export const SESSION_REVOKE_REASONS = [
  'self_device',
  'self_others',
  'self_all',
  'staff_role_removed',
  'password_changed',
] as const;

export type DeviceKind = (typeof DEVICE_KINDS)[number];
export type DeviceBrowser = (typeof DEVICE_BROWSERS)[number];
export type DeviceOs = (typeof DEVICE_OSES)[number];
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

/** The list never shows more than this many active sign-ins (newest activity first). */
export const DEVICE_LIST_CAP = 50;
/** `last_active_at` is refreshed at most this often per session (conditional update). */
export const DEVICE_ACTIVE_REFRESH_MS = 60 * 60 * 1000;

export interface ParsedUserAgent {
  deviceKind: DeviceKind;
  browser: DeviceBrowser;
  os: DeviceOs;
}

/**
 * Dependency-free User-Agent reading into the three enums. Order matters: Edge, Opera and Samsung Internet all say
 * "Chrome" too, and Chrome says "Safari". Anything unrecognised is `other`.
 */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const s = (ua ?? '').slice(0, 512);
  const browser: DeviceBrowser = /\b(Edg|EdgA|EdgiOS|Edge)\//.test(s)
    ? 'edge'
    : /\b(OPR|OPT|Opera)\b/.test(s)
      ? 'opera'
      : s.includes('SamsungBrowser/')
        ? 'samsung'
        : /\b(Firefox|FxiOS)\//.test(s)
          ? 'firefox'
          : /\b(Chrome|CriOS|Chromium)\//.test(s)
            ? 'chrome'
            : s.includes('Safari/') && s.includes('Version/')
              ? 'safari'
              : 'other';
  const os: DeviceOs = /\b(iPhone|iPad|iPod)\b/.test(s)
    ? 'ios'
    : s.includes('Android')
      ? 'android'
      : s.includes('Windows')
        ? 'windows'
        : /Macintosh|Mac OS X/.test(s)
          ? 'macos'
          : /Linux|X11|CrOS/.test(s)
            ? 'linux'
            : 'other';
  const deviceKind: DeviceKind =
    /iPad|Tablet/.test(s) || (os === 'android' && !s.includes('Mobile'))
      ? 'tablet'
      : /iPhone|iPod|Mobile/.test(s)
        ? 'mobile'
        : os === 'windows' || os === 'macos' || os === 'linux'
          ? 'desktop'
          : 'other';
  return { deviceKind, browser, os };
}

/** Normalise a place name for table lookups: lower case, no accents or punctuation. */
const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * English state / union territory names as the IP database spells them (several spellings each) → the GST state
 * code, whose Hindi name already lives in the locale files (`gstStates.<code>`, rule 10). Unknown names → null.
 */
const STATE_ALIASES: Record<string, readonly string[]> = {
  '01': ['Jammu and Kashmir', 'Jammu & Kashmir'],
  '02': ['Himachal Pradesh'],
  '03': ['Punjab'],
  '04': ['Chandigarh'],
  '05': ['Uttarakhand', 'Uttaranchal'],
  '06': ['Haryana'],
  '07': ['Delhi', 'National Capital Territory of Delhi', 'NCT of Delhi', 'New Delhi'],
  '08': ['Rajasthan'],
  '09': ['Uttar Pradesh'],
  '10': ['Bihar'],
  '11': ['Sikkim'],
  '12': ['Arunachal Pradesh'],
  '13': ['Nagaland'],
  '14': ['Manipur'],
  '15': ['Mizoram'],
  '16': ['Tripura'],
  '17': ['Meghalaya'],
  '18': ['Assam'],
  '19': ['West Bengal'],
  '20': ['Jharkhand'],
  '21': ['Odisha', 'Orissa'],
  '22': ['Chhattisgarh', 'Chattisgarh'],
  '23': ['Madhya Pradesh'],
  '24': ['Gujarat'],
  '26': [
    'Dadra and Nagar Haveli and Daman and Diu',
    'Dadra and Nagar Haveli',
    'Daman and Diu',
    'Daman & Diu',
  ],
  '27': ['Maharashtra'],
  '29': ['Karnataka'],
  '30': ['Goa'],
  '31': ['Lakshadweep'],
  '32': ['Kerala'],
  '33': ['Tamil Nadu'],
  '34': ['Puducherry', 'Pondicherry'],
  '35': ['Andaman and Nicobar Islands', 'Andaman and Nicobar', 'Andaman & Nicobar Islands'],
  '36': ['Telangana'],
  '37': ['Andhra Pradesh'],
  '38': ['Ladakh'],
};

const STATE_CODE_BY_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(STATE_ALIASES).flatMap(([code, names]) => names.map((n) => [norm(n), code] as const)),
);

/** GST code of an English state name from the IP database, or null when it is not an Indian state / UT. */
export function gstStateCodeOf(region: string | null | undefined): string | null {
  return region ? (STATE_CODE_BY_NAME.get(norm(region)) ?? null) : null;
}

/** Key a city name is matched on (against the cities table's English name). */
export const cityMatchKey = norm;

/** The rough place as stored (English) plus what the API adds for Hindi (rule 10). */
export const DevicePlaceDto = z
  .object({
    region: z.string().nullable(),
    /** GST state code when the region is an Indian state / UT: `gstStates.<code>` has the Hindi name. */
    gstStateCode: z.string().nullable(),
    city: z.string().nullable(),
    /** Hindi city name only when the city matches one the platform already knows (cities table), else null. */
    cityHi: z.string().nullable(),
  })
  .strict();

export const DeviceDto = z
  .object({
    id: z.uuid(),
    deviceKind: z.enum(DEVICE_KINDS),
    browser: z.enum(DEVICE_BROWSERS),
    os: z.enum(DEVICE_OSES),
    place: DevicePlaceDto.nullable(),
    createdAt: z.string(),
    lastActiveAt: z.string(),
    current: z.boolean(),
  })
  .strict();
export type DeviceView = z.infer<typeof DeviceDto>;
export type DevicePlace = z.infer<typeof DevicePlaceDto>;

export const DevicesDto = z.object({ devices: z.array(DeviceDto), cap: z.number().int() }).strict();
export type DevicesView = z.infer<typeof DevicesDto>;

export const DevicesSignedOutDto = z.object({ signedOut: z.number().int().min(0) }).strict();

/**
 * The place as text without the "Near" wording: "Raipur, Chhattisgarh". English uses the stored names; Hindi uses the
 * state's Hindi name (`stateNames` = the `gstStates` messages) and the city only when a Hindi name is known; an
 * English city is never shown on /hi. State only when there is no usable city; null when nothing is usable.
 */
export function devicePlaceText(
  locale: 'en' | 'hi',
  place: DevicePlace | null,
  stateNames: Readonly<Record<string, string>>,
): string | null {
  if (!place) return null;
  const state =
    locale === 'hi' ? (place.gstStateCode ? (stateNames[place.gstStateCode] ?? null) : null) : place.region;
  const city = locale === 'hi' ? place.cityHi : place.city;
  const parts = [city, state].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(', ') : null;
}
