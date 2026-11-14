import { z } from 'zod';
import { redactPath } from './analytics-path';
import { scrubFreeText } from './privacy';
import { ORDER_CANCEL_REASONS } from './state';

/**
 * Server-side analytics events (spec 12; hard rules 9 and 16). Emitted by the API inside the same transaction
 * as the state or money change they describe, so each is stored exactly once. Props carry ids, codes, enums and
 * integer paise only — never names, phone numbers, emails, addresses or free text.
 */
export interface ServerEventProps {
  purchase: {
    orderCode: string;
    subOrders: number;
    items: number;
    totalPaise: number;
    paymentMethod: 'cod' | 'online';
  };
  admin_order_routed: { orderCode: string; shopId: string; attempt: number };
  admin_order_rerouted: { orderCode: string; shopId: string; attempt: number };
  admin_order_rejected: { orderCode: string; reasonCode: string };
  seller_order_accepted: { orderCode: string; shopId: string; secondsToAccept: number };
  seller_order_declined: { orderCode: string; shopId: string; reasonCode: string };
  order_cancelled: {
    orderCode: string;
    by: 'customer' | 'staff' | 'system';
    reasonCode: string;
    fromStatus: string;
  };
  payment_captured: { orderCode: string; amountPaise: number; method: string };
  payment_failed: { orderCode: string; amountPaise: number; method: string };
  order_delivered: { orderCode: string; shopId: string };
  admin_delivery_override: { orderCode: string };
  order_fulfilment_step: {
    orderCode: string;
    shopId: string;
    step: 'packed' | 'shipped' | 'out_for_delivery';
  };
  admin_customer_blocked: { customerId: string; level: string; reasonCode: string };
  admin_customer_unblocked: { customerId: string; level: string };
  /** A verified customer review, pending moderation (spec 02 § Reviews). Rating only, never the text. */
  review_submitted: {
    reviewId: string;
    targetType: 'product' | 'workshop';
    targetId: string;
    rating: number;
    hasText: boolean;
  };
  admin_review_moderated: {
    reviewId: string;
    targetType: 'product' | 'workshop';
    from: string;
    to: string;
    reasonCode: string | null;
  };
  admin_product_status_changed: { productSlug: string; from: string; to: string };
  /** A product added by staff, from the admin form or a CSV import (status draft, or live when published). */
  admin_product_created: { productSlug: string; sku: string; status: string; source: 'form' | 'import' };
  /** One committed CSV import (dry runs are not counted): rows in the file, products added, SKUs skipped. */
  admin_catalogue_imported: { rows: number; created: number; skipped: number; status: string };
  admin_content_published: { key: string; locale: 'en' | 'hi'; action: 'published' | 'unpublished' };
  inventory_updated: { shopId: string; sku: string; fields: string[]; by: 'shop' | 'staff' };
  partner_application_submitted: {
    kind: string;
    source: 'public' | 'invite';
    gstStatus: string;
    products: number;
    locationSource: string;
  };
  partner_application_decided: { decision: 'approved' | 'rejected'; reasonCode: string | null };
  partner_invite_sent: Record<string, never>;
  /** The invite link was opened (funnel: sent → opened → submitted). */
  partner_invite_opened: Record<string, never>;
  price_request_submitted: { shopId: string; sku: string };
  price_request_decided: {
    shopId: string;
    sku: string;
    decision: 'approved' | 'rejected';
    reasonCode: string | null;
  };
  agreement_accepted: { shopId: string; version: number };
  shop_went_live: { shopId: string };
  /** Workshops and service requests (spec 06): codes, ids, enums and counts only. */
  service_requested: {
    requestCode: string;
    workshopId: string | null;
    routing: 'chosen' | 'mechdost';
    services: number;
  };
  service_status_changed: {
    requestCode: string;
    workshopId: string | null;
    from: string;
    to: string;
    by: 'customer' | 'workshop' | 'admin' | 'system';
    reasonCode: string | null;
  };
  service_estimate_sent: { requestCode: string; workshopId: string; revision: number; lines: number };
  service_estimate_decided: { requestCode: string; revision: number; approved: number; declined: number };
  service_billed: { requestCode: string; workshopId: string; totalPaise: number; lines: number };
  admin_workshop_saved: { workshopId: string; action: 'created' | 'updated'; published: boolean };
}
export type ServerEvent = keyof ServerEventProps;

/**
 * Client events (web/app → `POST /v1/events`). One schema per event is the registry: the API rejects unknown
 * events and invalid props; the web imports only the *types* (`import type`), so no validator ships to browsers.
 * Strings are short ids, slugs, paths or codes; the only user-typed text is the search query, scrubbed of
 * emails and phone-like numbers (`scrubFreeText`) in the browser and again here.
 */
