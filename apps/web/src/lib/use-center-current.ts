import { useEffect, useRef } from 'react';

/** The part of a section bar the centring reads and moves (a real element or a test double). */
export interface CenterBar {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
  getBoundingClientRect(): { left: number };
  querySelector(selector: string): { offsetWidth: number; getBoundingClientRect(): { left: number } } | null;
}

/**
 * Scrolls the bar sideways so its current item (`aria-current="page"`) is in the middle. Only the bar scrolls, never
 * the page, and it is a plain `scrollLeft` change (no animation, so `prefers-reduced-motion` is respected by
 * construction). Does nothing when the items fit.
 */
export function centerCurrentIn(bar: CenterBar): void {
  const current = bar.querySelector('[aria-current="page"]');
  if (!current || bar.scrollWidth <= bar.clientWidth) return;
  const offset =
    current.getBoundingClientRect().left -
    bar.getBoundingClientRect().left -
    (bar.clientWidth - current.offsetWidth) / 2;
  bar.scrollLeft += offset;
}

/**
 * Section bars that scroll sideways on phones (account, admin): bring the current item into the middle of the bar
 * (UI review 2026-11-14: "Serv…" was cut off, later sections were off screen). Runs on load, when the section
 * changes (`key`), when the web fonts arrive (the items get wider and the middle moves) and when keyboard focus
 * leaves the bar (tabbing through the items scrolls the bar to the focused one; audit 2026-11-16, NAV-ADMIN /
 * NAV-ACCOUNT: the current item stayed out of sight).
 */
export function useCenterCurrent<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    let live = true;
    const center = () => {
      if (live) centerCurrentIn(bar);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!(e.relatedTarget instanceof Node) || !bar.contains(e.relatedTarget)) center();
    };
    center();
    void document.fonts.ready.then(center);
    bar.addEventListener('focusout', onFocusOut);
    return () => {
      live = false;
      bar.removeEventListener('focusout', onFocusOut);
    };
  }, [key]);
  return ref;
}
