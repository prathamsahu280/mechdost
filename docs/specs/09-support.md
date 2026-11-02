# 09 · Support tickets

Status: decided (WhatsApp handoff pending #3) · Phase 2 · Decisions: Customer account (support)

## Goal

Order- and booking-anchored support with quick issue picks, threads, SLAs and the legally required grievance path; guest tracking kept from the concept.

## User stories

- From an order/booking page or Account → Support: pick issue (wrong part, damaged, late, no-show, refund, fitment, other), add photos, describe; see status and replies; reply in thread; close.
- Guest: concept support form with reference + private access key tracking.
- Staff: inbox with filters, assignment, canned replies, internal notes, SLA timers (acknowledge 48 h, resolve 30 days), escalation, link to order actions (refund/replace from the ticket).

## States

`open` → `in_review` → `awaiting_customer` → `resolved` → `closed` (auto-close 7 days after resolved); `reopened`.

## Data

`support_tickets` (code REQ-…, user nullable, guest_phone/name, access_key hash, kind, order_id/service_request_id, priority, status, assignee, sla_ack_due, sla_resolve_due), `ticket_messages` (author role, body, attachments[], internal bool), canned_replies, `grievance_officer` settings (name, designation, contact shown on /support and policies).

## API

`POST /support/tickets` (auth or guest), `GET /support/tickets/:code` (auth) / `POST /support/track {code, key}` (guest), `POST /support/tickets/:code/messages`, staff `/admin/tickets/*`.

## UI

Concept `/support.html` layout and copy ("How can we help?"), account "Support & requests" list, ticket thread view; issue quick-pick chips; WhatsApp and call buttons (pending decision for WhatsApp handoff).

## Rules

Rate limit 5 tickets/user/day; attachments ≤ 5 × 5 MB (images/PDF, EXIF stripped); support agents see masked PII with logged reveal; deletion requests arrive here with a special kind and require confirmation before execution.

## Notifications

`ticket.created|replied|status_changed` → customer in-app + email; staff inbox realtime.

## Analytics

`support_ticket_created` (kind, source), `ticket_resolved` (hours).

## Acceptance tests

Guest tracking with wrong key → 404; SLA timers computed in IST; masked PII for support role; auto-close job idempotent.

## P1/P2

Live chat widget (declined for now), order chat with partner, NPS after resolution, Hindi canned replies (Hindi at launch applies to UI strings; canned replies maintained by staff).

## WhatsApp → tickets (built 2026-11-03; settles pending #3)

- **Flow:** customer messages reach the signed webhook (`/webhooks/whatsapp`), which stores each message once in `webhook_events` (`received`). The worker's `bridgeInboundWhatsApp` (every 5 s while WhatsApp is on) turns each event into a ticket message in one transaction.
- **Which ticket:** a known customer (phone matches an active account) or a guest (phone only). The message is appended to their latest open, in-review or waiting ticket, or to one resolved in the last 7 days, which reopens it to `in_review` via the new `ticketMachine` (`packages/shared/src/state`). Otherwise a new `REQ-{city}-{yyyy}-{6}` ticket opens with kind `other`, acknowledgement due in 48 h and resolution in 30 days, plus an audit row `ticket.created`.
- **Integrity:**
  - `ticket_messages.channel` (code: web/app/whatsapp/email/console/system) and `external_id` (wamid) with a unique index (migration 0018): a redelivered or retried message is never stored twice;
  - a per-phone transaction lock stops two workers from opening two tickets for one conversation;
  - malformed senders are parked (`webhook_events.status = parked`, `error = bad_sender`), not lost.
- **Media:** stored as a code (`[image]`, `[document]` …) until media import is built (Supabase Storage, EXIF strip).
- **Replies:** staff answer in the admin inbox. The reply goes back as a free-form WhatsApp message inside the 24 h window (free for 1,000 a month), otherwise as the `ticket.replied` utility template. This is built with the support inbox UI.
- **City:** `SUPPORT_DEFAULT_CITY_CODE` (default RPR) is used only for the code segment when the sender has no known city; per-customer city routing to `staff:city` comes with the inbox.
- **Tests:** `packages/db/test/support-bridge.test.ts`, `packages/shared/test/state.test.ts` (ticket machine).

## Customer and staff screens (built 2026-11-03, demo; API next)

- **Account → Support** (`/account/support`):
  - The no-returns note (spec 05), then a "New request" form: kind code (`order_issue` = faulty/damaged/wrong part, `refund`, `fitment`, `account`, `other`), optional order, and a message of ≤ 2,000 characters.
  - Limit of 5 requests a day.
  - Each request shows its thread, status in plain words and "We'll reply by…" until acknowledged, plus a reply box.
  - The order page links here with `?order=CODE` ("Report a problem with this order"), which preselects the order and the faulty-part kind.
- **Admin → Support inbox** (`/admin/support`):
  - Active vs resolved/closed filter, sorted by acknowledgement deadline.
  - Overdue badges (reply 48 h, resolve 30 days).
  - WhatsApp requests marked 💬 with the number masked (`+91 98•••••11`; reveal is a separate audited action, later).
  - Reply to the customer, which acknowledges the request and moves it to "waiting for the customer"; on WhatsApp requests it goes out on WhatsApp.
  - Internal note, never shown to the customer.
  - Resolve and reopen; every move goes through `ticketMachine`.
- **Demo store:** `apps/web/src/demo/support.ts`, with a seeded WhatsApp guest request. Messages are user content (`data-user-content`). Event: `support_ticket {action, kind, channel, to}` (codes only).
- **Tests:** `e2e/support.spec.ts` (order page → request → internal note → reply → customer reply → resolve), the audit includes both pages, and the Hindi gate covers `/hi/account/support` and `/hi/admin/support`.

## API (built 2026-11-03)

**Customer** (signed in, `tickets:create`; foreign codes → 404; strict bodies):

- `POST /v1/support/tickets {kind, orderCode?, body}` → 201 `{code}`.
  - At most 5 per 24 h, serialised per user (`TICKET_DAILY_LIMIT`, 422).
  - The order must be the caller's own. It sets the request's city and the code's city segment.
- `GET /v1/support/tickets`, `GET /v1/support/tickets/{code}`: own requests with their conversation, internal notes excluded.
- `POST /v1/support/tickets/{code}/messages {body}`: a reply on a request that was waiting on the customer, or resolved, moves it back to `in_review` (`ticketMachine`).

**Staff** (verified phone + email, `tickets:read`; posting also needs `tickets:reply`). Scope comes from grants: any all-city grant sees everything, city grants see requests whose `city_id` is theirs, and city-less requests (WhatsApp guests) go to all-city staff only.

- `GET /v1/admin/support/tickets?view=active|done`: sorted by reply deadline, with `acknowledged`.
- `GET /v1/admin/support/tickets/{code}`: includes internal notes.
- `POST /v1/admin/support/tickets/{code}/messages {body, internal}`:
  - a customer-facing reply moves open/in-review to `awaiting_customer`;
  - on a WhatsApp request it also queues the `ticket.replied` WhatsApp in the same transaction, when switched on.
- `POST /v1/admin/support/tickets/{code}/status {to, version}`: resolve, reopen or close via the state machine with compare-and-set (409 when stale), audited.

**Data:** `support_tickets.city_id` and `channel` (migration 0025). The WhatsApp bridge sets `channel = whatsapp`.

**Tests:** `packages/db/test/support.test.ts` (scope, limit, 404s, transitions, WhatsApp reply), `apps/api/test/support.test.ts` (permissions, verification, strict bodies, internal notes hidden, stale status).

The web screens still use the demo store until the web app is switched to the API (Phase 1 wiring).
