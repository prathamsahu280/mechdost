/**
 * Customer reviews (spec 02 § Reviews, decision 2026-10-31 "admin approves before publish"). Zod-free on purpose:
 * the database layer imports these constants (learnings L101/L102); the response schemas live in `reviews-api.ts`.
 *
 * A review belongs to one verified purchase: a delivered sub-order containing the product, or a paid/completed
 * service request at the workshop. It starts `pending`; staff with `reviews:moderate` approve or hide it (a reason
 * code when hiding) and may bring a hidden review back. Only approved reviews are public and count in ratings.
 */
import { defineMachine } from './state/machine';
import { cleanLine } from './text';

export const REVIEW_TARGETS = ['product', 'workshop'] as const;
export type ReviewTargetType = (typeof REVIEW_TARGETS)[number];

export const REVIEW_STATES = ['pending', 'approved', 'hidden'] as const;
export type ReviewStatus = (typeof REVIEW_STATES)[number];

/** Moderation is reversible (no terminal state): a hidden review can be approved again and vice versa. */
export const reviewMachine = defineMachine(
  'review',
  REVIEW_STATES,
  [],
  [
    { from: 'pending', to: 'approved', by: ['admin'] },
    { from: 'pending', to: 'hidden', by: ['admin'] },
    { from: 'approved', to: 'hidden', by: ['admin'] },
    { from: 'hidden', to: 'approved', by: ['admin'] },
  ],
);

/** Why staff hid a review (ML-ready codes, hard rule 16); a free-text note is optional and staff-only. */
export const REVIEW_HIDE_REASONS = [
  'spam',
  'abusive',
  'personal_data',
  'off_topic',
  'not_genuine',
  'other',
] as const;
export type ReviewHideReason = (typeof REVIEW_HIDE_REASONS)[number];

/** Review text limit (characters); the text is optional, the star rating is not. */
export const REVIEW_BODY_MAX = 1000;
/** Staff-only moderation note limit. */
export const REVIEW_NOTE_MAX = 300;
/** Reviews one customer may write in 24 hours (spec 13 abuse table: "Reviews/tickets/forms 5/user/day"). */
export const REVIEW_DAILY_LIMIT = 5;

/** Statuses after which a service can be reviewed (spec 06: review after the bill is paid). */
export const REVIEWABLE_SERVICE_STATES = ['paid', 'completed'] as const;

/**
 * Plain text for a review: control and invisible format characters removed, whitespace collapsed, trimmed, cut to
 * the limit. Empty → null (a star rating alone is a valid review).
 */
export function cleanReviewBody(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = cleanLine(value, REVIEW_BODY_MAX);
  return text.length > 0 ? text : null;
}

/** Staff-only moderation note: one cleaned line, empty → null. */
export function cleanReviewNote(value: string | null | undefined): string | null {
  const text = cleanLine(value ?? '', REVIEW_NOTE_MAX);
  return text.length > 0 ? text : null;
}

/** Public name of a reviewer: first name and the initial of the last ("Ravi S."); null when none is known. */
export function reviewerName(fullName: string | null | undefined): string | null {
  const parts = cleanLine(fullName ?? '', 80)
    .split(' ')
    .filter(Boolean);
  const first = parts[0];
  if (!first) return null;
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const initial = last ? Array.from(last)[0] : undefined;
  return initial ? `${first} ${initial}.` : first;
}
