'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { track } from '@/lib/analytics';
import { compareHref, readCompare, removeFromCompare } from '@/lib/compare/store';

/**
 * "Only differences" (design 2026-11-13): a pressed button that hides the rows marked `data-same` (CSS in
 * globals.css). Wraps the server-rendered table; also records `compare_opened` once. Labels come as props.
 */
export function DifferencesToggle({
  label,
  count,
  category,
  tools,
  children,
}: {
  label: string;
  count: number;
  category: string | null;
  /** Other links shown in the toolbar beside the toggle (server-rendered). */
  tools?: ReactNode;
  children: ReactNode;
}) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    track('compare_opened', { count, category });
  }, [count, category]);
  useScrollSync();
  return (
    <div data-diff-only={on ? 'true' : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={on}
          onClick={() => {
            setOn(!on);
            track('compare_differences_toggled', { on: !on });
          }}
          className={`press inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-sm font-bold transition-colors duration-[var(--duration-base)] ${
            on ? 'border-ink bg-ink text-surface' : 'border-line-input bg-surface text-ink hover:border-ink'
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block size-3 rounded-full border-2 ${on ? 'border-surface bg-surface' : 'border-ink'}`}
          />
          {label}
        </button>
        {tools}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/**
 * Keeps the sticky product strip and the swipeable body side by side (redesign 2026-11-13): whichever one the
 * shopper swipes, the other follows. Passive listeners; a frame guard stops the two from echoing each other.
 */
function useScrollSync() {
  useEffect(() => {
    const head = document.querySelector<HTMLElement>('[data-compare-scroll="head"]');
    const body = document.querySelector<HTMLElement>('[data-compare-scroll="body"]');
    if (!head || !body) return;
    let lock: HTMLElement | null = null;
    const follow = (from: HTMLElement, to: HTMLElement) => () => {
      if (lock && lock !== from) return;
      lock = from;
      to.scrollLeft = from.scrollLeft;
      requestAnimationFrame(() => {
        lock = null;
      });
    };
    const onHead = follow(head, body);
    const onBody = follow(body, head);
    head.addEventListener('scroll', onHead, { passive: true });
    body.addEventListener('scroll', onBody, { passive: true });
    return () => {
      head.removeEventListener('scroll', onHead);
      body.removeEventListener('scroll', onBody);
    };
  }, []);
}

/** Removes one product from the table (and from the browser's compare list when it is there). */
export function CompareRemove({
  slug,
  slugs,
  prefix,
  label,
}: {
  slug: string;
  /** The products now in the table, in order. */
  slugs: readonly string[];
  /** '' or '/hi', from the server. */
  prefix: string;
  label: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        if (readCompare().slugs.includes(slug)) removeFromCompare(slug);
        const rest = slugs.filter((s) => s !== slug);
        track('compare_removed', { slug, count: rest.length });
        router.replace(prefix + (rest.length > 0 ? compareHref(rest) : '/compare'), { scroll: false });
      }}
      className="press inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-alt hover:text-ink"
    >
      <X aria-hidden="true" className="size-4" />
    </button>
  );
}
