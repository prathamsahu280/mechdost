'use client';

import { Pause, Play } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { clockText } from '@/lib/ustaad/media-core';
import { ustaadClient } from '@/lib/ustaad/client';
import { mediaSizeText, playback, progressPercent } from '@/lib/ustaad/voice-ui';

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

/**
 * A voice note (spec 23 § 17: no autoplay, nothing loads until tapped). Tap → a short-lived signed URL is fetched →
 * it plays; tap again to pause. The play state is in the button's words, not only its icon. Duration and size show
 * before the tap, a progress bar while it plays, and only one note, video or Listen plays at a time (audit 16). The
 * author's typed summary is the text alternative (WCAG 1.2.1; no speech-to-text).
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
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'failed'>('idle');
  const [pct, setPct] = useState(0);
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
    a.onplay = () => {
      playback.claim(handle.current);
      setState('playing');
    };
    a.onpause = () => {
      setState('paused');
    };
    a.ontimeupdate = () => {
      setPct(progressPercent(a.currentTime, a.duration));
    };
    a.onended = () => {
      setPct(100);
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

  const playing = state === 'playing';
  const surface =
    tone === 'dark'
      ? 'bg-white/12 text-white hover:bg-white/20'
      : 'bg-accent-soft text-accent-soft-text hover:brightness-95';
  const time = info?.durationMs ? clockText(info.durationMs) : null;
  const size = info?.bytes ? mediaSizeText(info.bytes) : null;
  const sizeText = size ? t(size.unit === 'mb' ? 'sizeMb' : 'sizeKb', { n: size.value }) : null;
  const meta = time && sizeText ? t('voiceMeta', { time, size: sizeText }) : (time ?? sizeText);
  const summary = info?.summary?.trim() ? info.summary.trim() : null;
  const muted = tone === 'dark' ? 'text-white/85' : 'text-muted';
  const label =
    time === null
      ? null
      : info?.mine
        ? t('voiceFromYou', { time })
        : info?.fromName
          ? t('voiceFrom', { name: info.fromName, time })
          : null;
  return (
    <div className="grid gap-2">
      {label ? (
        <p
          id={`${summaryId}-from`}
          className={`text-sm font-bold ${tone === 'dark' ? 'text-white' : 'text-ink'}`}
        >
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
          className={`press inline-flex min-h-12 items-center gap-2.5 rounded-full py-1.5 pr-5 pl-1.5 text-[15px] font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${surface}`}
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
      {state !== 'idle' && state !== 'failed' ? (
        <progress
          max={100}
          value={pct}
          aria-label={t('voiceProgress')}
          className="h-1.5 w-full max-w-xs overflow-hidden rounded-full accent-accent-button"
        />
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
