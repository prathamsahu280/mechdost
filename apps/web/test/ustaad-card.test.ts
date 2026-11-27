/**
 * Ustaad card, ladder, tutorial and verification progress helpers (spec 23 § 4 flows 2 and 15, § 5, § 9.2; plan
 * tasks B2–B4): pure parts the screens render.
 */
import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import {
  helpedBand,
  ladderState,
  learnTowardsNaya,
  narrationLang,
  nextLevelProgress,
  ruleParts,
  statusSteps,
  whatsappShareHref,
  type LadderInput,
  type RuleKey,
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

// ── U4: next level in plain numbers (E7), Learn towards Naya (E15), helped band (Q-UI-2) ──────────────────────
const g = (o: Partial<Record<RuleKey, number>>) => ({
  minFollowers: 0,
  minBestAnswers: 0,
  minHelpfulPct: 0,
  minVerifiedYears: 0,
  minVideos: 0,
  minRecommendations: 0,
  ...o,
});
const LADDER: LadderInput['ladder'] = [
  {
    level: 'naya',
    groups: [g({ minVerifiedYears: 3 }), g({ minRecommendations: 1, minVideos: 10 })],
    staffReview: false,
  },
  { level: 'pakka', groups: [g({ minFollowers: 100, minBestAnswers: 25 })], staffReview: false },
  {
    level: 'bada',
    groups: [g({ minFollowers: 500, minBestAnswers: 100, minHelpfulPct: 80 })],
    staffReview: true,
  },
  { level: 'master', groups: [g({ minFollowers: 2000, minBestAnswers: 300 })], staffReview: true },
];
const facts = (current: LadderInput['current'], o: Partial<LadderInput> = {}): LadderInput => ({
  current,
  qualifiedFollowers: 41,
  bestAnswers: 17,
  videos: 7,
  recommendations: 0,
  ladder: LADDER,
  ...o,
});

describe('nextLevelProgress (E7)', () => {
  it('Naya → Pakka: "8 more best answers", "59 more followers"; no staff line', () => {
    expect(nextLevelProgress(facts('naya'))).toEqual({
      level: 'pakka',
      staffReview: false,
      rows: [
        { key: 'minFollowers', have: 41, need: 100, left: 59 },
        { key: 'minBestAnswers', have: 17, need: 25, left: 8 },
      ],
    });
  });
  it('Chhotu → Naya picks the closest countable group (videos + recommendation), not verified years', () => {
    expect(nextLevelProgress(facts('apprentice'))?.rows).toEqual([
      { key: 'minVideos', have: 7, need: 10, left: 3 },
      { key: 'minRecommendations', have: 0, need: 1, left: 1 },
    ]);
  });
  it('helpful % has no number on the card → rule text only (have and left null); Bada says the team checks', () => {
    const r = nextLevelProgress(facts('pakka', { qualifiedFollowers: 600, bestAnswers: 40 }));
    expect(r?.level).toBe('bada');
    expect(r?.staffReview).toBe(true);
    expect(r?.rows).toContainEqual({ key: 'minHelpfulPct', have: null, need: 80, left: null });
    expect(r?.rows).toContainEqual({ key: 'minFollowers', have: 600, need: 500, left: 0 });
  });
  it('Master and "Ustaad · to verify" show no count rows (top level; verification comes first)', () => {
    expect(nextLevelProgress(facts('master'))).toBeNull();
    expect(nextLevelProgress(facts('ustaad_pending'))).toBeNull();
  });
});

describe('learnTowardsNaya (E15)', () => {
  it('Chhotu sees 7/10; Ustaads see nothing', () => {
    expect(learnTowardsNaya(facts('apprentice'))).toEqual({ done: 7, need: 10 });
    expect(learnTowardsNaya(facts('apprentice', { videos: 14 }))).toEqual({ done: 10, need: 10 });
    expect(learnTowardsNaya(facts('naya'))).toBeNull();
    expect(learnTowardsNaya(facts('ustaad_pending'))).toBeNull();
  });
});

describe('helpedBand (analytics carry a band, never a list)', () => {
  it('bands the weekly count', () => {
    expect([0, 1, 2, 5, 6, 40].map(helpedBand)).toEqual(['0', '1', '2-5', '2-5', '6+', '6+']);
  });
});

describe('U4 copy in English and Hindi (hard rule 10)', () => {
  const NEW: Record<'card' | 'learn' | 'jobs', string[]> = {
    card: [
      'nextLevel',
      'more',
      'howCounted',
      'teamCheck',
      'levelsSheetTitle',
      'yourStatus',
      'sendCard',
      'topLevel',
      'verifyFirst',
      'ruleTextOnly',
      'helpedWeek',
      'helpedLead',
      'close',
      'openLevelSheet',
      'shortcutsH',
      'shortcutLearn',
      'shortcutDiscover',
    ],
    learn: ['towardsNaya'],
    jobs: ['scamLine', 'learnMore', 'showLess'],
  };
  it('every new key exists in both locales, differs, and the Hindi has no Latin words beyond brands', () => {
    for (const [ns, keys] of Object.entries(NEW) as [keyof typeof NEW, string[]][]) {
      const e = en.ustaad[ns] as Record<string, string | undefined>;
      const h = hi.ustaad[ns] as Record<string, string | undefined>;
      for (const k of keys) {
        expect(e[k], `en ${ns}.${k}`).toBeTruthy();
        expect(h[k], `hi ${ns}.${k}`).toBeTruthy();
        expect(h[k]).not.toBe(e[k]);
        const latin = (h[k] ?? '')
          .replace(/\{(level|n|rule|done|need)[,}]/g, '')
          .replace(/\b(plural|one|other|MechDost|WhatsApp)\b/g, '')
          .match(/[A-Za-z]{3,}/g);
        expect(latin, `hi ${ns}.${k}`).toBeNull();
      }
    }
  });
});
