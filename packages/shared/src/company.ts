/**
 * Company details the site must show (Consumer Protection (E-Commerce) Rules 2020: the seller's legal name,
 * registered address and a grievance officer; Companies Act: CIN). Admin-editable (hard rule 8; design 2026-11-15
 * item 8). One pure module for the API, the admin form, the footer, the policy pages and the email footer.
 * An empty field means "not filled": nothing is shown for it. English and Hindi carry their own text for the
 * names and the address (hard rule 10).
 */
import { cleanLine } from './text';

export const COMPANY_FIELDS = [
  'legalName',
  'legalNameHi',
  'cin',
  'gstin',
  'registeredAddress',
  'registeredAddressHi',
  'grievanceName',
  'grievanceNameHi',
  'grievanceEmail',
  'grievancePhone',
] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];
/** Every field, '' = not filled. */
export type CompanyDetails = Record<CompanyField, string>;

export const EMPTY_COMPANY: CompanyDetails = {
  legalName: '',
  legalNameHi: '',
  cin: '',
  gstin: '',
  registeredAddress: '',
  registeredAddressHi: '',
  grievanceName: '',
  grievanceNameHi: '',
  grievanceEmail: '',
  grievancePhone: '',
};

export const COMPANY_MAX: Record<CompanyField, number> = {
  legalName: 120,
  legalNameHi: 160,
  cin: 21,
  gstin: 15,
  registeredAddress: 240,
  registeredAddressHi: 320,
  grievanceName: 80,
  grievanceNameHi: 120,
  grievanceEmail: 120,
  grievancePhone: 16,
};

/** CIN: listing status, 5-digit industry code, state, year, ownership type, 6-digit registration number. */
const CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,63}\.[^\s@<>]{2,24}$/;
const PHONE = /^\+?\d{10,13}$/;

export type CompanyProblem = 'format';

/** One field cleaned to its stored form ('' allowed), or null when the text does not fit its format. */
export function cleanCompanyField(field: CompanyField, raw: string): string | null {
  const squeezed = field === 'cin' || field === 'gstin' || field === 'grievancePhone';
  let text = cleanLine(squeezed ? raw.replace(/[\s-]/g, '') : raw, COMPANY_MAX[field]);
  if (text === '') return '';
  if (field === 'cin' || field === 'gstin') text = text.toUpperCase();
  if (field === 'grievanceEmail') text = text.toLowerCase();
  if (field === 'cin') return CIN.test(text) ? text : null;
  if (field === 'gstin') return GSTIN.test(text) ? text : null;
  if (field === 'grievanceEmail') return EMAIL.test(text) ? text : null;
  if (field === 'grievancePhone') return PHONE.test(text) ? text : null;
  return text;
}

/** Clean a whole form. The first field that does not fit is named so the screen can focus it. */
export function cleanCompany(
  input: Partial<Record<CompanyField, unknown>>,
): { ok: true; details: CompanyDetails } | { ok: false; field: CompanyField; problem: CompanyProblem } {
  const details = { ...EMPTY_COMPANY };
  for (const field of COMPANY_FIELDS) {
    const raw = input[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') return { ok: false, field, problem: 'format' };
    const cleaned = cleanCompanyField(field, raw);
    if (cleaned === null) return { ok: false, field, problem: 'format' };
    details[field] = cleaned;
  }
  return { ok: true, details };
}

/** A stored value read back; a field that does not pass is dropped (a bad row never breaks a page). */
export function readCompany(value: unknown): CompanyDetails {
  const out = { ...EMPTY_COMPANY };
  if (typeof value !== 'object' || value === null) return out;
  for (const field of COMPANY_FIELDS) {
    const raw = (value as Record<string, unknown>)[field];
    if (typeof raw === 'string') out[field] = cleanCompanyField(field, raw) ?? '';
  }
  return out;
}

export interface CompanyFacts {
  company: string;
  registeredAddress: string;
  gstin: string;
  /** Null until filled: nothing is shown. */
  cin: string | null;
  /** Null until any grievance officer detail is filled: nothing is shown. */
  grievance: { name: string | null; email: string | null; phone: string | null } | null;
}

/** The facts a page shows in one language: the admin's text where filled, else `fallback` (the built-in facts). */
export function companyFor(
  details: CompanyDetails,
  locale: string,
  fallback: { company: string; registeredAddress: string; gstin: string },
): CompanyFacts {
  const hi = locale === 'hi';
  const name = (hi ? details.grievanceNameHi || details.grievanceName : details.grievanceName) || null;
  const email = details.grievanceEmail || null;
  const phone = details.grievancePhone || null;
  return {
    // Hindi pages fall back to the built-in Hindi text (the caller's `fallback`), never to the admin's English.
    company: (hi ? details.legalNameHi : details.legalName) || fallback.company,
    registeredAddress:
      (hi ? details.registeredAddressHi : details.registeredAddress) || fallback.registeredAddress,
    gstin: details.gstin || fallback.gstin,
    cin: details.cin || null,
    grievance: name || email || phone ? { name, email, phone } : null,
  };
}

/** One line for the email footer: "Name · email · phone", or null when nothing is filled. */
export function grievanceContactLine(details: CompanyDetails): string | null {
  const parts = [details.grievanceName, details.grievanceEmail, details.grievancePhone].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}
