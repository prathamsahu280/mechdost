# Workshops, next tier (design)

Date: 2026-11-15 · Specs: 06, 07, 03 (payments), 14 · Decisions: gap list 2026-11-15; hourly slots + busy mode
(2026-10-31) · Depends on: home service and before/after photos (built first)

## Intent

Workshops should run their own listing and calendar, customers should be able to move a booking and pay the bill
online, and admin should get ranked suggestions when routing a request.

## Goals / non-goals / anti-goals

- Goals (build tasks in order): (1) **"My workshop"** self-edit: profile, hours, service menu (prices as low–high
  ranges), photos (pipeline from the photos design), busy mode; (2) **hourly slots with capacity**; (3) **acceptance
  timeout** for `awaiting_workshop` (back to routing, like shops); (4) **customer reschedule** before the vehicle is
  received; (5) **online payment of the service bill** (Razorpay, same payments code); (6) **staff cancel** of a request
  with a reason code; (7) **ranked workshop suggestions** for admin routing.
- Non-goals: technician-level calendars (per-bay), mechanic app, payouts (commission pending).
- Anti-goals: double-booked slots, a workshop changing a price after the customer approved the estimate, a reschedule
  that loses the history.

## Approaches

1. **Extend the service-request flow (chosen):** slots as a `workshop_slots` table with capacity and a conditional
   decrement (spec 06 rule), timeouts and reminders as pg-boss jobs like shop offers, bill payment through the existing
   Razorpay order/payment tables with a `service_bill` purpose.
2. Calendar integration (Google): heavy, needs accounts. Not chosen.

## Decided

- **Self-edit:** the workshop owner edits profile text (en + hi), hours, menu items and busy mode directly; changes are
  audited and visible immediately, except the location pin and GSTIN, which need staff re-verification (spec 07
  "verified" rule). Menu prices are ranges; estimates still set exact prices.
- **Slots:** hourly slots per day from the hours, capacity per hour (default 2, editable); the proposal picks a slot;
  capacity decremented atomically (CHECK ≥ 0); cancel/reschedule releases it.
- **Acceptance timeout:** setting `service.acceptance_timeout_min` (default 60); expiry sends the request back to
  routing with an event; the workshop's score counts it.
- **Reschedule:** customer proposes a new date/slot before `vehicle_received`; the workshop accepts or proposes another;
  history kept in `service_events`.
- **Online bill payment:** "Pay online" on the bill (Razorpay checkout like orders); refunds through the refunds queue
  (finance approval). "Paid at workshop" stays (workshop marks, customer confirms).
- **Staff cancel:** `service:cancel` permission, reason code, customer message, refund if paid.
- **Ranking:** distance, rating, acceptance rate, median time to propose, current load, busy mode excluded, paused
  excluded; shown with the reasons; one-click route.
- Every task: en + hi, analytics events, state-audit rows, notifications through the bell/push/email catalogues.

## Left to the builder

Slot generation (on demand vs nightly), ranking weights (start equal, admin-tunable later), exact copy.
