'use client';

import { Globe, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useLocale, useMessages, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  devicePlaceText,
  type DeviceBrowser,
  type DeviceKind,
  type DeviceOs,
  type DeviceView,
} from '@mechdost/shared/devices';
import { track } from '@/lib/analytics';
import { activeAgo, istDate } from '@/lib/device-time';
import { fetchDevices, signOutDevice, signOutOtherDevices } from '@/lib/devices-api';
import { AUTH_MODE } from '@/lib/auth/mode';

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill disabled:opacity-60';
const danger =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-error px-4 text-sm font-bold text-error hover:bg-pill disabled:opacity-60';

/** Brand names stay in Latin on /hi (hard rule 10); "other" is translated. */
const BROWSER_NAME: Record<Exclude<DeviceBrowser, 'other'>, string> = {
  chrome: 'Chrome',
  safari: 'Safari',
  firefox: 'Firefox',
  edge: 'Edge',
  samsung: 'Samsung Internet',
  opera: 'Opera',
};
const OS_NAME: Record<Exclude<DeviceOs, 'other'>, string> = {
  android: 'Android',
  ios: 'iOS',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};
const KIND_ICON: Record<DeviceKind, typeof Globe> = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
  other: Globe,
};

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; devices: DeviceView[] };

/**
 * Account → Profile → "Where you're signed in" (spec 01 § Devices, decision 2026-11-28). The API's own rows for this
 * person: device (kind icon, "Chrome on Android"), a rough place labelled "Near …", when it was last active, "This
 * device" with no button, an inline confirm before ending another device, and one "Sign out of all other devices".
 * Real sign-in only. Results are announced in one polite status region.
 */
