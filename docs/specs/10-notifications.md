# 10 · Notifications

Status: decided · Phase 1 (in-app + email), Phase 3 (WhatsApp/SMS) · Decisions: Notifications

## Goal

Reliable, never-duplicated, never-lost notifications through a provider-agnostic layer: in-app (`notifications` table; live ping via Firebase Realtime Database, decision 2026-11-01) and email (Resend) at launch; WhatsApp through the **Meta WhatsApp Cloud API directly** (user 2026-11-02: "i want the cheapest option"; no provider markup or monthly fee) and MSG91 for SMS/DLT later; templates are built now and switched on when the Meta account is set up.

## Architecture

Transactional **outbox** written in the same DB transaction as the business change → pg-boss relay (`FOR UPDATE SKIP LOCKED`) → channel adapters (`packages/notify`: inapp, email, sms, whatsapp, push P1) → `notification_log` with provider ids and delivery status webhooks. Dedupe key per (event, entity, channel). Per-event channel matrix editable in admin; user preferences respected (transactional always on).

## Events (catalogue)

order.placed/routed/confirmed/declined/expired/rejected/packed/shipped/out_for_delivery/delivered/cancelled; payment.captured/failed/refund_initiated/refund_processed; return._; service.requested/routed/proposed/confirmed/vehicle_received/estimate_sent/approved/started/ready/billed/paid/completed/declined/cancelled/reminder; ticket._; partner.application_received/approved/rejected; user.signed_up/email_verified/deletion_requested; admin alerts (sla_breach, low_stock, amount_mismatch, webhook_failures).

## Data

`notifications` (in-app: user, title, body, link, read_at), `notification_outbox` (dedupe_key UNIQUE, channel, to, template, locale, payload, status, attempts, sent_at, provider_id), `notification_templates` (key, channel, locale en|hi, subject, body with variables, DLT template id, enabled), `notification_log`.

## UI

Bell with unread count (aria-live status "3 new notifications"), notification centre page, partner portal sound + badge, admin template editor with preview/test-send.

## Rules

Max 1 message per event per channel; quiet hours for promotional (none for transactional); Hindi template chosen by user language; email from `no-reply@mechdost…` with SPF/DKIM/DMARC; unsubscribe links for promotional; every send logged.

## Acceptance tests

Rolled-back order sends nothing; relay retry does not duplicate; template variables validated; preference off suppresses promotional but not transactional.

## P1/P2

Web push (PWA), WhatsApp interactive buttons, abandoned-cart sequences, outbound partner webhooks.

## Live updates (decision 2026-11-01; step 1 built)

Pages update without reloads through **thin pings**: "entity X changed, now at version v". Clients refetch through the API, which checks permissions, so a ping never carries data. Transport is swappable (`LIVE_TRANSPORT`): `polling` (default, always-on fallback, 15 → 30 → 60 s, visible tabs only) or `rtdb` (Firebase Realtime Database per-user inbox, `asia-southeast1`).

Flow:

1. A database trigger writes a `live_outbox` row in the same transaction as the change. This covers orders (any change), `order_assignments` (offer, accept, decline, expire) and shop standing. It then calls `pg_notify('live_outbox')`.
2. The worker (`apps/api/src/worker.ts`, `pnpm --filter @mechdost/api worker`) claims rows with `FOR UPDATE SKIP LOCKED` and a 30 s lease. It resolves recipients **from Postgres** (`resolveLiveRecipients`), publishes and marks the rows sent. Wake-up comes from LISTEN (session URL `DATABASE_URL`), with a 1 s sweep as the backstop. Lag over 5 s logs `live_relay_lag`. Sent rows are purged after 24 h.
3. RTDB path `inbox/{firebaseUid}/{kind}~{entityId}` = `{e,k,id,v,at}`, overwritten per entity. Rules (`firebase/database.rules.json`) allow read of your own inbox only and no client writes.
4. Client: `parseLivePing` (exact five keys) → `newPings` version gate → debounced refetch. The client transport (`useLiveQuery`, RTDB listener and polling) is the next step, once the catalogue/order APIs exist. The demo uses `storage` events today.

Recipients:

| Topic             | Who receives it                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `order:{id}`      | The customer; users of the shop holding an `offered`/`accepted` assignment; staff of the order's city, plus all-city staff |
| `shop:{id}`       | The shop's users and its city's staff                                                                                      |
| `user:{id}`       | That user                                                                                                                  |
| `staff_city:{id}` | That city's staff                                                                                                          |

