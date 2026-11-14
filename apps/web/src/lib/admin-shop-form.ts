import { isGstin, normaliseGstin } from '@mechdost/shared/gst';
import { isShopHours, type ShopHours } from '@mechdost/shared/shop-hours';
import type { AdminShopDetailDto, ShopStatus } from '@mechdost/shared/shop-api';
import { commonErrorKey, type CommonErrorKey } from './api-error-key';
import { memberPhone } from './admin-workshop-form';
import { parseRupees } from './money-input';

/**
 * Admin → Partners → Shops on the API (real sign-in; spec 08): the editor's form ↔ request logic, kept free of
 * React so it is unit-tested. Every edit sends only the fields that changed plus the shop `version` (L103), money is
 * typed in rupees and sent in paise, and an empty "free delivery" or "acceptance time" means "use the city setting".
 */

export interface ShopForm {
  name: string;
  nameHi: string;
  legalName: string;
  addressLine: string;
  addressLineHi: string;
  /** 10-digit mobile (the +91 is added when sending). */
  phone: string;
  email: string;
  gstin: string;
  /** Minutes to accept an offer; empty = the city setting. */
  timeout: string;
  /** Free delivery from this order value in rupees; empty = the city setting, 0 = always free. */
  freeDelivery: string;
  open: string;
  close: string;
  days: number[];
}

export type ShopField = keyof ShopForm;

const rupees = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

