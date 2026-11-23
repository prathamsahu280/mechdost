import { z } from 'zod';
import { redactPath } from './analytics-path';
import { scrubFreeText } from './privacy';
import { COUPON_FUNDERS, COUPON_REASONS } from './coupon';
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
    /** MechDost Coins used (spec 20); 0 when none. Optional: events stored before 2026-11-14 have none. */
    coinsRedeemed?: number;
  };
  admin_order_routed: { orderCode: string; shopId: string; attempt: number };
  admin_order_rerouted: { orderCode: string; shopId: string; attempt: number };
  admin_order_rejected: { orderCode: string; reasonCode: string };
  seller_order_accepted: { orderCode: string; shopId: string; secondsToAccept: number };
  seller_order_declined: { orderCode: string; shopId: string; reasonCode: string };
  /** A shop gave up an order it had accepted (before packing); the order is back with admin (spec 04). */
  seller_order_given_up: {
    orderCode: string;
    shopId: string;
    reasonCode: string;
    minutesSinceAccept: number;
  };
  /** Staff warned a partner (spec 08); `counting` = warnings in the window after this one. */
  admin_partner_warning_issued: {
    partnerKind: 'shop' | 'workshop';
    partnerId: string;
    warningId: string;
    reasonCode: string;
    counting: number;
    suggestPause: boolean;
  };
  admin_partner_warning_withdrawn: { partnerKind: 'shop' | 'workshop'; partnerId: string; warningId: string };
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
  /** Staff roles changed from the console (design 2026-11-15): role key and whether a city limits it; ids only. */
  admin_staff_role_changed: {
    action: 'granted' | 'revoked';
    targetUserId: string;
    role: string;
    cityScoped: boolean;
  };
  /** A staff member opened a customer profile; `unmasked` = contact details shown (also written to the audit log). */
  admin_customer_viewed: { customerId: string; unmasked: boolean };
  /** A CSV export was prepared (design 2026-11-15): dataset, length of the range in days, rows and whether contact columns were masked. */
  admin_export_run: { dataset: string; rangeDays: number; rowCount: number; masked: boolean };
  /** The prepared file was streamed to the same staff member (rows actually written). */
  admin_export_downloaded: { dataset: string; rowCount: number };
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
  /** The catalogue-v2 import wrote products (CLI `pnpm db:import:catalogue`, design 2026-11-22); dry runs are not counted. */
  admin_catalogue_v2_imported: {
    productsCreated: number;
    productsUpdated: number;
    packsCreated: number;
    mrpFilled: number;
  };
  /** A brand or product range was switched off/on in Admin → Catalogue → Brands and ranges (hides its products). */
  admin_group_switched: {
    kind: 'brand' | 'range';
    slug: string;
    hidden: boolean;
    reasonCode: string | null;
    productsAffected: number;
  };
  /** One bulk action on the product list (publish, unpublish, set MRP): how many products or packs it changed. */
  admin_products_bulk: { action: 'publish' | 'unpublish' | 'set_mrp'; count: number };
  /** A trust line ("genuine parts") was published or taken down in Admin -> Content (placement = the line's slot). */
  trust_line_edited: { placement: string; locale: 'en' | 'hi'; action: 'published' | 'unpublished' };
  admin_content_published: { key: string; locale: 'en' | 'hi'; action: 'published' | 'unpublished' };
  /** An earlier policy text was put live again as a new version (design 2026-11-15 item 5). */
  admin_policy_restored: { key: string; locale: 'en' | 'hi'; fromVersion: number; version: number };
  /** The home layout was saved (live at once) or reset to the default (item 6). `hidden`/`tiles` are counts. */
  admin_layout_published: {
    scope: 'global' | 'city';
    action: 'saved' | 'reset';
    hidden: number;
    tiles: number;
    mapDefault: 'map' | 'satellite';
  };
  /** A city's setting was overridden or reset to the global value (item 7). */
  admin_setting_city_changed: { key: string; action: 'overridden' | 'reset' };
  /** Company details saved (item 8); `filled` = how many of the fields have text. */
  admin_company_saved: { filled: number; grievanceShown: boolean };
  inventory_updated: { shopId: string; sku: string; fields: string[]; by: 'shop' | 'staff' };
  /** Shop stock and price CSV (design 2026-11-15 item 4): a check (dry run) and the one all-or-nothing apply; counts only. */
  shop_csv_previewed: { shopId: string; rows: number; errors: number; changes: number };
  shop_csv_applied: { shopId: string; stock: number; active: number; priceRequests: number };
  /** A packing slip was opened for printing (item 5). */
  shop_packing_slip_viewed: { shopId: string; orderCode: string };
  /** The owner opened the performance page (item 6). */
  shop_performance_viewed: { shopId: string };
  /** The staff performance and earnings view was opened (design 2026-11-16); `scope` owner = whole team, self = own row. */
  shop_staff_performance_viewed: { shopId: string; scope: 'owner' | 'self'; days: 30 | 90 };
  /** Public application status lookup (item 7): `found` false when the phone did not match the reference. */
  partner_status_checked: { found: boolean };
  partner_application_submitted: {
    kind: string;
    source: 'public' | 'invite';
    gstStatus: string;
    products: number;
    locationSource: string;
  };
  partner_application_decided: { decision: 'approved' | 'rejected'; reasonCode: string | null };
  /** Business applications (audience entry design 2026-11-22): codes only, no names or contacts. */
  business_application_submitted: { kind: 'trade' | 'fleet'; signedIn: boolean };
  business_application_decided: {
    kind: 'trade' | 'fleet';
    decision: 'approved' | 'rejected' | 'closed';
    reasonCode: string | null;
  };
  trade_account_verified: { via: 'application' | 'restored' };
  trade_account_revoked: { reasonCode: string };
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
    /** Where the service happens (home servicing); optional: events stored before 2026-11-15 have none. */
    mode?: 'workshop' | 'home';
  };
  service_status_changed: {
    requestCode: string;
    workshopId: string | null;
    from: string;
    to: string;
    by: 'customer' | 'workshop' | 'admin' | 'system';
    reasonCode: string | null;
    mode?: 'workshop' | 'home';
  };
  /** Home servicing (spec 06): the mechanic arrived (`via` code or the audited admin override). */
  home_visit_arrived: { requestCode: string; workshopId: string; via: 'code' | 'override' };
  home_move_proposed: { requestCode: string; workshopId: string; reasonCode: string; transport: string };
  home_move_answered: { requestCode: string; workshopId: string; accepted: boolean };
  /** A workshop changed its home settings (portal or admin). */
  workshop_home_settings_saved: {
    workshopId: string;
    homeService: boolean;
    radiusKm: number;
    feePaise: number;
    homeServices: number;
    by: 'workshop' | 'admin';
  };
  /** Workshops tier 1 (spec 06, 07): hourly slots, self-edit, reschedule and the acceptance timeout. */
  workshop_slot_capacity_set: { workshopId: string; hour: number; capacity: number };
  workshop_profile_saved: { workshopId: string; fields: string[]; busy: boolean; by: 'workshop' };
  workshop_change_requested: { workshopId: string; kind: 'location' | 'gstin' };
  workshop_change_decided: { workshopId: string; kind: 'location' | 'gstin'; approved: boolean };
  service_slot_booked: { requestCode: string; workshopId: string; hour: number };
  service_rescheduled: {
    requestCode: string;
    workshopId: string;
    count: number;
    fromDate: string;
    toDate: string;
  };
  service_acceptance_expired: { requestCode: string; workshopId: string; waitedMinutes: number };
  home_visit_fee_waived: { requestCode: string; workshopId: string; reasonCode: string };
  /** Job photos (spec 06): a workshop added or removed a before/after photo. Ids and counts only, never paths. */
  service_photo_added: { requestCode: string; workshopId: string; stage: 'before' | 'after'; bytes: number };
  service_photo_removed: { requestCode: string; workshopId: string; stage: 'before' | 'after' };
  /** Support threads (design 2026-11-15): a customer opened or re-opened the one thread of an order or service job. */
  support_thread_opened: {
    ticketCode: string;
    subject: 'order' | 'service';
    issueCode: string;
    reopened: boolean;
    photos: number;
  };
  /** Photos on a support message: counts and bytes only, never a path or file name. */
  support_attachment_added: { count: number; bytes: number };
  /** A COD customer gave a payout destination (kind only, never the value). */
  support_refund_destination_saved: { ticketCode: string; kind: 'upi' | 'bank'; replaced: boolean };
  /** Staff created the manual refund request from the ticket. */
  support_refund_from_ticket: {
    ticketCode: string;
    orderCode: string;
    amountPaise: number;
    reasonCode: string;
  };
  /** Support inbox (design 2026-11-15 items 4 to 7): assignment, canned replies, closes, guests, deletion requests. Codes and counts only. */
  support_ticket_assigned: { assigned: boolean; self: boolean };
  support_canned_reply_saved: { created: boolean; active: boolean };
  support_ticket_closed: { reason: 'auto' | 'staff'; kind: string };
  support_guest_ticket_created: { kind: string };
  support_guest_reply: { ticketCode: string };
  support_deletion_requested: { ticketCode: string };
  support_deletion_confirmed: { ticketCode: string };
  service_estimate_sent: { requestCode: string; workshopId: string; revision: number; lines: number };
  service_estimate_decided: { requestCode: string; revision: number; approved: number; declined: number };
  service_billed: { requestCode: string; workshopId: string; totalPaise: number; lines: number };
  /** Online payment of a service bill (spec 03/06, 2026-11-15): codes, ids and paise only. */
  service_bill_pay_started: { requestCode: string; amountPaise: number };
  service_bill_paid: {
    requestCode: string;
    workshopId: string | null;
    amountPaise: number;
    via: 'online' | 'workshop';
    method: string;
  };
  service_bill_payment_failed: { requestCode: string; amountPaise: number; method: string };
  /** Money captured for a bill that was already settled or cancelled: a refund request was raised. */
  service_bill_late_capture: { requestCode: string; amountPaise: number; reason: 'settled' | 'cancelled' };
  /** Staff cancelled a request (permission `service:cancel`); `refundRequested` when a paid bill is refunded. */
  service_cancelled_by_staff: {
    requestCode: string;
    workshopId: string | null;
    fromStatus: string;
    reasonCode: string;
    refundRequested: boolean;
  };
  admin_workshop_saved: { workshopId: string; action: 'created' | 'updated'; published: boolean };
  /** Shop management (decision 2026-11-14 "Shop management"; specs 07/08). */
  admin_partner_standing_changed: {
    partnerKind: 'shop' | 'workshop';
    partnerId: string;
    from: string;
    to: string;
    reasonCode: string | null;
  };
  admin_shop_updated: { shopId: string; fields: string[] };
  admin_shop_coverage_changed: { shopId: string; added: number; changed: number; removed: number };
  admin_shop_member_added: { shopId: string; role: 'seller_owner' | 'seller_staff' };
  /** Working hours changed by the owner (`by: 'shop'`); staff edits are `admin_shop_updated` with `hours`. */
  shop_hours_changed: { shopId: string; days: number; by: 'shop' };
  /** Busy / closed-today toggle (spec 04/07, 2026-11-15): the mode and, for `hours`, how many; never free text. */
  shop_busy_set: { shopId: string; mode: 'closed_today' | 'hours' | 'clear'; hours: number | null };
  /** Shop team (spec 07/13, 2026-11-15): ids and counts only, never the invitee's phone or name. */
  shop_team_invited: { shopId: string };
  shop_team_invite_cancelled: { shopId: string };
  shop_team_invite_accepted: { shopId: string };
  shop_team_member_removed: { shopId: string };
  /** MechDost Coins (spec 20): counts and codes only; `customerId` is the pseudonymous account id. */
  coins_redeemed: { orderCode: string; coins: number; discountPaise: number };
  coins_restored: { orderCode: string; coins: number };
  coins_reward_created: { rewardId: string; source: string; coins: number; unlockDays: number };
  coins_earned: { rewardId: string; source: string; coins: number };
  coins_expired: { coins: number };
  /** Transactional email (spec 10): template key and language only, never an address or the text. */
  email_sent: { template: string; locale: 'en' | 'hi' };
  /** A send that ended failed (permanent error or retries used up); `code` is the provider error code. */
  email_failed: { template: string; code: string };
  /** Web push (spec 10): the notice kind sent, or the provider's error code; never a token or the text. */
  push_sent: { kind: string };
  push_failed: { code: string };
  /** The person turned promotions on or off (marketing consent, DPDP). */
  marketing_consent_changed: { granted: boolean; noticeVersion: string };
  coins_adjusted: { customerId: string; delta: number; reasonCode: string };
  /** Coupons (spec 03, 2026-11-15): ids, codes (enum) and paise only; the code a customer typed is never recorded. */
  coupon_redeemed: {
    couponId: string;
    orderCode: string;
    discountPaise: number;
    funder: 'mechdost' | 'shop';
    kind: 'percent' | 'flat' | 'free_shipping';
    /** A typed code, or an automatic offer applied without one (2026-11-16). */
    source: 'code' | 'automatic';
  };
  /** The use went back: every part cancelled or rejected, or every delivered part refunded in full (2026-11-16). */
  coupon_released: { couponId: string; orderCode: string; reason: 'order_closed' | 'order_refunded' };
  /** Admin opened a coupon's usage report (ids only). */
  admin_coupon_usage_viewed: { couponId: string };
  admin_coupon_saved: { couponId: string; action: 'created' | 'updated'; funder: 'mechdost' | 'shop' };
  admin_coupon_paused: { couponId: string; paused: boolean };
  /** Recommendations (spec 11, 2026-11-15): rule ids and enums only. */
  admin_reco_rule_saved: { ruleId: string; action: 'created' | 'updated' | 'deleted'; active: boolean };
  /** The nightly co-purchase job finished (a count, never who bought). */
  copurchase_computed: { pairs: number };
  /** Privacy (DPDP, 2026-11-15): a consent switched in Account -> Privacy (marketing has its own event above). */
  consent_changed: { purpose: 'marketing' | 'analytics'; granted: boolean; noticeVersion: string };
  data_export_requested: { exportId: string };
  data_export_ready: { exportId: string; bytes: number };
  data_export_failed: { exportId: string; errorCode: string };
  data_export_downloaded: { exportId: string };
  /** "Notify me" for a PIN not served yet (spec 15): the PIN is a place, not a person; the city when known. */
  waitlist_joined: { pincode: string };
  waitlist_left: { pincode: string };
  waitlist_notified: { pincode: string };
  shop_coupon_decided: { couponId: string; shopId: string; decision: 'accepted' | 'declined' };
  /** Bulk quotes (spec 19): codes, counts, versions and paise only — never message text. */
  quote_requested: { quoteCode: string; lines: number; units: number; listTotalPaise: number | null };
  quote_message_sent: { quoteCode: string; by: 'customer' | 'staff' };
  quote_attachment_added: { quoteCode: string; by: 'customer' | 'staff'; count: number; bytes: number };
  quote_offer_sent: {
    quoteCode: string;
    offerVersion: number;
    totalPaise: number;
    listTotalPaise: number | null;
    validDays: number;
  };
  quote_accepted: {
    quoteCode: string;
    offerVersion: number;
    orderCode: string;
    totalPaise: number;
    paymentMethod?: 'cod' | 'online';
  };
  /** Declined by the customer or withdrawn by staff (expiry is `quote_expired`). */
  quote_closed: {
    quoteCode: string;
    to: 'declined' | 'withdrawn';
    by: 'customer' | 'staff';
    reasonCode: string;
  };
  quote_expired: { quoteCode: string; reasonCode: string; offerVersion: number };
  /** The active offer ran out; the quote went back to negotiating. */
  quote_offer_expired: { quoteCode: string; offerVersion: number };
  /** Refund requests (spec 05, 2026-11-15): ids, codes and paise only — never notes. `by` is who asked. */
  refund_requested: {
    refundId: string;
    orderCode: string | null;
    amountPaise: number;
    source: string;
    reasonCode: string;
    by: 'system' | 'staff';
  };
  refund_approved: { refundId: string; amountPaise: number; hoursWaiting: number };
  refund_rejected: { refundId: string; amountPaise: number; reasonCode: string };
  /** The Razorpay refund exists (the money is on its way). */
  refund_initiated: { refundId: string; amountPaise: number };
  refund_processed: { refundId: string; amountPaise: number; daysFromRequest: number };
  refund_failed: { refundId: string; amountPaise: number; failureCode: string };
  /** We cannot tell whether Razorpay holds this refund: the amount stays reserved until it is settled. */
  refund_needs_reconciliation: { refundId: string; amountPaise: number; code: string };
  /** Finance settled an unsure refund by hand (outcome and reason are codes, never free text). */
  refund_reconciled: {
    refundId: string;
    amountPaise: number;
    outcome: 'refunded_full' | 'refunded_other_amount' | 'not_refunded';
    reasonCode: string;
  };
  /** A refund request was raised for money captured after the order's payment window closed. */
  refund_requested_after_close: { refundId: string; paymentId: string; amountPaise: number };
  /** A credit note was issued for a processed refund of an invoiced order. */
  credit_note_issued: { refundId: string; creditNoteNumber: string; totalPaise: number };
  /** Customer account (design 2026-11-15): codes and flags only; no name, phone, address text or registration. */
  address_saved: { addressId: string; label: string; isDefault: boolean; action: 'created' | 'updated' };
  address_deleted: { addressId: string };
  vehicle_saved: { vehicleId: string; type: string; fuel: string; action: 'created' | 'updated' };
  vehicle_deleted: { vehicleId: string };
  profile_updated: { fields: string[] };
  /** Product photos (spec 02): ids, codes and counts only. */
  product_photo_added: {
    productId: string;
    photoId: string;
    by: 'staff' | 'shop';
    status: 'pending' | 'approved';
  };
  product_photo_removed: { productId: string; photoId: string };
  product_photo_reviewed: {
    productId: string;
    photoId: string;
    decision: 'approved' | 'rejected';
    reasonCode: string | null;
  };
  product_photos_reordered: { productId: string; count: number };
  /** Server cart (spec 03): merge at sign-in and replace; counts only, never prices. */
  cart_merged: { kept: number; added: number; dropped: number };
  cart_replaced: { lines: number; dropped: number };
  /** Order again (audience entry 2026-11-22): the order's id and how many lines were added or could not be. */
  order_again: { orderId: string; added: number; missing: number };
  /** Wishlist (spec 02): the product id and the new list size. */
  wishlist_changed: { productId: string; on: boolean; count: number };
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

