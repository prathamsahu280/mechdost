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
- **City:** `DEFAULT_CITY_CODE` (default RPR) is used only for the code segment when the sender has no known city; per-customer city routing to `staff:city` comes with the inbox.
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
  - On one request a customer may post at most `support.customer_messages_per_ticket_per_day` messages in 24 h (admin setting, default 20, the opening message included; `REPLY_LIMIT`, 422; counted under the ticket row lock). Threads return their newest 200 messages (review B9, 2026-11-11).
  - The order must be the caller's own. It sets the request's city and the code's city segment.
- `GET /v1/support/tickets`, `GET /v1/support/tickets/{code}`: own requests with their conversation, internal notes excluded.
- `POST /v1/support/tickets/{code}/messages {body}`: a reply on a request that was waiting on the customer, or resolved, moves it back to `in_review` (`ticketMachine`).

**Staff** (verified phone + email, `tickets:read`; posting also needs `tickets:reply`, and replies/status changes are scoped by the **`tickets:reply`** grants, never the wider read scope — security review 2026-11-03). Scope comes from grants: any all-city grant sees everything, city grants see requests whose `city_id` is theirs, and city-less requests (WhatsApp guests) go to all-city staff only.

- `GET /v1/admin/support/tickets?view=active|done`: sorted by reply deadline, with `acknowledged`.
- `GET /v1/admin/support/tickets/{code}`: includes internal notes.
- `POST /v1/admin/support/tickets/{code}/messages {body, internal}`:
  - a customer-facing reply moves open/in-review to `awaiting_customer`;
  - on a WhatsApp request it also queues the `ticket.replied` WhatsApp in the same transaction, when switched on.
- `POST /v1/admin/support/tickets/{code}/status {to, version}`: resolve, reopen or close via the state machine with compare-and-set (409 when stale), audited.

**Data:** `support_tickets.city_id` and `channel` (migration 0025). The WhatsApp bridge sets `channel = whatsapp`.

**Tests:** `packages/db/test/support.test.ts` (scope, limit, 404s, transitions, WhatsApp reply), `apps/api/test/support.test.ts` (permissions, verification, strict bodies, internal notes hidden, stale status).

The demo build still uses the browser store.

## Real API mode (2026-11-14)

In real sign-in builds (`AUTH_MODE === 'firebase'`; Stream D of `docs/superpowers/plans/2026-11-14-real-api-launch.md`) both screens run on this API, loaded with `next/dynamic` so demo bundles are unchanged:

- **Account → Support** (`apps/web/src/components/account/support-section-api.tsx`): raise a request (`POST /v1/support/tickets`; the "Order" choice lists the codes from `GET /v1/orders`, plus `?order=` from the order page), list and read requests (`GET /v1/support/tickets`), reply (`POST …/{code}/messages`). "We'll reply by" shows until staff answer or move the request on.
- **Admin → Support** (`apps/web/src/components/portal/admin-support-api.tsx`): inbox by view (`GET /v1/admin/support/tickets?view=active|done`, earliest deadline first, overdue flags), the conversation with internal notes loads when a request is opened, reply or internal note, resolve / reopen with the ticket `version` (stale → reload).
- Answers validated with `@mechdost/shared/support-api`; codes mapped in `apps/web/src/lib/support-view.ts` (`TICKET_DAILY_LIMIT`, `REPLY_LIMIT`, `TICKET_CLOSED`, `STALE_TICKET` → messages next to the field).
- **Gaps:** the inbox has no customer name or masked phone (the API does not return them) and messages carry no author name (customer view shows "MechDost support" / "You", staff view "Customer" / "MechDost support").

## Redo under the labour promise (2026-11-15)

New ticket kind `labour_redo` ("Redo under the labour promise"; enum in `packages/shared/src/support-api.ts` and the db
repo, CHECK `support_tickets_kind_valid` in migration 0058). It is raised from the customer's bill (link
`/account/support?redo=SR-…`), never from the generic kind list, and needs `serviceCode`: see spec 06 "Labour promise"
for the checks and error codes. The form shows "Redo request for {code}" and hides the order picker. SLA and statuses are
the same as any request; staff see it with the kind label in the inbox. Demo: the kind exists in the browser store.