export function formFromShop(s: AdminShopDetailDto): ShopForm {
  return {
    name: s.name,
    nameHi: s.nameHi ?? '',
    legalName: s.legalName ?? '',
    addressLine: s.addressLine,
    addressLineHi: s.addressLineHi ?? '',
    phone: s.phone.replace(/^\+91/, ''),
    email: s.email ?? '',
    gstin: s.gstin ?? '',
    timeout: s.acceptanceTimeoutMin === null ? '' : String(s.acceptanceTimeoutMin),
    freeDelivery: s.freeDeliveryMinPaise === null ? '' : rupees(s.freeDeliveryMinPaise),
    open: s.hours.open,
    close: s.hours.close,
    days: [...s.hours.days].sort((a, b) => a - b),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sameDays = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

export type ShopPatchResult =
  | { ok: true; body: Record<string, unknown> | null }
  | { ok: false; errors: Partial<Record<ShopField, true>> };

/** The PATCH body for the fields that changed (null when nothing did), or every invalid field at once. */
export function shopPatch(original: AdminShopDetailDto, f: ShopForm): ShopPatchResult {
  const errors: Partial<Record<ShopField, true>> = {};
  const body: Record<string, unknown> = {};
  const text = (field: ShopField, value: string, min: number, max: number) => {
    const v = value.trim();
    if (v.length < min || v.length > max) errors[field] = true;
    return v;
  };
  const optional = (v: string) => (v.trim() === '' ? null : v.trim());

  const name = text('name', f.name, 2, 120);
  if (name !== original.name) body.name = name;
  const nameHi = optional(f.nameHi);
  if (nameHi !== null && (nameHi.length < 2 || nameHi.length > 120)) errors.nameHi = true;
  if (nameHi !== original.nameHi) body.nameHi = nameHi;
  const legalName = optional(f.legalName);
  if (legalName !== null && (legalName.length < 2 || legalName.length > 160)) errors.legalName = true;
  if (legalName !== original.legalName) body.legalName = legalName;
  const addressLine = text('addressLine', f.addressLine, 5, 300);
  if (addressLine !== original.addressLine) body.addressLine = addressLine;
  const addressLineHi = optional(f.addressLineHi);
  if (addressLineHi !== null && (addressLineHi.length < 5 || addressLineHi.length > 300))
    errors.addressLineHi = true;
  if (addressLineHi !== original.addressLineHi) body.addressLineHi = addressLineHi;

  const phone = memberPhone(f.phone);
  if (!phone) errors.phone = true;
  else if (phone !== original.phone) body.phone = phone;
  const email = optional(f.email);
  if (email !== null && !EMAIL_RE.test(email)) errors.email = true;
  if (email !== original.email) body.email = email;

  const gstin = normaliseGstin(f.gstin);
  if (gstin !== (original.gstin ?? '')) {
    // A GSTIN can be corrected, never removed (invoices need it).
    if (!isGstin(gstin)) errors.gstin = true;
    else body.gstin = gstin;
  }

  const t = f.timeout.trim();
  const timeout = t === '' ? null : Number(t);
  if (timeout !== null && (!Number.isInteger(timeout) || timeout < 5 || timeout > 120)) errors.timeout = true;
  else if (timeout !== original.acceptanceTimeoutMin) body.acceptanceTimeoutMin = timeout;

  if (f.freeDelivery.trim() === '') {
    if (original.freeDeliveryMinPaise !== null) body.freeDeliveryMinPaise = null;
  } else {
    const r = parseRupees(f.freeDelivery, { allowZero: true });
    if (!r.ok || r.paise > 10_000_000) errors.freeDelivery = true;
    else if (r.paise !== original.freeDeliveryMinPaise) body.freeDeliveryMinPaise = r.paise;
  }

  const hours: ShopHours = { open: f.open, close: f.close, days: [...f.days].sort((a, b) => a - b) };
  if (!isShopHours(hours)) {
    if (f.days.length === 0) errors.days = true;
    if (!(f.open < f.close)) errors.close = true;
    if (f.days.length > 0 && f.open < f.close) errors.open = true;
  } else if (
    hours.open !== original.hours.open ||
    hours.close !== original.hours.close ||
    !sameDays(hours.days, original.hours.days)
  )
    body.hours = hours;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return Object.keys(body).length === 0
    ? { ok: true, body: null }
    : { ok: true, body: { version: original.version, ...body } };
}

/* ─────────────── Coverage ─────────────── */

export interface CoverageRow {
  pincode: string;
  /** Delivery charge in rupees. */
  charge: string;
  days: string;
  active: boolean;
  remove: boolean;
  isNew?: boolean;
}
export type CoverageProblem = 'pincode' | 'duplicate' | 'charge' | 'days';

export function rowsFromCoverage(coverage: AdminShopDetailDto['coverage']): CoverageRow[] {
  return coverage.map((c) => ({
    pincode: c.pincode,
    charge: rupees(c.shippingPaise),
    days: String(c.leadDays),
    active: c.active,
    remove: false,
  }));
}

export function emptyCoverageRow(): CoverageRow {
  return { pincode: '', charge: '', days: '', active: true, remove: false, isNew: true };
}

/** `PUT /admin/shops/{id}/coverage` body (null when nothing changed), or the problem per row index. */
export function coverageBody(
  original: AdminShopDetailDto,
  rows: readonly CoverageRow[],
):
  | {
      ok: true;
      body: {
        version: number;
        upsert: { pincode: string; shippingPaise: number; leadDays: number; active: boolean }[];
        remove: string[];
      } | null;
    }
  | { ok: false; errors: Record<number, CoverageProblem> } {
  const errors: Record<number, CoverageProblem> = {};
  const upsert: { pincode: string; shippingPaise: number; leadDays: number; active: boolean }[] = [];
  const remove: string[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const pin = r.pincode.trim();
    if (r.isNew && r.remove) return; // a new row taken back
    if (!/^[1-9]\d{5}$/.test(pin)) {
      errors[i] = 'pincode';
      return;
    }
    if (seen.has(pin)) {
      errors[i] = 'duplicate';
      return;
    }
    seen.add(pin);
    const before = original.coverage.find((c) => c.pincode === pin);
    if (r.remove) {
      if (before) remove.push(pin);
      return;
    }
    const charge = parseRupees(r.charge, { allowZero: true });
    if (!charge.ok || charge.paise > 1_000_000) {
      errors[i] = 'charge';
      return;
    }
    const days = Number(r.days.trim());
    if (r.days.trim() === '' || !Number.isInteger(days) || days < 0 || days > 60) {
      errors[i] = 'days';
      return;
    }
    const unchanged =
      before?.shippingPaise === charge.paise && before.leadDays === days && before.active === r.active;
    if (!unchanged)
      upsert.push({ pincode: pin, shippingPaise: charge.paise, leadDays: days, active: r.active });
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return upsert.length + remove.length === 0
    ? { ok: true, body: null }
    : { ok: true, body: { version: original.version, upsert, remove } };
}

/* ─────────────── Standing, deadlines, errors ─────────────── */

/**
 * The standings staff may move a shop to. A pending shop goes live by itself; staff may only keep it dark
 * (suspended) so its PIN codes and products can be set up first (code review 2026-11-14).
 */
export function standingTargets(status: ShopStatus): ('approved' | 'paused' | 'suspended')[] {
  if (status === 'approved') return ['paused', 'suspended'];
  if (status === 'paused') return ['approved', 'suspended'];
  if (status === 'suspended') return ['approved'];
  return ['suspended'];
}

/**
 * How to show an offer's deadline: a countdown within two hours, otherwise the time it waits until (an order
 * routed to a closed shop waits for its opening + the grace setting).
 */
export function deadlineView(
  expiresAt: string | null,
  now: number,
): { kind: 'minutes'; minutes: number } | { kind: 'until'; at: string } {
  if (!expiresAt) return { kind: 'minutes', minutes: 0 };
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return { kind: 'minutes', minutes: 0 };
  const minutes = Math.max(0, Math.ceil((at - now) / 60_000));
  return minutes > 120 ? { kind: 'until', at: expiresAt } : { kind: 'minutes', minutes };
}

/** Weekday and time in IST, e.g. "Tue, 9:00 am"; Hindi uses the 24-hour clock ("मंगल, 21:30": no Latin am/pm). */
export function istDayTime(iso: string, locale: string): string {
  const hi = locale === 'hi';
  return new Intl.DateTimeFormat(hi ? 'hi-IN' : 'en-IN', {
    weekday: 'short',
    hour: hi ? '2-digit' : 'numeric',
    minute: '2-digit',
    ...(hi ? { hourCycle: 'h23' as const } : {}),
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

/** Short weekday name (0 = Sunday) in the page's language, for the hours checkboxes. */
export function weekdayShort(day: number, locale: string): string {
  // 2026-11-15 was a Sunday.
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 10, 15 + day)));
}

/** Monday first, as shops read a week. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const SHOP_ERRORS = new Set([
  'STALE_SHOP',
  'GSTIN_INVALID',
  'GSTIN_STATE',
  'PINCODE_OTHER_CITY',
  'PINCODE_UNKNOWN',
  'DUPLICATE_PINCODE',
  'MEMBER_IS_STAFF',
  'STATUS_TRANSITION',
  'STATUS_ENDS_AT',
  'STATUS_REASON_CODE',
  'HOURS_INVALID',
  'OWNER_ONLY',
  'ALREADY_LISTED',
  'PRICE_ABOVE_MRP',
  'STOCK_BELOW_RESERVED',
  'PRODUCT_NOT_LIVE',
  'STALE_OFFER',
  'EMPTY_PATCH',
  'GSTIN_TAKEN',
  'ALREADY_OWNER',
  'ACCOUNT_NOT_ACTIVE',
]);

export type ShopErrorKey = `shops_api_err_${string}` | CommonErrorKey;

/** An API error code → `portal.shops_api_err_<CODE>` for the shop codes, else the common message. */
export function shopErrorKey(code: string): ShopErrorKey {
  return SHOP_ERRORS.has(code) ? `shops_api_err_${code}` : commonErrorKey(code);
}
