'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  SUPPORT_BODY_MAX,
  SUPPORT_DAILY_LIMIT,
  SUPPORT_TICKET_KINDS,
  SupportCreated,
  SupportOrderChoices,
  SupportReplied,
  SupportTicketList,
  type SupportTicketDto,
  type SupportTicketKind,
} from '@mechdost/shared/support-api';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import {
  acknowledged,
  bodyError,
  orderCodes,
  supportErrorKey,
  threadFromApi,
  type SupportErrorKey,
} from '@/lib/support-view';
import { TicketThread, useTicketLabels } from '@/components/support/ticket-thread';
import { portalCard, portalField, portalPrimary, portalQuiet } from '@/components/portal/portal-guard';

/** A support-specific message, or a common one from `portal.api_common_err_*`. */
type Problem = { ns: 'support'; key: SupportErrorKey } | { ns: 'portal'; key: CommonErrorKey };

function problemOf(code: string): Problem {
  const key = supportErrorKey(code);
  return key ? { ns: 'support', key } : { ns: 'portal', key: commonErrorKey(code) };
}

function useProblemText() {
  const t = useTranslations('support');
  const p = useTranslations('portal');
  return (problem: Problem) =>
    problem.ns === 'support'
      ? t(problem.key, { max: problem.key === 'err_limit' ? SUPPORT_DAILY_LIMIT : SUPPORT_BODY_MAX })
      : p(problem.key);
}

/**
 * Account → Support on the API (spec 09; real sign-in builds, loaded by `support-section.tsx`). Same form and
 * conversation as the demo: raise a request (optionally about one of your orders), follow the thread and reply.
 */
