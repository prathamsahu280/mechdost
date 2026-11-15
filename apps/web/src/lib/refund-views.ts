import type { CustomerRefundStatus } from '@mechdost/shared/refunds-api';

/** Message keys (namespace `refunds`) for what the refund screens can go wrong with. Explicit literals keep key checking. */
export type RefundErrorKey =
  | 'err_STALE_REFUND'
  | 'err_NOT_PENDING'
  | 'err_FOUR_EYES'
  | 'err_NOT_APPROVED'
  | 'err_REFUND_REFERENCE'
  | 'err_FORBIDDEN'
  | 'err_NOT_FOUND'
  | 'err_NETWORK'
  | 'err_GENERIC';

const KNOWN: Record<string, RefundErrorKey> = {
  STALE_REFUND: 'err_STALE_REFUND',
  NOT_PENDING: 'err_NOT_PENDING',
  FOUR_EYES: 'err_FOUR_EYES',
  NOT_APPROVED: 'err_NOT_APPROVED',
  REFUND_REFERENCE: 'err_REFUND_REFERENCE',
  VALIDATION: 'err_REFUND_REFERENCE',
  FORBIDDEN: 'err_FORBIDDEN',
  STAFF_2FA_REQUIRED: 'err_FORBIDDEN',
  NOT_FOUND: 'err_NOT_FOUND',
  NETWORK: 'err_NETWORK',
  UNAVAILABLE: 'err_NETWORK',
};

const FAILURES = [
  'bad_request_error',
  'gateway_error',
  'server_error',
  'razorpay_failed',
  'dispatch_exhausted',
  'provider_amount_mismatch',
  'payment_not_captured',
] as const;
export type RefundFailureKey = `failure_${(typeof FAILURES)[number] | 'other'}`;

/** A stored failure code (ours or the payment partner's, any letter case) → `refunds.failure_*`; unknown codes get the general wording, never the raw code. */
export function refundFailureKey(code: string): RefundFailureKey {
  const known = FAILURES.find((f) => f === code.toLowerCase());
  return known ? `failure_${known}` : 'failure_other';
}

export function refundErrorKey(code: string): RefundErrorKey {
  return KNOWN[code] ?? 'err_GENERIC';
}

/** The customer sees one line per refund; `declined` and `failed` point to support. */
export const customerRefundNeedsSupport = (status: CustomerRefundStatus): boolean =>
  status === 'declined' || status === 'failed';

/** A UTR / bank reference as finance types it: letters and digits, 6 to 35 characters (same rule as the API). */
export const isRefundReference = (value: string): boolean => /^[A-Za-z0-9]{6,35}$/.test(value.trim());
