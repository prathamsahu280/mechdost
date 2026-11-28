'use client';

import { useLocale } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { REPORT_REASONS, USTAAD_UNBAN_REASONS } from '@mechdost/shared/ustaad/codes';
import {
  ModerationResultDto,
  StaffMemberDetailDto,
  StaffMemberSearchDto,
  UnbanResultDto,
  type ConsoleCaps,
  type StaffMemberDetail,
  type StaffMemberRow,
} from '@mechdost/shared/ustaad/dto/console';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { ConfirmDialog } from '../admin-settings-workbench';
import { LoadState } from '../admin-site-api';
import { StatusBadge, adminCard } from '../admin-ui';
import { portalField, portalPrimary, portalQuiet } from '../portal-styles';
import {
  SectionHead,
  StatusLine,
  labelClass,
  useConsoleT,
  useErrorText,
  useFormatWhen,
} from './console-common';
import { ustaadAuditKind } from '@/lib/ustaad-audit-labels';

type Status = { tone: 'ok' | 'error'; text: string } | null;

/**
 * Members (spec 23 § 3, § 13; task G2): search by handle (never phone or email), the member's status, sanctions and
 * strikes, the moderation history; restrict or ban (a long ban waits for a second staff member) and lift a ban or
 * restriction (four-eyes for long bans; the staff who took part cannot lift it; a child-safety freeze never here).
 */
