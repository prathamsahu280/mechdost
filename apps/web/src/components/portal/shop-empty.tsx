'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { portalQuiet } from './portal-styles';
import { site } from '@/lib/site';

/** An empty list with one next action (assessment 2026-11-15, item 6): a sentence and one link to where to go next. */
export function EmptyWithAction({
  text,
  actionLabel,
  href,
}: {
  text: string;
  actionLabel: string;
  /** An in-page anchor (`#id`) on this screen. */
  href: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <p className="text-sm text-muted">{text}</p>
      <a href={href} className={portalQuiet}>
        {actionLabel}
      </a>
    </div>
  );
}

/**
 * Delivery code locked (assessment 2026-11-15, item 5): shown from the server's state, so a reload does not forget
 * it. Says what happens next and gives the support phone and the support page.
 */
export function DeliveryLocked() {
  const t = useTranslations('shopTier1');
  const prefix = useLocale() === 'hi' ? '/hi' : '';
  return (
    <div role="alert" className="mt-4 rounded-lg bg-warning-bg p-3 text-sm text-warning">
      <p className="font-extrabold">{t('lockedTitle')}</p>
      <p className="mt-1">{t('lockedBody')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`tel:${site.supportPhoneE164}`} className={portalQuiet}>
          {t('lockedCall', { phone: site.supportPhone })}
        </a>
        <Link href={`${prefix}/support`} className={portalQuiet}>
          {t('lockedMessage')}
        </Link>
      </div>
    </div>
  );
}
