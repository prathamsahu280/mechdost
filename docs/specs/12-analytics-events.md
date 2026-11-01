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
