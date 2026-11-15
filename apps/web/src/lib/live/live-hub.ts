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

interface Subscription {
  kinds: ReadonlySet<LiveKind>;
  handler: LiveHandler;
}

const subscriptions = new Set<Subscription>();
let consumers = 0;
let stopListener: (() => void) | undefined;
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
 * Ask for the live connection. The first caller starts it (the listener chunk is imported here, never earlier); later
 * callers share it. Returns the release function; the connection closes when the last consumer releases.
 */
export function startLive(locale: string): () => void {
  if (!liveConfigured() || typeof window === 'undefined') return () => undefined;
  consumers += 1;
  if (consumers === 1) {
    const gen = generation;
    void import('./live-listener')
      .then((m) => {
        if (gen !== generation || consumers === 0) return;
        stopListener = m.connectLive({ locale, onKinds: emitLive });
      })
      .catch(() => undefined); // chunk blocked or offline: polling carries on
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    consumers -= 1;
    if (consumers === 0) {
      stopListener?.();
      stopListener = undefined;
    }
  };
}

/** Sign-out: drop the connection and the pings still waiting. */
export function resetLive(): void {
  generation += 1;
  consumers = 0;
  stopListener?.();
  stopListener = undefined;
  clearTimeout(timer);
  pending = new Set();
}
