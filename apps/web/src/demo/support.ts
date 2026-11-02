'use client';

import { useSyncExternalStore } from 'react';
import { ticketMachine, type TicketStatus } from '@mechdost/shared/state';

/**
 * Support tickets (spec 09; demo store — production = `support_tickets` + `ticket_messages`, same rules):
 * customers raise a request (faulty/damaged/wrong part claims are the only route under the no-returns policy,
 * spec 05), staff answer from the admin inbox, every status change goes through `ticketMachine`. WhatsApp
 * messages arrive as tickets with channel `whatsapp` (bridge in the worker); one is seeded so the inbox shows it.
 * Self-contained store, synced across tabs through `storage` events.
 */
export const SUPPORT_KEY = 'mechdost-demo-support';

export const TICKET_KINDS = ['order_issue', 'refund', 'fitment', 'account', 'other'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];
export type TicketChannel = 'web' | 'whatsapp';

export interface TicketMessage {
  id: string;
  role: 'customer' | 'guest' | 'staff' | 'system';
  author: string;
  body: string;
  internal: boolean;
  channel: TicketChannel | 'console';
  at: string;
}

export interface DemoTicket {
  code: string;
  /** Demo account id, or null for a guest (WhatsApp number only). */
  accountId: string | null;
  customerName: string;
  kind: TicketKind;
  orderCode: string | null;
  status: TicketStatus;
  channel: TicketChannel;
  createdAt: string;
  /** Acknowledge within 48 h (Consumer Protection E-Commerce Rules), resolve within 30 days. */
  ackDue: string;
  resolveDue: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  messages: TicketMessage[];
  version: number;
}

export const BODY_MAX = 2000;
export const DAILY_LIMIT = 5;
const ACK_MS = 48 * 3_600_000;
const RESOLVE_MS = 30 * 86_400_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function code(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((b) => CROCKFORD[b % 32] ?? '0').join('');
  return `REQ-RPR-${String(new Date().getFullYear())}-${suffix}`;
}

function id(): string {
  return crypto.randomUUID();
}

function seed(): DemoTicket[] {
  const at = new Date(Date.now() - 3 * 3_600_000).toISOString();
  return [
    {
      code: 'REQ-RPR-2026-WA7K2Q',
      accountId: null,
      customerName: '+91 98111 11111',
      kind: 'other',
      orderCode: null,
      status: 'open',
      channel: 'whatsapp',
      createdAt: at,
      ackDue: new Date(Date.parse(at) + ACK_MS).toISOString(),
      resolveDue: new Date(Date.parse(at) + RESOLVE_MS).toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      messages: [
        {
          id: 'seed-wa-1',
          role: 'guest',
          author: '+91 98111 11111',
          body: 'Do you deliver Exide batteries to Tatibandh?',
          internal: false,
          channel: 'whatsapp',
          at,
        },
      ],
      version: 1,
    },
  ];
}

interface Stored {
  tickets: DemoTicket[];
}

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(SUPPORT_KEY);
    if (!raw) return { tickets: seed() };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return { tickets: Array.isArray(parsed.tickets) ? parsed.tickets : seed() };
  } catch {
    return { tickets: seed() };
  }
}

let cached: { raw: string | null; value: Stored } | null = null;
const EMPTY: Stored = { tickets: [] };

