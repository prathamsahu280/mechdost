'use client';

import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { track } from '@/lib/analytics';
import { clockText } from '@/lib/ustaad/media-core';
import { ustaadClient } from '@/lib/ustaad/client';
import {
  SKIP_S,
  VOICE_RATE_KEY,
  fractionFromPointer,
  keyTarget,
  mediaSizeText,
  nextRate,
  parseStoredRate,
  playback,
  seekSeconds,
  skipTarget,
  valueTextParts,
  waveformHeights,
  type VoiceRate,
} from '@/lib/ustaad/voice-ui';

/** What the page already knows about the note (from the content DTO); everything optional. */
export interface VoiceNoteInfo {
  durationMs?: number | null;
  bytes?: number | null;
  /** The author's typed summary (spec 23 § 10a), shown under the player as text. */
  summary?: string | null;
  /** For the labelled card "Voice note from Ramesh · 0:42" (audit 12): the author's name, or `mine`. */
  fromName?: string | null;
  mine?: boolean;
}

type SeekVia = 'tap' | 'drag' | 'key' | 'skip';

function readRate(): VoiceRate {
  try {
    return parseStoredRate(window.localStorage.getItem(VOICE_RATE_KEY));
  } catch {
    return 1;
  }
}

function knownDuration(a: HTMLAudioElement, fallbackS: number): number {
  return Number.isFinite(a.duration) && a.duration > 0 ? a.duration : fallbackS;
}

/**
 * A voice note (spec 23 § 17: no autoplay, nothing loads until tapped). Tap → a short-lived signed URL is fetched →
 * it plays; tap again to pause. The play state is in the button's words, not only its icon. Duration and size show
 * before the tap; once loaded, a waveform bar that is a keyboard slider (tap or drag to seek, arrows ±5 s, Home/End),
 * skip 10 s back/forward, a speed chip 1× → 1.5× → 2× remembered per viewer, and elapsed / total (founder
 * 2026-11-28; spec 23 § 10b). Only one note, video or Listen plays at a time (audit 16). The author's typed summary
 * is the text alternative (WCAG 1.2.1; no speech-to-text).
 */
