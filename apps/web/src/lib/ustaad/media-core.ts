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

/**
 * Video picking (SIM-F6, SIM-P28): phones save `.mov` (iPhone) and `.3gp` / `.3g2` (older Android); all are ISO BMFF
 * like MP4, so they are declared as `video/mp4` and the API checks the real container (and refuses anything else).
 */
export const VIDEO_ACCEPT =
  'video/mp4,video/webm,video/quicktime,video/3gpp,video/3gpp2,.mp4,.m4v,.mov,.webm,.3gp,.3g2';

const MP4_LIKE_TYPES = ['video/mp4', 'video/quicktime', 'video/3gpp', 'video/3gpp2', 'video/x-m4v'];
const MP4_LIKE_EXTS = ['mp4', 'm4v', 'mov', '3gp', '3g2'];

export function videoDeclaredMime(type: string, name: string): 'video/mp4' | 'video/webm' | null {
  const t = baseMime(type);
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (t === 'video/webm' || (!t && ext === 'webm')) return 'video/webm';
  if (MP4_LIKE_TYPES.includes(t) || (!t && MP4_LIKE_EXTS.includes(ext))) return 'video/mp4';
  return null;
}

/** The longest any network video can be (`ustaad.posts.video_max_s` cannot go above 300); the API checks the setting. */
export const VIDEO_HARD_CAP_MS = 300_000;

/** Checked before any upload: an unreadable length (a MediaRecorder WebM without Duration) or over the hard cap. */
export function videoLengthProblem(durationMs: number): 'unknown_length' | 'too_long' | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 'unknown_length';
  if (durationMs > VIDEO_HARD_CAP_MS) return 'too_long';
  return null;
}

/**
 * SIM-P3: repeat a step that is safe to repeat while it fails for a reason that can pass (no answer, a gateway
 * error): three tries, 0.4 s then 1.2 s apart. A real refusal (4xx) is returned at once.
 */
export async function retryTransient<T extends { ok: boolean }>(
  run: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  const gaps = [400, 1200];
  let last = await run();
  for (const gap of gaps) {
    const status = last.ok ? 200 : ((last as { status?: number }).status ?? 0);
    if (last.ok || (status !== 0 && status < 502)) return last;
    await wait(gap);
    last = await run();
  }
  return last;
}
