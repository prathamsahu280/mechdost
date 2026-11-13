import { useEffect, useRef } from 'react';

/**
 * Section bars that scroll sideways on phones (account, admin): bring the current item (`aria-current="page"`)
 * into the middle of the bar (UI review 2026-11-14: "Serv…" was cut off, later sections were off screen). Only the
 * bar scrolls, never the page. `key` re-runs it when the section changes.
 */
export function useCenterCurrent<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const bar = ref.current;
    const current = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !current || bar.scrollWidth <= bar.clientWidth) return;
    const offset =
      current.getBoundingClientRect().left -
      bar.getBoundingClientRect().left -
      (bar.clientWidth - current.offsetWidth) / 2;
    bar.scrollLeft += offset;
  }, [key]);
  return ref;
}
