'use client';

import { AGENT_DOCUMENT_KINDS, type AgentDocumentKind } from '@mechdost/shared/delivery/codes';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { portalField } from '@/components/portal/portal-styles';
import { track } from '@/lib/analytics';
import { useAgent } from './agent-portal';
import { PhotoCapture, bigPrimary, bigQuiet, useStatusLine } from './parts';

const card = 'rounded-card border border-line-card bg-surface p-4 shadow-card';

/**
 * Agent profile (spec 24): vehicle (changed by MechDost only), own rating average (founder 2026-11-26: the agent sees
 * their average only), documents with their check status and upload (PAN, licence, RC: number + photo; never
 * Aadhaar), and the earnings placeholder until the founder decides pay.
 */
export function AgentProfileScreen() {
  const t = useTranslations('deliveryAgent');
  const v = useTranslations('delivery.vehicle');
  const st = useTranslations('delivery.agentStatus');
  const ctx = useAgent();
  useEffect(() => {
    track('click', { id: 'agent_screen_profile', path: window.location.pathname });
  }, []);
  if (!ctx) return null;
  const { profile } = ctx;
  return (
    <div className="grid gap-4">
      <section aria-labelledby="agent-profile-title" className={card}>
        <h2 id="agent-profile-title" className="font-heading text-xl font-extrabold text-ink">
          {t('profileTitle')}
        </h2>
        <p className="mt-2 text-[15px] text-ink">{t('statusLabel', { status: st(profile.status) })}</p>
        <p className="mt-1 text-[15px] text-ink">{t('vehicle', { vehicle: v(profile.vehicleType) })}</p>
        <p className="mt-1 text-sm text-muted">{t('vehicleChange')}</p>
        <p className="mt-2 text-[15px] font-bold text-ink">
          {typeof profile.rating === 'number'
            ? t('ratingOwn', { rating: profile.rating.toFixed(1) })
            : t('ratingNone')}
        </p>
      </section>

      <section aria-labelledby="agent-docs-title" className={card}>
        <h2 id="agent-docs-title" className="font-heading text-xl font-extrabold text-ink">
          {t('docsTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('docsIntro')}</p>
        <ul className="mt-3 grid gap-3">
          {AGENT_DOCUMENT_KINDS.map((kind) => (
            <li key={kind}>
              <DocumentRow kind={kind} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="agent-earnings-title" className={card}>
        <h2 id="agent-earnings-title" className="font-heading text-xl font-extrabold text-ink">
          {t('earningsTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('earningsBody')}</p>
      </section>
    </div>
  );
}

function DocumentRow({ kind }: { kind: AgentDocumentKind }) {
  const t = useTranslations('deliveryAgent');
  const k = useTranslations('delivery.document.kind');
  const ds = useTranslations('delivery.document.status');
  const rr = useTranslations('delivery.document.rejectReason');
  const ctx = useAgent();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { say, line } = useStatusLine();
  if (!ctx) return null;
  const { profile, client, reloadProfile, errorText } = ctx;
  const doc = profile.documents.find((d) => d.kind === kind);
  const id = `doc-${kind}`;

  async function save(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (number.trim().length < 5) {
      setError(errorText('DOCUMENT_FORMAT'));
      document.getElementById(`${id}-number`)?.focus();
      return;
    }
    if (!mediaId) {
      setError(t('docPhotoRequired'));
      document.getElementById(`${id}-photo`)?.focus();
      return;
    }
    setBusy(true);
    const res = await client.saveDocument(kind, number.trim(), mediaId);
    setBusy(false);
    track('click', {
      id: res.ok ? `agent_document_saved_${kind}` : `agent_document_refused_${kind}`,
      path: window.location.pathname,
    });
    if (!res.ok) {
      setError(errorText(res.code));
      return;
    }
    setError(null);
    setOpen(false);
    setNumber('');
    setMediaId(null);
    say(t('docSaved'));
    reloadProfile();
    document.getElementById(`${id}-heading`)?.focus();
  }

  const statusText = !doc
    ? t('docMissing')
    : doc.status === 'rejected' && doc.rejectReason
      ? t('docRejected', { reason: rr(doc.rejectReason) })
      : ds(doc.status);
  const tone = !doc
    ? 'text-muted'
    : doc.status === 'verified'
      ? 'text-success'
      : doc.status === 'rejected'
        ? 'text-error'
        : 'text-warning';

  return (
    <div className="rounded-button border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id={`${id}-heading`} tabIndex={-1} className="font-bold text-ink">
            {k(kind)}
          </h3>
          <p className={`text-sm font-bold ${tone}`}>
            {statusText}
            {doc ? (
              <span className="ml-2 font-normal text-muted tabular-nums">{doc.numberMasked}</span>
            ) : null}
          </p>
        </div>
        {doc?.status === 'verified' || open ? null : (
          <button
            type="button"
            data-disclosure-trigger={id}
            onClick={() => {
              setOpen(true);
            }}
            className={bigQuiet}
          >
            {doc ? t('docReplace') : t('docAdd')}
          </button>
        )}
      </div>
      {open ? (
        <form
          noValidate
          onSubmit={(e) => void save(e)}
          className="mt-3 grid gap-3"
          aria-busy={busy || undefined}
        >
          <div>
            <label htmlFor={`${id}-number`} className="text-sm font-bold text-ink">
              {t('docNumber')}
            </label>
            <input
              id={`${id}-number`}
              value={number}
              maxLength={32}
              autoComplete="off"
              autoCapitalize="characters"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => {
                setNumber(e.target.value);
              }}
              className={`${portalField} uppercase`}
            />
          </div>
          <PhotoCapture
            id={`${id}-photo`}
            label={t('docPhoto')}
            purpose="document"
            upload={client.uploadPhoto}
            onMedia={setMediaId}
          />
          {error ? (
            <p id={`${id}-error`} role="alert" className="text-sm font-bold text-error">
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="submit" aria-disabled={busy || undefined} className={bigPrimary}>
              {t('docSave')}
            </button>
            <button
              type="button"
              data-panel-cancel={id}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className={bigQuiet}
            >
              {t('back')}
            </button>
          </div>
        </form>
      ) : null}
      <div className="mt-1">{line}</div>
    </div>
  );
}
