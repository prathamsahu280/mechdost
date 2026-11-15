import { LIVE_KINDS, type LiveKind } from '@mechdost/shared/live';
import { AUTH_MODE } from '../auth/mode';

/**
 * The tab's single live-update hub (spec 10 "Live updates", decision 2026-11-15). **Light on purpose**: no Firebase
 * import here, so the header, bell and shop screens can use it freely (JS budget, spec 16). The heavy Realtime Database
 * listener (`live-listener.ts`) is fetched with `import()` only after someone signed in, only while the tab is
 * visible, and only once per tab however many consumers ask (reference counted). A ping says "this kind changed";
 * consumers re-read through their existing refresh function (the polling keeps running as the fallback).
 */
export type LiveHandler = (kinds: ReadonlySet<LiveKind>) => void;

export const LIVE_DEBOUNCE_MS = 300;
/** A released connection closes after this grace (an effect that re-runs keeps it). */
export const LIVE_CLOSE_GRACE_MS = 2000;
/** Where `requestIdleCallback` is missing (Safari), the listener is fetched after this pause. */
export const LIVE_IDLE_FALLBACK_MS = 1000;

interface Subscription {
  kinds: ReadonlySet<LiveKind>;
  handler: LiveHandler;
}

const subscriptions = new Set<Subscription>();
let consumers = 0;
let stopListener: (() => void) | undefined;
let cancelStart: (() => void) | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let pending = new Set<LiveKind>();
let timer: ReturnType<typeof setTimeout> | undefined;
/** Bumped by `resetLive`: a listener still loading from an earlier generation is dropped as soon as it arrives. */
let generation = 0;

/** The browser build needs real sign-in and the database URL; otherwise there is nothing to connect (polling only). */
export const liveConfigured = (): boolean =>
  AUTH_MODE === 'firebase' && Boolean(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL);

/** Called by the listener with the kinds a ping announced; consumers hear them after a short pause, merged. */
export function emitLive(kinds: readonly LiveKind[]): void {
  for (const k of kinds) pending.add(k);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const batch = pending;
    pending = new Set();
    for (const s of [...subscriptions]) {
      if ([...batch].some((k) => s.kinds.has(k))) s.handler(batch);
    }
  }, LIVE_DEBOUNCE_MS);
}

/** Run `handler` when any of `kinds` changed. Returns the unsubscribe function. */
export function subscribeLive(kinds: readonly LiveKind[], handler: LiveHandler): () => void {
  const sub: Subscription = { kinds: new Set(kinds.filter((k) => LIVE_KINDS.includes(k))), handler };
  subscriptions.add(sub);
  return () => {
    subscriptions.delete(sub);
  };
}

/**
 * Ask for the live connection. The first caller starts it; later callers share it. The listener chunk is fetched only
 * when the browser is idle **and** the tab is visible (nothing at load, nothing in a background tab). Returns the
 * release function; the connection closes a short grace after the last consumer releases, so an effect that re-runs
 * (release, then start again) keeps it.
 */
export function startLive(locale: string): () => void {
  if (!liveConfigured() || typeof window === 'undefined') return () => undefined;
  consumers += 1;
  clearTimeout(closeTimer);
  if (!stopListener && !cancelStart) begin(locale);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    consumers -= 1;
    if (consumers === 0) {
      closeTimer = setTimeout(() => {
        if (consumers === 0) closeNow();
      }, LIVE_CLOSE_GRACE_MS);
    }
  };
}

function begin(locale: string): void {
  const gen = generation;
  const load = () => {
    cancelStart = undefined;
    if (gen !== generation || consumers === 0 || stopListener) return;
    void import('./live-listener')
      .then((m) => {
        if (gen !== generation || consumers === 0 || stopListener) return;
        stopListener = m.connectLive({ locale, onKinds: emitLive });
      })
      .catch(() => undefined); // chunk blocked or offline: polling carries on
  };
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onVisible);
    load();
  };
  const idle = (fn: () => void): (() => void) => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(fn, { timeout: 3000 });
      return () => {
        window.cancelIdleCallback(id);
      };
    }
    const id = setTimeout(fn, LIVE_IDLE_FALLBACK_MS);
    return () => {
      clearTimeout(id);
    };
  };
  const cancelIdle = idle(() => {
    if (document.visibilityState === 'visible') load();
    else document.addEventListener('visibilitychange', onVisible);
  });
  cancelStart = () => {
    cancelIdle();
    document.removeEventListener('visibilitychange', onVisible);
    cancelStart = undefined;
  };
}

function closeNow(): void {
  cancelStart?.();
  stopListener?.();
  stopListener = undefined;
}

/** Sign-out: drop the connection and the pings still waiting. */
export function resetLive(): void {
  generation += 1;
  consumers = 0;
  clearTimeout(closeTimer);
  closeNow();
  clearTimeout(timer);
  pending = new Set();
}
