/**
 * Pure parts of the voice recorder and player upgrade (founder 2026-11-27 night; spec 23 § 10a; audit items 9 and 16):
 * Cancel discards, the time left is announced once at 10 s, size and progress text, the summary counter, and the
 * one-player-at-a-time registry. No DOM here, so it is unit-tested in Node.
 */
import { MEDIA_SUMMARY_MAX } from '@mechdost/shared/ustaad/media-text';
import { clockText } from './media-core';

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

/*
 * Player controls (founder 2026-11-28: "click to go ahead in the audio time and stuff"; spec 23 § 10b, Bench kit
 * voice player): seek by tap, drag or keys, skip 10 s, speed chip, elapsed / total, a 30-bar waveform look.
 */
export const KEY_STEP_S = 5;
export const SKIP_S = 10;
export const VOICE_RATES = [1, 1.5, 2] as const;
export type VoiceRate = (typeof VOICE_RATES)[number];
export const VOICE_RATE_KEY = 'mechdost-voice-rate';
const BARS = 30;

function known(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

function clampTime(t: number, duration: number): number {
  return Math.min(duration, Math.max(0, Number.isFinite(t) ? t : 0));
}

/** Where a pointer sits inside the bar, 0..1 (measured from the right edge in a right-to-left layout). */
export function fractionFromPointer(clientX: number, left: number, width: number, rtl = false): number {
  if (!(width > 0)) return 0;
  const f = Math.min(1, Math.max(0, (clientX - left) / width));
  return rtl ? 1 - f : f;
}

/** A fraction of the duration in seconds; an unknown duration (not loaded, live stream) seeks to 0. */
export function seekSeconds(fraction: number, duration: number): number {
  if (!known(duration)) return 0;
  return clampTime(fraction * duration, duration);
}

/** The slider's keys: arrows step 5 s, Home/End jump to the ends; null = not ours (let it through). */
export function keyTarget(key: string, current: number, duration: number): number | null {
  if (!known(duration)) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clampTime(current + KEY_STEP_S, duration);
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampTime(current - KEY_STEP_S, duration);
    case 'Home':
      return 0;
    case 'End':
      return duration;
    default:
      return null;
  }
}

export function skipTarget(current: number, delta: number, duration: number): number {
  return clampTime(current + delta, duration);
}

export function nextRate(rate: number): VoiceRate {
  const i = VOICE_RATES.indexOf(rate as VoiceRate);
  return i === -1 ? 1 : (VOICE_RATES[(i + 1) % VOICE_RATES.length] ?? 1);
}

/** A remembered speed is used only if it is one of the three offered. */
export function parseStoredRate(raw: string | null): VoiceRate {
  const n = Number(raw);
  return VOICE_RATES.find((r) => r === n) ?? 1;
}

/** The slider's words: "0:12 of 0:42" (the template is in the locale files). */
export function valueTextParts(current: number, duration: number): { elapsed: string; total: string } {
  const total = known(duration) ? duration : 0;
  const elapsed = Math.min(total, Math.max(0, Number.isFinite(current) ? current : 0));
  return { elapsed: clockText(elapsed * 1000), total: clockText(total * 1000) };
}

/** A decorative waveform: 30 bar heights (20–100 %) derived from the media id, the same on every render. */
export function waveformHeights(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < BARS; i += 1) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) ^ i;
    out.push(20 + ((h >>> 0) % 81));
  }
  return out;
}
