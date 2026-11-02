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

Typed client catalogue `apps/web/src/lib/analytics.ts`: `page_view`, `click` (`data-track` ids via one delegated listener), `search`, `add_to_cart`, `remove_from_cart`, `begin_checkout`, `purchase` (demo flag), `booking_started`, `booking_confirmed` (demo flag), `assistant_opened`, `assistant_message` (intent + length only), `admin_site_change` (area, save/reset, number of fields — never the text itself). Events queue in memory and dispatch a `mechdost:track` DOM event; the `POST /v1/events` transport + consent gate + PostHog ship with Phase 1.

## Built: server events in the event store (2026-11-03)

- Table `events` (created in migration 0002, completed in 0030): partitioned by month on `occurred_at` (DB-clock default), `source` server | web | app, props an object ≤ 8 KB with a GIN index, **append-only** (trigger), RLS on the parent and every partition. `ensure_event_partitions(n)` creates this month + n ahead (RLS on, Data API roles revoked); the worker runs it at start and every 12 h (dev has Nov 2026 – Feb 2027 + default).
- `recordServerEvent(tx, event, {userId, cityId, props})` (`packages/db/src/repo/events.ts`) writes in the caller's transaction: a rolled-back change records nothing, a replayed order records nothing new. Typed catalogue `ServerEventProps` (`packages/shared/src/analytics.ts`): ids, codes, enums and paise only.
- Emitted now: `purchase` (order code, sub-orders, items, total, method), `admin_order_routed` / `admin_order_rerouted` (shop, attempt), `admin_order_rejected` (reason code), `seller_order_accepted` (seconds to accept), `seller_order_declined` (reason code), `order_cancelled` (by customer/staff, reason, from status), `order_delivered`, `admin_customer_blocked` / `admin_customer_unblocked` (level, reason), `admin_product_status_changed` (from → to), `inventory_updated` (fields changed, by shop/staff).
- **`POST /v1/events`** (built 2026-11-03, `apps/api/src/routes/events.ts`): anonymous, 120 per minute per IP, batches of ≤ 50 `{event, occurredAt, page?, props}` with `source` web|app, `anonymousId` (uuid), `sessionId`, `consent {analytics, version}`. The **registry** is `CLIENT_EVENT_SCHEMAS` in `packages/shared/src/analytics.ts` (Zod, strict): unknown events, invalid props and extra fields (e.g. a phone number) are dropped and counted (`{stored, rejected}`); without analytics consent nothing is stored (DPDP); `occurredAt` outside the last 24 h (or > 5 min ahead) becomes the receive time. The web's `ClientEvents` type now comes from that registry (`import type`: no validator in the browser bundle).
- **Consent banner + web transport (built 2026-11-03):** `apps/web/src/components/site/consent-banner.tsx` + `src/lib/consent.ts` (DPDP; decision "declines non-essential by default"): a fresh visitor sees "Your privacy choice" with two equal buttons, **Allow analytics** / **Essential only** (same style and size, none pre-selected, no shaming copy — Dark Patterns Guidelines 2023); not a modal; nothing optional runs before a choice (no visitor id, no event request). Choice stored on the device (`mechdost-consent`, notice version `2026-11`; a new version asks again); "Privacy choices" in the footer reopens it (Escape closes a reopened one); the floating assistant button steps aside while it is open. `src/lib/event-transport.ts` sends batches (≤ 20, every 5 s, flushed on page hide; `fetch` keepalive) to `POST /v1/events` only with consent **and** `NEXT_PUBLIC_API_URL` set (the local demo sends nothing); withdrawing consent clears the outbox and deletes the visitor id. Tests: `e2e/consent.spec.ts` (desktop + mobile, axe on the banner, Hindi copy); other suites start with a decided choice (`e2e/fixtures/consent-decided.json`).
- **Security review fixes (2026-11-03):** the search query is NFKC-normalised and scrubbed of emails and digit runs of 7+ in **any script** (Devanagari ९८७…, full-width, ASCII; separated by spaces, dashes, dots, brackets or slashes) — phone, account or card numbers → `#`; short part numbers and tyre sizes kept by `scrubFreeText` (`packages/shared/src/privacy.ts`, dependency-free) in the browser **and again** in the server registry; the visitor id is deleted on every page load and on any change to the consent record in another tab whenever analytics is not currently allowed (covers withdrawal elsewhere and new notice versions). Page paths keep public codes (pseudonymous ids, like `user_id`).
- Not yet: `user_id` on signed-in events (identify/merge with web sign-in); PostHog forwarding; `metrics_daily` rollups.

## Admin use

Dashboard charts read `metrics_daily`; ad-hoc questions via PostHog HogQL; export CSV of events by date range (async job).

## Rules

No PII in `props` beyond ids; phone/email never stored in events; IP truncated; `anonymous_id` merged to `user_id` on login (identify event); events validated by Zod schema registry in `packages/shared/analytics`.

## Acceptance tests

Schema validation rejects unknown events; purchase server event exactly once per order; partition routing; consent off → only essential events stored.

## P1/P2

ClickHouse export, experiments (PostHog), attribution/UTM reports, data warehouse for recommendations.

## ML/AI-ready data (hard rule 16, 2026-11-01)

Every event follows `docs/conventions/data-for-ml.md`: `noun_verb` names, typed versioned properties, enum codes instead of free text, internal ids only (no PII), source/city/locale/actor role recorded, consent per purpose before personal data is used for offers or model training.
