'use client';

import type { ApplicationStatusView as SharedStatusView } from '@mechdost/shared/shop-tools';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { useApplications } from '@/demo/partner-store';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { useAutoSubmitCode } from '@/lib/auth/use-auto-submit-code';
import { formatDate } from '@/lib/format';
import { isValidIndianMobile } from '@/lib/shop-tier1';
import { APPLICATION_REF, normaliseRef, stageIndex, statusErrorKey } from '@/lib/shop-tools-view';
import { StatusTimeline } from '../commerce/status-timeline';

const field =
  'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted';
const primary =
  'press inline-flex min-h-11 items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill';
const RECAPTCHA_ID = 'status-recaptcha';
/** Delivery-agent applications (spec 24) share the lookup: the shared status kind includes `delivery_agent` (G3). */
type ApplicationStatusView = SharedStatusView;

const e164 = (raw: string) => {
  const digits = raw.replace(/[\s-]/g, '');
  return digits.startsWith('+91') ? digits : `+91${digits}`;
};

/**
 * Public application status (design 2026-11-15, item 7; spec 07). The applicant has no account yet, so the proof is
 * the reference plus a one-time code sent to the phone they applied with. Only the stage comes back. Real sign-in
 * builds check the code with Firebase and ask the API; demo builds look the reference up on this device.
 */
export function PartnerStatus() {
  return AUTH_MODE === 'firebase' ? <ApiStatus /> : <DemoStatus />;
}

function Result({ view, onAgain }: { view: ApplicationStatusView; onAgain: () => void }) {
  const t = useTranslations('shopTier2');
  const locale = useLocale();
  const steps: { key: string; title: string; detail: string }[] = (
    ['new', 'in_review', 'approved'] as const
  ).map((s) => ({ key: s, title: t(`stage_${s}`), detail: t(`detail_${s}`) }));
  const rejected = view.stage === 'rejected';
  if (rejected)
    steps.splice(2, 1, { key: 'rejected', title: t('stage_rejected'), detail: t('detail_rejected') });
  const current = view.stage === 'approved' ? steps.length : stageIndex(view.stage);
  return (
    <section
      aria-labelledby="status-result"
      className="max-w-xl rounded-card border border-line-card bg-surface p-6 shadow-card"
    >
      <h2 id="status-result" className="font-heading text-lg font-extrabold text-ink">
        {t(`statusKind_${view.kind}`)}
      </h2>
      <p className="text-sm text-muted">
        {view.code} · {t('statusUpdated', { date: formatDate(view.updatedAt, locale) })}
      </p>
      <div className="mt-5">
        <StatusTimeline
          label={t(`statusKind_${view.kind}`)}
          steps={steps}
          current={rejected ? 2 : current}
          currentLabel={t(`stage_${view.stage}`)}
        />
      </div>
      <button type="button" onClick={onAgain} className={`${quiet} mt-5`}>
        {t('statusAgain')}
      </button>
    </section>
  );
}

