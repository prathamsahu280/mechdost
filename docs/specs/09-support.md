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
