'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import type { DemoAccount } from '@/demo/session';
import { useOrders } from '@/demo/store';
import {
  BODY_MAX,
  DAILY_LIMIT,
  TICKET_KINDS,
  createTicket,
  customerReply,
  useTickets,
  type DemoTicket,
  type SupportError,
  type TicketKind,
} from '@/demo/support';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { TicketThread, useTicketLabels } from '@/components/support/ticket-thread';
import { portalCard, portalField, portalPrimary } from '@/components/portal/portal-guard';

const ERROR_LABEL = {
  empty: 'err_empty',
  too_long: 'err_too_long',
  limit: 'err_limit',
  stale: 'err_stale',
  not_allowed: 'err_not_allowed',
} as const satisfies Record<SupportError, string>;

/**
 * Account → Support (spec 09). Raise a request (optionally about an order; faulty/damaged/wrong parts are the
 * only route to a replacement or refund under the no-returns policy, spec 05) and follow the conversation.
 * `?order=CODE` preselects an order (link from the order page).
 */
/**
 * `?order=CODE` from the order page's "Report a problem" link. Read with `useSearchParams` (not
 * `window.location`): on a client-side navigation Next renders the new page before it updates the address bar
 * (bug found by e2e 2026-11-03).
 */
function usePresetOrder(): string | null {
  const code = useSearchParams().get('order');
  return code && ORDER_CODE.test(code) ? code : null;
}

const ORDER_CODE = /^MD-[A-Z]{3}-[0-9]{4}-[0-9A-Z]{6}$/;

export function SupportSection({ account }: { account: DemoAccount }) {
  const presetOrder = usePresetOrder();
  const t = useTranslations('support');
  const labels = useTicketLabels();
  const orders = useOrders();
  const tickets = useTickets().filter((ticket) => ticket.accountId === account.id);
  const [kind, setKind] = useState<TicketKind>(presetOrder ? 'order_issue' : 'other');
  const [orderCode, setOrderCode] = useState(presetOrder ?? '');
  const [body, setBody] = useState('');
  const [error, setError] = useState<SupportError | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = createTicket({
      accountId: account.id,
      customerName: account.name,
      kind,
      orderCode: orderCode || null,
      body,
    });
    if (!result.ok) {
      setError(result.error);
      document.getElementById('support-body')?.focus();
      return;
    }
    setError(null);
    setBody('');
    setSent(result.code);
    track('support_ticket', { action: 'created', kind, channel: 'web' });
  }

  return (
    <section aria-labelledby="support-title" className="space-y-5">
      <div>
        <h2 id="support-title" className="font-heading text-xl font-extrabold text-ink">
          {t('title')}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">{t('intro')}</p>
        <p className="mt-2 max-w-prose rounded-lg bg-private-bg p-3 text-sm text-private">
          {t('policyNote')}
        </p>
      </div>

      <form onSubmit={onSubmit} className={portalCard} noValidate>
        <h3 className="font-heading text-base font-extrabold text-ink">{t('new')}</h3>
        <div className="mt-3 grid gap-3 tab:grid-cols-2">
          <div>
            <label htmlFor="support-kind" className="text-xs font-bold text-muted">
              {t('kindLabel')}
            </label>
            <select
              id="support-kind"
              value={kind}
              onChange={(e) => {
                const next = TICKET_KINDS.find((k) => k === e.target.value);
                if (next) setKind(next);
              }}
              className={portalField}
            >
              {TICKET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {labels.kind(k)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="support-order" className="text-xs font-bold text-muted">
              {t('orderLabel')}
            </label>
            <select
              id="support-order"
              value={orderCode}
              onChange={(e) => {
                setOrderCode(e.target.value);
              }}
              className={portalField}
            >
              <option value="">{t('orderNone')}</option>
              {orders.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.code}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label htmlFor="support-body" className="mt-3 block text-xs font-bold text-muted">
          {t('messageLabel')}
        </label>
        <textarea
          id="support-body"
          rows={4}
          maxLength={BODY_MAX}
          value={body}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'support-error' : 'support-help'}
          onChange={(e) => {
            setBody(e.target.value);
            setSent(null);
          }}
          className={`${portalField} py-2`}
        />
        <p id="support-help" className="mt-1 text-xs text-muted">
          {t('messageHelp')}
        </p>
        {error ? (
          <p id="support-error" className="mt-1 text-sm font-bold text-error">
            {t(ERROR_LABEL[error], { max: error === 'limit' ? DAILY_LIMIT : BODY_MAX })}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" className={portalPrimary}>
            {t('send')}
          </button>
          <p role="status" className="text-sm font-bold text-success">
            {sent ? t('sent', { code: sent }) : null}
          </p>
        </div>
      </form>

      {tickets.length === 0 ? (
        <p className="rounded-card border border-line-card bg-surface p-5 text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="space-y-4">
          {tickets.map((ticket) => (
            <li key={ticket.code}>
              <CustomerTicket ticket={ticket} account={account} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CustomerTicket({ ticket, account }: { ticket: DemoTicket; account: DemoAccount }) {
  const t = useTranslations('support');
  const locale = useLocale();
  const labels = useTicketLabels();
  const [reply, setReply] = useState('');
  const [error, setError] = useState<SupportError | null>(null);
  const field = `reply-${ticket.code}`;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = customerReply(ticket.code, ticket.version, account.id, account.name, reply);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setReply('');
    track('support_ticket', { action: 'customer_reply', kind: ticket.kind, channel: ticket.channel });
  }

  return (
    <article className={portalCard} aria-labelledby={`${field}-title`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${field}-title`} className="font-heading text-base font-extrabold text-ink">
          {labels.kind(ticket.kind)} · {ticket.code}
        </h3>
        <span className="rounded-pill bg-pill px-3 py-1 text-xs font-bold text-ink">
          {labels.status(ticket.status)}
        </span>
      </div>
      {/* Only the parts that exist, joined: no dangling "·" once the ticket is acknowledged (QA 2026-11-14, P2). */}
      <p className="mt-1 text-xs text-muted">
        {[
          ticket.orderCode ? t('orderRef', { code: ticket.orderCode }) : null,
          ticket.acknowledgedAt ? null : t('ackBy', { date: formatDate(ticket.ackDue, locale) }),
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')}
      </p>
      <div className="mt-3">
        <TicketThread ticket={ticket} viewer="customer" />
      </div>
      {ticket.status === 'closed' ? null : (
        <form onSubmit={onSubmit} className="mt-3" noValidate>
          <label htmlFor={field} className="text-xs font-bold text-muted">
            {t('replyLabel')}
          </label>
          <textarea
            id={field}
            rows={2}
            maxLength={BODY_MAX}
            value={reply}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${field}-error` : undefined}
            onChange={(e) => {
              setReply(e.target.value);
            }}
            className={`${portalField} py-2`}
          />
          {error ? (
            <p id={`${field}-error`} className="mt-1 text-sm font-bold text-error">
              {t(ERROR_LABEL[error], { max: BODY_MAX })}
            </p>
          ) : null}
          <button type="submit" className={`${portalPrimary} mt-2`}>
            {t('sendReply')}
          </button>
        </form>
      )}
    </article>
  );
}
