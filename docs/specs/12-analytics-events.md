# 12 · Analytics & event tracking (first-party)

Status: decided · Phase 1 · Decisions: Analytics

## Goal

Own every user action as raw data for later processing, plus self-hosted PostHog for funnels, session replay and feature flags.

## Architecture

- Client SDK (`packages/analytics`): `track(event, props)` batches to `POST /events` (beacon on unload); server-side events emitted from the API for money/state changes (purchase, refund, routing) so they are never lost to ad blockers.
- Storage: Postgres `events` table partitioned by month (id uuid v7, occurred_at, received_at, user_id nullable, anonymous_id, session_id, device jsonb, city_id, vehicle_id, page, event, props jsonb, consent_version) with BRIN on occurred_at and GIN on props; retention policy (raw 18 months, aggregates forever); nightly rollups into `metrics_daily`; export job to ClickHouse/BigQuery when > ~50M rows/month.
- ~~PostHog self-hosted … via the PostHog SDK~~ → **PostHog EU cloud, forwarded server-side by the worker** (decision 2026-11-14; section below). No posthog-js in the browser, no session replay, no PostHog feature flags for now.
- Consent-gated: analytics category consent; essential events (errors, security) always.

## Event catalogue (initial, all with common context)

page_view, section_view, click (element id), search, filter_applied, select_vehicle, view_item_list, select_item, view_item, add_to_wishlist, add_to_cart, remove_from_cart, view_cart, begin_checkout, add_shipping_info, add_payment_info, apply_coupon, purchase (server), refund (server), booking_started, slot_selected, booking_confirmed, booking_rescheduled, booking_cancelled, estimate_viewed, job_card_approved, review_submitted, sign_up, login, otp_failed, address_added, vehicle_added, notify_me_clicked, support_ticket_created, reco_impression/click/add, seller_order_accepted/declined, admin_order_routed/rerouted/rejected, partner_action, error_shown, web_vitals (LCP/INP/CLS samples).

## Implemented on the web (2026-11-01)

Typed client catalogue `apps/web/src/lib/analytics.ts`: `page_view`, `click` (`data-track` ids via one delegated listener), `search`, `add_to_cart`, `remove_from_cart`, `begin_checkout`, `purchase_submitted` (the server records the outcome as `purchase`) (demo flag), `booking_started`, `booking_confirmed` (demo flag), `assistant_opened`, `assistant_message` (intent + length only), `admin_site_change` (area, save/reset, number of fields — never the text itself). Events queue in memory and dispatch a `mechdost:track` DOM event; the `POST /v1/events` transport + consent gate + PostHog ship with Phase 1.

## Built: server events in the event store (2026-11-03)

