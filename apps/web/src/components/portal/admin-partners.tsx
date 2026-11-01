'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import {
  partnerStatus,
  setPartnerStatus,
  usePartnerHistory,
  type PartnerKind,
  type PartnerStatus,
} from '@/demo/partner-status';
import { DEMO_SHOPS } from '@/demo/shops';
import { APPLICATION_STAGES, useApplications } from '@/demo/store';
import { DEMO_WORKSHOPS } from '@/demo/workshops';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';

type Action = 'pause' | 'suspend' | 'resume' | 'reactivate';
const TARGET: Record<Action, PartnerStatus> = {
  pause: 'paused',
  suspend: 'suspended',
  resume: 'active',
  reactivate: 'active',
};
const ACTIONS: Record<PartnerStatus, Action[]> = {
  active: ['pause', 'suspend'],
  paused: ['resume', 'suspend'],
  suspended: ['reactivate'],
};
const PILL: Record<PartnerStatus, string> = {
  active: 'bg-success-bg text-success',
  paused: 'bg-warning-bg text-warning',
  suspended: 'bg-pill text-error',
};

interface Partner {
  slug: string;
  name: string;
  area: string;
}

/**
 * Admin control over partners (decision 2026-11-01, permission `partners:approve`): pause or suspend any shop,
 * workshop or mechanic with a reason the partner sees, and reactivate. Every change is kept in the history.
 */
export function AdminPartners({ actor }: { actor: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [tab, setTab] = useState<PartnerKind>('shop');
  const history = usePartnerHistory();
  const applications = useApplications();

  const mechanics: Partner[] = applications
    .filter((a) => a.kind === 'mechanic' && !a.rejected && a.stage === APPLICATION_STAGES.length - 1)
    .map((a) => ({ slug: a.code, name: a.name, area: a.pincode }));
  const lists: Record<PartnerKind, Partner[]> = {
    shop: DEMO_SHOPS.map((s) => ({ slug: s.slug, name: s.name, area: s.area })),
    workshop: DEMO_WORKSHOPS.map((w) => ({ slug: w.slug, name: w.name, area: w.area })),
    mechanic: mechanics,
  };
  const nameOf = (kind: PartnerKind, slug: string) => lists[kind].find((p) => p.slug === slug)?.name ?? slug;

  return (
    <section aria-labelledby="partners-title" className="space-y-4">
      <div>
        <h2 id="partners-title" className="font-heading text-xl font-extrabold text-ink">
          {t('nav_partners')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('partnersLead')}</p>
      </div>

      <div role="tablist" aria-label={t('nav_partners')} className="flex flex-wrap gap-2">
        {(['shop', 'workshop', 'mechanic'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`partners-tab-${k}`}
            aria-selected={tab === k}
            aria-controls="partners-panel"
            onClick={() => {
              setTab(k);
            }}
            className={`press inline-flex min-h-11 items-center rounded-pill px-4 text-sm font-bold ${
              tab === k
                ? 'bg-accent-soft text-accent-soft-text'
                : 'border border-line-card text-ink hover:bg-pill'
            }`}
          >
            {t(`partnersTab_${k}`)} ({lists[k].length})
          </button>
        ))}
      </div>

      <div id="partners-panel" role="tabpanel" aria-labelledby={`partners-tab-${tab}`}>
        {lists[tab].length === 0 ? (
          <p className={`${portalCard} text-sm text-muted`}>{t('mechanicsEmpty')}</p>
        ) : (
          <ul className="space-y-3">
            {lists[tab].map((p) => (
              <PartnerRow key={p.slug} kind={tab} partner={p} actor={actor} />
            ))}
          </ul>
        )}
      </div>

      <section aria-labelledby="partner-history" className={portalCard}>
        <h3 id="partner-history" className="font-heading text-lg font-extrabold text-ink">
          {t('partnerHistory')}
        </h3>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('partnerHistoryEmpty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {history
              .slice(-10)
              .reverse()
              .map((c) => (
                <li key={`${c.kind}-${c.slug}-${c.at}`} className="py-2 text-sm text-ink">
                  <span className="font-bold">{nameOf(c.kind, c.slug)}</span> ·{' '}
                  {t('partnerLastChange', {
                    status: t(`partnerStatus_${c.status}`),
                    by: c.by,
                    date: formatDate(c.at, locale),
                    reason: c.reason,
                  })}
                </li>
              ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function PartnerRow({ kind, partner, actor }: { kind: PartnerKind; partner: Partner; actor: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  usePartnerHistory(); // re-render when any status changes
  const { status, change } = partnerStatus(kind, partner.slug);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `partner-reason-${kind}-${partner.slug}`;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action) return;
    const reason = new FormData(e.currentTarget).get('reason');
    const result = setPartnerStatus(
      kind,
      partner.slug,
      TARGET[action],
      typeof reason === 'string' ? reason : '',
      actor,
    );
    if (!result.ok) {
      setError(t('partnerErr_reason'));
      document.getElementById(fieldId)?.focus();
      return;
    }
    track('click', { id: `admin_partner_${action}`, path: window.location.pathname });
    setAction(null);
    setError(null);
  }

  return (
    <li className={portalCard}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading text-lg font-extrabold text-ink">{partner.name}</p>
          <p className="text-xs text-muted">{partner.area}</p>
        </div>
        <span className={`inline-flex rounded-pill px-3 py-1 text-xs font-extrabold ${PILL[status]}`}>
          {t(`partnerStatus_${status}`)}
        </span>
      </div>
      {status !== 'active' ? <p className="mt-2 text-sm text-muted">{t(`partnerEffect_${status}`)}</p> : null}
      {change ? (
        <p className="mt-1 text-xs text-muted">
          {t('partnerLastChange', {
            status: t(`partnerStatus_${change.status}`),
            by: change.by,
            date: formatDate(change.at, locale),
            reason: change.reason,
          })}
        </p>
      ) : null}

      {action ? (
        <form noValidate onSubmit={onSubmit} className="mt-3">
          <label htmlFor={fieldId} className="text-sm font-bold text-ink">
            {t('partnerReason')}
          </label>
          <input
            id={fieldId}
            name="reason"
            maxLength={300}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            className={portalField}
          />
          {error ? (
            <p id={`${fieldId}-error`} role="alert" className="mt-1 text-sm font-bold text-error">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" className={portalPrimary}>
              {t(`partnerConfirm_${action}`, { name: partner.name })}
            </button>
            <button
              type="button"
              onClick={() => {
                setAction(null);
                setError(null);
              }}
              className={portalQuiet}
            >
              {t('partnerCancel')}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {ACTIONS[status].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                setAction(a);
              }}
              className={portalQuiet}
            >
              {t(`partnerAction_${a}`)}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
