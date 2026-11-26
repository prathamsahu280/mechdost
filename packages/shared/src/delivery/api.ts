/**
 * Zod contracts of the delivery-agent routes (spec 24; route table in the design doc). Request bodies are `.strict()`
 * (no mass assignment, rule 4); responses are what the repositories return. Code lists and rules: `./codes.ts`.
 * Privacy (design anti-goals): no agent DTO carries the customer's delivery code or the shop's pickup code; the
 * customer's block never names the shop or the agent's phone (decisions 2026-11-14, 2026-11-22).
 */
import { z } from 'zod';
import { CUSTOMER_DELIVERY_STAGES, CustomerDeliveryBlock, ShopOrderDelivery } from './views';
import { IndianMobile } from '../partners';
import { DELIVERY_JOB_STATES, DELIVERY_OFFER_STATES, AGENT_STATUSES, ORDER_STATES } from '../state';
import {
  AGENT_DOCUMENT_KINDS,
  AGENT_DOCUMENT_REJECT_REASONS,
  AGENT_DOCUMENT_STATUSES,
  AGENT_INVITE_STATES,
  AGENT_PAYOUT_KINDS,
  AGENT_PAYOUT_MAX_PAISE,
  AGENT_PAYOUT_METHODS,
  AGENT_STATUS_REASONS,
  AGENT_VEHICLE_TYPES,
  DELIVERY_DECLINE_REASONS,
  DELIVERY_FAILURE_DECISIONS,
  DELIVERY_FAIL_REASONS,
  DELIVERY_RATING_REASONS,
  DELIVERY_GIVE_UP_REASONS,
  DELIVERY_RETRY_AGENTS,
  DELIVERY_RETURN_OUTCOMES,
  DELIVERY_SWITCH_DECLINE_REASONS,
  DELIVERY_SWITCH_REASONS,
  DELIVERY_SWITCH_STATES,
  DELIVERY_WITHDRAW_REASONS,
  LOAD_CLASSES,
  SHOP_DELIVERY_MODES,
  SHOP_MODE_REJECT_REASONS,
  SHOP_MODE_REQUEST_REASONS,
  SHOP_MODE_REQUEST_STATES,
  documentNumberProblem,
  type ContactStage,
} from './codes';

const Iso = z.string();
const Uuid = z.uuid();
const Version = z.number().int().min(0);
const Text = (min: number, max: number) => z.string().trim().min(min).max(max);
const Note = Text(1, 300);
const FourDigits = z.string().regex(/^[0-9]{4}$/);
const Vehicle = z.enum(AGENT_VEHICLE_TYPES);
const CityCode = z.string().regex(/^[A-Z]{3}$/);
const OrderCode = z.string().regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-Z]{6}-\d{1,2}$/);

/** A reason code; `other` needs a note (rule 16: codes first, free text only as an extra note). */
function withNote<T extends readonly [string, ...string[]]>(codes: T) {
  return z
    .object({ reasonCode: z.enum(codes), note: Note.optional() })
    .strict()
    .refine((v) => v.reasonCode !== 'other' || v.note !== undefined, {
      path: ['note'],
      message: 'NOTE_REQUIRED',
    });
}

// ── public ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `POST /v1/delivery-agent-applications` (Turnstile, per-IP and per-phone limits). Lead's call 10. */
export const DeliveryAgentApplication = z
  .object({
    name: Text(2, 80),
    phone: IndianMobile,
    cityCode: CityCode,
    vehicleType: Vehicle,
    consent: z.literal(true),
  })
  .strict();
export type DeliveryAgentApplicationT = z.infer<typeof DeliveryAgentApplication>;
export const DeliveryAgentApplySubmit = z
  .object({ application: DeliveryAgentApplication, turnstileToken: z.string().min(1).max(2048) })
  .strict();
export const DeliveryAgentApplyReceived = z.object({ code: z.string(), status: z.string() });

/** `GET /v1/delivery-invites/{token}`: what the invite page shows before sign-in (phone masked). */
export const AgentInvitePreview = z.object({
  name: z.string(),
  cityCode: z.string(),
  phoneLast4: z.string(),
  vehicleType: Vehicle,
  expiresAt: Iso,
});
/** `POST /v1/me/delivery-invites/accept` (signed in; the OTP-proven phone must match the invite). */
/** Without a token (from the WhatsApp message): the open invite of the account's OTP-proven phone. */
export const AgentInviteAccept = z
  .object({
    token: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32,64}$/)
      .optional(),
  })
  .strict();