- Table `events` (created in migration 0002, completed in 0030): partitioned by month on `occurred_at` (DB-clock default), `source` server | web | app, props an object ≤ 8 KB with a GIN index, **append-only** (trigger), RLS on the parent and every partition. `ensure_event_partitions(n)` creates this month + n ahead (RLS on, Data API roles revoked); the worker runs it at start and every 12 h (dev has Nov 2026 – Feb 2027 + default).
- `recordServerEvent(tx, event, {userId, cityId, props})` (`packages/db/src/repo/events.ts`) writes in the caller's transaction: a rolled-back change records nothing, a replayed order records nothing new. Typed catalogue `ServerEventProps` (`packages/shared/src/analytics.ts`): ids, codes, enums and paise only.
- Emitted now: `purchase` (order code, sub-orders, items, total, method), `admin_order_routed` / `admin_order_rerouted` (shop, attempt), `admin_order_rejected` (reason code), `seller_order_accepted` (seconds to accept), `seller_order_declined` (reason code), `order_cancelled` (by customer/staff, reason, from status), with the client action `order_cancel_submitted` (code, by, reason code from `ORDER_CANCEL_REASONS`; demo screens emit it now) kept under a different name so UI attempts and server outcomes are never summed, `order_fulfilment_step` (packed / shipped / out for delivery, with shop and city), `order_delivered` (shop, city), `admin_customer_blocked` / `admin_customer_unblocked` (customer id, level, reason), `admin_product_status_changed` (from → to), `admin_product_created` (slug, SKU, status, source form/import) and `admin_catalogue_imported` (rows, created, skipped, status; 2026-11-14), `inventory_updated` (fields changed, by shop/staff); MechDost Coins (spec 20, 2026-11-14): `coins_redeemed` (order code, coins, discount paise; `purchase` also carries `coinsRedeemed`), `coins_restored` (order code, coins), `coins_reward_created` (reward id, source, coins, unlock days), `coins_earned` (reward id, source, coins), `coins_expired` (coins), `coins_adjusted` (customer id, delta, reason code), with the client clicks `checkout_coins_on` / `checkout_coins_off` and `admin_coins_granted` / `admin_coins_removed`.
- Reviews (2026-11-14): `review_submitted` (review id, target type and id, rating, has text; never the text) and `admin_review_moderated` (review id, target type, from, to, reason code), in the same transaction as the change (spec 02 § Reviews).
- **`POST /v1/events`** (built 2026-11-03, `apps/api/src/routes/events.ts`): anonymous, batches of ≤ 25, limited per IP twice: 60 requests per minute and 600 events per minute weighted by batch size (a one-event ping costs 1, a full batch 25; storage-abuse cap from the advisor review, weighted since 2026-11-03; batches without consent cost only a request) `{event, occurredAt, page?, props}` with `source` web|app, `anonymousId` (uuid), `sessionId`, `consent {analytics, version}`. The **registry** is `CLIENT_EVENT_SCHEMAS` in `packages/shared/src/analytics.ts` (Zod, strict): unknown events, invalid props and extra fields (e.g. a phone number) are dropped and counted (`{stored, rejected}`); without analytics consent nothing is stored (DPDP); `occurredAt` outside the last 24 h (or > 5 min ahead) becomes the receive time. The web's `ClientEvents` type now comes from that registry (`import type`: no validator in the browser bundle).
- **No personal data through paths or ids (code review 2026-11-03):** the registry's `path` (also the batch's `page`) keeps only the pathname — query string and fragment are dropped and 7+ digit runs masked — and every `id`-typed prop is a short code (`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$`, no 7+ digit run). Free text is never allowed outside the scrubbed search query. Tests: `packages/shared/test/analytics.test.ts`, `apps/api/test/events.test.ts`.
- **Consent banner + web transport (built 2026-11-03):** `apps/web/src/components/site/consent-banner.tsx` + `src/lib/consent.ts` (DPDP; decision "declines non-essential by default"): a fresh visitor sees "Your privacy choice" with two equal buttons, **Allow analytics** / **Essential only** (same style and size, none pre-selected, no shaming copy — Dark Patterns Guidelines 2023); not a modal; nothing optional runs before a choice (no visitor id, no event request). Choice stored on the device (`mechdost-consent`, notice version `2026-11`; a new version asks again); "Privacy choices" in the footer reopens it (Escape closes a reopened one); the floating assistant button steps aside while it is open. `src/lib/event-transport.ts` sends batches (≤ 20, every 5 s, flushed on page hide; `fetch` keepalive) to `POST /v1/events` only with consent **and** `NEXT_PUBLIC_API_URL` set (the local demo sends nothing); withdrawing consent clears the outbox and deletes the visitor id. Tests: `e2e/consent.spec.ts` (desktop + mobile, axe on the banner, Hindi copy); other suites start with a decided choice (`e2e/fixtures/consent-decided.json`).
- **Security review fixes (2026-11-03):** the search query is NFKC-normalised and scrubbed of invisible format characters (zero-width space/joiners), emails and runs of 7+ digits in **any script** (Devanagari ९८७…, full-width, ASCII) separated only by non-letters of any length (spaces, dashes, dots, commas, underscores, brackets, slashes …; a letter ends the run; linear-time regex, input capped at 500 characters) — phone, account or card numbers → `#`; short part numbers and tyre sizes kept by `scrubFreeText` (`packages/shared/src/privacy.ts`, dependency-free) in the browser **and again** in the server registry; the visitor id is deleted on every page load and on any change to the consent record in another tab whenever analytics is not currently allowed (covers withdrawal elsewhere and new notice versions). Page paths keep public codes (pseudonymous ids, like `user_id`).
- Not yet: `user_id` on signed-in events (identify/merge with web sign-in); `metrics_daily` rollups. (PostHog forwarding: built 2026-11-14, below.)

