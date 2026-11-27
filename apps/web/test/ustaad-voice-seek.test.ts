import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { CLIENT_EVENT_SCHEMAS } from '@mechdost/shared/analytics';
import {
  fractionFromPointer,
  keyTarget,
  nextRate,
  parseStoredRate,
  seekSeconds,
  skipTarget,
  valueTextParts,
  waveformHeights,
} from '../src/lib/ustaad/voice-ui';

/**
 * Voice-note player upgrade (founder 2026-11-28: "click to go ahead in the audio time and stuff"; spec 23 § 10b,
 * Bench kit voice player): seek by tap, drag and keys, skip 10 s, speed chip, elapsed / total.
 */
describe('seek: a tap or drag position becomes seconds', () => {
  it('the pointer x inside the bar becomes a fraction, clamped to 0..1', () => {
    expect(fractionFromPointer(150, 100, 200)).toBe(0.25);
    expect(fractionFromPointer(50, 100, 200)).toBe(0);
    expect(fractionFromPointer(400, 100, 200)).toBe(1);
    expect(fractionFromPointer(150, 100, 0)).toBe(0);
  });
  it('right-to-left bars measure from the right edge', () => {
    expect(fractionFromPointer(150, 100, 200, true)).toBe(0.75);
  });
  it('a fraction of the duration, clamped; unknown duration seeks nowhere', () => {
    expect(seekSeconds(0.5, 42)).toBe(21);
    expect(seekSeconds(1.4, 42)).toBe(42);
    expect(seekSeconds(-0.2, 42)).toBe(0);
    expect(seekSeconds(0.5, Number.NaN)).toBe(0);
    expect(seekSeconds(0.5, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('keyboard: the bar is a slider', () => {
  it('Left/Right (and Down/Up) step 5 s, clamped', () => {
    expect(keyTarget('ArrowRight', 10, 42)).toBe(15);
    expect(keyTarget('ArrowUp', 10, 42)).toBe(15);
    expect(keyTarget('ArrowLeft', 10, 42)).toBe(5);
    expect(keyTarget('ArrowDown', 3, 42)).toBe(0);
    expect(keyTarget('ArrowRight', 40, 42)).toBe(42);
  });
  it('Home is the start, End the end, other keys do nothing', () => {
    expect(keyTarget('Home', 20, 42)).toBe(0);
    expect(keyTarget('End', 20, 42)).toBe(42);
    expect(keyTarget('Enter', 20, 42)).toBeNull();
    expect(keyTarget('ArrowRight', 20, Number.NaN)).toBeNull();
  });
  it('the skip buttons move 10 s, clamped', () => {
    expect(skipTarget(20, 10, 42)).toBe(30);
    expect(skipTarget(5, -10, 42)).toBe(0);
    expect(skipTarget(38, 10, 42)).toBe(42);
  });
});

describe('speed chip 1× → 1.5× → 2× → 1×, remembered per viewer', () => {
  it('cycles', () => {
    expect(nextRate(1)).toBe(1.5);
    expect(nextRate(1.5)).toBe(2);
    expect(nextRate(2)).toBe(1);
    expect(nextRate(3)).toBe(1);
  });
  it('a stored value is trusted only if it is one of the three speeds', () => {
    expect(parseStoredRate('1.5')).toBe(1.5);
    expect(parseStoredRate('2')).toBe(2);
    expect(parseStoredRate('16')).toBe(1);
    expect(parseStoredRate(null)).toBe(1);
    expect(parseStoredRate('abc')).toBe(1);
  });
});

describe('slider value text and the waveform', () => {
  it('elapsed and total as clock text, elapsed never past total', () => {
    expect(valueTextParts(12.4, 42)).toEqual({ elapsed: '0:12', total: '0:42' });
    expect(valueTextParts(50, 42)).toEqual({ elapsed: '0:42', total: '0:42' });
    expect(valueTextParts(Number.NaN, 65)).toEqual({ elapsed: '0:00', total: '1:05' });
  });
  it('30 bars, the same for the same note, inside 20–100 %', () => {
    const a = waveformHeights('0193-abc');
    expect(a).toHaveLength(30);
    expect(waveformHeights('0193-abc')).toEqual(a);
    expect(waveformHeights('0193-abd')).not.toEqual(a);
    for (const h of a) {
      expect(h).toBeGreaterThanOrEqual(20);
      expect(h).toBeLessThanOrEqual(100);
    }
  });
});

describe('copy and events', () => {
  it('player strings exist in English and Hindi', () => {
    const keys = [
      'voiceSeek',
      'voiceValueText',
      'voiceBack10',
      'voiceForward10',
      'voiceSpeed',
      'voiceElapsed',
    ];
    for (const dict of [en, hi]) {
      const ns = (dict.ustaad as unknown as Record<string, Record<string, string>>).media ?? {};
      for (const k of keys) expect(ns[k], k).toBeTruthy();
    }
  });
  it('seek and speed events carry only a method, seconds and the speed', () => {
    const schemas = CLIENT_EVENT_SCHEMAS as unknown as Record<
      string,
      { safeParse: (v: unknown) => { success: boolean } }
    >;
    expect(schemas.ustaad_voice_seeked?.safeParse({ via: 'drag', seconds: 12 }).success).toBe(true);
    expect(schemas.ustaad_voice_seeked?.safeParse({ via: 'drag', seconds: 12, mediaId: 'x' }).success).toBe(
      false,
    );
    expect(schemas.ustaad_voice_speed_changed?.safeParse({ rate: '1.5' }).success).toBe(true);
    expect(schemas.ustaad_voice_speed_changed?.safeParse({ rate: '3' }).success).toBe(false);
  });
});

describe('source: the bar is a keyboard slider with its value in words', () => {
  const src = readFileSync(join(__dirname, '../src/components/ustaad/media/voice-note.tsx'), 'utf8');
  it('role=slider with min, max, now and valuetext', () => {
    expect(src).toContain('role="slider"');
    for (const a of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext', 'onKeyDown'])
      expect(src).toContain(a);
  });
  it('pointer seeking (no hover-only), skip buttons and speed chip with words for screen readers', () => {
    expect(src).toContain('onPointerDown');
    expect(src).toContain('setPointerCapture');
    expect(src).toContain("t('voiceBack10')");
    expect(src).toContain("t('voiceForward10')");
    expect(src).toContain("t('voiceSpeed'");
    expect(src).toContain('localStorage');
  });
});
