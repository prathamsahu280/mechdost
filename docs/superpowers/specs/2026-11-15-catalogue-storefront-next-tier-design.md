# Catalogue and storefront, next tier (design)

Date: 2026-11-15 · Specs: 02, 03, 11, 20, 12, 01 · Decisions: "Next tier answers" (coupons both funders, admin-only;
product photos admin by default with settings for shop uploads) · Research: `research/promotions-referrals.md` (CCPA
price display), market scan P1 list

## Intent

Make the catalogue look real and the store convert: real product photos, fair offers, sensible suggestions, a cart
that follows the customer, and the privacy controls the law asks for.

## Goals / non-goals / anti-goals

- Goals (build tasks in order): (1) **product photos** (admin upload; settings: shops may add photos for products they
  sell — on/off — shown after catalogue approval; photos pipeline, variants + LQIP); (2) **coupons** (MechDost-funded and
  shop-funded, admin creates all); (3) **server cart + merge at sign-in**; (4) **recommendations** ("goes well with" by
  rules, then co-purchase); (5) **wishlist**; (6) **privacy settings** (consents per purpose, account deletion request
  via support, data download request); (7) **"notify me" for an unserviceable PIN** (demand capture per spec 15).
- Non-goals: referrals and loyalty tiers (Q35–Q47 pending), BNPL, Meilisearch (planned later).
- Anti-goals: fake discounts (CCPA: show the real previous price only if it was the price), coupon stacking that breaks
  the totals, a shop-funded coupon the shop never agreed to, photos with EXIF location.

## Approaches

1. **Server-side pricing owns coupons (chosen):** a coupon is validated and applied in the same checkout pricing path
   that already handles coins and the COD cap, so totals stay consistent; funder recorded per order line.
2. Client-side coupon maths: rejected (integrity rules).

## Decided

- **Coupons:** types percent (with cap), flat, free delivery; min order; start/end (IST); total and per-user limits;
  first-order only; city scope; funder `mechdost|shop` (shop-funded only for that shop's lines, the shop must have
  accepted the offer terms in its portal before it goes live); one coupon per order; coins after coupon; the order
  stores the coupon snapshot; redemption counted with a conditional UPDATE (no oversell); refunds return the usage only
  if the whole order is refunded (rule recorded). Admin creates/edits/pauses; analytics events.
- **Photos:** max 8 per product, ordered, alt text en + hi required, variants 320/640/1600 WebP + LQIP, served through
  `next/image`; setting `catalogue.shop_photo_uploads` (default off) and approval queue.
- **Server cart:** `carts` + `cart_items` per user; guest cart stays in the browser and merges at sign-in (max quantity
  rules, prices re-validated); the demo cart remains for demo builds.
- **Recommendations:** admin rules per category ("oil → oil filter"), then co-purchase counts from delivered orders
  (nightly), never personal data; shown on the product page and cart (Server Component).
- **Wishlist:** per user, max 100, "notify on price drop" later.
- **Privacy:** Account → Privacy shows consents with dates and withdraw buttons; deletion request opens a support ticket
  kind; data download request (job, private link).
- **Notify me:** PIN + phone/email (verified account only, per the anti-relay rule), counted per PIN for the city
  launch checklist.
- Every task: en + hi, analytics events, state-audit rows, JS budget kept (product page < 180 KB gz).

## Left to the builder

Table shapes, the recommendation job, photo editor UI, copy.
