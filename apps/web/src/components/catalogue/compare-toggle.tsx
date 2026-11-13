'use client';

import { Check, Columns3 } from 'lucide-react';
import { useState } from 'react';
import { track } from '@/lib/analytics';
import {
  addToCompare,
  readCompare,
  removeFromCompare,
  startNewComparison,
  useCompare,
  type CompareAddResult,
} from '@/lib/compare/store';

export interface CompareToggleLabels {
  toggle: string;
  /** Accessible name with the product, e.g. "Compare Castrol Activ 4T". */
  toggleName: string;
  /** "Added to compare ({count} of 4)" with {count} already left in for the island to fill. */
  added: string;
  removed: string;
  full: string;
  otherCategory: string;
  startNew: string;
  saveFailed: string;
}

/**
 * "Compare" toggle on a product card or page (design 2026-11-13). A pressed button (`aria-pressed`), feedback in
 * a live region, and one way out when the list holds another category: "Start a new comparison". Labels arrive
 * translated from the server, so no i18n runtime ships with this island.
 */
export function CompareToggle({
  slug,
  category,
  labels,
  className = '',
}: {
  slug: string;
  /** Category slug: the list holds one category at a time. */
  category: string;
  labels: CompareToggleLabels;
  className?: string;
}) {
  const list = useCompare();
  const [result, setResult] = useState<CompareAddResult | 'removed' | null>(null);
  const on = list.slugs.includes(slug);

  const show = (r: CompareAddResult | 'removed') => {
    // Clear first, so the same message twice is announced again.
    setResult(null);
    window.requestAnimationFrame(() => {
      setResult(r);
    });
  };

  const add = (r: CompareAddResult) => {
    show(r);
    if (r === 'added') track('compare_added', { slug, category, count: readCompare().slugs.length });
  };

  const message =
    result === 'added'
      ? labels.added.replace('{count}', String(list.slugs.length))
      : result === 'removed'
        ? labels.removed
        : result === 'full'
          ? labels.full
          : result === 'other_category'
            ? labels.otherCategory
            : result === 'save_failed'
              ? labels.saveFailed
              : '';
  const problem = result === 'full' || result === 'other_category' || result === 'save_failed';

  return (
    <div className={className}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={labels.toggleName}
        onClick={() => {
          if (on) {
            removeFromCompare(slug);
            show('removed');
            track('compare_removed', { slug, count: readCompare().slugs.length });
          } else add(addToCompare(slug, category));
        }}
        className={`press inline-flex min-h-11 items-center gap-2 rounded-button border px-3 text-sm font-bold transition-colors duration-[var(--duration-base)] ${
          on ? 'border-ink bg-ink text-surface' : 'border-line-input bg-surface text-ink hover:border-ink'
        }`}
      >
        {on ? (
          <Check aria-hidden="true" className="size-4" strokeWidth={3} />
        ) : (
          <Columns3 aria-hidden="true" className="size-4" />
        )}
        {labels.toggle}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
      {problem ? (
        <div className="mt-2 text-xs">
          <p className="font-bold text-error">{message}</p>
          {result === 'other_category' ? (
            <button
              type="button"
              onClick={() => {
                add(startNewComparison(slug, category));
              }}
              className="mt-1 min-h-11 font-bold text-ink underline underline-offset-2"
            >
              {labels.startNew}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
