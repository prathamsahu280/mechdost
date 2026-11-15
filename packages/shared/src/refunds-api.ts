/**
 * Refund requests (spec 05, decision 2026-11-15 "All need approval"): the shapes of the admin queue and of the
 * customer's order page. Shared by the API routes (request/response schemas) and the web screens (validation of what
 * they receive, hard rule 4). Amounts are integer paise; times ISO strings.
 */
import { z } from 'zod';
import {
  REFUND_REASONS,
  REFUND_REJECT_REASONS,
  REFUND_SETTLE_OUTCOMES,
  REFUND_SETTLE_REASONS,
  REFUND_SOURCES,
  REFUND_STATES,
  type RefundStatus,
} from './state';

/** Admin queue views: waiting for a decision, past the approval SLA, on its way to the customer, finished. */
export const ADMIN_REFUND_VIEWS = ['waiting', 'overdue', 'in_progress', 'attention', 'closed'] as const;
export type AdminRefundView = (typeof ADMIN_REFUND_VIEWS)[number];

/** What the customer sees. Never "refunded" before Razorpay confirms; `declined` and `failed` point to support. */
export const CUSTOMER_REFUND_STATUSES = [
  'under_review',
  'processing',
  'refunded',
  'declined',
  'failed',
] as const;
export type CustomerRefundStatus = (typeof CUSTOMER_REFUND_STATUSES)[number];

export function customerRefundStatus(status: RefundStatus): CustomerRefundStatus {
  switch (status) {
    case 'requested':
      return 'under_review';
    case 'approved':
    case 'initiated':
    case 'needs_reconciliation':
      return 'processing';
    case 'processed':
      return 'refunded';
    case 'rejected':
      return 'declined';
    case 'failed':
      return 'failed';
  }
}

/** One refund on a sub-order, as its customer sees it. No staff names, notes or reason codes of the decision. */
export const CustomerRefundDto = z.object({
  status: z.enum(CUSTOMER_REFUND_STATUSES),
  amountPaise: z.number().int().min(1),
  requestedAt: z.string(),
  processedAt: z.string().nullable(),
});
export type CustomerRefund = z.infer<typeof CustomerRefundDto>;

/** Staff cannot invent the two system sources: a rejected or cancelled order creates its own request. */
export const STAFF_REFUND_SOURCES = ['unfulfilled', 'support_claim', 'part_refund', 'other'] as const;

/**
 * Where a cash-on-delivery refund is paid by hand (Q104, user 2026-11-15): the customer gives a UPI id or bank details
 * on the support ticket; staff enter them here. Stored encrypted (`refunds.destination_enc`), shown masked, revealed
 * in full only to the finance approver once the refund is approved.
 */
export const RefundDestination = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('upi'),
      upiId: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('bank'),
      accountName: z.string().trim().min(2).max(80),
      accountNumber: z
        .string()
        .trim()
        .regex(/^[0-9]{9,18}$/),
      ifsc: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
    })
    .strict(),
]);
export type RefundDestinationInput = z.infer<typeof RefundDestination>;

/** Cash-on-delivery refunds are `bank_upi` (paid by hand); prepaid ones go back through Razorpay (`source`). */
export const REFUND_MODES = ['source', 'bank_upi'] as const;

/** A manual payout is recorded with its UTR / bank reference. */
export const MarkRefundPaidBody = z
  .object({
    version: z.number().int().min(1),
    reference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{6,35}$/),
  })
  .strict();

export const RefundDestinationDto = z.object({ destination: RefundDestination });

const Note = z.string().trim().min(3).max(300);
const Version = z.number().int().min(1);

/** Staff ask for a refund (a support claim, a part refund, an order that could not be fulfilled). */
export const CreateRefundBody = z
  .object({
    orderCode: z.string().regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}-\d{1,2}$/),
    amountPaise: z.number().int().min(1).max(100_000_000),
    source: z.enum(STAFF_REFUND_SOURCES),
    reasonCode: z.enum(REFUND_REASONS),
    note: Note.optional(),
    /** Required for a cash-on-delivery order (paid by hand), refused for an order paid online. */
    destination: RefundDestination.optional(),
  })
  .strict();
