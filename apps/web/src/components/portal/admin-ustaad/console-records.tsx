'use client';

import { useLocale } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { REPORT_TARGETS } from '@mechdost/shared/ustaad/codes';
import {
  LegalCasesDto,
  OwnActionsDto,
  ReservedNamesDto,
  TakedownResultDto,
  type ConsoleCaps,
  type LegalCases,
  type OwnActions,
} from '@mechdost/shared/ustaad/dto/console';
import { TAKEDOWN_BASES } from '@mechdost/shared/ustaad/dto/moderation';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { ConfirmDialog } from '../admin-settings-workbench';
import { LoadState } from '../admin-site-api';
import { StatusBadge, adminCard } from '../admin-ui';
import { portalField, portalPrimary, portalQuiet } from '../portal-styles';
import { Switch } from '@/components/ui/switch';
import {
  ClockBadge,
  SectionHead,
  StatusLine,
  labelClass,
  useConsoleT,
  useErrorText,
  useFormatWhen,
} from './console-common';

type Status = { tone: 'ok' | 'error'; text: string } | null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDITED = [
  'keep',
  'remove',
  'warn',
  'restrict',
  'ban',
  'ban_proposed',
  'unban',
  'unban_proposed',
  'restore',
  'takedown',
  'dm_read',
  'media_view',
  'attest_owner_phone_read',
];

