'use client';

import { isPortalPath } from '@/lib/portal-path';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { cleanLabel, startNew, toPrompt, type CompareAsk, type ComparePrompt } from '@/lib/compare/prompt';
import { nameIn, switchText, type SwitchLabels } from '@/lib/compare/prompt-text';
import { signal } from '@/lib/compare/signal';
import { COMPARE_TRAY_MIN, trayVisible } from '@/lib/compare/tray-visible';
import { clearCompare, compareHref, readCompare, useCompare } from '@/lib/compare/store';
import { focusInView } from '@/lib/focus-in-view';

export interface CompareTrayLabels extends SwitchLabels {
  label: string;
  /** "Compare ({count})": the island fills {count}. */
  link: string;
  clear: string;
  switchStart: string;
  switchKeep: string;
  /** "Added to compare ({count} of 4)", read out after "Start new". */
  added: string;
  full: string;
  saveFailed: string;
  dismiss: string;
}

/** Focus the first element that is still on the page. */
function focusFirst(...targets: (HTMLElement | null | undefined)[]) {
  targets.find((t) => t?.isConnected)?.focus();
}

/**
 * The small "Compare (2)" bar (design 2026-11-13). On every page (locale layout), only while something is picked
 * or something is being asked. Kept small on phones (Baymard: a big compare panel hid half the screen):
 * bottom-left above the tab bar, never under the assistant button (bottom-right; the bar leaves it room and the
 * button steps aside while a question is open — review 2026-11-14, I2).
 *
 * Redesign 2026-11-14: the one place that asks or tells about the compare list (and cart limits on cards). Picking
 * another category opens a question above the bar ("Start a new comparison with Batteries? This removes 1
 * Lubricants item." — "Start new" / "Keep current"); a fifth product, a refused save or a cart limit is told here.
 * Not a modal: focus moves to the question and back to the control that asked; Escape keeps the current list; the
 * outcome is read out. A question never outlives the page it was asked on (I1).
 */
