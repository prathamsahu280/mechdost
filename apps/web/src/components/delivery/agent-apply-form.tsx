'use client';

import { AGENT_VEHICLE_TYPES, type AgentVehicleType } from '@mechdost/shared/delivery/codes';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import { LocalLink } from '@/components/ui/local-link';
import { portalField } from '@/components/portal/portal-styles';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';

type Field = 'name' | 'phone' | 'vehicle' | 'consent';
const ORDER: readonly Field[] = ['name', 'phone', 'vehicle', 'consent'];
const TURNSTILE_ID = 'agent-apply-turnstile';
const REAL = AUTH_MODE === 'firebase';
/** Cities where MechDost takes delivery-agent applications (spec 15: city-scoped; Raipur first). */
const CITIES = ['RPR'] as const;

/**
 * "Apply as a delivery agent" (spec 24, Lead's call 10): name, mobile, city and vehicle only — documents come after
 * MechDost invites the person and they sign in. Real builds pass Turnstile and post to
 * `/v1/delivery-agent-applications` (per-IP and per-phone limits in the API); the demo keeps it on this device.
 */
export function AgentApplyForm() {
  const t = useTranslations('deliveryApply');
  const v = useTranslations('delivery.vehicle');
  const locale = useLocale();
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [received, setReceived] = useState<string | null>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    const data = new FormData(e.currentTarget);
    const get = (k: string) => {
      const x = data.get(k);
      return typeof x === 'string' ? x.trim() : '';
    };
    const phone = get('phone')
      .replace(/\D/g, '')
      .replace(/^(?:91|0)(?=\d{10}$)/, '');
    const vehicle = AGENT_VEHICLE_TYPES.find((x) => x === get('vehicle'));
    const cityCode = CITIES.find((c) => c === get('city')) ?? 'RPR';
    const next: Partial<Record<Field, string>> = {};
    if (get('name').length < 2) next.name = t('errName');
    if (!/^[6-9]\d{9}$/.test(phone)) next.phone = t('errPhone');
    if (!vehicle) next.vehicle = t('errVehicle');
    if (data.get('consent') !== 'on') next.consent = t('errConsent');
    setErrors(next);
    setFormError(null);
    const first = ORDER.find((f) => next[f]);
    if (first || !vehicle) {
      document.getElementById(`agent-apply-${first ?? 'vehicle'}`)?.focus();
      return;
    }
    setSending(true);
    const input = { name: get('name'), phone, cityCode, vehicleType: vehicle };
    const code = REAL ? await sendToApi(input) : await sendToDemo(input);
    setSending(false);
    if (!code) return;
    track('click', { id: 'partner_application_delivery_agent', path: window.location.pathname });
    setReceived(code);
    requestAnimationFrame(() => doneRef.current?.focus());
  }

  async function sendToDemo(input: {
    name: string;
    phone: string;
    cityCode: string;
    vehicleType: AgentVehicleType;
  }) {
    const { applyAsAgent } = await import('@/demo/delivery-store');
    return applyAsAgent(input).code;
  }

  async function sendToApi(input: {
    name: string;
    phone: string;
    cityCode: string;
    vehicleType: AgentVehicleType;
  }) {
    let token: string;
    try {
      const { turnstileToken } = await import('@/lib/auth/turnstile');
      token = await turnstileToken(TURNSTILE_ID, locale, setChallenge);
    } catch {
      setFormError(t('errSend'));
      return null;
    }
    const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
    try {
      const res = await fetch(`${API}/v1/delivery-agent-applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application: { ...input, consent: true }, turnstileToken: token }),
        cache: 'no-store',
      });
      const body: unknown = await res.json().catch(() => null);
      if (
        res.ok &&
        typeof body === 'object' &&
        body !== null &&
        'code' in body &&
        typeof body.code === 'string'
      )
        return body.code;
      setFormError(res.status === 429 ? t('errLimit') : t('errSend'));
    } catch {
      setFormError(t('errSend'));
    }
    requestAnimationFrame(() => document.getElementById('agent-apply-form-error')?.focus());
    return null;
  }

  if (received) {
    return (
      <div role="status" className="space-y-3">
        <h2 ref={doneRef} tabIndex={-1} className="font-heading text-xl font-extrabold text-ink">
          {t('receivedTitle')}
        </h2>
        <p className="text-[15px] text-ink">{t('receivedBody', { code: received })}</p>
        <div className="flex flex-wrap gap-3">
          <LocalLink
            href="/partners/status"
            className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
          >
            {t('statusLink')}
          </LocalLink>
          <LocalLink
            href="/"
            className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
          >
            {t('backHome')}
          </LocalLink>
        </div>
      </div>
    );
  }

  const aria = (f: Field) => ({
    'aria-invalid': errors[f] ? true : undefined,
    'aria-describedby': errors[f] ? `agent-apply-${f}-error` : undefined,
  });
  const err = (f: Field) =>
    errors[f] ? (
      <p id={`agent-apply-${f}-error`} className="mt-1 text-sm font-bold text-error">
        {errors[f]}
      </p>
    ) : null;

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      className="space-y-5"
      aria-busy={sending || undefined}
    >
      {Object.keys(errors).length > 0 ? (
        <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {t('errSummary')}
        </p>
      ) : null}
      {formError ? (
        <p id="agent-apply-form-error" tabIndex={-1} role="alert" className="text-sm font-bold text-error">
          {formError}
        </p>
      ) : null}
      <div className="grid gap-4 min-[600px]:grid-cols-2">
        <div>
          <label htmlFor="agent-apply-name" className="text-sm font-bold text-ink">
            {t('name')}
          </label>
          <input
            id="agent-apply-name"
            name="name"
            autoComplete="name"
            maxLength={80}
            className={portalField}
            {...aria('name')}
          />
          {err('name')}
        </div>
        <div>
          <label htmlFor="agent-apply-phone" className="text-sm font-bold text-ink">
            {t('phone')}
          </label>
          <input
            id="agent-apply-phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={14}
            className={portalField}
            {...aria('phone')}
          />
          {err('phone')}
        </div>
        <div>
          <label htmlFor="agent-apply-city" className="text-sm font-bold text-ink">
            {t('city')}
          </label>
          <select id="agent-apply-city" name="city" defaultValue="RPR" className={`${portalField} block`}>
            {CITIES.map((c) => (
              <option key={c} value={c}>
                {t(`city_${c}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset id="agent-apply-vehicle" tabIndex={-1} {...aria('vehicle')}>
        <legend className="text-sm font-bold text-ink">{t('vehicle')}</legend>
        <div className="mt-2 grid gap-2 min-[480px]:grid-cols-2">
          {AGENT_VEHICLE_TYPES.map((x) => (
            <label
              key={x}
              className="press flex min-h-12 cursor-pointer items-center gap-3 rounded-button border border-input-border px-4 text-[15px] font-bold text-ink has-checked:border-accent-button has-checked:bg-accent-soft has-checked:text-accent-soft-text has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            >
              <input
                type="radio"
                name="vehicle"
                value={x}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {v(x)}
            </label>
          ))}
        </div>
        {err('vehicle')}
      </fieldset>
      <p className="text-sm text-muted">{t('noDocsYet')}</p>
      <div>
        <label className="flex items-start gap-3 text-sm text-ink">
          <input
            id="agent-apply-consent"
            name="consent"
            type="checkbox"
            className="mt-0.5 size-6 shrink-0 accent-[var(--color-accent-button)]"
            {...aria('consent')}
          />
          <span>{t('consent')}</span>
        </label>
        {err('consent')}
      </div>
      {REAL ? (
        <div role="group" aria-labelledby={challenge ? 'agent-apply-challenge' : undefined}>
          <p id="agent-apply-challenge" hidden={!challenge} className="text-sm font-bold text-ink">
            {t('challenge')}
          </p>
          <div id={TURNSTILE_ID} />
        </div>
      ) : null}
      <button
        type="submit"
        aria-disabled={sending || undefined}
        className="press min-h-12 w-full rounded-button bg-accent-button px-6 text-base font-bold text-white hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus min-[600px]:w-auto"
      >
        {sending ? t('sending') : t('submit')}
      </button>
    </form>
  );
}
