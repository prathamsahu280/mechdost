import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { REPORT_REASONS } from '@mechdost/shared/ustaad/codes';
import { STANDING_ACTIONS } from '@mechdost/shared/ustaad/dto/moderation';
import { memberGateView, standingReasonKey, standingSummary } from '../src/lib/ustaad/standing-view';

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

  it('SIM-P27: the member gate shows the banned screen, the limited banner, the join card or the page', () => {
    const me = (status: string, restrictedMode = 'none') => ({
      state: 'ok' as const,
      data: { member: { status, restrictedMode }, staffPreview: false },
    });
    expect(memberGateView(me('banned'))).toBe('banned');
    expect(memberGateView({ state: 'error', status: 403, code: 'USTAAD_BANNED' })).toBe('banned');
    expect(memberGateView(me('restricted'))).toBe('limited');
    expect(memberGateView(me('active', 'minor_report'))).toBe('limited');
    expect(memberGateView(me('active'))).toBe('member');
    expect(memberGateView({ state: 'ok', data: { member: null, staffPreview: true } })).toBe('join');
    expect(memberGateView({ state: 'error', status: 404, code: 'USTAAD_NOT_MEMBER' })).toBe('join');
    expect(memberGateView({ state: 'loading' })).toBe('loading');
    // Any other failure lets the page show its own error (and retry).
    expect(memberGateView({ state: 'error', status: 0, code: 'NETWORK' })).toBe('member');
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
