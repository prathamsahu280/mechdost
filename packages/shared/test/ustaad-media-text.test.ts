import { describe, expect, it } from 'vitest';
import { DeclareMediaDto } from '../src/ustaad/dto/media';
import {
  MEDIA_SUMMARY_MAX,
  buildWebVtt,
  mediaTextForScreen,
  parseCaptionLines,
} from '../src/ustaad/media-text';

const audio = {
  kind: 'audio',
  mime: 'audio/webm',
  bytes: 1000,
  sha256: 'a'.repeat(64),
  durationMs: 42_000,
};
const video = { ...audio, kind: 'video', mime: 'video/mp4' };

describe('voice and video text alternatives (founder 2026-11-27 night; WCAG 1.2.1 / 1.2.2)', () => {
  it('a voice note may carry a short typed summary (≤ 200 characters, trimmed)', () => {
    const ok = DeclareMediaDto.safeParse({ ...audio, summary: '  Clutch plate slipping, Splendor 2019  ' });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.summary).toBe('Clutch plate slipping, Splendor 2019');
    expect(DeclareMediaDto.safeParse({ ...audio, summary: 'x'.repeat(MEDIA_SUMMARY_MAX + 1) }).success).toBe(
      false,
    );
  });
  it('an empty summary is no summary', () => {
    const r = DeclareMediaDto.safeParse({ ...audio, summary: '   ' });
    expect(r.success && r.data.summary).toBe(undefined);
  });
  it('photos and PDFs take no summary; only videos take captions', () => {
    expect(
      DeclareMediaDto.safeParse({
        kind: 'image',
        mime: 'image/webp',
        bytes: 10,
        sha256: 'a'.repeat(64),
        summary: 'x',
      }).success,
    ).toBe(false);
    expect(DeclareMediaDto.safeParse({ ...audio, captions: { lang: 'hi', text: 'नमस्ते' } }).success).toBe(
      false,
    );
    expect(DeclareMediaDto.safeParse({ ...video, captions: { lang: 'hi', text: 'नमस्ते' } }).success).toBe(
      true,
    );
    expect(DeclareMediaDto.safeParse({ ...video, captions: { lang: 'fr', text: 'x' } }).success).toBe(false);
  });

  it('"time — text" lines become cues that run to the next line (the last to the end of the clip)', () => {
    expect(parseCaptionLines('0:00 — Engine start\n0:05 - Listen to the knock\n1:02 – Done', 70_000)).toEqual(
      [
        { startMs: 0, endMs: 5000, text: 'Engine start' },
        { startMs: 5000, endMs: 62_000, text: 'Listen to the knock' },
        { startMs: 62_000, endMs: 70_000, text: 'Done' },
      ],
    );
  });
  it('one block without times is one caption for the whole clip', () => {
    expect(parseCaptionLines('Brake pads changed\non an Activa', 30_000)).toEqual([
      { startMs: 0, endMs: 30_000, text: 'Brake pads changed on an Activa' },
    ]);
  });
  it('builds a valid WebVTT file and escapes markup and cue arrows', () => {
    const vtt = buildWebVtt('0:00 — <b>tip</b> & trick --> more\n0:03 — next', 6000);
    expect(vtt).toBe(
      'WEBVTT\n\n1\n00:00:00.000 --> 00:00:03.000\n&lt;b&gt;tip&lt;/b&gt; &amp; trick → more\n\n2\n00:00:03.000 --> 00:00:06.000\nnext\n',
    );
  });
  it('out-of-order or past-the-end times are clamped, never a negative cue', () => {
    const cues = parseCaptionLines('0:10 — late\n0:02 — early\n9:00 — after', 12_000);
    for (const c of cues) expect(c.endMs).toBeGreaterThan(c.startMs);
    expect(cues.every((c) => c.endMs <= 12_000)).toBe(true);
  });
  it('the moderation screen reads the summary and caption words, not the timestamps', () => {
    expect(mediaTextForScreen({ summary: 'call 98765 43210', captions: '0:00 — pay on upi' })).toBe(
      'call 98765 43210\npay on upi',
    );
    expect(mediaTextForScreen({ summary: null, captions: null })).toBe(null);
  });
});

describe('analytics for typed summaries and captions (hard rule 9; flags only, never the text)', () => {
  it('the client catalogue has ustaad_media_text_added and refuses text in its props', async () => {
    const { USTAAD_CLIENT_EVENT_SCHEMAS } = await import('../src/ustaad/analytics');
    const s = (
      USTAAD_CLIENT_EVENT_SCHEMAS as Record<string, { safeParse: (v: unknown) => { success: boolean } }>
    ).ustaad_media_text_added;
    expect(s).toBeDefined();
    expect(s?.safeParse({ kind: 'video', summary: true, captions: true }).success).toBe(true);
    expect(s?.safeParse({ kind: 'audio', summary: true, captions: false, text: 'hello' }).success).toBe(
      false,
    );
  });
});

describe('read DTOs carry the text alternative to the players', () => {
  it('post media keeps summary, caption language and the built WebVTT', async () => {
    const { PostMediaViewDto } = await import('../src/ustaad/dto/feed');
    const v = PostMediaViewDto.parse({
      mediaId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      kind: 'video',
      role: null,
      position: 0,
      durationMs: 6000,
      width: null,
      height: null,
      bytes: 10,
      lqip: null,
      summary: 'Brake pads',
      captionsLang: 'hi',
      captionsVtt: 'WEBVTT\n\n',
    });
    expect(v.summary).toBe('Brake pads');
    expect(v.captionsVtt).toBe('WEBVTT\n\n');
  });
  it('answers, questions and messages carry voice info (duration, size, summary)', async () => {
    const { VoiceInfoDto } = await import('../src/ustaad/dto/media');
    expect(VoiceInfoDto.parse({ durationMs: 42_000, bytes: 30_000, summary: null })).toEqual({
      durationMs: 42_000,
      bytes: 30_000,
      summary: null,
    });
  });
});
