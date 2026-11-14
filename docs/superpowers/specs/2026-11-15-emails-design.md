# Transactional emails (design)

Date: 2026-11-15 · Specs: 10 (notifications), 05, 06, 09, 19, 20 · Decisions: "2026-11-13 — Email sender addresses",
"2026-11-15 — Launch features round" item 3

## Intent

Customers of a brand-new platform need a written record of every step: what they ordered, who confirmed it, when it
arrives, what a workshop proposes, and where their refund is. Today only two emails exist (`partner_invite`,
`quote_offer` in `packages/shared/src/email-templates.ts`). User: "create however many u want via resend".

## Goals / non-goals / anti-goals

- Goals: one email per customer-visible milestone, en + hi, sent through the existing outbox → dispatcher → Resend
  adapter, sender by purpose (updates / billing / support / promotions / noreply), admin-editable text.
- Non-goals: promotional campaigns (needs the promotions consent and a campaign tool, later); GST invoice PDFs (Q97);
  SMS.
- Anti-goals: an email on a rolled-back change; duplicates on relay retry; an email to an unverified address when the
  setting says verified only; personal data of one party leaking to another (shop never gets customer email).

## Approaches

1. **Code defaults + admin text overrides (chosen by the user 2026-11-15: "Edit text, keep layout"):** each template is a
   typed definition in code (en + hi defaults, allowed placeholders, purpose, category transactional/promotional) rendered
   into one fixed MechDost HTML + plain-text layout. Admin can override subject, heading, body text and button label per
   language in `notification_templates`, preview with sample data, send a test to themselves, reset to default.
   Placeholders are a closed list per template (`{orderCode}`, `{shopArea}`, …), escaped; no raw HTML.
2. Fixed in code, on/off only: simplest, breaks rule 8. Not chosen.
3. Full HTML editor: most control, easy to break rendering and deliverability. Not chosen.

## Catalogue (launch)

Customer (purpose):

- `order_placed` (updates): items, total, payment method, "we are confirming with a seller".
- `order_confirmed` (updates): "Confirmed, will be shipped" + shop area (not shop phone).
- `order_out_for_delivery` (updates): with the delivery code and the "share it only at the door" warning.
- `order_delivered` (updates): thanks + review link.
- `order_cancelled` / `order_rejected` (updates): reason in plain words + refund note (never "refunded" before it is).
- `payment_received` (billing): amount, method, Razorpay payment id.
- `refund_requested`, `refund_processed`, `refund_failed` (billing): honest timeline (approval, then 5–7 working days).
- `service_request_received`, `service_proposed` (action: review slot and cost), `service_confirmed`,
  `service_estimate_ready` (action: approve lines), `service_ready`, `service_bill_ready` (billing), `service_completed`
  (+ review link).
- `quote_offer` (exists), `quote_expiring` (updates, 24 h before validity ends).
- `ticket_received`, `ticket_reply`, `ticket_resolved` (support).
- `coins_expiring` (updates, only if the coins reminder job exists; else skip and note).

Partner:

- `partner_invite` (exists), `application_received`, `application_approved`, `application_rejected` (system).
- `shop_order_routed` (updates, email fallback to push/bell; the WhatsApp alert is item 6, tomorrow).
- `partner_warning_issued` (system): reason, count in window, calm wording (no threat).

Staff: no emails (bell + push only).

## Decided

- Language: the recipient's preferred language (account profile), else the site language at the time of the action.
- Every email has a plain-text part, the MechDost footer (company, support phone, grievance contact once set), and for
  promotional category only an unsubscribe link (none at launch).
- Sending only to verified emails when `customers.require_verified_email` is on; otherwise to the stored email.
- Outbox rows written in the same transaction as the state change, dedupe key `{template}:{entity}:{version}`.
- Admin → Notifications gains an Emails tab: list, edit text per language with live preview, test send, reset; edits
  audited; template on/off switch per template (transactional ones warn before turning off).
- Analytics: `email_sent {template, locale}`, `email_failed {template, code}` server events; no addresses in events.
- Resend webhooks for bounces/complaints → mark the address undeliverable (later if not trivial; note it).

## Left to the builder

Layout HTML (table-based, inline styles, dark-mode-safe, brand tokens), template registry shape, preview sample data,
where each outbox write lives (inside the repos that change state), test fixtures.
