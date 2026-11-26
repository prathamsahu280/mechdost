/**
 * Delivery agents (spec 24, design `docs/superpowers/specs/2026-11-26-delivery-agents-design.md`): the code lists,
 * vehicle loads and the small pure rules shared by the API, the database CHECKs and the web. Zod-free, so browser
 * code can import it without pulling Zod into a page bundle (JS budget, spec 16). Zod contracts: `./api.ts`.
 */
import type { DeliveryJobStatus } from '../state/delivery';

export {
  AGENT_STATUSES,
  DELIVERY_JOB_STATES,
  DELIVERY_OFFER_STATES,
  DELIVERY_ACTIVE_JOB_STATES,
  type AgentStatus,
  type DeliveryJobStatus,
  type DeliveryOfferStatus,
} from '../state/delivery';

/** How a shop's prepaid sub-orders are delivered: MechDost agents (default in an enabled city) or the shop itself. */
export const SHOP_DELIVERY_MODES = ['agents', 'self'] as const;
export type ShopDeliveryMode = (typeof SHOP_DELIVERY_MODES)[number];

/** Who delivers one sub-order, fixed at routing (Lead's call 9) and switchable by admin to `shop`. */
export const ORDER_DELIVERY_MODES = ['agent', 'shop'] as const;
export type OrderDeliveryMode = (typeof ORDER_DELIVERY_MODES)[number];

/**
 * How jobs reach agents. Only `admin` (staff assign from ranked suggestions) is built; `broadcast` (agents pick open
 * jobs) is reserved for a later founder decision (design "Non-goals"). Not an admin setting until it does something.
 */
export const DELIVERY_DISPATCH_MODES = ['admin'] as const;

/** The vehicle an agent rides; each carries a maximum load (admin-editable per city, Lead's call 12). */
export const AGENT_VEHICLE_TYPES = ['bike', 'scooter', 'three_wheeler', 'goods_vehicle'] as const;
export type AgentVehicleType = (typeof AGENT_VEHICLE_TYPES)[number];

/** Founder defaults (kg); the settings `delivery.max_load_<vehicle>_kg` override them per city. */
export const DEFAULT_VEHICLE_MAX_LOAD_KG: Readonly<Record<AgentVehicleType, number>> = {
  bike: 20,
  scooter: 20,
  three_wheeler: 300,
  goods_vehicle: 1000,
};

/**
 * A product's load class: the fallback when a variant has no weight (Lead's calls 5, 12). `light` fits a two-wheeler,
 * `heavy` needs at least a three-wheeler (truck tyres, large batteries), `bulky` a goods vehicle (barrels).
 */
export const LOAD_CLASSES = ['light', 'heavy', 'bulky'] as const;
export type LoadClass = (typeof LOAD_CLASSES)[number];

/** Which load classes each vehicle may carry. */
export const VEHICLE_LOAD_CLASSES: Readonly<Record<AgentVehicleType, readonly LoadClass[]>> = {
  bike: ['light'],
  scooter: ['light'],
  three_wheeler: ['light', 'heavy'],
  goods_vehicle: ['light', 'heavy', 'bulky'],
};

export interface LoadLine {
  quantity: number;
  /** The variant's weight in grams; null when the catalogue does not know it. */
  weightG: number | null;
  loadClass: LoadClass;
}

/** A sub-order's load: the sum of known weights, and the heaviest class among lines without a weight. */
export interface SubOrderLoad {
  knownWeightG: number;
  unknownClass: LoadClass | null;
}

export function subOrderLoad(lines: readonly LoadLine[]): SubOrderLoad {
  let knownWeightG = 0;
  let unknownRank = -1;
  for (const l of lines) {
    if (l.weightG === null) unknownRank = Math.max(unknownRank, LOAD_CLASSES.indexOf(l.loadClass));
    else knownWeightG += l.quantity * l.weightG;
  }
  return { knownWeightG, unknownClass: unknownRank < 0 ? null : (LOAD_CLASSES[unknownRank] ?? null) };
}

/** Can this vehicle carry the load, given the city's maximum loads (kg)? */
export function vehicleCarries(
  vehicle: AgentVehicleType,
  load: SubOrderLoad,
  maxLoadKg: Readonly<Record<AgentVehicleType, number>>,
): boolean {
  if (load.knownWeightG > maxLoadKg[vehicle] * 1000) return false;
  return load.unknownClass === null || VEHICLE_LOAD_CLASSES[vehicle].includes(load.unknownClass);
}

/** Who delivers a new sub-order: COD stays with the shop until the founder sets cash rules (Lead's calls 8, 11). */
export function subOrderDeliveryMode(input: {
  shopMode: ShopDeliveryMode;
  paymentMethod: 'online' | 'cod';
  agentsEnabled: boolean;
}): OrderDeliveryMode {
  return input.agentsEnabled && input.shopMode === 'agents' && input.paymentMethod === 'online'
    ? 'agent'
    : 'shop';
}