Staff are chosen **by permission** (`orders:read` for order and city topics, `partners:read` for shop topics) through `role_permissions`, so custom DB roles count and staff without access (for example marketing or finance) get nothing. This follows a security review on 2026-11-01. Workshop and quote topics fail closed until their membership tables exist. Deactivated users receive nothing.

**Data dictionary: `live_outbox`** (operational queue, not history; history lives in `*_events`):

| Column           | Type            | Meaning                                                            |
| ---------------- | --------------- | ------------------------------------------------------------------ |
| `id`             | bigint identity | Order of writes                                                    |
| `topic`          | text            | `{order\|shop\|workshop\|user\|staff_city\|quote}:{uuid}` (CHECK)  |
| `kind`           | text            | `order\|assignment\|shop\|workshop\|request\|quote\|coins` (CHECK) |
| `entity_id`      | uuid            | Changed row                                                        |
| `entity_version` | int ≥ 1         | Row `version` after the change                                     |
| `event`          | text            | `noun.verb` code (CHECK), e.g. `order.status_changed`              |
| `attempts`       | int ≥ 0         | Claims so far                                                      |
| `claimed_at`     | timestamptz     | Lease start                                                        |
| `sent_at`        | timestamptz     | Published                                                          |
| `created_at`     | timestamptz     | Commit-time insert (UTC)                                           |

No PII. RLS on; anon/authenticated revoked; `live_enqueue()` is not callable through RPC.

Tests:

- `packages/shared/test/live.test.ts`: contract, gate, backoff.
- `packages/db/test/live.test.ts`: same-transaction, rollback, versions, SKIP LOCKED, lease retry, purge, thin-only CHECKs, role-leak recipients.
- `apps/api/test/live.test.ts`: relay delivery, transport failure, inbox paths, config, RTDB rules.

**Lost access wipes the inbox (built 2026-11-03, was the security-review follow-up):** triggers on `users` (deactivated), `shop_users` (removed) and `user_roles` (revoked) queue the person's Firebase uid in `live_revocations` in the same transaction (migration 0020; RLS on, helper not callable by RPC); the relay calls `LivePublisher.forget()` → RTDB `inbox/{uid}` removed (multi-path update, paths validated to stay inside `inbox/`); rows purged 7 days after completion. **Extended after the second review (migrations 0021–0022):** role or scope changes, shop membership moves, a permission removed from a role and a changed Firebase uid also wipe the whole inbox; when a shop's offer on an order ends (declined/expired/withdrawn) only that order's and that assignment's node is removed from the shop's people (`live_revocations.node`). Every wipe runs **twice** — at once and again 120 s **after that first pass** (`wiped_at`, migration 0023; not after `created_at`, so a relay that was down cannot run both passes back to back), and each publish is capped at 20 s (`PUBLISH_TIMEOUT_MS`). The cap stops our wait, not Firebase's write, so a publish that times out **re-arms** every wipe from the last day that concerns its recipients (`rearmRevocationsFor`: another full pass 120 s later); rows wiped once before `wiped_at` existed are backfilled (migration 0024) and the claim is null-safe — and the relay also wipes right after publishing, so a ping resolved just before access ended cannot survive. Stale pings were already harmless (opaque ids, refetch is permission-checked); now they are also gone. A periodic age-based prune of old inbox nodes is not needed: nodes are overwritten per entity and wiped on access loss. Tests: `packages/db/test/live.test.ts` (triggers), `apps/api/test/live.test.ts` (relay + path safety).

## WhatsApp: Meta Cloud API direct (decision 2026-11-02; built, switched off)

