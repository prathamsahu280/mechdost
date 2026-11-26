'use client';

import { CheckCircle2, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import {
  USTAAD_SEGMENT_CODES,
  USTAAD_WORK_CODES,
  type UstaadSegmentCode,
  type UstaadWorkCode,
} from '@mechdost/shared/ustaad/codes';
import { localePath } from '@/lib/locale-path';
import { ustaadClient } from '@/lib/ustaad/client';
import { newIdemKey } from '@/lib/ustaad/qa-view';
import { SmartCorrection, correctForSend, type CorrectionMeta } from '../correction/smart-correction';
import type { Recording } from '../media/voice-recorder';
import { UploadProgress } from '../media/upload-progress';
import { btnPrimary, card, fieldClass, SampleNote, useCodeLabel, useErrorText, useUstaad } from '../common';

/** The recorder (MediaRecorder code) loads only when the composer opens. */
const VoiceRecorder = dynamic(() => import('../media/voice-recorder').then((m) => m.VoiceRecorder), {
  ssr: false,
  loading: () => <div className="skeleton h-[76px] rounded-2xl" aria-hidden="true" />,
});

/** `qa.voice_max_s` default (spec 23 § 15); the API refuses anything longer, the recorder stops itself here. */
const VOICE_MAX_S = 90;

/**
 * The ask composer (spec 23 § 4 flow 3, § 5 `/ustaad/ask/new`): a full-height sheet on phones with a Close button.
 * Voice first (the big mic), or one typed line with smart correction, then the vehicle tiles and optional work chips,
 * then one primary action, "Send question". The voice note uploads on send with progress; a retried send reuses the
 * same idempotency key, so nothing is asked twice. No photo option yet: questions have no photo field in the API
 * (spec 23 § 21b, queued).
 */
export function AskComposer() {
  const t = useTranslations('ustaad.qa');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const label = useCodeLabel();
  const errorText = useErrorText('qa');
  const { sample } = useUstaad((c) => c.me(), 'me');
  const [voice, setVoice] = useState<Recording | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [meta, setMeta] = useState<CorrectionMeta>({ correction: 'none', original: null });
  const [segment, setSegment] = useState<UstaadSegmentCode | null>(null);
  const [work, setWork] = useState<UstaadWorkCode | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idem = useRef(newIdemKey());
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (sent) doneRef.current?.focus();
  }, [sent]);

  async function send() {
    if (busy) return;
    setError(null);
    setTitleError(false);
    if (!voice && title.trim() === '') {
      setTitleError(true);
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    const client = await ustaadClient(locale);
    let voiceMediaId: string | undefined;
    if (voice) {
      setProgress(0);
      const up = await client.upload(
        voice.blob,
        { kind: 'audio', mime: voice.mime, durationMs: voice.durationMs },
        setProgress,
      );
      if (!up.ok) {
        setBusy(false);
        setProgress(null);
        setError(
          t.has(`err_${up.code}` as 'err_USTAAD_MEDIA_INVALID')
            ? errorText(up.code)
            : errorText('USTAAD_MEDIA_INVALID'),
        );
        return;
      }
      voiceMediaId = up.data.mediaId;
    }
    const titleText = title.trim();
    let bodyText = body.trim();
    let correction = meta;
    if (bodyText !== '' && meta.correction === 'none') {
      const fixed = await correctForSend(locale, bodyText);
      bodyText = fixed.text;
      correction = fixed.meta;
    }
    const r = await client.ask({
      ...(titleText === '' ? {} : { title: titleText }),
      ...(bodyText === '' ? {} : { body: bodyText }),
      ...(correction.original ? { bodyOriginal: correction.original.slice(0, 2000) } : {}),
      correction: correction.correction,
      ...(voiceMediaId ? { voiceMediaId } : {}),
      ...(segment ? { segmentCode: segment } : {}),
      ...(work ? { workCode: work } : {}),
      idemKey: idem.current,
    });
    setBusy(false);
    setProgress(null);
    if (!r.ok) {
      setError(errorText(r.code));
      return;
    }
    setSent(r.data.code);
  }

  const close = localePath('/ustaad/ask', locale);

  return (
    <section
      aria-labelledby="ustaad-compose-title"
      className="mx-auto grid max-w-2xl gap-5 rounded-t-[26px] bg-surface p-4 shadow-dialog tab:rounded-[26px] tab:p-6"
    >
      <header className="flex items-center justify-between gap-3">
        <h1
          id="ustaad-compose-title"
          ref={heading}
          tabIndex={-1}
          className="font-heading text-[clamp(22px,4.6vw,28px)] font-extrabold text-ink outline-none"
        >
          {t('composeTitle')}
        </h1>
        <Link
          href={close}
          aria-label={l('close')}
          data-track="ustaad_compose_close"
          className="press inline-flex size-12 items-center justify-center rounded-full bg-pill text-ink hover:bg-line focus-visible:outline-3 focus-visible:outline-focus"
        >
          <X aria-hidden="true" className="size-6" />
        </Link>
      </header>

      <SampleNote show={sample} />

      {sent ? (
        <div ref={doneRef} tabIndex={-1} className={`${card} grid gap-3 text-center outline-none`}>
          <CheckCircle2 aria-hidden="true" className="mx-auto size-10 text-success" />
          <p className="text-[16px] leading-relaxed font-bold text-ink">{t('sent')}</p>
          <Link
            href={localePath(`/ustaad/q/${sent}`, locale)}
            className={`${btnPrimary} justify-self-center`}
            data-track="ustaad_compose_open_sent"
          >
            {t('openSent')}
          </Link>
        </div>
      ) : (
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="rounded-2xl bg-surface-alt p-4">
            <VoiceRecorder
              maxSeconds={VOICE_MAX_S}
              onChange={setVoice}
              label={t('voiceH')}
              hint={t('voiceHint')}
            />
          </div>

          <fieldset className="grid gap-3">
            <legend className="font-heading text-base font-extrabold text-ink">{t('typeH')}</legend>
            <div className="grid gap-1.5">
              <label htmlFor="ustaad-q-title" className="text-sm font-bold text-ink">
                {t('titleLabel')}
              </label>
              <input
                id="ustaad-q-title"
                ref={titleRef}
                value={title}
                maxLength={200}
                autoComplete="off"
                aria-invalid={titleError || undefined}
                aria-describedby={
                  titleError ? 'ustaad-q-title-err ustaad-q-title-help' : 'ustaad-q-title-help'
                }
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
                className={fieldClass}
              />
              {titleError ? (
                <p id="ustaad-q-title-err" className="text-sm font-bold text-error">
                  {t('sendNeed')}
                </p>
              ) : null}
              <p id="ustaad-q-title-help" className="text-sm text-muted">
                {t('titleHelp')} {voice ? t('titleOptional') : ''}
              </p>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="ustaad-q-body" className="text-sm font-bold text-ink">
                {t('detailsLabel')}
              </label>
              <textarea
                id="ustaad-q-body"
                ref={bodyRef}
                value={body}
                maxLength={2000}
                rows={3}
                onChange={(e) => {
                  setBody(e.target.value);
                  setMeta({ correction: 'none', original: null });
                }}
                className={`${fieldClass} min-h-24`}
              />
              <SmartCorrection
                value={body}
                fieldRef={bodyRef}
                onChange={(text, m) => {
                  setBody(text);
                  setMeta(m);
                }}
              />
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-heading text-base font-extrabold text-ink">{t('vehicleH')}</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 min-[480px]:grid-cols-3">
              {USTAAD_SEGMENT_CODES.map((s) => (
                <label
                  key={s}
                  className="press flex min-h-14 cursor-pointer items-center gap-2 rounded-2xl border border-line-card bg-surface px-3 text-[15px] font-bold text-ink has-checked:border-accent has-checked:bg-accent-soft has-checked:text-accent-soft-text has-focus-visible:outline-3 has-focus-visible:outline-focus"
                >
                  <input
                    type="radio"
                    name="segment"
                    value={s}
                    checked={segment === s}
                    onChange={() => {
                      setSegment(s);
                    }}
                    className="size-5 accent-accent-button"
                  />
                  {label(s)}
                </label>
              ))}
              <label className="press flex min-h-14 cursor-pointer items-center gap-2 rounded-2xl border border-line-card bg-surface px-3 text-[15px] font-bold text-ink has-checked:border-accent has-checked:bg-accent-soft has-checked:text-accent-soft-text has-focus-visible:outline-3 has-focus-visible:outline-focus">
                <input
                  type="radio"
                  name="segment"
                  value=""
                  checked={segment === null}
                  onChange={() => {
                    setSegment(null);
                  }}
                  className="size-5 accent-accent-button"
                />
                {t('anyVehicle')}
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-heading text-base font-extrabold text-ink">{t('workH')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {USTAAD_WORK_CODES.map((w) => (
                <label
                  key={w}
                  className="press inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-line-card bg-surface px-4 text-[15px] font-bold text-ink has-checked:border-accent has-checked:bg-accent-soft has-checked:text-accent-soft-text has-focus-visible:outline-3 has-focus-visible:outline-focus"
                >
                  <input
                    type="radio"
                    name="work"
                    value={w}
                    checked={work === w}
                    onChange={() => {
                      setWork(w);
                    }}
                    className="size-5 accent-accent-button"
                  />
                  {label(w)}
                </label>
              ))}
              <label className="press inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-line-card bg-surface px-4 text-[15px] font-bold text-ink has-checked:border-accent has-checked:bg-accent-soft has-checked:text-accent-soft-text has-focus-visible:outline-3 has-focus-visible:outline-focus">
                <input
                  type="radio"
                  name="work"
                  value=""
                  checked={work === null}
                  onChange={() => {
                    setWork(null);
                  }}
                  className="size-5 accent-accent-button"
                />
                {t('anyWork')}
              </label>
            </div>
          </fieldset>

          {segment === 'ev' ? (
            <p className="rounded-xl bg-error-bg px-3.5 py-2.5 text-sm font-bold text-error">
              {l('safetyNote_ev_hv')}
            </p>
          ) : null}

          {progress !== null ? <UploadProgress pct={progress} /> : null}
          <p role="alert" className="text-sm font-bold text-error empty:sr-only">
            {error ?? ''}
          </p>

          <button
            type="submit"
            className={`${btnPrimary} min-h-14 text-base`}
            aria-disabled={busy}
            data-track="ustaad_ask_send"
          >
            {busy ? t('sending') : t('send')}
          </button>
        </form>
      )}
    </section>
  );
}
