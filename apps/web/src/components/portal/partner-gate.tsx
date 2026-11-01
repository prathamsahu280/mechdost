'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { usePartnerStatus, type PartnerKind } from '@/demo/partner-status';
import { formatDate } from '@/lib/format';
import { site } from '@/lib/site';
import { portalCard } from './portal-guard';

/**
 * Applies the admin's partner status inside a portal (decision 2026-11-01): suspended → the portal is locked and
 * the reason is shown; paused → a banner explains that no new work arrives, current work continues.
 */
export function PartnerGate({
  kind,
  slug,
  children,
}: {
  kind: PartnerKind;
  slug: string;
  children: ReactNode;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const { status, change } = usePartnerStatus(kind, slug);

  if (status === 'suspended') {
    return (
      <section aria-labelledby="suspended-title" className={`${portalCard} border-error`}>
        <h2 id="suspended-title" className="font-heading text-xl font-extrabold text-ink">
          <span aria-hidden="true">⛔ </span>
          {t('suspendedTitle')}
        </h2>
        <p className="mt-2 text-sm text-ink">{t('suspendedBody')}</p>
        {change ? (
          <p data-user-content className="mt-3 rounded-lg bg-pill p-3 text-sm text-ink">
            {t('statusReason', { reason: change.reason, date: formatDate(change.at, locale) })}
          </p>
        ) : null}
        <a
          href={`tel:${site.supportPhoneE164}`}
          className="mt-4 inline-flex min-h-11 items-center font-bold text-accent-soft-text underline-offset-4 hover:underline"
        >
          {t('callSupport', { phone: site.supportPhone })}
        </a>
      </section>
    );
  }

  return (
    <>
      {status === 'paused' ? (
        <p role="status" className="rounded-lg bg-warning-bg p-4 text-sm text-warning">
          <span className="font-bold">{t('pausedTitle')}</span> {t('pausedBody')}
          {change ? (
            <span data-user-content className="mt-1 block">
              {t('statusReason', { reason: change.reason, date: formatDate(change.at, locale) })}
            </span>
          ) : null}
        </p>
      ) : null}
      {children}
    </>
  );
}
