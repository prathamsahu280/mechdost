import { useSyncExternalStore } from 'react';

/**
 * The one-shot "you were signed out on this device" note (bug 2026-11-28). Kept apart from `session-ended.ts` so the
 * sign-in cards and the session code can read and clear it without importing anything heavy. It lives in
 * `sessionStorage` (this tab only; gone when the tab closes) and is cleared by the next sign-in.
 */
export const SESSION_ENDED_KEY = 'mechdost-session-ended';
const CHANGED = 'mechdost:session-ended';

export function sessionEndedNow(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_ENDED_KEY) === '1';
  } catch {
    return false;
  }
}

function announce() {
  try {
    window.dispatchEvent(new CustomEvent(CHANGED));
  } catch {
    // No window (tests, server): nothing is listening.
  }
}

export function markSessionEnded(): void {
  try {
    window.sessionStorage.setItem(SESSION_ENDED_KEY, '1');
  } catch {
    // Storage blocked: the sign-in card still shows, only without the note.
  }
  announce();
}

export function clearSessionEnded(): void {
  try {
    window.sessionStorage.removeItem(SESSION_ENDED_KEY);
  } catch {
    // Storage blocked: nothing kept.
  }
  announce();
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
  };
}

/** True while the note should show. Always false during server render and hydration. */
export function useSessionEnded(): boolean {
  return useSyncExternalStore(subscribe, sessionEndedNow, () => false);
}
