import { istParts } from './time';
import type { VehicleType } from './vehicles';

/**
 * Roadside assistance contracts (spec 22; design 2026-11-24). Codes, not free text (hard rule 16): the label of every
 * code lives in the `roadside` locale namespace. Money is integer paise. 3W exists as a vehicle type but is NOT
 * offered at launch (user ruling 2026-11-24): what is offered is the per-city setting `vehicleTypes`.
 */

/** What the customer thinks happened. Optional; `unknown` is the explicit "I don't know what's wrong". */
export const RSA_PROBLEM_TYPES = [
  'dead_battery',
  'flat_tyre',
  'out_of_fuel',
  'minor_fix',
  'needs_towing',
  'unknown',
] as const;
export type RsaProblemType = (typeof RSA_PROBLEM_TYPES)[number];

export const RSA_FUELS = ['petrol', 'diesel', 'cng', 'electric', 'other'] as const;
export type RsaFuel = (typeof RSA_FUELS)[number];

/** How a request finds its responder (per city). Phase 1 builds `manual` only; the others are stored for phase 3. */
export const RSA_ROUTING_MODES = ['manual', 'auto', 'auto_then_manual'] as const;
export type RsaRoutingMode = (typeof RSA_ROUTING_MODES)[number];

export const RSA_BILL_LINE_KINDS = ['labour', 'part', 'towing', 'other'] as const;
export type RsaBillLineKind = (typeof RSA_BILL_LINE_KINDS)[number];

export const RSA_DECLINE_REASONS = [
  'busy',
  'too_far',
  'vehicle_not_served',
  'problem_not_handled',
  'closed',
  'other',
] as const;
export type RsaDeclineReason = (typeof RSA_DECLINE_REASONS)[number];

/** Why staff cancelled (only while nobody has accepted). */
export const RSA_CANCEL_REASONS = [
  'no_responder_accepted',
  'customer_unreachable',
  'duplicate_request',
  'other',
] as const;
export type RsaCancelReason = (typeof RSA_CANCEL_REASONS)[number];

/** Why the system ended a request. */
export const RSA_SYSTEM_CANCEL_REASONS = ['payment_window_expired', 'customer_abandoned'] as const;

/** Payment purposes of the two Razorpay orders of one request. */
export const RSA_PAYMENT_PURPOSES = ['rsa_advance', 'rsa_balance'] as const;
export type RsaPaymentPurpose = (typeof RSA_PAYMENT_PURPOSES)[number];

/** How the balance was settled. */
export const RSA_BALANCE_METHODS = ['online', 'cash'] as const;
export type RsaBalanceMethod = (typeof RSA_BALANCE_METHODS)[number];

export const RSA_DEFAULT_ADVANCE_PAISE = 50_000;
export const RSA_MAX_ADVANCE_PAISE = 500_000;
export const RSA_DEFAULT_VEHICLE_TYPES = ['2W', '4W'] as const satisfies readonly VehicleType[];
export const RSA_DEFAULT_ACCEPT_TIMER_SECONDS = 150;
export const RSA_MAX_BILL_LINES = 20;
/** A roadside bill above this (₹1,00,000) is refused: a typo or abuse, never a roadside job (no customer approval of lines yet). */
export const RSA_MAX_BILL_PAISE = 10_000_000;
/** The per-city ceiling of one roadside bill unless an admin sets another (₹25,000); never above `RSA_MAX_BILL_PAISE`. */
export const RSA_DEFAULT_MAX_BILL_PAISE = 2_500_000;
/** Minutes the customer has to pay the advance before the unpaid request is closed by the worker. */
export const RSA_PAYMENT_WINDOW_MINUTES = 30;
export const RSA_PUBLIC_CODE_PREFIX = 'RSA';

/** Balance after the work: total minus the advance already paid, never below zero. */
export function rsaBalancePaise(totalPaise: number, advancePaise: number): number {
  return Math.max(totalPaise - advancePaise, 0);
}

/** What goes back to the customer when the total is lower than the advance. */
export function rsaOverpaidPaise(totalPaise: number, advancePaise: number): number {
  return Math.max(advancePaise - totalPaise, 0);
}

/** One bill line's amount: quantity times unit price, integer paise. */
export function rsaLineTotalPaise(quantity: number, unitPricePaise: number): number {
  return quantity * unitPricePaise;
}

export interface RsaHours {
  alwaysOpen: boolean;
  /** Minutes after midnight IST. When `opensAtMinute > closesAtMinute` the window runs past midnight. */
  opensAtMinute: number;
  closesAtMinute: number;
}

/** Is the city taking roadside requests at this instant (IST wall clock)? */
export function rsaOpenAt(hours: RsaHours, at: Date): boolean {
  if (hours.alwaysOpen) return true;
  const { hour, minute } = istParts(at);
  const m = hour * 60 + minute;
  const { opensAtMinute: open, closesAtMinute: close } = hours;
  if (open === close) return false;
  return open < close ? m >= open && m < close : m >= open || m < close;
}

// ── settings ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The admin-editable per-city settings as stored. `version` is the compare-and-set. Zod form: `rsa-api.ts`. */
export interface RsaSettings {
  enabled: boolean;
  /** The vehicle types offered in this city. 2W and 4W at launch; 3W is added here later. */
  vehicleTypes: VehicleType[];
  /** Advance per offered vehicle type, paise (exactly one amount per offered type). */
  advancePaise: Partial<Record<VehicleType, number>>;
  pincodes: string[];
  alwaysOpen: boolean;
  opensAtMinute: number;
  closesAtMinute: number;
  routingMode: RsaRoutingMode;
  acceptTimerSeconds: number;
  maxAutoAttempts: number;
  /** Largest bill a workshop may enter for one request in this city, paise (default ₹25,000, at most ₹1,00,000). */
  maxBillPaise: number;
  /** Whether customers see "Question this bill" (opens a support request). Off by default (user ruling 2026-11-24). */
  billDisputeEnabled: boolean;
  problemTypes: RsaProblemType[];
  sosPhone: string | null;
  version: number;
}

/** What a city gets before an admin saves anything: switched off, 2W and 4W, 500 rupees advance, 24x7, manual. */
export function defaultRsaSettings(): RsaSettings {
  return {
    enabled: false,
    vehicleTypes: [...RSA_DEFAULT_VEHICLE_TYPES],
    advancePaise: { '2W': RSA_DEFAULT_ADVANCE_PAISE, '4W': RSA_DEFAULT_ADVANCE_PAISE },
    pincodes: [],
    alwaysOpen: true,
    opensAtMinute: 0,
    closesAtMinute: 0,
    routingMode: 'manual',
    acceptTimerSeconds: RSA_DEFAULT_ACCEPT_TIMER_SECONDS,
    maxAutoAttempts: 3,
    maxBillPaise: RSA_DEFAULT_MAX_BILL_PAISE,
    billDisputeEnabled: false,
    problemTypes: [...RSA_PROBLEM_TYPES],
    sosPhone: null,
    version: 0,
  };
}
