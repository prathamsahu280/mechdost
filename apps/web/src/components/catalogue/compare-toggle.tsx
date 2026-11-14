'use client';

import { ArrowLeftRight, Check } from 'lucide-react';
import { useState } from 'react';
import { track } from '@/lib/analytics';
import { addToCompare, readCompare, removeFromCompare, useCompare } from '@/lib/compare/store';

export interface CompareToggleLabels {
  toggle: string;
  /** Accessible name with the product, e.g. "Compare Castrol Activ 4T". */
  toggleName: string;
  /** "Added to compare ({count} of 4)" with {count} left in for the island to fill. */
  added: string;
  removed: string;
}

/**
 * "Compare" toggle on a product card or page (redesign 2026-11-14): a pressed button (`aria-pressed`, filled with
 * a tick when on). It never shows a message of its own — another category, a full list or a refused save is asked
 * or told once, in the compare tray, and every card follows the one shared list (bug 2026-11-14: each card kept
 * its own red message and its own "Start a new comparison"). Added/removed are announced through a hidden status.
 *
 * `layout="card"`: inside a card's action row (an `@container`): a full-width button with its word on narrow cards
 * (the row stacks), an icon button in mid widths, the word again from 18rem. `layout="page"`: always the word.
 * Labels arrive translated from the server; kept small, it ships on every shop page (JS budget, spec 16).
 */
export function CompareToggle({
  slug,
  category,
  categoryName,
  labels,
  layout = 'page',
  className = '',
}: {
  slug: string;
  /** Category slug: the list holds one category at a time. */
  category: string;
  /** The category's display name in the page language (shown in the tray). */
  categoryName: string | null;
  labels: CompareToggleLabels;
  layout?: 'card' | 'page';
  className?: string;
}) {
  const on = useCompare().slugs.includes(slug);
  const [status, setStatus] = useState('');
  const Icon = on ? Check : ArrowLeftRight;

  return (
    <div className={className}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={labels.toggleName}
        data-compare-toggle={slug}
        onClick={() => {
          if (on) {
            removeFromCompare(slug);
            track('compare_removed', { slug, count: readCompare().slugs.length });
            setStatus(labels.removed);
            return;
          }
          const lang = document.documentElement.lang;
          const r = addToCompare(slug, category, categoryName ? { name: categoryName, lang } : {});
          if (r !== 'added') {
            setStatus('');
            return;
          }
          const count = readCompare().slugs.length;
          track('compare_added', { slug, category, count });
          setStatus(labels.added.replace('{count}', String(count)));
        }}
        className={`press relative inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-button border px-3 text-sm font-bold transition-colors duration-[var(--duration-base)] ${
          layout === 'card' ? '@max-[12.5rem]:w-full' : ''
        } ${on ? 'border-ink bg-ink text-surface' : 'border-line-input bg-surface text-ink hover:border-ink'}`}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={on ? 3 : 2} />
        <span
          className={
            layout === 'card' ? 'sr-only @max-[12.5rem]:not-sr-only @min-[18rem]:not-sr-only' : undefined
          }
        >
          {labels.toggle}
        </span>
      </button>
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}
