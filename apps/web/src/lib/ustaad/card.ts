/**
 * Pure helpers for the Ustaad card, level ladder, tutorial narration and verification progress (spec 23 § 4 flows 2
 * and 15, § 5, § 9.2; plan tasks B2–B4).
 */
import type { UstaadLevel } from '@mechdost/shared/ustaad/codes';
import type { MyCard, VerificationView } from '@mechdost/shared/ustaad/dto/verification';

type Group = MyCard['ladder'][number]['groups'][number];
export type RuleKey = keyof Group;
const RULE_ORDER: readonly RuleKey[] = [
  'minFollowers',
  'minBestAnswers',
  'minHelpfulPct',
  'minVerifiedYears',
  'minVideos',
  'minRecommendations',
];

/** The numbers of one rule group that matter (zero = not part of the rule). */
export function ruleParts(g: Group): [RuleKey, number][] {
  return RULE_ORDER.filter((k) => g[k] > 0).map((k) => [k, g[k]]);
}

const ORDER: readonly UstaadLevel[] = ['apprentice', 'ustaad_pending', 'naya', 'pakka', 'bada', 'master'];

/** Where a ladder step sits for me. Chhotu and "Ustaad · to verify" are below Naya. */
export function ladderState(mine: UstaadLevel, step: UstaadLevel): 'done' | 'current' | 'next' {
  const a = ORDER.indexOf(mine);
  const b = ORDER.indexOf(step);
  if (a === b) return 'current';
  return a > b ? 'done' : 'next';
}

/** The card facts the progress helpers read (a subset of `MyCard`, so tests need no full fixture). */
export interface LadderInput {
  current: UstaadLevel;
  qualifiedFollowers: number;
  bestAnswers: number;
  videos: number;
  recommendations: number;
  ladder: Pick<MyCard['ladder'][number], 'level' | 'groups' | 'staffReview'>[];
}

export interface NextLevelRow {
  key: RuleKey;
  /** Null when the card has no number for this rule (helpful %, verified years): show the rule text only. */
  have: number | null;
  need: number;
  left: number | null;
}

/** The number the member has for a rule, or null when the card cannot show it. */
function haveFor(card: LadderInput, key: RuleKey): number | null {
  switch (key) {
    case 'minFollowers':
      return card.qualifiedFollowers;
    case 'minBestAnswers':
      return card.bestAnswers;
    case 'minVideos':
      return card.videos;
    case 'minRecommendations':
      return card.recommendations;
    case 'minHelpfulPct':
    case 'minVerifiedYears':
      return null;
  }
}

function rowsFor(card: LadderInput, group: Group): NextLevelRow[] {
  return ruleParts(group).map(([key, need]) => {
    const have = haveFor(card, key);
    return { key, have, need, left: have === null ? null : Math.max(0, need - have) };
  });
}

/** How close a group is (0–1) over the rows with a number; a group with none ranks last. */
function closeness(rows: NextLevelRow[]): number {
  const counted = rows.filter((r) => r.have !== null);
  if (counted.length === 0) return -1;
  return counted.reduce((s, r) => s + Math.min(1, (r.have ?? 0) / r.need), 0) / counted.length;
}

/**
 * "Next level in plain numbers" (E7, design § 3.8): the next ladder step and the rule group closest to complete,
 * each row with what I have and how many more. Null at Master, and for "Ustaad · to verify" (verification first).
 */
export function nextLevelProgress(
  card: LadderInput,
): { level: MyCard['ladder'][number]['level']; staffReview: boolean; rows: NextLevelRow[] } | null {
  if (card.current === 'ustaad_pending') return null;
  const step = card.ladder.find((s) => ladderState(card.current, s.level) === 'next');
  if (!step) return null;
  let best: NextLevelRow[] = [];
  let score = -2;
  for (const group of step.groups) {
    const rows = rowsFor(card, group);
    const c = closeness(rows);
    if (c > score) {
      score = c;
      best = rows;
    }
  }
  return { level: step.level, staffReview: step.staffReview, rows: best };
}

/** Learn strip for Chhotu (E15): "{done}/{need} videos to become Naya Ustaad"; null for everyone else. */
export function learnTowardsNaya(card: LadderInput): { done: number; need: number } | null {
  if (card.current !== 'apprentice') return null;
  const need = card.ladder.find((s) => s.level === 'naya')?.groups.find((g) => g.minVideos > 0)?.minVideos;
  if (!need) return null;
  return { done: Math.min(card.videos, need), need };
}

/** Analytics carry a band for the weekly helped count, never names or ids of the people helped. */
export function helpedBand(n: number): '0' | '1' | '2-5' | '6+' {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  return n <= 5 ? '2-5' : '6+';
}

/** WhatsApp share as a teaser only: a fixed sentence plus the join link; no name, phone or card data. */
export function whatsappShareHref(sentence: string, joinUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${sentence} ${joinUrl}`)}`;
}

/** The `speechSynthesis` voice language for narration fallback (no recording uploaded). */
export function narrationLang(lang: 'hi' | 'en'): 'hi-IN' | 'en-IN' {
  return lang === 'hi' ? 'hi-IN' : 'en-IN';
}

export type StepState = 'done' | 'current' | 'todo' | 'failed';

/** The four progress steps: asked → proof → MechDost review → verified. */
export function statusSteps(
  v: Pick<VerificationView, 'status' | 'attestation' | 'vouchesGiven' | 'vouchesNeeded' | 'reasonCode'>,
): [StepState, StepState, StepState, StepState] {
  switch (v.status) {
    case 'requested':
      return ['done', 'current', 'todo', 'todo'];
    case 'in_review':
      return ['done', 'done', 'current', 'todo'];
    case 'approved':
      return ['done', 'done', 'done', 'done'];
    case 'rejected':
    case 'revoked':
      return ['done', 'done', 'failed', 'todo'];
    case 'withdrawn':
      return ['done', 'todo', 'todo', 'todo'];
  }
}
