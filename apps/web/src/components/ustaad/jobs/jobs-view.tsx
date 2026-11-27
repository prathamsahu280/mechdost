'use client';

import {
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  Clock,
  IndianRupee,
  MapPin,
  Plus,
  ShieldAlert,
  X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { JOB_ROLES } from '@mechdost/shared/ustaad/codes';
import { formatDate } from '@/lib/format';
import { localePath } from '@/lib/locale-path';
import { ustaadClient, type Job, type JobRole } from '@/lib/ustaad/client';
import { payRangeText } from '@/lib/ustaad/local-view';
import type { Recording } from '../media/voice-recorder';
import { UploadProgress } from '../media/upload-progress';
import { JobApplicants } from './job-applicants';
import {
  btnPrimary,
  btnQuiet,
  card,
  LoadFailed,
  LoadingBlock,
  SampleNote,
  useCodeLabel,
  useErrorText,
  useTimeAgo,
  useUstaad,
} from '../common';
import { useUploadErrorText } from '../media/upload-error';

const VoiceRecorder = dynamic(() => import('../media/voice-recorder').then((m) => m.VoiceRecorder), {
  ssr: false,
  loading: () => <div className="skeleton h-[76px] rounded-2xl" aria-hidden="true" />,
});
/** A voice intro is short (the prototype's 30 seconds). */
const INTRO_MAX_S = 30;

/** "MechDost never asks for money for a job" — on every job screen (spec 23 § 4 flow 11). */
export function ScamBanner() {
  const t = useTranslations('ustaad.jobs');
  return (
    <p
      role="note"
      className="flex items-start gap-3 rounded-2xl border border-warning-line bg-warning-bg p-4 text-[15px] leading-relaxed font-bold text-warning"
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
      {t('scam')}
    </p>
  );
}

function useJobArea() {
  const locale = useLocale();
  return (j: Job) => (locale === 'hi' && j.areaLabelHi ? j.areaLabelHi : j.areaLabel);
}

/** Jobs list (spec 23 § 5 `/ustaad/jobs`): role filter as links, newest first, "Show more" by cursor. */
export function JobsList({ role }: { role: JobRole | null }) {
  const t = useTranslations('ustaad.jobs');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const errorText = useErrorText('jobs');
  const area = useJobArea();
  const ago = useTimeAgo();
  const key = role ?? 'all';
  const { loaded, reload, sample } = useUstaad((c) => c.jobs(role, null), key);
  const [more, setMore] = useState<{ key: string; items: Job[]; next: string | null } | null>(null);
  const extra = more?.key === key ? more : null;
  const first = loaded.state === 'ok' ? loaded.data : null;
  const items = [...(first?.items ?? []), ...(extra?.items ?? [])];
  const next = extra ? extra.next : (first?.next ?? null);

  async function loadMore() {
    if (!next) return;
    const r = await (await ustaadClient(locale)).jobs(role, next);
    if (r.ok) setMore({ key, items: [...(extra?.items ?? []), ...r.data.items], next: r.data.next });
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
          {t('title')}
        </h1>
        <Link
          href={localePath('/ustaad/jobs/new', locale)}
          className={btnQuiet}
          data-track="ustaad_job_post_open"
        >
          <Plus aria-hidden="true" className="size-5" />
          {t('postCta')}
        </Link>
      </header>
      <ScamBanner />

      <nav aria-label={t('filterLabel')} className="-mx-4 overflow-x-auto px-4 tab:mx-0 tab:px-0">
        <ul className="flex w-max gap-2">
          {[null, ...JOB_ROLES].map((r) => (
            <li key={r ?? 'all'}>
              <Link
                href={localePath(r ? `/ustaad/jobs?role=${r}` : '/ustaad/jobs', locale)}
                aria-current={r === role ? 'page' : undefined}
                scroll={false}
                data-track="ustaad_jobs_filter"
                className={`inline-flex min-h-12 items-center rounded-full px-5 text-[15px] font-bold whitespace-nowrap ${
                  r === role
                    ? 'bg-navy text-white'
                    : 'border border-line-card bg-surface text-ink hover:border-accent'
                }`}
              >
                {r ? l(`role_${r}`) : t('allRoles')}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <SampleNote show={sample} />
      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {loaded.state === 'ok' && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-card bg-surface p-6 text-center">
          <p className="text-[15px] text-ink">{t('empty')}</p>
        </div>
      ) : null}
      {items.length > 0 ? (
        <ul className="grid gap-3">
          {items.map((j) => (
            <li key={j.code}>
              <Link
                href={localePath(`/ustaad/jobs/${j.code}`, locale)}
                data-track="ustaad_job_open"
                className="press block rounded-2xl border border-line-card bg-surface p-4 shadow-card hover:border-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-accent-soft-text">{l(`role_${j.roleCode}`)}</p>
                    <p
                      data-user-content
                      className="mt-1 font-heading text-[17px] leading-snug font-extrabold text-ink"
                    >
                      {j.title}
                    </p>
                  </div>
                  {j.mine ? (
                    <span className="shrink-0 rounded-full bg-pill px-2.5 py-1 text-xs font-bold text-ink">
                      {t('mine')}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 font-heading text-lg font-extrabold text-success">
                  {payRangeText(j.payMinPaiseMonth, j.payMaxPaiseMonth)}{' '}
                  <span className="text-sm font-bold text-muted">/ {t('perMonth')}</span>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span className="inline-flex items-center gap-1">
                    <MapPin aria-hidden="true" className="size-4" />
                    <span data-user-content>{area(j)}</span>
                  </span>
                  <span>{t('expYears', { n: j.experienceMinYears })}</span>
                  <time dateTime={j.createdAt}>{ago(j.createdAt)}</time>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {next ? (
        <button type="button" className={`${btnQuiet} justify-self-center`} onClick={() => void loadMore()}>
          {t('loadMore')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Job detail (spec 23 § 5 `/ustaad/jobs/[code]`): the scam banner first, pay, timing, experience, area, vehicles, the
 * employer's 18+ confirmation, then one primary action: "Apply with my card" (a sheet: share phone only if ticked,
 * optional voice intro). The employer sees their own job with its status and pause / open again / filled / close.
 */
export function JobDetail({ code }: { code: string }) {
  const t = useTranslations('ustaad.jobs');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const label = useCodeLabel();
  const area = useJobArea();
  const errorText = useErrorText('jobs');
  const { loaded, reload, sample, set } = useUstaad((c) => c.job(code), code);
  const [applied, setApplied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [confirm, setConfirm] = useState<'close' | 'fill' | null>(null);

  if (loaded.state === 'loading') return <LoadingBlock />;
  if (loaded.state === 'error')
    return loaded.status === 404 ? (
      <div className="mx-auto grid max-w-2xl gap-4">
        <ScamBanner />
        <div className="rounded-2xl border border-dashed border-line-card bg-surface p-6 text-center">
          <p className="text-[15px] text-ink">{errorText('NOT_FOUND')}</p>
          <Link href={localePath('/ustaad/jobs', locale)} className={`${btnPrimary} mt-4`}>
            {t('backToList')}
          </Link>
        </div>
      </div>
    ) : (
      <LoadFailed message={errorText(loaded.code)} onRetry={reload} />
    );

  const j = loaded.data;
  const vehicles = j.segmentCodes.map((s) => label(s)).filter((x): x is string => x !== null);

  async function move(action: 'pause' | 'resume' | 'close' | 'fill') {
    const r = await (await ustaadClient(locale)).moveJob(j.code, action);
    if (!r.ok) {
      setStatus(errorText(r.code));
      return;
    }
    set({ ...j, status: r.data.status });
    setStatus(t('moved'));
    setConfirm(null);
    statusRef.current?.focus();
  }

  const facts: { icon: typeof Clock; label: string; value: string; user?: boolean }[] = [
    {
      icon: IndianRupee,
      label: t('payH'),
      value: `${payRangeText(j.payMinPaiseMonth, j.payMaxPaiseMonth)} / ${t('perMonth')}`,
    },
    { icon: Clock, label: t('timeH'), value: j.timing, user: true },
    { icon: Briefcase, label: t('expH'), value: t('expYears', { n: j.experienceMinYears }) },
    { icon: MapPin, label: t('areaH'), value: area(j), user: true },
  ];

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <Link
        href={localePath('/ustaad/jobs', locale)}
        className="press inline-flex min-h-12 items-center gap-2 justify-self-start text-[15px] font-bold text-ink hover:text-accent-soft-text"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
        {t('backToList')}
      </Link>
      <ScamBanner />
      <SampleNote show={sample} />

      <article aria-labelledby="ustaad-job-h" className={`${card} grid gap-4`}>
        <div>
          <p className="text-sm font-bold text-accent-soft-text">{l(`role_${j.roleCode}`)}</p>
          <h1
            id="ustaad-job-h"
            data-user-content
            className="mt-1 font-heading text-[clamp(22px,4.6vw,28px)] leading-snug font-extrabold text-ink"
          >
            {j.title}
          </h1>
          {j.mine ? (
            <p className="mt-2 inline-flex rounded-full bg-pill px-3 py-1 text-sm font-bold text-ink">
              {t('mine')} · {t(`status_${j.status}` as 'status_open')}
            </p>
          ) : null}
        </div>
        {j.underReview ? (
          <p className="rounded-xl bg-info-bg p-3 text-sm font-bold text-info">{t('underReview')}</p>
        ) : null}
        <dl className="grid gap-3 min-[480px]:grid-cols-2">
          {facts.map((f) => (
            <div key={f.label} className="grid min-w-0 gap-0.5 rounded-xl bg-surface-alt p-3">
              <dt className="flex items-center gap-2 text-xs font-bold text-muted">
                <f.icon aria-hidden="true" className="size-4 shrink-0 text-accent-soft-text" />
                {f.label}
              </dt>
              <dd
                className="text-[15px] font-bold text-ink"
                {...(f.user ? { 'data-user-content': true } : {})}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
        {vehicles.length > 0 ? (
          <div>
            <p className="text-xs font-bold text-muted">{t('vehiclesH')}</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {vehicles.map((v) => (
                <li key={v} className="rounded-full bg-surface-alt px-3 py-1 text-sm font-bold text-ink">
                  {v}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p data-user-content className="text-[15.5px] leading-relaxed whitespace-pre-line text-ink">
          {j.description}
        </p>
        <p className="flex items-start gap-2 text-sm text-ink">
          <BadgeCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          {t('adultOnly')}
        </p>
        <p className="text-sm text-muted">{t('openTill', { date: formatDate(j.expiresAt, locale) })}</p>
      </article>

      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className="text-[15px] font-bold text-ink focus-visible:outline-3 focus-visible:outline-focus empty:sr-only"
      >
        {applied ? t('appSent') : (status ?? '')}
      </p>

      {j.mine ? (
        <div className="flex flex-wrap gap-2">
          {j.status === 'open' ? (
            <button
              type="button"
              className={btnQuiet}
              onClick={() => void move('pause')}
              data-track="ustaad_job_pause"
            >
              {t('act_pause')}
            </button>
          ) : null}
          {j.status === 'paused' ? (
            <button
              type="button"
              className={btnQuiet}
              onClick={() => void move('resume')}
              data-track="ustaad_job_resume"
            >
              {t('act_resume')}
            </button>
          ) : null}
          {j.status === 'open' || j.status === 'paused' ? (
            <>
              <button
                type="button"
                className={btnQuiet}
                onClick={() => {
                  setConfirm('fill');
                }}
                data-track="ustaad_job_fill"
              >
                {t('act_fill')}
              </button>
              <button
                type="button"
                className={btnQuiet}
                onClick={() => {
                  setConfirm('close');
                }}
                data-track="ustaad_job_close"
              >
                {t('act_close')}
              </button>
            </>
          ) : null}
          {confirm ? (
            <div
              role="group"
              aria-labelledby="ustaad-job-confirm"
              className="grid w-full gap-2 rounded-2xl bg-warning-bg p-4"
            >
              <p id="ustaad-job-confirm" className="text-[15px] font-bold text-warning">
                {confirm === 'close' ? t('confirmClose') : t('confirmFill')}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => void move(confirm)}
                  data-track={`ustaad_job_${confirm}_confirm`}
                >
                  {t('confirmYes')}
                </button>
                <button
                  type="button"
                  className={btnQuiet}
                  onClick={() => {
                    setConfirm(null);
                  }}
                >
                  {l('cancel')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : j.status === 'open' && !applied ? (
        <button
          ref={opener}
          type="button"
          className={`${btnPrimary} min-h-14 text-base`}
          onClick={() => {
            setSheet(true);
          }}
          data-track="ustaad_job_apply_open"
        >
          {t('apply')}
        </button>
      ) : null}

      {j.mine && !j.underReview ? <JobApplicants code={j.code} /> : null}

      {sheet ? (
        <ApplySheet
          code={j.code}
          onClose={(done) => {
            setSheet(false);
            if (done) {
              setApplied(true);
              requestAnimationFrame(() => statusRef.current?.focus());
            } else opener.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/** The apply sheet: a native modal dialog (focus kept inside, Escape closes, focus returns to "Apply"). */
function ApplySheet({ code, onClose }: { code: string; onClose: (applied: boolean) => void }) {
  const t = useTranslations('ustaad.jobs');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const errorText = useErrorText('jobs');
  const uploadError = useUploadErrorText('jobs');
  const dialog = useRef<HTMLDialogElement>(null);
  const [sharePhone, setSharePhone] = useState(false);
  const [intro, setIntro] = useState<Recording | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const client = await ustaadClient(locale);
    let voiceIntroMediaId: string | null = null;
    if (intro) {
      setPct(0);
      const up = await client.upload(
        intro.blob,
        { kind: 'audio', mime: intro.mime, durationMs: intro.durationMs, summary: intro.summary },
        setPct,
      );
      setPct(null);
      if (!up.ok) {
        setBusy(false);
        setError(uploadError(up.code));
        return;
      }
      voiceIntroMediaId = up.data.mediaId;
    }
    const r = await client.apply(code, { sharePhone, voiceIntroMediaId });
    setBusy(false);
    if (!r.ok) {
      setError(r.status === 409 ? errorText('CONFLICT') : errorText(r.code));
      return;
    }
    dialog.current?.close();
    onClose(true);
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="ustaad-apply-h"
      onCancel={(e) => {
        e.preventDefault();
        dialog.current?.close();
        onClose(false);
      }}
      className="m-0 mt-auto max-h-[92dvh] overscroll-contain w-full max-w-none rounded-t-[26px] bg-surface p-0 text-ink shadow-dialog backdrop:bg-navy/50 tab:m-auto tab:max-w-lg tab:rounded-[26px]"
    >
      <div className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="ustaad-apply-h" className="font-heading text-xl font-extrabold">
            {t('applyH')}
          </h2>
          <button
            type="button"
            aria-label={l('close')}
            onClick={() => {
              dialog.current?.close();
              onClose(false);
            }}
            className="press inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-pill text-ink focus-visible:outline-3 focus-visible:outline-focus"
          >
            <X aria-hidden="true" className="size-6" />
          </button>
        </div>
        <p className="text-[15px] leading-relaxed text-muted">{t('applySub')}</p>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line-card px-3 text-[15px] font-bold has-checked:border-accent has-checked:bg-accent-soft">
          <input
            type="checkbox"
            checked={sharePhone}
            onChange={(e) => {
              setSharePhone(e.target.checked);
            }}
            className="size-5 accent-accent-button"
          />
          {t('sharePhone')}
        </label>
        <div className="rounded-2xl bg-surface-alt p-4">
          <VoiceRecorder maxSeconds={INTRO_MAX_S} onChange={setIntro} label={t('voiceIntro')} hint="" />
        </div>
        {pct !== null ? <UploadProgress pct={pct} /> : null}
        <p role="alert" className="text-sm font-bold text-error empty:sr-only">
          {error ?? ''}
        </p>
        <button
          type="button"
          className={`${btnPrimary} min-h-14`}
          aria-disabled={busy}
          onClick={() => void send()}
          data-track="ustaad_job_apply_send"
        >
          {busy ? t('sending') : t('sendApp')}
        </button>
      </div>
    </dialog>
  );
}
