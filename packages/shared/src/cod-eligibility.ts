/**
 * Who may pay cash on delivery (founder ruling 2026-11-26: "cash on delivery would be only available on request if
 * the admin approves it for that user or like only for ustaad mechanics, not available to everyone (make it admin
 * configurable)"; addendum the same day: "we wont really give cash on delivery for one piece for normal users bc cash
 * handling would be an issue"). Pure and Zod-free so the cart and checkout can import it without growing their JS
 * (spec 03 § Cash-on-delivery eligibility). The API decides; the screen only explains.
 *
 * Three independent routes, each an admin setting per city with a global fallback:
 *   everyone (default off) · customers the admin approved (default on) · verified Ustaad members (default on).
 * The COD cap, the PIN's COD rule and customer blocks still apply on top, then the minimum order and pieces.
 */

/** Why a signed-in customer asks for cash on delivery (customer's choice; free text is only an extra note). */
export const COD_REQUEST_REASONS = [
  'no_upi_or_card', // has no UPI app, card or net banking
  'prefer_pay_on_receipt', // wants to see the part before paying
  'business_cash_account', // a garage or shop that settles in cash
  'regular_buyer', // orders often from MechDost
  'large_order', // a big order they do not want to prepay
  'other',
] as const;
export type CodRequestReason = (typeof COD_REQUEST_REASONS)[number];

/** Why staff turn a request down (shown to the customer in plain words; ML-ready, hard rule 16). */
export const COD_DECISION_REASONS = [
  'insufficient_history', // too few delivered orders yet
  'unverified_details', // phone, email or address not verified / incomplete
  'rto_history', // refused or returned cash parcels before
  'area_not_supported', // cash collection not set up for their area
  'risk_signals', // fraud or abuse signals
  'other',
] as const;
export type CodDecisionReason = (typeof COD_DECISION_REASONS)[number];

/** Why staff take an approval back later. */
export const COD_REVOKE_REASONS = [
  'cod_refused', // refused a cash parcel at the door (RTO)
  'misuse', // abuse of cash on delivery
  'customer_request', // the customer asked
  'risk_signals',
  'other',
] as const;
export type CodRevokeReason = (typeof COD_REVOKE_REASONS)[number];

/** Request lifecycle (machine `codRequestMachine` in `state/cod-request.ts`). */
export const COD_REQUEST_STATES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'revoked',
  'expired',
] as const;
export type CodRequestState = (typeof COD_REQUEST_STATES)[number];

/** How an eligible customer got cash on delivery. */
export type CodVia = 'everyone' | 'approved' | 'ustaad';

/** Why cash on delivery is not offered to this person (personal rules; the cart rules are `CodCartReason`). */
export const COD_PERSON_REASONS = [
  'sign_in_required',
  'disabled',
  'not_approved',
  'request_pending',
  'rejected',
  'revoked',
  'expired',
  'ustaad_not_member',
  'ustaad_not_verified',
  'ustaad_level_low',
] as const;
export type CodPersonReason = (typeof COD_PERSON_REASONS)[number];

export const COD_CART_REASONS = ['below_min_order', 'below_min_items'] as const;
export type CodCartReason = (typeof COD_CART_REASONS)[number];

export interface CodSwitches {
  everyone: boolean;
  approved: boolean;
  ustaad: boolean;
  /** 0 = any verified Ustaad level (Naya and up), 1 = Pakka, 2 = Bada, 3 = Master. */
  ustaadMinLevel: number;
}

/** Ranks for the minimum-level setting; Chhotu (apprentice) and pending levels never count. */
const USTAAD_COD_LEVELS = ['naya', 'pakka', 'bada', 'master'] as const;

export function ustaadLevelMeets(level: string, minLevel: number): boolean {
  const rank = (USTAAD_COD_LEVELS as readonly string[]).indexOf(level);
  return rank >= 0 && rank >= minLevel;
}

/** The newest request or approval for this customer in this city, reduced to what the rule needs. */
export interface CodApprovalFacts {
  state: 'none' | 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'revoked' | 'expired';
  /** Personal cap set by staff on approval (paise); the city cap still applies (the lower wins). */
  capPaise: number | null;
  /** After a reject or revoke the customer may ask again from this time (setting `checkout.cod_request_reapply_days`). */
  canRequestAgainAt: Date | null;
}