export type CreateRefundInput = z.infer<typeof CreateRefundBody>;

export const ApproveRefundBody = z.object({ version: Version }).strict();
export const RejectRefundBody = z
  .object({ version: Version, reasonCode: z.enum(REFUND_REJECT_REASONS), note: Note.optional() })
  .strict();

/**
 * Finance settles a `needs_reconciliation` refund after checking Razorpay (`refunds:approve`, never the one who asked).
 * `refunded_full` / `refunded_other_amount` carry Razorpay's refund id (`rfnd_...`) unless we already stored it;
 * `refunded_other_amount` also carries the amount Razorpay actually refunded. `not_refunded` frees the amount.
 */
export const SettleRefundBody = z
  .object({
    version: Version,
    outcome: z.enum(REFUND_SETTLE_OUTCOMES),
    reasonCode: z.enum(REFUND_SETTLE_REASONS),
    note: z.string().trim().min(10).max(300),
    providerRefundId: z
      .string()
      .trim()
      .regex(/^rfnd_[A-Za-z0-9]{6,32}$/)
      .optional(),
    providerAmountPaise: z.number().int().min(1).max(100_000_000).optional(),
  })
  .strict();
export type SettleRefundInput = z.infer<typeof SettleRefundBody>;

/** The credit note issued for a processed refund of an invoiced order (spec 05 "Credit notes"). */
export const RefundCreditNoteDto = z.object({
  number: z.string(),
  totalPaise: z.number().int(),
  issuedAt: z.string(),
});
export type RefundCreditNote = z.infer<typeof RefundCreditNoteDto>;

export const AdminRefundDto = z.object({
  id: z.string(),
  status: z.enum(REFUND_STATES),
  version: z.number().int(),
  source: z.enum(REFUND_SOURCES),
  reasonCode: z.enum(REFUND_REASONS),
  note: z.string().nullable(),
  amountPaise: z.number().int(),
  orderCode: z.string().nullable(),
  groupCode: z.string(),
  paymentMethod: z.string().nullable(),
  /** `source` = back through Razorpay; `bank_upi` = finance pays by hand (cash on delivery). */
  mode: z.enum(REFUND_MODES),
  /** Masked destination of a manual payout (`ra***@okhdfc`, `••••1234 · HDFC0001234`), else null. */
  destinationMasked: z.string().nullable(),
  /** UTR / bank reference finance recorded when it paid by hand. */
  manualReference: z.string().nullable(),
  /** Who asked: a staff user id, or null when the system did (order rejected or cancelled). */
  requestedBy: z.string().nullable(),
  approvedBy: z.string().nullable(),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  processedAt: z.string().nullable(),
  rejectReasonCode: z.enum(REFUND_REJECT_REASONS).nullable(),
  failureCode: z.string().nullable(),
  /** Amount Razorpay reported when it differed from ours (status `needs_reconciliation`), else null. */
  providerReportedPaise: z.number().int().nullable(),
  /** Razorpay's refund id once it exists (support looks it up in the dashboard). */
  providerRefundId: z.string().nullable(),
  /** Who settled an unsure refund by hand and why (null otherwise). */
  settleReasonCode: z.enum(REFUND_SETTLE_REASONS).nullable(),
  /** The credit note for this refund when its order had a tax invoice; null otherwise. */
  creditNote: RefundCreditNoteDto.nullable(),
  /** Still `requested` after `refunds.approval_sla_hours`. */
  overdue: z.boolean(),
  /** The signed-in staff member may approve it (right permission and not the one who asked). */
  canApprove: z.boolean(),
  /** The signed-in staff member may settle it by hand (it is unsure and they are not the one who asked). */
  canSettle: z.boolean(),
});
export type AdminRefund = z.infer<typeof AdminRefundDto>;

export const AdminRefundPageDto = z.object({
  items: z.array(AdminRefundDto),
  nextCursor: z.string().nullable(),
  /** For the Overview tile: refunds waiting for approval, and how many are past the SLA. */
  counts: z.object({ waiting: z.number().int(), overdue: z.number().int(), attention: z.number().int() }),
});
export type AdminRefundPage = z.infer<typeof AdminRefundPageDto>;
