import { defineMachine } from './machine';

/** Jobs and applications (spec 23 § 7.7). `member` = the employer for job moves; the applicant or employer below. */
export const USTAAD_JOB_STATUSES = [
  'draft',
  'pending_review',
  'open',
  'paused',
  'filled',
  'closed',
  'expired',
  'removed',
] as const;
export type UstaadJobStatus = (typeof USTAAD_JOB_STATUSES)[number];

export const ustaadJobMachine = /* @__PURE__ */ defineMachine(
  'ustaad_job',
  USTAAD_JOB_STATUSES,
  ['filled', 'closed', 'expired', 'removed'],
  [
    { from: 'draft', to: 'pending_review', by: ['member'] },
    // Scam and employer checks pass (system) or staff release a held job.
    { from: 'pending_review', to: 'open', by: ['system', 'admin'] },
    { from: 'pending_review', to: 'removed', by: ['admin'] },
    { from: 'open', to: 'paused', by: ['member'] },
    { from: 'paused', to: 'open', by: ['member'] },
    { from: 'open', to: 'filled', by: ['member'] },
    { from: 'open', to: 'closed', by: ['member'] },
    { from: 'paused', to: 'closed', by: ['member'] },
    { from: 'open', to: 'expired', by: ['system'] },
    { from: 'paused', to: 'expired', by: ['system'] },
    { from: 'draft', to: 'removed', by: ['admin'] },
    { from: 'open', to: 'removed', by: ['admin'] },
    { from: 'paused', to: 'removed', by: ['admin'] },
  ],
);

export const USTAAD_APPLICATION_STATUSES = [
  'applied',
  'seen',
  'shortlisted',
  'hired',
  'rejected',
  'withdrawn',
  'closed',
] as const;
export type UstaadApplicationStatus = (typeof USTAAD_APPLICATION_STATUSES)[number];

export const ustaadApplicationMachine = /* @__PURE__ */ defineMachine(
  'ustaad_application',
  USTAAD_APPLICATION_STATUSES,
  ['hired', 'rejected', 'withdrawn', 'closed'],
  [
    { from: 'applied', to: 'seen', by: ['member'] },
    { from: 'applied', to: 'shortlisted', by: ['member'] },
    { from: 'seen', to: 'shortlisted', by: ['member'] },
    { from: 'shortlisted', to: 'hired', by: ['member'] },
    { from: 'applied', to: 'rejected', by: ['member'] },
    { from: 'seen', to: 'rejected', by: ['member'] },
    { from: 'shortlisted', to: 'rejected', by: ['member'] },
    { from: 'applied', to: 'withdrawn', by: ['member'] },
    { from: 'seen', to: 'withdrawn', by: ['member'] },
    { from: 'shortlisted', to: 'withdrawn', by: ['member'] },
    // The job left `open`: reason `job_closed`.
    { from: 'applied', to: 'closed', by: ['system'] },
    { from: 'seen', to: 'closed', by: ['system'] },
    { from: 'shortlisted', to: 'closed', by: ['system'] },
  ],
);
