# Coupon follow-ups (2026-11-16)

Goal: finish the four "Not built" coupon items (spec 03 § Built: coupons). One migration (`0073_coupon_offers_reports`),
no new tables for offers: an automatic offer is a coupon row with `auto_apply`, so counters, snapshot, allocation,
release, payouts and reports are the existing, tested pipeline.

## Rulings (recorded in docs/decisions.md 2026-11-16)

1. Public = admin flag `is_public` (never default); the public list shows only live, MechDost-funded or accepted offers, in the
   customer's city or every city, en + hi, end time in IST. No usage numbers are public.
2. Automatic offer = `auto_apply` coupon, MechDost-funded only (CHECK), its code is internal: typing it answers "not valid".
   Conditions: minimum order, first order only, category (discount only on that category's lines), city, window, limits.
3. Stacking: never. One discount per order. A typed code and the best automatic offer compete; the larger discount wins,
   a tie goes to the code the customer typed. The customer sees which one applied and what the other would have given.
4. Whole-order refund after delivery releases the use: when every sub-order of the group that is not cancelled/rejected has
   processed refunds of at least its total, the use goes back once (`released_at`). A partial refund keeps it.
5. Usage report counts uses = redemptions not released; shows released separately; unique customers = distinct user ids.

## Tasks (TDD, red first)

1. shared: `applyCoupon` category mask; DTOs (input flags, public offers, usage report, preview source); `coupon_usage` export dataset.
2. db: migration + schema; `listPublicOffers`; `couponUsageReport`; `releaseCouponIfOrderRefunded` wired in refunds `afterProcessed`;
   `evaluateAutoOffers` + best-of in `placeOrder` and `previewCoupon`; export dataset source.
3. api: `GET /v1/offers` (public, rate limited), `GET /admin/coupons/:id/usage`, `/admin/coupons` flags, checkout preview without code.
4. web: `/offers` server page + copy button, admin form flags + usage panel, checkout auto offer; locale en + hi; analytics events.
5. docs: specs 03/08/12/14, decisions, data model, progress, learnings, state-audit model rows.
