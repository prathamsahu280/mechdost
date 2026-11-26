/**
 * Pure parts of the Ustaad media components (spec 23 § 10; plan A4/C1): which audio format the phone records in, how
 * far a photo is shrunk before upload, and the hold-to-talk timing. No DOM here, so it is unit-tested in Node.
 */

/** The MIME types the API accepts for a voice note (`MEDIA_MIMES.audio`), in order of preference. */
const RECORDER_CHOICES = [
  { recordAs: 'audio/webm;codecs=opus', declare: 'audio/webm' },
  { recordAs: 'audio/webm', declare: 'audio/webm' },
  { recordAs: 'audio/ogg;codecs=opus', declare: 'audio/ogg' },
  { recordAs: 'audio/mp4', declare: 'audio/mp4' },
] as const;

export type RecorderMime = (typeof RECORDER_CHOICES)[number];

/** The first format this browser can record, or null (then the composer offers typing only). */
export function pickRecorderMime(isSupported: (type: string) => boolean): RecorderMime | null {
  return RECORDER_CHOICES.find((c) => isSupported(c.recordAs)) ?? null;
}

/** `audio/webm;codecs=opus` → `audio/webm` (the declared MIME must match the API's list exactly). */
export function baseMime(type: string): string {
  return (type.split(';')[0] ?? '').trim().toLowerCase();
}

/** Shrinks so the long edge is at most `max`; never enlarges; sides are whole pixels, at least 1. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** A press this long or longer is "hold to talk" (release sends); shorter is a tap (tap again to stop). */
export const HOLD_MS = 350;
export function isHold(pressMs: number): boolean {
  return pressMs >= HOLD_MS;
}

/** Recorded length in ms between start and stop, capped at the network's limit (`qa.voice_max_s`). */
export function recordedMs(startedAt: number, stoppedAt: number, maxSeconds: number): number {
  return Math.min(Math.max(0, stoppedAt - startedAt), maxSeconds * 1000);
}

/** `m:ss` for the recording timer. */
export function clockText(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}
