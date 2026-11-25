import { defineMachine } from './machine';

/**
 * Posts, stories, comments and answers (spec 23 § 7.4), questions (§ 7.5) and reports (§ 7.6). `admin` = staff with
 * `ustaad:moderate`; `system` = automatic holds and the story-expiry job.
 */
export const USTAAD_CONTENT_STATUSES = ['held', 'visible', 'hidden_author', 'removed', 'expired'] as const;
export type UstaadContentStatus = (typeof USTAAD_CONTENT_STATUSES)[number];

export const ustaadContentMachine = /* @__PURE__ */ defineMachine(
  'ustaad_content',
  USTAAD_CONTENT_STATUSES,
  ['hidden_author', 'expired'],
  [
    { from: 'held', to: 'visible', by: ['admin'] },
    { from: 'held', to: 'removed', by: ['admin'] },
    { from: 'held', to: 'hidden_author', by: ['member'] },
    { from: 'visible', to: 'held', by: ['admin', 'system'] },
    { from: 'visible', to: 'hidden_author', by: ['member'] },
    { from: 'visible', to: 'removed', by: ['admin'] },
    { from: 'visible', to: 'expired', by: ['system'] },
    // Appeal upheld (decided by another staff member).
    { from: 'removed', to: 'visible', by: ['admin'] },
  ],
);

export const USTAAD_QUESTION_STATUSES = ['open', 'answered', 'solved', 'closed', 'removed'] as const;
export type UstaadQuestionStatus = (typeof USTAAD_QUESTION_STATUSES)[number];

export const ustaadQuestionMachine = /* @__PURE__ */ defineMachine(
  'ustaad_question',
  USTAAD_QUESTION_STATUSES,
  [],
  [
    { from: 'open', to: 'answered', by: ['system'] },
    { from: 'answered', to: 'solved', by: ['member'] },
    { from: 'open', to: 'closed', by: ['member', 'system'] },
    { from: 'answered', to: 'closed', by: ['member', 'system'] },
    { from: 'open', to: 'removed', by: ['admin'] },
    { from: 'answered', to: 'removed', by: ['admin'] },
    { from: 'solved', to: 'removed', by: ['admin'] },
    { from: 'closed', to: 'removed', by: ['admin'] },
    // Appeal: back to the state before removal (the repository reads it from ustaad_events).
    { from: 'removed', to: 'open', by: ['admin'] },
    { from: 'removed', to: 'answered', by: ['admin'] },
    { from: 'removed', to: 'solved', by: ['admin'] },
    // Staff can unmark a best answer (§ 14).
    { from: 'solved', to: 'answered', by: ['admin'] },
  ],
);

export const USTAAD_REPORT_STATUSES = [
  'open',
  'in_review',
  'actioned',
  'dismissed',
  'appealed',
  'upheld',
  'overturned',
] as const;
export type UstaadReportStatus = (typeof USTAAD_REPORT_STATUSES)[number];
export const USTAAD_REPORT_OPEN = ['open', 'in_review'] as const;

export const ustaadReportMachine = /* @__PURE__ */ defineMachine(
  'ustaad_report',
  USTAAD_REPORT_STATUSES,
  ['dismissed', 'upheld', 'overturned'],
  [
    { from: 'open', to: 'in_review', by: ['admin'] },
    { from: 'open', to: 'actioned', by: ['admin'] },
    { from: 'open', to: 'dismissed', by: ['admin'] },
    { from: 'in_review', to: 'actioned', by: ['admin'] },
    { from: 'in_review', to: 'dismissed', by: ['admin'] },
    // The author appeals through a support ticket REQ-…; a different staff member decides (four-eyes).
    { from: 'actioned', to: 'appealed', by: ['member'] },
    { from: 'appealed', to: 'upheld', by: ['admin'] },
    { from: 'appealed', to: 'overturned', by: ['admin'] },
  ],
);