export const AgentInviteAccepted = z.object({ agentId: Uuid, status: z.enum(AGENT_STATUSES) });

// ── agent ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const AgentDocument = z.object({
  kind: z.enum(AGENT_DOCUMENT_KINDS),
  status: z.enum(AGENT_DOCUMENT_STATUSES),
  numberMasked: z.string(),
  rejectReason: z.enum(AGENT_DOCUMENT_REJECT_REASONS).nullable(),
  submittedAt: Iso,
});

/** `GET /v1/agent/me`. */
export const AgentProfile = z.object({
  id: Uuid,
  firstName: z.string(),
  cityCode: z.string(),
  vehicleType: Vehicle,
  status: z.enum(AGENT_STATUSES),
  statusReason: z.enum(AGENT_STATUS_REASONS).nullable(),
  online: z.boolean(),
  /** Active, online and in a city with agents switched on. */
  canReceiveOffers: z.boolean(),
  documents: z.array(AgentDocument),
  /** Documents still to upload before admin can verify. */
  missingDocuments: z.array(z.enum(AGENT_DOCUMENT_KINDS)),
  /** Own average in tenths of a star (43 = 4.3) and count; never who rated (founder 2026-11-26). */
  ratingAvgX10: z.number().int().nullable(),
  ratingCount: z.number().int(),
  version: Version,
});
export type AgentProfileT = z.infer<typeof AgentProfile>;

/** `POST /v1/agent/me/online`. */
export const AgentOnlineInput = z.object({ online: z.boolean(), version: Version }).strict();

/**
 * `PUT /v1/agent/me/documents` — one document: the number (encrypted at rest) and its photo (uploaded first through
 * `POST /v1/agent/photos` with `purpose: 'document'`). Any 12-digit number is refused (never Aadhaar).
 */
export const AgentDocumentInput = z
  .object({
    kind: z.enum(AGENT_DOCUMENT_KINDS),
    number: Text(5, 32),
    mediaId: Uuid,
  })
  .strict()
  .superRefine((d, ctx) => {
    const problem = documentNumberProblem(d.kind, d.number);
    if (problem) ctx.addIssue({ code: 'custom', path: ['number'], message: problem.toUpperCase() });
  });

/** `POST /v1/agent/photos` (multipart `file` + `purpose`): the stored media id for a pickup, delivery, failure or document photo. */
export const AGENT_PHOTO_PURPOSES = ['pickup', 'delivery', 'failure', 'document'] as const;
export const AgentPhotoUploaded = z.object({ mediaId: Uuid });

