'use client';

import { Mic, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { clockText, isHold, pickRecorderMime, recordedMs } from '@/lib/ustaad/media-core';
import { grantVoiceConsent, voiceConsentState } from '@/lib/ustaad/voice-consent';

export interface Recording {
  blob: Blob;
  /** The plain MIME the API accepts (`audio/webm`, `audio/ogg`, `audio/mp4`). */
  mime: string;
  durationMs: number;
}

type State = 'idle' | 'recording' | 'done' | 'denied' | 'unsupported';
const MIN_MS = 700;

const quiet =
  'press inline-flex min-h-12 items-center justify-center gap-2 rounded-button border border-input-border bg-surface px-4 text-[15px] font-bold text-ink hover:bg-pill focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Hold-to-talk voice note (spec 23 § 4 flow 3; audio only, no speech-to-text). Hold the big mic and speak, let go to
 * finish (WhatsApp habit); or tap once to start and tap again to stop (single-pointer alternative, keyboard and screen
 * readers use the same button). A timer runs while recording and the note stops by itself at `maxSeconds`. After
 * recording: play it back (native controls), record again, or remove it. Nothing uploads here; the composer uploads on
 * send. Loaded on demand by the composers (never in a storefront bundle).
 */
export function VoiceRecorder({
  maxSeconds,
  onChange,
  label,
  hint,
}: {
  maxSeconds: number;
  onChange: (rec: Recording | null) => void;
  /** Visible heading next to the mic ("Speak your question"). */
  label: string;
  hint: string;
}) {
  const t = useTranslations('ustaad.media');
  const locale = useLocale();
  const hintId = useId();
  // SIM-P10: the ustaad_voice consent is asked once, before the first recording (the version guards the save).
  const [ask, setAsk] = useState<{ version: number } | null>(null);
  const [consentNote, setConsentNote] = useState<'ready' | 'failed' | null>(null);
  const allowBtn = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<State>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<'tooShort' | null>(null);
  const [rec, setRec] = useState<{ url: string; durationMs: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);
  const pressAt = useRef(0);
  const pointerStarted = useRef(false);
  const suppressClick = useRef(false);
  const timer = useRef<number | null>(null);
  const mic = useRef<HTMLButtonElement>(null);
  const donePanel = useRef<HTMLDivElement>(null);
  const focusMic = useRef(false);
  const cancelStart = useRef(false);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((tr) => {
        tr.stop();
      });
    },
    [],
  );
  useEffect(
    () => () => {
      if (rec) URL.revokeObjectURL(rec.url);
    },
    [rec],
  );

  async function start() {
    setNote(null);
    const consent = await voiceConsentState(locale);
    if (consent.ask && consent.version !== null) {
      // Nothing is recorded until the member allows voice notes; a hold that is still down is let go.
      pointerStarted.current = false;
      cancelStart.current = false;
      setConsentNote(null);
      setAsk({ version: consent.version });
      requestAnimationFrame(() => allowBtn.current?.focus());
      return;
    }
    const choice =
      typeof MediaRecorder === 'undefined' ? null : pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
    if (!choice || !('mediaDevices' in navigator)) {
      setState('unsupported');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState('denied');
      return;
    }
    if (cancelStart.current) {
      // The finger was lifted while the phone asked for the microphone: nothing is recorded.
      cancelStart.current = false;
      pointerStarted.current = false;
      suppressClick.current = false;
      stream.getTracks().forEach((tr) => {
        tr.stop();
      });
      return;
    }
    const mr = new MediaRecorder(stream, { mimeType: choice.recordAs, audioBitsPerSecond: 24_000 });
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mr.onstop = () => {
      stream.getTracks().forEach((tr) => {
        tr.stop();
      });
      if (timer.current !== null) window.clearInterval(timer.current);
      timer.current = null;
      const durationMs = recordedMs(startedAt.current, Date.now(), maxSeconds);
      if (durationMs < MIN_MS || chunks.length === 0) {
        setState('idle');
        setNote('tooShort');
        change.current(null);
        return;
      }
      const blob = new Blob(chunks, { type: choice.declare });
      setRec({ url: URL.createObjectURL(blob), durationMs });
      setState('done');
      change.current({ blob, mime: choice.declare, durationMs });
    };
    recorder.current = mr;
    startedAt.current = Date.now();
    setElapsed(0);
    mr.start();
    setState('recording');
    timer.current = window.setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= maxSeconds * 1000) stop();
    }, 250);
  }

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  function reset() {
    setRec(null);
    setState('idle');
    setElapsed(0);
    setNote(null);
    change.current(null);
    focusMic.current = true;
  }

  // Focus follows the swap between the mic and the "recorded" panel, so it never falls to the page.
  useEffect(() => {
    if (state === 'done') donePanel.current?.focus();
    if (state === 'idle' && focusMic.current) {
      focusMic.current = false;
      mic.current?.focus();
    }
  }, [state]);

  const recording = state === 'recording';
  const announcement =
    state === 'denied'
      ? t('recDenied')
      : state === 'unsupported'
        ? t('recUnsupported')
        : note === 'tooShort'
          ? t('recTooShort')
          : recording
            ? t('recStarted')
            : state === 'done' && rec
              ? t('recDone', { time: clockText(rec.durationMs) })
              : consentNote === 'ready'
                ? t('voiceConsentReady')
                : '';

  return (
    <div>
      {/* One live region for every outcome, always mounted (announced when its text changes). */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {ask ? (
        <div
          role="group"
          aria-labelledby={`${hintId}-consent`}
          className="grid gap-3 rounded-2xl border border-line-card bg-surface-alt p-4"
        >
          <p id={`${hintId}-consent`} className="font-heading text-base font-extrabold text-ink">
            {t('voiceConsentH')}
          </p>
          <p className="text-[15px] leading-relaxed text-ink">{t('voiceConsentBody')}</p>
          {consentNote === 'failed' ? (
            <p className="text-sm font-bold text-error">{t('voiceConsentFailed')}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              ref={allowBtn}
              type="button"
              className="press inline-flex min-h-12 items-center justify-center gap-2 rounded-button bg-accent-button px-6 text-[15px] font-bold text-white hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              data-track="ustaad_voice_consent_allow"
              onClick={() => {
                void grantVoiceConsent(locale, ask.version).then((ok) => {
                  if (!ok) {
                    setConsentNote('failed');
                    return;
                  }
                  setAsk(null);
                  setConsentNote('ready');
                  requestAnimationFrame(() => mic.current?.focus());
                });
              }}
            >
              {t('voiceConsentAllow')}
            </button>
            <button
              type="button"
              className={quiet}
              data-track="ustaad_voice_consent_later"
              onClick={() => {
                setAsk(null);
                requestAnimationFrame(() => mic.current?.focus());
              }}
            >
              {t('voiceConsentNotNow')}
            </button>
          </div>
        </div>
      ) : state === 'done' && rec ? (
        <div
          ref={donePanel}
          tabIndex={-1}
          className="grid gap-3 rounded-2xl border border-line-card bg-surface-alt p-4 focus-visible:outline-3 focus-visible:outline-focus"
        >
          <p className="font-bold text-ink">{t('recDone', { time: clockText(rec.durationMs) })}</p>
          {/* Native controls: play, pause and seek with keyboard and screen readers. */}
          <audio controls preload="metadata" src={rec.url} className="w-full" aria-label={t('voiceNote')} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={quiet} data-track="ustaad_voice_rerecord" onClick={reset}>
              <RotateCcw aria-hidden="true" className="size-5" />
              {t('recAgain')}
            </button>
            <button type="button" className={quiet} data-track="ustaad_voice_remove" onClick={reset}>
              <Trash2 aria-hidden="true" className="size-5" />
              {t('recDelete')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <button
            ref={mic}
            type="button"
            aria-pressed={recording}
            aria-describedby={hintId}
            data-track={recording ? 'ustaad_voice_stop' : 'ustaad_voice_start'}
            onPointerDown={(e) => {
              if (recording || e.button !== 0 || state === 'unsupported') return;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Some browsers refuse capture for a finished pointer; the click path still works.
              }
              cancelStart.current = false;
              pressAt.current = Date.now();
              pointerStarted.current = true;
              void start();
            }}
            onPointerUp={() => {
              if (!pointerStarted.current) return;
              if (isHold(Date.now() - pressAt.current)) {
                pointerStarted.current = false;
                suppressClick.current = true;
                if (recorder.current?.state === 'recording') stop();
                else cancelStart.current = true;
              }
            }}
            onPointerCancel={() => {
              // Scrolled away or the system took the pointer: a hold ends here, flags never stay stuck.
              if (pointerStarted.current && isHold(Date.now() - pressAt.current)) stop();
              pointerStarted.current = false;
              suppressClick.current = false;
            }}
            onClick={(e) => {
              // Keyboard and screen-reader activation (no pointer): always a plain toggle.
              if (e.detail === 0) {
                pointerStarted.current = false;
                suppressClick.current = false;
                if (recording) stop();
                else void start();
                return;
              }
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              if (pointerStarted.current) {
                // A tap started the recording: keep going until the next tap.
                pointerStarted.current = false;
                return;
              }
              if (recording) stop();
              else if (state !== 'unsupported') void start();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
            }}
            className={`press flex size-[76px] shrink-0 touch-none items-center justify-center rounded-full text-white shadow-float ring-4 select-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-focus ${
              recording
                ? 'bg-error ring-error/25 motion-safe:animate-pulse'
                : 'bg-accent-button ring-accent/20 hover:bg-accent-button-hover'
            }`}
          >
            {recording ? (
              <Square aria-hidden="true" className="size-8" />
            ) : (
              <Mic aria-hidden="true" className="size-9" />
            )}
            <span className="sr-only">{t('recName')}</span>
          </button>
          <div className="min-w-0">
            <p className="font-heading text-lg font-extrabold text-ink">
              {recording ? (
                <span aria-hidden="true" className="tabular-nums">
                  {t('recording', { time: clockText(elapsed) })}
                </span>
              ) : (
                label
              )}
            </p>
            <p id={hintId} className="mt-0.5 text-sm leading-relaxed text-muted">
              {state === 'denied'
                ? t('recDenied')
                : state === 'unsupported'
                  ? t('recUnsupported')
                  : note === 'tooShort'
                    ? t('recTooShort')
                    : `${hint} ${t('recHint')} ${t('recMax', { s: maxSeconds })}`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
