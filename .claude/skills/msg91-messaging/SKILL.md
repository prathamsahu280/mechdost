---
name: msg91-messaging
description: Use for MechDost notification work — in-app, email (Resend), SMS and WhatsApp (MSG91) templates, the transactional outbox and relay, DLT registration, delivery webhooks, user preferences, Hindi templates and notification tests. SMS/WhatsApp stay wired but disabled until the provider is set up (decision 2026-10-31).
---

# Messaging & notifications (MechDost)

Spec: `docs/specs/10-notifications.md`. Package: `packages/notify` (adapters + templates).

## Architecture (never bypass)

1. Business change and `notification_outbox` row(s) are written **in the same transaction** (repository helper).
   `dedupe_key = <event>:<entity_id>:<channel>` (UNIQUE) → at-least-once relay never double-sends.
2. Relay worker (pg-boss): claim `status='pending'` rows with `FOR UPDATE SKIP LOCKED`, render template
   (`notification_templates` by key/channel/locale), send through the channel adapter, store `provider_id`,
   mark `sent` / `failed` (attempts, backoff). Channel disabled or user opted out → `suppressed`.
3. Delivery webhooks (Resend, MSG91) update status; verify their signatures; dedupe by provider event id.

## Channels

| Channel  | Provider                                                                     | Status                                      |
| -------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| inapp    | `notifications` table + Supabase Realtime                                    | on                                          |
| email    | Resend (`RESEND_API_KEY`, verified domain, SPF/DKIM/DMARC)                   | on when key present (inbox Q7); else logged |
| sms      | MSG91 (DLT-registered templates, sender ID)                                  | wired, **off**                              |
| whatsapp | MSG91 WhatsApp (Meta-approved templates; utility category for order updates) | wired, **off**                              |
| push     | Web push via PWA (P1)                                                        | later                                       |

Adapters implement `send({ to, templateKey, locale, variables }) → { providerId }` with a fake adapter for tests.

## Templates

- Keyed by event (`order.confirmed`, `service.estimate_sent`, …) × channel × locale (`en`, `hi`).
- Admin-editable (rule 8) with preview + test-send; variables validated against a Zod schema per template.
- SMS: DLT template id stored per template; exact text must match the DLT-registered text.
- WhatsApp: utility templates for transactional updates (~₹0.12 each); marketing templates only with opt-in;
  free-form replies only inside the 24 h customer-service window.
- Transactional messages are always on; promotional respect `notification_preferences` and quiet hours (21:00–09:00 IST).

## Rules

- Never send from request handlers directly; never send for a rolled-back transaction.
- Never put PII beyond what the template needs; never log full message bodies with phone numbers.
- One message per event per channel (dedupe key). Hindi template chosen from the user's language.

## Tests (website-testing §D8, §K1)

Rollback → no outbox row; relay retry → no duplicate send (fake adapter counts); preference off suppresses promotional
not transactional; template variable validation; webhook signature + dedupe.
