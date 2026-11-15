import type { CustomerRefundStatus, SettleRefundInput } from '@mechdost/shared/refunds-api';
import type { RefundSettleOutcome, RefundSettleReason } from '@mechdost/shared/state';
import { parseRupees } from './money-input';

/** Message keys (namespace `refunds`) for what the refund screens can go wrong with. Explicit literals keep key checking. */
export type RefundErrorKey =
  | 'err_STALE_REFUND'
  | 'err_NOT_PENDING'
  | 'err_FOUR_EYES'
  | 'err_NOT_APPROVED'
  | 'err_REFUND_REFERENCE'
  | 'err_PROVIDER_HOLDS_REFUND'
  | 'err_PROVIDER_REFUND_ID_REQUIRED'
  | 'err_PROVIDER_AMOUNT_REQUIRED'
  | 'err_AMOUNT_DIFFERS_FROM_REPORT'
  | 'err_AMOUNT_SAME'
  | 'err_REFUND_EXCEEDS_PAYMENT'
  | 'err_NOT_UNSURE'
  | 'err_PROVIDER_ID_DIFFERS'
  | 'err_SETTLE_NOTE'
  | 'err_SETTLE_PROVIDER_ID'
  | 'err_SETTLE_AMOUNT'
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
  PROVIDER_HOLDS_REFUND: 'err_PROVIDER_HOLDS_REFUND',
  PROVIDER_REFUND_ID_REQUIRED: 'err_PROVIDER_REFUND_ID_REQUIRED',
  PROVIDER_AMOUNT_REQUIRED: 'err_PROVIDER_AMOUNT_REQUIRED',
  AMOUNT_DIFFERS_FROM_REPORT: 'err_AMOUNT_DIFFERS_FROM_REPORT',
  AMOUNT_SAME: 'err_AMOUNT_SAME',
  REFUND_EXCEEDS_PAYMENT: 'err_REFUND_EXCEEDS_PAYMENT',
  NOT_UNSURE: 'err_NOT_UNSURE',
  PROVIDER_ID_DIFFERS: 'err_PROVIDER_ID_DIFFERS',
  SETTLE_NOTE: 'err_SETTLE_NOTE',
  SETTLE_PROVIDER_ID: 'err_SETTLE_PROVIDER_ID',
  SETTLE_AMOUNT: 'err_SETTLE_AMOUNT',
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
  'settled_by_hand',
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

/** What finance fills in to settle an unsure refund (the form's own state, all strings). */
export interface SettleForm {
  outcome: RefundSettleOutcome;
  reasonCode: RefundSettleReason;
  note: string;
  providerRefundId: string;
  /** Rupees as typed, for `refunded_other_amount`. */
  amount: string;
}

export type SettleFormError = 'note' | 'providerRefundId' | 'amount';

const PROVIDER_REFUND_ID = /^rfnd_[A-Za-z0-9]{6,32}$/;

/**
 * The form → the API body, with the same rules the API enforces (a note of 10 to 300 characters, Razorpay's refund id
 * unless we already hold one, the amount in rupees → integer paise). The first problem is named so the screen can focus it.
 */
export function settleBody(
  version: number,
  form: SettleForm,
  opts: { hasProviderId?: boolean } = {},
): { ok: true; body: SettleRefundInput } | { ok: false; error: SettleFormError } {
  const note = form.note.trim();
  if (note.length < 10 || note.length > 300) return { ok: false, error: 'note' };
  const body: SettleRefundInput = { version, outcome: form.outcome, reasonCode: form.reasonCode, note };
  if (form.outcome === 'not_refunded') return { ok: true, body };
  const id = form.providerRefundId.trim();
  if (id !== '' || !opts.hasProviderId) {
    if (!PROVIDER_REFUND_ID.test(id)) return { ok: false, error: 'providerRefundId' };
    body.providerRefundId = id;
  }
  if (form.outcome === 'refunded_other_amount') {
    const amount = parseRupees(form.amount);
    if (!amount.ok) return { ok: false, error: 'amount' };
    body.providerAmountPaise = amount.paise;
  }
  return { ok: true, body };
}
