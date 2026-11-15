/**
 * The light re-check of the saved cart and wishlist while someone is signed in (user 2026-11-15: "every 60 seconds",
 * phone and laptop at once). Follows the bell's polling pattern: a hidden tab does not poll, coming back (the tab
 * becomes visible, or the window regains focus) checks at once, and a failure backs off (doubling, at most 5 minutes)
 * and returns to 60 s after a success. Two checks never run within 5 seconds of each other. The check itself is a
 * conditional read ("unchanged" is a tiny answer), so this costs almost nothing when nobody changed anything.
 * `startPolling` returns the stop function; the future shared live listener calls the same `refresh` directly.
 */
export const POLL_MS = 60_000;
export const POLL_MAX_MS = 300_000;
export const POLL_MIN_GAP_MS = 5_000;

export function startPolling(refresh: () => Promise<boolean>): () => void {
  let delay = POLL_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = 0;
  let stopped = false;
  const visible = () => document.visibilityState === 'visible';

  const schedule = () => {
    clearTimeout(timer);
    if (stopped || !visible()) return;
    timer = setTimeout(() => {
      void tick();
    }, delay);
  };
  async function tick(): Promise<void> {
    if (stopped || !visible()) return;
    last = Date.now();
    const ok = await refresh().catch(() => false);
    delay = ok ? POLL_MS : Math.min(delay * 2, POLL_MAX_MS);
    schedule();
  }
  const wake = () => {
    if (stopped) return;
    if (!visible()) {
      clearTimeout(timer);
      return;
    }
    if (Date.now() - last >= POLL_MIN_GAP_MS) void tick();
    else schedule();
  };

  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('focus', wake);
  };
}
