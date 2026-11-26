import { describe, expect, it } from 'vitest';

import { ustaadScreenText, ustaadStoredOriginal } from '../src/repo/ustaad/screen-text';

describe('ustaadScreenText (security review 2026-11-26: the shown original must be screened too)', () => {
  it('includes the original text that other members can open', () => {
    const text = ustaadScreenText({
      parts: ['Clean title', 'clean body'],
      original: 'pay me on UPI 98xxxx',
      correction: 'auto',
    });
    expect(text).toContain('pay me on UPI 98xxxx');
    expect(text).toContain('clean body');
  });

  it('screens the original even when the client claims no correction', () => {
    expect(ustaadScreenText({ parts: ['x'], original: 'abuse', correction: 'none' })).toContain('abuse');
  });

  it('returns null when there is no text at all', () => {
    expect(ustaadScreenText({ parts: [null, undefined, ''], original: null, correction: 'none' })).toBeNull();
  });
});

describe('ustaadStoredOriginal', () => {
  it('keeps the original only when a correction was applied', () => {
    expect(ustaadStoredOriginal('orig', 'auto')).toBe('orig');
    expect(ustaadStoredOriginal('orig', 'suggested_used')).toBe('orig');
    expect(ustaadStoredOriginal('orig', 'none')).toBeNull();
    expect(ustaadStoredOriginal(undefined, 'auto')).toBeNull();
  });
});
