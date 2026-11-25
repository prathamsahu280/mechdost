/**
 * One status → badge-tone mapping for every admin screen (design 2026-11-25, admin round 2). A badge always carries
 * its text, never colour alone; the tone only picks one of the existing token pairs (no new colours).
 */
export const BADGE_TONES = ['success', 'warning', 'danger', 'neutral', 'muted', 'accent'] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

/** Tailwind classes per tone: only existing token pairs from `packages/ui/src/tokens.css`. */
export const BADGE_TONE_CLASS: Readonly<Record<BadgeTone, string>> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-pill text-error',
  neutral: 'bg-pill text-ink',
  muted: 'bg-pill text-muted',
  accent: 'bg-accent-soft text-accent-soft-text',
};

/** Status vocabularies the admin screens show. Unknown codes fall back to `neutral` (never an error). */
const BY_CODE: Readonly<Record<string, BadgeTone>> = {
  // Partners, shops, workshops
  active: 'success',
  approved: 'success',
  published: 'success',
  verified: 'success',
  open: 'success',
  paused: 'warning',
  busy: 'warning',
  pending: 'neutral',
  suspended: 'danger',
  rejected: 'danger',
  closed: 'muted',
  unpublished: 'muted',
  // Customer block levels
  cod_only: 'warning',
  orders: 'warning',
  full: 'danger',
  // Error levels (Sentry)
  fatal: 'danger',
  error: 'danger',
  warning: 'warning',
  info: 'muted',
  debug: 'muted',
  // Work queues
  done: 'success',
  delivered: 'success',
  refunded: 'success',
  cancelled: 'muted',
  expired: 'warning',
  needs_routing: 'warning',
};

/** The tone for a status code; `neutral` when the code is not in the shared vocabulary. */
export function statusTone(code: string): BadgeTone {
  return BY_CODE[code] ?? 'neutral';
}

/** The classes of a status code's badge. */
export const statusToneClass = (code: string): string => BADGE_TONE_CLASS[statusTone(code)];
