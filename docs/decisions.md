# Decisions log

Append-only. Newest at the bottom. Each entry: date, decision, reason, alternatives considered.

## 2026-10-31 — Brand

- **Decision:** Brand is **MechDost** (not "AutoMart"). Tagline "YOUR AUTOMOTIVE CONNECTION". Legal footer: SHOURYA INTEGRATED SERVICES PRIVATE LIMITED. Support phone 7978776551. Registered address C-605, 6th Floor, Salasar Greens, Sarona, Tatibandh, Raipur 492099. GSTIN 22ABVCS4888H1ZL, CIN U47912CT2026PTC021411 (from concept Contact policy; verify before publishing).
- **Reason:** User confirmed; design, names and copy of the concept must be kept.

## 2026-10-31 — Design fidelity

- Reproduce the concept site's design, section names and copy. Hidden/legacy sections of the concept (service desk, garages, vehicle discovery, academy, product lens, assistance, mechanic network, FAQ, trust strip) are part of the build in later phases. Only prototype disclaimers are removed.

## 2026-10-31 — Stack

- **Frontend:** Next.js 15 App Router, React 19, Tailwind + shadcn/ui, one app for storefront + account + partner portals + admin (option B1).
- **API:** Hono (TypeScript, Node 22) as a separate service with OpenAPI; deploy Cloud Run `asia-south1`. Alternatives considered: NestJS (heavier), Fastify, Go, Rust/Axum (fastest runtime but ~1.5–2× slower delivery; may host hot paths later), Next route handlers only (bad for mobile), Supabase-only (awkward workflows).
- **DB:** Supabase Postgres (ap-south-1) + PostGIS, Drizzle ORM. **Realtime/Storage:** Supabase. **Cache/rate-limit:** Upstash Redis. **Jobs:** pg-boss.
- **Monorepo:** Turborepo + pnpm; `packages/shared` reused by a future React Native app.
- **Hosting:** Vercel `bom1` (web), Cloud Run Mumbai (API), Supabase Mumbai.

## 2026-10-31 — Authentication

- Firebase Authentication. **Phone OTP is the primary sign-in for every role.** Email is collected at signup and verified once via link (receipts, invoices, recovery). Both phone and email must be verified before placing orders / booking / acting as a partner. Admin/staff additionally allow-listed in `staff` table with role scopes. Dev: Firebase Auth Emulator, test OTP 123456.

## 2026-10-31 — Scope and phasing

- Core first: storefront, cart/checkout, orders with admin routing and shop accept/decline, workshops + location-first service requests, partner applications, support, admin analytics, RBAC and e-commerce basics. Then extra modules (vehicle discovery, academy, product lens, roadside/pickup, mechanic network). Feature menu choice: **all table-stakes + differentiators now; "later" items (EMI/BNPL, subscriptions, fleet accounts, ONDC, GBP import) deferred.**
- Multi-city readiness built in from day one (city/zone/pincode tables, city-scoped settings and staff).

## 2026-10-31 — Providers (set up later; do not over-invest now)

- Messaging: MSG91 most likely (OTP/SMS/WhatsApp), Twilio possible. Payments: Razorpay (test mode during build). Email: Resend. Maps: MapLibre + OSM tiles; address autocomplete provider TBD (Ola Maps / Google Places).

## 2026-10-31 — Backend framework

- **Hono (TypeScript)** confirmed over Rust/Axum (Rust ~1.5–2× slower feature delivery; may host hot paths later behind the same OpenAPI contract). One Next.js app for all surfaces (B1).

## 2026-10-31 — Feature menu

- All table-stakes (TS) and differentiator (D) items from `research/industry-features.md` are in scope; "later" items (EMI/BNPL, subscriptions, fleet accounts, ONDC, Google Business Profile import) deferred.
- E-commerce baseline (`research/ecommerce-baseline.md`): P0 at launch, **P1 documented in full so any item can be pulled forward at any time**, P2 later.

## 2026-10-31 — Customer account (P0 details)