export function VoiceNote({
  mediaId,
  tone = 'light',
  info,
}: {
  mediaId: string;
  tone?: 'light' | 'dark';
  info?: VoiceNoteInfo;
}) {
  const t = useTranslations('ustaad.media');
  const locale = useLocale();
  const summaryId = useId();
  const audio = useRef<HTMLAudioElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const lastKeyTrack = useRef(0);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'failed'>('idle');
  const fallbackS = info?.durationMs ? info.durationMs / 1000 : 0;
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(fallbackS);
  const [rate, setRate] = useState<VoiceRate>(1);
  const [dragging, setDragging] = useState(false);
  const handle = useRef({
    pause: () => {
      audio.current?.pause();
    },
  });

  useEffect(() => {
    const h = handle.current;
    return () => {
      audio.current?.pause();
      playback.release(h);
    };
  }, []);

  async function toggle() {
    if (state === 'loading') return;
    if (audio.current && state === 'playing') {
      audio.current.pause();
      return;
    }
    playback.claim(handle.current);
    if (audio.current) {
      void audio.current.play();
      return;
    }
    setState('loading');
    const r = await (await ustaadClient(locale)).mediaUrl(mediaId);
    if (!r.ok) {
      setState('failed');
      return;
    }
    const a = new Audio(r.data.url);
    a.preload = 'none';
    // The viewer's remembered speed (localStorage, read only after the tap so the server render never differs).
    const remembered = readRate();
    a.defaultPlaybackRate = remembered;
    a.playbackRate = remembered;
    setRate(remembered);
    a.onplay = () => {
      playback.claim(handle.current);
      setState('playing');
    };
    a.onpause = () => {
      setState('paused');
    };
    a.onloadedmetadata = () => {
      setDur(knownDuration(a, fallbackS));
    };
    a.ondurationchange = () => {
      setDur(knownDuration(a, fallbackS));
    };
    a.ontimeupdate = () => {
      if (!drag.current) setCur(a.currentTime);
    };
    a.onended = () => {
      setDur(knownDuration(a, fallbackS));
      setCur(knownDuration(a, fallbackS));
      setState('paused');
      playback.release(handle.current);
    };
    a.onerror = () => {
      setState('failed');
    };
    audio.current = a;
    track('ustaad_voice_played', {});
    void a.play().catch(() => {
      setState('failed');
    });
  }

  function seekTo(seconds: number, via: SeekVia) {
    const a = audio.current;
    if (!a || !(dur > 0)) return;
    a.currentTime = seconds;
    setCur(seconds);
    // Keys repeat while held: one event per second at most.
    if (via === 'key') {
      const now = Date.now();
      if (now - lastKeyTrack.current < 1000) return;
      lastKeyTrack.current = now;
    }
    track('ustaad_voice_seeked', { via, seconds: Math.min(3600, Math.round(seconds)) });
  }

  function secondsAt(clientX: number): number {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return 0;
    return seekSeconds(fractionFromPointer(clientX, r.left, r.width), dur);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!audio.current || !(dur > 0) || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, moved: false };
    setDragging(true);
    setCur(secondsAt(e.clientX));
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) > 4) d.moved = true;
    setCur(secondsAt(e.clientX));
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    seekTo(secondsAt(e.clientX), d.moved ? 'drag' : 'tap');
  }

  function onPointerCancel() {
    drag.current = null;
    setDragging(false);
    setCur(audio.current?.currentTime ?? 0);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = keyTarget(e.key, cur, dur);
    if (target === null) return;
    e.preventDefault();
    seekTo(target, 'key');
  }

  function cycleRate() {
    const next = nextRate(rate);
    setRate(next);
    if (audio.current) {
      audio.current.defaultPlaybackRate = next;
      audio.current.playbackRate = next;
    }
    try {
      window.localStorage.setItem(VOICE_RATE_KEY, String(next));
    } catch {
      // Private mode or blocked storage: the speed still applies to this note.
    }
    track('ustaad_voice_speed_changed', { rate: next === 1 ? '1' : next === 1.5 ? '1.5' : '2' });
  }

  const playing = state === 'playing';
  const dark = tone === 'dark';
  const surface = dark
    ? 'bg-white/12 text-white hover:bg-white/20'
    : 'bg-accent-soft text-accent-soft-text hover:brightness-95';
  const chip = dark
    ? 'bg-white/12 text-white hover:bg-white/20'
    : 'border border-line-card bg-surface text-ink hover:bg-accent-soft';
  const time = info?.durationMs ? clockText(info.durationMs) : null;
  const size = info?.bytes ? mediaSizeText(info.bytes) : null;
  const sizeText = size ? t(size.unit === 'mb' ? 'sizeMb' : 'sizeKb', { n: size.value }) : null;
  const meta = time && sizeText ? t('voiceMeta', { time, size: sizeText }) : (time ?? sizeText);
  const summary = info?.summary?.trim() ? info.summary.trim() : null;
  const muted = dark ? 'text-white/85' : 'text-muted';
  const label =
    time === null
      ? null
      : info?.mine
        ? t('voiceFromYou', { time })
        : info?.fromName
          ? t('voiceFrom', { name: info.fromName, time })
          : null;
  const active = state !== 'idle' && state !== 'failed' && dur > 0;
  const fraction = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
  const parts = valueTextParts(cur, dur);
  const bars = waveformHeights(mediaId);
  const focusRing = 'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';
  return (
    <div className="grid gap-2">
      {label ? (
        <p id={`${summaryId}-from`} className={`text-sm font-bold ${dark ? 'text-white' : 'text-ink'}`}>
          {label}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void toggle()}
          data-track="ustaad_voice_play"
          aria-disabled={state === 'loading'}
          aria-describedby={
            [label ? `${summaryId}-from` : '', summary ? summaryId : ''].join(' ').trim() || undefined
          }
          className={`press inline-flex min-h-12 items-center gap-2.5 rounded-full py-1.5 pr-5 pl-1.5 text-[15px] font-bold ${focusRing} ${surface}`}
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-accent-button text-white">
            {playing ? (
              <Pause aria-hidden="true" className="size-5" />
            ) : (
              <Play aria-hidden="true" className="size-5" />
            )}
          </span>
          {playing ? t('pauseVoice') : state === 'loading' ? t('voiceLoading') : t('playVoice')}
          {meta ? <span className="font-semibold tabular-nums opacity-90">{meta}</span> : null}
        </button>
        <p role="status" className="text-sm font-bold text-error empty:sr-only">
          {state === 'failed' ? t('voiceFailed') : ''}
        </p>
      </div>
      {active ? (
        <div className="grid w-full max-w-sm gap-1">
          {/* The waveform is the seek bar: a keyboard slider; tap or drag anywhere on it (touch included). */}
          <div
            ref={bar}
            role="slider"
            tabIndex={0}
            aria-label={t('voiceSeek')}
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(cur)}
            aria-valuetext={t('voiceValueText', parts)}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            data-track="ustaad_voice_seek"
            className={`relative flex h-11 cursor-pointer touch-pan-y items-center gap-[2px] rounded-lg select-none ${focusRing}`}
          >
            {bars.map((h, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={`flex-1 rounded-full transition-colors duration-150 motion-reduce:transition-none ${
                  (i + 0.5) / bars.length <= fraction ? 'bg-accent-button' : dark ? 'bg-white/35' : 'bg-line'
                }`}
                style={{ height: `${String(Math.round((h / 100) * 28))}px` }}
              />
            ))}
            <span
              aria-hidden="true"
              className={`absolute top-1 bottom-1 w-[3px] -translate-x-1/2 rounded-full ${dark ? 'bg-white' : 'bg-ink'}`}
              style={{ left: `${String(fraction * 100)}%` }}
            />
            {dragging ? (
              <span
                aria-hidden="true"
                className="absolute -top-7 -translate-x-1/2 rounded-md bg-navy px-1.5 py-0.5 text-xs font-bold text-white tabular-nums"
                style={{ left: `${String(fraction * 100)}%` }}
              >
                {parts.elapsed}
              </span>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm font-semibold tabular-nums ${muted}`}>{t('voiceElapsed', parts)}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  seekTo(skipTarget(cur, -SKIP_S, dur), 'skip');
                }}
                data-track="ustaad_voice_back10"
                className={`press inline-flex size-12 items-center justify-center rounded-full ${focusRing} ${chip}`}
              >
                <RotateCcw aria-hidden="true" className="size-5" />
                <span className="sr-only">{t('voiceBack10')}</span>
              </button>
              <button
                type="button"
                onClick={cycleRate}
                data-track="ustaad_voice_speed"
                className={`press inline-flex min-h-12 min-w-12 items-center justify-center rounded-full px-3 text-sm font-bold tabular-nums ${focusRing} ${chip}`}
              >
                <span className="sr-only">{t('voiceSpeed', { rate: String(rate) })}</span>
                <span aria-hidden="true">{`${String(rate)}×`}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  seekTo(skipTarget(cur, SKIP_S, dur), 'skip');
                }}
                data-track="ustaad_voice_forward10"
                className={`press inline-flex size-12 items-center justify-center rounded-full ${focusRing} ${chip}`}
              >
                <RotateCw aria-hidden="true" className="size-5" />
                <span className="sr-only">{t('voiceForward10')}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {summary ? (
        <p
          id={summaryId}
          lang={/[ऀ-ॿ]/.test(summary) ? 'hi' : undefined}
          className={`text-[15px] leading-relaxed ${muted}`}
          data-user-content
        >
          <span className="font-bold">{t('summaryOf')}: </span>
          {summary}
        </p>
      ) : null}
    </div>
  );
}
