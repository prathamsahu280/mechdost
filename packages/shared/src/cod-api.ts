/**
 * Wire shapes of cash-on-delivery eligibility and requests (founder ruling 2026-11-26; spec 03 § Cash-on-delivery
 * eligibility): the `cod.eligibility` block of the checkout quote, the customer's `GET /v1/me/cod`, and the staff
 * queue `GET /v1/admin/cod-requests`. Shared by the API (responses) and the website (validation, hard rule 4).
 */
import { z } from 'zod';
import {
  COD_CART_REASONS,
  COD_DECISION_REASONS,
  COD_PERSON_REASONS,
  COD_REQUEST_REASONS,
  COD_REQUEST_STATES,
  COD_REVOKE_REASONS,
} from './cod-eligibility';

export const CodEligibilityDto = z.object({
  eligible: z.boolean(),
  via: z.enum(['everyone', 'approved', 'ustaad']).nullable(),
  reason: z.enum(COD_PERSON_REASONS).nullable(),
  canRequest: z.boolean(),
  capPaise: z.number().int().nullable(),
});
export type CodEligibilityView = z.infer<typeof CodEligibilityDto>;

/** The quote's COD block. `eligibility`, `cartReason` and the minimums are new (older clients ignore them). */
export const QuoteCodDto = z.object({
  allowed: z.boolean(),
  reason: z.enum(['over_cap', 'pincode']).nullable(),
  capPaise: z.number().int(),
  eligibility: CodEligibilityDto.optional(),
  cartReason: z.enum(COD_CART_REASONS).nullable().optional(),
  minOrderPaise: z.number().int().optional(),
  minItems: z.number().int().optional(),
});

export const CodRequestDto = z.object({
  id: z.string(),
  pincode: z.string(),
  status: z.enum(COD_REQUEST_STATES),
  reasonCode: z.enum(COD_REQUEST_REASONS),
  note: z.string().nullable(),
  decisionReasonCode: z.enum(COD_DECISION_REASONS).nullable(),
  revokeReasonCode: z.enum(COD_REVOKE_REASONS).nullable(),
  capPaise: z.number().int().nullable(),
  expiresAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type CodRequestViewDto = z.infer<typeof CodRequestDto>;

export const MyCodDto = z.object({
  cityCode: z.string(),
  eligibility: CodEligibilityDto,
  minOrderPaise: z.number().int(),
  minItems: z.number().int(),
  requests: z.array(CodRequestDto),
});
export type MyCod = z.infer<typeof MyCodDto>;

export const CodRequestCreatedDto = z.object({
  id: z.string(),
  status: z.literal('pending'),
  version: z.number().int(),
});

export const AdminCodRequestDto = CodRequestDto.extend({
  customerId: z.string(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  cityCode: z.string(),
  deliveredOrders: z.number().int(),
  cancelledOrders: z.number().int(),
  ustaadVerified: z.boolean(),
});
export type AdminCodRequest = z.infer<typeof AdminCodRequestDto>;

export const AdminCodRequestsDto = z.object({
  items: z.array(AdminCodRequestDto),
  nextCursor: z.string().nullable(),
});
export type AdminCodRequests = z.infer<typeof AdminCodRequestsDto>;

export const CodDecisionDto = z.object({ status: z.enum(COD_REQUEST_STATES), version: z.number().int() });
