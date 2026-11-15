# MechDost — Production Build Plan

> Rebuild the MechDost concept preview (https://automart-concept-preview.aliveamber4.chatgpt.site) as a real, fast, bug-free, multi-role platform: Customer storefront + service booking, Shop/Seller portal, Workshop/Service-centre portal, and an Admin operations console with strong analytics. Launch city: Raipur (Chhattisgarh). Architecture must scale to multiple cities/districts/states and a later mobile app.

## 1. Context

- Project folder `C:\Users\Admin\Desktop\automart` is **empty** (greenfield, no git yet).
- The concept site is a static HTML/CSS/JS prototype (brand **MechDost**, legal entity Shourya Integrated Services Pvt Ltd, support phone 7978776551, GSTIN 22ABVCS4888H1ZL, address C-605 Salasar Greens, Sarona, Tatibandh, Raipur 492099) with a partially-built backend (`/api/*`, `/admin`, `/account`, `/support.html`, `/products/{id}`). I pulled every asset (HTML, 8 CSS files, 289 KB runtime JS bundling 20 modules, admin/member scripts, product pages, catalog API) into the scratchpad and inventoried it exhaustively. Summary in Appendix A; full inventories are saved for the build in the scratchpad task outputs and will be copied to `docs/concept-inventory/` on day one.
- User decisions (confirmed):
  - **Brand stays MechDost**; same design, section names and copy.
  - **Stack**: Next.js frontend; Supabase Postgres; **Firebase Auth**; a real separate backend/API; must be very fast; mobile app later (shared API/types matter).
  - **Login**: **phone OTP is the primary sign-in** for everyone. Email is collected at signup and verified once (link) — used for receipts, invoices, recovery; not required at every login. Both phone and email must be verified before a user can place an order / book a service / act as a partner.
  - **Scope**: core modules first, then the extra modules (Vehicle Discovery, Mechanic Academy, Product Lens, Roadside/Pickup, Mechanic directory) in later phases of the same build.
  - **Skills to install first**: `ui-ux-pro-max` (nextlevelbuilder/ui-ux-pro-max-skill) and the "superpowers" skill set (obra/superpowers — closest match to "ux superpower"; will confirm with user if a different repo was meant).
- Chrome extension was not connected; site analysed from source. Playwright is installed in Step 0 for visual regression against the concept.

## 2. Stack (decided)

| Layer         | Choice                                                                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | **Next.js 15 (App Router, React 19, Turbopack)**, Vercel region `bom1` (Mumbai)                                                                                                                                                                                                                                                                                           | RSC + streaming = fastest first paint for a catalogue; ISR for product/workshop pages; `next/image`; PWA manifest for "add to home screen".                                                                                                          |
| API           | **Hono (TypeScript) on Node 22** in `apps/api`, deployed to Google Cloud Run `asia-south1` (Mumbai) (Fly.io `bom` as alternative)                                                                                                                                                                                                                                         | Among the fastest Node routers; OpenAPI via `@hono/zod-openapi` (auto docs + typed client); same API will serve the mobile app. Rejected: NestJS (heavier, slower cold start), Next route-handlers-only (couples API to web deploy, bad for mobile). |
| DB            | **Supabase Postgres (`ap-south-1`)** + **Drizzle ORM** + **PostGIS**                                                                                                                                                                                                                                                                                                      | Typed SQL, migrations in repo, `ST_DWithin` for nearby workshops, Supabase Realtime for live order/booking updates, Supabase Storage for photos.                                                                                                     |
| Auth          | **Firebase Authentication**: Phone OTP (primary) + Email link verification; `firebase-admin` verifies ID tokens in the API; custom claims `{role, partner_id, city_ids}`; Supabase configured with Firebase as third-party JWT issuer so RLS works for Realtime channels                                                                                                  | User's choice. Dev: Firebase Auth Emulator with fixed test OTP `123456`.                                                                                                                                                                             |
| Cache / jobs  | **Upstash Redis** (OTP + API rate limits, hot catalogue cache); **pg-boss** (Postgres-backed jobs: shop-acceptance timeouts, notification fan-out, reminders, daily analytics rollups)                                                                                                                                                                                    | No extra infra for jobs.                                                                                                                                                                                                                             |
| Notifications | Provider interface with adapters: in-app (Realtime) + **Email (Resend)** in phase 1; **WhatsApp Business API (Gupshup/Interakt) + SMS (MSG91)** in phase 3                                                                                                                                                                                                                | Admin/shops get real-time bells; customers get email + WhatsApp.                                                                                                                                                                                     |
| Payments      | **Razorpay** (Standard checkout, webhooks, refunds API) + COD                                                                                                                                                                                                                                                                                                             | Concept already references Razorpay.                                                                                                                                                                                                                 |
| Maps          | **MapLibre GL JS + free vector tiles (MapTiler free tier / Protomaps; OSM raster fallback)**, custom MechDost style (navy/orange, Devanagari glyphs), clustering, smooth fly-to, locate-me control, workshop popups, behind a map adapter. Geocoding/autocomplete/routing provider chosen by a Raipur bake-off (Google Places vs Ola Maps; OSRM/Ola routing) — pending #7 | User decision 2026-10-31: free, but must be fully functional and polished.                                                                                                                                                                           |
| Charts        | **Recharts** + custom KPI tiles + MapLibre heat layer                                                                                                                                                                                                                                                                                                                     | Calm visuals matching design.                                                                                                                                                                                                                        |
| Monorepo      | **Turborepo + pnpm**                                                                                                                                                                                                                                                                                                                                                      | Shared packages reused by React Native later.                                                                                                                                                                                                        |
| Quality       | TS strict, ESLint, Vitest, Playwright (e2e + visual snapshots), Zod at every boundary, Sentry, Lighthouse CI (≥90 perf/a11y)                                                                                                                                                                                                                                              | "Bug-free and glitch-free".                                                                                                                                                                                                                          |

## 3. Repo layout

```
automart/
  apps/web          Next.js: storefront, /account, /partner/shop, /partner/workshop, /admin
  apps/api          Hono API (REST + OpenAPI), pg-boss workers, webhooks
  packages/db       Drizzle schema, migrations, seed (Raipur demo: 40 products, 6 shops, 8 workshops, pincodes)
  packages/shared   zod DTOs, enums + state machines, money (paise), IST date utils, copy strings (en + hi later)
  packages/ui       tokens.css (from concept), primitives: Button, Card, Badge, Dialog, Toast, Stepper, Progress, DataTable, EmptyState
  packages/notify   channel adapters (inapp, email, whatsapp, sms) + templates
  docs/             concept-inventory/, feature-research.md, ADRs, runbooks
```

## 4. Design system (lifted from the concept CSS; non-negotiable)

- Fonts: **Manrope** (headings, 800) + **DM Sans** (body). Eyebrows 9–10px uppercase, letter-spacing 1.5–2px.
- Tokens: `--navy #101f34`, accent `#ea5728` (buttons `#e65325`), accent light `#ff8b59` / `#ffb99c`, `--line #e4e8ee`, `--muted #657487`, bg `#f7f8fa`, cards white, nav-current `#fff0e9` / `#bf3c12`, success tag `#e8f5ed` / `#14683c`, private-note amber `#fff5e9` / `#785128`, error `#b42318`.
- Radii: hero 24px, cards 14–16px, buttons 9px, dialogs 18px. Shadows `0 4px 16px #101f3405`; hover lift `translateY(-4px)`.
- Chrome: announcement bar; sticky white header (brand `m↗ MechDost · YOUR AUTOMOTIVE CONNECTION`; nav Home · Shop Products · Find Workshops · My Vehicles; "Account" button; Cart pill with count); **mobile bottom tab bar** (Home / Shop / Find Workshops / My Vehicles) under 760px; shared dialog + bottom toast pattern; 5% gutters, max 1600px.
- Admin/partner: dark navy sidebar `#14263e` (active `#263d58` + orange left border), light page `#f4f6f9`, white 14px panels, 3-up stat cards (34px numbers), amber "private note" callouts.
- Keep concept copy (eyebrows "FOR EVERY DRIVE. EVERY RIDE.", "Know the work. Approve the cost.", "A nearby workshop. A clear estimate.", hub promise strip, policy text, etc.). Drop only prototype disclaimers ("Preview only", "No real payments", "demo").
- Calm UX rules: one primary action per screen; progressive disclosure (details/accordions as in concept); 3-step checkout; status always shown as a stepper with plain-English labels; empty states with a single next action; no modals stacked on modals.

## 5. Roles, auth and accounts

| Role                  | How created                                                                                            | Sign-in                                        | Portal                        |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------- |
| customer              | self-signup                                                                                            | phone OTP; email verified once                 | `/account`                    |
| seller (shop)         | admin approves a Seller application → creates `shops` row + invites owner phone                        | phone OTP + email verified; claim `partner_id` | `/partner/shop`               |
| workshop              | admin approves a Garage application → `workshops` row + invite                                         | same                                           | `/partner/workshop`           |
| mechanic              | admin approves Mechanic application (phase 4 portal)                                                   | same                                           | `/partner/mechanic` (phase 4) |
| admin / ops / support | seeded allowlist in `staff` table (email+phone), roles `admin`, `ops`, `support`, scoped to `city_ids` | phone OTP + email verified + staff allowlist   | `/admin`                      |

- Signup flow (calm, 3 screens): phone → OTP → name + email (+ vehicle optional) → "Verify your email" banner until the link is clicked. Browsing and cart never require login; login is requested at checkout / booking.
- API: `Authorization: Bearer <firebase id token>` → middleware resolves `users` row (auto-provision on first call) and role claims. Partners' users can have multiple staff logins per shop/workshop (`shop_users`, `workshop_users` with roles owner/staff).
- Rate limits (Upstash): OTP send 5/phone/hour; API 120 req/min/user.

## 6. Domain model (Drizzle, Postgres)

Geography: `states`, `cities` (status live/coming_soon, default Raipur), `zones` (service areas, optional), `pincodes` (pincode → city, lat/lng centroid), `serviceability` is derived: a pincode is serviceable for shop delivery if any active shop covers it; for workshops if any published workshop is within `city.radius_km`.

People: `users` (firebase_uid, name, phone, phone_verified_at, email, email_verified_at, role), `addresses`, `vehicles` (type 2W/4W, fuel, make, model, variant, registration, year, odometer, last_service), `vehicle_history`, `reminders`, `staff`.

Catalogue: `categories` (9 from concept), `brands`, `products` (sku, name, spec, compatibility text, hsn, gst_rate, mrp_paise, published), `product_photos`, `product_fitments` (vehicle_type/make/model/year ranges — powers "fits my vehicle"), `shops` (name, legal, gstin, address, lat/lng, city_id, status, acceptance_sla_minutes, rating), `shop_users`, `shop_pincodes` (coverage + shipping_paise + lead_days), `shop_inventory` (shop×product: selling_paise, stock, active) — replaces the concept's admin-only "PIN-code offers".

Orders: `orders` (code `MD-XXXXXX`, user, address snapshot, city, pincode, payment_method, payment_status, status, subtotal/shipping/discount/total paise, customer_note), `order_items` (product snapshot, qty, unit_paise, gst), `order_assignments` (order×shop: status offered/accepted/declined/expired/withdrawn, offered_by staff, expires_at, declined_reason), `order_events` (timeline, actor, visible_to_customer), `shipments` (mode own/courier, courier, awb, status, proof), `invoices` (number series per city/FY, pdf), `payments` (razorpay ids, status), `refunds` (amount, mode, status, razorpay_refund_id), `order_cancellations` (who, reason, stage), `returns` (type return/replacement, reason, photos, status, pickup, qc_result, resolution).

Service: `workshops` (name, owner, address, lat/lng PostGIS point, city, pincode, vehicle_types, ev_basic, pickup, hours, published, location_verified, verification_method/notes/at/by, owner_consent, rating), `workshop_users`, `workshop_services` (menu: title, description, inclusions, exclusions, low/high paise, duration, active), `workshop_photos`, `service_requests` (code `SR-XXXXXX`, user, vehicle snapshot, location point + pincode, category, concern, preferred_date, slot, pickup_requested, status, workshop_id nullable, routing_mode customer_pick/admin_route), `service_assignments` (same shape as order_assignments), `service_proposals` (slot, scope, low/high), `estimates` + `estimate_items` (qty, unit_paise, gst, decision approved/declined, version), `service_events`, `service_bills` (final itemised bill from approved items, pdf), payments/refunds reused.

Support & partners: `support_tickets` (code `REQ-…`, kind, order/service ref, status, priority, assignee), `ticket_messages` (author role, body, attachments, internal flag), `partner_applications` (seller/garage/mechanic, fields from concept form, status new/in_review/approved/rejected, converted_id), `mechanics` (profile; phase 4).

Platform: `notifications` (user, title, body, link, read_at), `notification_outbox` (channel, to, template, payload, status, provider_id), `reviews` (order/service, stars, text, reply), `audit_log`, `settings` (per city: acceptance timeout, cancel window, return window, COD limit, service radius), `content_blocks` (policies, FAQ, banners), `coupons` (phase 3).

All money in paise (bigint). All timestamps timestamptz, rendered IST. Every mutable row has `version` for optimistic locking (concept already does this).

## 7. Core workflows (state machines live in `packages/shared/state`)

### 7.1 Product order → admin routing → shop accept/deny

```
placed ──(admin routes)──▶ awaiting_shop ──(shop accepts)──▶ confirmed ──▶ packed ──▶ shipped ──▶ out_for_delivery ──▶ delivered
   │                            │ (shop declines / timeout)                                                            │
   │                            ▼                                                                                      ▼ (within return window)
   │                      needs_rerouting ──(admin reroutes)──▶ awaiting_shop                                    return_requested → … (7.3)
   │                            │ (admin rejects)
   └──(admin/customer cancel)──▶ cancelled / rejected  (auto-refund if prepaid)
```

- **Placing**: customer picks address (Raipur pincode check), items re-priced server-side from `shop_inventory` across shops covering the pincode (lowest price with stock; shows "Delivery ₹x · 2 days"), pays online (Razorpay) or COD. Order lands in admin **"Needs routing"** queue; customer sees "Order placed · we are confirming with a seller".
- **Routing (admin)**: order card shows eligible shops ranked (all items in stock → distance → acceptance rate → price); admin picks one (or "Route to recommended"). If no single shop has everything: split into sub-orders (`orders.parent_id`) — phase 2; phase 1 shows a warning and allows partial routing + partial cancel with refund.
- **Shop side**: real-time card with countdown (`settings.acceptance_timeout_min`, default 30) and big **Accept** / **Decline (reason)** buttons; timeout → `expired` → back to admin queue, admin notified. Accept → `confirmed` → customer + admin notified "Order confirmed, will be shipped by {shop city}"; stock decremented.
- **Decline/reroute**: assignment history kept; admin may reroute to another shop or **Reject** with a canned, editable customer message ("We're sorry — this item can't be fulfilled right now in Raipur; any payment is refunded within 5–7 days."). Prepaid → automatic Razorpay refund row.
- **Fulfilment**: shop marks packed → shipped (own delivery or courier + AWB) → delivered (optional OTP/photo). Customer **Tracking** page = stepper + events + AWB link.
- **Cancellation**: customer self-cancel until `packed` (configurable); later = request → admin decides; refund auto for prepaid; stock restored.

### 7.2 Service request → nearby workshops → proposal → estimate → work → bill

```
requested ──(customer chose workshop)──▶ awaiting_workshop ──(workshop proposes slot+range)──▶ proposed ──(customer accepts)──▶ confirmed
    │ (let MechDost choose) ──▶ needs_routing (admin) ──▶ awaiting_workshop
    │                                       (workshop declines/timeout → needs_routing)
confirmed ──▶ vehicle_received (odometer) ──▶ estimate_sent ──(customer approves lines)──▶ approved ──▶ in_progress ──▶ ready ──▶ billed ──▶ paid ──▶ completed
cancelled (customer, before in_progress) · declined (workshop) · rejected (admin)
```

- **Location-first**: "Find a workshop" asks **Where is the vehicle?** (use my location / saved address / pincode) → vehicle → concern/category → preferred date + slot → list of workshops within radius sorted by distance with rating, verified badge, services, hours, "Pickup available"; map alongside (concept hub layout). Customer picks a workshop **or** "Let MechDost pick" (admin-routed).
- Workshop portal: request card → **Propose slot & expected expense** (slot, scope, low–high) or Decline (reason). Customer accepts → confirmed; reminders day-before.
- Estimate: line items (qty, unit, GST), customer approves/declines **per line** with consent checkbox (concept flow kept); revisions create new versions and clear approval; only approved lines can be worked and billed. Final bill PDF; pay online or "Paid at workshop" (workshop marks, customer confirms).
- Reschedule (either side, before vehicle received), cancel, dispute → support ticket linked to SR.

### 7.3 Cancellations, returns, refunds, replacements

- Policy settings per city: cancel window stage, return window days (default 7), non-returnable categories (lubricants opened, batteries installed), replacement-only categories.
- Return/replacement request (customer, from order page): reason + up to 4 photos → `requested` → admin/shop review (48h SLA) → `approved` (reverse pickup scheduled by shop/courier) / `rejected` (reason) → `received` → `qc_passed`/`qc_failed` → refund (Razorpay / bank / COD-refund via UPI id collected) or replacement sub-order auto-routed to same shop.
- Refund ledger with status timeline; customer sees "Refund initiated · ref …".

### 7.4 Support

- Ticket from account (prefilled with order/SR), guest form (concept's reference + private key kept for guests), WhatsApp deep link. Admin inbox with statuses `open / in_review / awaiting_customer / resolved / closed`, canned replies, internal notes, SLA timers, assignment. Customer sees thread in account and gets notifications.

### 7.5 Partner onboarding

- Public forms from concept ("Apply as a seller / workshop / mechanic") → `partner_applications` → admin review (checklist: GST, address, photos, location pin verification as in concept's workshop editor) → **Approve** creates shop/workshop + invites owner by phone → owner completes profile (coverage pincodes, inventory upload CSV, service menu, hours) → admin **Publish**.

### 7.6 Notifications matrix (phase 1 channels: in-app + email; phase 3 adds WhatsApp/SMS)

| Event                   | Customer                       | Shop/Workshop | Admin     |
| ----------------------- | ------------------------------ | ------------- | --------- |
| Order placed            | ✔                              | –             | ✔ queue   |
| Routed to shop          | –                              | ✔ (timer)     | –         |
| Accepted                | ✔ "confirmed, will be shipped" | ✔             | ✔         |
| Declined / expired      | –                              | –             | ✔ reroute |
| Rejected                | ✔ custom message + refund      | –             | –         |
| Shipped / delivered     | ✔                              | –             | –         |
| SR proposal / estimate  | ✔ act now                      | –             | –         |
| Return / refund updates | ✔                              | ✔             | ✔         |
| Support reply           | ✔                              | –             | –         |

## 8. Admin console (`/admin`) — analytics-first

- **Overview**: KPI tiles (orders today, GMV, AOV, pending routing, avg time-to-accept, acceptance rate, cancellation %, refunds ₹, active SRs, open tickets, NPS/avg rating); charts: orders & GMV trend (daily/weekly), order status funnel, category mix, service categories mix, orders by hour; map: orders & workshops by pincode heat; leaderboards: shops by acceptance rate/fulfilment time, workshops by rating/completion; alerts list (expiring assignments, SLA breaches, low stock).
- **Queues**: Needs routing · Awaiting shop (timers) · Needs rerouting · Returns to review · Refunds pending · SR needs routing · Tickets.
- **Orders**: table (filters: status/city/shop/date/payment), order detail with timeline, route/reroute/reject, refund, notes, invoice.
- **Service requests**: same pattern + map.
- **Catalogue**: products & photos, CSV import (keep concept importer UX), categories/brands, fitments.
- **Partners**: shops, workshops (keep concept workshop editor incl. coordinate-from-link parser + verification checklist), applications, mechanics.
- **Customers**: list, detail (orders, vehicles, tickets), block.
- **Content & settings**: cities (launch/toggle), pincodes import, policies/FAQ/banners, timeouts/windows, staff & roles, notification templates, audit log, exports (CSV, keep concept's export list), backups.

## 9. Shop portal (`/partner/shop`) and Workshop portal (`/partner/workshop`)

- Shop: live order feed with accept/decline + timer; order detail → pack/ship (courier/AWB)/deliver; inventory (per product price/stock/active, CSV upload, low-stock alerts); coverage pincodes; payouts view (orders delivered, commission, settlement — ledger only in phase 3); performance (acceptance rate, on-time %); profile/hours/holiday mode (pauses routing).
- Workshop: request feed (propose/decline), calendar/slots, job card per SR (vehicle received + odometer, estimate builder with saved line templates, start/ready/bill), service menu editor, photos, hours, pickup toggle, reviews, performance.
- Both: mobile-first (partners will use phones), big tap targets, sound + badge on new assignment.

## 10. Customer pages (faithful to concept)

- `/` Home (hero, 6 category tiles, "Browse our product range" cards, "Know the work. Approve the cost." + 3 steps, highlights grid, local-preview block, trust strip, FAQ, partners teaser) — city selector in header ("Raipur ▾", others "coming soon").
- `/shop` catalogue (category/search/sort/availability, spec filters, "fits my vehicle" toggle, delivery-PIN check panel), `/products/[slug]` (gallery, spec table, fitment, price by PIN, Add to cart / Buy with installation enquiry, Q&A → support).
- Cart drawer → `/checkout` (address → review → pay) → `/orders/[code]` (tracking stepper, invoice, cancel/return/help).
- `/workshops` finder (location-first hub with map), `/workshops/[slug]` profile + service menu → `/service/new` wizard → `/service/[code]` (stepper, proposal accept, estimate approval per line, bill, pay, review).
- `/account`: Orders · Service requests · My vehicles (+history, reminders) · Addresses · Support · Profile.
- `/support` (guest reference + key kept), `/partners` (3 application forms), `/policies/*` (concept copy, grievance officer per Consumer Protection e-commerce rules), `/about`.
- Phase 4 extras: `/discover` (vehicle discovery, compare, EMI, test-drive), `/academy`, `/assistance` (roadside, pickup), `/mechanics` directory.

## 11. Multi-city readiness (built in from day one)

- Every partner, order, SR, pincode and staff scope carries `city_id`; `settings` per city; city selector stored in cookie + URL param; serviceability check at pincode level; "Coming soon — join waitlist" for non-live cities (captures demand analytics); ISR pages keyed by city; admin filters default to "All cities".

## 12. Build phases & milestones

0. **Setup** (day 1): install skills (`npx skills add nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max`, `npx skills add obra/superpowers`), `git init`, Turborepo scaffold, tokens + primitives, Drizzle schema + migrations, Firebase emulator, seed Raipur data, Playwright + Lighthouse CI, copy concept inventory into `docs/`.
1. **Customer storefront + orders + admin routing + shop portal** (core loop end-to-end with in-app + email notifications, COD, Razorpay test mode).
2. **Workshops**: finder, profiles, service request wizard, workshop portal, proposals, estimates, bills; partner applications & approval; support tickets.
3. **Returns/refunds/replacements, cancellations, Razorpay live + webhooks, invoices (GST), reviews, reminders, WhatsApp/SMS adapters, full admin analytics, multi-city controls.**
4. **Extra modules**: vehicle discovery, academy, roadside/pickup, mechanic network directory & portal.
5. **Hardening**: e2e suite for every state transition, visual regression vs concept, perf budget (LCP < 2s on 4G), a11y audit, security review (RLS, rate limits, webhook signatures), DPDP consent records, runbooks, deployment to Vercel + Cloud Run + Supabase.

Each phase ends with a demo checklist the user can click through.

## 12a. Performance strategy (image-heavy catalogue must stay fast)

Budgets: LCP < 2.0 s on a mid-range Android over 4G, INP < 200 ms, CLS < 0.05, JS on product pages < 180 KB gzipped, Lighthouse ≥ 90. Enforced in CI (Lighthouse CI + bundle analyzer budgets).

| Layer      | Technique                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering  | Next.js App Router with **static shell + streaming** (Partial Prerendering): header, hero, category tiles and policies are static; prices/stock/cart stream in Suspense holes. Product and workshop pages use ISR (revalidate 60 s + on-demand revalidation when a seller edits).                                                                                                                                                                                                                                       |
| Images     | Every image through `next/image` (AVIF/WebP, srcset, exact `sizes`), **Supabase Storage → Cloudflare Images or Vercel image optimiser** with resize-on-upload to 3 fixed variants (thumb 320, card 640, zoom 1600) so the origin never serves 4000 px files; **blurhash/LQIP placeholders** generated at upload; width/height always set (no CLS); `priority` only on the hero; lazy load below the fold; product galleries virtualised; partner-uploaded photos auto-compressed and EXIF-stripped server-side (sharp). |
| Data       | Hono API behind Cloudflare CDN; catalogue list responses cached in Upstash Redis (30–60 s) and tagged for invalidation; cursor pagination; Postgres indexes on (city, category, published), GIN trigram on name/sku/brand, PostGIS GIST on workshop location; `EXPLAIN` checks in CI for the top 10 queries.                                                                                                                                                                                                            |
| Search     | Postgres full-text + trigram at launch (free, fast enough to ~100k SKUs); switch to **Meilisearch/Typesense** (typo tolerance, facets, synonyms) in phase 3 if needed.                                                                                                                                                                                                                                                                                                                                                  |
| JS         | Server Components by default; client components only for cart, filters, maps, charts; **MapLibre and Recharts loaded dynamically** on interaction/viewport; no moment/lodash; icons via lucide tree-shaken; fonts self-hosted with `next/font` (`display: swap`, subset Latin + Devanagari later).                                                                                                                                                                                                                      |
| Network    | HTTP/2 + Brotli, immutable hashed assets, preconnect to API/CDN, `stale-while-revalidate` for catalogue, service worker (PWA) caching shell + last catalogue for repeat visits.                                                                                                                                                                                                                                                                                                                                         |
| Realtime   | Supabase Realtime channels only on pages that need them (partner order feed, order tracking); polling fallback.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Monitoring | Vercel Speed Insights + Sentry performance; weekly RUM report in admin.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 12b. RBAC and e-commerce foundations (set up from day one)

- **Permission model**: `resource:action` strings (e.g. `orders:route`, `refunds:approve`, `products:publish`) grouped into roles; roles stored in DB (`roles`, `role_permissions`, `user_roles` with optional `city_id` and `partner_id` scope); Firebase custom claims carry role ids only; the API resolves permissions per request (cached in Redis 60 s) and the UI hides what the user cannot do.
- **Default roles**: `super_admin`, `ops_manager` (routing, orders, partners), `support_agent` (tickets, customer view with masked PII, limited refunds), `finance` (payouts, refunds approval, GST exports), `catalogue_manager` (products, brands, categories, imports), `city_manager` (everything scoped to assigned cities), `seller_owner`, `seller_staff`, `workshop_owner`, `workshop_staff`, `mechanic`, `customer`.
- **Guards**: four-eyes approval for refunds above a threshold; audit log on every mutation (who, what, before/after, IP); staff 2FA (phone OTP + email already both verified); session list and remote sign-out; rate limits per role; PII masking for support role; row-level security in Supabase mirroring the same permissions for Realtime subscriptions.
- **E-commerce basics present from the first milestone**: customer profile edit with re-verification on phone/email change; address book (CRUD, default, map pin); vehicles CRUD; wishlist; recently viewed; cart merge on login; stock and price re-validation at checkout; coupons engine (percent/flat/free-shipping, min order, per-user limits, first-order); order notes; GST invoice on request (business GSTIN); order edit before confirmation; cancel/return/replace flows; invoices and credit notes as PDFs; reviews with photos; every admin entity with list/filter/sort/search, create/edit/soft-delete/restore, bulk actions, CSV import/export, saved views; media library; CMS for banners, pages, FAQ, policies, navigation; notification templates; feature flags; maintenance mode; sitemaps; analytics events (PostHog) for funnel steps.

## 12c. Decisions taken after the first draft (2026-10-31 Q&A) — all recorded in `docs/decisions.md`

Hono confirmed over Rust; one Next.js app; all TS + D features now, L later; e-commerce baseline P0 at launch with P1 fully documented; search Postgres now → Meilisearch planned; 3-screen signup; pincode-first addresses + GPS + full address; vehicles with variant/year; history with filters + search; in-app tickets (WhatsApp pending); in-app + email notifications now, SMS/WhatsApp wired but off; deletion via support confirmation; cart recommendations (rules + co-purchase); first-party event store + self-hosted PostHog; reviews admin-approved; admin complete control (content/sections/settings/flags, no theme editor); auto-split multi-shop carts; COD cap + OTP + blocks; light KYC + manual verification; four-eyes + masked PII now, staff 2FA auto-enforced when staff added; **English + Hindi at launch**; hourly slots with capacity + busy mode; commission pending; tooling installed (46 skills, 14 plugins, 3 MCPs); 8 project-local skills incl. self-improving `mechdost-advisor` and `website-testing`; data-integrity patterns mandatory; abuse protection; scalability by construction. Docs created: `CLAUDE.md` (hard rules), `docs/README.md`, `decisions.md`, `design-system.md`, `concept/*.md` (3), `research/*.md` (5, security pending), `specs/*.md` (18), screenshots (55).

## 12e. Security baseline (from `docs/research/security-vulnerabilities.md`)

Pin Next ≥16.4.1/15.5.28, React 19.2.x latest, Node 22.23.4+, Hono ≥4.13.11, Drizzle ≥0.45.4, sharp ≥0.35.4, MapLibre ≥6.4.1, Playwright ≥1.55.1; strip `x-middleware-subrequest` at the edge; `withAuth()` on every route/action; Supabase new-key model + RLS on 100% tables with pgTAP gate; Firebase SMS region IN-only + reCAPTCHA SMS defense + Turnstile + Upstash limits; raw-body HMAC + event-id dedupe for Razorpay; CSP nonces, `__Host-` cookies; pnpm `minimumReleaseAge` + `ignore-scripts` + SHA-pinned Actions + OIDC; `.claude/` config reviewed as code; 40-item checklist executed in Phase 0/5.

## 12d. Phase 0 additions

- Write the 8 project-local skills (advisor + tester with `references/learnings.md` self-improvement loop and evals).
- `pnpm` policy: `minimumReleaseAge`, frozen lockfile, `onlyBuiltDependencies`; Actions pinned by SHA; Dependabot + Socket.
- Supabase PITR add-on; Cloudflare in front; Turnstile keys; Sentry projects.
- `components.json` registries; `shadcn mcp init`.

## 13. Verification

- Unit: state-machine transitions (every allowed/forbidden edge), money/GST maths, routing ranker.
- API: Vitest + supertest against a Postgres test container; OpenAPI contract tests.
- E2E (Playwright): customer order → admin route → shop accept → ship → deliver → return → refund; decline → reroute → reject with message; SR → proposal → estimate per-line approval → bill → pay; timers expire via fake clock; notifications asserted via outbox table.
- Visual: Playwright screenshots of each concept view vs rebuilt pages at 390px / 768px / 1440px.
- Perf: Lighthouse CI ≥ 90 on home/shop/product; bundle budget; DB indexes verified with `EXPLAIN`.
- Manual: run locally (`pnpm dev` → web :3000, api :4000, Firebase emulator, Supabase local), seed logins: customer / shop / workshop / admin with test OTP.

## 14. Assumptions & open items (will confirm as we go)

- Commission/payout model for shops and workshops not yet defined → ledger built generically (phase 3).
- COD allowed in Raipur with a per-order cap (default ₹5,000) — adjustable in settings.
- One shop per order in phase 1; split orders in phase 2.
- Hindi UI copy is a phase-3 toggle (copy strings already externalised).
- "ux superpower" skill repo to be confirmed (assumed obra/superpowers).

---

## Appendix A — Concept-site inventory (condensed; full reports saved for the build)

**Reachable views on the live concept**: `#home`, `#catalogue` (live catalogue from `/api/catalog`, PIN check panel, "Request a product" sourcing form), `#service-packages` (Service hub: tabs, PIN 492001 default, type/power selects, "Use my location", OSM raster map, empty-network card + "Request workshop support", verified-workshop cards from `/api/workshops` → `/workshops/{id}` + service menu modal → `/account?workshop=…#book`), `#partners` (Apply as seller / workshop / mechanic → `launchRequest` enquiry form → "Request received" with reference + private key). Footer: WhatsApp block (wa.me/917978776551 with drafted message), policy dialogs (Company & contact, Privacy, Delivery, Cancellations & returns, Service terms), Support & request tracking link, Admin sign-in.

**Cart/checkout (concept)**: localStorage cart (max 20 products × 99), checkout = delivery details → server price check by PIN (`/api/catalog?pin`) → review with consent → `POST /api/orders` → "Order request received" with `MD-…` code + private key; status lookup by reference + key.

**/account (concept)**: email+password with 64-char recovery key (to be replaced by phone OTP); views Care reminders · Support & requests · Product orders · My vehicles (+history, import from device) · My appointments (7-step progress: Requested→Proposed→Confirmed→Awaiting approval→Approved→In progress→Completed) · Request an appointment (workshop menu checkboxes, expected ₹ range, preferred date/slot, consent) · garage role: Workshop bookings (propose slot & expense / decline / itemised estimate / start / complete) and Workshop service menu; Razorpay pay dialog; service statement dialog.

**/admin (concept)**: Sign in with ChatGPT; tabs Overview · Launch readiness & queue · Products & photos · Import Excel/CSV · Batch photos & offers · Vendors · PIN-code prices & stock · Customer orders (statuses Awaiting confirmation→Confirmed→Processing→Dispatched→Delivered, Cancelled) · Accounts & appointments (assign workshop access, payments reconcile) · Applications & enquiries (reply + status In review/Awaiting customer/Resolved/Closed) · Backups & exports (encrypted snapshots, 12 CSV datasets) · Workshops (5-fieldset editor with coordinates-from-link parser, verification method, owner consent, publish).

**Hidden/legacy modules in the runtime (to rebuild in phase 4)**: service desk with versioned per-line estimate approval + GST scenarios, garages directory, vehicle discovery (8 fictional models, compare up to 3, on-road/EMI calculator, test-drive enquiry, showrooms), mechanic network (registration with 4 consents, directory, demo admin, job cards), academy (NGK/Schaeffler/Bosch links, topic/format filters, saved/done), product lens (BarcodeDetector camera/photo/manual), roadside & pickup assistance, symptom-based booking ("I don't know what's wrong"), buy-with-installation enquiry, vehicle passport, Hindi estimate explainer, reviews.

**Reference data to seed**: 9 categories (Tyres, Lubricants, Batteries, Bearings, Filters, Spare parts, Accessories, Workshop tools, EV essentials) with tile descriptions; 18 sample products; 2 real products (Castrol Activ 4T 20W40 900 ml ₹440; Exide XLTZ4A ₹1000); hub services with ₹ ranges and include/exclude copy; 11 service categories; vehicle types & fuels; CG districts; policies text; Raipur map centre 21.227, 81.640 (Pachpedi Naka).

**Concept bugs to avoid** (56 catalogued across the three inventories), headline ones: no order→shop routing or vendor portal; no cancel/return/refund self-service (phone only); email-only login with recovery key; nav highlight stale; errors styled as success; status read from rendered text; rupee/paise mix; buy-again reads fields the API doesn't return; approve form accepts zero items; cancelled/declined statuses missing from progress bar; FAQ/trust/closing sections never render; "Request price" behaves differently on home vs catalogue; robots.txt blocks product images; mojibake from double-encoded UTF-8; contradictory policy copy on stock reservation.

## Appendix B — Industry feature research (Oct 2026; TS = table stakes, DIFF = differentiator, LATER = later phase)

**Indian parts/service platforms.** boodmo: search by car/VIN against OEM catalogues, OEM vs aftermarket, "Boodmo fulfilled" suppliers, 10-day returns; biggest complaint = wrong-fitment returns refused → make fitment check + wrong-part replacement guarantee explicit [DIFF]. SparesHub: RFQ to multiple verified sellers with escrow → "Request a quote" fallback when search fails [DIFF]. GoMechanic: health reports with photos, pickup slots, real-time job updates, network warranty honoured at any partner, refer & earn wallet. Pitstop: fixed-price doorstep inspection SKUs (₹649) as low-friction first order [DIFF]. ReadyAssist: 24/7 RSA incl. 3-wheelers, public SLA % as trust metric. Autodoc Club: digital service booklet, reminders by km and date, fuel/expense log → copy into My Vehicles [DIFF]. Parts Big Boss / Carorbis: make→model→year→variant selector, free shipping thresholds, "100% original" badge. Autoverse: 6M fitment mappings, WhatsApp discovery. Ride N Repair: 30-min doorstep mechanic + parts delivery with install.

**Hyperlocal patterns (Swiggy/Zomato/Blinkit/Urban Company).** Zomato auto-rejects restaurant orders not actioned in 4 min; riders 30-s accept windows then next-closest → shop accept timer (10–15 min parts, longer for service) with auto-return to admin queue [TS]; "Busy/holiday mode" [DIFF]. Rejection penalties cut rejections ~50%; UC requires ≥70% acceptance, ≥4.7★ → partner scorecards: acceptance %, time-to-accept, cancellation %, rating [TS]. UC matching = nearest + available + "starvation score" to feed under-booked partners → routing ranker [DIFF]. Cancellation: free until partner accepts, fees only after dispatch; instant wallet refund + 5–7 day source refund [TS]; show fee rules before confirm. Payouts weekly (Swiggy) / 7–10 days (Flipkart) [TS]. Support chat anchored to order with quick issue picks [TS].

**Marketplace ops.** Scorecards like Amazon ODR <1%, late dispatch <4%. Commission benchmarks: 8–12% parts, 15–20% services; weekly payouts. **GST: auto parts (HSN 8708) now uniform 18% since 22 Sep 2025**; e-invoicing above ₹5 cr; as e-commerce operator must register for **TCS 0.5% u/s 52** → per-seller GST invoices with HSN, TCS ledger, GSTR-8 export [TS]. RTO 15–30% on COD → OTP/WhatsApp COD confirmation, COD caps by pincode/first order, photo-on-return + seller QC before refund [TS]; open-box delivery for batteries/tyres [DIFF]. ONDC: Hero MotoCorp & Uno Minda sell 2W parts via ONDC → optional later catalogue breadth [LATER].

**Compliance (India).** DPDP Rules notified Nov 2025 (phased ~18 months): plain-language notice, itemised purposes, withdrawal link, grievance contact → consent log with purpose tags [TS]. Consumer Protection E-Commerce Rules: grievance officer, ack 48 h, resolve 1 month, seller details + country of origin + return policy displayed; 2026 amendment (eff. 1 Jan 2027): "lowest price in last 30 days" for discounts, sponsored labels, dark-pattern self-audit [TS]. Razorpay ~2% + GST, free refunds; COD fee set by merchant; MSG91 OTP ~₹0.13–0.25/SMS with DLT; Firebase phone auth on Blaze plan (~$0.01–0.07/SMS India); WhatsApp utility templates ~₹0.12/message, service replies free in 24 h window [TS].

**Analytics.** Core: GMV, funnel placed→routed→accepted→ready→delivered, acceptance rate & median time-to-accept per partner, reroute count, SLA %, cancellation reasons, return/refund rate & value, defect score, ratings both sides, repeat/cohorts, AOV, COD share & RTO, stockouts/fill rate, demand-vs-supply pincode heatmap, "shops per pincode" density, payouts & TCS liability. Libraries: Recharts (+Tremor-style tiles) now, MapLibre for maps (Leaflet acceptable), ECharts only if >100k points.

**Growth/retention.** Service reminders by km/date; insurance/PUC/RC expiry + challan check (Park+, ACKO, CARS24 Orbit) [DIFF]; doorstep battery/tyre fitting bundles (Battery Mantra, Tyresnmore) [DIFF]; Razorpay cardless EMI for tyres/batteries [LATER]; wallet as refund sink doubles as loyalty + referral [TS]; RSA/care subscriptions [LATER]; **Raipur has ~1.46M two-wheelers vs ~240k cars and 35k three-wheelers → 2W/3W first-class** [TS]; fleet/B2B accounts for auto & taxi unions with monthly invoicing [LATER]; "MechDost Certified" tiered workshop badge (Bosch Car Service / NEXA Service model) [DIFF]; import Google Business Profile ratings at onboarding [LATER].

**Multi-city.** cities → zones (polygons) → pincodes with serviceable_for flags {parts_delivery, doorstep_service, pickup_drop, RSA}, per-zone fees/cutoffs/COD; city-scoped price overrides; point-in-polygon at address entry; "Not serviceable yet — notify me" demand capture [TS]. Launch checklist: waitlist demand → seed 5–10 anchor shops + 2–3 workshops per zone → verify docs → upload catalogue/stock → set SLAs → train partners on accept timer → soft launch 2–3 pincodes → monitor acceptance/time-to-accept → expand. Partner model (no dark-store capex); micro-hub for fast movers only once volume justifies [LATER].

Sources are cited in the full research report saved with the task outputs; they will be copied into `docs/feature-research.md`.
