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
  attachments?: readonly { id: string; width: number; height: number; thumbUrl: string; largeUrl: string }[];
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
      attachments: m.attachments ?? [],
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
  | 'api_err_order'
  | 'api_err_labour'
  | 'api_err_labour_open'
  | 'api_err_service'
  | 'api_err_assignee';

/** API support codes → `support.*` messages; null = not a support-specific code (use the common message). */
export function supportErrorKey(code: string): SupportErrorKey | null {
  switch (code) {
    case 'TICKET_BODY_EMPTY':
      return 'err_empty';
    case 'TICKET_BODY_TOO_LONG':
      return 'err_too_long';
    case 'TICKET_DAILY_LIMIT':
      return 'err_limit';
    case 'LABOUR_PROMISE_UNAVAILABLE':
    case 'SERVICE_CODE_REQUIRED':
      return 'api_err_labour';
    case 'LABOUR_REDO_OPEN':
      return 'api_err_labour_open';
    case 'REPLY_LIMIT':
      return 'api_err_reply_limit';
    case 'ASSIGNEE_INVALID':
      return 'api_err_assignee';
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

/** Rupees typed by staff ("499" or "499.50", commas allowed) → whole paise by string maths; null when invalid or above ₹10,00,000. */
export function rupeesTextToPaise(text: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.replace(/[,\s₹]/g, ''));
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return paise >= 1 && paise <= 100_000_000 ? paise : null;
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
