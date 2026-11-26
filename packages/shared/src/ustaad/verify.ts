/**
 * Verification evidence rules (spec 23 § 4 flow 2, SR-6, SR-7; plan task B4). Pure: the repository counts in SQL and
 * passes the numbers here; a refusal is a stable code the API maps to 422.
 */
import type { UstaadLevel, UstaadMemberStatus, UstaadVerificationState } from './codes';
import { levelAtLeast } from './levels';

const DAY_MS = 86_400_000;

export type VouchRefusal =
  'VOUCH_NOT_TRUSTED' | 'VOUCH_LEVEL' | 'VOUCH_ACCOUNT_AGE' | 'VOUCH_RECIPROCAL' | 'VOUCH_MONTHLY_CAP';

/**
 * SR-7: the voucher is verified and active (security review 2026-11-26: a restricted, banned, revoked or unverified
 * member who kept a level must not vouch), level ≥ `verify.vouch_min_level`, account ≥
 * `verify.vouch_min_account_days`, not reciprocal, ≤ cap a month.
 */
export function vouchRefusal(i: {
  voucher: {
    level: UstaadLevel;
    accountCreatedAt: Date;
    verificationState: UstaadVerificationState;
    status: UstaadMemberStatus;
  };
  /** The vouchee already vouched for the voucher (given or requested). */
  reciprocal: boolean;
  vouchesThisMonth: number;
  now: Date;
  minLevel: UstaadLevel;
  minAccountDays: number;
  perMonth: number;
}): VouchRefusal | null {
  if (i.voucher.verificationState !== 'verified' || i.voucher.status !== 'active') return 'VOUCH_NOT_TRUSTED';
  if (!levelAtLeast(i.voucher.level, i.minLevel) || i.voucher.level === 'ustaad_pending')
    return 'VOUCH_LEVEL';
  if (i.now.getTime() - i.voucher.accountCreatedAt.getTime() < i.minAccountDays * DAY_MS)
    return 'VOUCH_ACCOUNT_AGE';
  if (i.reciprocal) return 'VOUCH_RECIPROCAL';
  if (i.vouchesThisMonth >= i.perMonth) return 'VOUCH_MONTHLY_CAP';
  return null;
}

/**
 * Enough vouches for review: at least `needed` given, and (when 2 or more are needed) from at least 2 different
 * garages. Vouchers with no workshop share one bucket (an unproven garage is never "different").
 */
export function vouchesSufficient(
  given: readonly { voucherWorkshopId: string | null }[],
  needed: number,
): boolean {
  if (given.length < needed) return false;
  if (needed < 2) return true;
  const garages = new Set(given.map((g) => g.voucherWorkshopId ?? 'none'));
  return garages.size >= 2;
}

export type AttestationRefusal = 'ATTEST_BUSINESS_ID' | 'ATTEST_PHOTO' | 'ATTEST_QUARTER_CAP';

/**
 * SR-6: a verified MechDost workshop partner confirms directly; an owner not on MechDost needs a GSTIN or Udyam
 * number plus a shop photo pinned within `verify.attest_photo_max_m` of the member's garage pin. At most
 * `verify.attest_per_owner_quarter` attestations per owner per quarter.
 */
export function attestationRefusal(i: {
  ownerIsPartner: boolean;
  businessId: string | null;
  photoDistanceM: number | null;
  thisQuarter: number;
  perQuarter: number;
  maxM: number;
}): AttestationRefusal | null {
  if (i.thisQuarter >= i.perQuarter) return 'ATTEST_QUARTER_CAP';
  if (i.ownerIsPartner) return null;
  if (!i.businessId) return 'ATTEST_BUSINESS_ID';
  if (i.photoDistanceM === null || i.photoDistanceM > i.maxM) return 'ATTEST_PHOTO';
  return null;
}

/** GSTIN (15 characters) or Udyam (UDYAM-XX-00-0000000) shape; the number itself is checked by staff. */
export const BUSINESS_ID_RE = /^(?:\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]|UDYAM-[A-Z]{2}-\d{2}-\d{7})$/;