export function DevicesCard() {
  const t = useTranslations('devices');
  const stateNames: Record<string, string> = Object.fromEntries(Object.entries(useMessages().gstStates));
  const locale = useLocale();
  const lang = locale === 'hi' ? 'hi' : 'en';
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [confirm, setConfirm] = useState<string | 'others' | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean }>({ text: '', error: false });
  const [now, setNow] = useState(0);
  const viewed = useRef(false);
  const yesRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetchDevices(locale);
    setNow(Date.now());
    setLoad(res.ok ? { state: 'ready', devices: res.data.devices } : { state: 'error' });
  }, [locale]);

  useEffect(() => {
    if (AUTH_MODE !== 'firebase') return;
    void reload();
  }, [reload]);

  useEffect(() => {
    if (load.state !== 'ready' || viewed.current) return;
    viewed.current = true;
    track('account_devices_viewed', {
      count: load.devices.length,
      others: load.devices.filter((d) => !d.current).length,
    });
  }, [load]);

  useEffect(() => {
    if (confirm) yesRef.current?.focus();
  }, [confirm]);

  if (AUTH_MODE !== 'firebase') return null;

  const label = (d: DeviceView) =>
    t('label', {
      browser: d.browser === 'other' ? t('browserOther') : BROWSER_NAME[d.browser],
      os: d.os === 'other' ? t('osOther') : OS_NAME[d.os],
    });

  const place = (d: DeviceView) => {
    const text = devicePlaceText(lang, d.place, stateNames);
    return text ? t('placeNear', { place: text }) : null;
  };

  const ago = (d: DeviceView) => {
    const a = activeAgo(d.lastActiveAt, now);
    if (a.kind === 'now') return t('activeNow');
    if (a.kind === 'minutes') return t('activeMinutes', { n: a.n });
    if (a.kind === 'hours') return t('activeHours', { n: a.n });
    if (a.kind === 'days') return t('activeDays', { n: a.n });
    return t('activeDate', { date: istDate(d.lastActiveAt, locale) });
  };

  function close() {
    const id = opener.current;
    setConfirm(null);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function endOne(d: DeviceView) {
    setBusy(true);
    const res = await signOutDevice(locale, d.id);
    setBusy(false);
    if (res.ok) {
      track('account_device_signed_out', { deviceKind: d.deviceKind, browser: d.browser, os: d.os });
      setStatus({ text: t('doneOne'), error: false });
      setConfirm(null);
      await reload();
      return;
    }
    setStatus({ text: res.status === 404 ? t('errGone') : t('errGeneric'), error: true });
    setConfirm(null);
    if (res.status === 404) await reload();
  }

  async function endOthers() {
    setBusy(true);
    const res = await signOutOtherDevices(locale);
    setBusy(false);
    setConfirm(null);
    if (res.ok) {
      track('account_devices_signed_out_others', { count: Math.min(50, res.data.signedOut) });
      setStatus({ text: t('doneOthers', { count: res.data.signedOut }), error: false });
      await reload();
      return;
    }
    setStatus({ text: t('errGeneric'), error: true });
  }

  const devices = load.state === 'ready' ? load.devices : [];
  const others = devices.filter((d) => !d.current);
  const anyPlace = devices.some((d) => place(d));

  return (
    <section aria-labelledby="devices-title" className={`${card} mt-6 max-w-xl space-y-4`}>
      <h2 id="devices-title" className="font-heading text-xl font-extrabold text-ink">
        {t('title')}
      </h2>
      <p className="max-w-prose text-sm text-muted">{t('intro')}</p>

      {load.state === 'loading' ? <div className="skeleton h-24 rounded-card" aria-hidden="true" /> : null}

      {load.state === 'error' ? (
        <div role="alert">
          <p className="text-sm font-bold text-ink">{t('loadError')}</p>
          <button type="button" className={`${quiet} mt-3`} onClick={() => void reload()}>
            {t('retry')}
          </button>
        </div>
      ) : null}

      {load.state === 'ready' && devices.length === 0 ? (
        <div>
          <p className="text-sm font-bold text-ink">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted">{t('emptyHelp')}</p>
          <a href="#security-title" className={`${quiet} mt-3`}>
            {t('emptyAction')}
          </a>
        </div>
      ) : null}

      {devices.length > 0 ? (
        <ul className="divide-y divide-line">
          {devices.map((d) => {
            const Icon = KIND_ICON[d.deviceKind];
            const where = place(d);
            const buttonId = `device-signout-${d.id}`;
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <Icon aria-hidden="true" className="size-6 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-ink">
                    {label(d)}
                    {d.current ? (
                      <span className="ml-2 inline-block rounded-full bg-pill px-2 py-0.5 align-middle text-xs font-bold text-ink">
                        {t('thisDevice')}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted">{[where, ago(d)].filter(Boolean).join(' · ')}</p>
                </div>
                {d.current ? null : confirm === d.id ? (
                  <div
                    role="group"
                    aria-label={t('confirmOne')}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="text-sm font-bold text-ink">{t('confirmOne')}</span>
                    <button
                      ref={yesRef}
                      type="button"
                      disabled={busy}
                      className={danger}
                      onClick={() => void endOne(d)}
                    >
                      {busy ? t('busy') : t('confirmOneYes')}
                    </button>
                    <button type="button" disabled={busy} className={quiet} onClick={close}>
                      {t('keep')}
                    </button>
                  </div>
                ) : (
                  <button
                    id={buttonId}
                    type="button"
                    disabled={busy}
                    aria-label={t('signOutOf', { device: label(d) })}
                    className={quiet}
                    onClick={() => {
                      opener.current = buttonId;
                      setConfirm(d.id);
                    }}
                  >
                    {t('signOut')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {load.state === 'ready' && devices.length > 0 ? (
        others.length > 0 ? (
          confirm === 'others' ? (
            <div role="group" aria-label={t('signOutOthers')} className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-ink">
                {t('confirmOthers', { count: others.length })}
              </span>
              <button
                ref={yesRef}
                type="button"
                disabled={busy}
                className={danger}
                onClick={() => void endOthers()}
              >
                {busy ? t('busy') : t('confirmOneYes')}
              </button>
              <button type="button" disabled={busy} className={quiet} onClick={close}>
                {t('keep')}
              </button>
            </div>
          ) : (
            <button
              id="devices-signout-others"
              type="button"
              disabled={busy}
              className={quiet}
              onClick={() => {
                opener.current = 'devices-signout-others';
                setConfirm('others');
              }}
            >
              {t('signOutOthers')}
            </button>
          )
        ) : (
          <p className="text-sm text-muted">{t('onlyThis')}</p>
        )
      ) : null}

      <p
        role="status"
        aria-live="polite"
        className={`min-h-5 text-sm font-bold ${status.error ? 'text-error' : 'text-success'}`}
      >
        {status.text}
      </p>

      <p className="text-sm text-muted">
        {t('legacyNote')} {t('legacyLead')}{' '}
        <a href="#security-title" className="font-bold text-ink underline">
          {t('legacyLink')}
        </a>
        {t('legacyTail')}
      </p>
      {anyPlace ? (
        <p className="text-xs text-muted">
          {t('placeNote')} {t('attributionLead')}{' '}
          <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer" className="underline">
            DB-IP
          </a>
        </p>
      ) : null}
    </section>
  );
}