- Search: **Postgres full-text + trigram at launch**, API designed so **Meilisearch** drops in later (important planned upgrade; revisit when SKUs > ~20k or second city).
- Signup: phone OTP → name + email → verify email once (3 screens). Profile later: name, email (re-verify), phone (OTP to old and new), language.
- Addresses: pincode-first (auto-fill city/state, serviceability check) **plus "use my current location" (GPS)**, then the customer writes the full address in detail; label, contact name/phone per address; map pin used for doorstep/pickup.
- Vehicles: type, make, model, variant, year, fuel, registration, odometer; primary vehicle drives fitment badge/filter; service history and next-service reminder per vehicle. (May change later.)
- Order/booking history: timeline, reorder, cancel/reschedule within policy, **plus filters by vehicle/date and a search box**.
- Support: in-app tickets linked to order/booking with quick issue picks, photos, threads, status, grievance-officer details + 48 h acknowledgement. (WhatsApp handoff: pending.)
- Notifications: in-app + email at launch; SMS/WhatsApp templates built and wired but **off until MSG91 is set up**; transactional always on, promotional opt-in, per-channel toggles.
- Privacy: self-serve deactivate (30-day undo) or delete request; consent log per purpose with withdraw; cookie banner declines non-essential by default; **every deletion is routed to support for final confirmation** before execution; orders anonymised but retained for GST.

## 2026-10-31 — Catalogue, recommendations, analytics

- **Cart recommendations (P0)**: rules (fits-your-vehicle, complementary: oil→filter, battery→fitting, tyre→alignment), "frequently bought together" from our own co-purchase data, admin-curated bundles; shown in cart drawer, product page, checkout; data model ready for an ML ranker later.
- **Analytics (P0)**: first-party event store in our Postgres (`events` table, partitioned; session, user, device, city, vehicle context; **every user action tracked**: page views, searches, clicks, cart, checkout steps, booking steps, partner actions) **plus self-hosted PostHog** for funnels, session replay, feature flags; export to ClickHouse/BigQuery when volume grows.
- Reviews: verified purchase/service only; **admin approves before publish** and has full rights to edit, hide, remove; partner reply; photo reviews in P1.

## 2026-10-31 — Admin control, checkout, partners, security, language

- **Admin has complete control over customisation**: CMS for every banner, headline, helper text, FAQ, policy; show/hide and reorder home sections; categories/tiles/icons; city settings, timeouts, windows, fees; feature flags; notification templates; navigation menus. Theme colours/fonts fixed in code (no theme editor, no page builder at launch).
- **Multi-seller carts auto-split** into per-shop sub-orders at checkout (one payment, one parent order); admin routes each sub-order; customer sees grouped tracking.
- **COD rules** (if COD enabled): per-order cap (default ₹5,000, per city), OTP confirmation, optional COD fee, auto-off for customers with RTO history, admin can block pincodes/customers, per-category exclusions.
- **Partner KYC**: light KYC (application form + GSTIN or declaration, PAN, bank account, shop photos, location pin) with admin manual verification (call/visit); penny-drop and e-sign in P1.
- **Staff security**: four-eyes approvals above a threshold and masked PII for support are built in; **staff 2FA (TOTP) is built and enforced automatically once staff accounts beyond the founders are added**.
- **Hindi**: English **and Hindi at launch** (all copy externalised; ~1,500 strings + Hindi notification templates; Hinglish search synonyms).
- **Workshop slots**: hourly arrival slots with per-workshop capacity, opening hours, blackout dates, busy/holiday toggle; customer picks preferred slot, workshop confirms or proposes another.

## 2026-10-31 — Maps

- **MapLibre GL JS with free tiles (OpenStreetMap raster or MapTiler/Protomaps vector free tier)** for all maps (workshop finder, tracking, admin heatmaps), styled with MechDost tokens; no Mapbox. Rendering wrapped in a map adapter so a paid provider could be swapped in later if ever needed.
- **Geocoding and address autocomplete** (reverse geocoding for "use my current location", forward autocomplete for typed addresses) and **routing/ETA**: provider chosen by a **Raipur bake-off (Google Places vs Ola Maps on ~50 real addresses; OSRM/Ola for routing)** during the service-flow build. Until then, dev uses Nominatim/OSRM public endpoints with low rate limits. Workshop coordinates stored in our DB (entered once by admin), never re-geocoded per view.
- Cost: $0 for rendering; geocoding/routing cost depends on the bake-off winner (Ola cheapest; Google Places per session after monthly credit).

## 2026-10-31 — Execution rulings

- **Next.js 16.4.x** (not 15): security research requires ≥16.4.1 / ≥15.5.28. **TypeScript ~6.0.3** (typescript-eslint supports <6.1). **postgres@3.4.9** driver (4.0.0 blocked by the 3-day release-age policy). Details and costs in `progress.md` → Rulings.
- **Code quality (hard rule 14)**: strict type-checked ESLint, Prettier, `pnpm check` gate (2026-10-31, user request).
- **API foundations (2026-10-31)**: role permissions are read from the database (system roles synced from `packages/shared/src/rbac.ts`; admin-defined custom roles supported); only `phone` sign-in tokens accepted; bearer tokens only (CORS without credentials → no CSRF surface on the API); compressed request bodies refused (Node Brotli CVE); in-memory rate limiting forbidden in production; Upstash limiter fails open after 1 s on the general API (OTP endpoints will fail closed — inbox Q18); per-instance 60 s session cache. Details in `specs/13` implementation map.

