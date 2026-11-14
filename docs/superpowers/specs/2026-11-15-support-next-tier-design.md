# Support, next tier (design)

Date: 2026-11-15 · Specs: 09 (support), 05 (claims), 13 · Decisions: "Next tier answers" (chat customer ↔ MechDost
only), Q104 (COD refund destination on the ticket), labour promise "redo" kind (trust wording build)

## Intent

A new platform wins trust when problems get answered fast and in one place. Customers talk only to MechDost support;
support coordinates with shops and workshops.

## Goals / non-goals / anti-goals

- Goals (build tasks in order): (1) **order and request threads**: from an order or service request, the customer opens
  a conversation with MechDost support (a ticket linked to it), with quick issue codes (wrong part, damaged, missing,
  late, workshop issue, billing, other); (2) **photo attachments** (photos pipeline, private); (3) **COD refund
  destination** on the ticket (UPI/bank, encrypted; feeds the refund queue); (4) **inbox tools**: assignment, statuses,
  canned replies (admin-editable, en + hi), internal notes, SLA timers, customer name and order context in the inbox;
  (5) **auto-close** 7 days after "resolved" with no reply (setting); (6) **guest tickets** with reference + private key
  (Turnstile, rate limits); (7) **account deletion request** kind (support confirms, spec 01).
- Non-goals: customer ↔ shop/workshop direct chat (user ruling), WhatsApp inbox (Q98/Q63 pending), voice calls.
- Anti-goals: a partner's phone or the customer's phone shown to the other side through support, attachments readable
  by anyone with the URL, tickets lost between staff.

## Approaches

1. **Extend the existing tickets (chosen):** tickets already exist (spec 09, `support_tickets`, `ticket_messages`); add
   the linked entity, issue codes, attachments, assignment and canned replies.
2. A third-party helpdesk: data leaves India, cost, weak link to orders. Not chosen.

## Decided

- One open ticket per order/request per customer (a second "help" opens the existing one).
- Issue codes are enums (rule 16); free text only as the message.
- Attachments: up to 4 photos per message, 8 MB, EXIF stripped, private, served through the API with rights checks.
- Canned replies: stored per language, admin-editable, inserted then editable before sending.
- SLA: first reply target 2 working hours within support hours (admin setting, default 9 am–9 pm IST), shown to staff.
- Notifications: email + bell + push from the catalogues (`ticket_received`, `ticket_reply`, `ticket_resolved`).
- Every task: en + hi, analytics events, state-audit rows.

## Left to the builder

Inbox layout (list + thread), how SLA business hours are computed (IST, support hours setting), copy.
