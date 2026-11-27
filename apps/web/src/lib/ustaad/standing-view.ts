import { REPORT_REASONS } from '@mechdost/shared/ustaad/codes';
import type { StandingView } from '@mechdost/shared/ustaad/dto/moderation';

/**
 * Pure helpers for the member's standing (QA 2026-11-27: SIM-P19 strike notices, SIM-P23 one restriction wording,
 * SIM-P27 banned screen). The screens show a plain label for each reason, never the code.
 */
export type StandingReasonKey = `reason_${(typeof REPORT_REASONS)[number]}`;

export function standingReasonKey(code: string): StandingReasonKey {
  const known = REPORT_REASONS.find((r) => r === code);
  return `reason_${known ?? 'other'}`;
}

export type StandingSummary =
  | { kind: 'banned'; until: string | null }
  | { kind: 'restricted'; until: string | null }
  | { kind: 'review'; until: null }
  | { kind: 'clear'; until: null };

/** One wording for every screen: banned, restricted until a date, limited while staff check, or clear. */
export function standingSummary(v: Omit<StandingView, 'items'> & { items?: unknown }): StandingSummary {
  if (v.status === 'banned') return { kind: 'banned', until: v.bannedUntil };
  if (v.status === 'restricted') return { kind: 'restricted', until: v.restrictedUntil };
  if (v.restrictedMode !== 'none') return { kind: 'review', until: null };
  return { kind: 'clear', until: null };
}
