'use client';

import NextLink from 'next/link';
import { clearCompare, compareHref, useCompare } from '@/lib/compare/store';

export interface CompareTrayLabels {
  label: string;
  /** "Compare ({count})": the island fills {count}. */
  link: string;
  clear: string;
}

/**
 * The small "Compare (2)" bar (design 2026-11-13). Only on shop pages, only while something is picked. Kept
 * small on phones (Baymard: a big compare panel hid half the screen): bottom-left above the tab bar, clear of the
 * assistant button (bottom-right).
 */
export function CompareTray({
  labels,
  prefix,
}: {
  labels: CompareTrayLabels;
  /** '' or '/hi', from the server. */ prefix: string;
}) {
  const list = useCompare();
  if (list.slugs.length === 0) return null;
  return (
    <aside
      aria-label={labels.label}
      className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] left-4 z-40 flex items-center gap-1 rounded-pill border border-line-card bg-surface p-1 shadow-dialog nav:bottom-6 nav:left-6"
    >
      <NextLink
        href={prefix + compareHref(list.slugs)}
        data-track="compare_tray_open"
        className="press inline-flex min-h-11 items-center rounded-pill bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover"
      >
        {labels.link.replace('{count}', String(list.slugs.length))}
      </NextLink>
      <button
        type="button"
        data-track="compare_tray_clear"
        onClick={clearCompare}
        className="press inline-flex min-h-11 items-center rounded-pill px-3 text-sm font-bold text-ink hover:bg-surface-alt"
      >
        {labels.clear}
      </button>
    </aside>
  );
}
