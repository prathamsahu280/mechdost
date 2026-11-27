'use client';

import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { localizeWorkshop } from '@/demo/i18n/localize';
import { findWorkshop } from '@/demo/workshops';
import {
  declineRequest,
  proposeForRequest,
  requestStage,
  useRequests,
  type DemoServiceRequest,
  type RequestStage,
} from '@/demo/store';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import type { WorkshopTab } from '@/lib/workshop-portal-view';
import { WorkshopRoadside } from './workshop-roadside';
import { JobCard, RequestSummary } from './workshop-job';
import { useWorkshopAccount } from './workshop/workshop-frame';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

const SLOTS = ['morning', 'afternoon', 'evening'] as const;

/** Real sign-in: the tabs read and act through the API; demo builds never load them (Stream E, 2026-11-14). */
const loading = () => <div className="skeleton h-96 rounded-card" aria-hidden="true" />;
const WorkshopTodayApi = dynamic(() => import('./workshop-portal-api').then((m) => m.WorkshopTodayApi), {
  ssr: false,
  loading,
});
const WorkshopJobsApi = dynamic(() => import('./workshop-portal-api').then((m) => m.WorkshopJobsApi), {
  ssr: false,
  loading,
});
const WorkshopProfileApi = dynamic(() => import('./workshop-portal-api').then((m) => m.WorkshopProfileApi), {
  ssr: false,
  loading,
});
const WorkshopNumbersApi = dynamic(
  () => import('./workshop-performance-api').then((m) => m.WorkshopPerformanceApi),
  { ssr: false, loading },
);

/**
 * Workshop portal (spec 07; tabs since the partner portals UI upgrade, design 2026-11-27 § 6): propose slot +
 * expected cost; then the job card — vehicle received (odometer), itemised estimate, work on approved lines, bill,
 * paid at the workshop. The frame (guard, tabs, demo gate) lives in the layout; this renders one tab's body.
 */
export function WorkshopPortal({ tab }: { tab: WorkshopTab }) {
  const account = useWorkshopAccount();
  if (!account) return null;
  if (account.api) {
    if (tab === 'jobs') return <WorkshopJobsApi />;
    if (tab === 'numbers') return <WorkshopNumbersApi />;
    if (tab === 'profile') return <WorkshopProfileApi />;
    return (
      <>
        <WorkshopTodayApi />
        <WorkshopRoadside />
      </>
    );
  }
  if (tab === 'numbers' || tab === 'profile') return <ApiOnly />;
  return (
    <>
      <WorkshopRequests workshopSlug={account.slug} tab={tab} />
      {tab === 'today' ? <WorkshopRoadside /> : null}
    </>
  );
}

function ApiOnly() {
  const t = useTranslations('partnerWorkshop');
  return (
    <p className="rounded-card border border-dashed border-line-card bg-surface p-6 text-center text-sm text-muted">
      {t('api_only')}
    </p>
  );
}

