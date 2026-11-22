/**
 * Pure helpers for the business application form (audience entry design 2026-11-22, item 3): field checks that
 * return message KEYS (never text), the request bodies, and how an API refusal shows. No Zod and no fetch, so the
 * unit tests and the bundle stay light; the API re-checks everything with the shared schemas.
 */
import {
  FLEET_NEEDS,
  FLEET_SIZE_MAX,
  TRADE_BUSINESS_TYPES,
  TRADE_SPEND_BANDS,
  type FleetNeed,
  type TradeBusinessType,
  type TradeSpendBand,
} from '@mechdost/shared/business-codes';
import { isGstin, normaliseGstin } from '@mechdost/shared/gst';

export type TradeField =
  'businessName' | 'businessType' | 'gstin' | 'pincode' | 'spendBand' | 'categories' | 'consent';
export type FleetField =
  'companyName' | 'fleet' | 'pincode' | 'contactName' | 'phone' | 'email' | 'needs' | 'note' | 'consent';

/** Order the error summary lists fields in (the order on the screen). */
export const TRADE_FIELD_ORDER: readonly TradeField[] = [
  'businessName',
  'businessType',
  'gstin',
  'pincode',
  'spendBand',
  'categories',
  'consent',
];
export const FLEET_FIELD_ORDER: readonly FleetField[] = [
  'companyName',
  'fleet',
  'pincode',
  'contactName',
  'phone',
  'email',
  'needs',
  'note',
  'consent',
];

export interface TradeValues {
  businessName: string;
  businessType: string;
  gstin: string;
  pincode: string;
  spendBand: string;
  categories: readonly string[];
  consent: boolean;
}

export interface FleetValues {
  companyName: string;
  w2: string;
  w3: string;
  w4: string;
  pincode: string;
  contactName: string;
  phone: string;
  email: string;
  needs: readonly string[];
  note: string;
  consent: boolean;
}

/** Message key in the `business` namespace for an invalid field. */
export type ErrorKey = `err_${string}`;

const PIN = /^[1-9][0-9]{5}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A 10-digit Indian mobile number from what people type (+91, spaces and dashes allowed). */
export function mobileDigits(raw: string): string {
  return raw.replace(/[\s-]/g, '').replace(/^(\+91|91)(?=[6-9]\d{9}$)/, '');
}

const isOf = <T extends string>(list: readonly T[], v: string): v is T =>
  (list as readonly string[]).includes(v);

export function validateTrade(v: TradeValues): Partial<Record<TradeField, ErrorKey>> {
  const e: Partial<Record<TradeField, ErrorKey>> = {};
  const name = v.businessName.trim();
  if (name.length < 2 || name.length > 120) e.businessName = 'err_businessName';
  if (!isOf(TRADE_BUSINESS_TYPES, v.businessType)) e.businessType = 'err_businessType';
  const gstin = normaliseGstin(v.gstin);
  if (gstin !== '' && !isGstin(gstin)) e.gstin = 'err_gstin';
  if (!PIN.test(v.pincode.trim())) e.pincode = 'err_pincode';
  if (!isOf(TRADE_SPEND_BANDS, v.spendBand)) e.spendBand = 'err_spendBand';
  if (v.categories.length === 0) e.categories = 'err_categories';
  if (!v.consent) e.consent = 'err_consent';
  return e;
}

export function tradeBody(v: TradeValues): Record<string, unknown> {
  const gstin = normaliseGstin(v.gstin);
  return {
    businessName: v.businessName.trim(),
    businessType: v.businessType,
    ...(gstin ? { gstin } : {}),
    pincode: v.pincode.trim(),
    spendBand: v.spendBand,
    categories: [...v.categories],
    consent: true,
  };
}

const count = (raw: string): number | null => {
  const t = raw.trim();
  if (t === '') return 0;
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n <= FLEET_SIZE_MAX ? n : null;
};

export function validateFleet(v: FleetValues): Partial<Record<FleetField, ErrorKey>> {
  const e: Partial<Record<FleetField, ErrorKey>> = {};
  const company = v.companyName.trim();
  if (company.length < 2 || company.length > 120) e.companyName = 'err_companyName';
  const sizes = [count(v.w2), count(v.w3), count(v.w4)];
  if (sizes.some((n) => n === null) || sizes.reduce<number>((a, n) => a + (n ?? 0), 0) === 0)
    e.fleet = 'err_fleet';
  if (!PIN.test(v.pincode.trim())) e.pincode = 'err_pincode';
  const contact = v.contactName.trim();
  if (contact.length < 2 || contact.length > 80) e.contactName = 'err_contactName';
  if (!/^[6-9]\d{9}$/.test(mobileDigits(v.phone))) e.phone = 'err_phone';
  const email = v.email.trim();
  if (email.length > 120 || !EMAIL.test(email)) e.email = 'err_email';
  if (v.needs.length === 0 || !v.needs.every((n) => isOf(FLEET_NEEDS, n))) e.needs = 'err_needs';
  if (v.note.trim().length > 500) e.note = 'err_note';
  if (!v.consent) e.consent = 'err_consent';
  return e;
}

export function fleetBody(v: FleetValues): Record<string, unknown> {
  const note = v.note.trim();
  return {
    companyName: v.companyName.trim(),
    fleet: { w2: count(v.w2) ?? 0, w3: count(v.w3) ?? 0, w4: count(v.w4) ?? 0 },
    pincode: v.pincode.trim(),
    contactName: v.contactName.trim(),
    phone: mobileDigits(v.phone),
    email: v.email.trim(),
    needs: [...v.needs],
    ...(note ? { note } : {}),
    consent: true,
  };
}

/** Keys in the `business` namespace a form-level API refusal can show. */
export type FormErrorKey =
  | 'errForm_turnstile'
  | 'errForm_rate'
  | 'errForm_unavailable'
  | 'errForm_generic'
  | 'errForm_open'
  | 'errForm_verified'
  | 'errForm_verify'
  | 'errForm_auth'
  | 'errForm_categories';

/** An API refusal → one message above the form, or a field-specific one. Never a raw code. */
export function businessErrorView(code: string): { form: FormErrorKey | null; pincode: boolean } {
  if (code === 'PINCODE_NOT_SERVED') return { form: null, pincode: true };
  const form: Record<string, FormErrorKey> = {
    TURNSTILE_FAILED: 'errForm_turnstile',
    TURNSTILE: 'errForm_turnstile',
    RATE_LIMITED: 'errForm_rate',
    HTTP_429: 'errForm_rate',
    UNAVAILABLE: 'errForm_unavailable',
    NETWORK: 'errForm_unavailable',
    TRADE_APPLICATION_OPEN: 'errForm_open',
    TRADE_ALREADY_VERIFIED: 'errForm_verified',
    VERIFICATION_REQUIRED: 'errForm_verify',
    AUTH_REQUIRED: 'errForm_auth',
    HTTP_401: 'errForm_auth',
    CATEGORIES: 'errForm_categories',
  };
  const known = form[code];
  if (known) return { form: known, pincode: false };
  return { form: /^HTTP_5\d\d$/.test(code) ? 'errForm_unavailable' : 'errForm_generic', pincode: false };
}

export type { FleetNeed, TradeBusinessType, TradeSpendBand };
