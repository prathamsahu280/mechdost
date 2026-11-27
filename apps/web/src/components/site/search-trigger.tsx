'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { INLINE_PANEL_ID, STATE_EVENT, type SearchData, type SearchPanelProps } from './search-data';

/** The phone bar asks the desktop pill (which owns the one palette and its data) to open or to get ready. */
const OPEN_EVENT = 'mechdost:search-open';
const WARM_EVENT = 'mechdost:search-warm';

/**
 * The header's search entry (v4, decision 2026-11-23): a pill that opens the search palette. This part stays tiny: the
 * palette (suggestions, the demo matcher, the API call) is a lazy chunk fetched when the pill is hovered, focused,
 * tapped or the `/` key is pressed (JS budget, spec 16; guard `test/search-budget.test.ts`). Escape or a tap on the
 * dimmed page closes it and focus returns to whatever opened it.
 *
 * `bar` is the desktop pill: it owns the palette and its strings, and listens for `/`. `phone` is a 48 px search icon
 * in the compact top bar (founder 2026-11-27 night): it carries no data of its own and asks the pill to open the same
 * palette **inline** (the field covers the top bar, suggestions drop under it, no modal), so the strings travel in the
 * page once. Close or Escape restores the bar and focus returns to the icon.
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
  const [inline, setInline] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
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
    (from: HTMLElement | null, asInline = false) => {
      load();
      opener.current = from;
      setInline(asInline);
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
      // Only the phone icon sends itself as the opener: that open is inline.
      const from = e instanceof CustomEvent && e.detail instanceof HTMLElement ? e.detail : null;
      show(from, from !== null);
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

  // The bar tells the phone icon when the palette opens or closes (its aria-expanded).
  useEffect(() => {
    if (isBar) window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: open }));
  }, [isBar, open]);
  useEffect(() => {
    if (isBar) return undefined;
    const onState = (e: Event) => {
      setPhoneOpen(e instanceof CustomEvent && e.detail === true);
    };
    window.addEventListener(STATE_EVENT, onState);
    return () => {
      window.removeEventListener(STATE_EVENT, onState);
    };
  }, [isBar]);

  const warm = isBar ? load : () => window.dispatchEvent(new Event(WARM_EVENT));
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup={isBar ? 'dialog' : undefined}
        aria-expanded={isBar ? open : phoneOpen}
        aria-controls={isBar ? undefined : INLINE_PANEL_ID}
        data-track={isBar ? 'header_search' : 'header_search_phone'}
        onClick={(e) => {
          if (isBar) show(null);
          else window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: e.currentTarget }));
        }}
        onPointerEnter={warm}
        onFocus={warm}
        className={
          isBar
            ? 'press hidden h-10 min-w-10 shrink items-center justify-center gap-2 rounded-xl border border-transparent bg-pill px-2.5 text-[13.5px] font-semibold text-muted hover:border-line hover:text-ink nav:flex min-[1440px]:min-w-[190px] min-[1440px]:justify-start min-[1440px]:pr-2.5 min-[1440px]:pl-3'
            : 'press grid size-12 shrink-0 place-items-center rounded-xl text-muted hover:bg-pill hover:text-ink nav:hidden'
        }
      >
        <span aria-hidden="true" className="flex">
          {icon}
        </span>
        {isBar ? <span className="sr-only min-[1440px]:not-sr-only">{text}</span> : null}
        {props.variant === 'bar' ? (
          <kbd
            aria-hidden="true"
            className="ml-auto hidden rounded-md bg-surface px-1.5 py-0.5 font-sans text-[11px] font-bold text-muted ring-1 ring-line min-[1440px]:inline"
          >
            {props.hint}
          </kbd>
        ) : null}
      </button>
      {props.variant === 'bar' && open && Panel ? (
        <Panel data={props.data} onClose={close} inline={inline} />
      ) : null}
    </>
  );
}