function WorkshopRequests({ workshopSlug, tab }: { workshopSlug: string; tab: 'today' | 'jobs' }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const found = findWorkshop(workshopSlug);
  const workshop = found ? localizeWorkshop(found, locale) : undefined;
  const mine = useRequests().filter((r) => r.workshopSlug === workshopSlug && !r.cancellation);
  const at = (r: DemoServiceRequest, ...stages: RequestStage[]) => stages.includes(requestStage(r));
  const fresh = mine.filter((r) => at(r, 'requested') && !(r.declinedBy ?? []).includes(workshopSlug));
  const waiting = mine.filter((r) => at(r, 'proposed'));
  const jobs = mine.filter((r) => !at(r, 'requested', 'proposed', 'completed'));
  const done = mine.filter((r) => at(r, 'completed')).slice(0, 10);

  if (tab === 'jobs')
    return (
      <>
        <section aria-labelledby="jobs-title">
          <h2 id="jobs-title" className="font-heading text-xl font-extrabold text-ink">
            {t('jobs')}
          </h2>
          {jobs.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('noneJobs')}</p>
          ) : (
            <ul className="mt-3 grid gap-3 nav:grid-cols-2">
              {jobs.map((r) => (
                <li key={r.code}>
                  <JobCard request={r} workshopSlug={workshopSlug} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="completed-jobs">
          <h2 id="completed-jobs" className="font-heading text-xl font-extrabold text-ink">
            {t('completedJobs')} <span className="text-muted tabular-nums">({done.length})</span>
          </h2>
          {done.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('noneCompleted')}</p>
          ) : (
            <ul className={`mt-3 divide-y divide-line-card ${portalCard}`}>
              {done.map((r) => (
                <li key={r.code} className="flex flex-wrap justify-between gap-x-4 py-2 text-sm">
                  <span className="font-heading font-extrabold text-ink">{r.code}</span>
                  <span className="text-muted">
                    {r.bill ? formatPrice(r.bill.totalPaise) : t('noWorkApproved')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    );

  return (
    <>
      {workshop ? (
        <section className="blueprint rounded-card p-6 text-white shadow-card">
          <h2 className="font-heading text-2xl font-extrabold">🔧 {workshop.name}</h2>
          <p className="mt-1 text-sm text-white/80">
            {workshop.area} · {workshop.pincode} · ★&nbsp;{workshop.rating.toFixed(1)}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="new-requests">
        <h2 id="new-requests" className="font-heading text-xl font-extrabold text-ink">
          {t('newRequests')} <span className="text-muted tabular-nums">({fresh.length})</span>
        </h2>
        {fresh.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('noneRequests')}</p>
        ) : (
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {fresh.map((r) => (
              <li key={r.code}>
                <NewRequest request={r} workshopSlug={workshopSlug} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {waiting.length > 0 ? (
        <section aria-labelledby="waiting-requests">
          <h2 id="waiting-requests" className="font-heading text-xl font-extrabold text-ink">
            {t('waitingCustomer')}
          </h2>
          <ul className="mt-3 grid gap-3 nav:grid-cols-2">
            {waiting.map((r) => (
              <li key={r.code} className={portalCard}>
                <RequestSummary request={r} />
                {r.proposal ? (
                  <p className="mt-3 rounded-lg bg-accent-soft p-3 text-sm font-bold text-accent-soft-text">
                    {formatPrice(r.proposal.minPaise)} – {formatPrice(r.proposal.maxPaise)} ·{' '}
                    {t(`slot_${r.proposal.slot}`)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function NewRequest({ request: r, workshopSlug }: { request: DemoServiceRequest; workshopSlug: string }) {
  const t = useTranslations('portal');
  const [error, setError] = useState(false);
  const min = r.services.reduce((n, x) => n + x.minPaise, 0);
  const max = r.services.reduce((n, x) => n + x.maxPaise, 0);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const minPaise = Math.round(Number(text('min')) * 100);
    const maxPaise = Math.round(Number(text('max')) * 100);
    const slot = SLOTS.find((x) => x === text('slot')) ?? r.slot;
    if (!text('date') || !(minPaise > 0) || !(maxPaise >= minPaise)) {
      setError(true);
      return;
    }
    proposeForRequest(r.code, workshopSlug, {
      date: text('date'),
      slot,
      minPaise,
      maxPaise,
      note: text('note').slice(0, 300),
    });
    track('click', { id: 'workshop_proposal_sent', path: window.location.pathname });
  }

  const id = (k: string) => `${r.code}-${k}`;
  return (
    <article className={`${portalCard} border-accent-button/50`}>
      <RequestSummary request={r} />
      <form noValidate onSubmit={onSubmit} className="mt-4 space-y-3 border-t border-line pt-4">
        <h3 className="text-sm font-extrabold text-ink">{t('propose')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={id('date')} className="text-xs font-bold text-muted">
              {t('proposeDate')}
            </label>
            <input
              id={id('date')}
              name="date"
              type="date"
              defaultValue={r.date.slice(0, 10)}
              className={portalField}
            />
          </div>
          <div>
            <label htmlFor={id('slot')} className="text-xs font-bold text-muted">
              {t('proposeSlot')}
            </label>
            <select id={id('slot')} name="slot" defaultValue={r.slot} className={portalField}>
              {SLOTS.map((s) => (
                <option key={s} value={s}>
                  {t(`slot_${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={id('min')} className="text-xs font-bold text-muted">
              {t('minCost')}
            </label>
            <input
              id={id('min')}
              name="min"
              inputMode="numeric"
              defaultValue={min / 100}
              className={portalField}
            />
          </div>
          <div>
            <label htmlFor={id('max')} className="text-xs font-bold text-muted">
              {t('maxCost')}
            </label>
            <input
              id={id('max')}
              name="max"
              inputMode="numeric"
              defaultValue={max / 100}
              className={portalField}
            />
          </div>
        </div>
        <div>
          <label htmlFor={id('note')} className="text-xs font-bold text-muted">
            {t('proposalNote')}
          </label>
          <input id={id('note')} name="note" maxLength={300} className={portalField} />
        </div>
        {error ? (
          <p role="alert" className="text-sm font-bold text-error">
            {t('errProposal')}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={`${portalPrimary} flex-1`}>
            {t('sendProposal')}
          </button>
          <button
            type="button"
            onClick={() => {
              declineRequest(r.code, workshopSlug);
            }}
            className={portalQuiet}
          >
            {t('decline')}
          </button>
        </div>
      </form>
    </article>
  );
}
