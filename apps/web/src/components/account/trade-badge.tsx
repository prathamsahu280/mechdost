'use client';

import { BadgeCheck, Hourglass } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { TradeStatus } from '@mechdost/shared/business-codes';

/**
 * The "Trade account" pill in the account overview (audience entry design 2026-11-22, item 4): a verified account
 * shows the badge, an application waiting shows "under review"; nothing otherwise. The status is text, not only an
 * icon. Real sign-in only; loaded lazily (`lazy()` in the overview), so no other page carries it.
 */
export function TradeBadge() {
  const t = useTranslations('account');
  const locale = useLocale();
  const [status, setStatus] = useState<TradeStatus>('none');
  useEffect(() => {
    let live = true;
    void import('@/lib/business-api')
      .then(({ fetchTradeProfile }) => fetchTradeProfile(locale))
      .then((res) => {
        if (live && res.ok) setStatus(res.data.status);
      });
    return () => {
      live = false;
    };
  }, [locale]);
  if (status !== 'verified' && status !== 'pending') return null;
  const Icon = status === 'verified' ? BadgeCheck : Hourglass;
  return (
    <li className="inline-flex items-center gap-1.5 rounded-pill bg-white/12 px-3 py-1.5">
      <Icon aria-hidden="true" className="size-4" />
      {status === 'verified' ? t('tradeBadge') : t('tradePending')}
    </li>
  );
}
