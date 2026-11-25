/**
 * One status → badge-tone mapping for every admin screen (design 2026-11-25, admin round 2). A badge always carries
 * its text, never colour alone; the tone only picks one of the existing token pairs (no new colours).
 */
export const BADGE_TONES = ['success', 'warning', 'danger', 'info', 'neutral', 'muted', 'accent'] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

/**
 * Tailwind classes per tone, token pairs from `packages/ui/src/tokens.css` (red and blue pairs added 2026-11-25,
 * decisions.md "Admin data colour"). Meaning: amber = waiting or needs action, red = urgent, overdue or failed,
 * blue = in progress, green = done, paid or delivered, grey = cancelled or archived, navy = information.
 */
export const BADGE_TONE_CLASS: Readonly<Record<BadgeTone, string>> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-error-bg text-error',
  info: 'bg-info-bg text-info',
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
  // Work queues (user ruling 2026-11-25): one tone per status family
  pending_review: 'warning',
  awaiting_shop: 'warning',
  needs_routing: 'warning',
  waiting: 'warning',
  requested: 'warning',
  needs_reconciliation: 'danger',
  initiated: 'info',
  processed: 'success',
  expired: 'warning',
  overdue: 'danger',
  failed: 'danger',
  declined: 'danger',
  in_progress: 'info',
  in_review: 'info',
  packed: 'info',
  out_for_delivery: 'info',
  shipped: 'info',
  proposed: 'info',
  done: 'success',
  paid: 'success',
  delivered: 'success',
  refunded: 'success',
  resolved: 'success',
  cancelled: 'muted',
  archived: 'muted',
};

/** The tone for a status code; `neutral` when the code is not in the shared vocabulary. */
export function statusTone(code: string): BadgeTone {
  return BY_CODE[code] ?? 'neutral';
}

/** The classes of a status code's badge. */
export const statusToneClass = (code: string): string => BADGE_TONE_CLASS[statusTone(code)];
