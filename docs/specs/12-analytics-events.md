# 12 · Analytics & event tracking (first-party)

Status: decided · Phase 1 · Decisions: Analytics

## Goal

Own every user action as raw data for later processing, plus self-hosted PostHog for funnels, session replay and feature flags.

## Architecture

- Client SDK (`packages/analytics`): `track(event, props)` batches to `POST /events` (beacon on unload); server-side events emitted from the API for money/state changes (purchase, refund, routing) so they are never lost to ad blockers.
- Storage: Postgres `events` table partitioned by month (id uuid v7, occurred_at, received_at, user_id nullable, anonymous_id, session_id, device jsonb, city_id, vehicle_id, page, event, props jsonb, consent_version) with BRIN on occurred_at and GIN on props; retention policy (raw 18 months, aggregates forever); nightly rollups into `metrics_daily`; export job to ClickHouse/BigQuery when > ~50M rows/month.
- PostHog self-hosted (Docker on a small VM / Cloud Run + Postgres+ClickHouse) receives the same events via the PostHog SDK; feature flags served from PostHog with local fallback.
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
- Not yet: `user_id` on signed-in events (identify/merge with web sign-in); PostHog forwarding; `metrics_daily` rollups.

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

## Product comparison events (2026-11-13)

- **Client events:** `compare_added` (slug, category, count 1–4), `compare_removed` (slug, count), `compare_opened` (count, category), `compare_differences_toggled` (on). `add_to_cart` gains an optional `source: 'compare'` (optional so events from older open tabs still pass).
- **Click ids:** `compare_tray_open`, `compare_tray_clear`. Spec 21.
- **Tray question (redesign 2026-11-14):** `compare_switch_prompted` (from, to: category slugs; count 1–4 being replaced), `compare_switch_answered` (choice `start_new` | `keep`, to), `compare_limit_shown` (reason `full` | `save_failed`). Codes and counts only; "Start new" also sends `compare_added` (count 1).
