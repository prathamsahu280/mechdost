/**
 * Ustaad card, ladder, tutorial and verification progress helpers (spec 23 § 4 flows 2 and 15, § 5, § 9.2; plan
 * tasks B2–B4): pure parts the screens render.
 */
import { describe, expect, it } from 'vitest';
import {
  ladderState,
  narrationLang,
  ruleParts,
  statusSteps,
  whatsappShareHref,
} from '../src/lib/ustaad/card';

describe('ladder', () => {
  it('a rule shows only its non-zero numbers, in a stable order', () => {
    expect(
      ruleParts({
        minFollowers: 100,
        minBestAnswers: 25,
        minHelpfulPct: 0,
        minVerifiedYears: 0,
        minVideos: 0,
        minRecommendations: 0,
      }),
    ).toEqual([
      ['minFollowers', 100],
      ['minBestAnswers', 25],
    ]);
  });

  it('done / current / next relative to my level; Chhotu and "to verify" sit below Naya', () => {
    expect(ladderState('pakka', 'naya')).toBe('done');
    expect(ladderState('pakka', 'pakka')).toBe('current');
    expect(ladderState('pakka', 'bada')).toBe('next');
    expect(ladderState('apprentice', 'naya')).toBe('next');
    expect(ladderState('ustaad_pending', 'naya')).toBe('next');
  });
});

describe('share (teaser only)', () => {
  it('shares only a fixed sentence and the join link, never the card details', () => {
    const href = whatsappShareHref('Join here:', 'https://mechdost.com/hi/ustaad/join');
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(href.split('text=')[1] ?? '')).toBe(
      'Join here: https://mechdost.com/hi/ustaad/join',
    );
  });
});

describe('tutorial narration', () => {
  it('reads Hindi with an Indian Hindi voice and English with Indian English', () => {
    expect(narrationLang('hi')).toBe('hi-IN');
    expect(narrationLang('en')).toBe('en-IN');
  });
});

describe('verification progress (/partners/status, § 4a)', () => {
  const base = {
    status: 'requested' as const,
    attestation: null,
    vouchesGiven: 0,
    vouchesNeeded: 2,
    reasonCode: null,
  };
  it('requested → asked done, proof current', () => {
    expect(statusSteps(base)).toEqual(['done', 'current', 'todo', 'todo']);
  });
  it('in review → proof done, review current; approved → all done', () => {
    expect(statusSteps({ ...base, status: 'in_review' })).toEqual(['done', 'done', 'current', 'todo']);
    expect(statusSteps({ ...base, status: 'approved' })).toEqual(['done', 'done', 'done', 'done']);
  });
  it('rejected stops at the review step', () => {
    expect(statusSteps({ ...base, status: 'rejected' })).toEqual(['done', 'done', 'failed', 'todo']);
  });
});