/** Takedowns and legal holds (spec 23 § 13; SR-39): the legal list, the evidence vault counts, the takedown form. */
export function LegalSection({ caps, headId }: { caps: ConsoleCaps; headId: string }) {
  const c = useConsoleT();
  const locale = useLocale();
  const when = useFormatWhen();
  const [data, setData] = useState<LegalCases | null>(null);
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/ustaad/legal', LegalCasesDto);
    if (!res.ok) {
      setLoadError(commonErrorKey(res.code));
      return;
    }
    setLoadError(null);
    setData(res.data);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <SectionHead id={headId} title={c('sec_legal')} help={c('sec_legal_help')} />
      {caps.takedown ? <TakedownForm onDone={() => void load()} /> : null}
      {!data ? (
        <LoadState error={loadError} onRetry={() => void load()} />
      ) : (
        <>
          <section className={`${adminCard} space-y-2`} aria-label={c('l_takedowns')}>
            <h4 className="font-heading text-base font-extrabold text-ink">{c('l_takedowns')}</h4>
            {data.takedowns.length === 0 ? (
              <p className="text-sm text-muted">{c('l_empty')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.takedowns.map((t) => (
                  <li key={t.code} className="space-y-1 py-2 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-ink">
                        {t.basis ? c(`basis_${t.basis}`) : c(`source_${t.source}`)}
                      </span>
                      <span className="text-muted">· {c(`target_${t.targetType}`)}</span>
                      <StatusBadge code={t.status}>{c(`status_${t.status}`)}</StatusBadge>
                    </p>
                    <p className="flex flex-wrap items-center gap-2 text-muted">
                      {t.status === 'open' || t.status === 'in_review' ? (
                        <ClockBadge clock={t.clock} dueAt={t.dueAt} createdAt={t.createdAt} />
                      ) : (
                        <span>{c(`clock_${t.clock}`)}</span>
                      )}
                      <span className="text-xs">
                        {t.code}
                        {t.cityCode ? ` · ${t.cityCode}` : ''} · {when(t.createdAt)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={`${adminCard} space-y-2`} aria-label={c('l_holds')}>
            <h4 className="font-heading text-base font-extrabold text-ink">{c('l_holds')}</h4>
            {data.holds.length === 0 ? (
              <p className="text-sm text-muted">{c('l_holds_empty')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.holds.map((h) => (
                  <li key={h.id} className="py-2 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="danger">
                        {c(
                          `hold_${h.legalHold === 'legal_order' || h.legalHold === 'pocso' ? h.legalHold : 'other'}`,
                        )}
                      </StatusBadge>
                      <span className="text-ink">{c(`target_${h.targetType}`)}</span>
                      <span className="text-muted">· {c('l_removed', { date: when(h.removedAt) })}</span>
                    </p>
                    <p className="text-muted">{c('l_files', { files: h.files, vault: h.inVault })}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function TakedownForm({ onDone }: { onDone: () => void }) {
  const c = useConsoleT();
  const locale = useLocale();
  const errorText = useErrorText();
  const id = useId();
  const [targetType, setTargetType] = useState<string>('post');
  const [targetId, setTargetId] = useState('');
  const [basis, setBasis] = useState<string>('court_order');
  const [reference, setReference] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  function check(): boolean {
    if (!UUID.test(targetId.trim())) {
      setStatus({ tone: 'error', text: c('td_bad_id') });
      return false;
    }
    if (reference.trim().length < 3) {
      setStatus({ tone: 'error', text: c('td_bad_reference') });
      return false;
    }
    return true;
  }

  async function send() {
    setConfirming(false);
    if (busy) return;
    setBusy(true);
    const res = await adminApi(locale, '/admin/ustaad/moderation/takedowns', TakedownResultDto, {
      method: 'POST',
      body: { targetType, targetId: targetId.trim(), basis, reference: reference.trim() },
    });
    setBusy(false);
    track('admin_ustaad_console_action', { action: 'takedown', outcome: res.ok ? 'ok' : 'refused' });
    if (!res.ok) {
      setStatus({ tone: 'error', text: errorText(res.code) });
      return;
    }
    setStatus({ tone: 'ok', text: c('td_done', { seconds: res.data.seconds }) });
    setTargetId('');
    setReference('');
    onDone();
  }

  return (
    <form
      className={`${adminCard} space-y-3`}
      aria-labelledby={`${id}-t`}
      onSubmit={(e) => {
        e.preventDefault();
        if (check()) setConfirming(true);
      }}
    >
      <div>
        <h4 id={`${id}-t`} className="font-heading text-base font-extrabold text-ink">
          {c('td_title')}
        </h4>
        <p className="text-sm text-muted">{c('td_lead')}</p>
      </div>
      <div className="grid gap-3 tab:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>{c('td_target')}</span>
          <select
            className={portalField}
            value={targetType}
            onChange={(e) => {
              setTargetType(e.target.value);
            }}
          >
            {REPORT_TARGETS.filter((x) => x !== 'member').map((x) => (
              <option key={x} value={x}>
                {c(`target_${x}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>{c('td_id')}</span>
          <input
            className={portalField}
            value={targetId}
            onChange={(e) => {
              setTargetId(e.target.value);
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>{c('td_basis')}</span>
          <select
            className={portalField}
            value={basis}
            onChange={(e) => {
              setBasis(e.target.value);
            }}
          >
            {TAKEDOWN_BASES.map((b) => (
              <option key={b} value={b}>
                {c(`basis_${b}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>{c('td_reference')}</span>
          <input
            className={portalField}
            value={reference}
            maxLength={120}
            onChange={(e) => {
              setReference(e.target.value);
            }}
            autoComplete="off"
          />
        </label>
      </div>
      <button type="submit" aria-disabled={busy} className={portalPrimary}>
        {c('td_submit')}
      </button>
      <StatusLine tone={status?.tone ?? null}>{status?.text}</StatusLine>
      <ConfirmDialog
        open={confirming}
        title={c('td_confirm_title')}
        lead={c('td_confirm_lead')}
        confirmLabel={c('td_submit')}
        backLabel={c('back')}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => void send()}
      />
    </form>
  );
}

/** Reserved names (SR-4): the list for every reader; adding and switching only with `ustaad:settings`. */
export function NamesSection({ caps, headId }: { caps: ConsoleCaps; headId: string }) {
  const c = useConsoleT();
  const locale = useLocale();
  const errorText = useErrorText();
  const id = useId();
  const [names, setNames] = useState<{ id: string; name: string; active: boolean; version: number }[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    const res = await adminApi(locale, '/admin/ustaad/reserved-names', ReservedNamesDto);
    if (!res.ok) {
      setLoadError(commonErrorKey(res.code));
      return;
    }
    setLoadError(null);
    setNames(res.data.names);
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (name.trim().length < 2) return;
    const res = await adminApi(locale, '/admin/ustaad/reserved-names', ReservedNamesDto.shape.names.element, {
      method: 'POST',
      body: { name: name.trim() },
    });
    track('admin_ustaad_console_action', { action: 'name_add', outcome: res.ok ? 'ok' : 'refused' });
    if (!res.ok) {
      setStatus({ tone: 'error', text: errorText(res.code) });
      return;
    }
    setName('');
    setStatus({ tone: 'ok', text: c('n_added') });
    void load();
  }

  async function toggle(n: { id: string; active: boolean; version: number }) {
    const res = await adminApi(
      locale,
      `/admin/ustaad/reserved-names/${n.id}`,
      ReservedNamesDto.shape.names.element,
      { method: 'PATCH', body: { active: !n.active, version: n.version } },
    );
    track('admin_ustaad_console_action', { action: 'name_toggle', outcome: res.ok ? 'ok' : 'refused' });
    if (!res.ok) setStatus({ tone: 'error', text: errorText(res.code) });
    void load();
  }

  return (
    <div className="space-y-4">
      <SectionHead id={headId} title={c('sec_names')} help={c('sec_names_help')} />
      {caps.settings ? (
        <form
          className={`${adminCard} flex flex-wrap items-end gap-3`}
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="min-w-56 flex-1 space-y-1">
            <span className={labelClass}>{c('n_add')}</span>
            <input
              id={`${id}-name`}
              className={portalField}
              value={name}
              maxLength={60}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </label>
          <button type="submit" className={portalPrimary}>
            {c('n_add_btn')}
          </button>
        </form>
      ) : (
        <p role="note" className="rounded-tile bg-pill px-4 py-3 text-sm text-ink">
          {c('n_readonly')}
        </p>
      )}
      <StatusLine tone={status?.tone ?? null}>{status?.text}</StatusLine>
      {names === null ? (
        <LoadState error={loadError} onRetry={() => void load()} />
      ) : names.length === 0 ? (
        <p className={`${adminCard} text-sm text-muted`}>{c('n_empty')}</p>
      ) : (
        <section className={`${adminCard} space-y-2`} aria-label={c('sec_names')}>
          <p className="text-sm text-muted">{c('n_count', { count: names.length })}</p>
          <ul className="grid gap-x-6 divide-y divide-line tab:grid-cols-2 tab:divide-y-0">
            {names.map((n) => (
              <li key={n.id} className="flex min-h-11 items-center justify-between gap-3 py-1">
                {caps.settings ? (
                  <label htmlFor={`${id}-${n.id}`} className="text-sm text-ink" data-user-content>
                    {n.name}
                  </label>
                ) : (
                  <span className="text-sm text-ink" data-user-content>
                    {n.name}
                  </span>
                )}
                {caps.settings ? (
                  <Switch
                    id={`${id}-${n.id}`}
                    checked={n.active}
                    onChange={() => void toggle(n)}
                    onText={c('n_on')}
                    offText={c('n_off')}
                  />
                ) : (
                  <StatusBadge tone={n.active ? 'success' : 'muted'}>
                    {c(n.active ? 'n_on' : 'n_off')}
                  </StatusBadge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** My actions: the caller's own `ustaad.*` audit rows (community managers have no `audit:read`). */
export function AuditSection({ headId }: { headId: string }) {
  const c = useConsoleT();
  const locale = useLocale();
  const when = useFormatWhen();
  const [rows, setRows] = useState<OwnActions['items'] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      const res = await adminApi(
        locale,
        `/admin/ustaad/my-actions${cursor ? `?cursor=${cursor}` : ''}`,
        OwnActionsDto,
      );
      if (!res.ok) {
        setLoadError(commonErrorKey(res.code));
        return;
      }
      setLoadError(null);
      setRows((prev) => (cursor && prev ? [...prev, ...res.data.items] : res.data.items));
      setNext(res.data.nextCursor);
    },
    [locale],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <SectionHead id={headId} title={c('sec_audit')} help={c('sec_audit_help')} />
      {rows === null ? (
        <LoadState error={loadError} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <p className={`${adminCard} text-sm text-muted`}>{c('a_empty')}</p>
      ) : (
        <ul className={`${adminCard} divide-y divide-line !py-1`}>
          {rows.map((r) => {
            const key = r.action.replace(/^ustaad\./, '');
            return (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="font-bold text-ink">
                  {c(`audit_${AUDITED.includes(key) ? key : 'other'}`)}
                </span>
                <span className="text-muted">
                  {r.reportCode ? `${r.reportCode} · ` : ''}
                  {when(r.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {next ? (
        <button type="button" className={portalQuiet} onClick={() => void load(next)}>
          {c('more')}
        </button>
      ) : null}
    </div>
  );
}