## Admin use

Dashboard charts read `metrics_daily`; ad-hoc questions via PostHog HogQL; export CSV of events by date range (async job).

**Built 2026-11-14 (spec 08 "Analytics"):** Admin → Analytics reads the event store **live** (no `metrics_daily` yet),
bounded by an IST date range of at most 180 days on `occurred_at` (partition key, `events (event, occurred_at)` index):
visitors = distinct `anonymous_id` of `page_view`, visits = distinct `session_id`, product views = `page_view` on
`/shop/<slug>`, searches, distinct visitors with `add_to_cart` / `begin_checkout`; top searches grouped by the
normalised scrubbed phrase and shown only when ≥ 3 distinct visitors typed it. Only `source` web/app events count.
Because client events carry **no `city_id`**, this traffic is site-wide and shown only to staff with an all-cities
analytics grant. Click ids added: `admin_analytics_preset_{7|30|90}`, `admin_analytics_apply`, `admin_analytics_retry`.
Next: `city_id` on web events (from the chosen city/PIN), then per-city traffic; rollups when volume needs them.

## Rules

No PII in `props` beyond ids; phone/email never stored in events; IP truncated; `anonymous_id` merged to `user_id` on login (identify event); events validated by Zod schema registry in `packages/shared/analytics`.

## Acceptance tests

Schema validation rejects unknown events; purchase server event exactly once per order; partition routing; consent off → only essential events stored.

## P1/P2

ClickHouse export, experiments (PostHog), attribution/UTM reports, data warehouse for recommendations.

## ML/AI-ready data (hard rule 16, 2026-11-01)

Every event follows `docs/conventions/data-for-ml.md`: `noun_verb` names, typed versioned properties, enum codes instead of free text, internal ids only (no PII), source/city/locale/actor role recorded, consent per purpose before personal data is used for offers or model training.

## Bulk quote events (spec 19, 2026-11-14)

- **Server events** (`packages/shared/src/analytics.ts`, written in the transaction of the change): `quote_requested` (quoteCode, lines, units, listTotalPaise), `quote_message_sent` (quoteCode, by customer|staff — never the text), `quote_offer_sent` (quoteCode, offerVersion, totalPaise, listTotalPaise, validDays), `quote_accepted` (quoteCode, offerVersion, orderCode, totalPaise), `quote_closed` (quoteCode, to declined|withdrawn, by, reasonCode), `quote_expired` (quoteCode, reasonCode inactive, offerVersion), `quote_offer_expired` (quoteCode, offerVersion: the offer ran out, the quote reopened). The accepted order also records `purchase`.
- **Click ids (web, real mode):** `quote_requested`, `quote_request_failed_<key>`, `quote_message_sent`, `quote_accepted`, `quote_accept_failed_<key>`, `quote_declined_<reason>`, `admin_quote_reply`, `admin_quote_offer_sent`, `admin_quote_offer_invalid`, `admin_quote_withdrawn_<reason>`.

## Service-area PIN codes (2026-11-14)

Client event `admin_pincode_change {action: added|edited|deactivated|activated, reasonCode?}` — never the PIN's area
text. The change itself is in `audit_log` (`pincode.*`, before/after) in the same transaction (spec 15 "PIN codes").

## Seller onboarding events (2026-11-13)