function ApiStatus() {
  const t = useTranslations('shopTier2');
  const locale = useLocale();
  const [step, setStep] = useState<'form' | 'code' | 'result'>('form');
  const [ref, setRef] = useState('');
  const [phone, setPhone] = useState('');
  const [view, setView] = useState<ApplicationStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<'ref' | 'phone' | 'code' | null>(null);
  const [working, setWorking] = useState(false);
  // The code is checked by itself at 6 digits (user, 2026-11-25); the button stays as the fallback.
  const {
    value: code,
    setValue: setCode,
    checking,
    inputProps,
    claimManual,
  } = useAutoSubmitCode({
    length: 6,
    busy: working,
    submit: (value, auto) => checkCode(value, auto),
  });

  const restart = () => {
    setStep('form');
    setCode('');
    setView(null);
    setError(null);
    setFieldError(null);
  };

  async function finish(token: string, signOutAfter: boolean) {
    const [{ lookupApplication }, client] = await Promise.all([
      import('@/lib/shop-tools-api'),
      import('@/lib/auth/firebase-client'),
    ]);
    const r = await lookupApplication(locale, normaliseRef(ref), token);
    // A phone proved only for this lookup leaves no session behind on this device.
    if (signOutAfter) await client.signOutReal();
    setWorking(false);
    track('click', {
      id: r.ok ? 'partner_status_found' : 'partner_status_miss',
      path: window.location.pathname,
    });
    if (!r.ok) {
      setError(statusErrorKey(r.code));
      setStep('form');
      return;
    }
    setView(r.data);
    setStep('result');
  }

  async function onSend(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!APPLICATION_REF.test(normaliseRef(ref))) {
      setFieldError('ref');
      return;
    }
    if (!isValidIndianMobile(phone)) {
      setFieldError('phone');
      return;
    }
    setFieldError(null);
    setWorking(true);
    const client = await import('@/lib/auth/firebase-client');
    // Already signed in on this device: use that phone, no second code (and keep the session).
    const existing = await client.currentIdToken(locale);
    if (existing) {
      await finish(existing, false);
      return;
    }
    const r = await client.sendPhoneCode(e164(phone), locale, RECAPTCHA_ID);
    setWorking(false);
    if (!r.ok) {
      setError(`statusErr_${r.reason}`);
      return;
    }
    setStep('code');
  }

  function onConfirm(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!claimManual()) return;
    void checkCode(code, false);
  }

  async function checkCode(value: string, auto: boolean) {
    if (working) return;
    setError(null);
    if (!/^\d{6}$/.test(value.trim())) {
      setFieldError('code');
      return;
    }
    setFieldError(null);
    setWorking(true);
    track('code_submitted', { kind: 'partner_status', auto, path: window.location.pathname });
    const client = await import('@/lib/auth/firebase-client');
    const r = await client.confirmPhoneCode(value.trim());
    if (!r.ok) {
      setWorking(false);
      setError(`statusErr_${r.reason === 'unavailable' ? 'unavailable' : r.reason}`);
      return;
    }
    const token = await client.currentIdToken(locale, true);
    if (!token) {
      setWorking(false);
      setError('statusErr_unavailable');
      return;
    }
    await finish(token, true);
  }

  if (step === 'result' && view) return <Result view={view} onAgain={restart} />;
  return (
    <div className="max-w-xl rounded-card border border-line-card bg-surface p-6 shadow-card">
      <p className="text-sm text-muted">{t('statusLead')}</p>
      {step === 'form' ? (
        <form
          onSubmit={(e) => void onSend(e)}
          noValidate
          className="mt-4 space-y-4"
          aria-busy={working || undefined}
        >
          <div>
            <label htmlFor="status-ref" className="text-sm font-bold text-ink">
              {t('statusRef')}
            </label>
            <input
              id="status-ref"
              value={ref}
              onChange={(e) => {
                setRef(e.target.value);
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={24}
              aria-invalid={fieldError === 'ref' || undefined}
              aria-describedby="status-ref-hint"
              className={field}
            />
            <p
              id="status-ref-hint"
              className={`mt-1 text-xs ${fieldError === 'ref' ? 'font-bold text-error' : 'text-muted'}`}
            >
              {fieldError === 'ref' ? t('statusRefInvalid') : t('statusRefHint')}
            </p>
          </div>
          <div>
            <label htmlFor="status-phone" className="text-sm font-bold text-ink">
              {t('statusPhone')}
            </label>
            <input
              id="status-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
              }}
              aria-invalid={fieldError === 'phone' || undefined}
              aria-describedby={fieldError === 'phone' ? 'status-phone-error' : undefined}
              className={field}
            />
            {fieldError === 'phone' ? (
              <p id="status-phone-error" className="mt-1 text-sm font-bold text-error">
                {t('statusPhoneInvalid')}
              </p>
            ) : null}
          </div>
          <div id={RECAPTCHA_ID} />
          {error ? (
            <p role="alert" className="text-sm font-bold text-error">
              {t(error as 'statusErr_generic')}
            </p>
          ) : null}
          <button type="submit" disabled={working} className={primary}>
            {working ? t('statusSending') : t('statusSend')}
          </button>
        </form>
      ) : (
        <form onSubmit={onConfirm} noValidate className="mt-4 space-y-4" aria-busy={working || undefined}>
          <div>
            <label htmlFor="status-code" className="text-sm font-bold text-ink">
              {t('statusCode')}
            </label>
            <input
              id="status-code"
              {...inputProps}
              aria-invalid={fieldError === 'code' || undefined}
              aria-describedby={
                fieldError === 'code' ? 'status-code-error status-code-hint' : 'status-code-hint'
              }
              className={field}
            />
            <p id="status-code-hint" className="mt-1 text-xs text-muted">
              {t('statusCodeHint')}
            </p>
            <p role="status" className="sr-only">
              {checking ? t('statusChecking') : ''}
            </p>
            {fieldError === 'code' ? (
              <p id="status-code-error" className="mt-1 text-sm font-bold text-error">
                {t('statusCodeInvalid')}
              </p>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm font-bold text-error">
              {t(error as 'statusErr_generic')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={working} className={primary}>
              {working ? t('statusChecking') : t('statusCheck')}
            </button>
            <button type="button" onClick={restart} className={quiet}>
              {t('statusOtherNumber')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const DEMO_STAGE = ['new', 'in_review', 'in_review', 'approved'] as const;

/** Demo builds: the applications live on this device, so the reference and phone are matched here (no code). */
function DemoStatus() {
  const t = useTranslations('shopTier2');
  const apps = useApplications();
  const [ref, setRef] = useState('');
  const [phone, setPhone] = useState('');
  const [view, setView] = useState<ApplicationStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '').slice(-10);
    // Delivery-agent applications live in the demo delivery store (loaded only for this lookup).
    const { agentApplication } = await import('@/demo/delivery-store');
    const agentApp = agentApplication(normaliseRef(ref));
    if (agentApp?.phone.replace(/\D/g, '').slice(-10) === digits) {
      setError(null);
      setView({
        code: agentApp.code,
        kind: 'delivery_agent',
        stage:
          agentApp.status === 'rejected' ? 'rejected' : agentApp.status === 'invited' ? 'approved' : 'new',
        updatedAt: agentApp.createdAt,
      });
      return;
    }
    const found = apps.find(
      (a) => a.code === normaliseRef(ref) && a.phone.replace(/\D/g, '').slice(-10) === digits,
    );
    if (!found) {
      setError('statusErr_NOT_FOUND');
      return;
    }
    setError(null);
    setView({
      code: found.code,
      kind: found.kind === 'garage' || found.kind === 'mechanic' ? found.kind : 'seller',
      stage: found.rejected ? 'rejected' : (DEMO_STAGE[found.stage] ?? 'new'),
      updatedAt: found.createdAt,
    });
  }

  if (view)
    return (
      <Result
        view={view}
        onAgain={() => {
          setView(null);
        }}
      />
    );
  return (
    <div className="max-w-xl rounded-card border border-line-card bg-surface p-6 shadow-card">
      <p className="text-sm text-muted">{t('statusLead')}</p>
      <form onSubmit={(e) => void onSubmit(e)} className="mt-4 space-y-4">
        <div>
          <label htmlFor="status-ref" className="text-sm font-bold text-ink">
            {t('statusRef')}
          </label>
          <input
            id="status-ref"
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
            }}
            autoComplete="off"
            className={field}
          />
          <p className="mt-1 text-xs text-muted">{t('statusRefHint')}</p>
        </div>
        <div>
          <label htmlFor="status-phone" className="text-sm font-bold text-ink">
            {t('statusPhone')}
          </label>
          <input
            id="status-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
            }}
            className={field}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm font-bold text-error">
            {t(error as 'statusErr_generic')}
          </p>
        ) : null}
        <button type="submit" className={primary}>
          {t('statusCheck')}
        </button>
      </form>
    </div>
  );
}
