'use client';

import { PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { advanceRequest, REQUEST_STAGES, useRequests } from '@/demo/store';
import { formatDate, formatPrice } from '@/lib/format';
import { StatusTimeline } from '../commerce/status-timeline';
import { serviceNameFor, workshopNameFor } from '@/demo/i18n/localize';

/**
 * Service request status (spec 06): requested → workshop proposes slot + cost → customer accepts → vehicle
 * received → per-line estimate approval → work → ready. Demo controls stand in for the workshop's actions.
 */
export function RequestView({ code }: { code: string }) {
  const t = useTranslations('request');
  const w = useTranslations('workshop');
  const demo = useTranslations('demo');
  const locale = useLocale();
  const isNew = useSearchParams().get('new') === '1';
  const request = useRequests().find((r) => r.code === code);
  const base = locale === 'hi' ? '/hi' : '';

  if (!request) {
    return (
      <div className="rounded-card border border-line-card bg-surface p-8 shadow-card">
        <p className="text-muted">{t('notFound')}</p>
        <Link
          href={`${base}/workshops`}
          className="press mt-5 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white"
        >
          {w('back')}
        </Link>
      </div>
    );
  }

  // The workshop's own proposal when it made one; otherwise the menu ranges of the requested services.
  const min = request.proposal?.minPaise ?? request.services.reduce((s, x) => s + x.minPaise, 0);
  const max = request.proposal?.maxPaise ?? request.services.reduce((s, x) => s + x.maxPaise, 0);
  const slotLabel = w(request.proposal?.slot ?? request.slot);
  const steps = REQUEST_STAGES.map((s) => ({ key: s, title: t(`stage_${s}`), detail: t(`detail_${s}`) }));
  const proposed = request.stage === 1;
  const workshopName = workshopNameFor(request.workshopSlug, request.workshopName, locale);

  return (
    <div className="grid gap-6 nav:grid-cols-[1fr_380px] nav:items-start">
      <div className="space-y-6">
        {isNew ? (
          <div
            role="status"
            className="animate-page-in flex items-center gap-3 rounded-card bg-success-bg p-5 text-success"
          >
            <PartyPopper aria-hidden="true" className="size-6 shrink-0" />
            <p className="font-heading font-bold">{t('thanks', { workshop: workshopName })}</p>
          </div>
        ) : null}
        <section className="rounded-card border border-line-card bg-surface p-6 shadow-card">
          <h2 className="font-heading text-lg font-extrabold text-ink">{t('statusLabel')}</h2>
          <div className="mt-5">
            <StatusTimeline
              label={t('statusLabel')}
              steps={steps}
              current={request.stage}
              currentLabel={t('stage_requested')}
            />
          </div>
          {proposed ? (
            <div className="mt-6 rounded-tile border border-accent-soft bg-accent-soft p-4">
              <p className="text-sm font-bold text-accent-soft-text">
                {t('proposal', {
                  date: formatDate(request.proposal?.date ?? request.date, locale),
                  slot: slotLabel,
                  min: formatPrice(min),
                  max: formatPrice(max),
                })}
              </p>
              {request.proposal?.note ? (
                <p data-user-content className="mt-1 text-sm text-ink">
                  “{request.proposal.note}”
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  advanceRequest(request.code);
                }}
                className="press mt-3 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
              >
                {t('accept')}
              </button>
            </div>
          ) : null}
          {!proposed && request.stage < REQUEST_STAGES.length - 1 ? (
            <details className="mt-6 rounded-lg border border-dashed border-line p-3 text-sm">
              <summary className="cursor-pointer font-bold text-muted">{demo('controls')}</summary>
              <button
                type="button"
                onClick={() => {
                  advanceRequest(request.code);
                }}
                className="press mt-3 inline-flex min-h-10 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
              >
                {demo('advance')}
              </button>
            </details>
          ) : null}
        </section>
      </div>

      <aside className="space-y-4 rounded-card border border-line-card bg-surface p-6 shadow-card text-sm">
        <div>
          <h2 className="font-heading font-bold text-ink">{workshopName}</h2>
          <p className="text-muted">{formatDate(request.createdAt, locale)}</p>
        </div>
        <div>
          <h3 className="font-bold text-ink">{t('vehicle')}</h3>
          <p className="text-muted">
            {request.vehicleType} · <span data-user-content>{request.vehicle}</span>
          </p>
        </div>
        <div>
          <h3 className="font-bold text-ink">{t('when')}</h3>
          <p className="text-muted">
            {formatDate(request.date, locale)} · {slotLabel}
          </p>
        </div>
        <div>
          <h3 className="font-bold text-ink">{t('services')}</h3>
          <ul className="mt-1 space-y-1">
            {request.services.map((s) => (
              <li key={s.key} className="flex justify-between gap-3">
                <span>{serviceNameFor(s.key, s.name, locale)}</span>
                <span className="text-muted">
                  {formatPrice(s.minPaise)}–{formatPrice(s.maxPaise)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-bold text-ink">
            {w('estimate', { min: formatPrice(min), max: formatPrice(max) })}
          </p>
        </div>
        {request.concern ? (
          <p data-user-content className="rounded-lg bg-surface-alt p-3 text-muted">
            {request.concern}
          </p>
        ) : null}
        <p className="text-[11px] text-muted">{demo('note')}</p>
      </aside>
    </div>
  );
}
