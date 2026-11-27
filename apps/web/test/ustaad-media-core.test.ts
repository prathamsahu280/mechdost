import { describe, expect, it } from 'vitest';
import {
  baseMime,
  VIDEO_ACCEPT,
  videoDeclaredMime,
  videoLengthProblem,
  clockText,
  fitWithin,
  isHold,
  pickRecorderMime,
  recordedMs,
} from '../src/lib/ustaad/media-core';

describe('pickRecorderMime (voice notes, spec 23 § 10)', () => {
  it('prefers Opus in WebM and declares the plain MIME the API allows', () => {
    const r = pickRecorderMime((t) => t.startsWith('audio/webm'));
    expect(r).toEqual({ recordAs: 'audio/webm;codecs=opus', declare: 'audio/webm' });
  });
  it('falls back to Ogg, then MP4 (Safari)', () => {
    expect(pickRecorderMime((t) => t.startsWith('audio/ogg'))?.declare).toBe('audio/ogg');
    expect(pickRecorderMime((t) => t === 'audio/mp4')?.declare).toBe('audio/mp4');
  });
  it('returns null when the browser can record none of them', () => {
    expect(pickRecorderMime(() => false)).toBeNull();
  });
});

describe('baseMime', () => {
  it('strips codec parameters and case', () => {
    expect(baseMime('Audio/WebM; codecs=opus')).toBe('audio/webm');
  });
});

describe('fitWithin (photos are shrunk on the phone)', () => {
  it('scales the long edge down to the limit and keeps the ratio', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });
  it('never scales a small picture up', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
  it('never returns a zero side', () => {
    expect(fitWithin(10_000, 1, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe('hold-to-talk with a tap fallback', () => {
  it('a press shorter than 350 ms is a tap (start, then tap again to stop)', () => {
    expect(isHold(200)).toBe(false);
    expect(isHold(350)).toBe(true);
  });
  it('the recorded length is capped at the setting', () => {
    expect(recordedMs(0, 95_000, 90)).toBe(90_000);
    expect(recordedMs(1_000, 4_000, 90)).toBe(3_000);
    expect(recordedMs(5_000, 4_000, 90)).toBe(0);
  });
  it('clock text is m:ss', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(7_400)).toBe('0:07');
    expect(clockText(83_000)).toBe('1:23');
  });
});

// SIM-F6 / SIM-P28 (live QA 2026-11-27): the picker hid iPhone .mov and Android .3gp; a MediaRecorder WebM without a
// length went up and came back as a network error.
describe('video picking (SIM-F6, SIM-P28)', () => {
  it('accepts .mov and .3gp/.3g2 and declares them as MP4 (the API checks the real container)', () => {
    expect(VIDEO_ACCEPT).toContain('video/quicktime');
    expect(VIDEO_ACCEPT).toContain('.3gp');
    expect(VIDEO_ACCEPT).toContain('.3g2');
    expect(videoDeclaredMime('video/quicktime', 'IMG_0001.MOV')).toBe('video/mp4');
    expect(videoDeclaredMime('video/3gpp', 'VID.3gp')).toBe('video/mp4');
    expect(videoDeclaredMime('', 'clip.3g2')).toBe('video/mp4');
    expect(videoDeclaredMime('video/webm', 'rec.webm')).toBe('video/webm');
    expect(videoDeclaredMime('video/x-msvideo', 'a.avi')).toBeNull();
  });
  it('a video whose length cannot be read, or that is over the hard cap, is stopped before the upload', () => {
    expect(videoLengthProblem(0)).toBe('unknown_length');
    expect(videoLengthProblem(301_000)).toBe('too_long');
    expect(videoLengthProblem(60_000)).toBeNull();
  });
});
