'use client';

import Image from 'next/image';
import { useLocale } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { REPORT_REASONS, REPORT_TARGETS } from '@mechdost/shared/ustaad/codes';
import {
  ModerationResultDto,
  ReportQueuePageDto,
  StaffMediaUrlDto,
  ThreadReadDto,
  type ConsoleCaps,
  type StaffMediaUrl,
} from '@mechdost/shared/ustaad/dto/console';
import {
  DM_READ_REASONS,
  ReportDetailDto,
  USTAAD_REPORT_CODE_RE,
  type ModerationDecision,
  type ReportDetail,
  type ReportQueueItem,
} from '@mechdost/shared/ustaad/dto/moderation';
import { TICKET_CODE_RE } from '@mechdost/shared/support-guest';
import { adminApi } from '@/lib/admin-api';
import { canConfirmBan, canDecideAppeal, decisionsFor } from '@/lib/admin-ustaad-console';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { ConfirmDialog } from '../admin-settings-workbench';
import { LoadState } from '../admin-site-api';
import { StatusBadge, adminCard } from '../admin-ui';
import { portalField, portalPrimary, portalQuiet } from '../portal-styles';
import {
  ClockBadge,
  SectionHead,
  StatusLine,
  labelClass,
  useConsoleT,
  useErrorText,
  useFormatWhen,
} from './console-common';
import { ustaadAuditKind } from '@/lib/ustaad-audit-labels';

type Queue = 'open' | 'held' | 'appealed';
type ViewReason = (typeof DM_READ_REASONS)[number];
const KEEP_REASONS = ['no_violation', 'context_ok', 'duplicate_report'] as const;
type Status = { tone: 'ok' | 'error'; text: string } | null;

/**
 * Queue, Holds and Appeals (spec 23 § 13; task G2): the reports sorted by clock (child safety first), filters by
 * reason, surface and city, then one report with its item (masked text, blurred files, the conversation only through
 * an audited read) and the one decision form the caller may use. Four-eyes shows as "waiting for approval": the
 * proposer never sees the approve button, the decider never decides the appeal. The API checks every call.
 */
