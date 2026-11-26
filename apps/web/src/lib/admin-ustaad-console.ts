import type { ConsoleCaps } from '@mechdost/shared/ustaad/dto/console';
import type { ModerationDecision } from '@mechdost/shared/ustaad/dto/moderation';

/**
 * View model for Admin → Ustaad community console (spec 23 § 3, § 13; task G2). Pure functions so node tests cover
 * them: which sections and actions the caller sees (hidden when the API would refuse them; the API still checks every
 * call), the clock badge, four-eyes in the UI and the levels a reviewer may grant. Text lives in `ustaad.console.*`.
 */
export const CONSOLE_SECTIONS = [
  'queue',
  'holds',
  'appeals',
  'verify',
  'members',
  'legal',
  'names',
  'audit',
] as const;
export type ConsoleSection = (typeof CONSOLE_SECTIONS)[number];
/** `settings` opens G1's settings (its own ten sections sit in the same switcher). */
export type ConsolePlace = ConsoleSection | 'settings';

export type ConsoleCapsView = ConsoleCaps;

const READS: readonly ConsoleSection[] = ['queue', 'holds', 'appeals', 'members', 'names'];

/** The community sections this caller may open, in switcher order. */
export function consoleSectionsFor(caps: ConsoleCapsView): ConsoleSection[] {
  return CONSOLE_SECTIONS.filter((s) => {
    if (READS.includes(s)) return caps.read || caps.moderate;
    if (s === 'verify') return caps.verify;
    if (s === 'legal') return caps.takedown || caps.moderate;
    return true;
  });
}

/** `?section=` → a section the caller may open (`settings` for G1), else the first allowed one. */
export function parseConsoleSection(raw: string | null, caps: ConsoleCapsView): ConsolePlace {
  const allowed = consoleSectionsFor(caps);
  if (raw === 'settings' && (caps.read || caps.settings)) return 'settings';
  const hit = allowed.find((s) => s === raw);
  return hit ?? allowed[0] ?? 'audit';
}

export interface ClockBadge {
  tone: 'neutral' | 'warning' | 'danger';
  overdue: boolean;
  /** Time left (or overdue), split for the text. */
  hours: number;
  minutes: number;
}

/** Time left on a report's clock: neutral, amber under half the clock, red once overdue (text always says it). */
export function clockBadge(dueAt: string, createdAt: string, now: Date): ClockBadge {
  const due = new Date(dueAt).getTime();
  const total = Math.max(1, due - new Date(createdAt).getTime());
  const left = due - now.getTime();
  const span = Math.abs(left);
  const hours = Math.floor(span / 3_600_000);
  const minutes = Math.floor((span % 3_600_000) / 60_000);
  if (left <= 0) return { tone: 'danger', overdue: true, hours, minutes };
  return { tone: left < total / 2 ? 'warning' : 'neutral', overdue: false, hours, minutes };
}

export interface ReportFlags {
  targetType: string;
  banWaiting: boolean;
  proposedByMe: boolean;
  decidedByMe: boolean;
}

/** Decisions a moderator may take on an open report (holds: release or remove). */
export function decisionsFor(
  item: ReportFlags,
  caps: ConsoleCapsView,
  queue: 'open' | 'held',
): ModerationDecision[] {
  if (!caps.moderate || item.banWaiting) return [];
  if (queue === 'held') return ['keep', 'remove'];
  const all: ModerationDecision[] = ['keep', 'remove', 'warn', 'restrict', 'ban'];
  return item.targetType === 'member' ? all.filter((d) => d !== 'remove') : all;
}

/** Four-eyes: a waiting ban is confirmed by a moderator who did not propose it. */
export function canConfirmBan(item: ReportFlags, caps: ConsoleCapsView): boolean {
  return caps.moderate && item.banWaiting && !item.proposedByMe;
}

/** An appeal is decided by a moderator who took no part in the decision. */
export function canDecideAppeal(item: ReportFlags, caps: ConsoleCapsView): boolean {
  return caps.moderate && !item.decidedByMe;
}

const GRANTABLE = ['naya', 'pakka', 'bada', 'master'] as const;
export type GrantableLevel = (typeof GRANTABLE)[number];

/** A reviewer grants the level asked for or a lower one (the API refuses a higher one). */
export function grantableLevels(requested: GrantableLevel): GrantableLevel[] {
  return GRANTABLE.slice(0, GRANTABLE.indexOf(requested) + 1);
}

/** Clock length in hours per report clock (for the queue's "2 h clock" chip). */
export const CLOCK_HOURS: Readonly<Record<string, number>> = {
  intimate_2h: 2,
  legal_3h: 3,
  standard_24h: 24,
  removal_36h: 36,
  grievance_7d: 168,
};