/** Why an agent marked a delivery failed (Lead's call 4; ML-ready codes, `other` needs a note). */
export const DELIVERY_FAIL_REASONS = [
  'customer_unreachable',
  'customer_refused',
  'wrong_address',
  'unsafe_location',
  'vehicle_issue',
  'other',
] as const;
export type DeliveryFailReason = (typeof DELIVERY_FAIL_REASONS)[number];

/** Why an agent declined an offer. */
export const DELIVERY_DECLINE_REASONS = [
  'too_far',
  'vehicle_unsuitable',
  'busy',
  'going_offline',
  'other',
] as const;
export type DeliveryDeclineReason = (typeof DELIVERY_DECLINE_REASONS)[number];

/** Why an agent gave up an accepted job before pickup (back to the admin queue; counts on the scorecard). */
export const DELIVERY_GIVE_UP_REASONS = [
  'vehicle_issue',
  'emergency',
  'shop_closed',
  'parcel_not_ready',
  'other',
] as const;
export type DeliveryGiveUpReason = (typeof DELIVERY_GIVE_UP_REASONS)[number];

/** Why staff took an offered or accepted job back from an agent. */
export const DELIVERY_WITHDRAW_REASONS = [
  'agent_unresponsive',
  'reassigning',
  'order_changed',
  'other',
] as const;
export type DeliveryWithdrawReason = (typeof DELIVERY_WITHDRAW_REASONS)[number];

/** Admin's choice after a failed attempt (Lead's calls 4, 13). */
export const DELIVERY_FAILURE_DECISIONS = ['retry', 'return_to_shop'] as const;
export type DeliveryFailureDecision = (typeof DELIVERY_FAILURE_DECISIONS)[number];
/** A retry goes out with the same agent (the parcel stays with them) or another one (back to the shop first). */
export const DELIVERY_RETRY_AGENTS = ['same', 'other'] as const;
export type DeliveryRetryAgent = (typeof DELIVERY_RETRY_AGENTS)[number];

/** Why a job ended `returned`: the agent brought the parcel back to send it out again, or to close the order. */
export const DELIVERY_RETURN_OUTCOMES = ['retry', 'close'] as const;
export type DeliveryReturnOutcome = (typeof DELIVERY_RETURN_OUTCOMES)[number];

/** Why staff paused, suspended or offboarded an agent (with history; decision 2026-11-01 partner standing). */
export const AGENT_STATUS_REASONS = [
  'documents_expired',
  'documents_invalid',
  'customer_complaint',
  'repeated_declines',
  'repeated_failures',
  'safety_incident',
  'fraud_suspected',
  'agent_request',
  'inactive',
  'other',
] as const;
export type AgentStatusReason = (typeof AGENT_STATUS_REASONS)[number];

/** Documents an agent uploads after sign-in (founder 2026-11-26). Never Aadhaar. */
export const AGENT_DOCUMENT_KINDS = ['pan', 'driving_licence', 'vehicle_rc'] as const;
export type AgentDocumentKind = (typeof AGENT_DOCUMENT_KINDS)[number];
export const AGENT_DOCUMENT_STATUSES = ['submitted', 'verified', 'rejected'] as const;
export type AgentDocumentStatus = (typeof AGENT_DOCUMENT_STATUSES)[number];
export const AGENT_DOCUMENT_REJECT_REASONS = [
  'unreadable',
  'name_mismatch',
  'expired',
  'wrong_document',
  'number_mismatch',
  'other',
] as const;
export type AgentDocumentRejectReason = (typeof AGENT_DOCUMENT_REJECT_REASONS)[number];

/** Why staff switched an agent-mode sub-order to the shop's own delivery (Lead's call 9). */
export const DELIVERY_SWITCH_REASONS = [
  'no_vehicle_for_load',
  'no_agent_available',
  'repeated_failures',
  'customer_request',
  'other',
] as const;
export type DeliverySwitchReason = (typeof DELIVERY_SWITCH_REASONS)[number];
/** Why a shop declined to deliver a switched sub-order itself (back to admin). */
export const DELIVERY_SWITCH_DECLINE_REASONS = ['no_rider', 'too_far', 'too_busy', 'other'] as const;
export type DeliverySwitchDeclineReason = (typeof DELIVERY_SWITCH_DECLINE_REASONS)[number];
export const DELIVERY_SWITCH_STATES = ['requested', 'confirmed', 'declined', 'withdrawn'] as const;
export type DeliverySwitchStatus = (typeof DELIVERY_SWITCH_STATES)[number];

/** A shop asks to deliver its own orders (or to go back to agents); admin approves (Lead's calls 3, 11). */
export const SHOP_MODE_REQUEST_REASONS = [
  'own_riders',
  'faster_local_delivery',
  'customer_relationship',
  'agents_unreliable',
  'other',
] as const;
export type ShopModeRequestReason = (typeof SHOP_MODE_REQUEST_REASONS)[number];
export const SHOP_MODE_REJECT_REASONS = [
  'agents_cover_area',
  'service_quality',
  'incomplete_request',
  'other',
] as const;
export type ShopModeRejectReason = (typeof SHOP_MODE_REJECT_REASONS)[number];
export const SHOP_MODE_REQUEST_STATES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type ShopModeRequestStatus = (typeof SHOP_MODE_REQUEST_STATES)[number];

