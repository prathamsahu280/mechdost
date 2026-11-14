/**
 * Pure helpers for seller onboarding on the API (Stream D, 2026-11-14; spec 07): how an API error shows on the
 * application form, the delivery area an admin types at approval, and what "Your prices" shows per product.
 * No Zod and no fetch here, so the demo bundle and the unit tests can import it freely.
 */
import type { PriceRequestStatus } from '@mechdost/shared/state';
import { parseRupees } from './money-input';

/** Keys in the `apply` namespace a form-level API error can show. */
export type ApplyFormError =
  | 'api_errBotCheck'
  | 'api_errRate'
  | 'api_errUnavailable'
  | 'api_errGeneric'
  | 'inviteUsed'
  | 'inviteExpired'
  | 'inviteRevoked'
  | 'inviteNotFound';

/** Keys in the `apply` namespace that replace a field's usual message for an API answer. */
export type ApplyFieldError = 'api_errPincodeNotServed' | 'api_errProductsGone' | 'api_errInviteCity';

export interface ApplyErrorView {
  /** Field name → a specific message key, or null for the field's usual message. */
  fields: Record<string, ApplyFieldError | null>;
  form: ApplyFormError | null;
}

const INVITE: Record<string, ApplyFormError> = {
  INVITE_USED: 'inviteUsed',
  INVITE_EXPIRED: 'inviteExpired',
  INVITE_REVOKED: 'inviteRevoked',
  NOT_FOUND: 'inviteNotFound',
  HTTP_404: 'inviteNotFound',
};

/**
 * An API refusal of `POST /v1/partner-applications` (or the invite variant) → errors next to the fields when the
 * API names them, otherwise one message above the form. Never a raw code.
 */
export function applyErrorView(code: string, fields: readonly string[] = []): ApplyErrorView {
  if (code === 'APPLICATION_INVALID' && fields.length > 0)
    return { fields: Object.fromEntries(fields.map((f) => [f, null])), form: null };
  if (code === 'PINCODE_NOT_SERVED') return { fields: { pincode: 'api_errPincodeNotServed' }, form: null };
  if (code === 'INVITE_CITY') return { fields: { pincode: 'api_errInviteCity' }, form: null };
  if (code === 'PRODUCTS') return { fields: { productSlugs: 'api_errProductsGone' }, form: null };
  const invite = INVITE[code];
  if (invite) return { fields: {}, form: invite };
  if (code === 'TURNSTILE_FAILED' || code === 'TURNSTILE') return { fields: {}, form: 'api_errBotCheck' };
  if (code === 'RATE_LIMITED' || code === 'HTTP_429') return { fields: {}, form: 'api_errRate' };
  if (code === 'UNAVAILABLE' || code === 'NETWORK' || /^HTTP_5\d\d$/.test(code))
    return { fields: {}, form: 'api_errUnavailable' };
  return { fields: {}, form: 'api_errGeneric' };
}

export interface CoverageLine {
  pincode: string;
  shippingPaise: number;
  leadDays: number;
}

/**
 * The delivery area typed at approval: PIN codes (commas, spaces or new lines), one charge in rupees (₹0–₹500)
 * and one number of days (0–14) for all of them. Same limits as the API (`Coverage` in partner-onboarding.ts).
 */
export function parseCoverage(pins: string, charge: string, days: string): CoverageLine[] | null {
  const list = [...new Set(pins.split(/[\s,;]+/).filter(Boolean))];
  if (list.length === 0 || list.length > 500 || !list.every((p) => /^[1-9][0-9]{5}$/.test(p))) return null;
  const rupees = parseRupees(charge, { allowZero: true });
  if (!rupees.ok || rupees.paise > 50_000) return null;
  const d = days.trim();
  if (!/^\d{1,2}$/.test(d) || Number(d) > 14) return null;
  return list.map((pincode) => ({ pincode, shippingPaise: rupees.paise, leadDays: Number(d) }));
}

export interface PriceRequestLite {
  id: string;
  sku: string;
  status: PriceRequestStatus;
  requestedPaise: number;
  reasonCode: string | null;
  createdAt: string;
}

/** What one product shows on "Your prices": the live price, plus the newest request if it is still relevant. */
export type PriceRowState =
  | { kind: 'on_sale'; livePaise: number; pending: PriceRequestLite | null }
  | { kind: 'rejected'; livePaise: number; reasonCode: string }
  | { kind: 'off_sale'; reasonCode: string | null };

/** The newest request per SKU (the shop's list is newest first, but do not rely on it). */
export function newestRequestBySku<T extends PriceRequestLite>(items: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of items) {
    const seen = out.get(r.sku);
    if (!seen || Date.parse(r.createdAt) > Date.parse(seen.createdAt)) out.set(r.sku, r);
  }
  return out;
}

/**
 * The row state from the offer (`active`, `sellingPaise`) and the newest request. A rejected request on an offer
 * that is off sale means the price was refused (design § Prices: the product goes off sale for that shop).
 */
export function priceRowState(
  offer: { active: boolean; sellingPaise: number },
  newest: PriceRequestLite | undefined,
): PriceRowState {
  if (!offer.active) return { kind: 'off_sale', reasonCode: newest?.reasonCode ?? null };
  if (newest?.status === 'pending')
    return { kind: 'on_sale', livePaise: offer.sellingPaise, pending: newest };
  if (newest?.status === 'rejected' && newest.reasonCode)
    return { kind: 'rejected', livePaise: offer.sellingPaise, reasonCode: newest.reasonCode };
  return { kind: 'on_sale', livePaise: offer.sellingPaise, pending: null };
}

/** The shop a partner account manages, from the roles on `GET /v1/me` (the first one, if several). */
export function shopIdFromRoles(roles: readonly { shopId: string | null }[]): string | null {
  return roles.find((r) => r.shopId !== null)?.shopId ?? null;
}

/** The invite page shows the mobile number masked: only the last 4 digits come from the API. */
export function maskedPhone(last4: string): string {
  return `••••••${last4}`;
}
