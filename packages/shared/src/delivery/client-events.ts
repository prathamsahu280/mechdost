/**
 * Browser analytics events of delivery agents (spec 12, spec 24; hard rule 9): what agents, shops, customers and staff
 * do on the delivery screens. Codes and booleans only — never a code typed by someone, a phone, a name or an address.
 * Merged into `CLIENT_EVENT_SCHEMAS` (`../analytics.ts`).
 */
import { z } from 'zod';
import {
  AGENT_DOCUMENT_KINDS,
  AGENT_VEHICLE_TYPES,
  DELIVERY_DECLINE_REASONS,
  DELIVERY_FAIL_REASONS,
  SHOP_DELIVERY_MODES,
} from './codes';

const PHOTO_PURPOSES = ['pickup', 'delivery', 'failure', 'document'] as const;

export const DELIVERY_CLIENT_EVENT_SCHEMAS = {
  delivery_apply_submitted: z.object({ vehicleType: z.enum(AGENT_VEHICLE_TYPES) }).strict(),
  delivery_invite_opened: z.object({ signedIn: z.boolean() }).strict(),
  delivery_invite_accepted: z.object({ withToken: z.boolean() }).strict(),
  delivery_online_toggled: z.object({ online: z.boolean() }).strict(),
  delivery_offer_viewed: z.object({ secondsLeft: z.number().int().min(0).max(3_600) }).strict(),
  delivery_offer_answered: z
    .object({
      decision: z.enum(['accept', 'decline']),
      reasonCode: z.enum(DELIVERY_DECLINE_REASONS).optional(),
    })
    .strict(),
  delivery_job_step: z
    .object({
      step: z.enum(['at_shop', 'pickup', 'at_customer', 'deliver', 'fail', 'give_up']),
      ok: z.boolean(),
      reasonCode: z.enum(DELIVERY_FAIL_REASONS).optional(),
    })
    .strict(),
  delivery_photo_taken: z.object({ purpose: z.enum(PHOTO_PURPOSES) }).strict(),
  delivery_contact_tapped: z
    .object({ target: z.enum(['shop', 'customer', 'support']), action: z.enum(['call', 'maps']) })
    .strict(),
  delivery_document_submitted: z.object({ kind: z.enum(AGENT_DOCUMENT_KINDS) }).strict(),
  delivery_shop_ready_marked: z.object({}).strict(),
  delivery_shop_return_confirmed: z.object({ ok: z.boolean() }).strict(),
  delivery_shop_switch_answered: z.object({ decision: z.enum(['confirmed', 'declined']) }).strict(),
  delivery_shop_mode_requested: z.object({ mode: z.enum(SHOP_DELIVERY_MODES) }).strict(),
  delivery_rating_submitted: z
    .object({ stars: z.number().int().min(1).max(5), edited: z.boolean() })
    .strict(),
  delivery_admin_action: z
    .object({
      action: z.enum([
        'offer',
        'withdraw',
        'retry_same',
        'retry_other',
        'return',
        'override_pickup',
        'override_delivery',
        'override_return',
        'switch',
        'verify_document',
        'reject_document',
        'status',
        'invite',
        'payout',
        'payout_correct',
        'shop_mode',
      ]),
    })
    .strict(),
} as const;
