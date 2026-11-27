/**
 * Pure helpers of the delivery-agent screens (spec 24): countdowns, the agent's 4 steps, call and map links, and the
 * contract's error codes (`delivery.errors.*`). Zod-free and React-free, unit-tested in `test/delivery-view.test.ts`.
 */
import type { DeliveryJobStatus } from '@mechdost/shared/delivery/codes';
import type { ShopOrderDeliveryView } from './types';

/** Under a minute left: the countdown turns to the warning colour and is announced once. */
const URGENT_S = 60;

export function countdown(
  expiresAt: string | null,
  now: number,
): { seconds: number; text: string; urgent: boolean } | null {
  if (!expiresAt) return null;
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return { seconds, text: `${String(m)}:${String(s).padStart(2, '0')}`, urgent: seconds < URGENT_S };
}

/**
 * The step of an accepted or picked-up job: 1 go to the shop, 2 pick up (code + photo), 3 go to the customer, 4 hand
 * over (code + photo). `arrived` is the agent's own "I'm at the shop / customer" tap (kept on the device only).
 */
export function agentStep(status: DeliveryJobStatus, arrived: boolean): 1 | 2 | 3 | 4 | null {
  if (status === 'accepted') return arrived ? 2 : 1;
  if (status === 'picked_up') return arrived ? 4 : 3;
  return null;
}

/**
 * Error codes the contract has copy for (`delivery.errors.<code>`, en + hi). Every code the delivery routes and
 * repositories return is here (guard: `test/delivery-error-codes.test.ts`, DC-B3), so no screen prints a raw key or a
 * bare "Something went wrong" for a refusal the API answers on purpose.
 */
export const DELIVERY_ERROR_CODES = [
  'AGENTS_DISABLED',
  'JOB_CHANGED',
  'OFFER_EXPIRED',
  'TOO_MANY_ACTIVE_JOBS',
  'AGENT_NOT_ACTIVE',
  'PHOTO_REQUIRED',
  'CODE_LOCKED',
  'RETRY_LIMIT',
  'VEHICLE_CANNOT_CARRY',
  'COD_STAYS_WITH_SHOP',
  'INVITE_PHONE_MISMATCH',
  'INVITE_EXPIRED',
  'DOCUMENT_AADHAAR',
  'DOCUMENT_FORMAT',
  'RATING_CLOSED',
  'NOT_RATEABLE',
  'WRONG_CODE_RETRY',
  'AGENT_NOT_ELIGIBLE',
  'AGENT_REQUIRED',
  'ALREADY_AGENT',
  'APPLICATION_DECIDED',
  'CITY_UNKNOWN',
  'CODE_FORMAT',
  'DELIVERY_CODES_UNAVAILABLE',
  'DOCUMENTS_NOT_VERIFIED',
  'DOCUMENT_IN_USE',
  'DOCUMENT_NOT_PENDING',
  'IDEMPOTENCY_MISMATCH',
  'INVITE_NOT_OPEN',
  'INVITE_OPEN',
  'INVITE_REVOKED',
  'INVITE_USED',
  'JOB_PICKED_UP',
  'JOB_REQUIRED',
  'NOTE_REQUIRED',
  'NOT_A_PAYMENT',
  'NOT_SWITCHABLE',
  'NO_CODE',
  'NO_DELIVERY_CODE',
  'NO_SHIPMENT',
  'NO_SHOP',
  'PAYOUT_NOT_STORED',
  'PHOTOS_UNAVAILABLE',
  'PHOTO_TOO_LARGE',
  'PHOTO_TYPE',
  'RATING_STARS',
  'REASON_REQUIRED',
  'REQUEST_DECIDED',
  'REQUEST_PENDING',
  'RESERVED_KEY',
  'SAME_MODE',
  'STALE',
  'SWITCH_PENDING',
  'VERIFICATION_REQUIRED',
  'WRONG_STEP',
] as const;
export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number];

export function deliveryErrorKey(code: string): DeliveryErrorCode | null {
  // A plain `WRONG_CODE` (API refusal without the count in the code) gets the words without a number.
  if (code === 'WRONG_CODE') return 'WRONG_CODE_RETRY';
  return DELIVERY_ERROR_CODES.find((c) => c === code) ?? null;
}

/** A wrong hand-back code comes back as `WRONG_CODE:<tries left>` (demo) or the API's code with its count. */
export function wrongCodeLeft(code: string): number | null {
  const m = /^(?:WRONG_CODE|CODE_LOCKED):(\d+)$/.exec(code);
  return m ? Number(m[1]) : null;
}

/** +91 and the 10 digits of an Indian mobile number (with or without +91 and spaces), for a `tel:` link. */
export function telNumber(phone: string): string {
  return `+91${phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')}`;
}

/** `tel:` link for an Indian mobile number. */
export function telHref(phone: string): string {
  return `tel:${telNumber(phone)}`;
}

/** Opens the phone's maps app (Google Maps universal link) at a point or an address. */
export function mapsHref(to: { lat: number; lng: number } | { address: string }): string {
  const query = 'address' in to ? to.address : `${String(to.lat)},${String(to.lng)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Metres → km with one decimal (at least 0.1). */
export function kmText(m: number): string {
  return Math.max(0.1, Math.round(m / 100) / 10).toFixed(1);
}

/**
 * Idempotency key of one "Record payout" submission (`AgentPayoutInput.idempotencyKey`: 16–64 of `[A-Za-z0-9_-]`,
 * never `rev-…`, hard rule 3). Made when the form opens and kept across retries of the same submission, so a double
 * click or a retry after a network error records the payment once.
 */
export function newPayoutKey(): string {
  return globalThis.crypto.randomUUID();
}
/** After an answer: keep the key when the submission failed (a retry is the same payment), renew it after success. */
export function nextPayoutKey(current: string, succeeded: boolean): string {
  return succeeded ? newPayoutKey() : current;
}

/** The contract keeps ratings in tenths of a star (`ratingAvgX10`: 43 = 4.3); screens show stars. */
export function ratingFromX10(avgX10: number | null): number | null {
  return avgX10 === null ? null : avgX10 / 10;
}

/** Sub-order statuses where an agent-delivered order shows the agent hand-over instead of the shop's own steps. */
export const AGENT_HANDOVER_STATUSES: readonly string[] = ['packed', 'ready_for_pickup', 'out_for_delivery'];

/**
 * The agent hand-over view of one shop sub-order, or null for the shop's own delivery steps. Keyed on the order's
 * delivery mode: a packed agent order has no job yet (`delivery: null`) and must still offer "Mark ready for pickup",
 * never the shop's "Mark out for delivery" (DC-P9, QA 2026-11-27).
 */
export function shopAgentHandover(order: {
  status: string;
  deliveryMode?: 'agent' | 'shop' | null | undefined;
  delivery?: ShopOrderDeliveryView | null | undefined;
}): ShopOrderDeliveryView | null {
  const delivery = order.delivery ?? null;
  const mode = order.deliveryMode ?? delivery?.mode ?? null;
  if (mode !== 'agent' || !AGENT_HANDOVER_STATUSES.includes(order.status)) return null;
  return (
    delivery ?? {
      mode: 'agent',
      pickupCode: null,
      pickupLocked: false,
      jobStatus: null,
      agentFirstName: null,
      vehicleType: null,
      returning: false,
      switchRequest: null,
    }
  );
}