- **Server events** (`packages/shared/src/analytics.ts`): `partner_application_submitted` (kind, source public or invite, gstStatus, product count, locationSource), `partner_application_decided` (decision, reasonCode), `partner_invite_sent`, `partner_invite_opened` (city only), `price_request_submitted` (shopId, sku), `price_request_decided` (shopId, sku, decision, reasonCode), `agreement_accepted` (shopId, version), `shop_went_live` (shopId). No GSTIN, names, phones or emails in props.
- **`purchase_submitted`** gains `businessPurchase: boolean` (buyer GSTIN, 2026-11-13); never the GSTIN or business name.
- **Click ids (web):** `partner_application_seller`, `partner_application_seller_invite`, `partner_products_opened`, `partner_location_gps`, `partner_location_search`, `partner_location_pin`, `admin_invite_created`, `admin_invite_revoked`, `admin_price_approved`, `admin_price_rejected`, `admin_agreement_published`, `admin_application_approved`, `admin_application_rejected`, `shop_price_requested`, `shop_agreement_accepted`.
- **No secrets in paths:** the invite link carries a bearer token, so `redactPath` (`@mechdost/shared/analytics-path`) turns `/partners/invite/<token>` into `/partners/invite/:token` in `track()`, the on-device demo log, the transport's `page` field and the API's `ANALYTICS_PATH`. Any new route with a secret in its path is added there (security review 2026-11-13).

## Shop management events (2026-11-14)

- **Server events** (`packages/shared/src/analytics.ts`):
  - `admin_shop_updated`: shopId and the field names changed (never their values);
  - `admin_shop_coverage_changed`: shopId and the counts added, changed and removed;
  - `admin_partner_standing_changed`: partnerKind, partnerId, from, to and reasonCode;
  - `admin_shop_member_added`: shopId and role (no phone);
  - `shop_hours_changed`: shopId, the number of open days, by `shop`.
- **Click ids (web):**
  - admin: `admin_shop_saved`, `admin_shop_coverage_saved`, `admin_shop_offer_added`, `admin_shop_offer_saved`,
    `admin_shop_paused`, `admin_shop_suspended`, `admin_shop_approved`, `admin_shop_member_added`;
  - shop: `shop_hours_saved`, `shop_new_product_requested`.

## Give-up and warning events (2026-11-15)

- **Server events (same transaction):** `seller_order_given_up` (orderCode, shopId, reasonCode, minutesSinceAccept),
  `admin_partner_warning_issued` (partnerKind, partnerId, warningId, reasonCode, counting, suggestPause),
  `admin_partner_warning_withdrawn` (partnerKind, partnerId, warningId). Codes, ids and counts only; notes never leave the
  database.
- **Click ids:** `shop_order_give_up_open` (the "can't fulfil" button opens its form), `shop_order_given_up`, `admin_partner_warning_issued`, `admin_partner_warning_withdrawn`.

## Product comparison events (2026-11-13)

- **Client events:** `compare_added` (slug, category, count 1–4), `compare_removed` (slug, count), `compare_opened` (count, category), `compare_differences_toggled` (on). `add_to_cart` gains an optional `source: 'compare'` (optional so events from older open tabs still pass).
- **Click ids:** `compare_tray_open`, `compare_tray_clear`. Spec 21.
- **Tray question (redesign 2026-11-14):** `compare_switch_prompted` (from, to: category slugs; count 1–4 being replaced), `compare_switch_answered` (choice `start_new` | `keep`, to), `compare_limit_shown` (reason `full` | `save_failed`). Codes and counts only; "Start new" also sends `compare_added` (count 1).

## PostHog EU forwarding (built 2026-11-14, decision "Monitoring")

