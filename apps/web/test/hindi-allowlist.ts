/**
 * The Hindi coverage rule (CLAUDE.md hard rule 10, user 2026-11-02: "it shouldnt happen anywhere … have it
 * properly checked from now on"). On `/hi` nothing user-visible may be in Latin script except the terms below.
 * Shared by `test/content-i18n.test.ts` (data overlays) and `e2e/hindi-coverage.spec.ts` (every rendered page).
 *
 * Keep it TIGHT: add a term only when it is one of these kinds, and say which. Never add a generic English word
 * ("service", "order", "free") to make a page pass — translate the page instead. Documented in
 * docs/design-system.md § Hindi content.
 *
 * Not on the list because the checker ignores them by construction:
 *   - any token containing a digit: codes and part numbers (MD-RPR-2026-…, SR-…, QT-…, PA-…, SKU, GSTIN,
 *     XLTZ4A, 20W40, 6301-2RS, i20, 2W/4W, R15), sizes and units with numbers (900 ml, 12 V, 45 Ah);
 *   - words of one or two letters (ml, kg, km, cc, V, A, EV, AC, UV, mm);
 *   - e-mail addresses and URLs;
 *   - text inside `[data-user-content]` (reviews, chat messages, names, addresses, notes people typed), text
 *     declared in another language with `lang="en"` (language switcher, the admin's English copy fields) and
 *     the map's licence credits (`.maplibregl-ctrl-attrib`, provider-mandated attribution).
 */
import { DEMO_PRODUCTS } from '../src/demo/catalogue';
import { SEEDED_ACCOUNTS } from '../src/demo/session';

/** Our brand and the products/services we name (brand names stay in Latin script). */
// Meta: the company that runs WhatsApp (admin WhatsApp setup copy, decision 2026-11-02).
// Razorpay: the payment partner named in the Terms of Service (2026-11-14).
// Sentry, PostHog: the error-report and analytics providers named in the privacy notice (decision 2026-11-14).
const OUR_BRANDS = ['MechDost', 'WhatsApp', 'Meta', 'Razorpay', 'Sentry', 'PostHog'] as const;

/** Product brands come straight from the catalogue's `brand` field, plus model names used in product names. */
const PRODUCT_BRANDS = [...new Set(DEMO_PRODUCTS.map((p) => p.brand))];
const PRODUCT_MODELS = ['Activ', 'Actibond', 'Advance', 'Racer4'] as const;

/** Vehicle makes and models (compatibility lines, vehicle placeholders, the demo garage). */
const VEHICLE_MODELS = [
  'Honda',
  'Activa',
  'Jupiter',
  'Access',
  'Maruti Suzuki',
  'Dzire',
  'Amaze',
  'Xcent',
  'Hyundai',
  'Venue',
  'Swift',
  'VXi',
] as const;

/** Units and technical tokens Indian shoppers read in Latin script. */
const TECHNICAL = [
  'GST',
  'GSTIN',
  // The WhatsApp opt-out keyword people must type as is (Terms of Service, 2026-11-14).
  'STOP',
  'PIN',
  'OTP',
  'UPI',
  'MRP',
  'SKU',
  // Admin catalogue import (plan 2026-11-14 B): the file type and the tax code as printed on bills.
  'CSV',
  'HSN',
  'SMS',
  'SUV',
  'OEM',
  'API',
  'JASO',
  'SAE',
  'ISI',
  'VRLA',
  'AGM',
  'TPE',
  'psi',
  'Ctrl',
] as const;

/** Proper names that are not translated: photo credits (photographers, photo site), the map data source. */
const PROPER_NAMES = ['Unsplash', 'Kundan', 'Bana', 'Frankie', 'Cordoba', 'OpenStreetMap'] as const;

/** People's names on the seeded demo accounts (typed by people, shown as typed). */
const PEOPLE = SEEDED_ACCOUNTS.map((a) => a.name);

export const HINDI_ALLOWLIST: readonly string[] = [
  ...OUR_BRANDS,
  ...PRODUCT_BRANDS,
  ...PRODUCT_MODELS,
  ...VEHICLE_MODELS,
  ...TECHNICAL,
  ...PROPER_NAMES,
  ...PEOPLE,
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Latin-script words (3+ letters) in `text` that are not allowed on a Hindi page. Allowlisted terms are removed
 * as whole phrases first ("Shell Helix", "Tata Power EZ", "Mann-Filter"), case-sensitively.
 */
export function latinOffenders(text: string, extra: readonly string[] = []): string[] {
  const phrases = [...HINDI_ALLOWLIST, ...extra].toSorted((a, b) => b.length - a.length);
  let rest = text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b(?:[\w-]+\.)+(?:com|in|org|net|example)\b\S*/g, ' ');
  for (const phrase of phrases) {
    rest = rest.replace(new RegExp(`(?<![A-Za-z])${escape(phrase)}(?![A-Za-z])`, 'g'), ' ');
  }
  const found = new Set<string>();
  for (const token of rest.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}\-/.+_'’@#]*/gu) ?? []) {
    // Codes: anything with a digit (MD-RPR-2026-…, 20W40, Raipur@2026) or upper-case segments joined by hyphens
    // (SKUs such as PRT-SPK-IR).
    if (/\d/.test(token) || /^[A-Z]+(?:-[A-Z]+)+$/.test(token)) continue;
    for (const word of token.match(/[A-Za-z]{3,}/g) ?? []) found.add(word);
  }
  return [...found];
}
