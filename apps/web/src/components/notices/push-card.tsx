'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { track } from '@/lib/analytics';
import { fetchNoticePreferences } from '@/lib/notices-api';
import {
  PUSH_CONFIGURED,
  clearPushSnooze,
  probeBrowser,
  pushEnvironment,
  pushSnoozed,
  savedPushDeviceId,
  snoozePush,
  type PushEnvironment,
} from '@/lib/push/push-state';

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card';
const primary =
  'press inline-flex min-h-11 items-center justify-center rounded-button bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill disabled:opacity-60';

type Phase = { kind: 'checking' } | { kind: 'ready'; env: PushEnvironment; enabled: boolean };

/** This browser's push situation, read after mount (the server knows nothing about it). */
function useDevice() {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [snoozed, setSnoozed] = useState(true);
  useEffect(() => {
    const env = pushEnvironment(probeBrowser());
    setPhase({ kind: 'ready', env, enabled: env === 'granted' && savedPushDeviceId() !== null });
    setSnoozed(pushSnoozed());
  }, []);
  return { phase, setPhase, snoozed, setSnoozed };
}

/**
 * The "Get order and booking updates on this device" card (spec 10, design 2026-11-15). Shown once soon after sign-in
 * on the first screens a person lands on (account, shop, workshop, admin home) and in the notification centre; never a
 * browser prompt before the person taps "Turn on" (the Firebase library loads then, not before). "Not now" hides it for
 * the admin-set number of days. Hidden entirely until the push key is set (Q103). On iPhone it explains "Add to Home
 * Screen" first. A browser that said no is not nagged here; the notification settings explain how to undo it.
 */
export function PushPrompt({ partner = false }: { partner?: boolean }) {
  const t = useTranslations('bell');
  const locale = useLocale();
  const { phase, setPhase, snoozed, setSnoozed } = useDevice();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'failed' | null>(null);

  const showable =
    PUSH_CONFIGURED &&
    phase.kind === 'ready' &&
    !snoozed &&
    !phase.enabled &&
    (phase.env === 'default' || phase.env === 'granted' || phase.env === 'ios-needs-home-screen');
  const variant = phase.kind === 'ready' && phase.env === 'ios-needs-home-screen' ? 'ios' : 'normal';
  useEffect(() => {
    if (showable) track('push_prompt_shown', { variant });
  }, [showable, variant]);
  if (!showable) return null;

  async function notNow(answer: 'not_now' | 'ios_done') {
    track('push_prompt_answered', { answer });
    const prefs = await fetchNoticePreferences(locale);
    snoozePush(prefs.ok ? prefs.data.promptSnoozeDays : 14);
    setSnoozed(true);
  }

  async function turnOn() {
    setBusy(true);
    setProblem(null);
    track('push_prompt_answered', { answer: 'turn_on' });
    const { enablePush } = await import('@/lib/push/enable-push');
    const res = await enablePush(locale);
    setBusy(false);
    if (res.ok) {
      clearPushSnooze();
      track('push_enabled', { source: 'card' });
      setPhase({ kind: 'ready', env: 'granted', enabled: true });
    } else if (res.reason === 'denied') setPhase({ kind: 'ready', env: 'denied', enabled: false });
    else setProblem('failed');
  }

  return (
    <section aria-labelledby="push-prompt-title" className={`${card} mb-6 flex flex-wrap items-start gap-4`}>
      <div className="min-w-0 flex-1 basis-64">
        <h2 id="push-prompt-title" className="font-heading text-base font-extrabold text-ink">
          {variant === 'ios' ? t('iosTitle') : partner ? t('promptTitlePartner') : t('promptTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{variant === 'ios' ? t('iosBody') : t('promptBody')}</p>
        {problem ? (
          <p role="alert" className="mt-2 text-sm font-bold text-error">
            {t('failed')}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        {variant === 'ios' ? (
          <button
            type="button"
            className={primary}
            onClick={() => {
              void notNow('ios_done');
            }}
          >
            {t('iosDone')}
          </button>
        ) : (
          <>
            <button type="button" className={primary} disabled={busy} onClick={() => void turnOn()}>
              {busy ? t('working') : t('turnOn')}
            </button>
            <button
              type="button"
              className={quiet}
              disabled={busy}
              onClick={() => {
                void notNow('not_now');
              }}
            >
              {t('notNow')}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * "This device" in the notification settings (account, notification centre): turn push on or off for this browser,
 * the iPhone explanation, or the denied explanation with how to re-enable. One next action in each state.
 */
export function PushDevice() {
  const t = useTranslations('bell');
  const locale = useLocale();
  const { phase, setPhase } = useDevice();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  if (!PUSH_CONFIGURED || phase.kind !== 'ready') return null;

  async function turnOn() {
    setBusy(true);
    setProblem(false);
    const { enablePush } = await import('@/lib/push/enable-push');
    const res = await enablePush(locale);
    setBusy(false);
    if (res.ok) {
      clearPushSnooze();
      track('push_enabled', { source: 'settings' });
      setPhase({ kind: 'ready', env: 'granted', enabled: true });
    } else if (res.reason === 'denied') setPhase({ kind: 'ready', env: 'denied', enabled: false });
    else setProblem(true);
  }

  async function turnOff() {
    setBusy(true);
    const { disablePush } = await import('@/lib/push/enable-push');
    await disablePush(locale);
    setBusy(false);
    track('push_disabled', { source: 'settings' });
    setPhase({ kind: 'ready', env: phase.kind === 'ready' ? phase.env : 'default', enabled: false });
  }

  const { env, enabled } = phase;
  return (
    <section aria-labelledby="push-device-title" className={`${card} space-y-2`}>
      <h2 id="push-device-title" className="font-heading text-base font-extrabold text-ink">
        {t('deviceHeading')}
      </h2>
      {env === 'unsupported' ? <p className="text-sm text-muted">{t('unsupported')}</p> : null}
      {env === 'ios-needs-home-screen' ? (
        <>
          <p className="text-sm font-bold text-ink">{t('iosTitle')}</p>
          <p className="text-sm text-muted">{t('iosBody')}</p>
        </>
      ) : null}
      {env === 'denied' ? (
        <>
          <p role="status" className="text-sm font-bold text-ink">
            {t('deniedTitle')}
          </p>
          <p className="text-sm text-muted">{t('deniedBody')}</p>
        </>
      ) : null}
      {enabled ? (
        <>
          <p role="status" className="text-sm text-muted">
            {t('deviceOn')}
          </p>
          <button type="button" className={quiet} disabled={busy} onClick={() => void turnOff()}>
            {t('turnOff')}
          </button>
        </>
      ) : null}
      {!enabled && (env === 'default' || env === 'granted') ? (
        <>
          <p className="text-sm text-muted">{t('deviceOff')}</p>
          <button type="button" className={primary} disabled={busy} onClick={() => void turnOn()}>
            {busy ? t('working') : t('turnOn')}
          </button>
        </>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t('failed')}
        </p>
      ) : null}
    </section>
  );
}