## Order and request threads, photos and the COD refund destination (built 2026-11-15)

Design: `docs/superpowers/specs/2026-11-15-support-next-tier-design.md` items 1 to 3; plan `docs/superpowers/plans/2026-11-15-support-tier1.md`; migration `0065_support_threads` (renumbered at merge, not applied). The customer talks to **MechDost support only**; support coordinates with shops and workshops. Nothing in a thread's answer carries a shop's or workshop's phone or name, and nothing carries the customer's contact data to staff beyond what the inbox already shows.

- **One open thread per customer and order (or service job).** `POST /v1/support/threads` (multipart: `issueCode`, `orderCode` (the checkout group, `MD-…`) or `serviceCode` (`SR-…`), `body`, up to four `file` parts). A second "help" on the same subject continues the open one (200 `reopened: true`; a resolved or waiting thread goes back to `in_review` through `ticketMachine` inside `customerReplyTicket`); a new one answers 201. Partial unique indexes `support_tickets_order_thread_uq` and `support_tickets_service_thread_uq` (open statuses only: a closed thread frees the slot) make a second open thread impossible whatever the code does; an advisory lock per customer serialises two taps. Kind is `order_issue` or `service_issue`; the new `issue_code` column is a CHECK-enforced enum (`wrong_part`, `damaged`, `missing_item`, `late`, `workshop_issue`, `billing`, `other`; orders offer all but `workshop_issue`, service jobs `late`, `workshop_issue`, `billing`, `other`). The ticket links the order group's first sub-order (deterministic by sub number). The daily limit of 5 new requests applies to new threads only.
- **Photo attachments.** Up to 4 photos per message (opening message and replies via `POST /v1/support/tickets/{code}/photo-messages`), 8 MB each, through the one upload pipeline (`apps/api/src/photos/`: bytes decide the type, HEIC refused, EXIF gone by re-encode, random keys `ticket/{uuid}/{uuid}.webp` in the private bucket). Each is a `media_objects` row with owner kind `ticket_message` (owner id = the message). Rights are checked before any image work (404 for a foreign request, 409 `TICKET_CLOSED`). Listings carry 10-minute signed URLs (`/support-photos/{id}/{thumb|large}?e=&s=`, the job-photo HMAC); an unsigned, forged, expired or other-photo signature is a plain 404. A failed save or Storage outage removes what was stored (503 `PHOTOS_UNAVAILABLE`, no ticket created). Staff see the same photos in the inbox conversation.
- **COD refund destination (Q104).** For a cash-on-delivery order the customer enters a UPI id (`name@bank`) or bank details (account name, 9 to 18 digit account number, IFSC) with `PUT /v1/support/tickets/{code}/refund-destination` (strict body, the finance formats). Stored encrypted on the ticket (`refund_destination_enc`, AAD `support_tickets.refund_destination_enc`) with a mask (`ra***@okhdfcbank`, `••••9012 · HDFC0001234`) that is the only form ever returned (customer, inbox, audit log hold the kind only). Refused for an order paid online (422 `DESTINATION_NOT_COD`), on a closed request (409), and once a manual refund exists for the order (409 `DESTINATION_LOCKED`). Staff with `tickets:reply` and `refunds:initiate` press "Ask finance to approve this refund" (`POST /v1/admin/support/tickets/{code}/refund`, `Idempotency-Key`, amount in paise and a reason code): the repository decrypts the ticket's destination and calls `createStaffRefund` (source `support_claim`), so finance approval, four-eyes, the order-total cap, the delivered-only rule and the masked reveal for the approver (spec 05) all apply unchanged. Audit rows `ticket.created`, `ticket.photos_added`, `ticket.refund_destination_saved`, `ticket.refund_requested`.
- **Screens (real sign-in builds).** Account -> Support opened from an order or a service job (`?order=`, a sub-order code is accepted, or `?service=`) shows "Talk to MechDost support about …": issue chips, message, photo picker (up to 4, removable), then the conversation with thumbnails that open the large copy, a photo picker on replies, and for COD the "Where should we send your refund?" panel. The order page and the service request page link to it. Admin -> Support shows the issue badge, the photos and the "Cash on delivery refund" panel in the open conversation. Everything is lazy inside the support screens; the header, layout and shop pages import none of it (test).
- **Limits.** Opening: 20 an hour per customer; photo uploads 20 per 10 minutes; payout destination 10 an hour; image reads 600 a minute per IP; plus the normal per-user limit and the existing reply cap (20 messages per request per day).
- **Notifications.** The existing catalogues: `ticket_received` email and the `staff.new_ticket` bell on a new thread, `ticket_reply` and `ticket_resolved` as before. A message on an existing thread does not ping staff (the inbox shows it; a staff bell for customer replies is a follow-up).
- **Tests.** `packages/db/test/support-threads.test.ts` (one thread, parallel opens, closed frees the slot, DB index, subject/issue checks, photos, destination encryption and lock, refund from ticket, scope), `apps/api/test/support-threads.test.ts` (HTTP multipart, magic bytes, 8 MB, five photos, HEIC, EXIF, signed reads, Storage outage, 401/403/404 matrix, masking in every answer, rate limit, idempotent refund), `apps/web/test/support-thread.test.ts` (messages in both languages, rupee parsing, answer shapes, import graph), state audit rows `API-ACC-SUPPORT` and `API-ADM-SUPPORT`.
- **Not built:** staff-uploaded attachments, a purge of old destinations after payout (queued in `docs/questions-for-user.md`), items 4 to 7 of the design (inbox tools, auto-close, guest tickets, deletion request).

