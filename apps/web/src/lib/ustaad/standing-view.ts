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

type GateLoad =
  | { state: 'loading' }
  | { state: 'error'; status: number; code: string }
  | {
      state: 'ok';
      data: { member: { status: string; restrictedMode?: string } | null; staffPreview: boolean };
    };

/**
 * What the member gate draws (SIM-P27): a banned member gets the banned screen (reason, end date, appeal) on every
 * network page instead of each page's "check your internet"; a restricted or under-review member gets the page with
 * the one limited banner (SIM-P23); a non-member the join card. Any other failure lets the page show its own error.
 */
export function memberGateView(loaded: GateLoad): 'loading' | 'banned' | 'limited' | 'join' | 'member' {
  if (loaded.state === 'loading') return 'loading';
  if (loaded.state === 'error') {
    if (loaded.code === 'USTAAD_BANNED') return 'banned';
    if (loaded.code === 'USTAAD_NOT_MEMBER') return 'join';
    return 'member';
  }
  const m = loaded.data.member;
  if (!m) return 'join';
  if (m.status === 'banned') return 'banned';
  if (m.status === 'restricted' || (m.restrictedMode ?? 'none') !== 'none') return 'limited';
  return 'member';
}
