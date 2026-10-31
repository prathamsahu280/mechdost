# E-commerce + booking baseline feature checklist — MechDost (Oct 2026)

Researched 2026-10-31 from Medusa and Saleor module docs, Dokan/WCFM multi-vendor docs, Magento, Shopify, OWASP ASVS/Auth0 and Indian regulatory sources. Priority: **P0** = launch, **P1** = within ~3 months (documented in full so any item can be pulled forward at any time), **P2** = later. Decisions on specific items are in `../decisions.md` (user walkthrough 2026-10-31); where a decision changed the default it is noted with ⟶.

## 1. Customer account
- Sign-up / login: phone OTP primary; email verified once ⟶ 3-screen signup (phone → OTP → name + email) — P0
- Profile edit: name, gender, DOB, avatar, preferred language (en/hi) — P0
- Phone/email change with re-verification: OTP to old and new; sensitive changes need recent re-auth (OWASP ASVS, https://github.com/OWASP/ASVS) — P0
- Address book CRUD: label (Home/Work/Garage), contact name/phone, pincode-driven city/state autofill, landmark, map pin for pickup/doorstep, default shipping/billing, soft-delete (snapshot kept on past orders) ⟶ pincode-first + "use my current location" GPS + full written address — P0
- Address serviceability check: pincode vs zones — P0
- My vehicles CRUD: make/model/variant/year/fuel, registration, VIN optional, odometer, primary vehicle drives fitment; service history and next-service reminder per vehicle — P0
- Vehicle lookup by registration number (Vahan) — P1
- Saved payment methods: network tokens via gateway only (RBI CoFT, https://razorpay.com/blog/card-tokenisation-all-you-need-to-know/); saved UPI ids — P1
- Wallet / store credit: balance, ledger, refunds-to-wallet, promo credits with expiry — P1
- Referral: code/link, reward on referee's first order — P1
- Wishlist: single list P0; multiple/shared lists + price-drop alerts P1
- Recently viewed (20–50) — P1
- Order history: status chips, filters (date, status, vehicle), search, detail timeline, reorder with stock/price re-check ⟶ filters + search included — P0
- Booking history: upcoming/past, reschedule, cancel within policy, job card view — P0
- Invoice download: GST invoice PDF per shipment/service, credit notes — P0
- Returns/claims self-serve: from order detail, reason, photos, pickup slot — P0
- Support tickets: linked to order/booking, quick issue picks, threads, attachments, status; grievance officer + 48 h acknowledgement (Consumer Protection E-Commerce Rules 2020) ⟶ WhatsApp handoff pending — P0
- Reviews & Q&A written: list, edit within window, delete — P1
- Notification preferences: per channel × category; transactional always on ⟶ in-app + email at launch, SMS/WhatsApp wired but off — P0
- Consent & privacy controls: per-purpose consent records with timestamp/version, withdraw, cookie banner (DPDP) — P0
- Data export (DPDP access) — P1
- Account deactivation (30-day undo) / deletion (anonymise orders for GST; blocked with open orders) ⟶ every deletion routed to support for final confirmation — P0
- Sessions/devices list with revoke; new-device alert — P1
- Customer 2FA — P2 · Communication log — P2 · Loyalty tiers — P2

## 2. Catalogue & discovery
- Category tree (N-level, slugs, images, SEO, order, hide-when-empty, archive) — P0
- Brands (logo, slug, featured, OEM/aftermarket flag) — P0
- Product types & attribute sets (typed, filterable/searchable/comparable flags, grouped spec sheet) — P0
- Variants (side, size, colour, pack) with per-variant SKU/price/stock/images/barcode/weight — P0
- Fitment (make/model/variant/year/engine/fuel) per SKU, "fits your vehicle" badge and filter, exceptions ⟶ vehicle master likely curated CSV (pending) — P0
- Part numbers: OE, manufacturer, cross-reference; searchable — P0
- Product content: title, rich description, bullets, spec table, warranty, HSN, GST rate, country of origin (mandatory), MRP vs selling price, seller name — P0
- Media: multiple images + alt, zoom (video P1, 360° P2) — P0
- Search: typo tolerance, synonyms (Hinglish), autocomplete, boosted fields, zero-result fallback, search by part/reg no. ⟶ Postgres FTS + trigram at launch, Meilisearch planned — P0
- Facets/filters (category, brand, price, fitment, rating, availability, seller, discount, attributes; URL-stateful) — P0
- Sort (relevance, price, newest, best-selling, rating, discount) — P0
- Pagination with page size + "load more" on mobile — P0
- SEO: slugs with redirects, canonical, meta templates, Product/Offer/AggregateRating/BreadcrumbList/FAQ JSON-LD, OpenGraph, hreflang en/hi — P0
- Out-of-stock: show with notify-me, hide (configurable), backorder with ETA — P0
- Back-in-stock / price-drop notify — P1
- Related / upsell / cross-sell; service add-ons ⟶ cart recommendation system P0 (rules + co-purchase) — P0/P1
- Compare (≤4) — P2 · Q&A — P1
- Reviews: verified purchase, stars + text (photos P1), helpful votes, partner reply, report ⟶ admin approves before publish with full edit/hide rights — P0
- Badges (bestseller, new, OEM genuine, low stock, fast delivery, free install) — P1
- Collections / landing pages — P1
- Workshop listing: map, rating, services, slots, distance — P0
- Service catalogue: services → packages → inclusions, duration, price by vehicle segment, labour vs parts — P0
- Price display: GST-inclusive, strike-through MRP, per-segment pricing; B2B price lists P1 — P0

## 3. Cart & checkout
- Guest cart + guest checkout (OTP at payment) — P0
- Cart merge on login — P0
- Qty limits (min/max/step, per-order caps) — P0
- Stock validation on add/view/place; reserve on payment start; release on timeout — P0
- Price-change notice — P0
- Fitment warning with override — P0
- Promotions: coupon vs automatic; percent/fixed; item/shipping/order targets; rules (group, category, brand, subtotal, first order, payment method, city); usage limits; stacking; schedule (Medusa Promotion, https://docs.medusajs.com/resources/commerce-modules/promotion/concepts) — P0 core; buy-X-get-Y, budgets P1
- Gift cards — P2 · Wallet redemption with cap — P1
- Shipping options (standard/express/pickup-at-workshop/install-at-workshop), zone-weight-price rates, ETA by pincode, free-shipping threshold, oversized/hazmat profiles — P0
- Click-and-collect — P1
- Service slot selection (capacity per workshop) ⟶ hourly arrival slots + busy mode — P0
- Address validation (pincode master, serviceability, phone, map pin) — P0
- COD rules ⟶ per-order cap (₹5,000 default per city), OTP confirm, optional fee, auto-off for RTO history, admin blocks, category exclusions — P0
- Payment methods: UPI, cards (tokenised), netbanking, wallets, COD, pay-at-workshop; retry; webhook-verified capture ⟶ exact mix at launch pending — P0; EMI/pay-later P1
- Order notes — P0
- GST invoice option (business GSTIN, legal name, billing address) — P0
- Tax calc: HSN rate, CGST/SGST vs IGST, tax-inclusive — P0
- Order review step; confirmation page + messages — P0
- Abandoned cart recovery — P1 · Express checkout — P2
- Multi-seller split ⟶ auto-split into per-shop sub-orders at checkout — P0

## 4. Orders & post-purchase
- Status axes: payment × fulfilment × order; booking states — P0
- Edit before confirmation (Medusa order edit) — P1
- Cancel: customer until packed, partial lines, reasons, auto-refund; seller cancel with penalty — P0
- Modify address/phone before dispatch — P0
- Reschedule/cancel booking within window — P0
- Tracking: courier (Shiprocket/Delhivery) AWB + webhooks; job progress with photos — P0
- Partial shipments — P0
- Returns: category eligibility, window, reasons, photos, QC, pickup, refund on receipt (Medusa Return) — P0
- Exchanges with price difference (Medusa Exchange) — P1 (⟶ possibly launch; pending)
- Claims: refund or replace for defective/wrong items — P0
- Refunds: full/partial, source or wallet, COD to UPI/bank, reason codes, approval threshold — P0
- Warranty replacements with workshop inspection — P1
- Invoices / credit notes (Rule 53 CGST), e-invoice IRN above threshold — P0 / P1
- Reorder — P0 · Rating prompt / NPS — P1 · Dispute with evidence — P1 (⟶ possibly launch; pending)
- Service job card: checklist, per-line approval, parts used, before/after photos, final bill, signature — P0
- Service reminders km/date, insurance/PUC — P1 (⟶ possibly launch; pending)
- Order chat with masked numbers — P1 (⟶ possibly launch; pending)

## 5. Seller/shop & workshop portal
- Onboarding/KYC ⟶ light KYC (GSTIN or declaration, PAN, bank, photos, location pin) + admin manual verification; penny-drop + e-sign P1 — P0
- Store profile (name, slug, logo, about, address + map, hours, policies, GST display, ratings) — P0
- Staff users & roles (owner + staff P0; granular P1)
- Product listing CRUD (draft/submitted/live/rejected, variants, images, fitment, OE numbers, HSN/GST, price, SKU, dims) — P0
- Bulk CSV import/export (template, validation report, partial success, price/stock-only update) — P0
- Map to platform SKU vs create new — P0
- Inventory (stocked/reserved/incoming, low-stock alerts, adjustments with reason) — P0; multi-location P1
- Pricing (selling, sale schedule) — P0; tiers/B2B P1
- Order management: alerts, accept/reject within SLA, pack, slip/label, ship (AWB), partial fulfil, cancel line, notes, filters, manual order — P0
- Returns handling (approve/reject, receive + QC, dispute) — P0
- Payouts & statements (sales, commission, TCS, TDS, refunds, penalties; schedule; statements) ⟶ commission model pending — P0
- Performance dashboard (defect rate, cancellations, late dispatch, ratings) — P1
- Holiday/busy mode — P0 · Notifications per event — P0 · Seller coupons — P1 · Reviews reply — P1 · Support tickets — P1
- Workshop service menu CRUD (packages, price by segment, duration, parts, add-ons) — P0
- Workshop slots/calendar (capacity, hours, blackout, buffer) — P0
- Workshop job cards (assign mechanic, checklist, photos, additional-work approval, parts consumption, final bill) — P0
- Pickup/drop management — P1 · Mechanic app view — P1 · Seller analytics — P1

## 6. Admin
- Dashboard (GMV, orders, bookings, AOV, refunds, approvals, SLA breaches, payouts due) — P0
- Entity conventions: list/search/filters/column chooser, create/edit, bulk actions, soft delete/archive + restore, hard-delete with confirmation, audit trail, CSV import/export, notes & tags — P0 (saved views, version history P1)
- Customers 360, block (incl. COD), notes — P0; impersonate (audited), merge, segments — P1
- Orders: global search, filters, timeline, edit, cancel, refund, reship, courier change, notes, tags, resend notifications, print, manual orders, fraud/RTO flags — P0
- Bookings calendar by city/workshop, reassign, override slot, cancel/refund — P0
- Returns/claims/disputes queue with SLA timers — P0
- Catalogue: seller product approval queue, master products, attributes, categories drag-drop, brands, fitment master, HSN/GST master, media library, duplicate detection — P0
- Sellers/workshops: KYC review, approve/suspend, commission rules, payout runs, penalties, scorecards, announcements — P0
- Promotions (coupons, automatic, campaigns, free-shipping rules, banners) — P0
- Content/CMS ⟶ complete control: banners with schedule/targeting, static pages, FAQ, menus, announcement bar, home section show/hide/reorder, every copy string — P0
- Reviews/Q&A moderation — P0
- Settings: store, GST/legal, tax, shipping zones, couriers, gateways, COD rules, windows, notification templates (DLT ids), roles & permissions, API keys, webhooks, feature flags, maintenance mode, locales — P0
- Staff management (invite, roles, scopes, 2FA enforcement, deactivate, sessions) — P0
- Exports/imports as async jobs with result files — P0
- Logs: audit, webhook delivery, notification, payment, security — P0
- Reports (sales, GSTR-1 ready tax, refunds, coupons, search terms, inventory, abandoned carts) — P1

## 7. RBAC & security
- Roles: super_admin, ops_manager, support_agent, finance, catalogue_manager, city_manager, marketing; seller_owner, seller_staff, workshop_owner, workshop_staff, mechanic; customer, guest — P0
- `resource:action` permissions, roles as bundles, least privilege (https://auth0.com/docs/manage-users/access-control/rbac) — P0
- Matrix: super_admin all · ops_manager orders/bookings RW+cancel+refund≤threshold, returns A, sellers R, workshops RW · support_agent customers R (masked), orders R + notes + resend + cancel pre-dispatch, tickets RW, refund request only, read-only impersonate (logged) · finance payouts RWA, refunds A, ledger/reports R · catalogue_manager products/categories/brands/attributes/fitment RW+approve, media RW · city_manager = ops_manager scoped to cities · marketing promotions/CMS RW · seller_owner own store/products/inventory/orders/returns, payouts R, staff RW · seller_staff subset, no payouts/bank/staff · workshop_owner services/slots/bookings/job cards/staff, payouts R · workshop_staff bookings/job cards RW · mechanic assigned job cards · customer own resources — P0
- Row-level scoping by tenant and city in a server-side policy layer (ASVS V8) — P0
- Field-level masking for support with logged reveal — P0
- Four-eyes approval above thresholds (refunds, wallet credits, payouts, commission changes) — P0
- Immediate revocation (short-lived tokens + server session check) — P0
- Immutable audit log (actor, IP, before/after, reason; ≥1 yr) — P0
- Session management (idle/absolute timeouts, server-side logout, device list, new-login alert) — P0
- Staff 2FA (TOTP) ⟶ built now, enforced once staff beyond founders are added; partners P1 — P0
- Rate limiting & abuse (OTP per phone/IP/device, login, coupons, API quotas, CAPTCHA/Turnstile, bot protection) ⟶ expanded in `specs/security-abuse.md` — P0
- Secure defaults (deny-by-default, CSRF, CSP, HSTS, validation, HMAC-signed webhooks, secrets vault, dependency scanning) — P0
- PCI: gateway-hosted fields/tokens only — P0
- Fraud controls (velocity, RTO score, COD block list, device fingerprint) — P1
- Admin hardening (separate hostname, IP allowlist optional) — P1

## 8. Platform basics
- INR paise integers — P0 · i18n ⟶ English + Hindi at launch; Hinglish synonyms; Hindi templates — P0 · UTC storage, IST display — P0
- Messaging: email, DLT SMS, WhatsApp templates, push; template manager with preview/test; delivery logs — P0
- Event catalogue (order.*, payment.*, return.*, booking.*, product.*, payout.*, kyc.*) — P0
- Outbound webhooks (HMAC, retries, DLQ, replay) — P1 · Inbound webhooks (gateway, courier, WhatsApp) — P0
- Cron jobs (reservation expiry, abandoned cart, payouts, reminders, sitemap, price activation, reindex, retention purge) — P0
- Job queue with retry + idempotency keys — P0 · Feature flags (env, %, city/role, kill switches) — P0
- Backups & DR (daily snapshots, PITR, storage versioning, restore drill) — P0
- DPDP requests (access, correction, erasure, nomination), grievance officer, consent records, retention, breach runbook — P0 (self-serve export P1)
- Legal pages (T&C, privacy, refund/cancellation, shipping, grievance officer, seller policies, country of origin) — P0
- Status page — P1 · Error pages (404 with search, 500, 403, offline) — P0 · Maintenance mode — P0 · Sitemaps + robots — P0
- Performance (image CDN, caching, CWV budgets) — P0 · Observability (logs, tracing, errors, alerts) — P0
- Analytics events ⟶ first-party `events` store + self-hosted PostHog; events: page_view, search, select_vehicle, view_item_list, select_item, view_item, add_to_wishlist, add_to_cart, remove_from_cart, view_cart, begin_checkout, add_shipping_info, add_payment_info, apply_coupon, purchase, refund, booking_started, slot_selected, booking_confirmed, booking_rescheduled, booking_cancelled, job_card_approved, review_submitted, sign_up, login, otp_failed, address_added, vehicle_added, notify_me_clicked, support_ticket_created, seller_product_submitted, seller_order_accepted, plus every click/partner action; server-side purchase; UTM; consent-gated — P0
- Partner PWA for mechanics — P1 · API docs & sandbox — P2
