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
import { RefundDestinationApi } from '@/components/support/refund-destination-api';
import { PhotoPicker, ThreadOpenerApi } from '@/components/support/thread-opener-api';
import { DeletionRequestApi } from '@/components/support/deletion-request-api';
import { sendPhotoMessage, threadErrorKey } from '@/lib/support-thread-api';
import { portalCard, portalField, portalPrimary, portalQuiet } from '@/components/portal/portal-styles';

/** A support-specific message, or a common one from `portal.api_common_err_*`. */
type Problem =
  | { ns: 'support'; key: SupportErrorKey }
  | { ns: 'portal'; key: CommonErrorKey }
  /** A `supportThread.*` error key (photo uploads). */
  | { ns: 'thread'; key: string };

function problemOf(code: string): Problem {
  const key = supportErrorKey(code);
  return key ? { ns: 'support', key } : { ns: 'portal', key: commonErrorKey(code) };
}

function useProblemText() {
  const t = useTranslations('support');
  const p = useTranslations('portal');
  const tt = useTranslations('supportThread');
  return (problem: Problem) =>
    problem.ns === 'support'
      ? t(problem.key, { max: problem.key === 'err_limit' ? SUPPORT_DAILY_LIMIT : SUPPORT_BODY_MAX })
      : problem.ns === 'thread'
        ? tt(problem.key as 'err_generic')
        : p(problem.key);
}

const SUPPORT_POLL_MS = 20_000;

/**
 * Account → Support on the API (spec 09; real sign-in builds, loaded by `support-section.tsx`). Same form and
 * conversation as the demo: raise a request (optionally about one of your orders), follow the thread and reply.
 */
export function SupportSectionApi({
  presetOrder,
  presetRedo,
  presetService,
}: {
  presetOrder: string | null;
  /** A billed service job (SR-…) to claim the labour promise on: the form is then a redo request (2026-11-15). */
  presetRedo: string | null;
  /** A service job (SR-…) to talk to support about: the thread opener (support threads, 2026-11-15). */
  presetService: string | null;
}) {
  // With an order or a job in the link, the thread opener replaces the free-form form (one main action).
  const subject = presetRedo
    ? null
    : presetOrder
      ? ({ kind: 'order', code: presetOrder } as const)
      : presetService
        ? ({ kind: 'service', code: presetService } as const)
        : null;
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

  // An admin's reply shows without a reload (QA 2026-11-16, bug 10): the tickets are re-read every 20 seconds while the
  // tab is visible, and at once when a hidden tab comes back (same pattern as orders, bookings and quotes).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, SUPPORT_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

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

      {subject ? <ThreadOpenerApi subject={subject} onOpened={load} /> : null}

      <DeletionRequestApi onOpened={load} />

      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className={portalCard}
        hidden={subject !== null}
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
              {SUPPORT_TICKET_KINDS.filter(
                (k) => (k !== 'labour_redo' || presetRedo) && k !== 'rsa_bill_dispute',
              ).map((k) => (
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
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const field = `reply-${ticket.code}`;
  const tt = useTranslations('supportThread');

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const local = bodyError(reply, SUPPORT_BODY_MAX);
    if (local) {
      setError({ ns: 'support', key: local });
      return;
    }
    setBusy(true);
    // With photos the message goes as a form to the photo route; without, the plain JSON reply.
    const res =
      files.length > 0
        ? await sendPhotoMessage(locale, ticket.code, reply.trim(), files)
        : await adminApi(locale, `/support/tickets/${ticket.code}/messages`, SupportReplied, {
            method: 'POST',
            body: { body: reply.trim() },
          });
    setBusy(false);
    if (!res.ok) {
      setError(files.length > 0 ? { ns: 'thread', key: threadErrorKey(res.code) } : problemOf(res.code));
      return;
    }
    setError(null);
    setReply('');
    track('support_ticket', { action: 'customer_reply', kind: ticket.kind, channel: ticket.channel });
    if (files.length > 0)
      track('support_ticket', { action: 'photos_attached', kind: ticket.kind, channel: 'web' });
    setFiles([]);
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
          ticket.issueCode ? tt('issueBadge', { issue: tt(`issue_${ticket.issueCode}`) }) : null,
          ticket.orderCode ? t('orderRef', { code: ticket.orderCode }) : null,
          ticket.serviceCode,
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
          <div className="mt-2">
            <PhotoPicker files={files} onChange={setFiles} label={tt('replyPhotos')} />
          </div>
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
      {ticket.status === 'closed' ? null : (
        <RefundDestinationApi code={ticket.code} refund={ticket.refund} onSaved={onChanged} />
      )}
    </article>
  );
}
