'use client';

import { useLocale, useTranslations } from 'next-intl';
import { WEEK_ORDER, weekdayShort } from '@/lib/admin-shop-form';
import { portalField } from './portal-guard';

/**
 * Working hours inputs (IST): opening and closing time and the open weekdays. Shared by the admin shop editor and
 * the owner's hours card (user 2026-11-14). Closing "24:00" is offered as "Midnight" (open until the day ends).
 */
export function ShopHoursFields({
  idPrefix,
  open,
  close,
  days,
  onChange,
  invalid,
}: {
  idPrefix: string;
  open: string;
  close: string;
  days: readonly number[];
  onChange: (next: { open: string; close: string; days: number[] }) => void;
  invalid: { open?: boolean; close?: boolean; days?: boolean };
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const midnight = close === '24:00';
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-bold text-muted">{t('shops_api_hoursLegend')}</legend>
      <div className="grid gap-2 min-[480px]:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-open`} className="text-xs font-bold text-muted">
            {t('shops_api_hoursOpen')}
          </label>
          <input
            id={`${idPrefix}-open`}
            type="time"
            value={open}
            aria-invalid={invalid.open ? true : undefined}
            onChange={(e) => {
              onChange({ open: e.target.value, close, days: [...days] });
            }}
            className={portalField}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-close`} className="text-xs font-bold text-muted">
            {t('shops_api_hoursClose')}
          </label>
          <input
            id={`${idPrefix}-close`}
            type="time"
            value={midnight ? '' : close}
            disabled={midnight}
            aria-invalid={invalid.close ? true : undefined}
            aria-describedby={invalid.close ? `${idPrefix}-close-error` : undefined}
            onChange={(e) => {
              onChange({ open, close: e.target.value, days: [...days] });
            }}
            className={portalField}
          />
          <label className="mt-1 flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={midnight}
              onChange={(e) => {
                onChange({ open, close: e.target.checked ? '24:00' : '21:00', days: [...days] });
              }}
              className="size-5 accent-[var(--color-accent-button)]"
            />
            {t('shops_api_hoursMidnight')}
          </label>
          {invalid.close ? (
            <p id={`${idPrefix}-close-error`} className="text-xs font-bold text-error">
              {t('shops_api_hoursErrClose')}
            </p>
          ) : null}
        </div>
      </div>
      <div
        role="group"
        aria-labelledby={`${idPrefix}-days`}
        aria-describedby={invalid.days ? `${idPrefix}-days-error` : undefined}
      >
        <p id={`${idPrefix}-days`} className="text-xs font-bold text-muted">
          {t('shops_api_hoursDays')}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {WEEK_ORDER.map((d) => (
            <label
              key={d}
              className="flex min-h-11 items-center gap-2 rounded-pill border border-line-card px-3 text-sm text-ink"
            >
              <input
                type="checkbox"
                checked={days.includes(d)}
                onChange={(e) => {
                  onChange({
                    open,
                    close,
                    days: e.target.checked ? [...days, d] : days.filter((x) => x !== d),
                  });
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {weekdayShort(d, locale)}
            </label>
          ))}
        </div>
        {invalid.days ? (
          <p id={`${idPrefix}-days-error`} className="text-xs font-bold text-error">
            {t('shops_api_hoursErrDays')}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
