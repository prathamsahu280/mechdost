'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { SearchData, SearchPanelProps } from './search-data';

/** The phone bar asks the desktop pill (which owns the one palette and its data) to open or to get ready. */
const OPEN_EVENT = 'mechdost:search-open';
const WARM_EVENT = 'mechdost:search-warm';

/**
 * The header's search entry (v4, decision 2026-11-23): a pill that opens the search palette. This part stays tiny: the
 * palette (suggestions, the demo matcher, the API call) is a lazy chunk fetched when the pill is hovered, focused,
 * tapped or the `/` key is pressed (JS budget, spec 16; guard `test/search-budget.test.ts`). Escape or a tap on the
 * dimmed page closes it and focus returns to whatever opened it.
 *
 * `bar` is the desktop pill: it owns the palette and its strings, and listens for `/`. `phone` is the full-width bar
 * under the compact header: it carries no data of its own and asks the pill to open the same palette, so the strings
 * travel in the page once.
 */
export function SearchTrigger(
  props: {
    label: string;
    text: string;
    icon: ReactNode;
  } & ({ variant: 'bar'; data: SearchData; hint: string } | { variant: 'phone' }),
) {
  const { label, text, icon } = props;
  const [Panel, setPanel] = useState<ComponentType<SearchPanelProps> | null>(null);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const loading = useRef(false);
  const isBar = props.variant === 'bar';

  const load = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    void import('./header-search').then((m) => {
      setPanel(() => m.default);
    });
  }, []);

  const show = useCallback(
    (from: HTMLElement | null) => {
      load();
      opener.current = from;
      setOpen(true);
    },
    [load],
  );

  const close = useCallback(() => {
    setOpen(false);
    (opener.current ?? button.current)?.focus();
  }, []);

  useEffect(() => {
    if (!isBar) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
      if (typing) return;
      e.preventDefault();
      show(null);
    };
    const onOpen = (e: Event) => {
      show(e instanceof CustomEvent && e.detail instanceof HTMLElement ? e.detail : null);
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener(WARM_EVENT, load);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener(WARM_EVENT, load);
    };
  }, [isBar, show, load]);

  const warm = isBar ? load : () => window.dispatchEvent(new Event(WARM_EVENT));
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={isBar ? open : undefined}
        data-track={isBar ? 'header_search' : 'header_search_phone'}
        onClick={(e) => {
          if (isBar) show(null);
          else window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: e.currentTarget }));
        }}
        onPointerEnter={warm}
        onFocus={warm}
        className={
          isBar
            ? 'press hidden h-10 min-w-10 shrink items-center justify-center gap-2 rounded-xl border border-transparent bg-pill px-2.5 text-[13.5px] font-semibold text-muted hover:border-line hover:text-ink nav:flex xl:min-w-[190px] xl:justify-start xl:pr-2.5 xl:pl-3'
            : 'press flex h-11 w-full items-center gap-2 rounded-[14px] bg-surface px-3 text-left text-sm text-muted shadow-float'
        }
      >
        <span aria-hidden="true" className="flex">
          {icon}
        </span>
        <span className={isBar ? 'sr-only xl:not-sr-only' : 'truncate'}>{text}</span>
        {props.variant === 'bar' ? (
          <kbd
            aria-hidden="true"
            className="ml-auto hidden rounded-md bg-surface px-1.5 py-0.5 font-sans text-[11px] font-bold text-muted ring-1 ring-line xl:inline"
          >
            {props.hint}
          </kbd>
        ) : null}
      </button>
      {props.variant === 'bar' && open && Panel ? <Panel data={props.data} onClose={close} /> : null}
    </>
  );
}
