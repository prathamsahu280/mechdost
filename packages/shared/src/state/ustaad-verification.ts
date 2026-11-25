import { defineMachine } from './machine';

/**
 * Ustaad verification, attestation and vouch (spec 23 § 7.1–7.2). `admin` = a staff member with `ustaad:verify`
 * (community manager or super admin). Staff final approval is locked on (SR-8): no `system` move reaches `approved`.
 */
export const USTAAD_VERIFICATION_STATUSES = [
  'requested',
  'in_review',
  'approved',
  'rejected',
  'withdrawn',
  'revoked',
] as const;
export type UstaadVerificationStatus = (typeof USTAAD_VERIFICATION_STATUSES)[number];
/** Open requests: at most one per member (partial unique index). */
export const USTAAD_VERIFICATION_OPEN = ['requested', 'in_review'] as const;

export const ustaadVerificationMachine = /* @__PURE__ */ defineMachine(
  'ustaad_verification',
  USTAAD_VERIFICATION_STATUSES,
  ['rejected', 'withdrawn', 'revoked'],
  [
    // Evidence complete (an attestation confirmed or enough vouches given), or staff pull it in.
    { from: 'requested', to: 'in_review', by: ['system', 'admin'] },
    { from: 'requested', to: 'withdrawn', by: ['member'] },
    { from: 'in_review', to: 'withdrawn', by: ['member'] },
    { from: 'in_review', to: 'approved', by: ['admin'] },
    { from: 'in_review', to: 'rejected', by: ['admin'] },
    // Four-eyes in the repository (FOUR_EYES).
    { from: 'approved', to: 'revoked', by: ['admin'] },
  ],
);

export const USTAAD_ATTESTATION_STATUSES = [
  'requested',
  'confirmed',
  'declined',
  'expired',
  'revoked',
] as const;
export type UstaadAttestationStatus = (typeof USTAAD_ATTESTATION_STATUSES)[number];
export const USTAAD_ATTESTATION_OPEN = ['requested'] as const;

/** `workshop` = the workshop owner in the portal, or a non-partner owner through the one-time link. */
export const ustaadAttestationMachine = /* @__PURE__ */ defineMachine(
  'ustaad_attestation',
  USTAAD_ATTESTATION_STATUSES,
  ['declined', 'expired', 'revoked'],
  [
    { from: 'requested', to: 'confirmed', by: ['workshop'] },
    { from: 'requested', to: 'declined', by: ['workshop'] },
    { from: 'requested', to: 'expired', by: ['system'] },
    { from: 'confirmed', to: 'revoked', by: ['workshop', 'admin'] },
  ],
);

export const USTAAD_VOUCH_STATUSES = ['requested', 'given', 'declined', 'expired', 'revoked'] as const;
export type UstaadVouchStatus = (typeof USTAAD_VOUCH_STATUSES)[number];
export const USTAAD_VOUCH_ACTIVE = ['requested', 'given'] as const;

export const ustaadVouchMachine = /* @__PURE__ */ defineMachine(
  'ustaad_vouch',
  USTAAD_VOUCH_STATUSES,
  ['declined', 'expired', 'revoked'],
  [
    { from: 'requested', to: 'given', by: ['member'] },
    { from: 'requested', to: 'declined', by: ['member'] },
    { from: 'requested', to: 'expired', by: ['system'] },
    // The voucher may take it back at any time (reason code); staff after a ring finding.
    { from: 'given', to: 'revoked', by: ['member', 'admin'] },
  ],
);