export function ReportsSection({ queue, caps, headId }: { queue: Queue; caps: ConsoleCaps; headId: string }) {
  const c = useConsoleT();
  const locale = useLocale();
  const baseId = useId();
  const [items, setItems] = useState<ReportQueueItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState('');
  const [city, setCity] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [listMsg, setListMsg] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      const q = new URLSearchParams({ queue });
      if (reason) q.set('reason', reason);
      if (target) q.set('target', target);
      if (city) q.set('city', city);
      if (cursor) q.set('cursor', cursor);
      const res = await adminApi(
        locale,
        `/admin/ustaad/moderation/reports?${q.toString()}`,
        ReportQueuePageDto,
      );
      if (!res.ok) {
        setLoadError(commonErrorKey(res.code));
        return;
      }
      setLoadError(null);
      setItems((prev) => {
        const all = cursor && prev ? [...prev, ...res.data.items] : res.data.items;
        setListMsg(c('list_count', { count: all.length }));
        return all;
      });
      setNext(res.data.nextCursor);
    },
    // `c` is a stable translator for the page's language.
    [locale, queue, reason, target, city],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const title = queue === 'open' ? 'sec_queue' : queue === 'held' ? 'sec_holds' : 'sec_appeals';
  const empty = queue === 'open' ? 'empty_queue' : queue === 'held' ? 'empty_holds' : 'empty_appeals';

  return (
    <div className="space-y-4">
      <SectionHead id={headId} title={c(title)} help={c(`${title}_help`)} />
      {!caps.moderate ? (
        <p role="note" className="rounded-tile bg-pill px-4 py-3 text-sm text-ink">
          {c('readonly')}
        </p>
      ) : null}

      <div className={`${adminCard} grid gap-3 tab:grid-cols-3`}>
        <label className="space-y-1">
          <span className={labelClass}>{c('filter_reason')}</span>
          <select
            className={portalField}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          >
            <option value="">{c('filter_any')}</option>
            {REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {c(`reason_${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>{c('filter_target')}</span>
          <select
            className={portalField}
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
            }}
          >
            <option value="">{c('filter_any')}</option>
            {REPORT_TARGETS.map((r) => (
              <option key={r} value={r}>
                {c(`target_${r}`)}
              </option>
            ))}
          </select>
        </label>
        {caps.cities === null || caps.cities.length > 1 ? (
          <label className="space-y-1">
            <span className={labelClass}>{c('filter_city')}</span>
            <select
              className={portalField}
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
              }}
            >
              <option value="">{c('filter_any')}</option>
              {(caps.cities ?? []).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {queue === 'appealed' && caps.moderate ? <LinkAppeal onLinked={() => void load()} /> : null}

      <StatusLine tone={null}>{listMsg}</StatusLine>
      {items !== null && loadError ? <LoadState error={loadError} onRetry={() => void load()} /> : null}
      {items === null ? (
        <LoadState error={loadError} onRetry={() => void load()} />
      ) : (
        <div className="grid gap-4 min-[1200px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] min-[1200px]:items-start">
          <section aria-labelledby={`${baseId}-list`} className="min-w-0 space-y-2">
            <h4 id={`${baseId}-list`} className="sr-only">
              {c('list_label')}
            </h4>
            {items.length === 0 ? (
              <p className={`${adminCard} text-sm text-muted`}>{c(empty)}</p>
            ) : (
              <ul className="space-y-2">
                {items.map((it) => (
                  <li key={it.code}>
                    <button
                      type="button"
                      aria-current={selected === it.code ? 'true' : undefined}
                      onClick={() => {
                        setSelected(it.code);
                      }}
                      className={`press w-full rounded-tile border p-3 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                        selected === it.code
                          ? 'border-accent bg-accent-soft'
                          : 'border-line-card bg-surface hover:bg-pill'
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-ink">{c(`reason_${it.reasonCode}`)}</span>
                        <span className="text-sm text-muted">· {c(`target_${it.targetType}`)}</span>
                        {it.minor ? <StatusBadge tone="danger">{c('child_safety')}</StatusBadge> : null}
                        {it.banWaiting ? (
                          <StatusBadge tone="warning">{c('waiting_approval')}</StatusBadge>
                        ) : null}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                        {queue === 'appealed' ? (
                          <StatusBadge code={it.status}>{c(`status_${it.status}`)}</StatusBadge>
                        ) : (
                          <ClockBadge clock={it.clock} dueAt={it.dueAt} createdAt={it.createdAt} />
                        )}
                        <span className="text-xs text-muted">
                          {it.code}
                          {it.cityCode ? ` · ${it.cityCode}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {next ? (
              <button type="button" className={portalQuiet} onClick={() => void load(next)}>
                {c('more')}
              </button>
            ) : null}
          </section>
          <div className="min-w-0">
            {selected ? (
              <ReportPanel
                key={selected}
                code={selected}
                queue={queue}
                caps={caps}
                onChanged={() => void load()}
              />
            ) : (
              <p className={`${adminCard} text-sm text-muted`}>{c('detail_empty')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReportPanel({
  code,
  queue,
  caps,
  onChanged,
}: {
  code: string;
  queue: Queue;
  caps: ConsoleCaps;
  onChanged: () => void;
}) {
  const c = useConsoleT();
  const locale = useLocale();
  const when = useFormatWhen();
  const titleId = useId();
  const [d, setD] = useState<ReportDetail | null>(null);
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);
  const [viewReason, setViewReason] = useState<ViewReason>('report_review');
  const [result, setResult] = useState<Status>(null);
  const [focusTitle, setFocusTitle] = useState(true);

  const load = useCallback(async () => {
    const res = await adminApi(locale, `/admin/ustaad/moderation/reports/${code}`, ReportDetailDto);
    if (!res.ok) {
      setLoadError(commonErrorKey(res.code));
      return;
    }
    setLoadError(null);
    setD(res.data);
  }, [locale, code]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening a report (and finishing a decision) puts the keyboard on the report's heading.
  useEffect(() => {
    if (!focusTitle || !d) return;
    document.getElementById(titleId)?.focus();
    setFocusTitle(false);
  }, [focusTitle, d, titleId]);

  if (!d) return <LoadState error={loadError} onRetry={() => void load()} />;
  const refresh = () => {
    void load();
    onChanged();
    setFocusTitle(true);
  };
  const decisions = queue === 'appealed' ? [] : decisionsFor(d, caps, queue === 'held' ? 'held' : 'open');

  return (
    <article aria-labelledby={titleId} className={`${adminCard} space-y-4`}>
      <header className="space-y-2">
        <h4 id={titleId} tabIndex={-1} className="font-heading text-base font-extrabold text-ink">
          {c('detail_title', { code: d.code })}
        </h4>
        {loadError ? <LoadState error={loadError} onRetry={() => void load()} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <ClockBadge clock={d.clock} dueAt={d.dueAt} createdAt={d.createdAt} />
          <StatusBadge code={d.status}>{c(`status_${d.status}`)}</StatusBadge>
          {d.minor ? <StatusBadge tone="danger">{c('child_safety')}</StatusBadge> : null}
        </div>
        <dl className="grid gap-x-4 gap-y-1 text-sm tab:grid-cols-[auto_1fr]">
          <dt className="font-bold text-ink">{c('d_reason')}</dt>
          <dd>{c(`reason_${d.reasonCode}`)}</dd>
          <dt className="font-bold text-ink">{c('d_source')}</dt>
          <dd>{c(`source_${d.source}`)}</dd>
          <dt className="font-bold text-ink">{c('d_item')}</dt>
          <dd>
            {c(`target_${d.targetType}`)}
            {d.contentStatus
              ? ` · ${c('d_item_status', { status: c(`item_status_${['visible', 'held', 'removed'].includes(d.contentStatus) ? d.contentStatus : 'other'}`) })}`
              : ''}
          </dd>
          {d.author ? (
            <>
              <dt className="font-bold text-ink">{c('d_author')}</dt>
              <dd>
                <span data-user-content>
                  {d.author.displayName} (@{d.author.handle})
                </span>{' '}
                · {c(`mstatus_${d.author.status}`)} · {c('d_strikes', { count: d.author.activeStrikes })}
              </dd>
            </>
          ) : null}
        </dl>
      </header>

      {d.targetType === 'message' ? (
        <p className="text-sm text-muted">{c('d_text_message')}</p>
      ) : (
        <blockquote
          data-user-content
          className="whitespace-pre-wrap break-words rounded-tile bg-pill p-3 text-sm text-ink"
        >
          {d.text ?? c('d_text_none')}
        </blockquote>
      )}
      {d.note ? (
        <div className="space-y-1">
          <p className={labelClass}>{c('d_note')}</p>
          <p data-user-content className="whitespace-pre-wrap break-words text-sm text-ink">
            {d.note}
          </p>
        </div>
      ) : null}

      {(d.mediaIds.length > 0 || d.targetType === 'message') && caps.moderate ? (
        <label className="block max-w-sm space-y-1">
          <span className={labelClass}>{c('view_reason')}</span>
          <select
            className={portalField}
            value={viewReason}
            onChange={(e) => {
              setViewReason(e.target.value as ViewReason);
            }}
          >
            {DM_READ_REASONS.map((r) => (
              <option key={r} value={r}>
                {c(`view_reason_${r}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {d.mediaIds.length > 0 && caps.moderate ? (
        <section className="space-y-2" aria-label={c('media_title')}>
          <p className="text-xs text-muted">{c('media_audited')}</p>
          <ul className="grid gap-3 tab:grid-cols-2">
            {d.mediaIds.map((id, i) => (
              <li key={id}>
                <MediaTile code={d.code} mediaId={id} n={i + 1} reason={viewReason} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {d.targetType === 'message' && caps.moderate && ['open', 'in_review', 'appealed'].includes(d.status) ? (
        <ThreadRead code={d.code} reason={viewReason} />
      ) : null}

      <section className="space-y-2">
        <h5 className={labelClass}>{c('d_history')}</h5>
        {d.actions.length === 0 ? (
          <p className="text-sm text-muted">{c('d_history_empty')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.actions.map((a) => (
              <li key={`${a.action}-${a.at}`}>
                {c(`audit_${ustaadAuditKind(a.action)}`)} · <span className="text-muted">{when(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.pendingBan ? (
        <PendingBan detail={d} caps={caps} onDone={refresh} onResult={setResult} />
      ) : decisions.length > 0 ? (
        <DecisionForm
          detail={d}
          decisions={decisions}
          held={queue === 'held'}
          onDone={refresh}
          onResult={setResult}
        />
      ) : null}

      {queue === 'appealed' && d.status === 'appealed' ? (
        canDecideAppeal(d, caps) ? (
          <AppealDecision detail={d} onDone={refresh} onResult={setResult} />
        ) : caps.moderate ? (
          <p className="rounded-tile bg-warning-bg p-3 text-sm text-warning">{c('appeal_yours')}</p>
        ) : null
      ) : null}
      <StatusLine tone={result?.tone ?? null}>{result?.text}</StatusLine>
    </article>
  );
}

/** One file of the reported item: hidden until asked (audited), then blurred until "Show clearly". */
function MediaTile({
  code,
  mediaId,
  n,
  reason,
}: {
  code: string;
  mediaId: string;
  n: number;
  reason: ViewReason;
}) {
  const c = useConsoleT();
  const locale = useLocale();
  const [file, setFile] = useState<StaffMediaUrl | null>(null);
  const [clear, setClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorText = useErrorText();
  const shown = useRef<HTMLElement | null>(null);
  const keep = (el: HTMLElement | null) => {
    shown.current = el;
  };
  useEffect(() => {
    if (file) shown.current?.focus();
  }, [file]);

  async function show() {
    if (busy) return;
    setBusy(true);
    const res = await adminApi(
      locale,
      `/admin/ustaad/moderation/reports/${code}/media/${mediaId}?reason=${reason}`,
      StaffMediaUrlDto,
    );
    setBusy(false);
    track('admin_ustaad_console_action', { action: 'media_view', outcome: res.ok ? 'ok' : 'refused' });
    if (!res.ok) {
      setError(res.code === 'USTAAD_MEDIA_RESTRICTED' ? c('media_restricted') : errorText(res.code));
      return;
    }
    setFile(res.data);
  }

  return (
    <div className="space-y-2 rounded-tile border border-line-card p-3">
      <p className="text-sm font-bold text-ink">{c('media_label', { n })}</p>
      {!file ? (
        <div className="flex min-h-32 flex-col items-start justify-center gap-2 rounded-tile bg-pill p-3">
          <p className="text-sm text-muted">{c('media_hidden')}</p>
          <button type="button" aria-disabled={busy} className={portalQuiet} onClick={() => void show()}>
            {c('media_show')}
          </button>
        </div>
      ) : file.kind === 'image' ? (
        <div className="overflow-hidden rounded-tile bg-pill">
          <Image
            src={file.url}
            alt={c('media_alt', { n })}
            width={480}
            height={360}
            unoptimized
            className={`h-auto max-h-80 w-full object-contain transition-[filter] motion-reduce:transition-none ${clear ? '' : 'blur-xl'}`}
          />
        </div>
      ) : file.kind === 'video' ? (
        <video
          src={file.url}
          controls
          preload="none"
          className={`max-h-80 w-full rounded-tile ${clear ? '' : 'blur-xl'}`}
        >
          <track kind="captions" />
        </video>
      ) : file.kind === 'audio' ? (
        <audio ref={keep} src={file.url} controls preload="none" className="w-full" />
      ) : (
        <a
          ref={keep}
          href={file.url}
          download
          target="_blank"
          rel="noopener noreferrer"
          className={portalQuiet}
        >
          {c('media_download', { n })}
        </a>
      )}
      {file && (file.kind === 'image' || file.kind === 'video') ? (
        <button
          ref={keep}
          type="button"
          aria-pressed={clear}
          className={portalQuiet}
          onClick={() => {
            setClear((v) => !v);
          }}
        >
          {c('media_reveal')}
        </button>
      ) : null}
      <StatusLine tone={error ? 'error' : null}>{error}</StatusLine>
    </div>
  );
}

/** The reported conversation: only on request, with the reason, audited by the API (SR-38). */
function ThreadRead({ code, reason }: { code: string; reason: ViewReason }) {
  const c = useConsoleT();
  const locale = useLocale();
  const when = useFormatWhen();
  const errorText = useErrorText();
  const [messages, setMessages] = useState<
    { id: string; sender: string; body: string | null; at: string; reported: boolean }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (messages) list.current?.focus();
  }, [messages]);

  async function read() {
    if (busy) return;
    setBusy(true);
    const res = await adminApi(
      locale,
      `/admin/ustaad/moderation/reports/${code}/thread?reason=${reason}`,
      ThreadReadDto,
    );
    setBusy(false);
    track('admin_ustaad_console_action', { action: 'thread_read', outcome: res.ok ? 'ok' : 'refused' });
    if (!res.ok) {
      setError(errorText(res.code));
      return;
    }
    setMessages(res.data.messages);
  }

  return (
    <section className="space-y-2">
      <p className="text-xs text-muted">{c('thread_note')}</p>
      {messages === null ? (
        <button type="button" aria-disabled={busy} className={portalQuiet} onClick={() => void read()}>
          {c('thread_read')}
        </button>
      ) : (
        <ol ref={list} tabIndex={-1} aria-label={c('thread_title')} className="space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-tile p-2 text-sm ${m.reported ? 'border-2 border-error bg-error-bg' : 'bg-pill'}`}
            >
              <span className="font-bold" data-user-content>
                @{m.sender}
              </span>{' '}
              <span className="text-xs text-muted">{when(m.at)}</span>
              {m.reported ? (
                <span className="ml-2 text-xs font-bold text-error">{c('thread_reported')}</span>
              ) : null}
              <p data-user-content className="whitespace-pre-wrap break-words">
                {m.body ?? ''}
              </p>
            </li>
          ))}
        </ol>
      )}
      <StatusLine tone={error ? 'error' : null}>{error}</StatusLine>
    </section>
  );
}

function DecisionForm({
  detail,
  decisions,
  held,
  onDone,
  onResult,
}: {
  detail: ReportDetail;
  decisions: ModerationDecision[];
  held: boolean;
  onDone: () => void;
  onResult: (s: Status) => void;
}) {
  const c = useConsoleT();
  const locale = useLocale();
  const errorText = useErrorText();
  const id = useId();
  const [action, setAction] = useState<ModerationDecision>(decisions[0] ?? 'keep');
  const reasons: readonly string[] = action === 'keep' ? KEEP_REASONS : REPORT_REASONS;
  const [reasonCode, setReasonCode] = useState<string>(KEEP_REASONS[0]);
  const [note, setNote] = useState('');
  const [days, setDays] = useState('7');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  function choose(a: ModerationDecision) {
    setAction(a);
    setReasonCode(a === 'keep' ? KEEP_REASONS[0] : detail.reasonCode);
  }

  async function send() {
    setConfirming(false);
    if (busy) return;
    setBusy(true);
    onResult(null);
    const res = await adminApi(
      locale,
      `/admin/ustaad/moderation/reports/${detail.code}/act`,
      ModerationResultDto,
      {
        method: 'POST',
        body: {
          action,
          reasonCode,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(action === 'ban' ? { days: days.trim() ? Number(days) : null } : {}),
          version: detail.version,
        },
      },
    );
    setBusy(false);
    track('admin_ustaad_console_action', { action, outcome: res.ok ? 'ok' : 'refused' });
    if (!res.ok) {
      onResult({ tone: 'error', text: errorText(res.code) });
      if (res.code.startsWith('STALE_')) onDone();
      return;
    }
    onResult({ tone: 'ok', text: res.data.pendingBan ? c('act_proposed') : c('saved') });
    onDone();
  }

  // SIM-B8: on a hold, "warn" also takes the item down, so it says so.
  const label = (a: ModerationDecision) =>
    held && a === 'keep' ? c('act_release') : held && a === 'warn' ? c('act_warn_held') : c(`act_${a}`);

  return (
    <form
      className="space-y-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (action === 'keep') void send();
        else setConfirming(true);
      }}
    >
      <fieldset className="space-y-2">
        <legend className={labelClass}>{c('act_choose')}</legend>
        <div className="flex flex-wrap gap-2">
          {decisions.map((a) => (
            <label
              key={a}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border px-4 text-sm font-bold has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus ${
                action === a
                  ? 'border-accent bg-accent-soft text-accent-soft-text'
                  : 'border-line-card text-ink'
              }`}
            >
              <input
                type="radio"
                name={`${id}-action`}
                value={a}
                checked={action === a}
                onChange={() => {
                  choose(a);
                }}
                className="size-4"
              />
              {label(a)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 tab:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>{c('act_reason')}</span>
          <select
            className={portalField}
            value={reasonCode}
            onChange={(e) => {
              setReasonCode(e.target.value);
            }}
          >
            {reasons.map((r) => (
              <option key={r} value={r}>
                {action === 'keep' ? c(`dreason_${r}`) : c(`reason_${r}`)}
              </option>
            ))}
          </select>
        </label>
        {action === 'ban' ? (
          <label className="space-y-1">
            <span className={labelClass}>{c('act_days')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={36500}
              className={portalField}
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
              }}
              aria-describedby={`${id}-days-help`}
            />
            <span id={`${id}-days-help`} className="block text-xs text-muted">
              {c('act_days_help')}
            </span>
          </label>
        ) : null}
      </div>
      <label className="block space-y-1">
        <span className={labelClass}>{c('act_note')}</span>
        <span className="block text-xs text-muted">{c('note_hint')}</span>
        <textarea
          className={`${portalField} min-h-20`}
          maxLength={500}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </label>
      <button type="submit" aria-disabled={busy} className={portalPrimary}>
        {action === 'keep' ? label('keep') : c('act_submit')}
      </button>
      <ConfirmDialog
        open={confirming}
        title={c('act_confirm_title')}
        lead={c('act_confirm_lead')}
        confirmLabel={label(action)}
        backLabel={c('back')}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => void send()}
      >
        <p className="text-sm text-ink">
          {label(action)} · {c(`reason_${reasonCode}`)}
        </p>
      </ConfirmDialog>
    </form>
  );
}

/** Four-eyes: a waiting ban, approved only by a moderator who did not propose it. */
function PendingBan({
  detail,
  caps,
  onDone,
  onResult,
}: {
  detail: ReportDetail;
  caps: ConsoleCaps;
  onDone: () => void;
  onResult: (s: Status) => void;
}) {
  const c = useConsoleT();
  const locale = useLocale();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const p = detail.pendingBan;
  if (!p) return null;

  async function approve() {
    if (busy || !p) return;
    setBusy(true);
    onResult(null);
    const res = await adminApi(
      locale,
      `/admin/ustaad/moderation/reports/${detail.code}/ban/confirm`,
      ModerationResultDto,
      { method: 'POST', body: { proposalId: p.proposalId, version: detail.version } },
    );
    setBusy(false);
    track('admin_ustaad_console_action', { action: 'ban_confirm', outcome: res.ok ? 'ok' : 'refused' });
    onResult(res.ok ? { tone: 'ok', text: c('saved') } : { tone: 'error', text: errorText(res.code) });
    onDone();
  }

  return (
    <div className="space-y-2 rounded-tile bg-warning-bg p-3 text-sm text-warning">
      <p className="font-bold">
        <StatusBadge tone="warning">{c('waiting_approval')}</StatusBadge>{' '}
        {p.days === null ? c('ban_waiting_perm') : c('ban_waiting_days', { days: p.days })}
      </p>
      {p.proposedByMe ? <p>{c('ban_yours')}</p> : null}
      {canConfirmBan(detail, caps) ? (
        <button type="button" aria-disabled={busy} className={portalPrimary} onClick={() => void approve()}>
          {c('ban_confirm')}
        </button>
      ) : null}
    </div>
  );
}

function AppealDecision({
  detail,
  onDone,
  onResult,
}: {
  detail: ReportDetail;
  onDone: () => void;
  onResult: (s: Status) => void;
}) {
  const c = useConsoleT();
  const locale = useLocale();
  const errorText = useErrorText();
  const id = useId();
  const [outcome, setOutcome] = useState<'upheld' | 'overturned'>('upheld');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (busy) return;
    setBusy(true);
    onResult(null);
    const res = await adminApi(
      locale,
      `/admin/ustaad/moderation/reports/${detail.code}/appeal/decide`,
      ModerationResultDto,
      {
        method: 'POST',
        body: { outcome, ...(note.trim() ? { note: note.trim() } : {}), version: detail.version },
      },
    );
    setBusy(false);
    track('admin_ustaad_console_action', { action: 'appeal_decide', outcome: res.ok ? 'ok' : 'refused' });
    onResult(res.ok ? { tone: 'ok', text: c('saved') } : { tone: 'error', text: errorText(res.code) });
    onDone();
  }

  return (
    <form
      className="space-y-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <fieldset className="space-y-2">
        <legend className={labelClass}>{c('appeal_decide')}</legend>
        {(['upheld', 'overturned'] as const).map((o) => (
          <label key={o} className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name={`${id}-outcome`}
              value={o}
              checked={outcome === o}
              onChange={() => {
                setOutcome(o);
              }}
              className="size-4"
            />
            {c(`appeal_${o}`)}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1">
        <span className={labelClass}>{c('act_note')}</span>
        <span className="block text-xs text-muted">{c('note_hint')}</span>
        <textarea
          className={`${portalField} min-h-20`}
          maxLength={500}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </label>
      <button type="submit" aria-disabled={busy} className={portalPrimary}>
        {c('appeal_submit')}
      </button>
    </form>
  );
}

/** Link the member's appeal ticket (REQ-…) to a decided report; the report then appears in Appeals. */
function LinkAppeal({ onLinked }: { onLinked: () => void }) {
  const c = useConsoleT();
  const locale = useLocale();
  const errorText = useErrorText();
  const id = useId();
  const [report, setReport] = useState('');
  const [ticket, setTicket] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<'report' | 'ticket' | null>(null);

  async function send() {
    const r = report.trim().toUpperCase();
    const tk = ticket.trim().toUpperCase();
    const wrong = !USTAAD_REPORT_CODE_RE.test(r) ? 'report' : !TICKET_CODE_RE.test(tk) ? 'ticket' : null;
    setBad(wrong);
    if (wrong) {
      setStatus({ tone: 'error', text: c('appeal_bad_code') });
      document.getElementById(`${id}-${wrong}`)?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    setStatus(null);
    const d = await adminApi(locale, `/admin/ustaad/moderation/reports/${r}`, ReportDetailDto);
    const res = d.ok
      ? await adminApi(locale, `/admin/ustaad/moderation/reports/${r}/appeal`, ModerationResultDto, {
          method: 'POST',
          body: { ticketCode: tk, version: d.data.version },
        })
      : d;
    setBusy(false);
    track('admin_ustaad_console_action', { action: 'appeal_link', outcome: res.ok ? 'ok' : 'refused' });
    if (!res.ok) {
      setStatus({ tone: 'error', text: errorText(res.code) });
      return;
    }
    setStatus({ tone: 'ok', text: c('appeal_linked') });
    setReport('');
    setTicket('');
    onLinked();
  }

  return (
    <form
      className={`${adminCard} space-y-3`}
      aria-labelledby={`${id}-t`}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div>
        <h4 id={`${id}-t`} className="font-heading text-base font-extrabold text-ink">
          {c('appeal_link_title')}
        </h4>
        <p className="text-sm text-muted">{c('appeal_link_lead')}</p>
      </div>
      <div className="grid gap-3 tab:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>{c('appeal_report')}</span>
          <input
            id={`${id}-report`}
            required
            aria-invalid={bad === 'report' ? true : undefined}
            aria-describedby={`${id}-report-hint`}
            className={portalField}
            value={report}
            onChange={(e) => {
              setReport(e.target.value);
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <span id={`${id}-report-hint`} className="block text-xs text-muted">
            {c('appeal_report_hint')}
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>{c('appeal_ticket')}</span>
          <input
            id={`${id}-ticket`}
            required
            aria-invalid={bad === 'ticket' ? true : undefined}
            aria-describedby={`${id}-ticket-hint`}
            className={portalField}
            value={ticket}
            onChange={(e) => {
              setTicket(e.target.value);
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <span id={`${id}-ticket-hint`} className="block text-xs text-muted">
            {c('appeal_ticket_hint')}
          </span>
        </label>
      </div>
      <button type="submit" aria-disabled={busy} className={portalQuiet}>
        {c('appeal_link')}
      </button>
      <StatusLine tone={status?.tone ?? null}>{status?.text}</StatusLine>
    </form>
  );
}
