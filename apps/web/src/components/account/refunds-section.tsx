'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { DEMO_REFUNDS } from '@/demo/refunds';
import { track } from '@/lib/analytics';
import { SHOW_DEMO_CONTROLS } from '@/lib/data-mode';
import { RefundsFrame, RefundsList } from './refunds-list';

/** Account → Refunds in the browser demo (spec 05, 2026-11-23): three sample refunds, nothing real. */
export function RefundsSection() {
  const t = useTranslations('myRefunds');
  useEffect(() => {
    track('my_refunds_viewed', {
      count: DEMO_REFUNDS.length,
      inProgress: DEMO_REFUNDS.filter((r) => r.stage !== 'completed' && r.stage !== 'declined').length,
    });
  }, []);
  return (
    <RefundsFrame>
      <RefundsList refunds={DEMO_REFUNDS} linkTargets={false} />
      {SHOW_DEMO_CONTROLS ? <p className="text-xs text-muted">{t('demoNote')}</p> : null}
    </RefundsFrame>
  );
}
