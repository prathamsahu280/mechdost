'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { VEHICLE_ICON, VEHICLE_TYPES, type VehicleType } from '@mechdost/shared/vehicles';
import {
  lazy,
  Suspense,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type SyntheticEvent,
} from 'react';
import type { SavedVehicle } from '@mechdost/shared/account-api';
import { useSession } from '@/demo/session';
import { AUTH_MODE } from '@/lib/auth/mode';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { istDate, newIdempotencyKey, rangeOf, serviceErrorKey, servicesFor } from '@/lib/service-views';

/** The API takes bookings from today up to 30 days ahead (IST). */
const MAX_DAYS_AHEAD = 30;
const SLOTS = ['morning', 'afternoon', 'evening'] as const;
type Slot = (typeof SLOTS)[number];
const noopSubscribe = () => () => undefined;

// Real sign-in: the customer's saved vehicles (design 2026-11-15), loaded only for a signed-in customer.
const SavedVehiclePicker = lazy(() =>
  import('../account/saved-pickers').then((m) => ({ default: m.SavedVehiclePicker })),
);

export interface BookingWorkshop {
  slug: string;
  name: string;
  vehicleTypes: VehicleType[];
  pickup: boolean;
  services: {
    key: string;
    title: string;
    lowPaise: number;
    highPaise: number;
    vehicleType: VehicleType | null;
  }[];
}

type Field = 'vehicleType' | 'vehicle' | 'services' | 'concern' | 'pincode' | 'date';

/** API error code → the field it is about (shown next to that field); others show above the button. */
const FIELD_OF: Record<string, Field> = {
  DATE_OUT_OF_RANGE: 'date',
  PINCODE_NOT_SERVED: 'pincode',
  PINCODE_UNKNOWN: 'pincode',
  WORKSHOP_OUT_OF_AREA: 'pincode',
  VEHICLE_NOT_SERVED: 'vehicleType',
  UNKNOWN_SERVICE: 'services',
  CONCERN_REQUIRED: 'concern',
};

/**
 * Appointment request on the API (real data mode; spec 06, Stream E). Location first: the PIN code where the vehicle
 * is (prefilled from the finder). With a workshop: vehicle, services with the live expected-cost range, preferred
 * date and slot. Without one (`workshop` null, "Let MechDost choose"): vehicle type and the concern; MechDost routes
 * it. The signed-in account supplies name and phone; `Idempotency-Key` makes a double tap one booking.
 */
