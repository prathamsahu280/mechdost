# 10 · Notifications

Status: decided · Phase 1 (in-app + email), Phase 3 (WhatsApp/SMS) · Decisions: Notifications

## Goal

Reliable, never-duplicated, never-lost notifications through a provider-agnostic layer: in-app (`notifications` table; live ping via Firebase Realtime Database, decision 2026-11-01) and email (Resend) at launch; MSG91 SMS and WhatsApp templates built now, enabled when the provider is set up.

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

Workshop and quote topics fail closed until their membership tables exist. Deactivated users receive nothing.

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
