'use client';

import type { MyShopDto } from '@mechdost/shared/shop-api';
import { ShopBusySaved, SHOP_BUSY_HOUR_CHOICES, type ShopBusyBody } from '@mechdost/shared/shop-team';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { istDayTime } from '@/lib/admin-shop-form';
import { track } from '@/lib/analytics';
import { tier1ErrorKey } from '@/lib/shop-tier1';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';
import { FlashNote, useFlash } from './shop-flash';

/**
 * "Closed today" / "Busy for N hours" (design 2026-11-15, spec 04/07). The owner switches the shop off for new
 * offers without pausing it: MechDost routing, suggestions and checkout skip a busy shop and it comes back by itself
 * when the time ends. Staff see the state, not the controls. Real API mode only; own module (JS budget).
 */
export function BusyCard({ shop: s, onChanged }: { shop: MyShopDto; onChanged: () => Promise<void> }) {
  const t = useTranslations('shopTier1');
  const locale = useLocale();
  const [hours, setHours] = useState<number>(SHOP_BUSY_HOUR_CHOICES[1]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { flash, show } = useFlash();
  const id = `shop-busy-${s.id}`;

  async function save(body: ShopBusyBody) {
    setWorking(true);
    setError(null);
    const res = await adminApi(locale, `/shop/busy/${s.id}`, ShopBusySaved, { method: 'PUT', body });
    setWorking(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('click', { id: `shop_busy_${body.mode}`, path: window.location.pathname });
    show({
      tone: 'ok',
      text:
        body.mode === 'closed_today'
          ? t('busySavedClosed')
          : body.mode === 'hours'
            ? t('busySavedHours', { count: body.hours })
            : t('busySavedClear'),
    });
    await onChanged();
  }

  return (
    <section aria-labelledby={`${id}-title`} className={portalCard}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="font-heading text-lg font-extrabold text-ink">
          {t('busyTitle')}
        </h3>
        <span
          className={`rounded-pill px-3 py-1 text-xs font-extrabold ${s.busy ? 'bg-warning-bg text-warning' : 'bg-success-bg text-success'}`}
        >
          {s.busy
            ? s.busyUntil
              ? t('busyUntil', { time: istDayTime(s.busyUntil, locale) })
              : t('busyClosedToday')
            : t('busyOpen')}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{t('busyNote')}</p>
      {s.isOwner ? (
        <div className="mt-3 space-y-3" aria-busy={working || undefined}>
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              disabled={working}
              onClick={() => void save({ mode: 'closed_today' })}
              className={portalQuiet}
            >
              {t('busyClosedToday')}
            </button>
            <div className="min-w-[14rem] flex-1">
              <label htmlFor={`${id}-hours`} className="text-xs font-bold text-muted">
                {t('busyHoursLabel')}
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <select
                  id={`${id}-hours`}
                  value={hours}
                  onChange={(e) => {
                    setHours(Number(e.target.value));
                  }}
                  className={`${portalField} mt-1 min-w-0`}
                >
                  {SHOP_BUSY_HOUR_CHOICES.map((h) => (
                    <option key={h} value={h}>
                      {t('busyHoursOption', { count: h })}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void save({ mode: 'hours', hours })}
                  className={`${portalQuiet} mt-1`}
                >
                  {t('busyApply')}
                </button>
              </div>
            </div>
          </div>
          {s.busy ? (
            <button
              type="button"
              disabled={working}
              onClick={() => void save({ mode: 'clear' })}
              className={`${portalPrimary} w-full`}
            >
              {t('busyClear')}
            </button>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm font-bold text-error">
              {t(tier1ErrorKey(error))}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">{t('busyOwnerOnly')}</p>
      )}
      <div className="mt-3">
        <FlashNote flash={flash} />
      </div>
    </section>
  );
}
