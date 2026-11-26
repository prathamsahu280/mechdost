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
  joinErrorStep,
  stepErrors,
  type JoinConsent,
  type JoinDraft,
  type JoinProof,
  type JoinApiErrorKey,
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
  required,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  hint?: string | undefined;
  disabled?: boolean;
  required?: boolean;
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
        aria-required={required ? true : undefined}
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
  id,
  legend,
  error,
  children,
}: {
  id: string;
  legend: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <fieldset
      id={id}
      data-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className="grid gap-3"
    >
      <legend className="mb-2 text-sm font-bold text-ink">{legend}</legend>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-bold text-error">
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
  required,
  marker,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  inputMode?: 'numeric' | 'text';
  autoComplete?: string;
  maxLength: number;
  required?: boolean;
  /** "(needed)" / "(optional)" shown after the label. */
  marker?: string;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
        {marker ? <span className="ml-1 font-normal text-ink-muted">{marker}</span> : null}
      </label>
      <input
        id={id}
        name={id}
        value={value}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        required={required}
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
  const [errors, setErrors] = useState<Partial<Record<string, JoinStepErrorKey | JoinApiErrorKey>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [done, setDone] = useState(false);
  const [later, setLater] = useState(false);
  const [status, setStatus] = useState('');
  const [errorTick, setErrorTick] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step, done]);

  // After a failed Next, focus the first invalid control (its message is read through aria-describedby).
  useEffect(() => {
    if (errorTick === 0) return;
    const root = form.current;
    if (!root) return;
    const first = root.querySelector<HTMLElement>(
      '[aria-invalid="true"], [data-invalid="true"] input:not([disabled])',
    );
    first?.focus();
  }, [errorTick]);

  if (!hydrated) return <div className="skeleton h-96 w-full rounded-card" aria-hidden="true" />;
  if (!session) {
    const back = localePath(via === 'ustaad' ? '/ustaad/join' : '/partners/apply/mechanic', locale);
    return (
      <div className="grid gap-4">
        <p className="text-base text-ink">{t('signInFirst')}</p>
        <a
          href={`${localePath('/login', locale)}?next=${encodeURIComponent(back)}`}
          className="press inline-flex min-h-12 items-center justify-center rounded-button bg-accent-button px-6 text-base font-bold text-white hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
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
          className="press inline-flex min-h-12 items-center justify-center rounded-button bg-accent-button px-6 text-base font-bold text-white hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
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
    if (busy) return;
    const found = stepErrors(key, draft);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      setErrorTick((n) => n + 1);
      return;
    }
    track('ustaad_join_step', { step: step + 1, via });
    if (!last) {
      setStep((s) => s + 1);
      return;
    }
    setBusy(true);
    setStatus(t('submitting'));
    let token: string;
    try {
      const { turnstileToken } = await import('@/lib/auth/turnstile');
      token = await turnstileToken(TURNSTILE_ID, locale, (shown) => {
        setChallenge(shown);
        if (shown) setStatus(t('challengeShown'));
      });
    } catch {
      setBusy(false);
      setStatus('');
      setFormError(t('errTurnstile'));
      return;
    }
    const { submitUstaadJoin } = await import('@/lib/ustaad/join-api');
    const res = await submitUstaadJoin(
      locale,
      joinBody(draft, { turnstileToken: token, via, ...(fromApplication ? { fromApplication } : {}) }),
    );
    setBusy(false);
    setStatus('');
    if (!res.ok) {
      // A problem with an earlier answer takes the person back to that step, error on the field.
      const back = joinErrorStep(res.code);
      if (back) {
        setStep(JOIN_STEPS.indexOf(back.step));
        setErrors({ [back.field]: back.key });
        return;
      }
      setFormError(t(joinErrorKey(res.code)));
      return;
    }
    setDone(true);
  }

  return (
    <form
      ref={form}
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
          <span className="sr-only">{t('stepHeading', { n: step + 1, total: JOIN_STEPS.length })}</span>
          {t(`step_${key}`)}
        </h2>
      </div>

      {key === 'who' ? (
        <Group id="uj-track" legend={t('step_who')} error={msg('track')}>
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
        <Group id="uj-work" legend={t('step_work')} error={msg('specialities')}>
          {[
            { legend: t('workVehicles'), codes: USTAAD_SEGMENT_CODES, id: 'uj-work-vehicles' },
            { legend: t('workKinds'), codes: USTAAD_WORK_CODES, id: 'uj-work-kinds' },
          ].map((g) => (
            <Group key={g.id} id={g.id} legend={g.legend}>
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
        </Group>
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
            required
            marker={t('required')}
          />
          <Field
            id="uj-garage"
            label={t('garage')}
            value={draft.garageName}
            onChange={(v) => {
              set('garageName', v);
            }}
            autoComplete="organization"
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
              required
              marker={t('required')}
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
              required
              marker={t('required')}
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
            autoComplete="address-level3"
            maxLength={80}
            required
            marker={t('required')}
          />
          <Group id="uj-workplace" legend={t('workPlace')} error={msg('workPlace')}>
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
        <Group id="uj-verify" legend={t('verifyLead')}>
          {PROOFS.map((p) => (
            <Choice
              key={p}
              type="checkbox"
              name="verify"
              checked={draft.verifyMethods.includes(p)}
              onChange={() => {
                setLater(false);
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
            checked={later}
            onChange={() => {
              const next = !later;
              setLater(next);
              if (next) set('verifyMethods', []);
            }}
            title={t('verifyLater')}
          />
        </Group>
      ) : null}

      {key === 'choices' ? (
        <div className="grid gap-4">
          <Group id="uj-consents" legend={t('step_choices')} error={msg('ustaad_profile')}>
            {CONSENTS.map((c) => (
              <Choice
                key={c}
                type="checkbox"
                name={c}
                checked={draft.consents[c]}
                required={c === 'ustaad_profile'}
                onChange={() => {
                  set('consents', { ...draft.consents, [c]: !draft.consents[c] });
                }}
                title={t(`consent_${c}`)}
              />
            ))}
            <p className="text-sm text-ink-muted">{t('consentNote')}</p>
          </Group>
          {/* One stable container for the widget; the group gets its name only once a challenge shows. */}
          <div
            role={challenge ? 'group' : undefined}
            aria-labelledby={challenge ? 'uj-turnstile-label' : undefined}
          >
            <p id="uj-turnstile-label" hidden={!challenge} className="text-sm font-bold text-ink">
              {t('securityCheck')}
            </p>
            <div id={TURNSTILE_ID} />
          </div>
        </div>
      ) : null}

      <p role="status" className="sr-only">
        {status}
      </p>
      {formError ? (
        <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {formError}
        </p>
      ) : null}

      {/* Primary action first in the DOM (it is also on top on phones); Back sits to its left on wider screens. */}
      <div className="flex flex-col gap-3 min-[420px]:flex-row-reverse min-[420px]:justify-between">
        <button
          type="submit"
          aria-disabled={busy}
          className={`press min-h-12 rounded-button bg-accent-button px-6 text-base font-bold text-white hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${busy ? 'opacity-70' : ''}`}
        >
          {last ? (busy ? t('submitting') : t('submit')) : t('next')}
        </button>
        {step > 0 ? (
          <button
            type="button"
            onClick={() => {
              setErrors({});
              setFormError(null);
              setStep((s) => s - 1);
            }}
            className="press min-h-12 rounded-button border border-line-card px-6 text-base font-bold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t('back')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
