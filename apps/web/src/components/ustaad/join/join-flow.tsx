'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { USTAAD_SEGMENT_CODES, USTAAD_WORK_CODES } from '@mechdost/shared/ustaad/codes';
import { useSession } from '@/demo/session';
import { useHydrated } from '@/demo/store';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import {
  emptyJoinDraft,
  JOIN_STEPS,
  joinBody,
  joinErrorKey,
  stepErrors,
  type JoinConsent,
  type JoinDraft,
  type JoinProof,
  type JoinStepErrorKey,
} from '@/lib/ustaad/join';

const TURNSTILE_ID = 'ustaad-join-turnstile';
const CONSENTS: readonly JoinConsent[] = [
  'ustaad_profile',
  'ustaad_directory',
  'ustaad_training',
  'ustaad_offers',
];
const PROOFS: readonly JoinProof[] = ['owner', 'vouch'];

/** One big tappable choice (≥ 48 px): a native radio or checkbox inside a label, so keyboard and screen readers work. */
function Choice({
  type,
  name,
  checked,
  onChange,
  title,
  hint,
  disabled,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  hint?: string | undefined;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-card border-2 px-4 py-3 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
        checked ? 'border-accent bg-accent/10' : 'border-line-card bg-surface'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1 size-5 shrink-0 accent-[var(--color-accent-button)]"
      />
      <span className="grid gap-0.5">
        <span className="text-base font-bold text-ink">{title}</span>
        {hint ? <span className="text-sm text-ink-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

function Group({
  legend,
  error,
  children,
}: {
  legend: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <fieldset className="grid gap-3" aria-invalid={error ? true : undefined}>
      <legend className="mb-2 text-sm font-bold text-ink">{legend}</legend>
      {children}
      {error ? (
        <p role="alert" className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  inputMode,
  autoComplete,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  inputMode?: 'numeric' | 'text';
  autoComplete?: string;
  maxLength: number;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
      </label>
      <input
        id={id}
        name={id}
        value={value}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="min-h-12 rounded-input border border-line-card bg-surface px-3 text-base text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The 5-step join (spec 23 § 4 flow 1): Who are you → What you fix → About you → How to verify → Your choices. The
 * same component serves `/ustaad/join` and `/partners/apply/mechanic` (§ 4a). Signed out → sign in first (phone OTP)
 * and come back. Never waits for verification: submit makes the card at once, then the tutorial. One primary action
 * per step; focus moves to the step heading on every step change; errors are announced.
 */
export function UstaadJoinFlow({
  via,
  fromApplication,
  prefill,
}: {
  via: 'ustaad' | 'partners_apply';
  fromApplication?: string | undefined;
  prefill?: { name?: string; pincode?: string } | undefined;
}) {
  const t = useTranslations('ustaad.join');
  const locale = useLocale();
  const hydrated = useHydrated();
  const session = useSession();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<JoinDraft>(() => emptyJoinDraft(prefill));
  const [errors, setErrors] = useState<Partial<Record<string, JoinStepErrorKey>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [done, setDone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step, done]);

  if (!hydrated) return <div className="skeleton h-96 w-full rounded-card" aria-hidden="true" />;
  if (!session) {
    const back = localePath(via === 'ustaad' ? '/ustaad/join' : '/partners/apply/mechanic', locale);
    return (
      <div className="grid gap-4">
        <p className="text-base text-ink">{t('signInFirst')}</p>
        <a
          href={`${localePath('/login', locale)}?next=${encodeURIComponent(back)}`}
          className="press inline-flex min-h-12 items-center justify-center rounded-button bg-accent-button px-6 text-base font-bold text-white hover:bg-accent-button-hover"
        >
          {t('signIn')}
        </a>
      </div>
    );
  }

  if (done)
    return (
      <div className="grid gap-4 text-center">
        <h2
          ref={heading}
          tabIndex={-1}
          className="font-heading text-2xl font-extrabold text-ink outline-none"
        >
          {t('doneTitle')}
        </h2>
        <p className="text-base text-ink-muted">{t('doneBody')}</p>
        <a
          href={localePath('/ustaad/welcome', locale)}
          className="press inline-flex min-h-12 items-center justify-center rounded-button bg-accent-button px-6 text-base font-bold text-white hover:bg-accent-button-hover"
        >
          {t('doneCta')}
        </a>
      </div>
    );

  const key = JOIN_STEPS[step] ?? 'who';
  const set = <K extends keyof JoinDraft>(k: K, v: JoinDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
  };
  const toggle = <T extends string>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const msg = (field: string) => {
    const k = errors[field];
    return k ? t(k) : undefined;
  };
  const last = step === JOIN_STEPS.length - 1;

  async function onNext() {
    const found = stepErrors(key, draft);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    track('ustaad_join_step', { step: step + 1, via });
    if (!last) {
      setStep((s) => s + 1);
      return;
    }
    setBusy(true);
    let token: string;
    try {
      const { turnstileToken } = await import('@/lib/auth/turnstile');
      token = await turnstileToken(TURNSTILE_ID, locale, setChallenge);
    } catch {
      setBusy(false);
      setFormError(t('errTurnstile'));
      return;
    }
    const { submitUstaadJoin } = await import('@/lib/ustaad/join-api');
    const res = await submitUstaadJoin(
      locale,
      joinBody(draft, { turnstileToken: token, via, ...(fromApplication ? { fromApplication } : {}) }),
    );
    setBusy(false);
    if (!res.ok) {
      setFormError(t(joinErrorKey(res.code)));
      return;
    }
    setDone(true);
  }

  return (
    <form
      noValidate
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void onNext();
      }}
    >
      <div>
        <p className="text-sm font-bold text-ink-muted">
          {t('stepOf', { n: step + 1, total: JOIN_STEPS.length })}
        </p>
        <div className="mt-2 flex gap-1.5" aria-hidden="true">
          {JOIN_STEPS.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-accent' : 'bg-line-card'}`}
            />
          ))}
        </div>
        <h2
          ref={heading}
          tabIndex={-1}
          className="mt-4 font-heading text-[clamp(22px,4vw,28px)] font-extrabold text-ink outline-none"
        >
          {t(`step_${key}`)}
        </h2>
      </div>

      {key === 'who' ? (
        <Group legend={t('step_who')} error={msg('track')}>
          {(['apprentice', 'ustaad'] as const).map((tr) => (
            <Choice
              key={tr}
              type="radio"
              name="track"
              checked={draft.track === tr}
              onChange={() => {
                set('track', tr);
              }}
              title={t(`track_${tr}`)}
              hint={t(`track_${tr}_hint`)}
            />
          ))}
          {draft.track === 'ustaad' ? <p className="text-sm text-ink-muted">{t('trackNote')}</p> : null}
        </Group>
      ) : null}

      {key === 'work' ? (
        <div className="grid gap-6">
          {[
            { legend: t('workVehicles'), codes: USTAAD_SEGMENT_CODES },
            { legend: t('workKinds'), codes: USTAAD_WORK_CODES },
          ].map((g, i) => (
            <Group key={g.legend} legend={g.legend} error={i === 0 ? msg('specialities') : undefined}>
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                {g.codes.map((code) => (
                  <Choice
                    key={code}
                    type="checkbox"
                    name="specialities"
                    checked={draft.specialities.includes(code)}
                    onChange={() => {
                      set('specialities', toggle(draft.specialities, code));
                    }}
                    title={t(`spec_${code}`)}
                  />
                ))}
              </div>
            </Group>
          ))}
        </div>
      ) : null}

      {key === 'details' ? (
        <div className="grid gap-4">
          <Field
            id="uj-name"
            label={t('name')}
            value={draft.displayName}
            onChange={(v) => {
              set('displayName', v);
            }}
            error={msg('displayName')}
            autoComplete="name"
            maxLength={60}
          />
          <Field
            id="uj-garage"
            label={t('garage')}
            value={draft.garageName}
            onChange={(v) => {
              set('garageName', v);
            }}
            maxLength={80}
          />
          <label className="flex min-h-12 items-center gap-3 text-base text-ink">
            <input
              type="checkbox"
              checked={draft.showGarage}
              onChange={(e) => {
                set('showGarage', e.target.checked);
              }}
              className="size-5 accent-[var(--color-accent-button)]"
            />
            {t('showGarage')}
          </label>
          <div className="grid gap-4 min-[420px]:grid-cols-2">
            <Field
              id="uj-pincode"
              label={t('pincode')}
              value={draft.pincode}
              onChange={(v) => {
                set('pincode', v.replace(/\D/g, ''));
              }}
              error={msg('pincode')}
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
            />
            <Field
              id="uj-years"
              label={t('years')}
              value={draft.yearsClaimed}
              onChange={(v) => {
                set('yearsClaimed', v.replace(/\D/g, ''));
              }}
              error={msg('yearsClaimed')}
              inputMode="numeric"
              maxLength={2}
            />
          </div>
          <Field
            id="uj-area"
            label={t('area')}
            value={draft.areaLabel}
            onChange={(v) => {
              set('areaLabel', v);
            }}
            error={msg('areaLabel')}
            maxLength={80}
          />
          <Group legend={t('workPlace')} error={msg('workPlace')}>
            {(['shop', 'home_roadside'] as const).map((w) => (
              <Choice
                key={w}
                type="radio"
                name="workPlace"
                checked={draft.workPlace === w}
                onChange={() => {
                  set('workPlace', w);
                }}
                title={t(`workPlace_${w}`)}
              />
            ))}
          </Group>
        </div>
      ) : null}

      {key === 'verify' ? (
        <Group legend={t('verifyLead')}>
          {PROOFS.map((p) => (
            <Choice
              key={p}
              type="checkbox"
              name="verify"
              checked={draft.verifyMethods.includes(p)}
              onChange={() => {
                set('verifyMethods', toggle(draft.verifyMethods, p));
              }}
              title={t(`verify_${p}`)}
              hint={t(`verify_${p}_hint`)}
            />
          ))}
          <Choice
            type="checkbox"
            name="verify"
            checked={false}
            disabled
            onChange={() => undefined}
            title={t('verify_certificate')}
            hint={t('comingSoon')}
          />
          <Choice
            type="checkbox"
            name="verify-later"
            checked={draft.verifyMethods.length === 0}
            onChange={() => {
              set('verifyMethods', []);
            }}
            title={t('verifyLater')}
          />
        </Group>
      ) : null}

      {key === 'choices' ? (
        <Group legend={t('step_choices')} error={msg('ustaad_profile')}>
          {CONSENTS.map((c) => (
            <Choice
              key={c}
              type="checkbox"
              name={c}
              checked={draft.consents[c]}
              onChange={() => {
                set('consents', { ...draft.consents, [c]: !draft.consents[c] });
              }}
              title={t(`consent_${c}`)}
            />
          ))}
          <p className="text-sm text-ink-muted">{t('consentNote')}</p>
          <div role="group" aria-labelledby={challenge ? 'uj-turnstile-label' : undefined}>
            <p id="uj-turnstile-label" hidden={!challenge} className="text-sm font-bold text-ink">
              {t('securityCheck')}
            </p>
            <div id={TURNSTILE_ID} />
          </div>
        </Group>
      ) : null}

      {formError ? (
        <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 min-[420px]:flex-row min-[420px]:justify-between">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => {
              setErrors({});
              setStep((s) => s - 1);
            }}
            className="press min-h-12 rounded-button border border-line-card px-6 text-base font-bold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t('back')}
          </button>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="press min-h-12 rounded-button bg-accent-button px-6 text-base font-bold text-white hover:bg-accent-button-hover disabled:opacity-70 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {last ? (busy ? t('submitting') : t('submit')) : t('next')}
        </button>
      </div>
    </form>
  );
}
