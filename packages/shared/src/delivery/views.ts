/**
 * The two delivery blocks that ride on existing order answers (spec 24): the shop's order card and the customer's order
 * view. Their own small module so `order-views.ts` and `checkout-api.ts` can import them without the whole delivery
 * contract (JS budget, spec 16). Re-exported from `./api`.
 */
import { z } from 'zod';
import {
  AGENT_VEHICLE_TYPES,
  DELIVERY_FAIL_REASONS,
  DELIVERY_RATING_REASONS,
  DELIVERY_SWITCH_REASONS,
  ORDER_DELIVERY_MODES,
} from './codes';
import { DELIVERY_JOB_STATES } from '../state/delivery';

const Iso = z.string();
const Version = z.number().int().min(0);
const FourDigits = z.string().regex(/^[0-9]{4}$/);
const Vehicle = z.enum(AGENT_VEHICLE_TYPES);
const Uuid = z.uuid();

/** Added to each shop order card (`GET /v1/shop/orders`). Never the customer's code. */
export const ShopOrderDelivery = z.object({
  mode: z.enum(ORDER_DELIVERY_MODES),
  /** The 4-digit code the shop gives the agent at pickup (while ready for pickup). */
  pickupCode: FourDigits.nullable(),
  pickupLocked: z.boolean(),
  jobStatus: z.enum(DELIVERY_JOB_STATES).nullable(),
  agentFirstName: z.string().nullable(),
  vehicleType: Vehicle.nullable(),
  /** The agent is bringing the parcel back; the shop types the agent's return code. */
  returning: z.boolean(),
  /** Staff asked the shop to deliver this sub-order itself (Lead's call 9). */
  switchRequest: z
    .object({ id: Uuid, reasonCode: z.enum(DELIVERY_SWITCH_REASONS), requestedAt: Iso, version: Version })
    .nullable(),
});
/** Stages the customer sees (Lead's call 7): never the shop, never the agent's phone. */
export const CUSTOMER_DELIVERY_STAGES = [
  'finding_agent',
  'agent_assigned',
  'picked_up',
  'attempt_failed',
  'retrying',
  'returning',
  'delivered',
  'returned',
] as const;
/** Added to the customer's order view (`delivery`) for agent-mode sub-orders. */
export const CustomerDeliveryBlock = z.object({
  stage: z.enum(CUSTOMER_DELIVERY_STAGES),
  agentFirstName: z.string().nullable(),
  vehicleType: Vehicle.nullable(),
  failReason: z.enum(DELIVERY_FAIL_REASONS).nullable(),
  /** Delivered by an agent and not yet rated, or rated and still editable. */
  canRate: z.boolean(),
  rating: z
    .object({
      stars: z.number().int().min(1).max(5),
      reasons: z.array(z.enum(DELIVERY_RATING_REASONS)),
      note: z.string().nullable(),
      editableUntil: Iso,
      version: Version,
    })
    .nullable(),
});
