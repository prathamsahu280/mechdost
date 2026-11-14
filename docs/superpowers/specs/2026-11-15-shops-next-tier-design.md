# Shop portal, next tier (design)

Date: 2026-11-15 · Specs: 07, 04, 08, 13 · Decisions: gap list 2026-11-15, "Next tier answers" (payouts later),
own delivery only (2026-11-14) · Input: `docs/qa/vendor-portal-assessment-2026-11-15.md`

## Intent

Shops need to run their day from a phone: confirm fast, never miss an offer, keep stock right, add helpers, and see
how they are doing.

## Goals / non-goals / anti-goals

- Goals (build tasks in order): (1) **portal polish** from the vendor assessment (expired-offer state, success feedback,
  persisted delivery-code lock with support link, empty states with one action, live offers — the live ping is done in
  the bell/push build); (2) **busy / closed-today toggle** (`busy`, `busy_until`; routing skips busy shops); (3) **shop
  staff** (owner invites staff by phone, roles owner/staff, removing access); (4) **stock and price CSV upload** with a
  preview and per-row errors (price changes still go through price requests); (5) **packing slip** (printable, no
  prices for the customer copy; GST invoice waits on Q97); (6) **performance** (acceptance rate, median time to accept,
  give-ups, on-time hand-over, ratings) with the city median; (7) **public application status lookup** (reference +
  phone OTP).
- Non-goals: payouts and statements ("decide later"), courier hand-over (own delivery only), shop-created coupons
  (admin creates all coupons).
- Anti-goals: staff seeing money they should not (staff do not see payouts/performance money), a CSV import that
  half-applies, a busy shop still receiving offers.

## Approaches

1. **Portal screens over the existing shop repos (chosen)**, CSV parsed server-side in one transaction (all-or-nothing),
   staff via the existing `shop_users` + `user_roles` with an invite like partner invites.
2. Separate seller app: later (mobile app phase).

## Decided

- **Busy:** owner toggles "Closed today" (until midnight IST) or "Busy for N hours"; routing and suggestions exclude it;
  admin sees it; audited.
- **Staff:** owner invites by phone (+ name), the invitee signs in with OTP and gets `seller_staff` for that shop; owner
  removes access (sessions refreshed); max 10 people per shop.
- **CSV:** columns sku, stock, active (and requested price, which creates price requests); preview shows changes and
  errors; apply is one transaction; template download; max 2,000 rows.
- **Packing slip:** order code, items, quantities, delivery PIN/area, customer first name and masked phone (Q99 pending:
  masked by default), QR of the order code; printable A5; en + hi.
- **Performance:** last 30/90 days; owner only.
- **Status lookup:** `/partners/status` with reference + phone OTP, shows the application stage only.
- Every task: en + hi, analytics events, state-audit rows (API-mode chunk G), notifications via the catalogues.

## Left to the builder

CSV parser choice (small, release-age checked, or hand-written), slip layout, chart choices.
