'use client';

import { BadgeCheck, Mic, Phone } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { ustaadClient, type ApplicantView } from '@/lib/ustaad/client';
import { applicantMoves, type ApplicantMove } from '@/lib/ustaad/local-view';
import { btnPrimary, btnQuiet, card, LoadFailed, LoadingBlock, useErrorText, useUstaad } from '../common';

/**
 * The employer's applicants on their own job (SIM-P18; spec 23 § 4 flow 11): name, level and the verified tick of
 * each applicant, newest first, with the moves the application machine allows. Hire and "not this time" are confirmed
 * inline first (no stacked dialogs). Messaging uses the existing flow: the member's card has the Message button.
 * Never a phone number: only the applicant's "share my number" choice.
 */
export function JobApplicants({ code }: { code: string }) {
  const t = useTranslations('ustaad.jobs');
  const c = useTranslations('ustaad.card');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const errorText = useErrorText('jobs');
  const { loaded, reload } = useUstaad((cl) => cl.applicants(code, null), `applicants:${code}`);
  const [items, setItems] = useState<ApplicantView[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; move: 'hire' | 'reject' } | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const tracked = useRef(false);

  useEffect(() => {
    if (loaded.state !== 'ok') return;
    setItems(loaded.data.items);
    setNext(loaded.data.next);
    if (!tracked.current) {
      tracked.current = true;
      track('ustaad_job_applicants_viewed', { count: loaded.data.items.length });
    }
  }, [loaded]);

  async function more() {
    if (!next) return;
    const r = await (await ustaadClient(locale)).applicants(code, next);
    if (!r.ok) {
      setStatus(errorText(r.code));
      return;
    }
    setItems((cur) => [...(cur ?? []), ...r.data.items]);
    setNext(r.data.next);
  }

  async function move(a: ApplicantView, m: ApplicantMove) {
    const r = await (await ustaadClient(locale)).moveApplication(a.applicationId, m);
    setConfirm(null);
    if (!r.ok) {
      setStatus(errorText(r.code));
      statusRef.current?.focus();
      return;
    }
    setItems((cur) =>
      (cur ?? []).map((x) =>
        x.applicationId === a.applicationId
          ? { ...x, status: r.data.status as ApplicantView['status'], version: x.version + 1 }
          : x,
      ),
    );
    setStatus(t('appMoved'));
    statusRef.current?.focus();
  }

  const nameOf = (a: ApplicantView) =>
    locale === 'hi' ? (a.member.displayNameHi ?? a.member.displayName) : a.member.displayName;

  return (
    <section aria-labelledby="ustaad-applicants-h" className={`${card} grid gap-4`}>
      <h2 id="ustaad-applicants-h" className="font-heading text-xl font-extrabold text-ink">
        {t('applicantsH')}
      </h2>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className="text-[15px] font-bold text-ink focus-visible:outline-3 focus-visible:outline-focus empty:sr-only"
      >
        {status}
      </p>
      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {items?.length === 0 ? <p className="text-[15px] text-muted">{t('applicantsEmpty')}</p> : null}
      {items && items.length > 0 ? (
        <ul className="grid gap-3">
          {items.map((a) => {
            const name = nameOf(a);
            const moves = applicantMoves(a.status);
            return (
              <li key={a.applicationId} className="grid gap-3 rounded-xl bg-surface-alt p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[16px] font-extrabold text-ink">
                      <span data-user-content>{name}</span>
                      {a.member.verified ? (
                        <span className="inline-flex items-center gap-1 text-sm font-bold text-success">
                          <BadgeCheck aria-hidden="true" className="size-4" />
                          {t('applicantVerified')}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted">
                      {c(`level_${a.member.level}` as 'level_naya')} ·{' '}
                      {t(`appStatus_${a.status}` as 'appStatus_applied')}
                    </p>
                  </div>
                </div>
                {a.sharePhone || a.voiceIntro ? (
                  <ul className="grid gap-1 text-sm text-ink">
                    {a.sharePhone ? (
                      <li className="flex items-center gap-2">
                        <Phone aria-hidden="true" className="size-4 shrink-0 text-accent-soft-text" />
                        {t('applicantSharePhone')}
                      </li>
                    ) : null}
                    {a.voiceIntro ? (
                      <li className="flex items-center gap-2">
                        <Mic aria-hidden="true" className="size-4 shrink-0 text-accent-soft-text" />
                        {t('applicantVoice')}
                      </li>
                    ) : null}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={localePath(`/ustaad/u/${encodeURIComponent(a.member.handle)}`, locale)}
                    className={btnQuiet}
                    data-track="ustaad_applicant_card"
                  >
                    {t('applicantMessage')}
                  </Link>
                  {moves.map((m) =>
                    m === 'hire' || m === 'reject' ? (
                      <button
                        key={m}
                        type="button"
                        className={m === 'hire' ? btnPrimary : btnQuiet}
                        onClick={() => {
                          setConfirm({ id: a.applicationId, move: m });
                        }}
                        data-track={`ustaad_applicant_${m}_open`}
                      >
                        {t(`app_${m}`)}
                      </button>
                    ) : (
                      <button
                        key={m}
                        type="button"
                        className={btnQuiet}
                        onClick={() => void move(a, m)}
                        data-track={`ustaad_applicant_${m}`}
                      >
                        {t(`app_${m}`)}
                      </button>
                    ),
                  )}
                </div>
                {confirm?.id === a.applicationId ? (
                  <div
                    role="group"
                    aria-labelledby={`ustaad-app-confirm-${a.applicationId}`}
                    className="grid gap-2 rounded-2xl bg-warning-bg p-4"
                  >
                    <p
                      id={`ustaad-app-confirm-${a.applicationId}`}
                      className="text-[15px] font-bold text-warning"
                    >
                      {confirm.move === 'hire' ? t('confirmHire') : t('confirmReject')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={btnPrimary}
                        onClick={() => void move(a, confirm.move)}
                        data-track={`ustaad_applicant_${confirm.move}_confirm`}
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
              </li>
            );
          })}
        </ul>
      ) : null}
      {next ? (
        <button
          type="button"
          className={btnQuiet}
          onClick={() => void more()}
          data-track="ustaad_applicants_more"
        >
          {t('applicantsMore')}
        </button>
      ) : null}
    </section>
  );
}
