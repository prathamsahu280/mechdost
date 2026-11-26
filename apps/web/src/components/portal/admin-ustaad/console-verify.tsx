'use client';

import { useLocale } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { USTAAD_VERIFY_REJECT_REASONS } from '@mechdost/shared/ustaad/codes';
import {
  OwnerAttestationQueueDto,
  OwnerLinkDto,
  VerificationQueuePageDto,
  VerificationViewDto,
} from '@mechdost/shared/ustaad/dto/console';
import type { VerificationQueueItem } from '@mechdost/shared/ustaad/dto/verification';
import { adminApi } from '@/lib/admin-api';
import { grantableLevels } from '@/lib/admin-ustaad-console';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
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

const LISTS = ['in_review', 'requested', 'approved', 'rejected'] as const;
type List = (typeof LISTS)[number];
interface Owner {
  id: string;
  memberHandle: string;
  memberName: string;
  sinceYear: number | null;
  linkIssuedAt: string | null;
  expiresAt: string;
}
type Status = { tone: 'ok' | 'error'; text: string } | null;

/**
 * Verify (spec 23 § 7.1, SR-6–SR-8; task G2): B's verification queue with the proof, vouches and the garage owner's
 * answer; staff final approval (a level no higher than the one asked) or rejection with a reason; and the open
 * requests to garage owners who are not on MechDost, where staff issue the one-time owner link and call the owner.
 */
export function VerifySection({ headId }: { headId: string }) {
  const c = useConsoleT();
  const locale = useLocale();
  const [list, setList] = useState<List>('in_review');
  const [items, setItems] = useState<VerificationQueueItem[] | null>(null);
  const [loadError, setLoadError] = useState<CommonErrorKey | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);

  const load = useCallback(async () => {
    const [res, own] = await Promise.all([
      adminApi(locale, `/admin/ustaad/verifications?status=${list}`, VerificationQueuePageDto),
      adminApi(locale, '/admin/ustaad/attestations', OwnerAttestationQueueDto),
    ]);
    if (!res.ok) {
      setLoadError(commonErrorKey(res.code));
      return;
    }
    setLoadError(null);
    setItems(res.data.items);
    if (own.ok) setOwners(own.data.items);
  }, [locale, list]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <SectionHead id={headId} title={c('sec_verify')} help={c('sec_verify_help')} />
      <label className={`${adminCard} block max-w-sm space-y-1`}>
        <span className={labelClass}>{c('v_list')}</span>
        <select
          className={portalField}
          value={list}
          onChange={(e) => {
            setList(e.target.value as List);
          }}
        >
          {LISTS.map((l) => (
            <option key={l} value={l}>
              {c(`v_status_${l}`)}
            </option>
          ))}
        </select>
      </label>
      {items === null ? (
        <LoadState error={loadError} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <p className={`${adminCard} text-sm text-muted`}>{c('v_empty')}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((v) => (
            <li key={v.id}>
              <VerificationCard v={v} onDone={() => void load()} />
            </li>
          ))}
        </ul>
      )}
      <OwnerLinks owners={owners} onIssued={() => void load()} />
    </div>
  );
}