## 2026-11-01 — Web shell, design direction and demo

- **Design direction (user):** the concept is the theme, not a pixel spec — tokens, fonts, tone, section names and copy stay; layouts may be improved. CLAUDE.md rule 2 updated.
- **Accessible accent:** button accent `#e65325` → `#d2461a` (white text 4.53:1), muted `#657487` → `#5a6a7d`, accent text links `#bf3c12`, form borders `#7f8ea0` (WCAG 1.4.11). Brand accent `#ea5728` kept for logo/icons. Enforced by `apps/web/test/tokens.test.ts`.
- **Dark mode (user):** follows the system preference; a toggle saves the choice per device (localStorage, applied before first paint); dark tokens in `packages/ui/src/tokens.css`; `ink` (text) split from `navy` (brand surface). Both themes contrast-tested.
- **Breakpoints:** page grids change at 760px (concept); the header switches from the bottom tab bar to the full nav at **1024px** (tablets keep the tab bar — the full nav does not fit). Hero stacks below 1024px.
- **Motion (user: "transitions … loading animations"):** CSS-only — route entrance (`template.tsx`), scroll reveal (`animation-timeline: view()`, progressive enhancement), skeletons (`loading.tsx` on dynamic routes only — a root loading boundary turns 404s into 200s), press feedback; shared motion tokens; everything off under `prefers-reduced-motion`.
- **i18n runtime stays on the server:** client islands receive translated strings/localised hrefs as props; only form-heavy flows (cart, checkout, tracking, finder, booking) mount a page-scoped `NextIntlClientProvider`. CSS is inlined (7 KB gz) — mobile LCP 1.96 s → 1.70 s on Slow 4G + 4× CPU.
- **Demo mode (user: partner demo 2026-11-02):** demo catalogue (20 products), 8 Raipur workshops, browser-only cart/orders/service requests (`apps/web/src/demo/*`) with "Demo controls" to simulate shop/workshop actions. Replaced by the API in Phase 1; never extended with real business data.
- **Assistant (user):** floating "Ask MechDost" chat, static intents now, `AssistantTransport` interface for the later API-backed LLM (Anthropic or OpenAI, key server-side) — spec 18, inbox Q19.
- **Bulk orders (user):** customer negotiates in a chat thread **directly with admin**; admin sets the final price as a versioned offer; on acceptance a normal order is created and follows the standard routing/fulfilment workflow — spec 19, inbox Q20.

## 2026-11-01 — Demo polish, round 2 (user feedback during the demo review)

- **Shop filtering is client-side and smooth (user: "the page refreshes and takes me back up"):** chips, dropdown, sort and search share one state; URL updated with `history.pushState` (no navigation, no scroll); Back/Forward restore it; shared links open with matching controls. Server-rendered cards are passed into the client browser.
- **Light-mode hierarchy (user: "hard to tell cards apart"):** page `#edf1f5`, card borders `#d3dbe5`, layered card shadows, input border `#75859a` (3:1 on the new background). Rating star colour token `--color-star` (`#c27803` light, `#f5b041` dark; graphics only — rating numbers use ink).
- **Product artwork:** "blueprint plate" (navy panel, engineering grid, part in line work, brand chip, SKU) until catalogue photos arrive. An ⓘ button on every card opens a native `popover` with specs, fitment, delivery and a link to the product page.
- **Reviews & ratings on every product and workshop (user):** average, distribution, recent reviews, "Write a review" → pending admin approval (spec 08 moderation). Demo ratings are deterministic per slug.
- **Partner applications are real forms (user: "these shouldn't go to WhatsApp"):** `/partners/apply/{seller|garage|mechanic}` → status page `/partners/applications/PA-…` with a review timeline.
- **Workshop map (user: "visual map … completely functional and interactable"):** MapLibre GL 6 + OpenFreeMap vector tiles (Positron light / Dark, no key) behind `WorkshopMap`. MapLibre's worker is copied to `/vendor/maplibre-gl-worker-{version}.mjs` by `apps/web/scripts/copy-map-worker.mjs` (run by `dev`/`build`; immutable cache header) because the bundler does not emit it — without this the map never loads. Interactions: drag, scroll/pinch/keyboard zoom, zoom buttons, full screen, locate me (feeds the finder's distance sort), show all, scale bar; rotation off; two-finger panning on touch screens only (except full screen). Pins are buttons (teardrop + 🔧, name tooltip on hover/focus); popups follow the theme with rating, "View & book" and "Directions" (Google Maps); Escape or a click on empty map closes them. All map UI strings are in the `map` locale namespace.
- **Emoji in navigation (user: "add some emojis to the top bar, the cart button etc."):** decorative emoji next to text labels in the announcement bar, desktop nav (≥1280px), account, language (≥1280px), theme toggle (🌙/☀️), cart pill (🛒), bottom tab bar, shop category chips and home category tiles. Always `aria-hidden` with a real text label; defined once in `apps/web/src/lib/emoji.ts`; admin-managed categories will carry their own emoji (spec 08).
- **Bulk quotes UI (spec 19) in demo mode:** `/quotes/new` (from product page, cart or assistant; minimum **10 units** in total = Q20 default) → `/quotes/QT-…` thread with the active offer pinned and "Accept offer" as the single primary action; accepting a superseded offer is refused; acceptance creates a normal order (stage "placed") that follows the standard workflow. Account lists bulk quotes. The assistant's bulk answer now opens the quote form instead of WhatsApp.
- **Assistant API (spec 18):** `POST /v1/assistant/messages` with the official Anthropic SDK; default model `claude-opus-5-5` with server-side fallbacks, low effort, cached system prompt; 503 when no key, 502 on provider failure, 20 messages / 10 min per IP; message text never logged. Provider interface ready for an OpenAI adapter (Q19).