export function BookingFormApi({
  workshop,
  pincode: initialPin,
  origin = null,
}: {
  workshop: BookingWorkshop | null;
  pincode?: string;
  origin?: { lat: number; lng: number } | null;
}) {
  const t = useTranslations('workshop');
  const r = useTranslations('request');
  const locale = useLocale();
  const router = useRouter();
  const formId = useId();
  const pinFromLink = useSearchParams().get('pin') ?? '';
  const choose = workshop === null;
  const types = workshop ? workshop.vehicleTypes : [...VEHICLE_TYPES];
  const [vehicleType, setVehicleType] = useState<VehicleType>(types[0] ?? '2W');
  const [selected, setSelected] = useState<string[]>([]);
  // A saved vehicle picked from the API (real sign-in) fills the type and the name below (design 2026-11-15).
  const [savedVehicle, setSavedVehicle] = useState<SavedVehicle | null>(null);
  const signedIn = useSession()?.role === 'customer';
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [note, setNote] = useState<{ text: string; link?: 'sign_in' | 'verify' } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const started = useRef(false);
  const attemptKey = useRef<string | null>(null);
  // "Today" is read in the browser after hydration, never frozen into a cached page (review B14, as the demo).
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const today = hydrated ? istDate() : undefined;
  const lastDay = hydrated ? istDate(MAX_DAYS_AHEAD) : undefined;
  const prefix = locale === 'hi' ? '/hi' : '';
  const workshopId = workshop?.slug ?? 'mechdost';

  const services = workshop ? servicesFor(workshop.services, vehicleType) : [];
  const chosen = services.filter((s) => selected.includes(s.key));
  const range = useMemo(() => rangeOf(chosen), [chosen]);
  const fid = (f: Field) => `${formId}-${f}`;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const value = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const pincode = value('pincode');
    const concern = value('concern');
    const date = value('date');
    const next: Partial<Record<Field, string>> = {};
    if (!/^[1-9]\d{5}$/.test(pincode)) next.pincode = t('api_errPincode');
    if (value('vehicle').length < 2) next.vehicle = t('errVehicle');
    if (choose && concern.length < 3) next.concern = t('api_errConcern');
    if (!choose && chosen.length === 0 && concern.length < 3) next.services = t('api_errServicesOrConcern');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (today && date < today) || (lastDay && date > lastDay))
      next.date = t('api_errDate');
    setErrors(next);
    setNote(null);
    const first = (Object.keys(next) as Field[])[0];
    if (first) {
      document.getElementById(fid(first))?.focus();
      return;
    }
    const slot: Slot = SLOTS.find((s) => s === value('slot')) ?? 'morning';
    setSubmitting(true);
    attemptKey.current ??= newIdempotencyKey();
    const { createServiceRequest } = await import('@/lib/service-api');
    const res = await createServiceRequest(
      locale,
      {
        workshopSlug: workshop?.slug ?? null,
        vehicleType,
        vehicle: value('vehicle'),
        serviceKeys: chosen.map((s) => s.key),
        concern: concern.length >= 3 ? concern : null,
        pincode,
        lat: origin?.lat ?? null,
        lng: origin?.lng ?? null,
        preferredDate: date,
        preferredSlot: slot,
        pickup: data.get('pickup') === 'on',
      },
      attemptKey.current,
    );
    if (res.ok) {
      attemptKey.current = null;
      track('booking_confirmed', { code: res.data.code, workshop: workshopId, demo: false });
      router.push(`${prefix}/service/${res.data.code}?new=1`);
      return;
    }
    setSubmitting(false);
    track('click', { id: `booking_${res.code.toLowerCase()}`, path: window.location.pathname });
    const field = FIELD_OF[res.code];
    if (field) {
      setErrors({ [field]: r(serviceErrorKey(res.code) as 'api_err_generic') });
      document.getElementById(fid(field))?.focus();
      return;
    }
    setNote(
      res.code === 'AUTH_REQUIRED'
        ? { text: t('api_signIn'), link: 'sign_in' }
        : res.code === 'VERIFICATION_REQUIRED'
          ? { text: t('api_verify'), link: 'verify' }
          : { text: r(serviceErrorKey(res.code) as 'api_err_generic') },
    );
  }

  const inputClass =
    'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted aria-[invalid=true]:border-error';
  const err = (f: Field) =>
    errors[f] ? (
      <p id={`${fid(f)}-error`} className="mt-1 text-xs font-bold text-error">
        {errors[f]}
      </p>
    ) : null;
  const aria = (f: Field) => ({
    id: fid(f),
    'aria-invalid': errors[f] ? true : undefined,
    'aria-describedby': errors[f] ? `${fid(f)}-error` : undefined,
  });
  const here = typeof window === 'undefined' ? `${prefix}/workshops` : window.location.pathname;

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      className="space-y-5"
      onFocus={() => {
        if (started.current) return;
        started.current = true;
        track('booking_started', { workshop: workshopId });
      }}
    >
      <div>
        <label htmlFor={fid('pincode')} className="text-sm font-bold text-ink">
          {t('api_pincode')}
        </label>
        <input
          {...aria('pincode')}
          name="pincode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          defaultValue={initialPin ?? pinFromLink.replace(/\D/g, '').slice(0, 6)}
          className={inputClass}
        />
        {err('pincode')}
      </div>

      {types.length > 1 ? (
        <fieldset id={fid('vehicleType')} tabIndex={-1}>
          <legend className="text-sm font-bold text-ink">{t('vehicleType')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {types.map((v) => (
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
                <span aria-hidden="true">{VEHICLE_ICON[v]}</span> {v}
              </label>
            ))}
          </div>
          {err('vehicleType')}
        </fieldset>
      ) : (
        <p id={fid('vehicleType')} tabIndex={-1} className="sr-only">
          {vehicleType}
        </p>
      )}

      <div>
        {AUTH_MODE === 'firebase' && signedIn ? (
          <Suspense fallback={null}>
            <div className="mb-3">
              <SavedVehiclePicker
                types={types}
                onPick={(v) => {
                  setSavedVehicle(v);
                  if (v && types.includes(v.type)) {
                    setVehicleType(v.type);
                    setSelected([]);
                  }
                }}
              />
            </div>
          </Suspense>
        ) : null}
        <label htmlFor={fid('vehicle')} className="text-sm font-bold text-ink">
          {t('vehicle')}
        </label>
        <input
          {...aria('vehicle')}
          key={savedVehicle?.id ?? 'typed'}
          defaultValue={
            savedVehicle
              ? [savedVehicle.make, savedVehicle.model, savedVehicle.variant]
                  .filter((x) => x !== null)
                  .join(' ')
              : ''
          }
          name="vehicle"
          maxLength={80}
          placeholder={t('vehiclePlaceholder')}
          className={inputClass}
        />
        {err('vehicle')}
      </div>

      {workshop ? (
        <fieldset {...aria('services')} tabIndex={-1}>
          <legend className="text-sm font-bold text-ink">{t('pickServices')}</legend>
          {services.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t('notListed')}</p>
          ) : (
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
                            setSelected((prev) =>
                              checked ? prev.filter((k) => k !== s.key) : [...prev, s.key],
                            );
                          }}
                          className="size-6 shrink-0 accent-[var(--color-accent-button)]"
                        />
                        <span className="font-bold text-ink">{s.title}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">
                        {formatPrice(s.lowPaise)}–{formatPrice(s.highPaise)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {err('services')}
        </fieldset>
      ) : null}

      {chosen.length > 0 ? (
        <p role="status" className="rounded-lg bg-surface-alt px-3 py-2 text-sm font-bold text-ink">
          {t('estimate', { min: formatPrice(range.low), max: formatPrice(range.high) })}
        </p>
      ) : null}

      <div>
        <label htmlFor={fid('concern')} className="text-sm font-bold text-ink">
          {choose ? t('api_concernRequired') : t('concern')}
        </label>
        <textarea
          {...aria('concern')}
          name="concern"
          rows={3}
          maxLength={500}
          placeholder={t('concernPlaceholder')}
          className={`${inputClass} py-2`}
        />
        {err('concern')}
      </div>

      <div className="grid gap-4 min-[480px]:grid-cols-2">
        <div>
          <label htmlFor={fid('date')} className="text-sm font-bold text-ink">
            {t('date')}
          </label>
          <input
            {...aria('date')}
            name="date"
            type="date"
            key={today ?? 'prerendered'}
            min={today}
            max={lastDay}
            defaultValue={today}
            className={inputClass}
          />
          {err('date')}
        </div>
        <div>
          <label htmlFor={`${formId}-slot`} className="text-sm font-bold text-ink">
            {t('slot')}
          </label>
          <select id={`${formId}-slot`} name="slot" className={inputClass}>
            {SLOTS.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {choose || workshop.pickup ? (
        <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            name="pickup"
            className="size-6 shrink-0 accent-[var(--color-accent-button)]"
          />
          {t('api_pickup')}
        </label>
      ) : null}

      <p className="rounded-lg bg-surface-alt px-3 py-2 text-xs text-muted">{t('api_accountNote')}</p>

      {note ? (
        <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {note.text}{' '}
          {note.link === 'sign_in' ? (
            <Link
              href={`${prefix}/login?next=${encodeURIComponent(here)}`}
              className="underline underline-offset-2"
            >
              {t('api_signInLink')}
            </Link>
          ) : null}
          {note.link === 'verify' ? (
            <Link href={`${prefix}/account`} className="underline underline-offset-2">
              {t('api_verifyLink')}
            </Link>
          ) : null}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="press inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70"
      >
        {submitting ? t('submitting') : choose ? t('api_chooseSubmit') : t('submit')}
      </button>
    </form>
  );
}
