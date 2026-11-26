'use client';

import type { AttestPage } from '@mechdost/shared/ustaad/dto/verification';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { track } from '@/lib/analytics';

const TURNSTILE_ID = 'ustaad-attest-turnstile';
const field =
  'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] uppercase text-ink placeholder:normal-case placeholder:text-muted aria-[invalid=true]:border-error';
const primary =
  'press inline-flex min-h-11 w-full items-center justify-center rounded-button bg-accent-button px-6 text-base font-bold text-white hover:bg-accent-button-hover aria-disabled:opacity-60';
const quiet =
  'press inline-flex min-h-11 w-full items-center justify-center rounded-button border border-line-card bg-surface px-5 text-base font-bold text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

type Step = 'loading' | 'gone' | 'ask' | 'confirm' | 'decline' | 'done';
type Shop = { lat: number; lng: number; accuracyM: number };
type LocState = 'idle' | 'finding' | 'found' | 'denied' | 'unavailable';
/** Which control an error belongs to (the error sits under it and the control gets focus). */
type ErrorAt = 'businessId' | 'location' | 'form';

const FIELD_ERRORS: Record<string, ErrorAt> = {
  ATTEST_BUSINESS_ID: 'businessId',
  location_required: 'location',
};
const KNOWN = [
  'ATTEST_BUSINESS_ID',
  'ATTEST_QUARTER_CAP',
  'location_required',
  'TURNSTILE_FAILED',
  'RATE_LIMITED',
] as const;
type Known = (typeof KNOWN)[number];
const isKnown = (code: string): code is Known => (KNOWN as readonly string[]).includes(code);

/**
 * The garage owner's answer (spec 23 § 4 flow 2, SR-6). One question, two answers; "Yes" asks for the GSTIN/Udyam
 * number and the owner's position at the garage (only the distance to the member's pin is kept), then the security
 * check. Unknown, used and expired links all show the same message. Focus moves to each step's heading; errors sit
 * under their control, are announced and take focus; status lines are always mounted (L-B2).
 */
