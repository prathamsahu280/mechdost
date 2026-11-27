/**
 * Pure parts of the voice recorder and player upgrade (founder 2026-11-27 night; spec 23 § 10a; audit items 9 and 16):
 * Cancel discards, the time left is announced once at 10 s, size and progress text, the summary counter, and the
 * one-player-at-a-time registry. No DOM here, so it is unit-tested in Node.
 */
import { MEDIA_SUMMARY_MAX } from '@mechdost/shared/ustaad/media-text';

const MIN_MS = 700;
const ANNOUNCE_AT_S = 10;

/** What a stopped recording becomes: Cancel (or a pointer taken away mid-hold) never saves. */
export function stopOutcome(r: {
  cancelled: boolean;
  durationMs: number;
  chunks: number;
}): 'discard' | 'tooShort' | 'keep' {
  if (r.cancelled) return 'discard';
  if (r.durationMs < MIN_MS || r.chunks === 0) return 'tooShort';
  return 'keep';
}

/** Seconds left to announce once the last 10 seconds start (once per take), else null. */
export function timeLeftToAnnounce(elapsedMs: number, maxSeconds: number, announced: boolean): number | null {
  if (announced || maxSeconds <= ANNOUNCE_AT_S) return null;
  const leftMs = maxSeconds * 1000 - elapsedMs;
  if (leftMs > ANNOUNCE_AT_S * 1000 || leftMs <= 0) return null;
  return Math.ceil(leftMs / 1000);
}

/** File size for the play button: whole KB under a megabyte, MB with one decimal above. */
export function mediaSizeText(bytes: number): { value: number; unit: 'kb' | 'mb' } {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return { value: Math.round(mb * 10) / 10, unit: 'mb' };
  return { value: Math.max(1, Math.round(bytes / 1000)), unit: 'kb' };
}

export function progressPercent(current: number, duration: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((current / duration) * 100)));
}

export function summaryLeft(text: string): number {
  return MEDIA_SUMMARY_MAX - text.length;
}

export interface Pausable {
  pause: () => void;
}

/** Only one voice note, video or Listen plays at a time: claiming pauses the previous one and stops speech. */
export function createPlaybackRegistry(stopSpeech: () => void) {
  let current: Pausable | null = null;
  return {
    claim(p: Pausable) {
      if (current === p) return;
      stopSpeech();
      const prev = current;
      current = p;
      prev?.pause();
    },
    release(p: Pausable) {
      if (current === p) current = null;
    },
  };
}

/** The page-wide registry (browser only; Listen uses `speechSynthesis`). */
export const playback = createPlaybackRegistry(() => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
});
