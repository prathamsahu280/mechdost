'use client';

import { Square, Volume2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore } from 'react';

const noop = () => () => undefined;

/**
 * "Listen" (सुनो): reads a question or answer aloud with the phone's own voice (`speechSynthesis`, nothing is sent
 * anywhere; spec 23 brief "read-aloud"). Hidden where the browser has no speech. Never starts by itself; one text at a
 * time (starting one stops the other).
 */
export function ListenButton({ text }: { text: string }) {
  const t = useTranslations('ustaad.media');
  const locale = useLocale();
  const supported = useSyncExternalStore(
    noop,
    () => 'speechSynthesis' in window,
    () => false,
  );
  const [speaking, setSpeaking] = useState(false);

  useEffect(
    () => () => {
      if (speaking) window.speechSynthesis.cancel();
    },
    [speaking],
  );

  if (!supported || text.trim() === '') return null;

  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    // Devanagari text is read in Hindi; Latin (Hinglish) with the Indian English voice.
    u.lang = /[ऀ-ॿ]/.test(text) || locale === 'hi' ? 'hi-IN' : 'en-IN';
    u.rate = 0.95;
    u.onend = () => {
      setSpeaking(false);
    };
    u.onerror = () => {
      setSpeaking(false);
    };
    setSpeaking(true);
    synth.speak(u);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      data-track="ustaad_listen"
      className="press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-accent-soft-text hover:bg-accent-soft focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {speaking ? (
        <Square aria-hidden="true" className="size-4" />
      ) : (
        <Volume2 aria-hidden="true" className="size-[18px]" />
      )}
      <span>{speaking ? t('listenStop') : t('listen')}</span>
    </button>
  );
}
