'use client';

import { Pause, Play } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { ustaadClient } from '@/lib/ustaad/client';

/**
 * A voice note in a question or answer (spec 23 § 17: no autoplay, nothing loads until tapped). Tap → a short-lived
 * signed URL is fetched → it plays; tap again to pause. The play state is in the button's words, not only its icon.
 */
export function VoiceNote({ mediaId, tone = 'light' }: { mediaId: string; tone?: 'light' | 'dark' }) {
  const t = useTranslations('ustaad.media');
  const locale = useLocale();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'failed'>('idle');

  async function toggle() {
    if (audio.current && state === 'playing') {
      audio.current.pause();
      return;
    }
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
      setState('playing');
    };
    a.onpause = () => {
      setState('paused');
    };
    a.onended = () => {
      setState('paused');
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
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => void toggle()}
        data-track="ustaad_voice_play"
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
        {/* A row of bars like a voice message, decorative. */}
        <span aria-hidden="true" className="ml-1 hidden items-center gap-[3px] min-[360px]:flex">
          {[6, 12, 18, 10, 16, 8, 14].map((h, i) => (
            <span key={i} className="w-[3px] rounded-full bg-current opacity-60" style={{ height: h }} />
          ))}
        </span>
      </button>
      {state === 'failed' ? (
        <p role="status" className="text-sm font-bold text-error">
          {t('voiceFailed')}
        </p>
      ) : null}
    </div>
  );
}
