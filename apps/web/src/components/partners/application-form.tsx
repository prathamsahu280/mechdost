'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { createApplication, type PartnerKind } from '@/demo/store';
import { VEHICLE_LABEL_KEY } from '@mechdost/shared/vehicles';
import { track } from '@/lib/analytics';

type Field = 'name' | 'phone' | 'business' | 'pincode' | 'vehicles' | 'details' | 'consent';

/**
 * Partner application (spec 07): the fields of `partner_applications`. Inline errors next to fields, focus moves to
 * the first error, a single primary action. Demo store until `POST /v1/partner-applications` ships (Turnstile + rate
 * limits, spec 13).
 */
export function ApplicationForm({ kind }: { kind: PartnerKind }) {
  const t = useTranslations('apply');
  const locale = useLocale();
  const router = useRouter();
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const needsVehicles = kind !== 'seller';
  const businessRequired = kind !== 'mechanic';

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const value = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const phone = value('phone')
      .replace(/\D/g, '')
      .replace(/^91(?=\d{10}$)/, '');
    const vehicles = data.getAll('vehicles').filter((v): v is string => typeof v === 'string');
    const next: Partial<Record<Field, string>> = {};
    if (value('name').length < 2) next.name = t('errName');
    if (!/^[6-9]\d{9}$/.test(phone)) next.phone = t('errPhone');
    if (businessRequired && value('business').length < 2) next.business = t('errBusiness');
    if (!/^[1-9]\d{5}$/.test(value('pincode'))) next.pincode = t('errPincode');
    if (needsVehicles && vehicles.length === 0) next.vehicles = t('errVehicles');
    if (value('details').length < 20) next.details = t('errDetails');
    if (data.get('consent') !== 'on') next.consent = t('errConsent');
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`apply-${first}`)?.focus();
      return;
    }
    setSubmitting(true);
    const app = createApplication({
      kind,
      name: value('name'),
      phone,
      business: value('business'),
      pincode: value('pincode'),
      vehicles,
      details: value('details'),
    });
    track('click', { id: `partner_application_${kind}`, path: window.location.pathname });
    router.push(`${locale === 'hi' ? '/hi' : ''}/partners/applications/${app.code}?new=1`);
  }

  const input =
    'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted aria-[invalid=true]:border-error';
  const aria = (id: Field) => ({
    id: `apply-${id}`,
    'aria-invalid': errors[id] ? true : undefined,
    'aria-describedby': errors[id] ? `apply-${id}-error` : undefined,
  });
  const err = (id: Field) =>
    errors[id] ? (
      <p id={`apply-${id}-error`} className="mt-1 text-xs font-bold text-error">
        {errors[id]}
      </p>
    ) : null;

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-5">
      {Object.keys(errors).length > 0 ? (
        <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {t('errorSummary')}
        </p>
      ) : null}
      <div className="grid gap-4 min-[600px]:grid-cols-2">
        <div>
          <label htmlFor="apply-name" className="text-sm font-bold text-ink">
            {t('name')}
          </label>
          <input {...aria('name')} name="name" autoComplete="name" maxLength={100} className={input} />
          {err('name')}
        </div>
        <div>
          <label htmlFor="apply-phone" className="text-sm font-bold text-ink">
            {t('phone')}
          </label>
          <input
            {...aria('phone')}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={14}
            className={input}
          />
          {err('phone')}
        </div>
        <div>
          <label htmlFor="apply-business" className="text-sm font-bold text-ink">
            {kind === 'garage' ? t('garageName') : businessRequired ? t('business') : t('businessOptional')}
          </label>
          <input
            {...aria('business')}
            name="business"
            autoComplete="organization"
            maxLength={160}
            className={input}
          />
          {err('business')}
        </div>
        <div>
          <label htmlFor="apply-pincode" className="text-sm font-bold text-ink">
            {t('pincode')}
          </label>
          <input
            {...aria('pincode')}
            name="pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            className={input}
          />
          {err('pincode')}
        </div>
      </div>

      {needsVehicles ? (
        <fieldset {...aria('vehicles')} tabIndex={-1}>
          <legend className="text-sm font-bold text-ink">{t('vehicles')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['2W', '3W', '4W', 'EV'] as const).map((v) => (
              <label
                key={v}
                className="press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold text-ink has-checked:border-accent-button has-checked:bg-accent-soft has-checked:text-accent-soft-text"
              >
                <input
                  type="checkbox"
                  name="vehicles"
                  value={v}
                  className="size-5 accent-[var(--color-accent-button)]"
                />
                {v === 'EV' ? t('ev') : t(VEHICLE_LABEL_KEY[v])}
              </label>
            ))}
          </div>
          {err('vehicles')}
        </fieldset>
      ) : null}

      <div>
        <label htmlFor="apply-details" className="text-sm font-bold text-ink">
          {t(`details_${kind}`)}
        </label>
        <textarea {...aria('details')} name="details" rows={5} maxLength={2500} className={`${input} py-2`} />
        <p className="mt-1 text-xs text-muted">{t('detailsHint')}</p>
        {err('details')}
      </div>

      <label className="flex items-start gap-3 text-sm text-ink">
        <input
          {...aria('consent')}
          name="consent"
          type="checkbox"
          className="mt-0.5 size-6 shrink-0 accent-[var(--color-accent-button)]"
        />
        <span>{t('consent')}</span>
      </label>
      {err('consent')}

      <button
        type="submit"
        disabled={submitting}
        className="press inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70 min-[600px]:w-auto"
      >
        {submitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
