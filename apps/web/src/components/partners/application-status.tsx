'use client';

import { BadgeCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { APPLICATION_STAGES, updateApplication, useApplications } from '@/demo/store';
import { formatDate } from '@/lib/format';
import { StatusTimeline } from '../commerce/status-timeline';

/** Partner application status (spec 07). Demo controls stand in for the admin review. */
export function ApplicationStatus({ code }: { code: string }) {
  const t = useTranslations('apply');
  const demo = useTranslations('demo');
  const locale = useLocale();
  const isNew = useSearchParams().get('new') === '1';
  const app = useApplications().find((a) => a.code === code);
  const base = locale === 'hi' ? '/hi' : '';

  if (!app) {
    return (
      <div className="rounded-card border border-line-card bg-surface p-8 shadow-card">
        <p className="text-muted">{t('notFound')}</p>
        <Link
          href={`${base}/partners`}
          className="press mt-5 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white"
        >
          {t('back')}
        </Link>
      </div>
    );
  }

  const steps: { key: string; title: string; detail: string }[] = APPLICATION_STAGES.map((s) => ({
    key: s,
    title: t(`stage_${s}`),
    detail: t(`detail_${s}`),
  }));
  if (app.rejected) {
    steps.splice(app.stage + 1, steps.length, {
      key: 'rejected',
      title: t('stage_rejected'),
      detail: t('detail_rejected'),
    });
  }

  return (
    <div className="grid gap-6 nav:grid-cols-[1fr_380px] nav:items-start">
      <section className="rounded-card border border-line-card bg-surface p-6 shadow-card">
        {isNew ? (
          <div
            role="status"
            className="animate-page-in mb-6 flex gap-3 rounded-tile bg-success-bg p-5 text-success"
          >
            <BadgeCheck aria-hidden="true" className="size-6 shrink-0" />
            <div>
              <p className="font-heading font-bold">{t('received')}</p>
              <p className="mt-1 text-sm">{t('thanks', { name: app.name, phone: app.phone })}</p>
            </div>
          </div>
        ) : null}
        <h2 className="font-heading text-lg font-extrabold text-ink">{t('statusLabel')}</h2>
        <div className="mt-5">
          <StatusTimeline
            label={t('statusLabel')}
            steps={steps}
            current={app.rejected ? app.stage + 1 : app.stage}
            currentLabel={t('statusLabel')}
          />
        </div>
        {!app.rejected && app.stage < APPLICATION_STAGES.length - 1 ? (
          <details className="mt-6 rounded-lg border border-dashed border-line p-3 text-sm">
            <summary className="cursor-pointer font-bold text-muted">{demo('controls')}</summary>
            <button
              type="button"
              onClick={() => {
                updateApplication(app.code, { stage: app.stage + 1 });
              }}
              className="press mt-3 inline-flex min-h-10 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
            >
              {demo('advance')}
            </button>
          </details>
        ) : null}
      </section>
      <aside className="space-y-2 rounded-card border border-line-card bg-surface p-6 text-sm shadow-card">
        <p className="font-heading text-lg font-extrabold text-ink">{t(`title_${app.kind}`)}</p>
        <p className="text-muted">{formatDate(app.createdAt, locale)}</p>
        <p className="text-ink">
          {app.name} · {app.phone}
        </p>
        {app.business ? <p className="text-ink">{app.business}</p> : null}
        <p className="text-muted">PIN {app.pincode}</p>
        <p className="rounded-lg bg-surface-alt p-3 text-muted">{app.details}</p>
        <p className="text-[11px] text-muted">{demo('note')}</p>
      </aside>
    </div>
  );
}
