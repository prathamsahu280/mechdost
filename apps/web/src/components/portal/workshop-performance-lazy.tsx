'use client';

import { lazy, Suspense, useState } from 'react';
import { useTranslations } from 'next-intl';
import { portalQuiet } from './portal-styles';

/**
 * The portal's Performance section behind a button, its code loaded only when it is opened (JS budget, coordinator
 * 2026-11-15; learning L177: `React.lazy` in a small wrapper, nothing in the header, layout or shop imports the
 * screen). The page keeps one primary action: the job list; this stays a quiet toggle below the workshop name.
 */
const Screen = lazy(() =>
  import('./workshop-performance-api').then((m) => ({ default: m.WorkshopPerformanceApi })),
);

export function WorkshopPerformanceLazy() {
  const t = useTranslations('workshopAnalytics');
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="performance-panel"
        data-track="workshop_performance_toggle"
        className={portalQuiet}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {open ? t('portal_hide') : t('portal_show')}
      </button>
      {open ? (
        <div id="performance-panel" className="mt-4">
          <Suspense fallback={<div className="skeleton h-64 rounded-card" aria-hidden="true" />}>
            <Screen />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