export function AttestForm({ token }: { token: string }) {
  const t = useTranslations('ustaad.attest');
  const locale = useLocale();
  const [step, setStep] = useState<Step>('loading');
  const [page, setPage] = useState<AttestPage | null>(null);
  const [outcome, setOutcome] = useState<'received' | 'declined' | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loc, setLoc] = useState<LocState>('idle');
  const [businessId, setBusinessId] = useState('');
  const [error, setError] = useState<{ at: ErrorAt; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const idInput = useRef<HTMLInputElement>(null);
  const locButton = useRef<HTMLButtonElement>(null);
  const formError = useRef<HTMLParagraphElement>(null);
  const firstRender = useRef(true);
  // The status region is mounted empty and filled after hydration, so "Loading" is announced (L-B2).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let live = true;
    void import('@/lib/ustaad/attest-api')
      .then((m) => m.fetchAttestPage(token))
      .then((res) => {
        if (!live) return;
        track('ustaad_attest_opened', { valid: res.ok });
        if (res.ok) {
          setPage(res.data);
          setStep('ask');
        } else setStep('gone');
      })
      .catch(() => {
        if (live) setStep('gone');
      });
    return () => {
      live = false;
    };
  }, [token]);

  // Each new step: focus its heading (not on the first paint, so the page does not jump for screen readers).
  useEffect(() => {
    if (step === 'loading') return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  // A new error: focus the control it belongs to (or the form message).
  useEffect(() => {
    if (!error) return;
    if (error.at === 'businessId') idInput.current?.focus();
    else if (error.at === 'location') locButton.current?.focus();
    else formError.current?.focus();
  }, [error]);

  const name = page?.memberName ?? '';
  const area = page ? (locale === 'hi' && page.areaLabelHi ? page.areaLabelHi : page.areaLabel) : '';
  const message = (code: string) => t(isKnown(code) ? `err_${code}` : 'err_generic', { name });

  function go(next: Step) {
    setError(null);
    setStep(next);
  }

  function findLocation() {
    if (loc === 'finding') return;
    if (!('geolocation' in navigator)) {
      setLoc('unavailable');
      track('ustaad_attest_location', { outcome: 'unavailable' });
      return;
    }
    setLoc('finding');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setShop({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyM: Math.min(5000, Math.round(p.coords.accuracy)),
        });
        setLoc('found');
        if (error?.at === 'location') setError(null);
        track('ustaad_attest_location', { outcome: 'found' });
      },
      (e) => {
        const denied = e.code === e.PERMISSION_DENIED;
        setLoc(denied ? 'denied' : 'unavailable');
        track('ustaad_attest_location', { outcome: denied ? 'denied' : 'unavailable' });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }

  async function send(e: SyntheticEvent<HTMLFormElement>, decision: 'confirmed' | 'declined') {
    e.preventDefault();
    if (busy) return;
    const id = businessId.trim().toUpperCase();
    if (decision === 'confirmed') {
      if (id.length < 15) {
        setError({ at: 'businessId', code: 'ATTEST_BUSINESS_ID' });
        return;
      }
      if (!shop) {
        setError({ at: 'location', code: 'location_required' });
        return;
      }
    }
    setBusy(true);
    setError(null);
    let turnstileToken: string;
    try {
      const { turnstileToken: get } = await import('@/lib/auth/turnstile');
      turnstileToken = await get(TURNSTILE_ID, locale, setChallenge);
    } catch {
      setBusy(false);
      setError({ at: 'form', code: 'TURNSTILE_FAILED' });
      return;
    }
    const { submitAttest } = await import('@/lib/ustaad/attest-api');
    const res = await submitAttest(
      token,
      decision === 'confirmed' && shop
        ? { decision, turnstileToken, businessId: id, shop }
        : { decision: 'declined', turnstileToken },
    );
    setBusy(false);
    track('ustaad_attest_sent', { decision, ok: res.ok });
    if (res.ok) {
      setOutcome(res.data.outcome);
      go('done');
      return;
    }
    if (res.code === 'NOT_FOUND') {
      go('gone');
      return;
    }
    setError({ at: FIELD_ERRORS[res.code] ?? 'form', code: res.code });
  }

  const headingClass =
    'font-heading text-[clamp(24px,6vw,32px)] font-extrabold leading-tight tracking-[-0.02em] text-ink outline-none';

  const securityCheck = (
    <div
      role={challenge ? 'group' : undefined}
      aria-labelledby={challenge ? 'attest-turnstile-label' : undefined}
    >
      <p id="attest-turnstile-label" hidden={!challenge} className="text-sm font-bold text-ink">
        {t('securityCheck')}
      </p>
      <div id={TURNSTILE_ID} />
    </div>
  );

  const formMessage = (
    <p ref={formError} tabIndex={-1} className="text-sm font-bold text-error outline-none">
      {error?.at === 'form' ? message(error.code) : ''}
    </p>
  );

  return (
    <div className="rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-8">
      <p role="status" className="sr-only">
        {!mounted
          ? ''
          : step === 'loading'
            ? t('loading')
            : busy
              ? challenge
                ? t('securityCheck')
                : t('sending')
              : ''}
      </p>

      {step === 'loading' ? <h1 className="sr-only">{t('metaTitle')}</h1> : null}
      {step === 'loading' ? (
        <div aria-hidden="true" className="grid gap-3">
          <div className="h-8 w-4/5 animate-pulse rounded bg-pill motion-reduce:animate-none" />
          <div className="h-4 w-3/5 animate-pulse rounded bg-pill motion-reduce:animate-none" />
        </div>
      ) : null}

      {step === 'gone' ? (
        <div className="grid gap-3">
          <h1 ref={heading} tabIndex={-1} className={headingClass}>
            {t('gone')}
          </h1>
          <p className="text-base text-ink-muted">{t('goneHint')}</p>
        </div>
      ) : null}

      {step === 'ask' && page ? (
        <div className="grid gap-5">
          <div className="grid gap-2">
            <h1 ref={heading} tabIndex={-1} className={headingClass}>
              {t('title', { name })}
            </h1>
            <p className="text-base text-ink">
              {page.sinceYear === null
                ? t('factsNoYear', { name, area })
                : t('facts', { name, area, year: String(page.sinceYear) })}
            </p>
            <p className="text-sm text-ink-muted">{t('why')}</p>
          </div>
          <div className="grid gap-3">
            <button type="button" className={primary} onClick={() => go('confirm')}>
              {t('confirm')}
            </button>
            <button type="button" className={quiet} onClick={() => go('decline')}>
              {t('decline')}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'confirm' ? (
        <form noValidate onSubmit={(e) => void send(e, 'confirmed')} className="grid gap-5">
          <h1 ref={heading} tabIndex={-1} className={headingClass}>
            {t('confirmTitle', { name })}
          </h1>
          <div>
            <label htmlFor="attest-business-id" className="text-sm font-bold text-ink">
              {t('businessId')} <span className="font-normal text-ink-muted">{t('required')}</span>
            </label>
            <p id="attest-business-id-hint" className="mt-0.5 text-sm text-ink-muted">
              {t('businessIdHint')}
            </p>
            <input
              ref={idInput}
              id="attest-business-id"
              name="businessId"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={20}
              aria-required="true"
              value={businessId}
              onChange={(e) => {
                setBusinessId(e.target.value);
                if (error?.at === 'businessId') setError(null);
              }}
              aria-invalid={error?.at === 'businessId' ? true : undefined}
              aria-describedby={`attest-business-id-hint${error?.at === 'businessId' ? ' attest-business-id-error' : ''}`}
              className={field}
            />
            {error?.at === 'businessId' ? (
              <p id="attest-business-id-error" className="mt-1 text-sm font-bold text-error">
                {message(error.code)}
              </p>
            ) : null}
          </div>
          <div role="group" aria-labelledby="attest-location-label">
            <p id="attest-location-label" className="text-sm font-bold text-ink">
              {t('locationLabel')} <span className="font-normal text-ink-muted">{t('required')}</span>
            </p>
            <p id="attest-location-hint" className="mt-0.5 text-sm text-ink-muted">
              {t('locationHint', { name })}
            </p>
            <button
              ref={locButton}
              type="button"
              onClick={findLocation}
              aria-disabled={loc === 'finding' ? true : undefined}
              aria-describedby={`attest-location-hint attest-location-status${error?.at === 'location' ? ' attest-location-error' : ''}`}
              className={`${quiet} mt-2`}
            >
              {t('useLocation')}
            </button>
            <p id="attest-location-status" role="status" className="text-sm text-ink [&:not(:empty)]:mt-1">
              {loc === 'finding' ? (
                t('locationFinding')
              ) : loc === 'found' ? (
                <>
                  <span aria-hidden="true">✓ </span>
                  {t('locationDone')}
                </>
              ) : loc === 'denied' ? (
                t('locationDenied')
              ) : loc === 'unavailable' ? (
                t('locationUnavailable')
              ) : (
                ''
              )}
            </p>
            {error?.at === 'location' ? (
              <p id="attest-location-error" className="mt-1 text-sm font-bold text-error">
                {message(error.code)}
              </p>
            ) : null}
          </div>
          {securityCheck}
          {formMessage}
          <div className="grid gap-3">
            <button type="submit" aria-disabled={busy ? true : undefined} className={primary}>
              {t('submit', { name })}
            </button>
            <button type="button" className={quiet} onClick={() => go('ask')}>
              {t('back')}
            </button>
          </div>
        </form>
      ) : null}

      {step === 'decline' ? (
        <form noValidate onSubmit={(e) => void send(e, 'declined')} className="grid gap-5">
          <h1 ref={heading} tabIndex={-1} className={headingClass}>
            {t('declineTitle', { name })}
          </h1>
          <p className="text-base text-ink-muted">{t('declineBody')}</p>
          {securityCheck}
          {formMessage}
          <div className="grid gap-3">
            <button type="submit" aria-disabled={busy ? true : undefined} className={primary}>
              {t('submitDecline')}
            </button>
            <button type="button" className={quiet} onClick={() => go('ask')}>
              {t('back')}
            </button>
          </div>
        </form>
      ) : null}

      {step === 'done' ? (
        <div className="grid gap-3">
          <h1 ref={heading} tabIndex={-1} className={headingClass}>
            {t('doneTitle')}
          </h1>
          <p className="text-base text-ink">
            {outcome === 'declined' ? t('doneDeclined', { name }) : t('doneConfirmed', { name })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