export interface CodUstaadFacts {
  verificationState: string;
  status: string;
  level: string;
  restrictedMode: string;
  perksFrozenUntil: Date | null;
}

export interface CodEligibilityInput {
  switches: CodSwitches;
  signedIn: boolean;
  approval: CodApprovalFacts;
  ustaad: CodUstaadFacts | null;
  now: Date;
}

export interface CodEligibility {
  eligible: boolean;
  via: CodVia | null;
  reason: CodPersonReason | null;
  /** True when "Request cash on delivery" is the next action. */
  canRequest: boolean;
  /** Personal cap (approved route only); null = only the city cap. */
  capPaise: number | null;
}

function ustaadProblem(m: CodUstaadFacts | null, minLevel: number, now: Date): CodPersonReason | null {
  if (!m || m.status === 'left') return 'ustaad_not_member';
  // Banned or restricted members, minor-report reviews and frozen perks (spec 23 SR-2, § 13) get no perk.
  const frozen = m.perksFrozenUntil !== null && m.perksFrozenUntil.getTime() > now.getTime();
  if (m.verificationState !== 'verified' || m.status !== 'active' || m.restrictedMode !== 'none' || frozen)
    return 'ustaad_not_verified';
  return ustaadLevelMeets(m.level, minLevel) ? null : 'ustaad_level_low';
}

/** Personal eligibility. Order: everyone → sign-in → approval → Ustaad → the one next action. */
export function codEligibility(input: CodEligibilityInput): CodEligibility {
  const { switches, approval, now } = input;
  const no = (reason: CodPersonReason, canRequest = false): CodEligibility => ({
    eligible: false,
    via: null,
    reason,
    canRequest,
    capPaise: null,
  });
  if (switches.everyone)
    return { eligible: true, via: 'everyone', reason: null, canRequest: false, capPaise: null };
  if (!switches.approved && !switches.ustaad) return no('disabled');
  if (!input.signedIn) return no('sign_in_required');
  if (switches.approved && approval.state === 'approved')
    return { eligible: true, via: 'approved', reason: null, canRequest: false, capPaise: approval.capPaise };
  const ustaad = switches.ustaad
    ? ustaadProblem(input.ustaad, switches.ustaadMinLevel, now)
    : 'ustaad_not_member';
  if (ustaad === null)
    return { eligible: true, via: 'ustaad', reason: null, canRequest: false, capPaise: null };
  if (switches.approved && approval.state === 'pending') return no('request_pending');
  // A member who only needs to finish verifying is pointed there before being asked to request.
  if (switches.ustaad && ustaad !== 'ustaad_not_member') return no(ustaad);
  if (!switches.approved) return no(ustaad);
  const waitOver =
    approval.canRequestAgainAt === null || approval.canRequestAgainAt.getTime() <= now.getTime();
  if (approval.state === 'rejected' || approval.state === 'revoked') return no(approval.state, waitOver);
  if (approval.state === 'expired') return no('expired', true);
  return no('not_approved', true);
}

/** Cart rules for an eligible customer (admin settings; defaults ₹0 and 1 piece = off). Null = no objection. */
export function codCartRule(input: {
  payablePaise: number;
  pieces: number;
  minOrderPaise: number;
  minItems: number;
}): CodCartReason | null {
  if (input.payablePaise < input.minOrderPaise) return 'below_min_order';
  if (input.pieces < input.minItems) return 'below_min_items';
  return null;
}

/** The lower of the city cap and a personal cap (an approval never raises the city cap). */
export function effectiveCodCap(cityCapPaise: number, personalCapPaise: number | null): number {
  return personalCapPaise === null ? cityCapPaise : Math.min(cityCapPaise, personalCapPaise);
}

/** Narrowing guards for codes read back from the database (CHECK constraints keep them in these lists). */
const member =
  <T extends string>(list: readonly T[]) =>
  (v: string | null): v is T =>
    v !== null && (list as readonly string[]).includes(v);
export const isCodRequestReason = member(COD_REQUEST_REASONS);
export const isCodDecisionReason = member(COD_DECISION_REASONS);
export const isCodRevokeReason = member(COD_REVOKE_REASONS);
export const isCodRequestState = member(COD_REQUEST_STATES);