## Inbox tools, auto-close, guest tickets, deletion request (support next tier items 4 to 7, 2026-11-15)

Design `docs/superpowers/specs/2026-11-15-support-next-tier-design.md`; plan `docs/superpowers/plans/2026-11-15-support-next-tier-4-7.md`. Migration `0066_support_inbox` (not applied; the coordinator renumbers at merge).

### Inbox tools (item 4)

- **Customer and context in the list and the thread:** the customer's name (or the guest's, with a masked phone `••••••2233`, never the full number), the order code, the service job (`serviceCode`), the issue code, the assignee, the first-reply clock. API: `GET /v1/admin/support/tickets?view=active|done&assignee=me|unassigned|<id>&status=<status>` and the thread gets a staff-only `staff` block (never in the customer's answers: role-leak tests in db and api).
- **Assignment** (`POST /v1/admin/support/tickets/{code}/assign {assigneeId|null, version}`, `GET /v1/admin/support/agents`): the assignee must hold `tickets:reply` for the request's city (an all-city grant covers any; a request without a city needs an all-city agent) or the answer is 422 `ASSIGNEE_INVALID`. **`tickets:assign` is checked for the request's own city** (security review 2026-11-15); without it a staff member may only take an unassigned request for themselves or release one they hold (403 `ASSIGN_NOT_ALLOWED`, checked on the locked row). Compare-and-set on `version` (409 `STALE_TICKET`), audited (`ticket.assigned`), server event `support_ticket_assigned`. Staff outside the request's reply scope get 404.
- **Statuses:** staff can set in review, waiting for the customer, resolved, closed (state machine); a public reply still moves open/in review to waiting.
- **Canned replies:** table `canned_replies` (key, title and body in English and Hindi, active, sort order, version). Staff with `tickets:reply` read the active ones (`GET /v1/admin/support/canned-replies`); editing (`POST`, `PUT .../{id}` with `version`) needs an **all-cities `content:write`** grant (the list is global: a city manager cannot change it). The screen inserts the text of the viewer's language into the reply box and the agent edits before sending (`support_ticket` action `canned_inserted`). Five starter replies in both languages ship in the migration.
- **Internal notes** never leave the console: not in any customer or guest view, no email or message, no status change, no first-reply stamp.
- **SLA:** `support_tickets.sla_ack_due` is now the **first-reply deadline**: `support.first_reply_working_minutes` (default 120) of working time inside `support.hours_start_minute`/`support.hours_end_minute` (default 540/1260 = 9:00 to 21:00 IST, every day), computed in IST by `packages/shared/src/support-sla.ts`. A request outside the hours starts counting at the next opening. `first_replied_at` is stamped by the first public staff reply (an internal note does not count); the inbox shows `sla` met / on track / overdue. The old 48-hour acknowledgement is gone (the 30-day resolve target stays).

### Auto-close (item 5)

The worker (`apps/api/src/worker.ts`, every 10 minutes) calls `autoCloseResolvedTickets`: a request `resolved` for at least `support.auto_close_days` (default 7) with no customer reply is closed by one conditional UPDATE per request on its `version` (a request touched meanwhile is skipped and picked up next time; two workers are safe; running twice changes nothing). A customer or guest reply moves a resolved request back to review and clears `resolved_at`, so it never qualifies. `closed_at`, `close_reason` (`auto` or `staff`), audit `ticket.auto_closed` (system actor), event `support_ticket_closed`. Clock tests in `packages/db/test/support-inbox.test.ts`.

### Guest tickets (item 6)

- Public routes `POST /v1/support-guest/tickets | lookup | reply` (prefix `/support-guest`, outside the signed-in `/support/*` stack). The form (`/support/guest`) takes name, mobile number, topic (order, fitment, account, other) and message, with **Turnstile**; creation returns the reference (`REQ-…`) and a **private key** (16 base-32 characters, shown once, stored as SHA-256 only, compared in constant time; dashes, spaces and case do not matter).
- **Limits:** 5 tickets per IP per hour, 3 per phone number per day (limiter and a database check), lookups and replies 30 per IP per 10 minutes and **10 per reference per hour** (key guessing; the budget is spent even for the right key). A wrong key, an unknown reference and a signed-in customer's request all give the same 404.
- **No relay (project rule):** nothing is emailed or messaged to what a guest typed. The only way back is reference + key. The staff bell is the only notification. The typed number is stored (unverified) and shown to staff masked.
- Guests see the conversation only (no SLA, staff block, photos or refund). A guest reply reopens a waiting or resolved request; a closed one refuses (409 `TICKET_CLOSED`). Auto-close applies.

### Account deletion request (item 7; spec 01)

`POST /v1/support/deletion-request {note?}` (signed in; 5 an hour) opens one `deletion_request` ticket per customer (partial unique index; asking again returns it, 200) and stamps `users.deletion_requested_at`. **Blocked** with 409 `DELETION_BLOCKED` and `details.blockers` (`OPEN_ORDERS`, `OPEN_SERVICE`, `OPEN_REFUND`) while an order, service job or refund is open. Support confirms with `POST /v1/admin/support/tickets/{code}/deletion/confirm {version}` (needs `customers:block`, i.e. super admin today; compare-and-set; once only: 409 `DELETION_ALREADY_CONFIRMED`; blockers re-checked). Confirming records `deletion_confirmed_at/by`, audit `user.deletion_confirmed`, and the customer gets the usual reply email. **Nothing is erased**: what the deletion removes or keeps (GST invoices must be kept) is Q116. Account -> Support has a "Delete my account" card with one inline confirmation step; the inbox shows a confirm button on deletion requests.

### Tests

`packages/shared/test/support-sla.test.ts`, `packages/db/test/support-inbox.test.ts`, `support-guest.test.ts`, `support-deletion.test.ts`, `apps/api/test/support-inbox.test.ts`, `support-guest.test.ts`, `support-deletion.test.ts`; state-audit rows `API-ADM-SUPPORT-TOOLS`, `API-GUEST-SUPPORT`, `API-ACC-DELETION`.
