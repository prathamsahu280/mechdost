'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { RSA_FUELS, type RsaFuel, type RsaProblemType } from '@mechdost/shared/rsa';
import { PINCODE_RE } from '@mechdost/shared/geo';
import { VEHICLE_LABEL_KEY, type VehicleType } from '@mechdost/shared/vehicles';
import { Bike, Car, Truck, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { demoAvailability, demoCreate, demoOpenCode, demoStep } from '@/demo/roadside';
import { useSession } from '@/demo/session';
import { track } from '@/lib/analytics';
import { DATA_MODE } from '@/lib/data-mode';
import { formatPrice } from '@/lib/format';
import { roadsideCall, roadsideErrorKey, type RoadsideAvailability } from '@/lib/roadside';
import { newIdempotencyKey } from '@/lib/service-views';

/** Line icons (decorative, `aria-hidden`; the label carries the meaning). */
const VEHICLE_LUCIDE: Record<VehicleType, LucideIcon> = { '2W': Bike, '3W': Truck, '4W': Car };

const PROBLEMS: readonly (RsaProblemType | 'skipped')[] = [
  'dead_battery',
  'flat_tyre',
  'out_of_fuel',
  'minor_fix',
  'needs_towing',
  'unknown',
];
const field =
  'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';
const primary =
  'press inline-flex min-h-11 items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

interface Point {
  lat: number;
  lng: number;
}

/**
 * Roadside help request (spec 22): where are you (GPS or PIN code), the vehicle, what happened (optional, "I don't
 * know" is a choice), then review and pay the advance. One primary action per step. The advance shown is the server's
 * for that vehicle type; the amount charged is read again from the database. Sign-in is required, a verified email is not.
 */
export function RoadsideRequest() {
  const t = useTranslations('roadside');
  const v = useTranslations('finder');
  const locale = useLocale();
  const router = useRouter();
  const base = locale === 'hi' ? '/hi' : '';
  const signedIn = useSession()?.role === 'customer';
  const [pincode, setPincode] = useState('');
  const [point, setPoint] = useState<Point | null>(null);
  const [via, setVia] = useState<'gps' | 'pincode'>('pincode');
  const [avail, setAvail] = useState<RoadsideAvailability | null>(null);
  const [vehicleType, setVehicleType] = useState<VehicleType | ''>('');
  const [fuel, setFuel] = useState<RsaFuel>('petrol');
  const [problem, setProblem] = useState<RsaProblemType | 'skipped'>('skipped');
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const started = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    track('rsa_started', { path: `${base}/roadside` });
  }, [base]);

  // The availability of the typed PIN code (public, cached): area, hours, offered vehicle types and their advance.
  useEffect(() => {
    if (!PINCODE_RE.test(pincode)) return;
    const live = { current: true };
    void (async () => {
      const data: RoadsideAvailability | null =
        DATA_MODE === 'demo'
          ? demoAvailability(pincode)
          : await fetch(
              `${(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}/v1/roadside/availability?pincode=${pincode}`,
            )
              .then(async (r) => (r.ok ? ((await r.json()) as RoadsideAvailability) : null))
              .catch(() => null);
      if (!live.current) return;
      if (data) {
        setAvail(data);
        track('rsa_location_set', { via, inArea: data.available });
        setVehicleType((cur) =>
          cur && data.vehicleTypes.includes(cur) ? cur : (data.vehicleTypes[0] ?? ''),
        );
      } else setAvail(null);
    })();
    return () => {
      live.current = false;
    };
    // `via` only labels the event; the check follows the PIN code.
  }, [pincode]);

  const useGps = () => {
    setError(null);
    if (!('geolocation' in navigator)) {
      setError('gps_unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setVia('gps');
      },
      () => {
        setError('gps_denied');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  // Moving to the review step puts the screen reader and the keyboard on its heading.
  useEffect(() => {
    if (step === 'review') reviewHeading.current?.focus();
  }, [step]);

  const where: Point | null = point ?? avail?.centroid ?? null;
  const advance = vehicleType && avail ? (avail.advancePaise[vehicleType] ?? null) : null;
  const closed = avail && !avail.available;
  const ready = Boolean(avail?.available && vehicleType && where && advance !== null);

  const toReview = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!ready) return;
    track('rsa_problem_selected', { code: problem });
    setStep('review');
  };

  const pay = async () => {
    if (!ready || !vehicleType || !where) return;
    setBusy(true);
    setError(null);
    const problemType = problem === 'skipped' ? undefined : problem;
    if (DATA_MODE === 'demo') {
      const made = demoCreate({ vehicleType, problemType: problemType ?? null, pincode });
      if (!made.ok) {
        setError(roadsideErrorKey(made.code));
        if (made.code === 'RSA_ALREADY_OPEN') setOpenCode(demoOpenCode());
        setBusy(false);
        return;
      }
      demoStep({ kind: 'pay_advance' });
      router.push(`${base}/roadside/${made.code}`);
      return;
    }
    const made = await roadsideCall<{ code: string }>(locale, '/roadside/requests', {
      method: 'POST',
      headers: { 'idempotency-key': key.current },
      body: {
        vehicleType,
        fuel,
        ...(problemType ? { problemType } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        lat: where.lat,
        lng: where.lng,
        pincode,
      },
    });
    if (!made.ok) {
      setError(roadsideErrorKey(made.code));
      // A request is already open (the tab was closed before paying): link to it so the customer is never stuck.
      if (made.code === 'RSA_ALREADY_OPEN') {
        const mine = await roadsideCall<{ code: string; status: string }[]>(locale, '/roadside/requests');
        if (mine.ok)
          setOpenCode(
            mine.data.find((r) => r.status !== 'completed' && r.status !== 'cancelled')?.code ?? null,
          );
      }
      setBusy(false);
      return;
    }
    const { payRoadside } = await import('@/lib/payments/pay-roadside');
    const paid = await payRoadside({ code: made.data.code, purpose: 'advance', locale });
    // The request exists either way: the tracking page shows "pay the advance" again if payment did not complete.
    if (!paid.ok && paid.reason !== 'cancelled' && paid.reason !== 'failed') setError(`pay_${paid.reason}`);
    router.push(`${base}/roadside/${made.data.code}`);
  };

  if (!signedIn)
    return (
      <div className="rounded-card border border-line-card bg-surface p-6 shadow-card">
        <p className="text-muted">{t('signInFirst')}</p>
        <Link
          href={`${base}/login?next=${encodeURIComponent(`${base}/roadside`)}`}
          className={`${primary} mt-4`}
        >
          {t('signIn')}
        </Link>
      </div>
    );

  return (
    <form onSubmit={toReview} className="mx-auto max-w-xl space-y-6" noValidate>
      {error ? (
        <p role="alert" className="rounded-card bg-error-bg p-3 text-sm font-bold text-error">
          {t(error as 'err_generic')}
        </p>
      ) : null}
      {openCode ? (
        <Link href={`${base}/roadside/${openCode}`} className={primary}>
          {t('openRequest')}
        </Link>
      ) : null}
      {step === 'form' ? (
        <>
          <fieldset className="space-y-3">
            <legend className="font-heading text-lg font-extrabold text-ink">{t('whereTitle')}</legend>
            <button type="button" onClick={useGps} className={quiet}>
              {point ? t('gpsDone') : t('useGps')}
            </button>
            <label className="block text-sm font-bold text-ink">
              {t('pincode')}
              <input
                className={field}
                inputMode="numeric"
                autoComplete="postal-code"
                aria-invalid={closed ? true : undefined}
                maxLength={6}
                value={pincode}
                onChange={(e) => {
                  setPincode(e.target.value.replace(/\D/g, ''));
                  setAvail(null);
                }}
              />
            </label>
            {closed ? (
              <div role="status" className="rounded-card bg-pill p-4 text-sm">
                <p className="font-bold text-ink">
                  {t(`closed_${avail.reason ?? 'RSA_OUT_OF_AREA'}` as 'closed_RSA_CLOSED')}
                </p>
                {avail.sosPhone ? (
                  <a
                    href={`tel:${avail.sosPhone}`}
                    className={`${quiet} mt-3`}
                    onClick={() => {
                      track('rsa_sos', { channel: 'call_support' });
                    }}
                  >
                    {t('callSupport')}
                  </a>
                ) : null}
              </div>
            ) : null}
          </fieldset>

          {avail?.available ? (
            <>
              <fieldset className="space-y-3">
                <legend className="font-heading text-lg font-extrabold text-ink">{t('vehicleTitle')}</legend>
                <div className="flex flex-wrap gap-3">
                  {avail.vehicleTypes.map((vt) => (
                    <label
                      key={vt}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold has-[:checked]:border-accent has-[:checked]:bg-pill has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
                    >
                      <input
                        type="radio"
                        name="vehicle"
                        checked={vehicleType === vt}
                        onChange={() => {
                          setVehicleType(vt);
                        }}
                      />
                      {(() => {
                        const Icon = VEHICLE_LUCIDE[vt];
                        return <Icon aria-hidden="true" className="size-5" />;
                      })()}
                      {v(VEHICLE_LABEL_KEY[vt])}
                    </label>
                  ))}
                </div>
                <label className="block text-sm font-bold text-ink">
                  {t('fuel')}
                  <select
                    className={field}
                    value={fuel}
                    onChange={(e) => {
                      setFuel(e.target.value as RsaFuel);
                    }}
                  >
                    {RSA_FUELS.map((f) => (
                      <option key={f} value={f}>
                        {t(`fuel_${f}` as 'fuel_petrol')}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="font-heading text-lg font-extrabold text-ink">{t('problemTitle')}</legend>
                <p className="text-sm text-muted">{t('problemHint')}</p>
                {PROBLEMS.filter((p) => p === 'skipped' || avail.problemTypes.includes(p)).map((p) => (
                  <label
                    key={p}
                    className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-bold text-ink"
                  >
                    <input
                      type="radio"
                      name="problem"
                      checked={problem === p}
                      onChange={() => {
                        setProblem(p);
                      }}
                    />
                    {t(`problem_${p}` as 'problem_unknown')}
                  </label>
                ))}
                <label className="block text-sm font-bold text-ink">
                  {t('note')}
                  <textarea
                    className={field}
                    rows={2}
                    maxLength={300}
                    value={note}
                    onChange={(e) => {
                      setNote(e.target.value);
                    }}
                  />
                </label>
              </fieldset>
            </>
          ) : null}
          <button
            type="submit"
            className={primary}
            disabled={!ready}
            data-disclosure-trigger="roadside-review"
          >
            {t('review')}
          </button>
        </>
      ) : (
        <div className="space-y-4">
          <h2 ref={reviewHeading} tabIndex={-1} className="font-heading text-lg font-extrabold text-ink">
            {t('reviewTitle')}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-card border border-line-card bg-surface p-4 text-sm">
            <dt className="text-muted">{t('pincode')}</dt>
            <dd className="font-bold">{pincode}</dd>
            <dt className="text-muted">{t('vehicleTitle')}</dt>
            <dd className="font-bold">{vehicleType ? v(VEHICLE_LABEL_KEY[vehicleType]) : ''}</dd>
            <dt className="text-muted">{t('problemTitle')}</dt>
            <dd className="font-bold">{t(`problem_${problem}` as 'problem_unknown')}</dd>
          </dl>
          <p className="rounded-card bg-pill p-4 text-sm text-ink">
            {t('advanceExplain', { amount: formatPrice(advance ?? 0) })}
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primary} disabled={busy} onClick={() => void pay()}>
              {busy ? t('paying') : t('payAdvance', { amount: formatPrice(advance ?? 0) })}
            </button>
            <button
              type="button"
              className={quiet}
              disabled={busy}
              data-panel-cancel="roadside-review"
              onClick={() => {
                setStep('form');
              }}
            >
              {t('back')}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
