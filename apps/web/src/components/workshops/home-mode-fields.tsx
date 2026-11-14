'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { SavedAddress } from '@mechdost/shared/account-api';
import type { ServiceMode } from '@mechdost/shared/state';
import { useEffect, useId, useState } from 'react';
import { fetchAddresses } from '@/lib/account-api';
import { formatPrice } from '@/lib/format';
import { pinnedAddresses, visitFeeGstPaise } from '@/lib/home-service-views';

/** The saved addresses of the signed-in customer for a home visit; `pinned` are the ones the API accepts. */
export type HomeAddresses =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; all: SavedAddress[]; pinned: SavedAddress[] };

export function useHomeAddresses(enabled: boolean): HomeAddresses {
  const locale = useLocale();
  const [result, setResult] = useState<HomeAddresses>({ state: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void fetchAddresses(locale).then((res) => {
      if (!live) return;
      setResult(
        res.ok ? { state: 'ready', all: res.data, pinned: pinnedAddresses(res.data) } : { state: 'error' },
      );
    });
    return () => {
      live = false;
    };
  }, [enabled, locale]);
  return result;
}

const radio = (on: boolean) =>
  `press inline-flex min-h-11 cursor-pointer items-center rounded-button border px-4 text-sm font-bold ${
    on ? 'border-accent-button bg-accent-soft text-accent-soft-text' : 'border-input-border text-ink'
  }`;

/** "At the workshop / At my home": one calm choice, the workshop is the default. */
export function ServiceModeSwitch({
  mode,
  onChange,
}: {
  mode: ServiceMode;
  onChange: (mode: ServiceMode) => void;
}) {
  const t = useTranslations('homeService');
  return (
    <fieldset>
      <legend className="text-sm font-bold text-ink">{t('modeLabel')}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {(['workshop', 'home'] as const).map((m) => (
          <label key={m} className={radio(mode === m)}>
            <input
              type="radio"
              name="serviceMode"
              value={m}
              checked={mode === m}
              onChange={() => {
                onChange(m);
              }}
              className="sr-only"
            />
            {t(m === 'home' ? 'modeHome' : 'modeWorkshop')}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The visit fee as the customer will pay it (GST only when the workshop is registered), shown before booking. */
export function VisitFeeLine({
  feePaise,
  gstRegistered,
  className = '',
}: {
  feePaise: number;
  gstRegistered: boolean;
  className?: string;
}) {
  const t = useTranslations('homeService');
  const gst = visitFeeGstPaise(feePaise, gstRegistered);
  const text =
    feePaise === 0
      ? t('visitFeeFreeLine')
      : gst > 0
        ? t('visitFeeGstLine', { fee: formatPrice(feePaise), gst: formatPrice(gst) })
        : t('visitFeeLine', { fee: formatPrice(feePaise) });
  return (
    <div role="status" className={`rounded-lg bg-surface-alt px-3 py-2 text-sm ${className}`}>
      <p className="font-bold text-ink">{text}</p>
      <p className="mt-0.5 text-xs text-muted">{t('visitFeeCancel')}</p>
    </div>
  );
}

/**
 * Address choice for a home visit: only saved addresses with a map pin are offered. Empty states carry one next
 * action (sign in, or add and pin an address in the account).
 */
export function HomeAddressPicker({
  addresses,
  signedIn,
  value,
  onChange,
  error,
  fieldId,
}: {
  addresses: HomeAddresses;
  signedIn: boolean;
  value: string;
  onChange: (id: string) => void;
  error?: string;
  fieldId: string;
}) {
  const t = useTranslations('homeService');
  const locale = useLocale();
  const hint = useId();
  const prefix = locale === 'hi' ? '/hi' : '';
  const here = typeof window === 'undefined' ? `${prefix}/workshops` : window.location.pathname;
  const link =
    'mt-2 inline-flex min-h-11 items-center font-bold text-accent-soft-text underline underline-offset-2';

  if (!signedIn)
    return (
      <div>
        <p className="text-sm text-ink">{t('signInForHome')}</p>
        <Link href={`${prefix}/login?next=${encodeURIComponent(here)}`} className={link}>
          {t('modeHome')}
        </Link>
      </div>
    );
  if (addresses.state === 'loading')
    return (
      <p role="status" className="text-sm text-muted">
        {t('homeFinderLoading')}
      </p>
    );
  if (addresses.state === 'error')
    return (
      <p role="alert" className="text-sm font-bold text-error">
        {t('err_HOME_NEEDS_PIN')}
      </p>
    );
  if (addresses.pinned.length === 0)
    return (
      <div>
        <p className="text-sm text-ink">
          {addresses.all.length === 0 ? t('noAddress') : t('noPinnedAddress')}
        </p>
        <Link href={`${prefix}/account/addresses`} className={link}>
          {t('addAddress')}
        </Link>
      </div>
    );
  return (
    <div>
      <label htmlFor={fieldId} className="text-sm font-bold text-ink">
        {t('addressLabel')}
      </label>
      <select
        id={fieldId}
        value={value}
        data-user-content
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? hint : undefined}
        onChange={(e) => {
          onChange(e.currentTarget.value);
        }}
        className="mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink aria-[invalid=true]:border-error"
      >
        <option value="">{t('addressChoose')}</option>
        {addresses.pinned.map((a) => (
          <option key={a.id} value={a.id}>
            {`${a.line1}, ${a.pincode}`}
          </option>
        ))}
      </select>
      {error ? (
        <p id={hint} className="mt-1 text-xs font-bold text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
