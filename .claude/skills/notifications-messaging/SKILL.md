---
name: notifications-messaging
description: Use for MechDost notification work — in-app, email (Resend), WhatsApp (Meta Cloud API direct) and SMS (MSG91, later) templates, the transactional outbox and relay, DLT registration, delivery webhooks, user preferences, Hindi templates and notification tests. SMS/WhatsApp stay wired but disabled until the provider is set up (decision 2026-10-31).
---

# Messaging & notifications (MechDost)

Spec: `docs/specs/10-notifications.md`. Code: outbox + templates in `packages/db/src/repo/notify.ts`, `order-notifications.ts`, `notification-admin.ts`; dispatcher and channel adapters in `apps/api/src/notify/` (`whatsapp.ts` = Meta Cloud API); delivery webhooks in `apps/api/src/routes/whatsapp-webhook.ts`. (Renamed from `msg91-messaging` on 2026-11-11: WhatsApp no longer goes through MSG91.)

## Architecture (never bypass)

1. Business change and `notification_outbox` row(s) are written **in the same transaction** (repository helper).
   `dedupe_key = <event>:<entity_id>:<channel>` (UNIQUE) → at-least-once relay never double-sends.
2. Relay worker (pg-boss): claim `status='pending'` rows with `FOR UPDATE SKIP LOCKED`, render template
   (`notification_templates` by key/channel/locale), send through the channel adapter, store `provider_id`,
   mark `sent` / `failed` (attempts, backoff). Channel disabled or user opted out → `suppressed`.
3. Delivery webhooks (Resend, Meta WhatsApp, MSG91 later) update status; verify their signatures; dedupe by provider event id; record + apply a receipt in one transaction (`recordDeliveryReceipt`).

## Channels

| Channel  | Provider                                                                       | Status                                                              |
| -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| inapp    | `notifications` table + Firebase RTDB ping                                     | on                                                                  |
| email    | Resend (`RESEND_API_KEY`, verified domain, SPF/DKIM/DMARC)                     | on when key present (inbox Q7); else logged                         |
| sms      | MSG91 (DLT-registered templates, sender ID)                                    | wired, **off**                                                      |
| whatsapp | Meta WhatsApp Cloud API direct (approved templates; utility for order updates) | wired, **off** until Meta business verification + template approval |
| push     | Web push via PWA (P1)                                                          | later                                                               |

Adapters implement `send({ to, templateKey, locale, variables }) → { providerId }` with a fake adapter for tests.

## Templates

- Keyed by event (`order.confirmed`, `service.estimate_sent`, …) × channel × locale (`en`, `hi`).
- Admin-editable (rule 8) with preview + test-send; variables validated against a Zod schema per template.
- SMS: DLT template id stored per template; exact text must match the DLT-registered text.
- WhatsApp (research/whatsapp.md; **decided 2026-11-02: Meta Cloud API direct**, so this skill covers SMS/DLT; MSG91 WhatsApp only as a documented fallback):
  per-message pricing before GST — utility ≈ ₹0.115 (charged inside the 24 h window too since 1 Oct 2026),
  authentication ≈ ₹0.115, marketing ≈ ₹0.863; free-form replies free for the first 1,000/number/month.
  Marketing only with opt-in and via the Marketing Messages API (plain Cloud API marketing ends 13 Oct 2027).
- Transactional messages are always on; promotional respect `notification_preferences` and quiet hours (21:00–09:00 IST).

## Rules

- Never send from request handlers directly; never send for a rolled-back transaction.
- Never put PII beyond what the template needs; never log full message bodies with phone numbers.
- One message per event per channel (dedupe key). Hindi template chosen from the user's language.

## Tests (website-testing §D8, §K1)

Rollback → no outbox row; relay retry → no duplicate send (fake adapter counts); preference off suppresses promotional
not transactional; template variable validation; webhook signature + dedupe.

## Template CLI and approval gate (2026-11-16)

Templates are created from the repo with `pnpm wa:templates` (dry run default; `--submit --yes` only on the user's go-ahead, Q173; runbook `docs/runbooks/whatsapp-templates.md`). A new catalogue entry needs its `notify-templates/{en,hi}.json` text (en + hi) and a `META_TEMPLATE_COPY` entry. After `--status --save`, a WhatsApp event queues only while Meta approved the language of its enabled template.
