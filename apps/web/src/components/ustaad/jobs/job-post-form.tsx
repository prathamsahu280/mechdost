'use client';

import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { JOB_ROLES, USTAAD_SEGMENT_CODES, type UstaadSegmentCode } from '@mechdost/shared/ustaad/codes';
import { localePath } from '@/lib/locale-path';
import { ustaadClient, type JobRole } from '@/lib/ustaad/client';
import { rupeesToPaise } from '@/lib/ustaad/local-view';
import { newIdemKey } from '@/lib/ustaad/qa-view';
import { btnPrimary, card, fieldClass, SampleNote, useCodeLabel, useErrorText, useUstaad } from '../common';
import { ScamBanner } from './jobs-view';

type Field = 'title' | 'description' | 'areaLabel' | 'pay' | 'timing' | 'adult';

/**
 * Employer's job form (spec 23 § 4 flow 11): kind of work, title, about the job, area (+ Hindi), pay range a month in
 * whole rupees (stored as paise), timing, experience, vehicles and the locked "I hire only people aged 18 or older"
 * box. Errors sit next to their fields; the API checks the employer, scam phrases and the attestation again (a held
 * job shows "Being checked"). Posts as a verified trade account; posting for a MechDost workshop needs the workshop
 * picker (queued, spec 23 § 21b).
 */