export function CompareTray({
  labels,
  prefix,
  request,
}: {
  labels: CompareTrayLabels;
  /** '' or '/hi', from the server. */
  prefix: string;
  request: CompareAsk | null;
}) {
  const list = useCompare();
  const pathname = usePathname();
  const [prompt, setPrompt] = useState<ComparePrompt | null>(null);
  const shown = useRef<{ request: CompareAsk | null; list: unknown; pathname: string }>({
    request: null,
    list,
    pathname,
  });
  const origin = useRef<HTMLElement | null>(null);
  const tray = useRef<HTMLElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const hidden = /\/(compare|checkout)\/?$/.test(pathname) || isPortalPath(pathname);

  // A new request opens its prompt; a change to the list or a new page closes whatever was open.
  useEffect(() => {
    const seen = shown.current;
    if (request !== seen.request) {
      seen.request = request;
      const next = request ? toPrompt(request, readCompare()) : null;
      if (next) {
        origin.current = request?.origin ?? null;
        seen.list = list;
        seen.pathname = pathname;
        setPrompt(next);
        if (next.kind === 'switch')
          track('compare_switch_prompted', { from: next.from, to: next.category, count: next.fromCount });
        else if (next.kind !== 'notice') track('compare_limit_shown', { reason: next.kind });
        if (next.kind !== 'switch') signal({ say: noticeText(next, labels) });
        return;
      }
    }
    if (list !== seen.list || pathname !== seen.pathname) {
      seen.list = list;
      seen.pathname = pathname;
      setPrompt(null);
    }
  }, [request, list, pathname, labels]);

  // While something is open: the assistant button steps aside (CSS), Escape anywhere keeps the current list.
  useEffect(() => {
    if (!prompt) return undefined;
    const root = document.documentElement;
    root.dataset.comparePrompt = '';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      delete root.dataset.comparePrompt;
      window.removeEventListener('keydown', onKey);
    };
  }, [prompt]);

  // Focus never ends up under the tray (WCAG 2.4.11): its height is published for the page's scroll padding.
  const visible = trayVisible({ count: list.slugs.length, hiddenPage: hidden, asking: prompt !== null });
  useEffect(() => {
    const el = tray.current;
    const root = document.documentElement;
    if (!visible || !el) return undefined;
    const set = () => {
      root.style.setProperty('--tray-h', `${String(Math.ceil(el.getBoundingClientRect().height))}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--tray-h');
    };
  }, [visible]);

  function close(startNewList: boolean) {
    const p = prompt;
    if (!p) return;
    const slug = p.kind === 'switch' ? p.slug : null;
    if (p.kind === 'switch') {
      track('compare_switch_answered', { choice: startNewList ? 'start_new' : 'keep', to: p.category });
      if (startNewList) {
        const r = startNew(p);
        if (r === 'added') {
          track('compare_added', { slug: p.slug, category: p.category, count: 1 });
          signal({ say: labels.added.replace('{count}', '1') });
        } else {
          setPrompt({ kind: 'save_failed' });
          signal({ say: labels.saveFailed });
          return;
        }
      }
    }
    // Only if focus was in the tray (or lost): Escape while working elsewhere on the page leaves focus there.
    const active = document.activeElement;
    const own = active === document.body || (tray.current?.contains(active) ?? false);
    setPrompt(null);
    // Back to the control that asked (Safari does not focus a clicked button: the toggle passes itself), else
    // that product's toggle, else the tray's link.
    if (own)
      focusFirst(
        origin.current,
        slug ? document.querySelector<HTMLElement>(`[data-compare-toggle="${CSS.escape(slug)}"]`) : null,
        link.current,
        document.getElementById('content'),
      );
  }

  const closeRef = useRef(close);
  closeRef.current = close;

  if (!visible) return null;
  const category = nameIn(cleanLabel(list.name, list.lang).name, list.lang, document.documentElement.lang);

  return (
    <aside
      ref={tray}
      data-compare-tray=""
      data-prompt={prompt ? '' : undefined}
      aria-label={labels.label}
      // The tray's box lets clicks through: only the bar and the panel take them.
      className="pointer-events-none fixed bottom-[calc(84px+env(safe-area-inset-bottom))] left-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-start gap-2 nav:bottom-6 nav:left-6"
    >
      {prompt ? (
        <Panel
          prompt={prompt}
          labels={labels}
          onAnswer={(startNewList) => {
            close(startNewList);
          }}
        />
      ) : null}
      {list.slugs.length >= COMPARE_TRAY_MIN ? (
        // Below the desktop layout the bar ends before the assistant button (52 px at the right edge, I2).
        <div
          data-slot="compare-bar"
          className="pointer-events-auto flex max-w-[calc(100vw-6rem)] items-center gap-1 rounded-pill border border-line-card bg-surface p-1 shadow-dialog nav:max-w-full"
        >
          <NextLink
            ref={link}
            href={prefix + compareHref(list.slugs)}
            data-track="compare_tray_open"
            className="press inline-flex min-h-11 shrink-0 items-center rounded-pill bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover"
          >
            {labels.link.replace('{count}', String(list.slugs.length))}
          </NextLink>
          {category ? (
            <span className="min-w-0 truncate px-1 text-xs font-bold text-muted">{category}</span>
          ) : null}
          <button
            type="button"
            data-track="compare_tray_clear"
            onClick={() => {
              // The tray disappears: focus must not drop to the page's start (review I8).
              const inside = tray.current?.contains(document.activeElement) ?? false;
              clearCompare();
              // A toggle already on screen, else the main region; never the first toggle on the page, which
              // scrolled the shop back to the top (bug 2026-11-24).
              if (inside)
                focusInView(
                  document.querySelectorAll<HTMLElement>('main [data-compare-toggle]'),
                  document.getElementById('content'),
                );
            }}
            className="press inline-flex min-h-11 shrink-0 items-center rounded-pill px-3 text-sm font-bold text-ink hover:bg-surface-alt"
          >
            {labels.clear}
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function noticeText(p: ComparePrompt, labels: CompareTrayLabels): string {
  return p.kind === 'full'
    ? labels.full
    : p.kind === 'save_failed'
      ? labels.saveFailed
      : p.kind === 'notice'
        ? p.text
        : '';
}

const PANEL =
  'pointer-events-auto w-[min(22rem,calc(100vw-2rem))] rounded-card border border-line-card bg-surface shadow-dialog';
const SECONDARY =
  'press inline-flex min-h-11 items-center rounded-button border border-input-border bg-surface px-4 text-sm font-bold text-ink hover:border-ink';

function Panel({
  prompt,
  labels,
  onAnswer,
}: {
  prompt: ComparePrompt;
  labels: CompareTrayLabels;
  onAnswer: (startNew: boolean) => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);

  // The question takes focus (keyboard and screen readers land on it); a notice is read out, focus stays.
  useEffect(() => {
    if (prompt.kind === 'switch') box.current?.focus();
  }, [prompt]);

  if (prompt.kind !== 'switch')
    return (
      <div data-slot="compare-notice" className={`${PANEL} flex items-start gap-3 p-3`}>
        <p className="min-w-0 flex-1 self-center text-sm text-ink">{noticeText(prompt, labels)}</p>
        <button
          type="button"
          onClick={() => {
            onAnswer(false);
          }}
          className={`${SECONDARY} shrink-0`}
        >
          {labels.dismiss}
        </button>
      </div>
    );

  const { title, body } = switchText(prompt, labels, document.documentElement.lang);
  return (
    <div
      ref={box}
      role="dialog"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-b`}
      tabIndex={-1}
      data-slot="compare-question"
      className={`${PANEL} p-4 outline-none focus-visible:ring-2 focus-visible:ring-accent-button`}
    >
      <h2 id={`${id}-t`} className="font-heading text-[15px] leading-snug font-bold text-ink">
        {title}
      </h2>
      <p id={`${id}-b`} className="mt-1 text-sm text-muted">
        {body}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            onAnswer(true);
          }}
          className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {labels.switchStart}
        </button>
        <button
          type="button"
          onClick={() => {
            onAnswer(false);
          }}
          className={SECONDARY}
        >
          {labels.switchKeep}
        </button>
      </div>
    </div>
  );
}
