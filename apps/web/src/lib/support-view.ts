/**
 * View helpers for Support in real sign-in builds (spec 09; Stream D 2026-11-14): map the API's tickets to what the
 * thread shows, its error codes to the screen's messages, and the response-time state for the inbox.
 */
export interface ApiMessage {
  id: string;
  role: string;
  body: string;
  internal: boolean;
  channel: string;
  createdAt: string;
}

export interface ApiThreadTicket {
  status: string;
  messages: readonly ApiMessage[];
}

/** The API's messages as the shared thread component shows them (no author names: the API does not send any). */
export function threadFromApi(ticket: { messages: readonly ApiMessage[] }) {
  return {
    messages: ticket.messages.map((m) => ({
      id: m.id,
      role: m.role,
      body: m.body,
      internal: m.internal,
      channel: m.channel,
      at: m.createdAt,
    })),
  };
}

/** A customer's request counts as acknowledged once staff answered it or moved it on from "open". */
export function acknowledged(ticket: ApiThreadTicket): boolean {
  return ticket.status !== 'open' || ticket.messages.some((m) => m.role === 'staff' && !m.internal);
}

export type SupportErrorKey =
  | 'err_empty'
  | 'err_too_long'
  | 'err_limit'
  | 'err_stale'
  | 'err_not_allowed'
  | 'api_err_reply_limit'
  | 'api_err_order';

/** API support codes → `support.*` messages; null = not a support-specific code (use the common message). */
export function supportErrorKey(code: string): SupportErrorKey | null {
  switch (code) {
    case 'TICKET_BODY_EMPTY':
      return 'err_empty';
    case 'TICKET_BODY_TOO_LONG':
      return 'err_too_long';
    case 'TICKET_DAILY_LIMIT':
      return 'err_limit';
    case 'REPLY_LIMIT':
      return 'api_err_reply_limit';
    case 'TICKET_CLOSED':
      return 'err_not_allowed';
    case 'STALE_TICKET':
    case 'CONFLICT':
      return 'err_stale';
    default:
      return null;
  }
}

/** Checks the API would refuse, done first so the error shows next to the field without a round trip. */
export function bodyError(body: string, max: number): 'err_empty' | 'err_too_long' | null {
  const text = body.trim();
  if (text.length === 0) return 'err_empty';
  return text.length > max ? 'err_too_long' : null;
}

const ACTIVE = new Set(['open', 'in_review', 'awaiting_customer']);

/** Response-time state of an inbox row: overdue acknowledgement or resolution (same rule as the demo inbox). */
export function inboxSla(
  item: { status: string; acknowledged: boolean; slaAckDue: string; slaResolveDue: string },
  now = Date.now(),
): 'ok' | 'ack_overdue' | 'resolve_overdue' {
  if (!ACTIVE.has(item.status)) return 'ok';
  if (!item.acknowledged && Date.parse(item.slaAckDue) < now) return 'ack_overdue';
  if (Date.parse(item.slaResolveDue) < now) return 'resolve_overdue';
  return 'ok';
}

export function isActive(status: string): boolean {
  return ACTIVE.has(status);
}

/** Every order code of the customer's `GET /v1/orders` answer, newest first, without repeats. */
export function orderCodes(groups: readonly { orders: readonly { code: string }[] }[]): string[] {
  return [...new Set(groups.flatMap((g) => g.orders.map((o) => o.code)))];
}
