import { track } from './analytics';
import { readListPlace, saveListPlace } from './list-place';

/**
 * "Back keeps your place" on the shop list (shopping personalisation phase 2). Loaded with `import()` by the shop
 * list after it mounts (never in a first load). While a list is open, opening a product (a click on a product link)
 * or leaving the page saves the scroll position for the list's address; when the list is opened again by Back or
 * Forward, the position is given back once and `list_position_restored` is recorded. The "Show more" pages come
 * back by themselves: they are in the address (`?pages=N`) and the server renders them.
 */
let lastPop = 0;
let listening = false;

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** A Back/Forward that happened just now (client navigation) or that loaded this document. */
function cameBack(): boolean {
  if (Date.now() - lastPop < 3000) return true;
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === 'back_forward' && performance.now() < 10_000;
  } catch {
    return false;
  }
}

function restore(y: number): void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tries = 0;
  // The list is server-rendered, but images and fonts can still grow the page: try for up to a second.
  const step = () => {
    tries += 1;
    const room = document.documentElement.scrollHeight - window.innerHeight;
    if (room >= y || tries > 20) {
      window.scrollTo({ top: Math.min(y, Math.max(0, room)), behavior: reduce ? 'auto' : 'instant' });
      return;
    }
    window.setTimeout(step, 50);
  };
  step();
}

/** Starts watching the open list; returns the cleanup for the list's effect. */
export function watchListPlace(): () => void {
  if (!listening) {
    listening = true;
    window.addEventListener('popstate', () => {
      lastPop = Date.now();
    });
  }
  const here = () => `${window.location.pathname}${window.location.search}`;
  if (cameBack()) {
    const y = readListPlace(session(), here());
    if (y !== null && y > 0) {
      restore(y);
      const pages = Number(new URLSearchParams(window.location.search).get('pages')) || 1;
      track('list_position_restored', { pages: Math.min(10, Math.max(1, Math.trunc(pages))) });
    }
  }
  const save = () => {
    saveListPlace(session(), here(), window.scrollY);
  };
  const onClick = (e: MouseEvent) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (a && /\/shop\/[^/?#]+/.test(a.getAttribute('href') ?? '')) save();
  };
  document.addEventListener('click', onClick, { capture: true });
  window.addEventListener('pagehide', save);
  return () => {
    document.removeEventListener('click', onClick, { capture: true });
    window.removeEventListener('pagehide', save);
  };
}
