'use client';

import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const INTERVAL_MS = 7000;

/**
 * Home banner carousel (redesign 2026-11-02, SpareVillage-style banner hero). Slides are server-rendered and passed
 * in; this island only moves a CSS scroll-snap track. WAI-ARIA carousel pattern: region + roledescription, slides as
 * labelled groups, dot buttons, and a pause/play button (WCAG 2.2.2 for auto-moving content). Auto-advance pauses on
 * hover, keyboard focus and hidden tabs, and never runs under prefers-reduced-motion. Off-screen slides are inert.
 */
export function HeroCarousel({
  slides,
  aside,
  labels,
}: {
  slides: readonly ReactNode[];
  aside?: ReactNode;
  /** Pre-localised on the server (functions cannot cross the server → client boundary). */
  labels: {
    carousel: string;
    slides: readonly string[];
    goTo: readonly string[];
    pause: string;
    play: string;
  };
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setReduced(mq.matches);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
    };
  }, []);

  const goTo = useCallback(
    (i: number) => {
      const track = trackRef.current;
      if (!track) return;
      const next = (i + slides.length) % slides.length;
      track.scrollTo({ left: next * track.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    },
    [slides.length, reduced],
  );

  // The visible slide follows the scroll position (buttons, swipes and keyboard scrolling alike).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      setIndex(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      track.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!playing || held || reduced || slides.length < 2) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') goTo(index + 1);
    }, INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [playing, held, reduced, index, goTo, slides.length]);

  const autoplay = playing && !reduced;
  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={labels.carousel}
      onMouseEnter={() => {
        setHeld(true);
      }}
      onMouseLeave={() => {
        setHeld(false);
      }}
      onFocus={() => {
        setHeld(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false);
      }}
    >
      <div
        ref={trackRef}
        aria-live={autoplay ? 'off' : 'polite'}
        className="relative flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none]"
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={labels.slides[i]}
            inert={i !== index}
            className="w-full shrink-0 snap-start snap-always"
          >
            {slide}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="min-w-0">{aside}</div>
        <div className="flex items-center gap-1">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={labels.goTo[i]}
              aria-current={i === index ? 'true' : undefined}
              data-track={`hero_slide_${String(i + 1)}`}
              onClick={() => {
                goTo(i);
              }}
              className="group grid size-8 place-items-center rounded-full"
            >
              <span
                aria-hidden="true"
                className={`block h-2 rounded-full transition-[width,background-color] duration-[var(--duration-base)] ${
                  i === index ? 'w-6 bg-accent' : 'w-2 bg-line-card group-hover:bg-muted'
                }`}
              />
            </button>
          ))}
          {slides.length > 1 && !reduced ? (
            <button
              type="button"
              aria-label={playing ? labels.pause : labels.play}
              data-track={playing ? 'hero_pause' : 'hero_play'}
              onClick={() => {
                setPlaying((p) => !p);
              }}
              className="ml-1 grid size-8 place-items-center rounded-full text-muted hover:bg-pill hover:text-ink"
            >
              {playing ? (
                <Pause aria-hidden="true" className="size-3.5" fill="currentColor" />
              ) : (
                <Play aria-hidden="true" className="size-3.5" fill="currentColor" />
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
