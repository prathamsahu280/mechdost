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

export function refundErrorKey(code: string): RefundErrorKey {
  return KNOWN[code] ?? 'err_GENERIC';
}

/** The customer sees one line per refund; `declined` and `failed` point to support. */
export const customerRefundNeedsSupport = (status: CustomerRefundStatus): boolean =>
  status === 'declined' || status === 'failed';

/** A UTR / bank reference as finance types it: letters and digits, 6 to 35 characters (same rule as the API). */
export const isRefundReference = (value: string): boolean => /^[A-Za-z0-9]{6,35}$/.test(value.trim());