export function MembersSection({ caps, headId }: { caps: ConsoleCaps; headId: string }) {
  const c = useConsoleT();
  const locale = useLocale();
  const errorText = useErrorText();
  const id = useId();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<StaffMemberRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  async function search() {
    const term = q.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{2,24}$/.test(term)) {
      setStatus({ tone: 'error', text: c('m_hint') });
      return;
    }
    const res = await adminApi(
      locale,
      `/admin/ustaad/members?q=${encodeURIComponent(term)}`,
      StaffMemberSearchDto,
    );
    if (!res.ok) {
      setStatus({ tone: 'error', text: errorText(res.code) });
      return;
    }
    setStatus({ tone: 'ok', text: c('m_count', { count: res.data.items.length }) });
    setRows(res.data.items);
  }

  return (
    <div className="space-y-4">
      <SectionHead id={headId} title={c('sec_members')} help={c('sec_members_help')} />
      <form
        role="search"
        className={`${adminCard} flex flex-wrap items-end gap-3`}
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label className="min-w-56 flex-1 space-y-1">
          <span className={labelClass}>{c('m_search')}</span>
          <input
            className={portalField}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-hint`}
          />
          <span id={`${id}-hint`} className="block text-xs text-muted">
            {c('m_hint')}
          </span>
        </label>
        <button type="submit" className={portalPrimary}>
          {c('m_search_btn')}
        </button>
        <div className="basis-full">
          <StatusLine tone={status?.tone ?? null}>{status?.text}</StatusLine>
        </div>
      </form>
      <div className="grid gap-4 min-[1200px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] min-[1200px]:items-start">
        <section aria-label={c('m_results')} className="min-w-0">
          {rows === null ? (
            <p className={`${adminCard} text-sm text-muted`}>{c('m_start')}</p>
          ) : rows.length === 0 ? (
            <p className={`${adminCard} text-sm text-muted`}>{c('m_empty')}</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((m) => (
                <li key={m.memberId}>
                  <button
                    type="button"
                    aria-current={selected === m.memberId ? 'true' : undefined}
                    onClick={() => {
                      setSelected(m.memberId);
                    }}
                    className={`press w-full rounded-tile border p-3 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                      selected === m.memberId
                        ? 'border-accent bg-accent-soft'
                        : 'border-line-card bg-surface hover:bg-pill'
                    }`}
                  >
                    <span className="block font-bold text-ink" data-user-content>
                      {m.displayName} (@{m.handle})
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <StatusBadge code={m.status}>{c(`mstatus_${m.status}`)}</StatusBadge>
                      <span className="text-muted">
                        {c(`level_${m.level}`)}
                        {m.cityCode ? ` · ${m.cityCode}` : ''} · {c('d_strikes', { count: m.activeStrikes })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="min-w-0">
          {selected ? <MemberPanel key={selected} memberId={selected} caps={caps} /> : null}
        </div>
      </div>
    </div>
  );
}

function MemberPanel({ memberId, caps }: { memberId: string; caps: ConsoleCaps }) {
  const c = useConsoleT();
  const locale = useLocale();
  const when = useFormatWhen();
  const titleId = useId();
  const [m, setM] = useState<StaffMemberDetail | null>(null);
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);
  const [result, setResult] = useState<Status>(null);
  const [focusTitle, setFocusTitle] = useState(true);

  const load = useCallback(async () => {
    const res = await adminApi(locale, `/admin/ustaad/members/${memberId}`, StaffMemberDetailDto);
    if (!res.ok) {
      setLoadError(commonErrorKey(res.code));
      return;
    }
    setLoadError(null);
    setM(res.data);
  }, [locale, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening a member (and finishing an action) puts the keyboard on the member's heading.
  useEffect(() => {
    if (!focusTitle || !m) return;
    document.getElementById(titleId)?.focus();
    setFocusTitle(false);
  }, [focusTitle, m, titleId]);

  if (!m) return <LoadState error={loadError} onRetry={() => void load()} />;
  const done = () => {
    void load();
    setFocusTitle(true);
  };
  const until = m.status === 'banned' ? m.bannedUntil : m.status === 'restricted' ? m.restrictedUntil : null;
  const sanctioned = m.status === 'banned' || m.status === 'restricted';
  const frozen = m.restrictedMode === 'review';

  return (
    <article aria-labelledby={titleId} className={`${adminCard} space-y-4`}>
      <header className="space-y-1">
        <h4 id={titleId} tabIndex={-1} className="font-heading text-base font-extrabold text-ink">
          <span data-user-content>
            {m.displayName} (@{m.handle})
          </span>
        </h4>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge code={m.status}>
            {c(`mstatus_${m.status}`)}
            {sanctioned ? ` · ${until ? c('m_until', { date: when(until) }) : c('m_permanent')}` : ''}
          </StatusBadge>
          <span className="text-muted">
            {c(`level_${m.level}`)} · {c(m.verificationState === 'verified' ? 'm_verified' : 'm_unverified')}
            {m.cityCode ? ` · ${m.cityCode}` : ''} · {c('m_joined', { date: when(m.joinedAt, false) })}
          </span>
        </div>
        {m.restrictedMode !== 'none' ? (
          <p className="rounded-tile bg-error-bg p-2 text-sm font-bold text-error">
            {c(`m_mode_${m.restrictedMode}`)}
          </p>
        ) : null}
        <p className="text-sm text-ink">
          {c('d_strikes', { count: m.activeStrikes })} · {c('m_open_reports', { count: m.openReports })}
        </p>
      </header>

      <section className="space-y-2">
        <h5 className={labelClass}>{c('m_strikes')}</h5>
        {m.strikes.length === 0 ? (
          <p className="text-sm text-muted">{c('m_no_history')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {m.strikes.map((s) => (
              <li key={`${s.reasonCode}-${s.at}`}>
                {c(`reason_${s.reasonCode}`)} · {c(`m_strike_${s.status}`)} ·{' '}
                <span className="text-muted">{when(s.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h5 className={labelClass}>{c('m_history')}</h5>
        {m.history.length === 0 ? (
          <p className="text-sm text-muted">{c('m_no_history')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {m.history.map((h) => (
              <li key={`${h.action}-${h.at}`}>
                {c(`audit_${ustaadAuditKind(h.action)}`)} · {c(`target_${h.targetType}`)} ·{' '}
                <span className="text-muted">{when(h.at)}</span>
                {h.reportCode ? <span className="text-xs text-muted"> · {h.reportCode}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {caps.moderate && frozen ? <p className="text-sm text-muted">{c('m_frozen_note')}</p> : null}
      {m.pendingBan ? (
        <p className="rounded-tile bg-warning-bg p-3 text-sm font-bold text-warning">
          <StatusBadge tone="warning">{c('waiting_approval')}</StatusBadge>{' '}
          {c(m.pendingBan.proposedByMe ? 'm_ban_waiting_yours' : 'm_ban_waiting')}
        </p>
      ) : null}
      {caps.moderate && m.pendingUnban ? (
        <PendingUnban m={m} onDone={done} onResult={setResult} />
      ) : caps.moderate && sanctioned && !frozen ? (
        <Unban m={m} onDone={done} onResult={setResult} />
      ) : null}
      {caps.moderate && m.status !== 'banned' && !frozen ? (
        <Sanction m={m} onDone={done} onResult={setResult} />
      ) : null}
      {loadError ? <LoadState error={loadError} onRetry={() => void load()} /> : null}
      <StatusLine tone={result?.tone ?? null}>{result?.text}</StatusLine>
    </article>
  );
}

function Sanction({
  m,
  onDone,
  onResult,
}: {
  m: StaffMemberDetail;
  onDone: () => void;
  onResult: (s: Status) => void;
}) {
  const c = useConsoleT();
  const locale = useLocale();
  const errorText = useErrorText();
  const id = useId();
  const [action, setAction] = useState<'restrict' | 'ban'>('restrict');
  const [reason, setReason] = useState<string>('abuse');
  const [days, setDays] = useState('7');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send() {
    setConfirming(false);
    if (busy) return;
    setBusy(true);
    onResult(null);
    const res = await adminApi(locale, `/admin/ustaad/members/${m.memberId}/sanction`, ModerationResultDto, {
      method: 'POST',
      body: {
        action,
        reasonCode: reason,
        ...(action === 'ban' ? { days: days.trim() ? Number(days) : null } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        version: m.version,
      },
    });
    setBusy(false);
    track('admin_ustaad_console_action', { action: 'sanction', outcome: res.ok ? 'ok' : 'refused' });
    if (!res.ok) {
      onResult({ tone: 'error', text: errorText(res.code) });
      onDone();
      return;
    }
    onResult({ tone: 'ok', text: res.data.pendingBan ? c('act_proposed') : c('saved') });
    onDone();
  }

  return (
    <form
      className="space-y-3 border-t border-line pt-4"
      aria-labelledby={`${id}-t`}
      onSubmit={(e) => {
        e.preventDefault();
        setConfirming(true);
      }}
    >
      <h5 id={`${id}-t`} className={labelClass}>
        {c('m_sanction')}
      </h5>
      <div className="grid gap-3 tab:grid-cols-3">
        <label className="space-y-1">
          <span className={labelClass}>{c('m_sanction_action')}</span>
          <select
            className={portalField}
            value={action}
            onChange={(e) => {
              setAction(e.target.value === 'ban' ? 'ban' : 'restrict');
            }}
          >
            <option value="restrict">{c('act_restrict')}</option>
            <option value="ban">{c('act_ban')}</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>{c('act_reason')}</span>
          <select
            className={portalField}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          >
            {REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {c(`reason_${r}`)}
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
              aria-describedby={`${id}-days`}
            />
            <span id={`${id}-days`} className="block text-xs text-muted">
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
        {c(action === 'ban' ? 'act_ban' : 'act_restrict')}
      </button>
      <ConfirmDialog
        open={confirming}
        title={c('act_confirm_title')}
        lead={c('act_confirm_summary', {
          name: m.displayName,
          action: c(action === 'ban' ? 'act_ban' : 'act_restrict'),
          reason: c(`reason_${reason}`),
          length:
            action === 'ban'
              ? days.trim()
                ? c('act_days_n', { n: Number(days) })
                : c('act_days_forever')
              : '',
        })}
        confirmLabel={c(action === 'ban' ? 'act_ban' : 'act_restrict')}
        backLabel={c('back')}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => void send()}
      />
    </form>
  );
}

function Unban({
  m,
  onDone,
  onResult,
}: {
  m: StaffMemberDetail;
  onDone: () => void;
  onResult: (s: Status) => void;
}) {
  const c = useConsoleT();
  const locale = useLocale();
  const errorText = useErrorText();
  const id = useId();
  const [reason, setReason] = useState<string>(USTAAD_UNBAN_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteBad, setNoteBad] = useState(false);

  async function send() {
    if (reason === 'other' && !note.trim()) {
      onResult({ tone: 'error', text: c('v_note_needed') });
      setNoteBad(true);
      document.getElementById(`${id}-note`)?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    onResult(null);
    const res = await adminApi(locale, `/admin/ustaad/members/${m.memberId}/unban`, UnbanResultDto, {
      method: 'POST',
      body: { reasonCode: reason, ...(note.trim() ? { note: note.trim() } : {}), version: m.version },
    });
    setBusy(false);
    track('admin_ustaad_console_action', { action: 'unban', outcome: res.ok ? 'ok' : 'refused' });
    if (!res.ok) {
      onResult({ tone: 'error', text: errorText(res.code) });
      return;
    }
    onResult({ tone: 'ok', text: res.data.pendingUnban ? c('m_unban_proposed') : c('m_lifted') });
    onDone();
  }

  return (
    <form
      className="space-y-3 border-t border-line pt-4"
      aria-labelledby={`${id}-t`}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <h5 id={`${id}-t`} className={labelClass}>
        {c('m_unban')}
      </h5>
      <div className="grid gap-3 tab:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>{c('m_unban_reason')}</span>
          <select
            className={portalField}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          >
            {USTAAD_UNBAN_REASONS.map((r) => (
              <option key={r} value={r}>
                {c(`unban_${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>{c('v_note')}</span>
          <input
            id={`${id}-note`}
            className={portalField}
            required={reason === 'other'}
            aria-invalid={noteBad ? true : undefined}
            aria-describedby={`${id}-note-hint`}
            maxLength={500}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
          <span id={`${id}-note-hint`} className="block text-xs text-muted">
            {reason === 'other' ? c('note_required') : c('note_hint')}
          </span>
        </label>
      </div>
      <button type="submit" aria-disabled={busy} className={portalQuiet}>
        {c('m_unban')}
      </button>
    </form>
  );
}

