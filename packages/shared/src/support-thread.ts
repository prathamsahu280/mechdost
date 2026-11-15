/**
 * Order and request threads with MechDost support (design 2026-11-15 "Support next tier", items 1 to 3; spec 09).
 * The customer talks to MechDost support only (never to a shop or workshop); this file holds the codes, limits and
 * response shapes the API and the website share (hard rules 4, 16). Photos reach the page only as short-lived URLs the
 * API issues after its rights check; no storage path ever appears here.
 */
import { z } from 'zod';
import { PHOTO_MAX_BYTES } from './service-photos';
import { RefundDestination, type RefundDestinationInput } from './refunds-api';
import { REFUND_REASONS } from './state';

/** Quick issue picks on an order or service request (rule 16: codes, free text only as the message). */
export const SUPPORT_ISSUE_CODES = [
  'wrong_part',
  'damaged',
  'missing_item',
  'late',
  'workshop_issue',
  'billing',
  'other',
] as const;
export type SupportIssueCode = (typeof SUPPORT_ISSUE_CODES)[number];
export const SupportIssueCode = z.enum(SUPPORT_ISSUE_CODES);

/** Issue codes that only make sense on one kind of subject (an order has no workshop; a service job no part). */
export const ORDER_ISSUE_CODES: readonly SupportIssueCode[] = [
  'wrong_part',
  'damaged',
  'missing_item',
  'late',
  'billing',
  'other',
];
export const SERVICE_ISSUE_CODES: readonly SupportIssueCode[] = [
  'late',
  'workshop_issue',
  'billing',
  'other',
];

export const SUPPORT_ATTACH_MAX = 4;
export const SUPPORT_ATTACH_BYTES = PHOTO_MAX_BYTES;
/** Photo messages per customer per window (an upload is the expensive call). */
export const SUPPORT_UPLOADS_PER_WINDOW = 20;
export const SUPPORT_UPLOAD_WINDOW_SECONDS = 600;
/** Opening or re-opening threads per customer per hour. */
export const SUPPORT_THREADS_PER_HOUR = 20;
/** Saving a payout destination per customer per hour (it is a guessable-field surface). */
export const SUPPORT_DESTINATIONS_PER_HOUR = 10;

export const SupportAttachment = z.object({
  id: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  thumbUrl: z.string(),
  largeUrl: z.string(),
});
export type SupportAttachmentDto = z.infer<typeof SupportAttachment>;

/** The customer's saved payout destination, as shown back: its kind and a masked form only. */
export const SupportDestination = z.object({
  kind: z.enum(['upi', 'bank']),
  masked: z.string(),
});
export type SupportDestinationDto = z.infer<typeof SupportDestination>;

export const SupportDestinationSaved = z.object({ destination: SupportDestination });

/** `ra***@okbank`, `••••1234 · HDFC0001234`: enough to recognise it, never the whole value. */
export function maskRefundDestination(d: RefundDestinationInput): string {
  if (d.kind === 'upi') {
    const [name = '', handle = ''] = d.upiId.split('@');
    return `${name.slice(0, 2)}***@${handle}`;
  }
  return `••••${d.accountNumber.slice(-4)} · ${d.ifsc}`;
}

/** Customer body of `PUT /support/tickets/{code}/refund-destination`: exactly the finance formats. */
export const SaveDestinationBody = RefundDestination;

/** Staff ask for the manual refund from the ticket: the amount and why; destination and order are the ticket's. */
export const TicketRefundBody = z
  .object({
    amountPaise: z.number().int().min(1).max(100_000_000),
    reasonCode: z.enum(REFUND_REASONS),
    note: z.string().trim().min(3).max(300).optional(),
  })
  .strict();

/** Refund state a ticket carries for the customer: only COD orders need a destination. */
export const SupportRefundInfo = z.object({
  /** The linked order was paid cash on delivery, so a refund goes to a UPI id or bank account the customer gives. */
  eligible: z.boolean(),
  destination: SupportDestination.nullable(),
});
export type SupportRefundInfoDto = z.infer<typeof SupportRefundInfo>;

export const SupportThreadOpened = z.object({ code: z.string(), reopened: z.boolean() });
export type SupportThreadOpenedDto = z.infer<typeof SupportThreadOpened>;

/** Stable error codes of the thread routes (the website translates them; hard rule 10). */
export const SUPPORT_THREAD_ERROR_CODES = [
  'ISSUE_NOT_FOR_SUBJECT',
  'SUBJECT_REQUIRED',
  'ATTACHMENT_LIMIT',
  'PHOTO_TYPE',
  'PHOTO_HEIC',
  'PHOTO_TOO_LARGE',
  'PHOTO_UNREADABLE',
  'PHOTOS_UNAVAILABLE',
  'DESTINATION_NOT_COD',
  'REFUND_NEEDS_DESTINATION',
] as const;