function snapshot(): Stored {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SUPPORT_KEY);
  } catch {
    raw = null;
  }
  if (cached?.raw === raw) return cached.value;
  cached = { raw, value: read() };
  return cached.value;
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SUPPORT_KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function write(next: Stored): boolean {
  try {
    window.localStorage.setItem(SUPPORT_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  for (const cb of listeners) cb();
  return true;
}

export function useTickets(): readonly DemoTicket[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot().tickets,
    () => EMPTY.tickets,
  );
}

export type SupportError = 'empty' | 'too_long' | 'limit' | 'stale' | 'not_allowed';

function cleanBody(body: string): { text: string } | { error: 'empty' | 'too_long' } {
  const text = body.trim();
  if (text.length === 0) return { error: 'empty' };
  if (text.length > BODY_MAX) return { error: 'too_long' };
  return { text };
}

/** Customer raises a request (rate limited to 5 a day, spec 09). */
export function createTicket(input: {
  accountId: string;
  customerName: string;
  kind: TicketKind;
  orderCode: string | null;
  body: string;
}): { ok: true; code: string } | { ok: false; error: SupportError } {
  const clean = cleanBody(input.body);
  if ('error' in clean) return { ok: false, error: clean.error };
  const body = clean.text;
  const s = read();
  const dayAgo = Date.now() - 86_400_000;
  const today = s.tickets.filter((t) => t.accountId === input.accountId && Date.parse(t.createdAt) > dayAgo);
  if (today.length >= DAILY_LIMIT) return { ok: false, error: 'limit' };
  const now = new Date();
  const ticket: DemoTicket = {
    code: code(),
    accountId: input.accountId,
    customerName: input.customerName,
    kind: TICKET_KINDS.includes(input.kind) ? input.kind : 'other',
    orderCode: input.orderCode,
    status: 'open',
    channel: 'web',
    createdAt: now.toISOString(),
    ackDue: new Date(now.getTime() + ACK_MS).toISOString(),
    resolveDue: new Date(now.getTime() + RESOLVE_MS).toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
    messages: [
      {
        id: id(),
        role: 'customer',
        author: input.customerName,
        body,
        internal: false,
        channel: 'web',
        at: now.toISOString(),
      },
    ],
    version: 1,
  };
  write({ tickets: [ticket, ...s.tickets] });
  return { ok: true, code: ticket.code };
}

function update(
  ticketCode: string,
  expectedVersion: number,
  change: (t: DemoTicket) => DemoTicket | SupportError,
): { ok: true } | { ok: false; error: SupportError } {
  const s = read();
  const current = s.tickets.find((t) => t.code === ticketCode);
  if (current?.version !== expectedVersion) return { ok: false, error: 'stale' };
  const next = change(current);
  if (typeof next === 'string') return { ok: false, error: next };
  write({
    tickets: s.tickets.map((t) => (t.code === ticketCode ? { ...next, version: expectedVersion + 1 } : t)),
  });
  return { ok: true };
}

/** The customer writes again: a ticket waiting on them, or resolved, goes back to review (state machine). */
export function customerReply(
  ticketCode: string,
  expectedVersion: number,
  accountId: string,
  author: string,
  body: string,
) {
  const clean = cleanBody(body);
  if ('error' in clean) return { ok: false as const, error: clean.error };
  const text = clean.text;
  return update(ticketCode, expectedVersion, (t) => {
    if (t.accountId !== accountId || t.status === 'closed') return 'not_allowed';
    const reopen = t.status === 'awaiting_customer' || t.status === 'resolved';
    if (reopen) ticketMachine.assert(t.status, 'in_review', 'customer');
    return {
      ...t,
      status: reopen ? 'in_review' : t.status,
      resolvedAt: reopen ? null : t.resolvedAt,
      messages: [
        ...t.messages,
        {
          id: id(),
          role: 'customer',
          author,
          body: text,
          internal: false,
          channel: 'web',
          at: new Date().toISOString(),
        },
      ],
    };
  });
}

/**
 * Staff reply (to the customer, or an internal note). A customer-facing reply acknowledges the ticket and moves
 * it to "waiting for you"; on a WhatsApp ticket it is sent on WhatsApp (free within 24 h of their last message).
 */
export function staffReply(
  ticketCode: string,
  expectedVersion: number,
  author: string,
  body: string,
  internal: boolean,
) {
  const clean = cleanBody(body);
  if ('error' in clean) return { ok: false as const, error: clean.error };
  const text = clean.text;
  return update(ticketCode, expectedVersion, (t) => {
    if (t.status === 'closed') return 'not_allowed';
    const now = new Date().toISOString();
    const toCustomer = !internal && (t.status === 'open' || t.status === 'in_review');
    if (toCustomer) ticketMachine.assert(t.status, 'awaiting_customer', 'admin');
    return {
      ...t,
      status: toCustomer ? 'awaiting_customer' : t.status,
      acknowledgedAt: t.acknowledgedAt ?? (internal ? null : now),
      messages: [
        ...t.messages,
        {
          id: id(),
          role: 'staff',
          author,
          body: text,
          internal,
          channel: internal ? 'console' : t.channel,
          at: now,
        },
      ],
    };
  });
}

export function setTicketStatus(ticketCode: string, expectedVersion: number, to: TicketStatus) {
  return update(ticketCode, expectedVersion, (t) => {
    if (!ticketMachine.canActor(t.status, to, 'admin')) return 'not_allowed';
    const now = new Date().toISOString();
    return {
      ...t,
      status: to,
      acknowledgedAt: t.acknowledgedAt ?? now,
      resolvedAt: to === 'resolved' ? now : to === 'in_review' ? null : t.resolvedAt,
    };
  });
}

/** Response-time state for the inbox: overdue acknowledgement or resolution. */
export function slaState(t: DemoTicket, now = Date.now()): 'ok' | 'ack_overdue' | 'resolve_overdue' {
  if (t.status === 'resolved' || t.status === 'closed') return 'ok';
  if (!t.acknowledgedAt && Date.parse(t.ackDue) < now) return 'ack_overdue';
  if (Date.parse(t.resolveDue) < now) return 'resolve_overdue';
  return 'ok';
}