/** Four-eyes: lifting a long ban waits; only someone else (not involved) approves. */
function PendingUnban({
  m,
  onDone,
  onResult,
}: {
  m: StaffMemberDetail;
  onDone: () => void;
  onResult: (s: Status) => void;
}) {
  const c = useConsoleT();
  const locale = useLocale();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const p = m.pendingUnban;
  if (!p) return null;

  async function approve() {
    if (busy || !p) return;
    setBusy(true);
    onResult(null);
    const res = await adminApi(locale, `/admin/ustaad/members/${m.memberId}/unban/confirm`, UnbanResultDto, {
      method: 'POST',
      body: { proposalId: p.proposalId, version: m.version },
    });
    setBusy(false);
    track('admin_ustaad_console_action', { action: 'unban_confirm', outcome: res.ok ? 'ok' : 'refused' });
    onResult(res.ok ? { tone: 'ok', text: c('m_lifted') } : { tone: 'error', text: errorText(res.code) });
    onDone();
  }

  return (
    <div className="space-y-2 rounded-tile bg-warning-bg p-3 text-sm text-warning">
      <p className="font-bold">
        <StatusBadge tone="warning">{c('waiting_approval')}</StatusBadge> {c('m_unban_waiting')}
      </p>
      {p.proposedByMe ? (
        <p>{c('m_unban_yours')}</p>
      ) : (
        <button type="button" aria-disabled={busy} className={portalPrimary} onClick={() => void approve()}>
          {c('m_unban_confirm')}
        </button>
      )}
    </div>
  );
}