- **Templates**: `packages/shared/src/whatsapp.ts` catalogue (event key → Meta template name, category, positional params, URL button). Launch set is all **utility**: `order.confirmed`, `order.out_for_delivery` (order code only — the delivery code is shown on the order page, never sent by WhatsApp: Meta refuses passcode-like codes in utility templates and a code on a locked screen leaks; user 2026-11-14), `order.rejected`, `service.estimate_sent`, `ticket.replied`, `order.routed` (partner). `utilityTemplateProblem` refuses offer wording in en/hi (a promo in a utility template gets it re-billed as marketing at ≈7.5×); `whatsAppParamProblem` rejects newlines/long values. Every template is registered in `en` and `hi` in WhatsApp Manager.
- **Sending**: the outbox (`notification_outbox`) rows are claimed by the worker's dispatcher (`apps/api/src/notify/dispatcher.ts`, `FOR UPDATE SKIP LOCKED`, batches of 10, a 120 s lease with a per-claim **fencing token** (`claim_token`, migration 0016) renewed right before each send, so a row reclaimed after a slow sender's lease ran out is never sent twice and outcomes are recorded only by the claim holder (security review 2026-11-02), `next_attempt_at` backoff 30 s → 1 h, 6 attempts) and sent by `createWhatsAppAdapter` (`POST graph.facebook.com/{v}/{phone-number-id}/messages`). Errors: 131049 marketing cap → retry in 24 h; 131026/invalid number/template issues → failed (fallback channel can take over); 429/5xx/throttling → retry. Logs carry codes only, never numbers or payloads.
- **Webhook** `GET|POST /webhooks/whatsapp`: handshake with `WHATSAPP_VERIFY_TOKEN`; POST verified with `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret, constant time) **before** parsing; each status/message stored once in `webhook_events` (`wa:{wamid}:{status}` / `wa:{wamid}`); receipts set `delivered_at`, `read_at`, `pricing_category`, `billable` on the outbox row (cost + delivery analytics); inbound messages are kept `received` for the support-ticket bridge (spec 09, next). 404 while `WHATSAPP_ENABLED=off`.
- **Outbox columns added** (migration 0015): `claimed_at`, `next_attempt_at`, `delivered_at`, `read_at`, `pricing_category` (CHECK: Meta categories), `billable`; unique `(channel, provider_id)`.
- **Cost rules**: WhatsApp only for events the customer must know/act on; everything else in-app/email; no marketing at launch; budget alert ₹5k/month (Q55).
- **Admin control (user 2026-11-02: "all these options need to be with the admin too")**: per-event WhatsApp switches, template text en/hi with preview and the promo-wording + placeholder checks, budget alert and month spend — **built 2026-11-03** (`/admin/notifications`, spec 08; API `/v1/admin/notifications/*` requires verified staff with `notifications:manage`). Sending code must check `notificationChannelEnabled(key, channel)` before queuing.
- Tests: `packages/shared/test/whatsapp.test.ts`, `packages/db/test/notify.test.ts`, `apps/api/test/whatsapp.test.ts`.

### Order milestones → WhatsApp (built 2026-11-03)

- **Confirmed and rejected:** `transitionOrder` (`order.confirmed`, `order.rejected`) queues the customer's WhatsApp in the **same transaction** as the status change. A rolled-back change never sends.
- **Out for delivery:** `issueDeliveryCode` queues `order.out_for_delivery`, also in its transaction.
- **When a message is queued:** only if staff switched the event on (an enabled WhatsApp template, admin → Notifications) and the customer has a phone. Language = the customer's `language`.
- **One message per transition:** the dedupe key carries the order version (`{event}:{orderId}:v{version}:whatsapp`). A re-issued delivery code does not send a second WhatsApp; it shows on the order page.
- **Secrets stay encrypted:** the delivery code is stored in the outbox as `deliveryCodeEnc` (AES-256-GCM, AAD `notification_outbox.payload.deliveryCode`), like the shipment's own copy. The dispatcher opens it with `openPayload` just before the Meta call.
  - Without the keyring the message is marked failed (`payload_decrypt`) and never sent.
  - The worker refuses to start WhatsApp without `DATA_ENCRYPTION_*`.
- **Tests:** `packages/db/test/order-notifications.test.ts`, `apps/api/test/whatsapp.test.ts` ("encrypted payload fields").

## WhatsApp templates as submitted to Meta (2026-11-14)

English, no header/footer. Utility: `order_confirmed` ({{1}} order code; button "Track order" → `https://mechdost.com/orders/{{1}}`), `order_out_for_delivery` ("Your order {{1}} is out for delivery. When the parcel arrives, tap Track order below and show the delivery person the confirmation shown on the website." — same button; Meta flags the words code / OTP / PIN / password / verification in utility templates, so they are avoided), `order_rejected_refund` (button "View order"), `service_estimate_ready` (button "Review estimate" → `/service/{{1}}`), `ticket_reply` (button "Open request" → `/account/support?ticket={{1}}`), `partner_new_order` ({{1}} order, {{2}} minutes; no button). Authentication: `mechdost_otp` (Meta's fixed OTP text, copy-code button, security note, 10-minute expiry) — WhatsApp OTP sending is not built yet (Q56). Meta credentials and the webhook are live on the server (Q94).

- **Bulk quote templates (2026-11-16, spec 19; catalogue only, sending stays off until the Meta submission):** utility, `quote_price_ready` (`quote.offer_sent`), `quote_reply` (`quote.message`), `quote_price_ending` (`quote.expiring`, 24 h before an offer ends, from the same worker sweep as the email) and `quote_closed` (`quote.withdrawn`); one body param `{{1}}` = the quote code, URL button "Open quote" on the quote code (`/quotes/{{1}}`). English and Hindi default bodies are in the locale files `notifyTemplates.quote.*` (the admin editor shows them; no offer or discount wording, no variable at either end). Queued in the transaction of the change by `packages/db/src/repo/quote-notifications.ts` only when staff switched the event on and the customer has a phone; dedupe per offer version, message, offer or quote. Tests: `packages/shared/test/whatsapp.test.ts`, `packages/db/test/quotes.test.ts` ("WhatsApp notices").

## Transactional emails (built 2026-11-15; design `docs/superpowers/specs/2026-11-15-emails-design.md`, plan `docs/superpowers/plans/2026-11-15-emails.md`)

Code defaults plus admin text overrides ("edit text, keep layout"). Runbook: `docs/runbooks/email.md`.

- **Catalogue** (`packages/shared/src/email-catalogue.ts`, English and Hindi, closed placeholder list each):
  - customer, updates: `order_placed`, `order_confirmed`, `order_out_for_delivery` (with the delivery code, sealed in the outbox, and the "only at the door" warning), `order_delivered`, `order_cancelled`, `order_rejected` (reason in plain words; refund note says "starting your refund" only for paid online orders, never "refunded"), `service_request_received`, `service_proposed`, `service_confirmed`, `service_estimate_ready`, `service_ready`, `service_completed`, `quote_offer`, `quote_expiring`;
  - customer, billing: `payment_received`, `refund_requested`, `refund_processed`, `refund_failed`, `service_bill_ready`;
  - customer, support: `ticket_received`, `ticket_reply`, `ticket_resolved`;
  - partner: `partner_invite`, `application_received`, `application_approved`, `application_rejected`, `shop_order_routed`, `partner_warning_issued` (system sender, calm wording, count in the window).
- **Where each is queued** (inside the transaction of the state change; `packages/db/src/repo/email-events.ts`): `transitionOrder` (confirmed, delivered, cancelled, rejected), `issueDeliveryCode` (out for delivery), `placeOrder` (COD placed), `applyRazorpayPayment` (receipt + online order placed, on a committed capture only), `transitionRequest` (proposed, confirmed, estimate sent, ready, billed, completed) and `createServiceRequest`, `createSupportTicket` / `staffReplyTicket` (web and app tickets; WhatsApp tickets are answered on WhatsApp) / `setTicketStatus` (resolved), `submitSellerApplication` and the review decision, `offerOrderToShop` (every person of the shop), `issuePartnerWarning` (shops), quotes (offer sent; the worker's quote sweep queues `quote_expiring` 24 h before an active offer ends, once per offer).
- **Refunds:** the refunds code calls `queueRefundEmail` (exported from `@mechdost/db/repo`) for the three `refund_*` templates; wiring is that branch's job.
- **Recipient and language:** the account's address and `users.language`; applicants (no account) get the address on the application in English. Verified addresses only when `customers.require_verified_email` is on (partners always). A shop never receives a customer's email or phone, and the customer never the shop's phone (only its area).
- **Overrides:** `notification_templates` rows with `channel = 'email'` (migration `email_templates` adds `heading` and `button_label`). No row = default text, on. Subject, heading and button label null = default; body `''` = default; `enabled=false` = off for that language. The worker reads the override at send time. The old generic template endpoint refuses the email channel.
- **Pipeline:** outbox → dispatcher → Resend adapter (`apps/api/src/notify/email.ts`, no SDK). Events `email_sent` / `email_failed` (spec 12).
- **Admin:** Admin → Notifications → Emails tab (spec 08); API `GET|PUT /v1/admin/notifications/emails`, `POST .../emails/reset`, `POST .../emails/test` (20/h).
- **Tests:** `packages/shared/test/email-templates.test.ts`, `packages/db/test/email-notifications.test.ts` (+ additions in checkout, payments, service-requests, quotes, notification-admin, partner-applications tests), `apps/api/test/email.test.ts`, `apps/api/test/admin-notifications.test.ts`.
- **Not built:** Resend bounce/complaint webhooks; promotional emails and unsubscribe; `coins_expiring` (no reminder job); workshop warning emails (no workshop login email); applicant language (no column).

## Real API mode (2026-11-14)

In real sign-in builds (`AUTH_MODE === 'firebase'`; Stream D of `docs/superpowers/plans/2026-11-14-real-api-launch.md`) Admin → Notifications runs on `/v1/admin/notifications/*` (`apps/web/src/components/portal/admin-notifications-api.tsx`, loaded with `next/dynamic`; demo unchanged):

- One card per WhatsApp event: the on/off switch and the English and Hindi text. "On" means the event's WhatsApp templates are enabled; Save sends `PUT /v1/admin/notifications/templates` for **both** languages (channel `whatsapp`, each row with its own `version`, null creates it) with the same switch value. Text not saved yet is prefilled from the locale defaults and marked "Suggested text: not saved yet", so the first save creates the rows. The text is checked like the API first (no offer wording, exact `{{n}}` placeholders); API refusals (`TEMPLATE_*`) show next to the field, a stale version reloads.
- The status line shows how many events are on; the budget card shows this month's sent / delivered / failed and estimated cost from `GET /v1/admin/notifications/whatsapp` and saves the alert with `PUT …/whatsapp/budget` (whole rupees → paise, compare-and-set).
- Launch step (Stream F): staff switch on `order.confirmed`, `order.out_for_delivery`, `order.rejected`, `ticket.replied` and `order.routed` here once the Meta templates are approved.
- **Gap:** no change-history endpoint, so the demo's "Recent changes" card is not shown in API mode.

## Bell and web push (built 2026-11-15; design `docs/superpowers/specs/2026-11-15-bell-push-design.md`, plan `docs/superpowers/plans/2026-11-15-bell-push.md`, runbook `docs/runbooks/push.md`)

In-app bell for every signed-in role and Firebase Cloud Messaging web push. Real sign-in builds only (the browser demo has no bell).

- **One writer: `queueNotice`** (`packages/db/src/repo/notices.ts`), called inside the transaction of the change it announces. Per person it writes the in-app `notifications` row (always for transactional and reminder kinds; already in the person's language; dedupe key `{kind}:{entity}:v{version}` UNIQUE per person) and, only if the person has a live device and push is on for the category, one `push` outbox row (dedupe `…:{userId}:push`) whose payload is `{title, body, link}` and nothing else (no address, phone, amount or delivery code on a lock screen; the placeholder lists are closed per kind). A rolled-back change writes neither.
- **Where it is called:** `queueEmail` writes the matching notice for every email milestone that has one (`NOTICE_FOR_EMAIL`), before any email checks, so a customer with no email address still gets the bell. Staff alerts (`queueStaffNotice`, by permission and city with the same `STAFF_WITH` rule as live pings): `staff.order_needs_routing` (when a checkout is placed), `staff.shop_declined`, `staff.shop_timed_out`, `staff.shop_gave_up` (the `notifyStaffShopGaveUp` hook now does this), `staff.new_application`, `staff.new_ticket`. Shop people get `shop.order_routed` with the email.
- **Catalogue:** `packages/shared/src/notice-catalogue.ts` (server only: reads the locale files) holds each kind's audience, category, placeholders and link; the default text is in the locale files under `notify.*` (en and hi); the web gets finished text from the API. 33 kinds (23 for customers, 3 for shops and workshops, 7 for staff).
- **Admin text:** `notification_templates` rows with channel `inapp` (bell) or `push` (key = kind code, `subject` = title, body `''` = default, `enabled` false = off in that language). A push with no row of its own uses the bell text. Admin → Notifications → Messages tab (`admin-notices-api.tsx`), API `GET|PUT /v1/admin/notifications/notices`, `POST …/notices/reset` (placeholders from the closed list, no markup, title 80 / body 240); the generic template endpoint refuses these channels.
- **API (customer, shop, workshop, staff alike; own rows only):** `GET /v1/me/notifications` (cursor, `limit` ≤ 50, unread count stops at 100), `GET …/unread-count`, `POST …/read` (`{ids}` or `{all:true}`; a foreign id changes nothing), `POST /v1/me/push-devices` (register or refresh; a token already known moves to the caller; newest 10 devices kept), `DELETE /v1/me/push-devices/{id}` (404 for a foreign id), `GET|PATCH /v1/me/notification-preferences` (push for updates; promotions = marketing consent). Rate limits: reads 600/h, device and preference writes 30/h.
- **Preferences:** `notification_preferences` (push × transactional/reminders written together by the "updates" switch; push and inapp × promotional by "promotions"). Promotions need the `marketing` consent (append-only `consents` row with the notice version `MARKETING_NOTICE_VERSION`), the preference and the weekly cap (`notifications.promo_per_week`, default 2). No promotional kind ships yet; the gate is in the writer and tested.
- **Dispatcher `push` adapter** (`apps/api/src/notify/push.ts`): reads the person's live tokens at send time, `firebase-admin` `sendEach`, revokes tokens FCM calls gone, retries busy/unavailable (existing back-off), `later` on auth errors, `permanent` for no device or a bad payload. Started in the worker only with the real Firebase project (not the emulator or a demo project). Events `push_sent {kind}` / `push_failed {code}`.
- **Worker jobs:** offer-expiry reminder (`queueOfferExpiryReminders`, every 60 s, `notifications.offer_expiry_reminder_min` minutes before expiry, once per offer and person), refund-SLA alert (`queueRefundOverdueAlerts`, hourly, `refunds.approval_sla_hours`, once per refund), retention (`purgeOldNotices`, daily and at start, `notifications.retention_days` = 90, batched delete).
- **Browser:** the header bell (`components/notices/bell.tsx`, always loaded and tiny; the bell chunk loads only for a signed-in person) polls the newest ten every 15 s for partners and staff, 60 s for customers (hidden tabs pause, growing back-off), refreshes at once on tab focus and when the push worker posts `mechdost-notice`; unread badge 0/1..99/99+ with a polite live region ("3 new notifications"); dropdown of the latest 10 + "See all" (`/notifications`, every role) with "Mark all as read", empty state with one next action per role and an error state. New arrivals fire `mechdost:notices`; `useNoticeRefresh` (tiny) reloads the shop offers list on `shop.order_routed` / `shop.offer_expiring` and the admin routing queue on the staff kinds. The "Get order and booking updates on this device" card (`push-card.tsx`) shows once on the account, shop, workshop and admin homes and in the centre; "Turn on" is the only place the browser's permission question and the Firebase library are reached (`lib/push/enable-push.ts`, dynamic import); "Not now" hides it for `notifications.push_prompt_snooze_days` (14); iPhone Safari outside the Home Screen sees the "Add to Home Screen" explanation; a denied browser is shown as such with how to re-enable. Card and "this device" control are hidden until `NEXT_PUBLIC_FIREBASE_VAPID_KEY` and `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` are set (Q103); the bell works without them. Choices: Account → Notifications and the centre.
- **Service worker:** `apps/web/public/firebase-messaging-sw.js`, plain (no Firebase code, no keys, no network): shows title and body, tags by kind, tells open tabs to refresh, opens the page the message links to (paths on this site only). No full PWA (serwist-pwa assessed: not needed for push, would add a precache and update surface).
- **Sign-out** revokes this browser's push device before the Firebase sign-out (`forgetPushDevice`).
- **Tests:** `packages/shared/test/notice-catalogue.test.ts`, `packages/db/test/notices.test.ts`, `apps/api/test/notices.test.ts`, `apps/web/test/push-lazy.test.ts` (import graph: the library is lazy), `apps/web/test/notices-view.test.ts`, `apps/web/test/csp.test.ts`.
- **Not built:** live pings consumed in the browser (the bell polls; the Realtime Database client transport is still the planned step, so partners wait up to 15 s without a push); foreground FCM messages (the poll and the worker's tab message cover it); promotional senders and quiet hours; Android/iOS native tokens (the table accepts them); a push for workshop warnings (no workshop login yet).

## Order-email trust line (2026-11-15)

Order emails (`order_*` templates) carry one footer line above the company line: "Genuine parts from verified Raipur shops." (Hindi: "रायपुर की सत्यापित दुकानों से असली पार्ट्स।"). The admin rewords or hides it in Admin → Content → Trust lines (`trust.emailFooter`, spec 08); the worker reads the published text at send time and falls back to the default if the lookup fails. Other emails (refunds, service, quotes, support, partners) do not carry it.

## Notice kind added 2026-11-15

`account.pin_served` (customer, transactional, entity `account`, placeholder `pincode`, opens /shop): "We now deliver to {pincode}", written by the worker when a PIN someone waited for is switched on (spec 15). English and Hindi defaults under `notify.account_pin_served`; editable in Admin -> Notifications like the others.

## Live updates: cart and wishlist pings (2026-11-15)

`live_outbox` kinds gain `cart` and `wishlist` (events `cart.changed`, `wishlist.changed`; topic `user:<id>`, ids and a version only). Written by triggers on `carts` and `wishlist_items`, relayed like the others.

## Live updates: the browser listener (2026-11-15)

One shared, lazily loaded Firebase Realtime Database subscription per signed-in tab (`apps/web/src/lib/live/`). The relay resolves every topic (order, shop, workshop, staff city, quote, user) to **user ids in Postgres** and writes only `inbox/<firebaseUid>/<kind>~<id>`, so the browser needs exactly one read path.

- **`live-hub.ts` (light, no Firebase import):** `startLive(locale)` (reference counted, returns the release; the connection closes 2 s after the last release, so an effect that re-runs keeps it), `subscribeLive(kinds, handler)`, `emitLive`, `resetLive`. Pings are merged and debounced 300 ms, then each subscriber whose kinds match is called once. It does nothing unless `AUTH_MODE` is `firebase` **and** `NEXT_PUBLIC_FIREBASE_DATABASE_URL` is set (demo builds and unset URL: polling only).
- **`live-listener.ts` (heavy, `@firebase/database`, ~30 KB gz):** imported dynamically by the hub when the first consumer starts, i.e. only after sign-in, **only when the browser is idle (`requestIdleCallback`, 1 s timer in Safari) and the tab is visible** (a hidden tab waits for `visibilitychange`). Subscribes to `inbox/<uid>` (child added and changed); `parseLivePing` (exact five keys) then the `newPings` version gate; **closes (`goOffline`, listeners off) when the tab is hidden and reopens with one catch-up of every kind when visible**; every callback is bound to the uid it was attached for and ignored after a switch, sign-out, stop or while hidden (late callbacks of the previous account reach nobody); a uid change re-points it and forgets the gate; sign-out (`signOutEverywhere` calls `resetLive`) closes it. A permission or network failure ends it silently.
- **Consumers:** `storefront-sync.startStorefrontSync` (cart and wishlist pings call `refreshStorefront`, which calls `refreshCart` and `refreshWishlist`); `use-notice-feed` (order, assignment, shop, workshop, request, quote and coins pings call the bell's `refresh`, whose arrivals still fire `mechdost:notices` for the shop offers list). Their polling (cart and wishlist 60 s, bell 15 s for staff and partners, 60 s for customers) **keeps running at its normal interval regardless**: the live ping is an accelerator, never the only path.
- **Rules (`firebase/database.rules.json`):** read `inbox/$uid` only when `auth.uid === $uid` and the sign-in provider is not `anonymous`; no client write anywhere (restated on every ping node with `.validate: false` as defence in depth); everything else closed. Audited with `firebase:firebase-security-rules-auditor` (2026-11-15): own-uid read only, no cascading grants from a parent, no query on `inbox` itself, anonymous and unauthenticated refused; claims are not used (the rules key on uid only, authorization stays in Postgres). Shop, workshop and staff access needs no rule of its own because the relay addresses their user ids (permission-resolved server side, spec 13).
- **CSP:** `connect-src` gains the database host (`https` and `wss`) in firebase mode, only for a `*.firebasedatabase.app` or `*.firebaseio.com` host (`databaseOrigins` in `lib/csp.ts`).
- **Analytics:** no per-ping events (noise). No "live connected" event was added: the first-party catalogue has no live-connection event and inventing one is not worth a schema change; the ping lag is already logged server-side (`live_relay_lag`).
- **Tests:** `test/live-hub.test.ts`, `test/live-listener.test.ts`, `test/live-lazy.test.ts` (bundle guard), `test/csp.test.ts`, API `live.test.ts` (rule clauses). Real emulator rule tests are queued (Q160).

- **Staff cancel of a service request (2026-11-15):** email template `service_cancelled` (en + hi; reason in words, honest refund line) with bell notice `service.cancelled` and push, queued in the cancel transaction (`queueServiceCancelledEmail`); the reason phrases live in `email-phrases.ts`.