const EMAIL_ACTION_MODES = ['verifyEmail', 'resetPassword', 'recoverEmail', 'verifyAndChangeEmail'] as const;

export const CLIENT_EVENT_SCHEMAS = {
  page_view: z.object({ path, locale: z.enum(['en', 'hi']) }).strict(),
  click: z.object({ id, path }).strict(),
  // A phone-code send or check failed (2026-11-16): the Firebase error code only, never the phone number.
  auth_code_failed: z
    .object({
      stage: z.enum(['send', 'confirm']),
      code: z.string().regex(/^(auth\/[a-z0-9-]{1,60}|unknown)$/),
      path,
    })
    .strict(),
  // The email link page (/auth/action, 2026-11-23): which kind of link, never the code, email or any free text.
  auth_email_action_opened: z.object({ mode: z.enum(EMAIL_ACTION_MODES) }).strict(),
  auth_email_verified: z.object({ mode: z.enum(['verifyEmail', 'verifyAndChangeEmail']) }).strict(),
  auth_password_reset_done: z.object({}).strict(),
  auth_email_action_failed: z
    .object({
      mode: z.enum(EMAIL_ACTION_MODES),
      code: z.string().regex(/^(auth\/[a-z0-9-]{1,60}|missing|unknown)$/),
    })
    .strict(),
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
  // Smart search (design 2026-11-22): what the suggestion list led to, and searches that found nothing.
  // Codes and counts only; the query text goes through the same scrub as `search`.
  search_suggestion_selected: z
    .object({
      kind: z.enum(['brand', 'range', 'category', 'product']),
      position: z.number().int().min(1).max(8),
    })
    .strict(),
  search_zero_results: z
    .object({
      query: z
        .string()
        .max(80)
        .transform((q) => scrubFreeText(q)),
      source: id,
      had_suggestion: z.boolean(),
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
  // The tray's question when a product of another category is picked (redesign 2026-11-14): codes and a count.
  compare_switch_prompted: z.object({ from: id, to: id, count: z.number().int().min(1).max(4) }).strict(),
  compare_switch_answered: z.object({ choice: z.enum(['start_new', 'keep']), to: id }).strict(),
  // The tray told the shopper the list is full or the browser refused to save it.
  compare_limit_shown: z.object({ reason: z.enum(['full', 'save_failed']) }).strict(),
  remove_from_cart: z.object({ slug: id }).strict(),
  // Wishlist (design 2026-11-15): the heart on a card, the product page or the account list; slug and direction only.
  wishlist_toggled: z
    .object({ slug: id, on: z.boolean(), source: z.enum(['card', 'page', 'account']) })
    .strict(),
  // The wishlist heart was pressed while signed out and sent the shopper to sign in.
  wishlist_sign_in_prompted: z.object({ slug: id }).strict(),
  // Checkout coupon (spec 03, 2026-11-15): the check result and, when refused, the reason code; never the typed code.
  // The public offers page (2026-11-16): how many offers were listed, and which kind of offer's code was copied.
  offers_viewed: z.object({ count: z.number().int().min(0).max(200) }).strict(),
  offer_code_copied: z.object({ kind: z.enum(['percent', 'flat', 'free_shipping']) }).strict(),
  apply_coupon: z
    .object({
      result: z.enum(['applicable', 'refused', 'applied', 'removed', 'automatic']),
      reason: z.enum(COUPON_REASONS).nullable(),
      funder: z.enum(COUPON_FUNDERS).nullable(),
    })
    .strict(),
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
  // Home servicing (spec 06): the customer chose where the service happens.
  // Job photos (spec 06): the customer opened the photo viewer on their request, or a visitor on a workshop page.
  service_photos_viewed: z
    .object({ surface: z.enum(['request', 'workshop']), count: z.number().int().min(0).max(24) })
    .strict(),
  service_mode_selected: z.object({ mode: z.enum(['workshop', 'home']) }).strict(),
  booking_confirmed: z.object({ code: id, workshop: id, demo: z.boolean() }).strict(),
  booking_cancelled: z.object({ code: id, workshop: id, reasonCode: id }).strict(),
  // Workshops tier 1 (spec 06): the customer asked to move a booking; the workshop opened "My workshop" or saved it.
  booking_rescheduled: z.object({ code: id, workshop: id, slot: id }).strict(),
  workshop_profile_viewed: z.object({}).strict(),
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
  // "Order again" pressed on the account orders list or the order page (2026-11-22); the server records the outcome
  // as `order_again` (ids and counts), so this one is the UI action only.
  order_again_clicked: z.object({ code: id, source: z.enum(['list', 'page']) }).strict(),
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
      area: z.enum(['content', 'layout', 'categories', 'settings', 'policies', 'company', 'search_synonyms']),
      action: z.enum(['save', 'reset', 'publish', 'restore', 'preview']),
      fields: z.number().int().min(0).max(1000),
    })
    .strict(),
  support_ticket: z
    .object({
      action: z.enum([
        'created',
        'customer_reply',
        'staff_reply',
        'internal_note',
        'status',
        'thread_opened',
        'thread_reopened',
        'photos_attached',
        'destination_saved',
        'refund_requested',
        'assigned',
        'canned_inserted',
        'guest_created',
        'guest_looked_up',
        'guest_reply',
        'deletion_requested',
        'deletion_confirmed',
      ]),
      kind: id.optional(),
      /** Quick issue code of a thread (a code, never text). */
      issue: id.optional(),
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
    .object({ target: id, action: z.enum(['saved', 'enabled', 'disabled', 'budget', 'reset', 'test_sent']) })
    .strict(),
  // The bell and web push (design 2026-11-15, spec 10/12): kinds and codes only, never a token or the message text.
  bell_opened: z.object({ unread: z.number().int().min(0).max(100) }).strict(),
  notification_opened: z
    .object({ kind: id.nullable(), channel: z.enum(['bell', 'centre', 'push']) })
    .strict(),
  push_prompt_shown: z.object({ variant: z.enum(['normal', 'ios', 'denied']) }).strict(),
  push_prompt_answered: z.object({ answer: z.enum(['turn_on', 'not_now', 'ios_done']) }).strict(),
  push_enabled: z.object({ source: z.enum(['card', 'settings']) }).strict(),
  push_disabled: z.object({ source: z.enum(['settings', 'sign_out']) }).strict(),
  // Service-area PIN codes (spec 15): what was done and, when switched off, the reason code. Never the area text.
  admin_pincode_change: z
    .object({ action: z.enum(['added', 'edited', 'deactivated', 'activated']), reasonCode: id.optional() })
    .strict(),
  // Admin people screens (design 2026-11-15): kinds, counts and codes only, never the query text.
  admin_customer_search: z
    .object({ kind: z.enum(['code', 'email', 'phone', 'name']), results: z.number().int().min(0).max(20) })
    .strict(),
  admin_staff_screen: z
    .object({ action: z.enum(['grant_opened', 'grant_saved', 'revoke_confirmed']) })
    .strict(),
  admin_audit_search: z
    .object({ filters: z.number().int().min(0).max(8), results: z.number().int().min(0).max(100) })
    .strict(),
  // Workshop analytics (design 2026-11-15): the owner opened Performance for a range; admin switched the tab.
  workshop_analytics_viewed: z.object({ rangeDays: z.number().int().min(1).max(180) }).strict(),
  admin_analytics_tab: z.object({ tab: z.enum(['overview', 'workshops']) }).strict(),
  // CSV exports (design 2026-11-15): which dataset and what happened; never the range text or any row content.
  admin_export_action: z
    .object({
      dataset: z.enum([
        'orders',
        'sub_orders',
        'refunds',
        'service_requests',
        'partners',
        'customers',
        'coupon_usage',
      ]),
      action: z.enum(['requested', 'downloaded', 'refused']),
    })
    .strict(),
} as const;

export type ClientEvents = {
  [K in keyof typeof CLIENT_EVENT_SCHEMAS]: z.infer<(typeof CLIENT_EVENT_SCHEMAS)[K]>;
};
export type ClientEventName = keyof ClientEvents;
