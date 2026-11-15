'use client';

import { lazy, Suspense, useState } from 'react';
import { useTranslations } from 'next-intl';
import { portalQuiet } from './portal-styles';

/**
 * The staff performance and earnings section behind a button, its code loaded only when it is opened (JS budget,
 * learning L177: `React.lazy` in a small wrapper, nothing else imports the screen). The page keeps its one primary
 * action; this is a quiet toggle, and the open panel closes with the same button (or Escape, through the
 * disclosure hooks).
 */
const Screen = lazy(() =>
  import('./shop-staff-performance-api').then((m) => ({ default: m.ShopStaffPerformanceApi })),
);

export function ShopStaffPerformanceLazy({ shopId, isOwner }: { shopId: string; isOwner: boolean }) {
  const t = useTranslations('shopTier2');
  const [open, setOpen] = useState(false);
  const panel = `shop-staff-panel-${shopId}`;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        data-disclosure-trigger="shop-staff-performance"
        data-panel-cancel={open ? 'shop-staff-performance' : undefined}
        data-track="shop_staff_performance_toggle"
        className={portalQuiet}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {open ? t('staffHide') : isOwner ? t('staffToggleOwner') : t('staffToggleSelf')}
      </button>
      {open ? (
        <div id={panel} data-panel-for="shop-staff-performance" className="mt-4">
          <Suspense fallback={<div className="skeleton h-40 rounded-card" aria-hidden="true" />}>
            <Screen shopId={shopId} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
