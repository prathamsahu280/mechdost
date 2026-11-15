'use client';

import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import {
  BODY_MAX,
  setTicketStatus,
  slaState,
  staffReply,
  useTickets,
  type DemoTicket,
  type SupportError,
} from '@/demo/support';
import { AUTH_MODE } from '@/lib/auth/mode';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { TicketThread, useTicketLabels } from '@/components/support/ticket-thread';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

const ERROR_LABEL = {
  empty: 'err_empty',
  too_long: 'err_too_long',
  limit: 'err_limit',
  stale: 'err_stale',
  not_allowed: 'err_not_allowed',
} as const satisfies Record<SupportError, string>;

const ACTIVE = new Set(['open', 'in_review', 'awaiting_customer']);

/** Support agents see masked numbers (spec 09/13); the full number is revealed only through an audited action. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return value;
  return `+${digits.slice(0, 2)} ${digits.slice(2, 4)}•••••${digits.slice(-2)}`;
}

/** The inbox on the API (real sign-in builds only): loaded on demand so demo bundles stay the same size. */
const AdminSupportApi = dynamic(() => import('./admin-support-api').then((m) => m.AdminSupportApi), {
  ssr: false,
});

/**
 * Admin → Support inbox (spec 09). Requests from the website and WhatsApp, oldest response deadline first,
 * overdue ones flagged. Staff reply to the customer (moves the request to "waiting for the customer"; on WhatsApp
 * requests the reply goes out on WhatsApp) or add an internal note, and resolve or reopen it — all through the
 * ticket state machine.
 */
export function AdminSupport({ actor }: { actor: string }) {
  return AUTH_MODE === 'firebase' ? <AdminSupportApi /> : <DemoSupportInbox actor={actor} />;
}

function DemoSupportInbox({ actor }: { actor: string }) {
  const t = useTranslations('support');
  const [filter, setFilter] = useState<'active' | 'done'>('active');
  const tickets = [...useTickets()]
    .filter((ticket) => (filter === 'active' ? ACTIVE.has(ticket.status) : !ACTIVE.has(ticket.status)))
    .sort((a, b) => Date.parse(a.ackDue) - Date.parse(b.ackDue));
  const [openCode, setOpenCode] = useState<string | null>(null);

  return (
    <section aria-labelledby="inbox-title" className="space-y-4">
      <div>
        <h2 id="inbox-title" className="font-heading text-xl font-extrabold text-ink">
          {t('inboxTitle')}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">{t('inboxIntro')}</p>
      </div>
      <div role="group" aria-label={t('filterLabel')} className="flex flex-wrap gap-2">
        {(['active', 'done'] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
            }}
            className={`press min-h-11 rounded-pill px-4 text-sm font-bold ${
              filter === f ? 'bg-accent-soft text-accent-soft-text' : 'bg-pill text-ink'
            }`}
          >
            {t(f === 'active' ? 'filter_active' : 'filter_done')}
          </button>
        ))}
      </div>
      {tickets.length === 0 ? (
        <p className="rounded-card border border-line-card bg-surface p-5 text-sm text-muted">
          {t('inboxEmpty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {tickets.map((ticket) => (
            <li key={ticket.code}>
              <InboxTicket
                ticket={ticket}
                actor={actor}
                open={openCode === ticket.code}
                onToggle={() => {
                  setOpenCode(openCode === ticket.code ? null : ticket.code);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InboxTicket({
  ticket,
  actor,
  open,
  onToggle,
}: {
  ticket: DemoTicket;
  actor: string;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('support');
  const locale = useLocale();
  const labels = useTicketLabels();
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<SupportError | null>(null);
  const sla = slaState(ticket);
  const field = `inbox-${ticket.code}`;
  const name = ticket.accountId ? ticket.customerName : maskPhone(ticket.customerName);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = staffReply(ticket.code, ticket.version, actor, reply, internal);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setReply('');
    track('support_ticket', {
      action: internal ? 'internal_note' : 'staff_reply',
      kind: ticket.kind,
      channel: ticket.channel,
    });
  }

  function move(to: 'resolved' | 'in_review') {
    const result = setTicketStatus(ticket.code, ticket.version, to);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    track('support_ticket', { action: 'status', to, channel: ticket.channel });
  }

  return (
    <article className={portalCard}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${field}-body`}
        onClick={onToggle}
        className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
      >
        <span>
          <span className="block font-heading text-base font-extrabold text-ink">
            {ticket.channel === 'whatsapp' ? <span aria-hidden="true">💬 </span> : null}
            {labels.kind(ticket.kind)} · {ticket.code}
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            {t('from', { name })}
            {ticket.channel === 'whatsapp' ? ` · ${t('viaWhatsApp')}` : null}
            {ticket.orderCode ? ` · ${t('orderRef', { code: ticket.orderCode })}` : null}
          </span>
        </span>
        <span className="flex flex-wrap gap-2">
          {sla === 'ok' ? (
            ticket.acknowledgedAt || !ACTIVE.has(ticket.status) ? null : (
              <span className="rounded-pill bg-pill px-3 py-1 text-xs font-bold text-ink">
                {t('dueAck', { date: formatDate(ticket.ackDue, locale) })}
              </span>
            )
          ) : (
            <span className="rounded-pill bg-error px-3 py-1 text-xs font-bold text-white">
              {t(sla === 'ack_overdue' ? 'overdueAck' : 'overdueResolve')}
            </span>
          )}
          <span className="rounded-pill bg-pill px-3 py-1 text-xs font-bold text-ink">
            {labels.status(ticket.status)}
          </span>
        </span>
      </button>
      {open ? (
        <div id={`${field}-body`} className="mt-4 space-y-3">
          <TicketThread ticket={ticket} viewer="staff" />
          {ticket.status === 'closed' ? null : (
            <form onSubmit={onSubmit} noValidate>
              <label htmlFor={field} className="text-xs font-bold text-muted">
                {t('staffReplyLabel')}
              </label>
              <textarea
                id={field}
                rows={3}
                maxLength={BODY_MAX}
                value={reply}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${field}-error` : undefined}
                onChange={(e) => {
                  setReply(e.target.value);
                }}
                className={`${portalField} py-2`}
              />
              {ticket.channel === 'whatsapp' && !internal ? (
                <p className="mt-1 text-xs text-muted">{t('whatsAppNote')}</p>
              ) : null}
              <label className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={internal}
                  onChange={(e) => {
                    setInternal(e.target.checked);
                  }}
                  className="size-5 accent-[var(--color-accent-button)]"
                />
                {t('internalToggle')}
              </label>
              {error ? (
                <p id={`${field}-error`} className="mt-1 text-sm font-bold text-error">
                  {t(ERROR_LABEL[error], { max: BODY_MAX })}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="submit" className={portalPrimary}>
                  {t('sendStaff')}
                </button>
                {ticket.status === 'resolved' ? (
                  <button
                    type="button"
                    className={portalQuiet}
                    onClick={() => {
                      move('in_review');
                    }}
                  >
                    {t('reopen')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={portalQuiet}
                    onClick={() => {
                      move('resolved');
                    }}
                  >
                    {t('resolve')}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      ) : null}
    </article>
  );
}
