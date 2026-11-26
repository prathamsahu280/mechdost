/**
 * What checkout and Account → Payments show for cash on delivery (founder ruling 2026-11-26; spec 03 § Cash-on-
 * delivery eligibility). Pure and Zod-free: the server decides (quote + `POST /orders`); this only mirrors its order
 * of checks after the coupon and Coins the customer picked, and names the one next action.
 */
import { codCartRule, type CodCartReason, type CodPersonReason } from '@mechdost/shared/cod-eligibility';

export type CodShownReason = CodPersonReason | CodCartReason | 'over_cap' | 'pincode';

export interface QuoteCodLike {
  totalPaise: number;
  cod: {
    allowed: boolean;
    reason: 'over_cap' | 'pincode' | null;
    capPaise: number;
    eligibility?: { eligible: boolean; reason: CodPersonReason | null; canRequest: boolean } | undefined;
    minOrderPaise?: number | undefined;
    minItems?: number | undefined;
  };
}

export interface CodChoice {
  available: boolean;
  reason: CodShownReason | null;
  canRequest: boolean;
}

/**
 * Person first (eligibility), then the PIN rule, the cap and the cart minimums on what is paid at the door (after the
 * coupon and Coins), the same order as the server's placement.
 */
export function codChoice(quote: QuoteCodLike, cart: { discountPaise: number; pieces: number }): CodChoice {
  const e = quote.cod.eligibility;
  if (e && !e.eligible) return { available: false, reason: e.reason ?? 'disabled', canRequest: e.canRequest };
  if (quote.cod.reason === 'pincode') return { available: false, reason: 'pincode', canRequest: false };
  const payable = quote.totalPaise - cart.discountPaise;
  if (payable > quote.cod.capPaise) return { available: false, reason: 'over_cap', canRequest: false };
  const cartReason = codCartRule({
    payablePaise: payable,
    pieces: cart.pieces,
    minOrderPaise: quote.cod.minOrderPaise ?? 0,
    minItems: quote.cod.minItems ?? 1,
  });
  return cartReason
    ? { available: false, reason: cartReason, canRequest: false }
    : { available: true, reason: null, canRequest: false };
}

export type CodAction = 'sign_in' | 'request' | 'ustaad_join' | 'ustaad_verify';

/** The single next step for a reason (none when waiting is all there is to do, or the cart is the reason). */
export function codNextAction(reason: CodShownReason | null, canRequest: boolean): CodAction | null {
  if (reason === 'sign_in_required') return 'sign_in';
  if (canRequest) return 'request';
  if (reason === 'ustaad_not_verified') return 'ustaad_verify';
  if (reason === 'ustaad_not_member') return 'ustaad_join';
  return null;
}