export function SupportSectionApi({
  presetOrder,
  presetRedo,
}: {
  presetOrder: string | null;
  /** A billed service job (SR-…) to claim the labour promise on: the form is then a redo request (2026-11-15). */
  presetRedo: string | null;
}) {
  const t = useTranslations('support');
  const p = useTranslations('portal');
  const locale = useLocale();
  const labels = useTicketLabels();
  const problemText = useProblemText();
  const [tickets, setTickets] = useState<SupportTicketDto[] | null>(null);
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);
  const [orders, setOrders] = useState<string[]>([]);
  const [kind, setKind] = useState<SupportTicketKind>(
    presetRedo ? 'labour_redo' : presetOrder ? 'order_issue' : 'other',
  );
  const [orderCode, setOrderCode] = useState(presetOrder ?? '');
  const [body, setBody] = useState('');
  const [error, setError] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/support/tickets', SupportTicketList);
    if (!res.ok) {
      setLoadError(commonErrorKey(res.code));
      return;
    }
    setLoadError(null);
    setTickets(res.data.tickets);
  }, [locale]);

  useEffect(() => {
    void load();
    void adminApi(locale, '/orders?limit=50', SupportOrderChoices).then((res) => {
      if (res.ok) setOrders(orderCodes(res.data.orders));
    });
  }, [load, locale]);

  const orderChoices = presetOrder && !orders.includes(presetOrder) ? [presetOrder, ...orders] : orders;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const local = bodyError(body, SUPPORT_BODY_MAX);
    if (local) {
      setError({ ns: 'support', key: local });
      document.getElementById('support-body')?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, '/support/tickets', SupportCreated, {
      method: 'POST',
      body: {
        kind,
        orderCode: presetRedo ? null : orderCode || null,
        ...(presetRedo ? { serviceCode: presetRedo } : {}),
        body: body.trim(),
      },
    });
    setBusy(false);
    if (!res.ok) {
      // A 404 on create means the chosen order is not this customer's (or no longer exists).
      setError(
        res.code === 'NOT_FOUND'
          ? { ns: 'support', key: presetRedo ? 'api_err_service' : 'api_err_order' }
          : problemOf(res.code),
      );
      document.getElementById('support-body')?.focus();
      return;
    }
    setError(null);
    setBody('');
    setSent(res.data.code);
    track('support_ticket', { action: 'created', kind, channel: 'web' });
    await load();
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

      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className={portalCard}
        noValidate
      >
        <h3 className="font-heading text-base font-extrabold text-ink">
          {presetRedo ? t('labourFormTitle', { code: presetRedo }) : t('new')}
        </h3>
        {presetRedo ? <p className="mt-1 text-sm text-muted">{t('labourFormIntro')}</p> : null}
        <div className="mt-3 grid gap-3 tab:grid-cols-2">
          <div>
            <label htmlFor="support-kind" className="text-xs font-bold text-muted">
              {t('kindLabel')}
            </label>
            <select
              id="support-kind"
              value={kind}
              onChange={(e) => {
                const next = SUPPORT_TICKET_KINDS.find((k) => k === e.target.value);
                if (next) setKind(next);
              }}
              className={portalField}
            >
              {SUPPORT_TICKET_KINDS.filter((k) => k !== 'labour_redo' || presetRedo).map((k) => (
                <option key={k} value={k}>
                  {labels.kind(k)}
                </option>
              ))}
            </select>
          </div>
          <div hidden={presetRedo !== null}>
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
              {orderChoices.map((code) => (
                <option key={code} value={code}>
                  {code}
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
          maxLength={SUPPORT_BODY_MAX}
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
            {problemText(error)}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className={portalPrimary}>
            {t('send')}
          </button>
          <p role="status" className="text-sm font-bold text-success">
            {busy ? <span className="text-muted">{p('api_common_saving')}</span> : null}
            {sent ? t('sent', { code: sent }) : null}
          </p>
        </div>
      </form>

      {loadError ? (
        <div role="alert" className={`${portalCard} space-y-3`}>
          <p className="text-sm font-bold text-error">{p(loadError)}</p>
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              setLoadError(null);
              void load();
            }}
          >
            {p('api_common_retry')}
          </button>
        </div>
      ) : tickets === null ? (
        <p role="status" className="rounded-card border border-line-card bg-surface p-5 text-sm text-muted">
          {p('api_common_loading')}
        </p>
      ) : tickets.length === 0 ? (
        <p className="rounded-card border border-line-card bg-surface p-5 text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="space-y-4">
          {tickets.map((ticket) => (
            <li key={ticket.code}>
              <CustomerTicket ticket={ticket} onChanged={load} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CustomerTicket({ ticket, onChanged }: { ticket: SupportTicketDto; onChanged: () => Promise<void> }) {
  const t = useTranslations('support');
  const locale = useLocale();
  const labels = useTicketLabels();
  const problemText = useProblemText();
  const [reply, setReply] = useState('');
  const [error, setError] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const field = `reply-${ticket.code}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const local = bodyError(reply, SUPPORT_BODY_MAX);
    if (local) {
      setError({ ns: 'support', key: local });
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/support/tickets/${ticket.code}/messages`, SupportReplied, {
      method: 'POST',
      body: { body: reply.trim() },
    });
    setBusy(false);
    if (!res.ok) {
      setError(problemOf(res.code));
      return;
    }
    setError(null);
    setReply('');
    track('support_ticket', { action: 'customer_reply', kind: ticket.kind, channel: ticket.channel });
    await onChanged();
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
      <p className="mt-1 text-xs text-muted">
        {[
          ticket.orderCode ? t('orderRef', { code: ticket.orderCode }) : null,
          acknowledged(ticket) ? null : t('ackBy', { date: formatDate(ticket.slaAckDue, locale) }),
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')}
      </p>
      <div className="mt-3">
        <TicketThread ticket={threadFromApi(ticket)} viewer="customer" />
      </div>
      {ticket.status === 'closed' ? null : (
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          className="mt-3"
          noValidate
        >
          <label htmlFor={field} className="text-xs font-bold text-muted">
            {t('replyLabel')}
          </label>
          <textarea
            id={field}
            rows={2}
            maxLength={SUPPORT_BODY_MAX}
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
              {problemText(error)}
            </p>
          ) : null}
          <button type="submit" disabled={busy} className={`${portalPrimary} mt-2`}>
            {t('sendReply')}
          </button>
        </form>
      )}
    </article>
  );
}