function VerificationCard({ v, onDone }: { v: VerificationQueueItem; onDone: () => void }) {
  const c = useConsoleT();
  const locale = useLocale();
  const when = useFormatWhen();
  const errorText = useErrorText();
  const id = useId();
  const open = v.status === 'in_review' || v.status === 'requested';
  const levels = grantableLevels(v.requestedLevel);
  const [mode, setMode] = useState<'approve' | 'reject'>('approve');
  const [level, setLevel] = useState<string>(v.requestedLevel);
  const [reason, setReason] = useState<string>(USTAAD_VERIFY_REJECT_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function send() {
    if (mode === 'reject' && reason === 'other' && note.trim().length < 3) {
      setStatus({ tone: 'error', text: c('v_note_needed') });
      return;
    }
    if (busy) return;
    setBusy(true);
    const res = await adminApi(locale, `/admin/ustaad/verifications/${v.id}/${mode}`, VerificationViewDto, {
      method: 'POST',
      body:
        mode === 'approve'
          ? { expectedVersion: v.version, grantedLevel: level }
          : { expectedVersion: v.version, reasonCode: reason, note: note.trim() || null },
    });
    setBusy(false);
    track('admin_ustaad_console_action', {
      action: mode === 'approve' ? 'verify_approve' : 'verify_reject',
      outcome: res.ok ? 'ok' : 'refused',
    });
    if (!res.ok) {
      setStatus({ tone: 'error', text: errorText(res.code) });
      return;
    }
    setStatus({ tone: 'ok', text: c(mode === 'approve' ? 'v_approved' : 'v_rejected') });
    onDone();
  }

  const proofs = v.proofKinds.map((p) => c(`proof_${p}`)).join(', ');
  return (
    <article aria-labelledby={`${id}-t`} className={`${adminCard} space-y-3`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 id={`${id}-t`} className="font-heading text-base font-extrabold text-ink">
            <span data-user-content>
              {v.displayName} (@{v.handle})
            </span>
          </h4>
          <p className="text-sm text-muted">
            {c(`level_${v.level}`)} · {v.cityCode} · {when(v.createdAt, false)}
          </p>
        </div>
        <StatusBadge code={v.status}>{c(`v_status_${v.status}`)}</StatusBadge>
      </header>
      <ul className="space-y-1 text-sm text-ink">
        <li>{c('v_asked', { level: c(`level_${v.requestedLevel}`) })}</li>
        <li>{c('v_years', { years: v.yearsClaimed })}</li>
        <li>{c('v_proofs', { proofs })}</li>
        <li>{c('v_vouches', { given: v.vouchesGiven, needed: v.vouchesNeeded })}</li>
        <li>{c('v_attest', { status: c(`attest_${v.attestation ?? 'none'}`) })}</li>
      </ul>
      {open ? (
        <form
          className="space-y-3 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <fieldset className="flex flex-wrap gap-4">
            <legend className="sr-only">{c('act_choose')}</legend>
            {(['approve', 'reject'] as const).map((m) => (
              <label key={m} className="flex min-h-11 items-center gap-2 text-sm font-bold text-ink">
                <input
                  type="radio"
                  name={`${id}-mode`}
                  checked={mode === m}
                  onChange={() => {
                    setMode(m);
                  }}
                  className="size-4"
                />
                {c(m === 'approve' ? 'v_approve' : 'v_reject')}
              </label>
            ))}
          </fieldset>
          {mode === 'approve' ? (
            <label className="block max-w-xs space-y-1">
              <span className={labelClass}>{c('v_grant')}</span>
              <select
                className={portalField}
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value);
                }}
              >
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {c(`level_${l}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="grid gap-3 tab:grid-cols-2">
              <label className="space-y-1">
                <span className={labelClass}>{c('v_reject_reason')}</span>
                <select
                  className={portalField}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                >
                  {USTAAD_VERIFY_REJECT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {c(`reject_${r}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={labelClass}>{c('v_note')}</span>
                <input
                  className={portalField}
                  maxLength={500}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                />
              </label>
            </div>
          )}
          <button type="submit" aria-disabled={busy} className={portalPrimary}>
            {c(mode === 'approve' ? 'v_approve' : 'v_reject')}
          </button>
          <StatusLine tone={status?.tone ?? null}>{status?.text}</StatusLine>
        </form>
      ) : null}
    </article>
  );
}

/** Garage owners not on MechDost: issue the one-time link (shown once, with the number to call; audited by B). */
function OwnerLinks({ owners, onIssued }: { owners: Owner[]; onIssued: () => void }) {
  const c = useConsoleT();
  const locale = useLocale();
  const when = useFormatWhen();
  const errorText = useErrorText();
  const id = useId();
  const [issued, setIssued] = useState<{ url: string; expiresAt: string; ownerPhone: string } | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [copied, setCopied] = useState(false);

  async function issue(o: Owner) {
    const res = await adminApi(locale, `/admin/ustaad/attestations/${o.id}/owner-link`, OwnerLinkDto, {
      method: 'POST',
    });
    track('admin_ustaad_console_action', { action: 'owner_link', outcome: res.ok ? 'ok' : 'refused' });
    if (!res.ok) {
      setStatus({ tone: 'error', text: errorText(res.code) });
      return;
    }
    setCopied(false);
    setIssued(res.data);
    onIssued();
  }

  return (
    <section aria-labelledby={`${id}-t`} className={`${adminCard} space-y-3`}>
      <h4 id={`${id}-t`} className="font-heading text-base font-extrabold text-ink">
        {c('owner_title')}
      </h4>
      {issued ? (
        <div className="space-y-2 rounded-tile bg-info-bg p-3 text-sm text-info">
          <p className="font-bold">{c('owner_link_title')}</p>
          <p>{c('owner_link_lead', { date: when(issued.expiresAt) })}</p>
          <p className="break-all font-mono text-ink" lang="en">
            {issued.url}
          </p>
          <p>
            {c('owner_phone')}: <span className="font-bold text-ink">{issued.ownerPhone}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={portalQuiet}
              onClick={() => {
                void navigator.clipboard.writeText(issued.url).then(() => {
                  setCopied(true);
                });
              }}
            >
              {c('owner_copy')}
            </button>
            <button
              type="button"
              className={portalQuiet}
              onClick={() => {
                setIssued(null);
              }}
            >
              {c('close')}
            </button>
          </div>
          <StatusLine tone={copied ? 'ok' : null}>{copied ? c('owner_copied') : null}</StatusLine>
        </div>
      ) : null}
      {owners.length === 0 ? (
        <p className="text-sm text-muted">{c('owner_empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {owners.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="text-sm">
                <p className="font-bold text-ink" data-user-content>
                  {o.memberName} (@{o.memberHandle})
                </p>
                <p className="text-muted">
                  {o.sinceYear ? c('owner_since', { year: o.sinceYear }) : null}
                  {o.linkIssuedAt ? ` · ${c('owner_issued', { date: when(o.linkIssuedAt) })}` : ''}
                </p>
              </div>
              <button type="button" className={portalQuiet} onClick={() => void issue(o)}>
                {c(o.linkIssuedAt ? 'owner_reissue' : 'owner_issue')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <StatusLine tone={status?.tone ?? null}>{status?.text}</StatusLine>
    </section>
  );
}
