/**
 * Text alternatives for voice and video (founder 2026-11-27 night; spec 23 § 10a; WCAG 1.2.1 / 1.2.2). The author types
 * a short summary for any voice item or video, and captions for a video: either "time — text" lines or one block shown
 * for the whole clip. Nothing is transcribed automatically (no speech-to-text provider is wired, Q-STT-1). Captions
 * are stored as the author typed them; the WebVTT file is built from them here when served.
 */
import { z } from 'zod';

export const MEDIA_SUMMARY_MAX = 200;
/** Typed captions, raw (a 3-minute clip of short lines fits easily). */
export const MEDIA_CAPTIONS_MAX = 4000;
export const CAPTION_LANGS = ['hi', 'en'] as const;
export type CaptionLang = (typeof CAPTION_LANGS)[number];

/** Optional; blank after trimming means "no summary". */
export const MediaSummaryDto = z
  .string()
  .max(MEDIA_SUMMARY_MAX * 2)
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().max(MEDIA_SUMMARY_MAX))
  .transform((s) => (s === '' ? undefined : s));

export const MediaCaptionsDto = z
  .object({
    lang: z.enum(CAPTION_LANGS),
    text: z.string().trim().min(1).max(MEDIA_CAPTIONS_MAX),
  })
  .strict();

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
}

// "0:05 — text", "00:01:02 - text", "1:02 – text" (em dash, en dash or hyphen).
const TIMED = /^\s*(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\s*[—–-]\s*(.*)$/;

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** The cues an author's typed captions describe, clamped to the clip (`durationMs`). */
export function parseCaptionLines(text: string, durationMs: number): CaptionCue[] {
  const end = Math.max(1, durationMs);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const timed: { startMs: number; text: string }[] = [];
  for (const l of lines) {
    const m = TIMED.exec(l);
    if (m) {
      const ms = (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
      timed.push({ startMs: ms, text: oneLine(m[4] ?? '') });
    } else if (timed.length > 0) {
      const last = timed[timed.length - 1];
      if (last) last.text = oneLine(`${last.text} ${l}`);
    }
  }
  if (timed.length === 0) {
    const all = oneLine(lines.join(' '));
    return all ? [{ startMs: 0, endMs: end, text: all }] : [];
  }
  // Times run forward and stay inside the clip; a line that would start at or past the end is dropped.
  const cues: CaptionCue[] = [];
  let floor = 0;
  for (const t of timed) {
    const start = Math.min(Math.max(t.startMs, floor), end);
    if (start >= end || t.text === '') continue;
    cues.push({ startMs: start, endMs: end, text: t.text });
    floor = start;
  }
  for (let i = 0; i < cues.length - 1; i += 1) {
    const cur = cues[i];
    const next = cues[i + 1];
    if (cur && next) cur.endMs = Math.max(next.startMs, cur.startMs + 1);
  }
  return cues.filter((c) => c.endMs > c.startMs);
}

function stamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`;
}

function escapeCue(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/-->/g, '→');
}

/** A WebVTT file for `<track kind="captions">`; text is escaped (no markup, no stray cue arrows). */
export function buildWebVtt(text: string, durationMs: number): string {
  const cues = parseCaptionLines(text.replace(/-->/g, '→'), durationMs);
  const body = cues
    .map((c, i) => `${String(i + 1)}\n${stamp(c.startMs)} --> ${stamp(c.endMs)}\n${escapeCue(c.text)}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/** The words moderation screens (summary + caption text without timestamps), or null when there are none. */
export function mediaTextForScreen(m: { summary: string | null; captions: string | null }): string | null {
  const parts: string[] = [];
  if (m.summary) parts.push(m.summary);
  if (m.captions) {
    const cues = parseCaptionLines(m.captions, 24 * 3_600_000);
    parts.push(cues.map((c) => c.text).join('\n'));
  }
  const out = parts.filter((p) => p !== '').join('\n');
  return out === '' ? null : out;
}
