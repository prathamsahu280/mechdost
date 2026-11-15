/**
 * Pure helpers of the shop portal's next tier, part 1 (design 2026-11-15): which offers are still open, the words for
 * API codes, form checks and the confirmation shown after a step. No React, no i18n runtime: unit-tested.
 */

const KNOWN_ERRORS = [
  'INVITE_OPEN',
  'ALREADY_MEMBER',
  'TEAM_FULL',
  'INVITE_INVALID',
  'OWNER_ONLY',
  'CANNOT_REMOVE_SELF',
  'CANNOT_REMOVE_OWNER',
  'NOT_FOUND',
  'INVITE_USED',
  'INVITE_CLOSED',
  'INVITE_EXPIRED',
  'MEMBER_IS_STAFF',
  'NETWORK',
  'RATE_LIMITED',
] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

export type Tier1ErrorKey = `err_${KnownError}` | 'err_generic';

/** An API error code → the `shopTier1.err_*` key (anything unknown → the generic line). */
export function tier1ErrorKey(code: string): Tier1ErrorKey {
  const known = KNOWN_ERRORS.find((k) => k === code);
  return known ? `err_${known}` : 'err_generic';
}

/**
 * Offers whose timer has not run out. An offer disappears at its expiry on the client (assessment 2026-11-15, item
 * 2) instead of sitting at "0 min" until the next poll. An offer without an end time is kept.
 */
export function liveOffers<T extends { expiresAt: string | null }>(offers: readonly T[], now: number): T[] {
  return offers.filter((o) => {
    if (!o.expiresAt) return true;
    const end = Date.parse(o.expiresAt);
    return Number.isNaN(end) || end > now;
  });
}

export const STAFF_NAME_MIN = 2;
export const STAFF_NAME_MAX = 60;

export function isValidStaffName(value: string): boolean {
  const n = value.trim().length;
  return n >= STAFF_NAME_MIN && n <= STAFF_NAME_MAX;
}

/** An Indian mobile as the API takes it: 10 digits from 6 to 9, optional +91, spaces and dashes allowed. */
export function isValidIndianMobile(value: string): boolean {
  return /^(\+91)?[6-9][0-9]{9}$/.test(value.trim().replace(/[\s-]/g, ''));
}

/** The confirmation to show after a fulfilment step, by the last step that went through. */
export type StepFlash = 'flashPacked' | 'flashOut';
export function stepFlashKey(lastStep: 'packed' | 'shipped' | 'out_for_delivery'): StepFlash {
  return lastStep === 'packed' ? 'flashPacked' : 'flashOut';
}
