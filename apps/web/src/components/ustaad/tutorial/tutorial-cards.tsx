'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { Tutorial } from '@mechdost/shared/ustaad/dto/verification';
import { UstaadIcon, type UstaadIconName } from '@/components/ustaad/shell/icons';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import { narrationLang } from '@/lib/ustaad/card';

/** A big picture per default card (admin cards with other codes get the card icon). */
const ICON: Record<string, UstaadIconName> = {
  ask: 'mic',
  show_work: 'create',
  answer: 'network',
  levels: 'card',
  pin: 'pin',
  dukaan: 'dukaan',
};

type Card = Tutorial['cards'][number];

/**
 * First-time tutorial (spec 23 § 4 flow 15; plan task B2): 4–6 cards, one at a time, Next / Back / Skip anytime, swipe
 * with button equivalents. Narration only on a tap of "Listen": the staff recording when there is one (signed URL),
 * otherwise the browser's own speech reading the text on screen; nothing plays by itself. Focus moves to the card
 * heading on each card; no motion (static pictures), so reduced motion needs nothing extra. Progress is saved and the
 * `tutorial_*` events are tracked (spec 23 § 16).
 */
export function TutorialCards() {
  const t = useTranslations('ustaad.tutorial');
  const locale = useLocale();
  const router = useRouter();
  const lang = locale === 'en' ? 'en' : 'hi';
  const [cards, setCards] = useState<Card[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [noVoice, setNoVoice] = useState(false);
  const heard = useRef(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const startX = useRef<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const run = { live: true };
    void (async () => {
      const api = await import('@/lib/ustaad/identity-api');
      const res = await api.fetchTutorial(locale);
      if (!run.live) return;
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setCards(res.data.cards);
      track('tutorial_started', {});
    })();
    return () => {
      run.live = false;
    };
  }, [locale]);

  useEffect(() => {
    if (!cards) return;
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [i, cards]);

  function stop() {
    audio.current?.pause();
    audio.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setPlaying(false);
  }

  useEffect(() => stop, []);

  if (failed)
    return (
      <p role="alert" className="text-base text-ink">
        {t('error')}
      </p>
    );
  if (!cards)
    return (
      <p role="status" className="text-base text-ink-muted">
        {t('loading')}
      </p>
    );
  const total = cards.length;
  const card = cards[i];
  if (!card) return null;
  const last = i === total - 1;

  async function save(event: 'card' | 'skipped' | 'completed', n: number) {
    const api = await import('@/lib/ustaad/identity-api');
    await api.saveOnboarding(locale, { event, card: n });
  }

  function go(to: number) {
    stop();
    track('tutorial_step', { card: i + 1, narrationPlayed: heard.current });
    heard.current = false;
    setI(to);
    void save('card', to + 1);
  }

  function leave(kind: 'skipped' | 'completed') {
    stop();
    if (kind === 'skipped') track('tutorial_skipped', { atCard: i + 1 });
    else track('tutorial_completed', {});
    void save(kind, i + 1).finally(() => {
      router.push(localePath('/ustaad', locale));
    });
  }

  async function listen(c: Card) {
    if (playing) {
      stop();
      return;
    }
    heard.current = true;
    setNoVoice(false);
    if (c.audioMediaId) {
      const api = await import('@/lib/ustaad/identity-api');
      const res = await api.fetchMediaUrl(locale, c.audioMediaId);
      if (res.ok) {
        const a = new Audio(res.data.url);
        audio.current = a;
        a.onended = () => {
          setPlaying(false);
        };
        setPlaying(true);
        void a.play().catch(() => {
          setPlaying(false);
          setNoVoice(true);
        });
        return;
      }
    }
    if (!('speechSynthesis' in window)) {
      setNoVoice(true);
      return;
    }
    const u = new SpeechSynthesisUtterance(`${c.title}. ${c.body}`);
    u.lang = narrationLang(lang);
    u.onend = () => {
      setPlaying(false);
    };
    setPlaying(true);
    window.speechSynthesis.speak(u);
  }

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('title')}
      className="grid touch-pan-y gap-5"
      onPointerCancel={() => {
        startX.current = null;
      }}
      onPointerDown={(e) => {
        startX.current = e.clientX;
      }}
      onPointerUp={(e) => {
        const from = startX.current;
        startX.current = null;
        if (from === null) return;
        const dx = e.clientX - from;
        if (dx < -60 && !last) go(i + 1);
        if (dx > 60 && i > 0) go(i - 1);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-ink-muted">{t('cardOf', { n: i + 1, total })}</p>
        <button
          type="button"
          onClick={() => {
            leave('skipped');
          }}
          className="press min-h-12 rounded-button px-4 text-base font-bold text-ink underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {t('skip')}
        </button>
      </div>

      <div
        role="group"
        aria-roledescription="slide"
        aria-label={t('cardOf', { n: i + 1, total })}
        className="grid justify-items-center gap-4 rounded-[26px] bg-navy px-5 py-8 text-center text-white shadow-float"
      >
        <span
          aria-hidden="true"
          className="flex size-24 items-center justify-center rounded-full bg-white/10 text-accent"
        >
          <UstaadIcon name={ICON[card.code] ?? 'card'} size={48} />
        </span>
        <h2
          ref={heading}
          tabIndex={-1}
          className="font-heading text-[clamp(22px,5vw,28px)] font-extrabold outline-none focus-visible:ring-2 focus-visible:ring-accent-button"
        >
          {card.title}
        </h2>
        <p className="max-w-[36ch] text-base leading-relaxed text-white/90">{card.body}</p>
        <button
          type="button"
          onClick={() => {
            void listen(card);
          }}
          className="press inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-5 text-base font-bold text-navy focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <UstaadIcon name="mic" size={20} />
          {playing ? t('stop') : t('listen')}
        </button>
        <p role="status" className="text-sm text-white/80">
          {noVoice ? t('noVoice') : ''}
        </p>
      </div>

      <div className="flex justify-center gap-1.5" aria-hidden="true">
        {cards.map((c, n) => (
          <span
            key={c.code}
            className={`h-2 rounded-full ${n === i ? 'w-6 bg-accent' : 'w-2 bg-line-card'}`}
          />
        ))}
      </div>

      <div className="flex gap-3">
        {i > 0 ? (
          <button
            type="button"
            onClick={() => {
              go(i - 1);
            }}
            className="press min-h-12 flex-1 rounded-button border border-line-card text-base font-bold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t('back')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (last) leave('completed');
            else go(i + 1);
          }}
          className="press min-h-12 flex-[2] rounded-button bg-accent-button text-base font-bold text-white hover:bg-accent-button-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {last ? t('done') : t('next')}
        </button>
      </div>
    </section>
  );
}
