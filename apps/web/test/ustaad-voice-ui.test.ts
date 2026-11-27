import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import {
  createPlaybackRegistry,
  mediaSizeText,
  progressPercent,
  stopOutcome,
  summaryLeft,
  timeLeftToAnnounce,
} from '../src/lib/ustaad/voice-ui';

describe('recorder: Cancel discards, never saves (audit 9; SIM pointer-cancel saved the clip)', () => {
  it('a cancelled take is discarded whatever its length', () => {
    expect(stopOutcome({ cancelled: true, durationMs: 30_000, chunks: 4 })).toBe('discard');
  });
  it('too short or empty is "too short"; otherwise it is kept', () => {
    expect(stopOutcome({ cancelled: false, durationMs: 400, chunks: 1 })).toBe('tooShort');
    expect(stopOutcome({ cancelled: false, durationMs: 5_000, chunks: 0 })).toBe('tooShort');
    expect(stopOutcome({ cancelled: false, durationMs: 5_000, chunks: 2 })).toBe('keep');
  });
});

describe('recorder: time left is announced once, at 10 seconds', () => {
  it('nothing before the last 10 seconds', () => {
    expect(timeLeftToAnnounce(49_000, 60, false)).toBeNull();
  });
  it('announces the seconds left once the last 10 seconds start, only once', () => {
    expect(timeLeftToAnnounce(50_000, 60, false)).toBe(10);
    expect(timeLeftToAnnounce(50_250, 60, false)).toBe(10);
    expect(timeLeftToAnnounce(52_000, 60, true)).toBeNull();
  });
  it('a limit of 10 s or less never announces at the start', () => {
    expect(timeLeftToAnnounce(0, 10, false)).toBeNull();
  });
});

describe('voice note: size, progress and the summary counter', () => {
  it('size in KB under a megabyte, MB above (one decimal)', () => {
    expect(mediaSizeText(40_000)).toEqual({ value: 40, unit: 'kb' });
    expect(mediaSizeText(1_572_864)).toEqual({ value: 1.5, unit: 'mb' });
  });
  it('progress is a whole percent between 0 and 100', () => {
    expect(progressPercent(21, 42)).toBe(50);
    expect(progressPercent(5, 0)).toBe(0);
    expect(progressPercent(50, 42)).toBe(100);
    expect(progressPercent(Number.NaN, 42)).toBe(0);
  });
  it('the summary counter counts down from 200', () => {
    expect(summaryLeft('')).toBe(200);
    expect(summaryLeft('x'.repeat(190))).toBe(10);
  });
});

describe('one player at a time (audit 16)', () => {
  it('starting a player pauses the one before and stops Listen (speechSynthesis)', () => {
    let speechStopped = 0;
    const reg = createPlaybackRegistry(() => {
      speechStopped += 1;
    });
    const log: string[] = [];
    const a = { pause: () => log.push('a paused') };
    const b = { pause: () => log.push('b paused') };
    reg.claim(a);
    expect(log).toEqual([]);
    reg.claim(b);
    expect(log).toEqual(['a paused']);
    expect(speechStopped).toBe(2);
    reg.claim(b);
    expect(log).toEqual(['a paused']);
  });
  it('a released player is not paused later', () => {
    const reg = createPlaybackRegistry(() => undefined);
    const log: string[] = [];
    const a = { pause: () => log.push('a') };
    reg.claim(a);
    reg.release(a);
    reg.claim({ pause: () => log.push('b') });
    expect(log).toEqual([]);
  });
});

describe('copy exists in English and Hindi', () => {
  it('recorder, player, summary and captions strings', () => {
    const keys = [
      'recStopWord',
      'recCancel',
      'recCancelled',
      'recTimeLeft',
      'summaryLabel',
      'summaryHint',
      'summaryLeft',
      'voiceMeta',
      'sizeKb',
      'sizeMb',
      'voiceProgress',
      'voiceFrom',
      'voiceFromYou',
      'captionsLabel',
      'captionsHint',
      'captionsLang',
      'noCaptions',
    ];
    for (const dict of [en, hi]) {
      const ns = (dict.ustaad as unknown as Record<string, Record<string, string>>).media ?? {};
      for (const k of keys) expect(ns[k], k).toBeTruthy();
    }
  });
});
