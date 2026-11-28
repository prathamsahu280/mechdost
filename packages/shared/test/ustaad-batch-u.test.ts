import { describe, expect, it } from 'vitest';
import { composeNotice, ustaadTopicLabel } from '../src/notice-catalogue';
import en from '../src/i18n/en.json';
import hi from '../src/i18n/hi.json';
import { fixableBlockReason, HOLD_SIGNALS, holdSignalsOf } from '../src/ustaad/moderation';

/** Batch U (Mechanic Network sim rows, 2026-11-28): one regression test per row id. */
describe('SIM-F7: the question-waiting bell words the topic, never the raw code', () => {
  it('a work code and a vehicle code are worded in the reader language', () => {
    expect(ustaadTopicLabel('hi', 'engine')).toBe('इंजन');
    expect(ustaadTopicLabel('en', 'engine')).toBe('Engine');
    expect(ustaadTopicLabel('hi', 'two_wheeler')).toBe('दोपहिया');
    expect(ustaadTopicLabel('en', 'brand_new_code')).toBe('brand_new_code');
  });
  it('the Hindi notice has no Latin code in it', () => {
    const copy = composeNotice('ustaad.question_waiting', 'hi', {
      memberName: 'रमेश',
      topic: ustaadTopicLabel('hi', 'suspension_brakes'),
      questionCode: 'Q-1',
    });
    expect(copy.body).not.toContain('suspension_brakes');
  });
});

describe('SIM-B4: an automatic hold note is worded, not shown as raw codes', () => {
  it('reads the stored signal codes, and only known ones', () => {
    expect(holdSignalsOf('new_account_media')).toEqual(['new_account_media']);
    expect(holdSignalsOf('link,new_account_link')).toEqual(['link', 'new_account_link']);
    expect(holdSignalsOf('call me on the shop number')).toBeNull();
    expect(holdSignalsOf(null)).toBeNull();
  });
  it('every code has an en and a hi label in the console', () => {
    for (const s of HOLD_SIGNALS) {
      expect(en.ustaad.console[`signal_${s}` as keyof typeof en.ustaad.console]).toBeTypeOf('string');
      expect(hi.ustaad.console[`signal_${s}` as keyof typeof hi.ustaad.console]).toBeTypeOf('string');
    }
  });
});

describe('SIM-P15: phone and number-plate blocks name what to remove', () => {
  it('maps the blocking signal to a fixable reason', () => {
    expect(fixableBlockReason('post', ['phone_number'])).toBe('phone');
    expect(fixableBlockReason('question', ['number_plate'])).toBe('plate');
    expect(fixableBlockReason('message', ['phone_number'])).toBeNull();
    expect(fixableBlockReason('post', ['link_denied'])).toBeNull();
  });
});
