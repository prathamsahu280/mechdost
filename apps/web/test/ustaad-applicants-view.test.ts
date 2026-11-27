import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { applicantMoves } from '../src/lib/ustaad/local-view';

describe('employer applicants (SIM-P18)', () => {
  it('offers only the moves the application machine allows, hire last', () => {
    expect(applicantMoves('applied')).toEqual(['seen', 'shortlist', 'reject']);
    expect(applicantMoves('seen')).toEqual(['shortlist', 'reject']);
    expect(applicantMoves('shortlisted')).toEqual(['reject', 'hire']);
    for (const done of ['hired', 'rejected', 'withdrawn', 'closed'] as const)
      expect(applicantMoves(done)).toEqual([]);
  });

  it('every applicant string exists in English and Hindi', () => {
    const keys = [
      'applicantsH',
      'applicantsEmpty',
      'applicantsMore',
      'applicantVerified',
      'applicantSharePhone',
      'applicantVoice',
      'applicantMessage',
      'app_seen',
      'app_shortlist',
      'app_reject',
      'app_hire',
      'appStatus_applied',
      'appStatus_seen',
      'appStatus_shortlisted',
      'appStatus_hired',
      'appStatus_rejected',
      'appStatus_withdrawn',
      'appStatus_closed',
      'confirmHire',
      'confirmReject',
    ];
    for (const dict of [en, hi]) {
      const jobs = (dict.ustaad as unknown as Record<string, Record<string, string>>).jobs ?? {};
      for (const k of keys) expect(jobs[k], k).toBeTruthy();
    }
  });
});