## 2026-11-01 — Demo sign-in, account and portals (user: "create the logins now, just a fake one, I'll link Firebase later"; "the accounts section … so much to improve")

- **Demo sign-in** mirrors spec 01: `/login` → phone (+91, Indian mobile validation) → 6-digit code (always **123456**, like the Firebase emulator; 30 s resend timer) → new numbers add name + email and become customers. `?next=` is followed only for same-site paths (open-redirect guard). Session + accounts live in the browser (`apps/web/src/demo/session.ts`); Firebase phone auth + `GET /v1/me` replace it in Phase 1 with the same screens.
- **Seeded logins** (one per role, shown as chips on `/login`): customer Ravi Sahu 9876543210 · shop owner Rakesh Sharma 9000000001 (Sharma Auto Parts) · shop owner Anil Verma 9000000004 (Raipur Battery Point) · workshop Imran Khan 9000000002 (Telibandha Car Clinic) · admin MechDost Operations 9000000003. Partners and staff are never created by sign-up (admin approval only).
- **Account area** `/account/{overview|orders|services|quotes|vehicles|addresses|profile}`: section nav (sidebar ≥1024px, scrolling chips on phones), overview with verified badges, stats, primary vehicle and recent activity; vehicles and addresses CRUD (max 10 each, one default address); profile edit (phone change needs double OTP — Phase 1). Signed-out visitors see a sign-in card plus this device's activity; partner/staff roles are sent to their portal. Header shows the signed-in person's initial + first name from 420px.
- **Portals (demo):** `/admin/{overview|orders|services|quotes|applications|reviews}` — KPIs, order routing with ranked shop suggestions (category coverage → acceptance → speed; shops that declined are excluded), reroute after decline/timeout, reject with an editable customer message, reassign declined service requests, bulk-quote desk (chat as MechDost + offer builder with discount warning above 15%), partner applications, review moderation. `/partner/shop` — offered orders with a **15-minute** accept timer, accept / decline with a reason, then packed → out for delivery → delivered. `/partner/workshop` — propose date, slot and cost range (+ note) or decline, then vehicle received → work → ready.
- **Order assignment model (demo, mirrors spec 04/14):** `shop: {slug, status: offered|accepted, expiresAt}`, `declined[]`, `rejection`; transitions only from the right state (repeat/stale actions are no-ops), one active assignment per order. Customer order page shows the fulfilling shop or the rejection message.
- Portal role checks in the browser are presentation only; the API enforces permissions (spec 13).

## PENDING DECISIONS (ask "what's pending" to review)

