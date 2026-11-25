import { defineMachine } from './machine';

/**
 * Ustaad media (spec 23 § 7.8, § 10). `member` marks the upload done (the complete call), `system` verifies,
 * rejects and purges; `admin` removes (archived 180 days, then purged unless on legal hold).
 */
export const USTAAD_MEDIA_STATUSES = [
  'pending_upload',
  'uploaded',
  'verified',
  'rejected',
  'removed_archived',
  'purged',
] as const;
export type UstaadMediaStatus = (typeof USTAAD_MEDIA_STATUSES)[number];

export const ustaadMediaMachine = /* @__PURE__ */ defineMachine(
  'ustaad_media',
  USTAAD_MEDIA_STATUSES,
  ['rejected', 'purged'],
  [
    { from: 'pending_upload', to: 'uploaded', by: ['member'] },
    // An upload never completed within an hour.
    { from: 'pending_upload', to: 'purged', by: ['system'] },
    { from: 'uploaded', to: 'verified', by: ['system'] },
    { from: 'uploaded', to: 'rejected', by: ['system'] },
    { from: 'verified', to: 'removed_archived', by: ['admin', 'system'] },
    // Story expiry + grace, account deletion, takedown.
    { from: 'verified', to: 'purged', by: ['system', 'admin'] },
    { from: 'removed_archived', to: 'purged', by: ['system', 'admin'] },
    // Appeal upheld while still archived.
    { from: 'removed_archived', to: 'verified', by: ['admin'] },
  ],
);
