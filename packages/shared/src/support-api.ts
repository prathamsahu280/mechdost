/**
 * Response shapes of the support routes (`apps/api/src/routes/support.ts`, spec 09), for the web screens in real
 * sign-in builds to validate what they receive (hard rule 4). Loaded only by the API support screens (dynamic
 * import), never by demo bundles.
 */
import { z } from 'zod';
import { TICKET_STATES } from './state';

export const SUPPORT_TICKET_KINDS = [
  'order_issue',
  'refund',
  'fitment',
  'account',
  'labour_redo',
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
});
export type SupportMessageDto = z.infer<typeof SupportMessage>;

export const SupportTicket = z.object({
  code: z.string(),
  kind: Kind,
  status: Status,
  channel: Channel,
  orderCode: z.string().nullable(),
  slaAckDue: z.string(),
  slaResolveDue: z.string(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
  messages: z.array(SupportMessage),
});
export type SupportTicketDto = z.infer<typeof SupportTicket>;

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
  slaAckDue: z.string(),
  slaResolveDue: z.string(),
  createdAt: z.string(),
  version: z.number().int(),
  acknowledged: z.boolean(),
});
export type SupportInboxItemDto = z.infer<typeof SupportInboxItem>;
export const SupportInbox = z.object({ tickets: z.array(SupportInboxItem) });

/** The order codes of `GET /v1/orders` (only what the support form's "Order" choice needs). */
export const SupportOrderChoices = z.object({
  orders: z.array(z.object({ orders: z.array(z.object({ code: z.string() })) })),
});
