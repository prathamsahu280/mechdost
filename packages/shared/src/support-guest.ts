/**
 * Guest tickets (design 2026-11-15 "Support next tier", item 6; spec 09 and 13): a request without an account. The
 * guest gets a reference and a private key (shown once, stored only as a hash) and comes back with both. Nothing is
 * ever sent to the number a guest typed (it is unverified; project rule: no relay from public forms), so the key is
 * the only way back. Shapes and limits shared by the API and the website.
 */
import { z } from 'zod';
import { SupportTicket } from './support-api';

/** What a guest can ask about: no order or service job is linked (they are not signed in), so no refund or redo. */
export const GUEST_TICKET_KINDS = ['order_issue', 'fitment', 'account', 'other'] as const;
export type GuestTicketKind = (typeof GUEST_TICKET_KINDS)[number];

export const GUEST_BODY_MAX = 2000;
export const GUEST_NAME_MAX = 60;
/** Tickets per phone number a day (database check), per IP an hour (rate limit). */
export const GUEST_TICKETS_PER_PHONE_PER_DAY = 3;
export const GUEST_TICKETS_PER_IP_PER_HOUR = 5;
/** Lookups and replies: per IP in 10 minutes, and per reference in an hour (key guessing). */
export const GUEST_LOOKUPS_PER_IP = 30;
export const GUEST_LOOKUPS_PER_CODE = 10;

export const GUEST_KEY_RE = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z\s-]{16,24}$/;
export const TICKET_CODE_RE = /^REQ-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/;

export const GuestTicketBody = z
  .object({
    name: z.string().trim().min(2).max(GUEST_NAME_MAX),
    phone: z.string().trim().min(10).max(20),
    kind: z.enum(GUEST_TICKET_KINDS),
    body: z.string().trim().min(1).max(GUEST_BODY_MAX),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict();

export const GuestLookupBody = z
  .object({
    code: z.string().regex(TICKET_CODE_RE),
    key: z.string().regex(GUEST_KEY_RE),
  })
  .strict();

export const GuestReplyBody = GuestLookupBody.extend({
  body: z.string().trim().min(1).max(GUEST_BODY_MAX),
}).strict();

export const GuestCreated = z.object({ code: z.string(), accessKey: z.string() });
export type GuestCreatedDto = z.infer<typeof GuestCreated>;
/** A guest sees the conversation only: no SLA clocks, no staff block, no refund state. */
export const GuestTicket = SupportTicket;
export const GuestReplied = z.object({ status: SupportTicket.shape.status });

/** Stable error codes the guest screens translate (hard rule 10). */
export const GUEST_ERROR_CODES = [
  'GUEST_DAILY_LIMIT',
  'GUEST_PHONE_INVALID',
  'TURNSTILE_FAILED',
  'NOT_FOUND',
  'TICKET_CLOSED',
  'REPLY_LIMIT',
  'RATE_LIMITED',
] as const;
