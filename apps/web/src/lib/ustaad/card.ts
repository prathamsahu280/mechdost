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
