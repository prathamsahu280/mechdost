import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { REPORT_REASONS } from '@mechdost/shared/ustaad/codes';
import { STANDING_ACTIONS } from '@mechdost/shared/ustaad/dto/moderation';
import { standingReasonKey, standingSummary } from '../src/lib/ustaad/standing-view';

const base = { restrictedUntil: null, bannedUntil: null, restrictedMode: 'none', items: [] };

describe('member standing (SIM-P19 / SIM-P23 / SIM-P27)', () => {
  it('a reason code becomes a plain label key, never the raw code', () => {
    expect(standingReasonKey('job_scam')).toBe('reason_job_scam');
    expect(standingReasonKey('no_violation')).toBe('reason_other');
    expect(standingReasonKey('')).toBe('reason_other');
  });

  it('one summary: banned (dated or not), restricted with its end date, under review, or clear', () => {
    expect(standingSummary({ ...base, status: 'banned', bannedUntil: '2026-12-27T00:00:00.000Z' })).toEqual({
      kind: 'banned',
      until: '2026-12-27T00:00:00.000Z',
    });
    expect(standingSummary({ ...base, status: 'banned' })).toEqual({ kind: 'banned', until: null });
    expect(
      standingSummary({ ...base, status: 'restricted', restrictedUntil: '2026-11-30T00:00:00.000Z' }),
    ).toEqual({ kind: 'restricted', until: '2026-11-30T00:00:00.000Z' });
    expect(standingSummary({ ...base, status: 'active', restrictedMode: 'minor_report' })).toEqual({
      kind: 'review',
      until: null,
    });
    expect(standingSummary({ ...base, status: 'active' })).toEqual({ kind: 'clear', until: null });
  });

  it('every standing string and reason label exists in English and Hindi', () => {
    const keys = [
      ...REPORT_REASONS.map((r) => `reason_${r}`),
      ...STANDING_ACTIONS.map((a) => `act_${a}`),
      'title',
      'bannedTitle',
      'bannedUntil',
      'bannedForever',
      'restrictedTitle',
      'restrictedUntil',
      'restrictedReview',
      'appeal',
      'appealSend',
      'appealSent',
      'appealPending',
      'appealUpheld',
      'appealOverturned',
      'gac',
    ];
    for (const dict of [en, hi]) {
      const ns = (dict.ustaad as unknown as Record<string, Record<string, string>>).standing ?? {};
      for (const k of keys) expect(ns[k], k).toBeTruthy();
    }
    expect(en.support.kind_ustaad_appeal).toBeTruthy();
    expect(hi.support.kind_ustaad_appeal).toBeTruthy();
  });
});