// Paths and ids are where personal data could slip in (code review 2026-11-03), so they are tight here, once:
// a path keeps only the pathname (query string and fragment dropped, long digit runs masked); an id is a short
// code or slug — no spaces, no free text, no phone-length digit runs.
const LONG_DIGITS = /\p{Nd}{7,}/gu;
export const ANALYTICS_PATH = z
  .string()
  .max(400)
  .regex(/^\//)
  .transform((p) =>
    redactPath(p.split(/[?#]/u, 1)[0] ?? '')
      .replace(LONG_DIGITS, '_')
      .slice(0, 200),
  );
const id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/)
  .refine((v) => !/\d{7,}/u.test(v), 'looks like a phone number');
const path = ANALYTICS_PATH;

export const CLIENT_EVENT_SCHEMAS = {
  page_view: z.object({ path, locale: z.enum(['en', 'hi']) }).strict(),
  click: z.object({ id, path }).strict(),
  // Server-side scrub too: never trust the client to have removed phone numbers or emails.
  search: z
    .object({
      query: z
        .string()
        .max(80)
        .transform((q) => scrubFreeText(q)),
      source: id,
    })
    .strict(),
  // `source` is optional so events from tabs opened before comparison existed still pass.
  add_to_cart: z
    .object({ slug: id, qty: z.number().int().min(1).max(99), source: z.enum(['compare']).optional() })
    .strict(),
  // Product comparison (design 2026-11-13): slugs, category and counts only.
  compare_added: z.object({ slug: id, category: id, count: z.number().int().min(1).max(4) }).strict(),
  compare_removed: z.object({ slug: id, count: z.number().int().min(0).max(4) }).strict(),
  compare_opened: z.object({ count: z.number().int().min(0).max(4), category: id.nullable() }).strict(),
  compare_differences_toggled: z.object({ on: z.boolean() }).strict(),
  remove_from_cart: z.object({ slug: id }).strict(),
  begin_checkout: z
    .object({ items: z.number().int().min(0).max(100), valuePaise: z.number().int().min(0) })
    .strict(),
  // The customer's action; the API records the outcome as the server event `purchase` (code review 2026-11-03).
  purchase_submitted: z
    .object({
      code: id,
      valuePaise: z.number().int().min(0),
      demo: z.boolean(),
      businessPurchase: z.boolean(),
    })
    .strict(),
  booking_started: z.object({ workshop: id }).strict(),
  booking_confirmed: z.object({ code: id, workshop: id, demo: z.boolean() }).strict(),
  booking_cancelled: z.object({ code: id, workshop: id, reasonCode: id }).strict(),
  // Workshop estimates (spec 06): the version and line counts only.
  estimate_viewed: z
    .object({ code: id, version: z.number().int().min(1).max(99), lines: z.number().int().min(1).max(20) })
    .strict(),
  job_card_approved: z
    .object({
      code: id,
      version: z.number().int().min(1).max(99),
      approved: z.number().int().min(0).max(20),
      declined: z.number().int().min(0).max(20),
    })
    .strict(),
  // The UI action; the API records the outcome as the server event `order_cancelled` (different name, so the
  // two are never counted together).
  order_cancel_submitted: z
    .object({ code: id, by: z.enum(['customer', 'staff']), reasonCode: z.enum(ORDER_CANCEL_REASONS) })
    .strict(),
  assistant_opened: z.object({ path }).strict(),
  assistant_message: z.object({ intent: id, length: z.number().int().min(0).max(5000) }).strict(),
  map_action: z
    .object({
      action: z.enum(['show_on_map', 'pin_select', 'locate', 'show_all', 'mode_change']),
      workshop: id.optional(),
      mode: z.enum(['map', 'satellite']).optional(),
    })
    .strict(),
  location_detected: z.object({ source: z.enum(['finder', 'map']), pincodeFound: z.boolean() }).strict(),
  admin_site_change: z
    .object({
      area: z.enum(['content', 'layout', 'categories', 'settings']),
      action: z.enum(['save', 'reset']),
      fields: z.number().int().min(0).max(1000),
    })
    .strict(),
  support_ticket: z
    .object({
      action: z.enum(['created', 'customer_reply', 'staff_reply', 'internal_note', 'status']),
      kind: id.optional(),
      channel: z.enum(['web', 'whatsapp']).optional(),
      to: id.optional(),
    })
    .strict(),
  admin_customer_block: z
    .object({
      action: z.enum(['blocked', 'lifted']),
      level: z.enum(['cod_only', 'orders', 'full']),
      reasonCode: id.optional(),
    })
    .strict(),
  admin_notifications_change: z
    .object({ target: id, action: z.enum(['saved', 'enabled', 'disabled', 'budget']) })
    .strict(),
  // Service-area PIN codes (spec 15): what was done and, when switched off, the reason code. Never the area text.
  admin_pincode_change: z
    .object({ action: z.enum(['added', 'edited', 'deactivated', 'activated']), reasonCode: id.optional() })
    .strict(),
} as const;

export type ClientEvents = {
  [K in keyof typeof CLIENT_EVENT_SCHEMAS]: z.infer<(typeof CLIENT_EVENT_SCHEMAS)[K]>;
};
export type ClientEventName = keyof ClientEvents;
