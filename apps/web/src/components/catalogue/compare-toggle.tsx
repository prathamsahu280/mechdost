'use client';

import { Check } from 'lucide-react';
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
  /** "Added to compare ({count} of 4)" with {count} left in for the island to fill. */
  added: string;
  removed: string;
  full: string;
  otherCategory: string;
  startNew: string;
  saveFailed: string;
}

interface Note {
  text: string;
  error?: boolean;
  /** The list holds another category: offer "Start a new comparison". */
  other?: boolean;
}

/**
 * "Compare" toggle on a product card or page (design 2026-11-13): a pressed button (`aria-pressed`) and one status
 * line, read out by screen readers and shown when something went wrong. When the list holds another category the
 * one way out is "Start a new comparison". Labels arrive translated from the server; kept small, it ships on every
 * shop page (JS budget, spec 16).
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
  const on = useCompare().slugs.includes(slug);
  const [note, setNote] = useState<Note | null>(null);

  const after = (r: CompareAddResult) => {
    if (r === 'added') {
      const count = readCompare().slugs.length;
      track('compare_added', { slug, category, count });
      setNote({ text: labels.added.replace('{count}', String(count)) });
    } else
      setNote({
        text: r === 'full' ? labels.full : r === 'other_category' ? labels.otherCategory : labels.saveFailed,
        error: true,
        other: r === 'other_category',
      });
  };

  return (
    <div className={className}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={labels.toggleName}
        onClick={() => {
          if (!on) {
            after(addToCompare(slug, category));
            return;
          }
          removeFromCompare(slug);
          track('compare_removed', { slug, count: readCompare().slugs.length });
          setNote({ text: labels.removed });
        }}
        className={`press inline-flex min-h-11 items-center gap-2 rounded-button border px-3 text-sm font-bold transition-colors duration-[var(--duration-base)] ${
          on ? 'border-ink bg-ink text-surface' : 'border-line-input bg-surface text-ink hover:border-ink'
        }`}
      >
        {on ? <Check aria-hidden="true" className="size-4" strokeWidth={3} /> : null}
        {labels.toggle}
      </button>
      <p role="status" className={note?.error ? 'mt-2 text-xs font-bold text-error' : 'sr-only'}>
        {note?.text}
      </p>
      {note?.other ? (
        <button
          type="button"
          onClick={() => {
            after(startNewComparison(slug, category));
          }}
          className="min-h-11 text-xs font-bold text-ink underline underline-offset-2"
        >
          {labels.startNew}
        </button>
      ) : null}
    </div>
  );
}
