/**
 * Response shapes of the support routes (`apps/api/src/routes/support.ts`, spec 09), for the web screens in real
 * sign-in builds to validate what they receive (hard rule 4). Loaded only by the API support screens (dynamic
 * import), never by demo bundles.
 */
import { z } from 'zod';
import { TICKET_STATES } from './state';
import { SUPPORT_ISSUE_CODES, SupportAttachment, SupportRefundInfo } from './support-thread';
import { SupportAgent } from './support-inbox';
import { SLA_STATES } from './support-sla';

export const SUPPORT_TICKET_KINDS = [
  'order_issue',
  'refund',
  'fitment',
  'account',
  'labour_redo',
  'deletion_request',
  'other',
] as const;
export type SupportTicketKind = (typeof SUPPORT_TICKET_KINDS)[number];
/** Same limits as the API (`TICKET_BODY_MAX`, `DAILY_TICKET_LIMIT` in packages/db). */
export const SUPPORT_BODY_MAX = 2000;
export const SUPPORT_DAILY_LIMIT = 5;

const Kind = z.enum(SUPPORT_TICKET_KINDS).catch('other');
const Status = z.enum(TICKET_STATES);
/** Where the request came from; anything new reads as the website until the screens know it. */
const Channel = z.enum(['web', 'whatsapp']).catch('web');

export const SupportMessage = z.object({
  id: z.string(),
  role: z.string(),
  body: z.string(),
  internal: z.boolean(),
  channel: z.string(),
  createdAt: z.string(),
  /** Photos sent with the message, as short-lived signed URLs (design 2026-11-15). */
  attachments: z.array(SupportAttachment).default([]),
});
export type SupportMessageDto = z.infer<typeof SupportMessage>;

export const SupportTicket = z.object({
  code: z.string(),
  kind: Kind,
  status: Status,
  channel: Channel,
  orderCode: z.string().nullable(),
  /** Quick issue of an order/request thread; an unknown code reads as "other", null on older requests. */
  issueCode: z.enum(SUPPORT_ISSUE_CODES).nullable().catch(null).default(null),
  serviceCode: z.string().nullable().default(null),
  /** COD refund: whether the customer must give a payout destination, and the masked one they gave. */
  refund: SupportRefundInfo.default({ eligible: false, destination: null }),
  /** Account deletion requests: when support confirmed it; null otherwise. */
  deletionConfirmedAt: z.string().nullable().default(null),
  slaAckDue: z.string(),
  slaResolveDue: z.string(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
  messages: z.array(SupportMessage),
});
export type SupportTicketDto = z.infer<typeof SupportTicket>;

/** Staff-only block of an inbox thread: who asked, who owns it, the first-reply clock (design 2026-11-15 item 4). */
export const SupportStaffMeta = z.object({
  customerName: z.string().nullable(),
  customerPhoneMasked: z.string().nullable(),
  isGuest: z.boolean(),
  assignee: SupportAgent.nullable(),
  assignedAt: z.string().nullable(),
  firstRepliedAt: z.string().nullable(),
  sla: z.enum(SLA_STATES),
  deletionConfirmedAt: z.string().nullable().default(null),
});
export const SupportInboxTicket = SupportTicket.extend({ staff: SupportStaffMeta });
export type SupportInboxTicketDto = z.infer<typeof SupportInboxTicket>;

export const SupportTicketList = z.object({ tickets: z.array(SupportTicket) });
export const SupportCreated = z.object({ code: z.string() });
export const SupportReplied = z.object({ status: Status });
export const SupportStatusChanged = z.object({ status: Status, version: z.number().int() });

export const SupportInboxItem = z.object({
  code: z.string(),
  kind: Kind,
  status: Status,
  channel: Channel,
  orderCode: z.string().nullable(),
  issueCode: z.enum(SUPPORT_ISSUE_CODES).nullable().catch(null).default(null),
  slaAckDue: z.string(),
  slaResolveDue: z.string(),
  createdAt: z.string(),
  version: z.number().int(),
  acknowledged: z.boolean(),
  serviceCode: z.string().nullable().default(null),
  firstRepliedAt: z.string().nullable().default(null),
  /** First-reply clock: met once staff answered, overdue after the deadline (support hours, IST). */
  sla: z.enum(SLA_STATES).catch('on_track').default('on_track'),
  customerName: z.string().nullable().default(null),
  customerPhoneMasked: z.string().nullable().default(null),
  isGuest: z.boolean().default(false),
  assignee: SupportAgent.nullable().default(null),
});
export type SupportInboxItemDto = z.infer<typeof SupportInboxItem>;
export const SupportInbox = z.object({ tickets: z.array(SupportInboxItem) });

/** The order codes of `GET /v1/orders` (only what the support form's "Order" choice needs). */
export const SupportOrderChoices = z.object({
  orders: z.array(z.object({ orders: z.array(z.object({ code: z.string() })) })),
});