- **Path:** web → `POST /v1/events` (consent-gated, stored) → `events` table → **worker** (`apps/api/src/analytics/posthog.ts`, started in `worker.ts`) → `POST {POSTHOG_HOST}/batch/` (default `https://eu.i.posthog.com`, project key `POSTHOG_KEY`). Plain `fetch`, no SDK. Off when the key is unset.
- **Reader** (index `events_received_idx` on `(received_at, id)`, migration 0053): `readForwardableEvents` (`packages/db/src/repo/events.ts`): server events and web/app events that have a consent record, ordered by `(received_at, id)` after an exact text cursor (microseconds kept), rows older than 60 s only (a slow transaction's rows land first), `occurred_at` bounded for partition pruning. Every 10 s, up to 500 rows per page, 20 pages per tick; the cursor lives in memory and starts 10 minutes back after a restart (PostHog drops repeats by `uuid` = our event id). One worker instance.
- **Sender:** batches of 100; up to 3 attempts (network, 429, 5xx; 1 s and 4 s back-off, 10 s timeout); 4xx not retried; a failed batch is **dropped** with `posthog_batch_dropped` and counted (`posthog_forwarded {forwarded, skipped, dropped}`); the cursor moves on either way. It never throws; a row that cannot be converted is skipped (`posthog_row_skipped`), a throwing sender counts as dropped, and anything else in a tick is logged (`posthog_tick_failed`) instead of ending the worker.
- **Consent gate (twice):** the reader skips web rows without consent; `toPosthogEvent` forwards a web/app event only with a visitor id and `consentAllowsForwarding(consent_version)` — notice `2026-11-14` or later (`CONSENT_NOTICE_VERSION` in `@mechdost/shared/privacy`, also the web's `CONSENT_VERSION`; the banner asks again after the notice change).
- **Payload:** `distinct_id` = visitor id (web) or `mechdost-server` (server events: no user id ever, consent unknown on the server); `uuid` = event id; `timestamp` = `occurred_at`; properties = scrubbed props + `$process_person_profile: false`, `$geoip_disable: true`, `$lib: mechdost-forwarder`, `source`, `city_id`, `session_id` (web), `consent_version` (web), `$pathname`/`$current_url` (from the stored path). `page_view` is sent as `$pageview` (with `mechdost_event: page_view`).
- **`scrubProps(props, source)`:** for **server** events only, under id keys (`id`, `ids`, `code`, `codes`, names ending in Id/Ids/Code/Codes), keeps a string that is exactly an id we issue (`isPseudonymousId`: lowercase UUID with version/variant and a hex letter; MD/SR/REQ/QT/PA code, year 20xx, tail with a letter), since UUID v7 digit runs looked like phone numbers. **Web/app props get no id exemption** (a browser could shape a phone number like a UUID): ids with a 7+ digit run are dropped (reviews 2026-11-14). Everywhere else id-shaped text is masked like free text. It drops keys ending in phone, mobile, email, name, address, street, landmark, line1/2, pincode, gstin, note, message, text, comment, password, token, otp, secret, userId, customerId, starting with user/customer/lat/lng/lon/ip; drops string values with an email or a 7+ digit run (any script) or longer than 200; nesting ≤ 3, arrays ≤ 50; `query` becomes `query_length`.
- **Tests:** `apps/api/test/monitoring.test.ts` (payload, consent gate, scrubbing, sender retries/4xx, forwarder batching/drop/read failure), `packages/db/test/events.test.ts` (reader consent filter, lag, exact cursor).
- **Not yet:** identify (web visitor ↔ signed-in user, needs consent sync to the server), person profiles, PostHog feature flags/experiments.
- **Refund events (2026-11-15, spec 05):** server events `refund_requested` (refundId, orderCode, amountPaise, source, reasonCode, by system|staff), `refund_approved` (refundId, amountPaise, hoursWaiting), `refund_rejected` (refundId, amountPaise, reasonCode), `refund_initiated`, `refund_processed` (refundId, amountPaise, daysFromRequest), `refund_failed` (refundId, amountPaise, failureCode), `refund_needs_reconciliation` (refundId, amountPaise, code) — ids, codes and paise only, never notes or payout details. Click ids on the website: `admin_refund_view_<view>`, `admin_refund_approve`, `admin_refund_reject`, `admin_refund_mark_paid`, `admin_refund_show_destination`, `order_refund_contact_support`.

- **Customer account (2026-11-15):** server events `address_saved` (addressId, label, isDefault, action created|updated), `address_deleted` (addressId), `vehicle_saved` (vehicleId, type, fuel, action created|updated), `vehicle_deleted` (vehicleId) and `profile_updated` (field names only), written in the transaction of the change (spec 01). No name, phone, address text or registration number. The old client names `address_added` / `vehicle_added` in the catalogue are superseded by these server events.
- **Transactional email events (2026-11-15, spec 10):** server `email_sent {template, locale}` and `email_failed {template, code}`, written by the worker's dispatcher after the outbox row is recorded (failed = permanent error or retries used up; `code` is the provider code such as `resend_422`). Template key and language only: never an address, name or text. The client event `admin_notifications_change` gains actions `reset` and `test_sent` (Admin → Emails).
- **Bell and web push events (2026-11-15, spec 10):** client `bell_opened {unread}` (0–100), `notification_opened {kind, channel: bell|centre|push}`, `push_prompt_shown {variant: normal|ios|denied}`, `push_prompt_answered {answer: turn_on|not_now|ios_done}`, `push_enabled {source: card|settings}`, `push_disabled {source: settings|sign_out}`; server `push_sent {kind}` and `push_failed {code}` (written by the dispatcher after the outbox row is recorded; `code` is Firebase's error code or `no_device`/`token_gone`) and `marketing_consent_changed {granted, noticeVersion}` (the promotions switch; the append-only `consents` row carries the same). `admin_notifications_change` is also sent by the Messages editor (target = the message kind, actions `saved`/`reset`). Never a token, a message text or a notification body; `push_prompt_shown` denied variant is reserved for the settings card.

- **Trust wording (2026-11-15):** server event `trust_line_edited {placement, locale, action}` (placement = the line's
  slot, e.g. `checkout`; action `published` or `unpublished`), written in the same transaction as the content publish or
  unpublish, next to `admin_content_published`. Click `labour_redo_claim_open` (data-track on the bill's "Ask for a free
  redo" link) and `admin_agreement_clause_added` (click). `support_ticket {action:'created', kind:'labour_redo'}` carries
  the new kind. No event on the trust lines themselves (copy only). Quote close: `quote_declined_other` now also covers
  "no reason given" (dark-pattern audit F2).

## Home servicing events (2026-11-15)

Server events (same transaction as the change; codes, ids and enums only): `service_requested.mode` and `service_status_changed.mode` (`workshop|home`, optional on events stored before this), `home_visit_arrived { requestCode, workshopId, via: code|override }`, `home_move_proposed { requestCode, workshopId, reasonCode, transport }`, `home_move_answered { requestCode, workshopId, accepted }`, `home_visit_fee_waived { requestCode, workshopId, reasonCode }`, `workshop_home_settings_saved { workshopId, homeService, radiusKm, feePaise, homeServices, by }`. Client event: `service_mode_selected { mode }` (finder and booking form). Click ids via `track('click')`: `workshop_home_arrived`, `workshop_home_move_offered`, `workshop_home_fee_waived`, `workshop_home_settings_saved`; `data-track`: `address_pin_use_location`, `address_pin_remove`, `workshop_home_move_open`, `workshop_home_waive_open`.

## Admin people screens (2026-11-15)

Server events (in the change's transaction): `admin_staff_role_changed` (action granted/revoked, target user id, role key, whether a city limits it) and `admin_customer_viewed` (customer id, whether contact details were unmasked). Client events (strict schemas, no query text): `admin_staff_screen` (grant_opened / grant_saved / revoke_confirmed), `admin_customer_search` (kind code/email/phone/name, result count) and `admin_audit_search` (number of filters filled, result count).

## CSV exports (2026-11-15)

Server events (in the same transaction as the audit row): `admin_export_run { dataset, rangeDays, rowCount, masked }` when a file is prepared and `admin_export_downloaded { dataset, rowCount }` when it was streamed. Client event `admin_export_action { dataset, action: requested | downloaded | refused }` (strict; never the dates, the city or any row content).

## Job photos (2026-11-15)

Server events (same transaction; ids, codes and counts only, never a path or file name): `service_photo_added { requestCode, workshopId, stage: before|after, bytes }`, `service_photo_removed { requestCode, workshopId, stage }`. Client event: `service_photos_viewed { surface: request|workshop, count }` when a viewer opens.

## Shop portal tier 1 events (2026-11-15)

- **Server events** (`packages/shared/src/analytics.ts`): `shop_busy_set` (shopId, mode `closed_today|hours|clear`, hours or null); `shop_team_invited`, `shop_team_invite_cancelled`, `shop_team_invite_accepted`, `shop_team_member_removed` (shopId only; never a phone or name).
- **Click ids (web):** `shop_busy_closed_today`, `shop_busy_hours`, `shop_busy_clear`, `shop_team_invited`, `shop_team_invite_cancelled`, `shop_team_invite_accepted`, `shop_team_invite_declined`, `shop_team_member_removed`; existing `shop_order_accepted`, `shop_order_declined`, `shop_delivery_confirmed` unchanged.

## Admin next tier part 2 events (2026-11-15)

Server events (same transaction as the change; codes, counts and ids only): `admin_policy_restored { key, locale, fromVersion, version }` (next to `admin_content_published` for every publish), `admin_layout_published { scope: global|city, action: saved|reset, hidden, tiles, mapDefault }`, `admin_setting_city_changed { key, action: overridden|reset }`, `admin_company_saved { filled, grievanceShown }`. Client event `admin_site_change` gained areas `policies` and `company` and actions `publish`, `restore`, `preview` (area `layout` action `publish` for the real-mode layout save); `fields` is a count. Click id `admin_policy_preview_call` (preview call link), `footer_grievance_email` and `footer_grievance_phone` (footer links, only once the admin fills the officer).

## Workshop analytics events (2026-11-15)

Client (strict schemas in `packages/shared/src/analytics.ts`): `workshop_analytics_viewed {rangeDays}` (portal Performance loaded for a range of 1 to 180 days; the design wrote `range_days`, the catalogue uses camelCase like every other prop) and `admin_analytics_tab {tab: overview | workshops}`. Click ids: `workshop_performance_toggle`, `workshop_analytics_preset_{30|90}`, `workshop_analytics_retry`, `admin_analytics_tab_{overview|workshops}`, `admin_workshop_analytics_sort`, `admin_workshop_analytics_retry`.

## Support threads (2026-11-15)

Server events (same transaction; ids, codes and counts only, never text, a path or a payout value): `support_thread_opened { ticketCode, subject: order|service, issueCode, reopened, photos }`, `support_attachment_added { count, bytes }`, `support_refund_destination_saved { ticketCode, kind: upi|bank, replaced }`, `support_refund_from_ticket { ticketCode, orderCode, amountPaise, reasonCode }`. Client event `support_ticket` gains actions `thread_opened`, `thread_reopened`, `photos_attached`, `destination_saved`, `refund_requested` and the optional `issue` (code). Click ids: `order_support_thread`, `service_support_thread`.

## Coupon events (2026-11-15)

Client `apply_coupon { result: applicable|refused|applied|removed, reason: <COUPON_REASONS code>|null, funder: mechdost|shop|null }` (the typed code is never recorded; hard rules 9 and 16). Server events in the same transaction: `coupon_redeemed { couponId, orderCode, discountPaise, funder, kind }`, `coupon_released { couponId, orderCode }`, `admin_coupon_saved { couponId, action, funder }`, `admin_coupon_paused { couponId, paused }`, `shop_coupon_decided { couponId, shopId, decision }`.

## Workshops tier 1 events (2026-11-15)

Server (same transaction; ids, codes, counts only): `workshop_slot_capacity_set {workshopId, hour, capacity}`, `workshop_profile_saved {workshopId, fields[], busy, by}`, `workshop_change_requested {workshopId, kind}`, `workshop_change_decided {workshopId, kind, approved}`, `service_slot_booked {requestCode, workshopId, hour}`, `service_rescheduled {requestCode, workshopId, count, fromDate, toDate}`, `service_acceptance_expired {requestCode, workshopId, waitedMinutes}`. Client: `booking_rescheduled {code, workshop, slot}`, `workshop_profile_viewed {}`.

- **Shop portal tier 2 (2026-11-15):** server events `shop_csv_previewed` (shop, rows, errors, changes), `shop_csv_applied` (shop, stock, on/off and price-request counts), `shop_packing_slip_viewed` (shop, order code), `shop_performance_viewed` (shop), `partner_status_checked` (found yes/no, no identifiers). Client clicks: `shop_csv_template`, `shop_csv_check`, `shop_csv_apply`, `shop_slip_open`, `shop_slip_print`, `shop_perf_30`, `shop_perf_90`, `partner_status_found`, `partner_status_miss`. No cell text, names or phones in any property.

### Support next tier items 4 to 7 (2026-11-15)

Server events (same transaction; codes and counts only): `support_ticket_assigned { assigned, self }`, `support_canned_reply_saved { created, active }`, `support_ticket_closed { reason: auto|staff, kind }`, `support_guest_ticket_created { kind }`, `support_guest_reply { ticketCode }`, `support_deletion_requested { ticketCode }`, `support_deletion_confirmed { ticketCode }`. Client event `support_ticket` gains actions `assigned`, `canned_inserted`, `guest_created`, `guest_looked_up`, `guest_reply`, `deletion_requested`, `deletion_confirmed`. Click ids: `support_deletion_ask`, `support_deletion_confirm`. No name, phone, key or message text is ever an event property.

## Catalogue tier 2 events (2026-11-15)

Server (same transaction; ids, codes, counts, enums only): `admin_reco_rule_saved {ruleId, action created|updated|deleted, active}`, `copurchase_computed {pairs}`, `consent_changed {purpose marketing|analytics, granted, noticeVersion}`, `data_export_requested {exportId}`, `data_export_ready {exportId, bytes}`, `data_export_failed {exportId, errorCode}`, `data_export_downloaded {exportId}`, `waitlist_joined|left|notified {pincode}`. The PIN is a place, not a person; no contact detail, no export content, no rule text. Client: generic `click` through `data-track` ids `privacy_delete_request` (deletion hook) and `waitlist_join_click`; recommendation cards are Server Components, so there is no `reco_impression` yet (spec 11 lists `reco_*` for later).

## Product photos, cart and wishlist events (2026-11-15)

Server (same transaction as the change; ids, codes and counts only): `product_photo_added { productId, photoId, by: staff|shop, status }`, `product_photo_removed { productId, photoId }`, `product_photo_reviewed { productId, photoId, decision, reasonCode|null }`, `product_photos_reordered { productId, count }`, `cart_merged { kept, added, dropped }`, `cart_replaced { lines, dropped }` (no prices), `wishlist_changed { productId, on, count }` (only real changes). Client: `wishlist_toggled { slug, on, source: card|page|account }`, `wishlist_sign_in_prompted { slug }`; photo editor and queue buttons use `click` ids `product_photo_added_staff|added_shop|reordered|removed|approved|rejected`.

- **Workshops tier 3 (2026-11-15):** server events `service_bill_pay_started` (reserved), `service_bill_paid { requestCode, workshopId, amountPaise, via: online|workshop, method }`, `service_bill_payment_failed { requestCode, amountPaise, method }`, `service_bill_late_capture { requestCode, amountPaise, reason: settled|cancelled }`, `service_cancelled_by_staff { requestCode, workshopId, fromStatus, reasonCode, refundRequested }`; `service_status_changed` carries `by: admin` for a staff cancel. Click ids: `service_bill_pay_online`, `admin_service_routed_top`, `admin_service_routed_other`, `admin_service_cancelled`. Codes, ids and paise only.
