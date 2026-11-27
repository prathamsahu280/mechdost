'use client';

import { ArrowLeft, Award, BadgeCheck, ShieldAlert, ShoppingBag, ThumbsUp } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useId, useRef, useState } from 'react';
import type { AnswerView, QuestionDetail } from '@mechdost/shared/ustaad/dto/qa';
import { localePath } from '@/lib/locale-path';
import { ustaadClient } from '@/lib/ustaad/client';
import { newIdemKey } from '@/lib/ustaad/qa-view';
import { EditedText } from '../correction/edited-text';
import { SmartCorrection, correctForSend, type CorrectionMeta } from '../correction/smart-correction';
import { ListenButton } from '../media/listen-button';
import { UploadProgress } from '../media/upload-progress';
import { VoiceNote } from '../media/voice-note';
import type { Recording } from '../media/voice-recorder';
import {
  AuthorLine,
  btnPrimary,
  fieldClass,
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
const VOICE_MAX_S = 90;

/**
 * Question thread (spec 23 § 5 `/ustaad/q/[code]`): the question as a navy bubble at the top (voice note, Listen), the
 * safety note for brake, steering, fuel, airbag and EV tags, then answers as chat bubbles — the best answer first with
 * its badge and "Parts used in this fix" (links to MechDost Dukaan). Helpful on others' answers, "Mark as best" only for
 * the asker (the API decides through `can.chooseBest`), and the answer composer (voice or text) when `can.answer`.
 * The disclaimer sits under the answers. Every write is checked again by the API.
 */
export function QuestionThread({ code }: { code: string }) {
  const t = useTranslations('ustaad.qa');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const label = useCodeLabel();
  const ago = useTimeAgo();
  const errorText = useErrorText('qa');
  const { loaded, reload, refresh, sample, set } = useUstaad((c) => c.question(code), code);
  const [status, setStatus] = useState<string | null>(null);

  if (loaded.state === 'loading') return <LoadingBlock />;
  if (loaded.state === 'error')
    return loaded.status === 404 ? (
      <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-line-card bg-surface p-6 text-center">
        <p className="text-[15px] text-ink">{t('notFound')}</p>
        <Link href={localePath('/ustaad/ask', locale)} className={`${btnPrimary} mt-4`}>
          {t('backToList')}
        </Link>
      </div>
    ) : (
      <LoadFailed message={errorText(loaded.code)} onRetry={reload} />
    );

  const q = loaded.data;
  const answers = [...q.answerList].sort((a, b) => Number(b.isBest) - Number(a.isBest));
  const readAloud = [q.title, q.body].filter((x): x is string => x !== null).join('. ');

  async function vote(a: AnswerView) {
    const r = await (await ustaadClient(locale)).helpful(a.id);
    if (!r.ok) {
      setStatus(errorText(r.code));
      return;
    }
    set({
      ...q,
      answerList: q.answerList.map((x) =>
        x.id === a.id ? { ...x, helpfulCount: r.data.helpfulCount, votedByMe: r.data.voted } : x,
      ),
    });
    setStatus(t('helpfulDone'));
  }

  async function chooseBest(a: AnswerView) {
    const r = await (await ustaadClient(locale)).best(q.code, a.id);
    if (!r.ok) {
      setStatus(errorText(r.code));
      return;
    }
    setStatus(t('bestDone'));
    refresh();
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <Link
        href={localePath('/ustaad/ask', locale)}
        className="press inline-flex min-h-12 items-center gap-2 justify-self-start rounded-full pr-4 text-[15px] font-bold text-ink hover:text-accent-soft-text"
        data-track="ustaad_thread_back"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
        {t('backToList')}
      </Link>

      <SampleNote show={sample} />

      <article
        aria-labelledby="ustaad-q-h"
        className="rounded-[22px] rounded-tl-md bg-navy p-5 text-white shadow-float"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/80">
          {q.mine ? (
            <span className="font-bold text-white">{l('you')}</span>
          ) : (
            <AuthorLine author={q.asker} tone="light" />
          )}
          <time dateTime={q.createdAt}>{ago(q.createdAt)}</time>
        </div>
        <h1
          id="ustaad-q-h"
          className="mt-3 font-heading text-[clamp(20px,4.4vw,26px)] leading-snug font-extrabold"
        >
          {q.title === null ? t('voiceQuestion') : <span data-user-content>{q.title}</span>}
        </h1>
        {q.body !== null ? (
          <div className="mt-2 text-[15px] leading-relaxed text-white/90">
            <EditedText body={q.body} bodyOriginal={q.bodyOriginal} />
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {q.voiceMediaId ? (
            <VoiceNote
              mediaId={q.voiceMediaId}
              tone="dark"
              info={{
                ...q.voice,
                fromName:
                  locale === 'hi' ? (q.asker.displayNameHi ?? q.asker.displayName) : q.asker.displayName,
              }}
            />
          ) : null}
          {readAloud !== '' ? (
            <span className="rounded-full bg-surface">
              <ListenButton text={readAloud} />
            </span>
          ) : null}
        </div>
        <ul className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          {[label(q.segmentCode), label(q.workCode), q.vehicleModel].map((x, i) =>
            x ? (
              <li key={i} className="rounded-full bg-white/12 px-2.5 py-1">
                {i === 2 ? <span data-user-content>{x}</span> : x}
              </li>
            ) : null,
          )}
        </ul>
      </article>

      {q.safetyTag ? (
        <p className="flex items-start gap-3 rounded-2xl border border-error/30 bg-error-bg p-4 text-[15px] leading-relaxed text-error">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
          <span>
            <strong className="font-extrabold">{l('safetyTitle')}: </strong>
            {l(`safetyNote_${q.safetyTag}` as 'safetyNote_brake')}
          </span>
        </p>
      ) : null}

      <section aria-labelledby="ustaad-answers-h" className="grid gap-3">
        <h2 id="ustaad-answers-h" className="font-heading text-lg font-extrabold text-ink">
          {t('answersH', { n: answers.length })}
        </h2>
        {answers.length === 0 ? <p className="text-[15px] text-muted">{t('noAnswers')}</p> : null}
        <ul className="grid gap-3">
          {answers.map((a) => (
            <li key={a.id}>
              <AnswerBubble
                a={a}
                canChooseBest={q.can.chooseBest && !a.mine}
                onVote={() => void vote(a)}
                onBest={() => void chooseBest(a)}
              />
            </li>
          ))}
        </ul>
        <p role="status" className="text-sm font-bold text-ink empty:sr-only">
          {status ?? ''}
        </p>
        <p className="text-sm leading-relaxed text-muted">{t('disclaimer')}</p>
      </section>

      {q.can.answer ? (
        <AnswerComposer q={q} onPosted={refresh} />
      ) : q.mine ? null : (
        <p className="rounded-2xl bg-surface-alt p-4 text-[15px] leading-relaxed text-ink">
          {t('onlyUstaad')}
        </p>
      )}
    </div>
  );
}

function AnswerBubble({
  a,
  canChooseBest,
  onVote,
  onBest,
}: {
  a: AnswerView;
  canChooseBest: boolean;
  onVote: () => void;
  onBest: () => void;
}) {
  const t = useTranslations('ustaad.qa');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const ago = useTimeAgo();
  const stampId = useId();
  // U3 (E9): "Choose as best" asks once, inline (no dialog): "Make this the best answer? [Yes, choose] [Not now]".
  const [confirming, setConfirming] = useState(false);
  const chooseRef = useRef<HTMLButtonElement>(null);
  // Stable, so a parent re-render does not pull focus back to the confirm.
  const focusOnMount = useCallback((el: HTMLButtonElement | null) => {
    el?.focus();
  }, []);
  return (
    <article
      aria-labelledby={a.isBest ? stampId : undefined}
      className={`rounded-[22px] rounded-tr-md border p-4 shadow-card ${
        a.isBest
          ? 'border-success/40 bg-success-bg shadow-[inset_3px_0_0_var(--color-success)]'
          : a.mine
            ? 'border-accent/30 bg-accent-soft'
            : 'border-line-card bg-surface'
      }`}
    >
      {a.isBest ? (
        // The stamp says who chose it (R23, RS4): the asker, never a vote count.
        <p
          id={stampId}
          // Bench kit stamp (visual language § 3.5/4): radius 6, 2 px border + 1 px outline 2 px out, −2°.
          className="mb-3 ml-1 inline-flex -rotate-2 items-center gap-1.5 rounded-[6px] border-2 border-success bg-success-bg px-3 py-1 text-[13px] font-extrabold text-success outline-1 outline-offset-2 outline-success"
        >
          <BadgeCheck aria-hidden="true" className="size-4" />
          {t('bestStamp')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        {a.mine ? <span className="font-bold text-ink">{l('you')}</span> : <AuthorLine author={a.author} />}
        <time dateTime={a.createdAt}>{ago(a.createdAt)}</time>
      </div>
      {a.body !== null ? (
        <div className="mt-2 text-[15.5px] leading-relaxed text-ink">
          <EditedText body={a.body} bodyOriginal={a.bodyOriginal} />
        </div>
      ) : null}
      {a.voiceMediaId ? (
        <div className="mt-3">
          <VoiceNote
            mediaId={a.voiceMediaId}
            info={{
              ...a.voice,
              mine: a.mine,
              fromName:
                locale === 'hi' ? (a.author.displayNameHi ?? a.author.displayName) : a.author.displayName,
            }}
          />
        </div>
      ) : null}
      {a.isBest && a.parts.length > 0 ? (
        <div className="mt-4 rounded-2xl bg-surface p-3">
          <p className="text-sm font-extrabold text-ink">{t('partsH')}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {a.parts.map((p) => (
              <li key={p.productId}>
                <Link
                  href={localePath(`/shop/${p.slug}`, locale)}
                  data-track="ustaad_part_open"
                  className="press inline-flex min-h-12 items-center gap-2 rounded-full border border-line-card bg-surface px-4 text-sm font-bold text-ink hover:border-accent"
                >
                  <ShoppingBag aria-hidden="true" className="size-4 text-accent-soft-text" />
                  {locale === 'hi' && p.nameHi ? p.nameHi : p.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{t('partsFrom')}</p>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {a.body !== null ? <ListenButton text={a.body} /> : null}
        {a.mine ? null : (
          <button
            type="button"
            onClick={() => {
              if (!a.votedByMe) onVote();
            }}
            aria-pressed={a.votedByMe}
            data-track="ustaad_answer_helpful"
            className="press inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-card bg-surface px-4 text-sm font-bold text-ink hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-text focus-visible:outline-3 focus-visible:outline-focus"
          >
            <ThumbsUp aria-hidden="true" className="size-4" />
            <span>{t('helpfulCount', { n: a.helpfulCount })}</span>
          </button>
        )}
        {a.mine && a.helpfulCount > 0 ? (
          <span className="text-sm font-bold text-muted">{t('helpfulCount', { n: a.helpfulCount })}</span>
        ) : null}
        {canChooseBest && !confirming ? (
          <button
            ref={chooseRef}
            type="button"
            onClick={() => {
              setConfirming(true);
            }}
            data-track="ustaad_answer_best_ask"
            className="press inline-flex min-h-11 items-center gap-1.5 rounded-full border border-input-border bg-surface px-4 text-sm font-bold text-ink hover:border-accent focus-visible:outline-3 focus-visible:outline-focus"
          >
            <Award aria-hidden="true" className="size-4" />
            {t('chooseBest')}
          </button>
        ) : null}
      </div>
      {canChooseBest && confirming ? (
        <div
          role="group"
          aria-label={t('chooseBestConfirm')}
          className="mt-3 grid gap-2 rounded-2xl bg-surface-alt p-3"
        >
          <p className="text-[15px] font-bold text-ink">{t('chooseBestConfirm')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              // Focus moves to the confirm the member just asked for (and back to "Choose as best" on Not now).
              ref={focusOnMount}
              onClick={() => {
                setConfirming(false);
                onBest();
              }}
              data-track="ustaad_answer_best"
              className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {t('confirmYes')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                window.setTimeout(() => chooseRef.current?.focus(), 0);
              }}
              data-track="ustaad_answer_best_cancel"
              className="press inline-flex min-h-11 items-center rounded-button border border-input-border bg-surface px-4 text-sm font-bold text-ink focus-visible:outline-3 focus-visible:outline-focus"
            >
              {t('confirmNo')}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function AnswerComposer({ q, onPosted }: { q: QuestionDetail; onPosted: () => void }) {
  const t = useTranslations('ustaad.qa');
  const locale = useLocale();
  const errorText = useErrorText('qa');
  const uploadError = useUploadErrorText('qa');
  const [voice, setVoice] = useState<Recording | null>(null);
  const [text, setText] = useState('');
  const [meta, setMeta] = useState<CorrectionMeta>({ correction: 'none', original: null });
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [need, setNeed] = useState(false);
  const [round, setRound] = useState(0);
  const idem = useRef(newIdemKey());
  const field = useRef<HTMLTextAreaElement>(null);

  async function post() {
    if (busy) return;
    setMsg(null);
    if (!voice && text.trim() === '') {
      setNeed(true);
      field.current?.focus();
      return;
    }
    setBusy(true);
    const client = await ustaadClient(locale);
    let voiceMediaId: string | undefined;
    if (voice) {
      setProgress(0);
      const up = await client.upload(
        voice.blob,
        { kind: 'audio', mime: voice.mime, durationMs: voice.durationMs, summary: voice.summary },
        setProgress,
      );
      if (!up.ok) {
        setBusy(false);
        setProgress(null);
        setMsg({
          kind: 'error',
          text: up.code.startsWith('MEDIA_') ? uploadError(up.code) : errorText('USTAAD_MEDIA_INVALID'),
        });
        return;
      }
      voiceMediaId = up.data.mediaId;
    }
    let body = text.trim();
    let m = meta;
    if (body !== '' && meta.correction === 'none') {
      const fixed = await correctForSend(locale, body);
      body = fixed.text;
      m = fixed.meta;
    }
    const r = await client.answer(q.code, {
      ...(body === '' ? {} : { body }),
      ...(m.original ? { bodyOriginal: m.original.slice(0, 2000) } : {}),
      correction: m.correction,
      ...(voiceMediaId ? { voiceMediaId } : {}),
      idemKey: idem.current,
    });
    setBusy(false);
    setProgress(null);
    if (!r.ok) {
      setMsg({ kind: 'error', text: errorText(r.code) });
      return;
    }
    idem.current = newIdemKey();
    setText('');
    setVoice(null);
    setRound((n) => n + 1);
    setMsg({ kind: 'ok', text: t('answerPosted') });
    onPosted();
  }

  return (
    <section
      aria-labelledby="ustaad-answer-h"
      className="grid gap-4 rounded-2xl border border-line-card bg-surface p-4 shadow-card"
    >
      <h2 id="ustaad-answer-h" className="font-heading text-lg font-extrabold text-ink">
        {t('yourAnswerH')}
      </h2>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void post();
        }}
      >
        <VoiceRecorder
          key={round}
          maxSeconds={VOICE_MAX_S}
          onChange={setVoice}
          label={t('speakAnswer')}
          hint=""
        />
        <div className="grid gap-1.5">
          <label htmlFor="ustaad-answer" className="text-sm font-bold text-ink">
            {t('answerLabel')}
          </label>
          <textarea
            id="ustaad-answer"
            ref={field}
            value={text}
            rows={3}
            aria-invalid={need || undefined}
            aria-describedby={need ? 'ustaad-answer-err' : undefined}
            maxLength={2000}
            onChange={(e) => {
              setText(e.target.value);
              setNeed(false);
              setMeta({ correction: 'none', original: null });
            }}
            className={`${fieldClass} min-h-24`}
          />
          {need ? (
            <p id="ustaad-answer-err" className="text-sm font-bold text-error">
              {t('answerNeed')}
            </p>
          ) : null}
          <SmartCorrection
            value={text}
            fieldRef={field}
            onChange={(next, m) => {
              setText(next);
              setMeta(m);
            }}
          />
        </div>
        {progress !== null ? <UploadProgress pct={progress} /> : null}
        <p
          role="status"
          className={`text-sm font-bold empty:sr-only ${msg?.kind === 'error' ? 'text-error' : 'text-success'}`}
        >
          {msg?.text ?? ''}
        </p>
        <button
          type="submit"
          className={`${btnPrimary} min-h-14`}
          aria-disabled={busy}
          data-track="ustaad_answer_post"
        >
          {t('postAnswer')}
        </button>
      </form>
    </section>
  );
}
