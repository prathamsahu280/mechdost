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

**Lost access wipes the inbox (built 2026-11-03, was the security-review follow-up):** triggers on `users` (deactivated), `shop_users` (removed) and `user_roles` (revoked) queue the person's Firebase uid in `live_revocations` in the same transaction (migration 0020; RLS on, helper not callable by RPC); the relay calls `LivePublisher.forget()` → RTDB `inbox/{uid}` removed (multi-path update, paths validated to stay inside `inbox/`); rows purged 7 days after completion. **Extended after the second review (migrations 0021–0022):** role or scope changes, shop membership moves, a permission removed from a role and a changed Firebase uid also wipe the whole inbox; when a shop's offer on an order ends (declined/expired/withdrawn) only that order's and that assignment's node is removed from the shop's people (`live_revocations.node`). Every wipe runs **twice** — at once and again 120 s **after that first pass** (`wiped_at`, migration 0023; not after `created_at`, so a relay that was down cannot run both passes back to back), and each publish is capped at 20 s (`PUBLISH_TIMEOUT_MS`) — and the relay also wipes right after publishing, so a ping resolved just before access ended cannot survive. Stale pings were already harmless (opaque ids, refetch is permission-checked); now they are also gone. A periodic age-based prune of old inbox nodes is not needed: nodes are overwritten per entity and wiped on access loss. Tests: `packages/db/test/live.test.ts` (triggers), `apps/api/test/live.test.ts` (relay + path safety).

## WhatsApp: Meta Cloud API direct (decision 2026-11-02; built, switched off)

- **Templates**: `packages/shared/src/whatsapp.ts` catalogue (event key → Meta template name, category, positional params, URL button). Launch set is all **utility**: `order.confirmed`, `order.out_for_delivery` (with the delivery code), `order.rejected`, `service.estimate_sent`, `ticket.replied`, `order.routed` (partner). `utilityTemplateProblem` refuses offer wording in en/hi (a promo in a utility template gets it re-billed as marketing at ≈7.5×); `whatsAppParamProblem` rejects newlines/long values. Every template is registered in `en` and `hi` in WhatsApp Manager.
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