/** Delivery-agent applications and invites (Lead's call 10). */
export const AGENT_INVITE_STATES = ['sent', 'used', 'expired', 'revoked'] as const;
export type AgentInviteStatus = (typeof AGENT_INVITE_STATES)[number];

/**
 * Rider ratings (founder 2026-11-26): after a delivered job the customer rates the agent 1–5 with optional reason
 * codes (`other` needs a note). One rating per job, editable for `RATING_EDIT_HOURS`; the agent sees only their own
 * average and count, never who rated.
 */
export const DELIVERY_RATING_REASONS = [
  'on_time',
  'polite',
  'careful_with_parcel',
  'late',
  'rude',
  'damaged',
  'other',
] as const;
export type DeliveryRatingReason = (typeof DELIVERY_RATING_REASONS)[number];
export const RATING_EDIT_HOURS = 24;

/** The agent's average in tenths (4.3 → 43), or null before the first rating. Integer maths only. */
export function ratingAverageX10(sum: number, count: number): number | null {
  return count > 0 ? Math.round((sum * 10) / count) : null;
}

/** Four digits, like the customer's delivery code (decision 2026-11-01 "Proof of delivery"). */
export const HANDOVER_CODE_RE = /^[0-9]{4}$/;
/** Tries per pickup or return code before it locks (the admin override remains). */
export const HANDOVER_CODE_MAX_ATTEMPTS = 5;

/** Offers go only to active agents who are online (design: approved + verified + online). */
export function agentMayReceiveOffers(a: { status: string; online: boolean }): boolean {
  return a.status === 'active' && a.online;
}

/** One free retry by default: another attempt only while the failed attempts stay below the city's maximum. */
export function retryAllowed(input: { failedAttempts: number; maxAttempts: number }): boolean {
  return input.failedAttempts < input.maxAttempts;
}

/**
 * Refund after a return to the shop (Lead's call 13, founder accepted 2026-11-26): the customer's fault (refused, or
 * still unreachable on a retry) refunds the parts only and keeps the delivery fee; anything else refunds in full.
 * `failures` = the reasons of every failed attempt on the sub-order, oldest first.
 */
export function returnRefundKind(failures: readonly DeliveryFailReason[]): 'full' | 'parts_only' {
  const last = failures.at(-1);
  if (last === 'customer_refused') return 'parts_only';
  if (last === 'customer_unreachable' && failures.length >= 2) return 'parts_only';
  return 'full';
}

/**
 * What the agent may see at each job stage (Lead's call 6). `pickup`: the shop's name, address and phone, the
 * customer's area and PIN only. `drop`: the shop and the customer's name, address and phone (also while a failed job
 * awaits the admin, who may send the same agent again). `return`: the shop only. `none`: codes only.
 */
export type ContactStage = 'pickup' | 'drop' | 'return' | 'none';

export function contactStage(status: DeliveryJobStatus): ContactStage {
  switch (status) {
    case 'offered':
    case 'accepted':
      return 'pickup';
    case 'picked_up':
    case 'failed':
      return 'drop';
    case 'returning':
      return 'return';
    default:
      return 'none';
  }
}

const DOCUMENT_RE: Readonly<Record<AgentDocumentKind, RegExp>> = {
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  // State code + RTO + year + serial (Sarathi); older licences vary in length.
  driving_licence: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{7,13}$/,
  // State + RTO + series + number, or the Bharat (BH) series.
  vehicle_rc: /^(?:[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/,
};

/** Upper case without spaces, dots or hyphens. */
export function normaliseDocumentNumber(_kind: AgentDocumentKind, raw: string): string {
  return raw.toUpperCase().replace(/[\s.\-/]/g, '');
}

/** Null when the number fits its kind; `aadhaar` for any 12-digit number (never stored, design anti-goal). */
export function documentNumberProblem(kind: AgentDocumentKind, raw: string): 'aadhaar' | 'format' | null {
  const n = normaliseDocumentNumber(kind, raw);
  if (/^[0-9]{12}$/.test(n)) return 'aadhaar';
  return DOCUMENT_RE[kind].test(n) ? null : 'format';
}

/** Only the last four characters are ever shown (staff open the full number through an audited read). */
export function maskDocumentNumber(n: string): string {
  return '•'.repeat(Math.max(0, n.length - 4)) + n.slice(-4);
}

/**
 * Manual agent payouts (founder 2026-11-26: "payouts would be manual and we can make it automatic later"): staff
 * record each payment they made; corrections are new reversing rows. No rate maths and no transfers (rates undecided).
 */
export const AGENT_PAYOUT_METHODS = ['upi', 'bank_transfer', 'cash', 'other'] as const;
export type AgentPayoutMethod = (typeof AGENT_PAYOUT_METHODS)[number];
export const AGENT_PAYOUT_KINDS = ['payment', 'reversal'] as const;
export type AgentPayoutKind = (typeof AGENT_PAYOUT_KINDS)[number];
/** Largest single payout staff can record (paise): ₹2,00,000 — a typo guard, not a business limit. */
export const AGENT_PAYOUT_MAX_PAISE = 20_000_000;
