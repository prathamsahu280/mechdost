/**
 * Moves focus after something the focus was in disappears (a tray closing, a list clearing) without moving the page
 * (bug 2026-11-24: Clear in the compare tray scrolled the shop up to the first product). Focus goes to the first
 * candidate already on screen, else to the fallback (usually `#content`), always with `preventScroll`.
 */
export function focusInView(
  candidates: Iterable<HTMLElement | null | undefined>,
  fallback: HTMLElement | null | undefined,
  viewportHeight: number = typeof window === 'undefined' ? 0 : window.innerHeight,
): HTMLElement | null {
  for (const c of candidates) {
    if (!c?.isConnected) continue;
    const r = c.getBoundingClientRect();
    if (r.bottom > 0 && r.top < viewportHeight) {
      c.focus({ preventScroll: true });
      return c;
    }
  }
  if (fallback?.isConnected) {
    fallback.focus({ preventScroll: true });
    return fallback;
  }
  return null;
}
