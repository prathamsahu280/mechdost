'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  SUPPORT_BODY_MAX,
  SupportInbox,
  SupportReplied,
  SupportStatusChanged,
  SupportTicket,
  type SupportInboxItemDto,
  type SupportTicketDto,
} from '@mechdost/shared/support-api';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import {
  bodyError,
  inboxSla,
  isActive,
  supportErrorKey,
  threadFromApi,
  type SupportErrorKey,
} from '@/lib/support-view';
import { TicketThread, useTicketLabels } from '@/components/support/ticket-thread';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';

type Problem = { ns: 'support'; key: SupportErrorKey } | { ns: 'portal'; key: CommonErrorKey };

function problemOf(code: string): Problem {
  const key = supportErrorKey(code);
  return key ? { ns: 'support', key } : { ns: 'portal', key: commonErrorKey(code) };
}

/**
 * Admin → Support inbox on the API (spec 09; real sign-in builds, loaded by `admin-support.tsx`). The API answers
 * in the staff member's cities, earliest reply deadline first. Opening a request loads its conversation (internal
 * notes included); staff reply or add a note, and resolve or reopen it through the ticket state machine.
 */
export function AdminSupportApi() {
  const t = useTranslations('support');
  const p = useTranslations('portal');
  const locale = useLocale();
  const [filter, setFilter] = useState<'active' | 'done'>('active');
  const [items, setItems] = useState<SupportInboxItemDto[] | null>(null);
  const [error, setError] = useState<CommonErrorKey | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, `/admin/support/tickets?view=${filter}`, SupportInbox);
    if (!res.ok) {
      setError(commonErrorKey(res.code));
      return;
    }
    setError(null);
    setItems(res.data.tickets);
  }, [locale, filter]);

  useEffect(() => {
    void load();
  }, [load]);

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
              setItems(null);
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
      {error ? (
        <div role="alert" className={`${portalCard} space-y-3`}>
          <p className="text-sm font-bold text-error">{p(error)}</p>
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              setError(null);
              void load();
            }}
          >
            {p('api_common_retry')}
          </button>
        </div>
      ) : items === null ? (
        <p role="status" className="rounded-card border border-line-card bg-surface p-5 text-sm text-muted">
          {p('api_common_loading')}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-card border border-line-card bg-surface p-5 text-sm text-muted">
          {t('inboxEmpty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.code}>
              <InboxTicket
                item={item}
                open={openCode === item.code}
                onToggle={() => {
                  setOpenCode(openCode === item.code ? null : item.code);
                }}
                onChanged={load}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InboxTicket({
  item,
  open,
  onToggle,
  onChanged,
}: {
  item: SupportInboxItemDto;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('support');
  const p = useTranslations('portal');
  const locale = useLocale();
  const labels = useTicketLabels();
  const [ticket, setTicket] = useState<SupportTicketDto | null>(null);
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const sla = inboxSla(item);
  const field = `inbox-${item.code}`;

  const loadThread = useCallback(async () => {
    const res = await adminApi(locale, `/admin/support/tickets/${item.code}`, SupportTicket);
    if (!res.ok) {
      setLoadError(commonErrorKey(res.code));
      return;
    }
    setLoadError(null);
    setTicket(res.data);
  }, [locale, item.code]);

  useEffect(() => {
    if (open) void loadThread();
  }, [open, loadThread]);

  async function refresh() {
    await Promise.all([loadThread(), onChanged()]);
  }

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const local = bodyError(reply, SUPPORT_BODY_MAX);
    if (local) {
      setError({ ns: 'support', key: local });
      document.getElementById(field)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/admin/support/tickets/${item.code}/messages`, SupportReplied, {
      method: 'POST',
      body: { body: reply.trim(), internal },
    });
    setBusy(false);
    if (!res.ok) {
      setError(problemOf(res.code));
      return;
    }
    setError(null);
    setReply('');
    track('support_ticket', {
      action: internal ? 'internal_note' : 'staff_reply',
      kind: item.kind,
      channel: item.channel,
    });
    await refresh();
  }

  async function move(to: 'resolved' | 'in_review') {
    const version = ticket?.version ?? item.version;
    setBusy(true);
    const res = await adminApi(locale, `/admin/support/tickets/${item.code}/status`, SupportStatusChanged, {
      method: 'POST',
      body: { to, version },
    });
    setBusy(false);
    if (!res.ok) {
      setError(problemOf(res.code));
      await refresh();
      return;
    }
    setError(null);
    track('support_ticket', { action: 'status', to, channel: item.channel });
    await refresh();
  }

  const status = ticket?.status ?? item.status;
  const errorText = error
    ? error.ns === 'support'
      ? t(error.key, { max: SUPPORT_BODY_MAX })
      : p(error.key)
    : null;

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
            {item.channel === 'whatsapp' ? <span aria-hidden="true">💬 </span> : null}
            {labels.kind(item.kind)} · {item.code}
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            {[
              item.channel === 'whatsapp' ? t('viaWhatsApp') : null,
              item.orderCode ? t('orderRef', { code: item.orderCode }) : null,
              formatDate(item.createdAt, locale),
            ]
              .filter((part): part is string => part !== null)
              .join(' · ')}
          </span>
        </span>
        <span className="flex flex-wrap gap-2">
          {sla === 'ok' ? (
            item.acknowledged || !isActive(item.status) ? null : (
              <span className="rounded-pill bg-pill px-3 py-1 text-xs font-bold text-ink">
                {t('dueAck', { date: formatDate(item.slaAckDue, locale) })}
              </span>
            )
          ) : (
            <span className="rounded-pill bg-error px-3 py-1 text-xs font-bold text-white">
              {t(sla === 'ack_overdue' ? 'overdueAck' : 'overdueResolve')}
            </span>
          )}
          <span className="rounded-pill bg-pill px-3 py-1 text-xs font-bold text-ink">
            {labels.status(status)}
          </span>
        </span>
      </button>
      {open ? (
        <div id={`${field}-body`} className="mt-4 space-y-3">
          {loadError ? (
            <p role="alert" className="text-sm font-bold text-error">
              {p(loadError)}
            </p>
          ) : ticket === null ? (
            <p role="status" className="text-sm text-muted">
              {p('api_common_loading')}
            </p>
          ) : (
            <TicketThread ticket={threadFromApi(ticket)} viewer="staff" />
          )}
          {status === 'closed' || ticket === null ? null : (
            <form
              onSubmit={(e) => {
                void onSubmit(e);
              }}
              noValidate
            >
              <label htmlFor={field} className="text-xs font-bold text-muted">
                {t('staffReplyLabel')}
              </label>
              <textarea
                id={field}
                rows={3}
                maxLength={SUPPORT_BODY_MAX}
                value={reply}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${field}-error` : undefined}
                onChange={(e) => {
                  setReply(e.target.value);
                }}
                className={`${portalField} py-2`}
              />
              {item.channel === 'whatsapp' && !internal ? (
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
              {errorText ? (
                <p id={`${field}-error`} className="mt-1 text-sm font-bold text-error">
                  {errorText}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="submit" disabled={busy} className={portalPrimary}>
                  {t('sendStaff')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={portalQuiet}
                  onClick={() => {
                    void move(status === 'resolved' ? 'in_review' : 'resolved');
                  }}
                >
                  {t(status === 'resolved' ? 'reopen' : 'resolve')}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </article>
  );
}
