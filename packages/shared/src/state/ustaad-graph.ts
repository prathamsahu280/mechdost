import { defineMachine } from './machine';

/** Connections, mentorships and message threads (spec 23 § 6.2, § 7.9). A block forces removed/blocked at once. */
export const USTAAD_CONNECTION_STATUSES = ['requested', 'accepted', 'declined', 'removed'] as const;
export type UstaadConnectionStatus = (typeof USTAAD_CONNECTION_STATUSES)[number];

export const ustaadConnectionMachine = /* @__PURE__ */ defineMachine(
  'ustaad_connection',
  USTAAD_CONNECTION_STATUSES,
  [],
  [
    { from: 'requested', to: 'accepted', by: ['member'] },
    { from: 'requested', to: 'declined', by: ['member'] },
    { from: 'requested', to: 'removed', by: ['member', 'system'] },
    { from: 'accepted', to: 'removed', by: ['member', 'system'] },
    // Asking again later (the row is unique per ordered pair).
    { from: 'declined', to: 'requested', by: ['member'] },
    { from: 'removed', to: 'requested', by: ['member'] },
  ],
);

export const USTAAD_MENTORSHIP_STATUSES = ['requested', 'active', 'declined', 'ended'] as const;
export type UstaadMentorshipStatus = (typeof USTAAD_MENTORSHIP_STATUSES)[number];
export const USTAAD_MENTORSHIP_ACTIVE = ['requested', 'active'] as const;

export const ustaadMentorshipMachine = /* @__PURE__ */ defineMachine(
  'ustaad_mentorship',
  USTAAD_MENTORSHIP_STATUSES,
  ['declined', 'ended'],
  [
    { from: 'requested', to: 'active', by: ['member'] },
    { from: 'requested', to: 'declined', by: ['member'] },
    { from: 'requested', to: 'ended', by: ['member', 'system'] },
    { from: 'active', to: 'ended', by: ['member', 'system', 'admin'] },
  ],
);

export const USTAAD_THREAD_STATUSES = ['requested', 'open', 'declined', 'blocked'] as const;
export type UstaadThreadStatus = (typeof USTAAD_THREAD_STATUSES)[number];

export const ustaadThreadMachine = /* @__PURE__ */ defineMachine(
  'ustaad_thread',
  USTAAD_THREAD_STATUSES,
  [],
  [
    { from: 'requested', to: 'open', by: ['member'] },
    { from: 'requested', to: 'declined', by: ['member'] },
    { from: 'requested', to: 'blocked', by: ['member', 'system'] },
    { from: 'open', to: 'blocked', by: ['member', 'system'] },
    { from: 'declined', to: 'requested', by: ['member'] },
    { from: 'declined', to: 'blocked', by: ['member', 'system'] },
    // Unblock restores the status the thread had before the block (`blocked_from`, D2): a request never becomes
    // `open` without the receiver accepting.
    { from: 'blocked', to: 'open', by: ['member'] },
    { from: 'blocked', to: 'requested', by: ['member'] },
    { from: 'blocked', to: 'declined', by: ['member'] },
  ],
);