| #   | Topic                                                                                                                                                                                       | Leaning                                                                             | When                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Payment methods at launch (COD + Razorpay vs COD only vs Razorpay only)                                                                                                                     | Most probably COD + Razorpay                                                        | Later                                |
| 2   | Post-purchase P1 items at launch (exchanges, reminders, disputes, order chat)                                                                                                               | Probably include all (option 3)                                                     | Tomorrow (2026-11-01)                |
| 3   | WhatsApp handoff from support tickets                                                                                                                                                       | —                                                                                   | Later                                |
| 4   | Vehicle master data source (curated CSV vs licensed DB)                                                                                                                                     | Most probably curated CSV, admin-editable, Vahan later                              | Later                                |
| 5   | Vehicle fields may change                                                                                                                                                                   | Option 1 for now                                                                    | Open                                 |
| 6   | Messaging provider (MSG91 vs Twilio)                                                                                                                                                        | MSG91                                                                               | Later (setup only, not during build) |
| 7   | Geocoding/autocomplete + routing provider (Google Places vs Ola Maps; OSRM/Ola routing)                                                                                                     | Decide via 50-address Raipur bake-off                                               | During service-flow build (Phase 2)  |
| 8   | ~~Hindi UI at launch or P1~~ decided: both at launch                                                                                                                                        | —                                                                                   | Done                                 |
| 9   | Commission and payout model for shops/workshops                                                                                                                                             | Ledger built generically; rates configurable per category/partner; user will decide | Later ("ill tell u on this later")   |
| 11  | Verify GSTIN/CIN/address from concept before publishing policies                                                                                                                            | —                                                                                   | Before launch                        |
| 12  | Razorpay MCP connection (test keys)                                                                                                                                                         | Add when Razorpay account is ready                                                  | Later                                |
| 13  | "ux superpower" skill identity (installed obra/superpowers as closest match)                                                                                                                | —                                                                                   | Confirm                              |
| 15  | Vehicle fields, commission, payment methods, post-purchase P1 — see rows 1, 2, 5, 9                                                                                                         | —                                                                                   | —                                    |
| 14  | Baseline walkthrough: remaining untouched P0 items use the baseline defaults (coupons engine, attribute sets, part numbers, SEO, OOS handling, admin CRUD conventions, impersonation in P1) | Defaults                                                                            | Confirm anytime                      |

## 2026-10-31 — Tooling (see `research/tooling-audit.md`)

- **Plugins**: context7, supabase, vercel, github, code-review, security-guidance, frontend-design, typescript-lsp, modern-web-guidance, posthog, claude-security (`@claude-plugins-official`); `firebase@firebase`; `google-cloud-developer@google-plugins`.
- **MCP**: playwright, chrome-devtools, shadcn (after scaffold creates `components.json`), cloud-run. Razorpay MCP later.
- **Skills**: full verified set (shadcn/ui, honojs/skills, mattbx shadcn-component-discovery + review, vercel-labs react-best-practices + web-design-guidelines, turborepo, supabase-postgres-best-practices, antfu vitest, currents playwright-best-practices, grill-me, addyosmani web-quality plugin, accessibility-agents plugin, nextjs-seo, maplibre fonts-glyphs, cloud-run-basics, domain-modeling) + registries @magicui, @kibo-ui, @dashboardblocks, @reui.
- **Project-local skills (8)**: `mechdost-advisor` and `website-testing` must be excellent and **self-improving** (each keeps a `references/learnings.md` that is appended after every bug, review or decision; evals re-run); plus firebase-phone-auth-rbac, razorpay-payments, drizzle-postgis-supabase, msg91-messaging, serwist-pwa, next-intl-hindi.

## 2026-10-31 — Non-functional requirements added by user

- **Data integrity**: order/receipt/ID generation and assignment must be bulletproof (no duplicate IDs, no order offered to two shops, no double booking/refund); known marketplace bug classes researched and built in from day one (`research/data-integrity.md`).
- **Abuse protection**: per-user/IP/device rate limits, OTP throttling, Turnstile on forms, order/coupon/review velocity limits, fake-COD controls, WAF, CSP/HSTS, enumeration-safe errors (`specs/security-abuse.md`).
- **Recommendations and analytics**: see Catalogue section above.
- **Admin complete control**: see Admin control section above.
- **Smoothness**: transitions, scrolling and navigation must feel really smooth — View Transitions, prefetching, optimistic UI, skeletons, transform/opacity-only motion, reduced-motion support, INP and CLS budgets as CI gates (`specs/16-performance-scalability.md`).
- **Scalability by construction**: stateless API, pooled DB, tagged caches, cursor pagination, worker pool, city-scoped data; scaling path documented without rewrite (`specs/16-performance-scalability.md`).
- **Recent-vulnerability awareness**: `research/security-vulnerabilities.md` checklist executed in Phase 0 and re-checked quarterly.

## 2026-10-31 — Skills installed

- `ui-ux-pro-max` (nextlevelbuilder) and `obra/superpowers` (15 workflow skills) installed globally for Claude Code. See `research/skills.md` for the full evaluation and picks.
