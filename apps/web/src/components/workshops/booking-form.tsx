'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { serviceNameFor } from '@/demo/i18n/localize';
import { usePartnerStatus } from '@/demo/partner-status';
import { useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { createDemoRequest } from '@/demo/store';
import type { DemoWorkshop, VehicleType } from '@/demo/workshops';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';

type Field = 'vehicle' | 'services' | 'date' | 'name' | 'phone';

const todayIst = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/**
 * `workshop` is the canonical (English) record: the request snapshots it; names are shown in the page locale.
 *
 * Appointment request (spec 06): vehicle, services (with a live expected-cost range), preferred date and slot.
 * The workshop proposes; nothing is confirmed until the customer accepts — the page says so before submit.
 */
export function BookingForm({ workshop }: { workshop: DemoWorkshop }) {
  const t = useTranslations('workshop');
  const checkout = useTranslations('checkout');
  const locale = useLocale();
  const router = useRouter();
  const [vehicleType, setVehicleType] = useState<VehicleType>(workshop.vehicles[0] ?? '2W');
  const [selected, setSelected] = useState<string[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  // Admin control: a paused or suspended workshop takes no new bookings.
  const { status } = usePartnerStatus('workshop', workshop.slug);
  const started = useRef(false);
  const minDate = todayIst();

  const services = workshop.services.filter((s) => s.vehicle === 'both' || s.vehicle === vehicleType);
  const chosen = services.filter((s) => selected.includes(s.key));
  const estimate = useMemo(
    () => ({
      min: chosen.reduce((sum, s) => sum + s.minPaise, 0),
      max: chosen.reduce((sum, s) => sum + s.maxPaise, 0),
    }),
    [chosen],
  );

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
    const next: Partial<Record<Field, string>> = {};
    if (value('vehicle').length < 3) next.vehicle = t('errVehicle');
    if (chosen.length === 0) next.services = t('errServices');
    if (!value('date') || value('date') < minDate) next.date = t('errDate');
    if (value('name').length < 2) next.name = checkout('errName');
    if (!/^[6-9]\d{9}$/.test(phone)) next.phone = checkout('errPhone');
    setErrors(next);
    const firstError = Object.keys(next)[0];
    if (firstError) {
      document.getElementById(`book-${firstError}`)?.focus();
      return;
    }
    setSubmitting(true);
    const slot = value('slot');
    const request = createDemoRequest({
      workshopSlug: workshop.slug,
      workshopName: workshop.name,
      vehicleType,
      vehicle: value('vehicle'),
      services: chosen.map((s) => ({ key: s.key, name: s.name, minPaise: s.minPaise, maxPaise: s.maxPaise })),
      date: value('date'),
      slot: slot === 'afternoon' || slot === 'evening' ? slot : 'morning',
      concern: value('concern'),
      customer: { name: value('name'), phone },
    });
    if (!request) {
      setSubmitting(false);
      return;
    }
    track('booking_confirmed', { code: request.code, workshop: workshop.slug, demo: true });
    router.push(`${locale === 'hi' ? '/hi' : ''}/service/${request.code}?new=1`);
  }

  const inputClass =
    'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted aria-[invalid=true]:border-error';
  const err = (id: Field) =>
    errors[id] ? (
      <p id={`book-${id}-error`} className="mt-1 text-xs font-bold text-error">
        {errors[id]}
      </p>
    ) : null;
  const aria = (id: Field) => ({
    'aria-invalid': errors[id] ? true : undefined,
    'aria-describedby': errors[id] ? `book-${id}-error` : undefined,
  });

  if (status !== 'active') {
    return (
      <p role="status" className="rounded-tile bg-warning-bg p-4 text-sm font-bold text-warning">
        {status === 'suspended' ? t('unavailable') : t('notTakingBookings')}
      </p>
    );
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="space-y-5"
      onFocus={() => {
        if (started.current) return;
        started.current = true;
        track('booking_started', { workshop: workshop.slug });
      }}
    >
      {workshop.vehicles.length > 1 ? (
        <fieldset>
          <legend className="text-sm font-bold text-ink">{t('vehicleType')}</legend>
          <div className="mt-2 flex gap-2">
            {workshop.vehicles.map((v) => (
              <label
                key={v}
                className={`press inline-flex min-h-11 cursor-pointer items-center rounded-button border px-4 text-sm font-bold ${
                  vehicleType === v
                    ? 'border-accent-button bg-accent-soft text-accent-soft-text'
                    : 'border-input-border text-ink'
                }`}
              >
                <input
                  type="radio"
                  name="vehicleType"
                  value={v}
                  checked={vehicleType === v}
                  onChange={() => {
                    setVehicleType(v);
                    setSelected([]);
                  }}
                  className="sr-only"
                />
                {v === '2W' ? '2W' : '4W'}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div>
        <label htmlFor="book-vehicle" className="text-sm font-bold text-ink">
          {t('vehicle')}
        </label>
        <input
          id="book-vehicle"
          name="vehicle"
          maxLength={80}
          placeholder={t('vehiclePlaceholder')}
          className={inputClass}
          {...aria('vehicle')}
        />
        {err('vehicle')}
      </div>

      <fieldset id="book-services" tabIndex={-1} {...aria('services')}>
        <legend className="text-sm font-bold text-ink">{t('pickServices')}</legend>
        <ul className="mt-2 grid gap-2">
          {services.map((s) => {
            const checked = selected.includes(s.key);
            return (
              <li key={s.key}>
                <label
                  className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-input border px-3 py-2 text-sm transition-colors duration-[var(--duration-fast)] ${
                    checked ? 'border-accent-button bg-accent-soft' : 'border-input-border'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelected((prev) => (checked ? prev.filter((k) => k !== s.key) : [...prev, s.key]));
                      }}
                      className="size-6 shrink-0 accent-[var(--color-accent-button)]"
                    />
                    <span className="font-bold text-ink">{serviceNameFor(s.key, s.name, locale)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {formatPrice(s.minPaise)}–{formatPrice(s.maxPaise)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {err('services')}
      </fieldset>

      {chosen.length > 0 ? (
        <p role="status" className="rounded-lg bg-surface-alt px-3 py-2 text-sm font-bold text-ink">
          {t('estimate', { min: formatPrice(estimate.min), max: formatPrice(estimate.max) })}
        </p>
      ) : null}

      <div className="grid gap-4 min-[480px]:grid-cols-2">
        <div>
          <label htmlFor="book-date" className="text-sm font-bold text-ink">
            {t('date')}
          </label>
          <input
            id="book-date"
            name="date"
            type="date"
            min={minDate}
            defaultValue={minDate}
            className={inputClass}
            {...aria('date')}
          />
          {err('date')}
        </div>
        <div>
          <label htmlFor="book-slot" className="text-sm font-bold text-ink">
            {t('slot')}
          </label>
          <select id="book-slot" name="slot" className={inputClass}>
            <option value="morning">{t('morning')}</option>
            <option value="afternoon">{t('afternoon')}</option>
            <option value="evening">{t('evening')}</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="book-concern" className="text-sm font-bold text-ink">
          {t('concern')}
        </label>
        <textarea
          id="book-concern"
          name="concern"
          rows={3}
          maxLength={500}
          placeholder={t('concernPlaceholder')}
          className={`${inputClass} py-2`}
        />
      </div>

      <div className="grid gap-4 min-[480px]:grid-cols-2">
        <div>
          <label htmlFor="book-name" className="text-sm font-bold text-ink">
            {t('name')}
          </label>
          <input
            id="book-name"
            name="name"
            autoComplete="name"
            maxLength={100}
            className={inputClass}
            {...aria('name')}
          />
          {err('name')}
        </div>
        <div>
          <label htmlFor="book-phone" className="text-sm font-bold text-ink">
            {t('phone')}
          </label>
          <input
            id="book-phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={14}
            className={inputClass}
            {...aria('phone')}
          />
          {err('phone')}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="press inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70"
      >
        {submitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