/** What the agent sees of the shop and the customer, by stage (Lead's call 6). Every reveal is audited. */
export const AgentJobContact = z.object({
  stage: z.custom<ContactStage>((v) => v === 'pickup' || v === 'drop' || v === 'return' || v === 'none'),
  shop: z
    .object({
      name: z.string(),
      addressLine: z.string(),
      pincode: z.string(),
      phone: z.string(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
    })
    .nullable(),
  /** Area + PIN at `pickup`; everything at `drop`; null at `return` and `none`. */
  customer: z
    .object({
      area: z.string().nullable(),
      pincode: z.string(),
      name: z.string().nullable(),
      addressLine: z.string().nullable(),
      landmark: z.string().nullable(),
      phone: z.string().nullable(),
    })
    .nullable(),
});

/** `GET /v1/agent/jobs?view=offers|active|done` items. */
export const AgentJobCard = z.object({
  jobId: Uuid,
  orderCode: OrderCode,
  status: z.enum(DELIVERY_JOB_STATES),
  /** The open offer to this agent (offers view only). */
  offerId: Uuid.nullable(),
  offerExpiresAt: Iso.nullable(),
  itemCount: z.number().int(),
  loadClass: z.enum(LOAD_CLASSES),
  weightKg: z.number().nullable(),
  shopArea: z.string().nullable(),
  customerPincode: z.string(),
  distanceM: z.number().int().nullable(),
  attempt: z.number().int(),
  updatedAt: Iso,
});
export const AgentJobPage = z.object({ items: z.array(AgentJobCard), nextCursor: z.string().nullable() });
export const AGENT_JOB_VIEWS = ['offers', 'active', 'done'] as const;

/** `GET /v1/agent/jobs/{jobId}`: one job with contacts by stage. A job never offered to this agent is 404. */
export const AgentJobDetail = z.object({
  jobId: Uuid,
  orderCode: OrderCode,
  status: z.enum(DELIVERY_JOB_STATES),
  offerId: Uuid.nullable(),
  offerExpiresAt: Iso.nullable(),
  items: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
  loadClass: z.enum(LOAD_CLASSES),
  weightKg: z.number().nullable(),
  contact: AgentJobContact,
  /** Shown to the agent while carrying a parcel back; the shop types it to confirm the hand-back. */
  returnCode: FourDigits.nullable(),
  photosRequired: z.boolean(),
  pickupLocked: z.boolean(),
  deliveryLocked: z.boolean(),
  failReason: z.enum(DELIVERY_FAIL_REASONS).nullable(),
  attempt: z.number().int(),
  version: Version,
});
export type AgentJobDetailT = z.infer<typeof AgentJobDetail>;

/** `POST /v1/agent/offers/{offerId}/accept`. */
export const OfferAcceptInput = z.object({}).strict();
/** `POST /v1/agent/offers/{offerId}/decline`. */
export const OfferDeclineInput = withNote(DELIVERY_DECLINE_REASONS);
/** `POST /v1/agent/jobs/{jobId}/give-up` (accepted, before pickup). */
export const GiveUpInput = z
  .object({ reasonCode: z.enum(DELIVERY_GIVE_UP_REASONS), note: Note.optional(), version: Version })
  .strict()
  .refine((v) => v.reasonCode !== 'other' || v.note !== undefined, {
    path: ['note'],
    message: 'NOTE_REQUIRED',
  });

/** The photo is required while `delivery.photos_required` is on (default); the API refuses a missing one then. */
const PhotoId = Uuid.optional();

/** `POST /v1/agent/jobs/{jobId}/pickup`: the shop's code + the pickup photo (parcel; battery serial for batteries). */
export const PickupInput = z
  .object({ pickupCode: FourDigits, photoMediaId: PhotoId, version: Version })
  .strict();
/** `POST /v1/agent/jobs/{jobId}/deliver`: the customer's code + the delivery photo. */
export const DeliverInput = z
  .object({ deliveryCode: FourDigits, photoMediaId: PhotoId, version: Version })
  .strict();
/** `POST /v1/agent/jobs/{jobId}/fail`: reason code (+ note for `other`) + photo. */
export const FailInput = z
  .object({
    reasonCode: z.enum(DELIVERY_FAIL_REASONS),
    note: Note.optional(),
    photoMediaId: PhotoId,
    version: Version,
  })
  .strict()
  .refine((v) => v.reasonCode !== 'other' || v.note !== undefined, {
    path: ['note'],
    message: 'NOTE_REQUIRED',
  });

/**
 * Result of a successful code step (200). A wrong code answers 422 `WRONG_CODE` with `details.attemptsLeft`; a locked
 * code 423 `CODE_LOCKED` (the attempt is counted either way). Same for the shop's return-code step.
 */
export const CodeStepResult = z.object({
  ok: z.boolean(),
  attemptsLeft: z.number().int().min(0),
  locked: z.boolean(),
  status: z.enum(DELIVERY_JOB_STATES),
});

// ── shop ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `POST /v1/shop/orders/{code}/advance` gains `step: 'ready_for_pickup'` (agent-mode sub-orders). */
export const SHOP_ADVANCE_STEPS = ['packed', 'ready_for_pickup', 'shipped', 'out_for_delivery'] as const;
/** `POST /v1/shop/orders/{code}/return-received`. */
export const ReturnReceivedInput = z.object({ returnCode: FourDigits }).strict();
/** `POST /v1/shop/orders/{code}/delivery-switch/{id}/confirm`. */
export const SwitchConfirmInput = z.object({ version: Version }).strict();
/** `POST /v1/shop/orders/{code}/delivery-switch/{id}/decline`. */
export const SwitchDeclineInput = z
  .object({ reasonCode: z.enum(DELIVERY_SWITCH_DECLINE_REASONS), note: Note.optional(), version: Version })
  .strict()
  .refine((v) => v.reasonCode !== 'other' || v.note !== undefined, {
    path: ['note'],
    message: 'NOTE_REQUIRED',
  });

const ShopModeRequestRow = z.object({
  id: Uuid,
  requestedMode: z.enum(SHOP_DELIVERY_MODES),
  reasonCode: z.enum(SHOP_MODE_REQUEST_REASONS),
  note: z.string().nullable(),
  status: z.enum(SHOP_MODE_REQUEST_STATES),
  decisionReason: z.enum(SHOP_MODE_REJECT_REASONS).nullable(),
  createdAt: Iso,
  decidedAt: Iso.nullable(),
  version: Version,
});
/** `GET /v1/shop/delivery-mode/{shopId}`. */
export const ShopDeliveryModeView = z.object({
  mode: z.enum(SHOP_DELIVERY_MODES),
  /** Agents are switched on in the shop's city. */
  agentsEnabled: z.boolean(),
  requests: z.array(ShopModeRequestRow),
});
/** `POST /v1/shop/delivery-mode/{shopId}/requests`. */
export const ShopModeRequestInput = z
  .object({
    requestedMode: z.enum(SHOP_DELIVERY_MODES),
    reasonCode: z.enum(SHOP_MODE_REQUEST_REASONS),
    note: Note.optional(),
  })
  .strict()
  .refine((v) => v.reasonCode !== 'other' || v.note !== undefined, {
    path: ['note'],
    message: 'NOTE_REQUIRED',
  });

// ── customer ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `PUT /v1/me/orders/{code}/delivery-rating` (customer, own delivered agent sub-order; founder 2026-11-26). One rating
 * per job; editing within 24 h sends `version`. `other` needs a note. Rate limited per user.
 */
export const DeliveryRatingInput = z
  .object({
    stars: z.number().int().min(1).max(5),
    reasons: z
      .array(z.enum(DELIVERY_RATING_REASONS))
      .max(DELIVERY_RATING_REASONS.length)
      .refine((r) => new Set(r).size === r.length, 'duplicate reason')
      .default([]),
    note: Note.optional(),
    version: Version.optional(),
  })
  .strict()
  .refine((v) => !v.reasons.includes('other') || v.note !== undefined, {
    path: ['note'],
    message: 'NOTE_REQUIRED',
  });
export const DeliveryRatingSaved = z.object({
  stars: z.number().int(),
  editableUntil: Iso,
  version: Version,
});

// ── admin ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `GET /v1/admin/delivery/agents` rows. Phone masked; documents as statuses only. */
export const AdminAgentRow = z.object({
  id: Uuid,
  name: z.string(),
  phoneMasked: z.string(),
  cityCode: z.string(),
  vehicleType: Vehicle,
  status: z.enum(AGENT_STATUSES),
  statusReason: z.enum(AGENT_STATUS_REASONS).nullable(),
  online: z.boolean(),
  activeJobs: z.number().int(),
  documentsVerified: z.number().int(),
  ratingAvgX10: z.number().int().nullable(),
  ratingCount: z.number().int(),
  createdAt: Iso,
  version: Version,
});
export const AdminAgentPage = z.object({ items: z.array(AdminAgentRow), nextCursor: z.string().nullable() });
/** `GET /v1/admin/delivery/agents/{id}`. */
export const AdminAgentDetail = AdminAgentRow.extend({
  documents: z.array(AgentDocument),
  /** Latest ratings (stars, reasons, note, when); never the customer. */
  ratings: z.array(
    z.object({
      orderCode: OrderCode,
      stars: z.number().int(),
      reasons: z.array(z.enum(DELIVERY_RATING_REASONS)),
      note: z.string().nullable(),
      at: Iso,
    }),
  ),
  history: z.array(
    z.object({
      at: Iso,
      fromStatus: z.enum(AGENT_STATUSES).nullable(),
      toStatus: z.enum(AGENT_STATUSES),
      reasonCode: z.enum(AGENT_STATUS_REASONS).nullable(),
      note: z.string().nullable(),
    }),
  ),
  kpis: z.object({
    offers30d: z.number().int(),
    accepted30d: z.number().int(),
    delivered30d: z.number().int(),
    failed30d: z.number().int(),
  }),
});
/** `POST /v1/admin/delivery/agents/{id}/status`. */
export const AgentStatusInput = z
  .object({
    status: z.enum(AGENT_STATUSES),
    reasonCode: z.enum(AGENT_STATUS_REASONS).optional(),
    note: Note.optional(),
    pausedUntil: Iso.optional(),
    version: Version,
  })
  .strict()
  .refine((v) => v.status === 'active' || v.reasonCode !== undefined, {
    path: ['reasonCode'],
    message: 'REASON_REQUIRED',
  });
/** `PATCH /v1/admin/delivery/agents/{id}` — staff-only edits (the agent cannot change the vehicle themselves). */
export const AgentEditInput = z.object({ vehicleType: Vehicle, version: Version }).strict();
/** `POST /v1/admin/delivery/agents/{id}/documents/{kind}/verify` and `/reject`. */
export const DocumentDecisionInput = z
  .object({ reasonCode: z.enum(AGENT_DOCUMENT_REJECT_REASONS).optional(), note: Note.optional() })
  .strict();
/** `GET /v1/admin/delivery/agents/{id}/documents/{kind}` (audited): full number + a short-lived photo URL. */
export const AdminDocumentView = z.object({
  kind: z.enum(AGENT_DOCUMENT_KINDS),
  number: z.string(),
  photoUrl: z.string(),
  status: z.enum(AGENT_DOCUMENT_STATUSES),
});

/** `POST /v1/admin/delivery/invites`: from an application, or someone who never applied. */
export const AgentInviteInput = z.union([
  z.object({ applicationCode: z.string().regex(/^PA-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/) }).strict(),
  z
    .object({
      name: Text(2, 80),
      phone: IndianMobile,
      email: z.string().trim().toLowerCase().pipe(z.email().max(120)).optional(),
      cityCode: CityCode,
      vehicleType: Vehicle,
    })
    .strict(),
]);
export const AgentInviteRow = z.object({
  id: Uuid,
  name: z.string(),
  phoneLast4: z.string(),
  hasEmail: z.boolean(),
  cityCode: z.string(),
  vehicleType: Vehicle,
  status: z.enum(AGENT_INVITE_STATES),
  expiresAt: Iso,
  createdAt: Iso,
});
export const AgentInvitePage = z.object({
  items: z.array(AgentInviteRow),
  nextCursor: z.string().nullable(),
});
/** The token is shown to staff once, like seller invites. */
export const AgentInviteCreated = z.object({ id: Uuid, token: z.string(), expiresAt: Iso });

/** `GET /v1/admin/delivery/jobs?view=…`. */
/** `all` with `orderCode` lists the jobs of one sub-order (admin order page). */
export const ADMIN_JOB_VIEWS = [
  'needs_agent',
  'offered',
  'active',
  'failed',
  'returning',
  'done',
  'all',
] as const;
export const AdminJobRow = z.object({
  jobId: Uuid,
  orderCode: OrderCode,
  cityCode: z.string(),
  status: z.enum(DELIVERY_JOB_STATES),
  orderStatus: z.enum(ORDER_STATES),
  shopName: z.string(),
  customerPincode: z.string(),
  agent: z.object({ id: Uuid, name: z.string(), vehicleType: Vehicle }).nullable(),
  offerExpiresAt: Iso.nullable(),
  loadClass: z.enum(LOAD_CLASSES),
  weightKg: z.number().nullable(),
  attempt: z.number().int(),
  failReason: z.enum(DELIVERY_FAIL_REASONS).nullable(),
  /** Minutes since the job entered its current status (SLA chips). */
  waitingMin: z.number().int(),
  version: Version,
});
export const AdminJobPage = z.object({ items: z.array(AdminJobRow), nextCursor: z.string().nullable() });
/** Ranked agent suggestions for a job (Lead's call 1). */
export const AgentSuggestion = z.object({
  agentId: Uuid,
  name: z.string(),
  vehicleType: Vehicle,
  distanceM: z.number().int().nullable(),
  activeJobs: z.number().int(),
  acceptanceRateBp: z.number().int().nullable(),
  carriesLoad: z.boolean(),
  ratingAvgX10: z.number().int().nullable(),
  ratingCount: z.number().int(),
});
export const AdminJobDetail = AdminJobRow.extend({
  /** The shop's pickup code is locked (5 wrong tries): only the pickup override is left. */
  pickupLocked: z.boolean(),
  /** The customer's delivery code is locked: only the delivery override is left. */
  deliveryLocked: z.boolean(),
  /** A failed job may still be retried (`delivery.max_attempts`); otherwise only return to the shop. */
  retryAllowed: z.boolean(),
  suggestions: z.array(AgentSuggestion),
  events: z.array(
    z.object({
      at: Iso,
      kind: z.string(),
      actorType: z.string(),
      fromStatus: z.enum(DELIVERY_JOB_STATES).nullable(),
      toStatus: z.enum(DELIVERY_JOB_STATES).nullable(),
      reasonCode: z.string().nullable(),
    }),
  ),
  offers: z.array(
    z.object({
      id: Uuid,
      agentName: z.string(),
      status: z.enum(DELIVERY_OFFER_STATES),
      reasonCode: z.string().nullable(),
      createdAt: Iso,
      decidedAt: Iso.nullable(),
    }),
  ),
  /** Photo URLs (short-lived), staff only. */
  photos: z.array(z.object({ purpose: z.enum(['pickup', 'delivery', 'failure']), url: z.string(), at: Iso })),
});
/** `POST /v1/admin/delivery/jobs/{jobId}/offer`. */
export const JobOfferInput = z.object({ agentId: Uuid, version: Version }).strict();
/** `POST /v1/admin/delivery/jobs/{jobId}/withdraw`. */
export const JobWithdrawInput = z
  .object({ reasonCode: z.enum(DELIVERY_WITHDRAW_REASONS), note: Note.optional(), version: Version })
  .strict();
/** `POST /v1/admin/delivery/jobs/{jobId}/failure-decision` (Lead's calls 4, 13). */
export const FailureDecisionInput = z
  .object({
    decision: z.enum(DELIVERY_FAILURE_DECISIONS),
    /** For `retry`: the same agent (keeps the parcel) or another one (the parcel goes back to the shop first). */
    agent: z.enum(DELIVERY_RETRY_AGENTS).optional(),
    version: Version,
  })
  .strict()
  .refine((v) => v.decision !== 'retry' || v.agent !== undefined, {
    path: ['agent'],
    message: 'AGENT_REQUIRED',
  });
/** `POST /v1/admin/delivery/jobs/{jobId}/override-pickup|override-delivery|override-return` (audited). */
export const JobOverrideInput = z.object({ reason: Text(5, 300), version: Version }).strict();
/** `POST /v1/admin/orders/{code}/delivery-switch` (Lead's call 9). */
export const DeliverySwitchInput = z
  .object({ reasonCode: z.enum(DELIVERY_SWITCH_REASONS), note: Note.optional() })
  .strict()
  .refine((v) => v.reasonCode !== 'other' || v.note !== undefined, {
    path: ['note'],
    message: 'NOTE_REQUIRED',
  });
export const DeliverySwitchRow = z.object({
  id: Uuid,
  orderCode: OrderCode,
  status: z.enum(DELIVERY_SWITCH_STATES),
  reasonCode: z.enum(DELIVERY_SWITCH_REASONS),
  declineReason: z.enum(DELIVERY_SWITCH_DECLINE_REASONS).nullable(),
  createdAt: Iso,
  version: Version,
});

/** `GET /v1/admin/delivery/shop-mode-requests?status=`; approve / reject. */
export const AdminShopModeRequestRow = ShopModeRequestRow.extend({
  shopId: Uuid,
  shopName: z.string(),
  cityCode: z.string(),
  currentMode: z.enum(SHOP_DELIVERY_MODES),
});
export const AdminShopModeRequestPage = z.object({
  items: z.array(AdminShopModeRequestRow),
  nextCursor: z.string().nullable(),
});
export const ShopModeDecisionInput = z
  .object({
    reasonCode: z.enum(SHOP_MODE_REJECT_REASONS).optional(),
    note: Note.optional(),
    version: Version,
  })
  .strict();
/** `PUT /v1/admin/shops/{shopId}/delivery-mode`: staff set or revoke directly (history kept). */
export const ShopModeSetInput = z
  .object({ mode: z.enum(SHOP_DELIVERY_MODES), note: Text(5, 300), version: Version })
  .strict();

/** `GET /v1/admin/delivery/kpis?cityCode&from&to` (design "Analytics"). Durations in seconds (median). */
export const DeliveryKpis = z.object({
  jobs: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  returned: z.number().int(),
  offers: z.number().int(),
  acceptanceRateBp: z.number().int().nullable(),
  medianAssignS: z.number().int().nullable(),
  medianPickupS: z.number().int().nullable(),
  medianDeliverS: z.number().int().nullable(),
  failuresByReason: z.partialRecord(z.enum(DELIVERY_FAIL_REASONS), z.number().int()),
  activeAgents: z.number().int(),
  onlineAgents: z.number().int(),
});

export { DELIVERY_RETURN_OUTCOMES };

// ── manual agent payouts (founder 2026-11-26) ────────────────────────────────────────────────────────────────────

const Day = z.iso.date();
const IdemKey = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** `POST /v1/admin/delivery/payouts` (`delivery_payouts:manage`): one payment already made to an agent. */
export const AgentPayoutInput = z
  .object({
    agentId: Uuid,
    amountPaise: z.number().int().min(1).max(AGENT_PAYOUT_MAX_PAISE),
    periodFrom: Day,
    periodTo: Day,
    method: z.enum(AGENT_PAYOUT_METHODS),
    reference: Text(1, 80).optional(),
    note: Note.optional(),
    /** The same key twice records once (double click, retry). */
    idempotencyKey: IdemKey.refine((k) => !k.startsWith('rev-'), 'rev- keys are reserved for corrections'),
  })
  .strict()
  .refine((v) => v.periodFrom <= v.periodTo, { path: ['periodTo'], message: 'PERIOD_ORDER' })
  .refine((v) => v.method !== 'other' || v.note !== undefined, { path: ['note'], message: 'NOTE_REQUIRED' });

/** `POST /v1/admin/delivery/payouts/{payoutId}/reverse`: a correction is a new row with the opposite amount. */
/**
 * `POST /v1/admin/delivery/payouts/{payoutId}/correct`: a correction is a new row with the opposite amount (one per
 * payment, so the key defaults to one derived from the payment).
 */
export const AgentPayoutReverseInput = z.object({ note: Note, idempotencyKey: IdemKey.optional() }).strict();
/** Client payout keys may not start with `rev-` (reserved for reversals). */
export const PAYOUT_RESERVED_KEY_PREFIX = 'rev-';

/** Staff rows (`GET /v1/admin/delivery/payouts?agentId&from&to&format=json|csv`). */
export const AgentPayoutRow = z.object({
  id: Uuid,
  agentId: Uuid,
  agentName: z.string(),
  kind: z.enum(AGENT_PAYOUT_KINDS),
  amountPaise: z.number().int(),
  periodFrom: z.string(),
  periodTo: z.string(),
  method: z.enum(AGENT_PAYOUT_METHODS),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  reversesId: Uuid.nullable(),
  /** A reversing row exists for this payment. */
  corrected: z.boolean(),
  recordedByName: z.string().nullable(),
  createdAt: Iso,
});
export const AgentPayoutPage = z.object({
  items: z.array(AgentPayoutRow),
  totalPaise: z.number().int(),
  nextCursor: z.string().nullable(),
});

/** One payout as the agent sees it: never the staff note (always null) or who recorded it. */
export const AgentOwnPayoutRow = z.object({
  id: Uuid,
  agentId: Uuid,
  kind: z.enum(AGENT_PAYOUT_KINDS),
  amountPaise: z.number().int(),
  periodFrom: z.string(),
  periodTo: z.string(),
  method: z.enum(AGENT_PAYOUT_METHODS),
  reference: z.string().nullable(),
  note: z.null(),
  reversesId: Uuid.nullable(),
  corrected: z.boolean(),
  createdAt: Iso,
});
/** `GET /v1/agent/me/earnings`: the agent's recorded payouts and delivered jobs (all time). */
export const AgentEarnings = z.object({
  payouts: z.array(AgentOwnPayoutRow),
  totalPaise: z.number().int(),
  deliveredJobs: z.number().int(),
});

/** `GET /v1/admin/delivery/payouts/summary?from&to` (IST days): delivered jobs and net paid per agent in scope. */
export const AgentPayoutSummary = z.object({
  items: z.array(
    z.object({ agentId: Uuid, name: z.string(), delivered: z.number().int(), paidPaise: z.number().int() }),
  ),
});

/** `GET /v1/admin/delivery/payouts/delivered-count?agentId&from&to` (IST days): a helper for working out pay. */
export const AgentDeliveredCount = z.object({
  agentId: Uuid,
  from: z.string(),
  to: z.string(),
  delivered: z.number().int(),
  failedAttempts: z.number().int(),
  paidPaise: z.number().int(),
});

export { CUSTOMER_DELIVERY_STAGES, CustomerDeliveryBlock, ShopOrderDelivery };
