'use client';

import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Horizontal product rail (redesign 2026-11-02, SpareVillage-style collections, with more air): a scroll-snap row
 * of server-rendered cards, a title with "View all", and arrow buttons (≥760px) that page by the visible width.
 * Arrows disable at the ends. Swipe and keyboard scrolling work without them.
 */
export function Rail({
  id,
  title,
  viewAll,
  labels,
  children,
}: {
  id: string;
  title: string;
  viewAll: { href: string; label: string; track: string };
  labels: { prev: string; next: string };
  children: ReactNode;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      el.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: reduce ? 'auto' : 'smooth' });
  };

  const arrow =
    'hidden size-10 place-items-center rounded-full border border-line-card bg-surface text-ink transition-opacity duration-[var(--duration-fast)] hover:bg-pill disabled:pointer-events-none disabled:opacity-35 tab:grid';
  return (
    <section aria-labelledby={id} className="reveal">
      <div className="flex items-end justify-between gap-4">
        <h3
          id={id}
          className="font-heading text-[clamp(20px,2vw,26px)] font-extrabold tracking-[-0.02em] text-ink"
        >
          {title}
        </h3>
        <div className="flex items-center gap-2">
          <Link
            href={viewAll.href}
            data-track={viewAll.track}
            className="inline-flex min-h-10 items-center gap-1 px-1 text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
          >
            {viewAll.label}
            <ArrowUpRight aria-hidden="true" className="size-4" strokeWidth={2.5} />
          </Link>
          <button
            type="button"
            aria-label={labels.prev}
            aria-controls={`${id}-list`}
            disabled={edges.start}
            onClick={() => {
              page(-1);
            }}
            className={arrow}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            aria-label={labels.next}
            aria-controls={`${id}-list`}
            disabled={edges.end}
            onClick={() => {
              page(1);
            }}
            className={arrow}
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
        </div>
      </div>
      <ul
        id={`${id}-list`}
        ref={ref}
        // Keyboard users can focus the row and scroll it with the arrow keys even when its cards hold no links
        // (reviews) — axe scrollable-region-focusable, WCAG 2.1.1.
        tabIndex={0}
        aria-labelledby={id}
        // `relative`: makes the list the containing block, so absolutely positioned .sr-only labels inside off-screen
        // cards are clipped by the scroller instead of stretching the page sideways (bug 2026-11-02, ~3000px overflow).
        className="relative -mx-[5vw] mt-5 flex snap-x snap-mandatory scroll-px-[5vw] gap-4 overflow-x-auto px-[5vw] pb-2 [scrollbar-width:none] tab:mx-0 tab:scroll-px-0 tab:px-0"
      >
        {children}
      </ul>
    </section>
  );
}
