'use client';

import { isPortalPath } from '@/lib/portal-path';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import {
  answerSwitch,
  clearCompare,
  compareHref,
  dismissPrompt,
  useCompare,
  useComparePrompt,
  type CompareList,
  type ComparePrompt,
} from '@/lib/compare/store';
import { nameIn, switchText, type SwitchLabels } from '@/lib/compare/prompt-text';

export interface CompareTrayLabels extends SwitchLabels {
  label: string;
  /** "Compare ({count})": the island fills {count}. */
  link: string;
  clear: string;
  switchStart: string;
  switchKeep: string;
  /** "Added to compare ({count} of 4)", announced after "Start new". */
  added: string;
  full: string;
  saveFailed: string;
  dismiss: string;
}

/**
 * The small "Compare (2)" bar (design 2026-11-13). On every page (locale layout), only while something is picked. Kept
 * small on phones (Baymard: a big compare panel hid half the screen): bottom-left above the tab bar, clear of the
 * assistant button (bottom-right).
 *
 * Redesign 2026-11-14: the one place that asks or tells about the compare list. Picking another category opens a
 * question above the bar ("Start a new comparison with Batteries? This removes 1 Lubricants item." — "Start new" /
 * "Keep current"); a fifth product or a refused save is told here too. Not a modal: focus moves to the question
 * and back to the control that asked; Escape keeps the current list; the result is announced (status).
 */
export function CompareTray({
  labels,
  prefix,
}: {
  labels: CompareTrayLabels;
  /** '' or '/hi', from the server. */ prefix: string;
}) {
  const list = useCompare();
  const prompt = useComparePrompt();
  const pathname = usePathname();
  const [said, setSaid] = useState('');
  // Not on the comparison itself (the table is what the tray would open), nor at checkout, where it covered the
  // form (QA 2026-11-14, crawler F8).
  // Nor in the admin and partner portals, where it covered the side navigation (lifecycle QA 2026-11-14, 6).
  if (/\/(compare|checkout)\/?$/.test(pathname) || isPortalPath(pathname)) return null;
  if (list.slugs.length === 0 && prompt === null) return null;
  const category = list.slugs.length > 0 ? nameIn(list.name, list.lang, document.documentElement.lang) : null;
  return (
    <aside
      data-compare-tray=""
      data-prompt={prompt ? '' : undefined}
      aria-label={labels.label}
      // The tray's box lets clicks through: only the bar and the question take them (the assistant sits beside).
      className="pointer-events-none fixed bottom-[calc(84px+env(safe-area-inset-bottom))] left-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-start gap-2 nav:bottom-6 nav:left-6"
    >
      {prompt ? <TrayPrompt prompt={prompt} list={list} labels={labels} onSay={setSaid} /> : null}
      {list.slugs.length > 0 ? (
        <div className="pointer-events-auto flex max-w-full items-center gap-1 rounded-pill border border-line-card bg-surface p-1 shadow-dialog">
          <NextLink
            href={prefix + compareHref(list.slugs)}
            data-track="compare_tray_open"
            className="press inline-flex min-h-11 shrink-0 items-center rounded-pill bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover"
          >
            {labels.link.replace('{count}', String(list.slugs.length))}
          </NextLink>
          {category ? (
            <span className="min-w-0 truncate px-2 text-xs font-bold text-muted">{category}</span>
          ) : null}
          <button
            type="button"
            data-track="compare_tray_clear"
            onClick={clearCompare}
            className="press inline-flex min-h-11 shrink-0 items-center rounded-pill px-3 text-sm font-bold text-ink hover:bg-surface-alt"
          >
            {labels.clear}
          </button>
        </div>
      ) : null}
      <p role="status" className="sr-only">
        {said}
      </p>
    </aside>
  );
}

function TrayPrompt({
  prompt,
  list,
  labels,
  onSay,
}: {
  prompt: ComparePrompt;
  list: CompareList;
  labels: CompareTrayLabels;
  onSay: (text: string) => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const seen = useRef<ComparePrompt | null>(null);

  useEffect(() => {
    if (seen.current === prompt) return;
    seen.current = prompt;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !box.current?.contains(active))
      origin.current = active;
    if (prompt.kind === 'switch') {
      track('compare_switch_prompted', {
        from: list.category ?? 'none',
        to: prompt.category,
        count: Math.max(1, prompt.fromCount),
      });
      box.current?.focus();
    } else {
      track('compare_limit_shown', { reason: prompt.kind });
      onSay(prompt.kind === 'full' ? labels.full : labels.saveFailed);
    }
  }, [prompt, list.category, labels, onSay]);

  /** Back to the control that asked (Safari does not focus a clicked button: find it by its product). */
  const back = (slug?: string) => {
    const own = slug
      ? document.querySelector<HTMLElement>(`[data-compare-toggle="${CSS.escape(slug)}"]`)
      : null;
    (own ?? origin.current)?.focus();
  };

  if (prompt.kind !== 'switch')
    return (
      <div className="pointer-events-auto flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-card border border-line-card bg-surface p-3 shadow-dialog">
        <p className="min-w-0 flex-1 self-center text-sm text-ink">
          {prompt.kind === 'full' ? labels.full : labels.saveFailed}
        </p>
        <button
          type="button"
          onClick={() => {
            dismissPrompt();
            back();
          }}
          className="press inline-flex min-h-11 shrink-0 items-center rounded-button border border-line-input bg-surface px-4 text-sm font-bold text-ink hover:border-ink"
        >
          {labels.dismiss}
        </button>
      </div>
    );

  const { title, body } = switchText(prompt, labels, document.documentElement.lang);

  const answer = (startNew: boolean) => {
    const slug = prompt.slug;
    const r = answerSwitch(startNew);
    track('compare_switch_answered', { choice: startNew ? 'start_new' : 'keep', to: prompt.category });
    if (r === 'added') {
      track('compare_added', { slug, category: prompt.category, count: 1 });
      onSay(labels.added.replace('{count}', '1'));
    }
    back(slug);
  };

  return (
    <div
      ref={box}
      role="dialog"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-b`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        answer(false);
      }}
      className="pointer-events-auto w-[min(22rem,calc(100vw-2rem))] rounded-card border border-line-card bg-surface p-4 shadow-dialog outline-none focus-visible:ring-2 focus-visible:ring-accent-button"
    >
      <p id={`${id}-t`} className="font-heading text-[15px] leading-snug font-bold text-ink">
        {title}
      </p>
      <p id={`${id}-b`} className="mt-1 text-sm text-muted">
        {body}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            answer(true);
          }}
          className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {labels.switchStart}
        </button>
        <button
          type="button"
          onClick={() => {
            answer(false);
          }}
          className="press inline-flex min-h-11 items-center rounded-button border border-line-input bg-surface px-4 text-sm font-bold text-ink hover:border-ink"
        >
          {labels.switchKeep}
        </button>
      </div>
    </div>
  );
}