export function JobPostForm() {
  const t = useTranslations('ustaad.jobs');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const ids = useId();
  const label = useCodeLabel();
  const errorText = useErrorText('jobs');
  const { sample } = useUstaad((c) => c.me(), 'me');
  const [role, setRole] = useState<JobRole>('mechanic_2w');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [areaLabel, setAreaLabel] = useState('');
  const [areaLabelHi, setAreaLabelHi] = useState('');
  const [payMin, setPayMin] = useState('');
  const [payMax, setPayMax] = useState('');
  const [timing, setTiming] = useState('');
  const [exp, setExp] = useState('0');
  const [segments, setSegments] = useState<UstaadSegmentCode[]>([]);
  const [adult, setAdult] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);
  const idem = useRef(newIdemKey());
  const doneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (posted) doneRef.current?.focus();
  }, [posted]);

  async function submit() {
    if (busy) return;
    const min = rupeesToPaise(payMin);
    const max = rupeesToPaise(payMax);
    const next: Partial<Record<Field, string>> = {};
    if (title.trim().length < 3) next.title = t('fieldNeed');
    if (description.trim().length < 10) next.description = t('fieldNeed');
    if (areaLabel.trim().length < 2) next.areaLabel = t('fieldNeed');
    if (timing.trim().length < 2) next.timing = t('fieldNeed');
    if (min === null || max === null || min > max) next.pay = t('payNeed');
    if (!adult) next.adult = t('err_USTAAD_ADULT_ATTESTATION');
    setErrors(next);
    setFormError(null);
    const firstBad = (['title', 'description', 'areaLabel', 'pay', 'timing', 'adult'] as const).find(
      (f) => next[f],
    );
    if (firstBad || min === null || max === null) {
      if (firstBad) document.getElementById(`${ids}-${firstBad}`)?.focus();
      return;
    }
    setBusy(true);
    const r = await (
      await ustaadClient(locale)
    ).postJob({
      employer: { kind: 'trade' },
      roleCode: role,
      title: title.trim(),
      description: description.trim(),
      areaLabel: areaLabel.trim(),
      areaLabelHi: areaLabelHi.trim() === '' ? null : areaLabelHi.trim(),
      payMinPaiseMonth: min,
      payMaxPaiseMonth: max,
      timing: timing.trim(),
      experienceMinYears: Math.max(0, Math.min(40, Number(exp) || 0)),
      segmentCodes: segments,
      adultAttested: adult,
      idemKey: idem.current,
    });
    setBusy(false);
    if (!r.ok) {
      setFormError(errorText(r.code));
      return;
    }
    setPosted(r.data.code);
  }

  const err = (f: Field) =>
    errors[f] ? (
      <p id={`${ids}-${f}-err`} className="text-sm font-bold text-error">
        {errors[f]}
      </p>
    ) : null;
  const a11y = (f: Field) => ({
    id: `${ids}-${f}`,
    'aria-required': true,
    'aria-invalid': errors[f] ? true : undefined,
    'aria-describedby': errors[f] ? `${ids}-${f}-err` : undefined,
  });

  if (posted)
    return (
      <div className="mx-auto grid max-w-2xl gap-5">
        <div
          ref={doneRef}
          tabIndex={-1}
          className={`${card} grid justify-items-center gap-3 text-center focus-visible:outline-3 focus-visible:outline-focus`}
        >
          <CheckCircle2 aria-hidden="true" className="size-10 text-success" />
          <p className="text-[16px] font-bold text-ink">{t('postedOk')}</p>
          <Link href={localePath(`/ustaad/jobs/${posted}`, locale)} className={btnPrimary}>
            {t('viewMine')}
          </Link>
        </div>
      </div>
    );

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header>
        <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
          {t('postH')}
        </h1>
        <p className="mt-1 text-[15px] leading-relaxed text-muted">{t('postIntro')}</p>
      </header>
      <ScamBanner />
      <SampleNote show={sample} />

      <form
        noValidate
        className={`${card} grid gap-5`}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-role`} className="text-sm font-bold text-ink">
            {t('roleL')}
          </label>
          <select
            id={`${ids}-role`}
            value={role}
            onChange={(e) => {
              setRole(e.target.value as JobRole);
            }}
            className={fieldClass}
          >
            {JOB_ROLES.map((r) => (
              <option key={r} value={r}>
                {l(`role_${r}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-title`} className="text-sm font-bold text-ink">
            {t('titleL')}
          </label>
          <input
            {...a11y('title')}
            value={title}
            maxLength={120}
            placeholder={t('titlePh')}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            className={fieldClass}
          />
          {err('title')}
        </div>

        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-description`} className="text-sm font-bold text-ink">
            {t('descL')}
          </label>
          <textarea
            {...a11y('description')}
            aria-describedby={[`${ids}-desc-help`, errors.description ? `${ids}-description-err` : '']
              .filter(Boolean)
              .join(' ')}
            value={description}
            rows={4}
            maxLength={2000}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            className={`${fieldClass} min-h-28`}
          />
          <p id={`${ids}-desc-help`} className="text-sm text-muted">
            {t('descHelp')}
          </p>
          {err('description')}
        </div>

        <div className="grid gap-4 min-[480px]:grid-cols-2">
          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-areaLabel`} className="text-sm font-bold text-ink">
              {t('areaL')}
            </label>
            <input
              {...a11y('areaLabel')}
              value={areaLabel}
              maxLength={80}
              onChange={(e) => {
                setAreaLabel(e.target.value);
              }}
              className={fieldClass}
            />
            {err('areaLabel')}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-areaHi`} className="text-sm font-bold text-ink">
              {t('areaHiL')}
            </label>
            <input
              id={`${ids}-areaHi`}
              lang="hi"
              value={areaLabelHi}
              maxLength={80}
              onChange={(e) => {
                setAreaLabelHi(e.target.value);
              }}
              className={fieldClass}
            />
          </div>
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-bold text-ink">{t('payH')}</legend>
          <div className="grid gap-4 min-[480px]:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor={`${ids}-pay`} className="text-sm text-ink">
                {t('payMinL')}
              </label>
              <input
                {...a11y('pay')}
                inputMode="numeric"
                value={payMin}
                onChange={(e) => {
                  setPayMin(e.target.value);
                }}
                className={fieldClass}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${ids}-payMax`} className="text-sm text-ink">
                {t('payMaxL')}
              </label>
              <input
                id={`${ids}-payMax`}
                inputMode="numeric"
                aria-invalid={errors.pay ? true : undefined}
                aria-describedby={errors.pay ? `${ids}-pay-err` : undefined}
                value={payMax}
                onChange={(e) => {
                  setPayMax(e.target.value);
                }}
                className={fieldClass}
              />
            </div>
          </div>
          {err('pay')}
        </fieldset>

        <div className="grid gap-4 min-[480px]:grid-cols-2">
          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-timing`} className="text-sm font-bold text-ink">
              {t('timingL')}
            </label>
            <input
              {...a11y('timing')}
              value={timing}
              maxLength={80}
              placeholder={t('timingPh')}
              onChange={(e) => {
                setTiming(e.target.value);
              }}
              className={fieldClass}
            />
            {err('timing')}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-exp`} className="text-sm font-bold text-ink">
              {t('expL')}
            </label>
            <input
              id={`${ids}-exp`}
              type="number"
              min={0}
              max={40}
              inputMode="numeric"
              value={exp}
              onChange={(e) => {
                setExp(e.target.value);
              }}
              className={fieldClass}
            />
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-bold text-ink">{t('vehiclesL')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {USTAAD_SEGMENT_CODES.map((s) => (
              <label
                key={s}
                className="press inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-line-card bg-surface px-4 text-[15px] font-bold text-ink has-checked:border-accent has-checked:bg-accent-soft has-checked:text-accent-soft-text"
              >
                <input
                  type="checkbox"
                  checked={segments.includes(s)}
                  onChange={(e) => {
                    setSegments((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)));
                  }}
                  className="size-5 accent-accent-button"
                />
                {label(s)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-1.5">
          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 border-line-card px-3 text-[15px] font-bold text-ink has-checked:border-success has-checked:bg-success-bg">
            <input
              {...a11y('adult')}
              type="checkbox"
              checked={adult}
              onChange={(e) => {
                setAdult(e.target.checked);
              }}
              className="size-6 accent-accent-button"
            />
            {t('adultL')}
          </label>
          {err('adult')}
        </div>

        <p role="alert" className="text-sm font-bold text-error empty:sr-only">
          {formError ?? ''}
        </p>
        <button
          type="submit"
          className={`${btnPrimary} min-h-14 text-base`}
          aria-disabled={busy}
          data-track="ustaad_job_post_send"
        >
          {busy ? t('posting') : t('postSend')}
        </button>
      </form>
    </div>
  );
}
