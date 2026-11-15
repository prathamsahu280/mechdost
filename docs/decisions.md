# Decisions log

Append-only. Newest at the bottom. Each entry: date, decision, reason, alternatives considered.

## 2026-10-31 — Brand

- **Decision:** Brand is **MechDost** (not "AutoMart"). Tagline "YOUR AUTOMOTIVE CONNECTION". Legal footer: SHOURYA INTEGRATED SERVICES PRIVATE LIMITED. Support phone 7978776551. Registered address C-605, 6th Floor, Salasar Greens, Sarona, Tatibandh, Raipur 492099. GSTIN 22ABVCS4888H1ZL, CIN U47912CT2026PTC021411 (from concept Contact policy; verify before publishing).
- **Reason:** User confirmed; design, names and copy of the concept must be kept.

## 2026-10-31 — Design fidelity

- Reproduce the concept site's design, section names and copy. Hidden/legacy sections of the concept (service desk, garages, vehicle discovery, academy, product lens, assistance, mechanic network, FAQ, trust strip) are part of the build in later phases. Only prototype disclaimers are removed.

## 2026-10-31 — Stack

- **Frontend:** Next.js 15 App Router, React 19, Tailwind + shadcn/ui, one app for storefront + account + partner portals + admin (option B1).
- **API:** Hono (TypeScript, Node 22; **Node 24 LTS since 2026-11-13**, see that entry) as a separate service with OpenAPI; deploy Cloud Run `asia-south1`. Alternatives considered: NestJS (heavier), Fastify, Go, Rust/Axum (fastest runtime but ~1.5–2× slower delivery; may host hot paths later), Next route handlers only (bad for mobile), Supabase-only (awkward workflows).
- **DB:** Supabase Postgres (ap-south-1) + PostGIS, Drizzle ORM. **Realtime/Storage:** Supabase (realtime superseded 2026-11-01 → Firebase Realtime Database pings; Storage stays Supabase). **Cache/rate-limit:** Upstash Redis. **Jobs:** pg-boss.
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
- **Portals (demo):** `/admin/{overview|orders|services|quotes|applications|reviews}` — KPIs, order routing with ranked shop suggestions (category coverage → acceptance → speed; shops that declined are excluded), reroute after decline/timeout, reject with an editable customer message, reassign declined service requests, bulk-quote desk (chat as MechDost + offer builder; discount shown for information — superseded by Q20 below), partner applications, review moderation. `/partner/shop` — offered orders with a **15-minute** accept timer, accept / decline with a reason, then packed → out for delivery → delivered. `/partner/workshop` — propose date, slot and cost range (+ note) or decline, then vehicle received → work → ready.
- **Order assignment model (demo, mirrors spec 04/14):** `shop: {slug, status: offered|accepted, expiresAt}`, `declined[]`, `rejection`; transitions only from the right state (repeat/stale actions are no-ops), one active assignment per order. Customer order page shows the fulfilling shop or the rejection message.
- Portal role checks in the browser are presentation only; the API enforces permissions (spec 13).

## 2026-11-02 — Home page polish (user: "visually the site needs a lot more improvement")

- Home order: hero → trust strip (emoji) → categories → popular products → **"How your order reaches you"** (blueprint band: 🛒 you order → 🧭 MechDost picks a shop → 🏪 the shop confirms within 15 min → 🚚 delivered, dashed road vertical on phones / horizontal ≥1024px, CTA + bulk-price link) → "Know the work. Approve the cost." → **top-rated workshops** (3 cards) → **FAQ** (6 questions, native `<details>`, FAQPage JSON-LD) → partner teaser.
- The FAQ restores the concept's `.automart-faq`, which never rendered (concept bug #6). Copy lives in the locale files; it becomes admin-editable content blocks in Phase 1 (spec 08, rule 8).
- All new sections are Server Components with no client JS (home JS budget, spec 16).

## 2026-11-01 — Inbox walkthrough (user: "I'm here to answer the questions")

- **Bulk quotes (Q20):** minimum **10 units** in total; no value threshold. The price is settled by negotiation: **no discount cap and no second-approver gate** (supersedes the 15% four-eyes default). The admin offer builder shows "N% below list price" as information only; offers stay audit-logged.
- **Redis outage (Q18):** confirmed split — general API fails open (WAF still protects), OTP send/login fails closed.
- **Legal details (Q15):** GSTIN 22ABVCS4888H1ZL and address C-605 Salasar Greens, Sarona, Tatibandh, Raipur 492099 confirmed; CIN and grievance officer name to come.
- **Skill (Q16):** `obra/superpowers` confirmed as the "ux superpower" skill.
- **Demo data (Q21):** stays on locally and in previews; switched off before public launch (date TBD, ask before going live).
- **Tooling (Q13, Q14):** leave the Supabase MCP read-write on the dev project and the GitHub plugin unconfigured; plain `git push` is used.
- **Deferred by the user ("decide later"):** payment methods (Q2), post-purchase P1 items (Q1), assistant provider (Q19), vehicle master source (Q10), commission/payouts (Q11), WhatsApp handoff (Q9). Accounts not yet created: Firebase (Q3), Upstash (Q4), Turnstile (Q5), Resend (Q7), Razorpay test (Q8), GCP/Vercel (Q17) — the defaults in `questions-for-user.md` stay in force.
- **Map tiles (Q6):** withdrawn — OpenFreeMap needs no key.

## 2026-11-01 — UI pass: footer, empty states, partners (user: "the ui can improve a bit more")

- **Footer** (every page): help card (WhatsApp/call) beside four link columns — Shop (all products, tyres, batteries, lubricants, bulk price) · Vehicle care (workshops, vehicles, service requests) · Your account (sign in, track an order, bulk quotes, cart) · For partners (become a partner, three application forms) — then a legal row with operator, **GSTIN and registered office** (confirmed, Q15), theme toggle, credits. Links only to pages that exist; becomes admin-editable navigation in Phase 1 (rule 8).
- **Empty states** follow one pattern: emoji in an accent-soft circle, one plain sentence, one next action. Cart: "Shop products" plus category shortcuts as quiet secondary links. Account lists (orders, service requests, bulk quotes): dashed card with the list's next action; the action moves to the heading row once the list has items.
- **Partners page**: each partner type shows an emoji, three concrete benefits and its application button, followed by "How joining works" (apply → we verify → set up → go live) and the support number.
- **Workshops promise strip** gains emoji (🔍 👍 📒). No new colours, fonts or radii (rule 2).

## 2026-11-01 — Admin site customisation, demo first (user: "demo now, real later")

- Admin can change, without code: announcement bar and home headline text (English + Hindi), home section order and visibility, which 3–6 categories appear on the home page and their emoji, the shop acceptance time, the bulk quote minimum, the delivery fee and the free-delivery threshold. Details in spec 08 "Site customisation".
- Settings apply to new orders only (timer fixed at offer time, fee snapshotted on the order); every change is validated, version-checked per area and audited.
- The home page stays a static Server Component: layout via a pre-paint CSS script, text/emoji/numbers via tiny client islands. Phase 1 replaces both with the content API + ISR.
- Copy that states these numbers ("within 15 minutes", "10 or more", "from ₹999") now renders the live setting.

## 2026-11-01 — Sign-in: phone OTP once, then password; encryption (user decision)

User: "the first time it will ask the user for the phone number, then they enter their OTP, then name, email, password, confirm password"; "if they have forgotten their password … either OTP via phone number or a link by email, whichever they prefer"; "the passwords and database need to be properly encrypted". **Supersedes** 2026-10-31 "Phone OTP is the primary sign-in for every role".

- **Sign-up (once):** phone → one-time code → name, email, password, confirm password. Accounts are only ever created by phone sign-up, so every account has a verified phone (`ensureUser` refuses to create a user without one: `PHONE_SIGNUP_REQUIRED`). Email is still verified once by link.
- **Sign-in:** phone number **or** email + password. Staff (admin roles) also enter a code sent to their phone every time (staff 2FA, as decided 2026-10-31).
- **Forgot password:** the person chooses a **code to their phone** (then sets a new password) or a **reset link by email** (single use, 30 minutes).
- **Password rules** (NIST SP 800-63B-4 / OWASP): no composition rules; minimum 8 characters (Q22: NIST asks 15 when the password is the only factor), maximum 64 (graphemes), blocklist of common and context-specific values (name, phone, email); show/hide toggle; paste allowed; no forced rotation.
- **Abuse:** one identical message for unknown account and wrong password (no enumeration); 5 failures per account in 15 minutes → 15-minute lock; per-IP limits and Turnstile on the API; password sign-in fails closed when Redis is down (Q18 split).
- **Production design:** Firebase Auth stores the password (scrypt). All password sign-ins go through `POST /v1/auth/password` (looks up phone → account, checks the password with Firebase server-side, enforces limits, mints a Firebase custom token). The API accepts only `phone` and `custom` tokens, so direct Firebase password sign-ins cannot bypass the limits.
- **Encryption:**
  - **In transit:** TLS required on every non-local database connection (`tlsFor`), verify-full with `DATABASE_CA_CERT`; HTTPS/HSTS everywhere.
  - **At rest:** Supabase AES-256 disk and backup encryption.
  - **Field level:** AES-256-GCM (`packages/db/src/crypto.ts`) for sensitive columns: `shops.pan_enc` (+ `pan_index` blind index, unique), `partner_applications.kyc_enc`, `refunds.destination_enc`, `staff_security.totp_secret_enc`. CHECK constraints make Postgres reject plain text in those columns. Keys come from `DATA_ENCRYPTION_KEYS` / `DATA_ENCRYPTION_KEY_ID` / `DATA_INDEX_KEY` (Secret Manager in production, rotation by key id).
  - **Passwords:** hashed, never encrypted or stored by us.
  - Phone and email stay plain (needed for lookups and uniqueness) and are protected by RLS, least-privilege roles, masking for support staff and the at-rest encryption.
- **Demo:** browser-only; passwords hashed with PBKDF2-SHA-256 + random salt via WebCrypto; demo logins use the password `Raipur@2026`, staff code `123456`.

## 2026-11-01 — No wallet; MechDost Coins; no returns or exchanges (user decisions)

- **No wallet** (user: "a wallet … would take some legal stuff"). A money wallet would be an RBI prepaid payment instrument; we avoid it entirely. Refunds always go to the original payment method (bank/UPI for COD); `refunds.mode = 'wallet'` removed.
- **MechDost Coins** instead (user: "a loyalty bonus … coins … used to get discounts"): no cash value, not purchasable or transferable, never paid out, only an order discount. Value per coin and the maximum share of an order are admin settings (defaults ₹1 and 10% of products; never delivery). Coins used on a cancelled/rejected order come back as coins. **How coins are earned and claimed: user decides later (Q24)**; until then admins grant coins by hand (audited). Spec 20.
- **No returns, no exchanges** (user: "a no refund, no exchange policy … only exceptions would be like in case a part is faulty, and this too would be through support tickets"). Change of mind, wrong part ordered or no longer needed → not accepted. **Faulty, damaged or wrong item delivered** → support ticket with photos within the claim window (default 7 days from delivery, Q25) → support replaces or refunds.
- **Required by law and kept:** under the Consumer Protection Act 2019 and E-Commerce Rules 2020, an order we cannot fulfil (rejected, no shop, cancelled before packing) costs the customer nothing (COD) or is refunded in full (online). The policy is shown before purchase on product pages, checkout and `/policies/returns`, linked from the footer.
- Supersedes: spec 05 return/replacement/exchange self-service flows, and spec 17 F "wallet". Q1 partly answered: exchanges = no; disputes and order chat still open.

## 2026-11-01 — Proof of delivery with a customer code (user: "the customer has to verify it by giving the OTP to the delivery guy … like any e-commerce site does")

- When the shop marks an order **out for delivery**, a 4-digit **delivery code** is issued to the customer: on the order page now; SMS/WhatsApp with spec 10.
- The delivery person enters it in the shop portal; **only the right code marks the order delivered**. There is no plain "Mark delivered" any more.
- **5 wrong codes lock it** (stops guessing 10,000 codes); the shop is told to call support.
- **Exception:** staff may confirm without the code only with a written reason (≥ 5 characters), audited in the same transaction and shown on the order ("confirmed by MechDost support").
- **Database:**
  - `shipments.delivery_code_enc` (AES-256-GCM, so the customer can view it again), `delivery_code_attempts` (0–5), `delivered_via` (`code`|`override`), `delivered_at`, `override_reason`, `override_by`.
  - CHECK: status `delivered` requires a verified code or an override with reason + staff.
  - Codes compared in constant time; wrong tries counted with compare-and-set.
  - Migration 0008.
- **Customer safety copy:** "Give this code only after you have received your order and checked the parts"; "MechDost will never ask for this code on a call or message".
- Service requests (workshop pickup/drop) can reuse the same proof later.

## 2026-11-01 — Admin partner controls, research adoption, pricing, maps, ML-ready data (user decisions)

- **Partner pause/suspend** (user: "admin should have complete control … suspend or pause any workshop, seller or mechanic's account"): built for shops, workshops and mechanics with a partner-visible reason and history. Paused = no new orders/bookings, current work continues, still listed ("not taking bookings"). Suspended = hidden from customers, no new work, portal locked with the reason. Reactivate restores. Real DB: `shops.status` gains `paused` with `status_reason`, `status_changed_by/at`, `paused_until` and a CHECK that paused/suspended need a reason; append-only `partner_status_events` (shops now; workshops/mechanics when their tables exist); `setShopStanding` with CAS + history + audit in one transaction.
- **Adopted from research/admin-console.md** (user: "the idea of availability and standing is good, scorecards sounds good, customer blocking seems good"):
  - _Availability_ (partner-controlled busy/holiday) is separate from _standing_ (staff-controlled).
  - _Partner scorecards_ (acceptance, time-to-accept, cancellations, fault claims) are visible to partners, with minimum sample sizes and a human confirming any enforcement.
  - _Customer blocking_ has three levels (COD-only, no orders, full).
  - Still to confirm: pause end dates, the warning ladder and two-admin offboarding (Q28).
- **Supabase plan:** stay on the **free plan for now** (user); revisit Pro before launch or when Realtime quotas bind.
- **Real-time** (research/realtime.md; **transport reopened** by the user the same day: "find alternatives for supabase realtime, maybe our own backend and api … we even have firebase", see research/realtime-alternatives.md; the thin-ping + refetch pattern stays whatever the transport). **Recommendation after the alternatives study:** Firebase Realtime Database as a per-user inbox of thin pings, published by an outbox relay in the pg-boss worker after commit, polling (ETag/304) first and as fallback, all behind a `LivePublisher` adapter; own SSE on Cloud Run is plan B; Supabase Realtime only if we move to Pro. **APPROVED by the user 2026-11-01 ("yeah go with firebase")**; it replaces the 2026-10-31 "Realtime: Supabase" stack line and touch specs 10, 13, 16, 19: Supabase Realtime **Broadcast from the database** (thin "changed" pings on private per-user/shop/workshop/city topics, refetch through the API), cache-tag revalidation for catalogue/content, no connections for anonymous shoppers. Suspension latency (60 s session cache) is open (Q29).
- **Pincode-wise prices** (user: "different shops can have different prices and the order would most probably be routed to the nearest shop … set by the admin portal; will talk more later"): a customer's price for a product = the selling price of the shop that would serve their PIN (nearest covering shop with stock), from `shop_inventory` + `shop_pincodes`; admin sets prices per shop. Details pending (Q26).
- **Product Lens** (barcode scanner) **parked**: "not practical at this stage" (user). Removed from the near-term plan (spec 17 C).
- **Hybrid map** (user: "satellite view + roads and names"): Map/Satellite switch on workshop maps; satellite imagery underneath, OpenFreeMap roads and labels on top. Imagery is configuration (`NEXT_PUBLIC_SATELLITE_TILES` / `_ATTRIBUTION`); the local demo uses Esri World Imagery with its credit; **production needs a licensed provider** (Q27): Esri and MapTiler free tiers are not for commercial use.
- **Password minimum 8 characters** (Q22 answered) with blocklist + lockout; **coins are never paid out**, discount only (user re-confirmed).
- **ML/AI-ready data** (user, "important rule"): hard rule 16 in CLAUDE.md, details in `docs/conventions/data-for-ml.md`.

## 2026-11-01 — Domain: mechdost.com (user)

- The user bought **mechdost.com**. Production web = `https://mechdost.com` (`www` redirects to the apex), API = `https://api.mechdost.com` (Cloud Run custom domain or load balancer), email sender `no-reply@mechdost.com` via Resend; support/grievance mailbox on the same domain later. Earlier placeholders (`mechdost.in`) replaced.
- Setup needs the user's registrar/Vercel/Resend access, so it is queued (Q30): DNS for Vercel and the API, Resend SPF/DKIM/DMARC, CAA, HSTS preload only after launch, and Firebase authorised domains + email action links on the domain.
- **Promotions & referrals research** written (`docs/research/promotions-referrals.md`): one campaign engine with a fixed discount order, the 1 Jan 2027 E-Commerce Amendment Rules (30-day prior price, "Sponsored" labels, dark-pattern self-audit; daily price history must start by 1 Dec 2026), referral rewards paid in coins after delivery-code confirmation and a hold, layered abuse controls and DB uniqueness. Owner questions Q31–Q46. Not built yet. **Referrals are on hold**: the user will discuss referral codes later (Q47); nothing referral-related is built until then.

## 2026-11-01 — WhatsApp research (user asked: "is it better if we just get our own meta api and use their costing?")

- Study: `docs/research/whatsapp.md`. **Recommendation (pending the user, Q49–Q63):** Meta WhatsApp Cloud API **direct** for transactional/utility and later OTP (no markup, no monthly fee, Meta-hosted; we add a signed webhook route to the Hono API and an adapter behind the notification outbox); inbound WhatsApp messages become support tickets in the admin console (would settle Q9); marketing later via Meta's Marketing Messages API with opt-in. BSP (MSG91, else Interakt) only if a no-code inbox/campaign tool or keeping the existing Business-app number is wanted.
- Prices before GST (from providers quoting Meta's INR card; Meta's own file did not load — verify): utility ≈ ₹0.115, authentication ≈ ₹0.115, marketing ≈ ₹0.863 per delivered message. Est. direct cost ≈ ₹0.6k / ₹6.3k / ₹64k per month transactional-only at 1k / 10k / 100k orders.
- Deadlines if adopted: business verification (limit 250 → 2,000 users/day), India local storage set before number registration, Meta billing in INR by 31 Dec 2026.
- Supersedes the earlier assumption "WhatsApp via MSG91" (line in the stack section) once the user rules.
- **2026-11-02 RULING (user: "i want the cheapest option for the whatsapp messages"): Meta WhatsApp Cloud API direct.** No BSP fee or markup. MSG91 remains for SMS/DLT only (pending #6 narrows to SMS). Cost rules that follow: utility templates for order updates (never marketing category for transactional), the free 1,000 service replies per month used for support, in-app/email/push first and WhatsApp only for events the customer must act on (order confirmed, out for delivery + delivery code, estimate approval, ticket reply); marketing off at launch.

## 2026-11-02 — Hindi everywhere: content data, map labels, coverage gate (user: "its in hindi but i still see quite some stuff in english … it shouldnt happen anywhere … have it properly checked from now on")

- **Rule (CLAUDE.md hard rule 10):** on `/hi` nothing user-visible is English except brand/model names, units and technical tokens, codes, "MechDost" and user-typed text. Business and locality names are transliterated (user). Details and the allowlist: `docs/design-system.md` § Hindi content.
- **Demo content:** per-locale overlays next to the data (`apps/web/src/demo/i18n/hi.ts`: `PRODUCT_HI`, `SERVICE_HI`, `WORKSHOP_HI`, `SHOP_HI`, `AREA_HI`, `DAY_HI`) + typed helpers (`localize.ts`: `localizeProduct/Workshop/Shop/Service/Area/Hours`, `productNameFor`… for snapshots). Snapshots (orders, requests, quotes) keep the English text they were created with; screens look the translation up by stable id. Search matches English and Hindi in both locales.
- **Localised content columns (real DB):** per-locale **column pairs** (`name` + `name_hi`, `description` + `description_hi`, `title_hi`, `address_hi`, `highlights_hi`…) on the tables that hold customer-visible text, not a generic `translations` table. Why: two fixed launch languages; columns are typed, NOT NULL-able, indexable in the same `tsvector` (bilingual search without joins), cheap to read (no join per list row) and obvious in admin editors (en/hi side by side, missing Hindi flagged). Revisit (move to `jsonb` per field or a `content_translations(entity, id, field, locale, text)` table) only if a third language is planned. Specs 02 and 06 list the fields. **Migration 0017 (2026-11-03):** `products.spec_summary/_hi`, `compatibility/_hi`, `highlights/highlights_hi` (text[], CHECK ≤ 8 and Hindi list empty or aligned line by line), `shops.name_hi`, `address_line_hi` (categories/products already had `name_hi`/`description_hi`); repo `missingHindi()` lists what still shows English on /hi for the admin editors, `localized(en, hi, locale)` is the API fallback. Workshop/area/service `_hi` columns come with their tables (Phase 2).
- **Map labels:** `localizeLabels(style, locale)` prefers `name:hi` then `name` (Hindi) / `name:en`, `name_en`, `name` (English); refs stay. Devanagari renders via the browser (MapLibre 6.16 ≥ 6.15), no glyph change. Roads without `name:hi` in OSM keep their local name (inbox Q64, default: show).
- **Gate:** `apps/web/e2e/hindi-coverage.spec.ts` (every `/hi` page incl. signed-in customer/shop/workshop/admin with seeded records; fails with page + words) + `test/content-i18n.test.ts` + `test/map-styles.test.ts`. User-typed text is marked `data-user-content`; deliberately English text carries `lang="en"`.
- Copy fixes found by the gate: footer operator name and registered office (now per locale via `companyFacts`), "MechDost Partner" eyebrow (was inline), address card "Raipur" (was inline), MapLibre popup close/marker/feedback labels, "FAQ" → "सवाल-जवाब", account phone note no longer names the vendor (Firebase) in either language; default address label stored empty and shown translated ("Home"/"घर").

## 2026-11-03 — Rulings made while building Phase 1 server pieces (recorded so they are not decided twice)

- **PIN price = nearest covering shop with stock** (decision 2026-11-01, Q26 default) is what the catalogue and checkout APIs implement; spec 02 had drifted to "lowest" and was corrected. Without a PIN the city "From ₹" is the lowest buyable offer.
- **Web storefront switches to the APIs as one piece:** shop/product pages, cart and checkout move to the catalogue/checkout APIs together, after web sign-in (Firebase). A partial switch would show two different prices (API nearest-shop price vs demo cart price).
- **Catalogue editor screen waits for sign-in:** the editor API exists (en/hi side by side, publish via `productMachine`); the demo storefront is prerendered from built-in data, so a browser-only editor could not change it and would mislead a demo.
- **Customer blocking:** levels cod_only / orders / full with reason codes (`packages/shared/src/customers.ts`); only customer accounts (never staff; partners not fully); all-cities grant until customers carry a home city; `customers:block` stays super-admin only until Q65.
- **Cancellation windows:** customer until the shop packs (orders) / until the workshop has the vehicle (bookings); staff also once packed; every cancel and reject carries a reason code (`ORDER_CANCEL_REASONS`, `ORDER_REJECT_REASONS`, `SERVICE_CANCEL_REASONS`).
- **Accept timer default 15 min** (demo value) for the API too (`orders.acceptance_timeout_min`, admin-editable); COD reservations last until the order is accepted, rejected or cancelled (no 15-minute expiry for placed COD orders).
- **Analytics:** server events written in the business transaction (exactly once); web events only after the privacy choice "Allow analytics" (DPDP, notice version `2026-11`), validated by one shared registry; free-text search scrubbed of phone numbers and emails on both ends.
- **Code review fixes (2026-11-03):** the order row is always locked first (no deadlocks between cancel, accept, expiry and routing); the COD fee rides on the first sub-order (so a shop collects it and totals reconcile; who keeps it is Q66); analytics paths keep only the pathname and ids must be short codes; every table with `version`/`updated_at` gets its triggers (0031) and a test enforces it.
- **JS budget (2026-11-03):** next-intl's navigation helpers are not used (they shipped the ICU formatter on every page); links are built with `localePath()` / `<LocalLink>` and lint forbids `next-intl/navigation`. Budget measured with `apps/web/scripts/measure-js.mjs` (page's own scripts).
- **CI and dependency updates (2026-11-03):** GitHub Actions `CI` (`.github/workflows/ci.yml`) runs Prettier, typecheck, lint and unit tests on every push/PR — actions pinned by commit SHA (no release younger than 3 days), read-only token, no persisted credentials, frozen lockfile. Updates via **Dependabot** (`.github/dependabot.yml`, as spec 13 says; the ledger's "Renovate" was a drift) with a 3-day cooldown matching pnpm's `minimumReleaseAge`. e2e/Lighthouse/visual jobs join once a preview deploy exists.
- **Privacy notice** `/policies/privacy` written from what the product does (the concept's text was outdated); grievance officer details follow Q15.

## 2026-11-09 — Password sign-in API: rulings while building (advisor brief 2026-11-09)

- **Staff two-step is enforced by the API, not the client.** Phone-code tokens stay valid for everyone (sign-up and the phone reset need them), so a phone code alone must not open the admin side: staff grants count only for a session minted by both steps (`staff_2fa` claim, ≤ 12 h old, spec 13). The second step re-sends the password with the fresh phone token (no extra server secret or ticket table).
- **Staff = any grant not tied to a shop or workshop** (`isStaffGrant`), so admin-made roles are covered without a code list (L17).
- **Turnstile on every password sign-in** (not only after 3 failures as spec 01 first said): one rule, no hidden second state; Cloudflare's test keys in development.
- **Per-IP limit 60 per hour** on password sign-in (spec 01's 20/IP/hour is for OTP sends; Indian mobile networks put many users behind one IP, CGNAT). Per-identifier lock stays 5 failures / 15 minutes.
- **Firebase Admin signs custom tokens locally with the key file in development**; production has no key file and signs through IAM (runbook `docs/runbooks/firebase.md`).
- **Real vs demo sign-in on the web:** pending Q69 (default: a switch, demo on deployed demos, Firebase locally). Built as `NEXT_PUBLIC_AUTH_MODE` (demo when unset).
- **Web uses `@firebase/app` + `@firebase/auth` only**, not the `firebase` umbrella package: the umbrella pulls Firestore → `@grpc/grpc-js` (1 high + 1 low advisory, Node-only code we never run). Same versions as firebase 13.2.0.
- **Password reset email link lasts 60 minutes** in real mode (Firebase's fixed lifetime) instead of spec 01's 30; the screens say 60. Revisit with a custom action handler on our domain (Q30).
- **After a password is linked or changed, the browser signs in again through the API** (Firebase marks such sessions `password`, which the API refuses so its limits cannot be skipped). The API looks up the password's email in Firebase when the profile has none yet (fresh sign-up); only those accounts make that extra call.
- **`firebase-tools` runs through `pnpm dlx` at an exact version**, not as a dependency (66 direct dependencies; only the Auth Emulator is used, for tests).
- **Real partners land on the account area** (not the demo shop/workshop portals, which have no real shop behind them) until the portals move to the API; real staff land on admin (staff roles are only listed for a two-step session).
- **Every new sign-in reloads roles, status and blocks** (found by the staff e2e): the API's 60 s per-instance session cache is keyed by the token's sign-in time too, so a role granted, removed or a block set a moment ago applies at the person's next sign-in on every instance; token refreshes within one sign-in still use the cache (spec 13).
- **The first super_admin is made from the command line**: `pnpm db:grant-role --phone +91… --role super_admin --reason "…"` (staff roles only; audited as a system grant). Nobody can grant roles in the app before one exists; the real sign-in e2e uses the same command.

## 2026-11-09 — Content-Security-Policy: allow-list site-wide, nonce later only on /login

- Next 16 can put nonces only on pages rendered per request ("all pages must be dynamically rendered", bundled docs `content-security-policy.md`), which would end static pages, CDN caching and our speed budgets. Hash-based CSP (SRI) is still experimental.
- **Site-wide: an allow-list CSP** built by `apps/web/src/lib/csp.ts` (unit-tested, applied in `next.config.ts`): scripts, connections, frames and workers only from this site, the map hosts (OpenFreeMap, Esri), the API, and — in real sign-in mode only — Turnstile, reCAPTCHA and Firebase Auth; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`. `'unsafe-inline'` stays for scripts and styles (Next's inline bootstrap, inlined CSS), so the policy limits _where_ code and data can come from and go to, not inline injection.
- **Built the same day: strict policy on `/login` in real mode.** The proxy makes a fresh nonce per request, puts it in the request header Next reads while rendering (next-intl forwards request headers) and sends the policy `script-src 'self' 'nonce-…' 'strict-dynamic'` + the exact SHA-256 hashes of the root layout's two fixed inline scripts (theme, home layout: the shared layout cannot read a nonce without making every page dynamic). Only that page renders per request in real mode; in demo mode it stays prerendered. Checked: 18/18 framework scripts carry the nonce, a new nonce per request, real sign-in e2e 4/4 with no violations.
- Verified: page audit 201 + demo flows 33 (maps) with no violations; real-mode e2e fails on any violation and passes. Not covered by the emulator: Google's real reCAPTCHA scripts → manual check on the real project before launch (runbook firebase.md).

## 2026-11-10 — Storefront on the API: data switch and catalogue wiring (advisor brief 2026-11-10)

- **`NEXT_PUBLIC_DATA_MODE` = `api` | `demo`** (Q70 default; anything else = demo). The catalogue and search are built on the API behind it; cart and checkout follow. It stays `demo` on every deploy until cart + checkout use the API, because the demo cart's prices differ from the API's nearest-shop offers.
- **Catalogue DTOs live in `@mechdost/shared/catalogue`** (moved from the API route; the API adds OpenAPI names). Hard rule: Zod DTOs in packages/shared are the single source.
- **No build-time dependency on the API**; server fetches state `revalidate` + tags and throw on failure (ISR keeps the last good page). Spec 16 § Server-side data.
- **Unknown facts are left out, never shown blank** (a11y review): no price → "Ask about this product" on WhatsApp instead of add to cart; "Fitment not listed" replaces spec 02's "Check fitment" (read as a command).
- **Before the switch goes on anywhere**, rate limits must stay per shopper for the web's server-to-API calls (the shared web-server IP would throttle all shoppers together, and one shared bucket could be exhausted by one client): the web forwards the shopper's IP in a header the API trusts only from the web, and limits its own "Load more" server function and searches per IP (spec 16).

## 2026-11-11 — Whole-repo review follow-up (user answers)

User: "review the bugs properly and start working on it … implement the tooling fixes and the features … for both two wheelers, three wheelers and cars, yeah will add whatsapp order updates and confirmation before cash on delivery, meta whatsapp messaging … is in the verifying stage … send a photo of your part … a bit later … buy a battery or tyre with fitting included eh not really for us as of now".

- **Bugs:** re-verify every finding of `docs/research/repo-review-2026-11-11.md` with a failing test, then fix; a finding that cannot be made to fail is closed, not fixed.
- **Tooling (Q72 approved):** shared `.claude/settings.json` (commit attribution off, secret files unreadable, hooks), `commit-msg` and secret-file git hooks, CI build + demo e2e + Node from `.nvmrc`. Global settings and plugin enablement stay with the user.
- **Vehicles first-class for two-wheelers, three-wheelers and cars** (`vehicle_models.vehicle_type` 2W/3W/4W already in the schema): fitment and "Fits your vehicle" cover all three. The vehicle master source stays Q10; any seed is labelled demo data until then (no fitment written from memory).
- **WhatsApp order updates + WhatsApp confirmation before cash on delivery** replace the SMS-OTP COD confirmation sketched in spec 03. Meta WhatsApp Cloud API is in business verification, so sending stays off until templates are approved; the confirmation step ships behind an admin setting that defaults **off** (otherwise every COD order would stall). Timeout/behaviour: Q74.
- **Later:** "send a photo of your part" quote request. **Not for now:** buy a battery/tyre with fitting included.
- **Root error page (2026-11-12 ruling):** a focused message and "Try again" only. The "Reset saved data" button planned in the review fix was dropped: it pushed every page over the 180 KB JS budget (error boundaries ship with every route), and B11 already drops corrupt saved data on read. Strings reach it through a JSON data block in the layout, not the i18n runtime.
- **Correction:** `price_history_daily` (review A5) is needed 30 days before the first production price reduction, not by a fixed 1 Dec 2026 date (nothing is deployed yet); it is built before launch.

## 2026-11-12 — Razorpay Standard Checkout (user)

User shared Razorpay **test** keys and asked to "see how we have the stuff for razorpay and integrate it"; chose option 1 ("backend now, pay button with the real checkout").

- **Q2 answered: cash on delivery + Razorpay** at launch.
- **Q8 answered:** test keys received; they live only in the git-ignored `.env` (the user adds them; never committed, never in code). The webhook secret is still to come.
- **No Razorpay SDK:** two REST calls with `fetch` (dependency policy).
- Online totals carry no COD fee.
- An online order holds stock for 30 minutes (admin setting) and is never routed before it is paid.
- A valid checkout signature alone never marks an order paid: the server fetches the payment from Razorpay first (Razorpay docs).

## 2026-11-14 — Real-API launch on Monday 2026-11-16 (user)

- **Switch the website to real sign-in and the API** (user: "switch on the real api"); launch Monday, scope **everything including workshops and service requests, risk accepted** (plan `docs/superpowers/plans/2026-11-14-real-api-launch.md`).
- **Database:** keep the `mechdost-dev` Supabase project for production; **full reset** done 2026-11-14 with the user's approval (no real data: Firebase had 0 users, the 2 orders were Razorpay tests). Rebuilt from migrations; RBAC seed; Raipur, 5 PIN codes and 9 categories kept from the reference data; no products, shops, users or orders.

## 2026-11-14 (evening) — Quotes, coins and reviews are built on the API before launch (user: "BUILD ALL OF THEM WE NEED THEM ALL")

- This overrides the earlier "hidden in real mode" ruling for these three features. Each one gets its API, its real-mode screens and tests, built by parallel agents. Migration numbers: quotes 0045, reviews 0046, coins 0047, each only if needed.
- **Payments at launch:** the user chose cash on delivery plus Razorpay with the test key. The API refuses test keys in production, a deliberate guard, so the copied keys took the API down for about 6 minutes. They are disabled on the server, and the public key variable was removed from GitHub. Launch is **cash on delivery only until live keys** unless the user decides otherwise (asked 2026-11-14). The webhook secret is generated and kept in the local `.env` (and disabled on the server with the keys).
- **Smoke test:** run the emulator end-to-end test against the launch backend, then reset the data before the real catalogue goes in. Only when the user says so.

## 2026-11-14 (night) — Customers order with a verified phone; email verification is an admin setting

- Supersedes the early rule "phone and email verified before the first order" for **customers only**. The new setting `customers.require_verified_email` is off by default. Many Raipur customers rarely use email, and requiring it would block cash-on-delivery orders.
- Staff and partner actions still need both.
- Spec 01 has the details.

## 2026-11-14 — Launch scope in real mode: features with no API are hidden (ruling under "Everything, accept risk")

- **Hidden in real mode** (`BROWSER_ONLY_FEATURES` in `apps/web/src/lib/data-mode.ts`): bulk quotes (spec 19), MechDost Coins (spec 20) and customer reviews. None has an API yet, and in real mode anything a customer typed there would stay on their device only.
  - Account and admin sections drop out of navigation and their routes 404.
  - Links to `/quotes/new` are removed (product page, cart, home, footer).
  - The assistant's bulk answer opens WhatsApp instead.
  - Review sections render nothing.
  - Checkout already skips coins in real mode.
- **Demo controls** (Q86) are hidden by `SHOW_DEMO_CONTROLS`, which is the same switch.
- **Switches:** customer screens follow `NEXT_PUBLIC_DATA_MODE=api`; portals follow `NEXT_PUBLIC_AUTH_MODE=firebase`. Launch flips both, and mixed combinations are not supported.
- **Cost if wrong:** bulk buyers lose the form until the quote API ships. They can still reach us on WhatsApp. Policy pages still describe coins as a planned feature.
- **Update 2026-11-14:** bulk quotes now run on the API and are shown again in real mode (own flag `QUOTES_ON_API` / `QUOTES_AVAILABLE`); see "Bulk quotes on the API".

## 2026-11-14 — Bulk quotes on the API (spec 19 "Built: API + real mode")

Rulings taken while building (spec 19 followed; where the code had to differ, the reason; cost if wrong in brackets):

- **Order link on the order group, not the sub-order:** spec 19 says UNIQUE `orders.quote_offer_id`, but one checkout is an `order_groups` row split into per-shop sub-orders, so the link is `order_groups.quote_id` + `quote_offer_id` with a partial unique index on each: exactly one order per quote and per offer. (cheap)
- **Table name `quote_requests`** as in the spec; offers `quote_offers` with one `active` per quote (partial unique). (—)
- **A customer message on an offered quote reopens talks** (spec: "`offered → negotiating` when a new message reopens talks (old offer superseded)"): the active offer is superseded and the thread shows a hint before sending. A **staff** message leaves the offer active (staff revise by sending a new offer). The demo kept the offer on any message; the API follows the spec. (cheap: one transition)
- **Payment: cash on delivery only** for accepted quotes at launch (lead's scope; spec says "COD/online per settings"). The offer stores `payment_method = 'cod'` (CHECK, extensible). **No COD fee and no COD cap** on a quote order: staff agreed the total with the customer; the PIN's COD rule and customer blocks still apply. Online payment for quotes → PENDING #18. (medium: a big order paid on delivery)
- **Negotiated prices may sit below the shop's approved price** (`order_items.price_source = 'quote'` relaxes the `shop_unit ≤ unit` CHECK): the shop is paid its approved price and MechDost carries the difference. (medium: margin; staff see the catalogue total and the discount while offering)
- **Delivery:** the offer's delivery charge rides on the first sub-order (like the COD fee). The catalogue free-delivery rule does not apply to quotes. (cheap)
- **Minimum units → 400** at the API (spec acceptance test), from the admin setting `quotes.min_units` (default 10, city override allowed; Admin → Settings shows it in units). Quantity per line 1–99 (an accepted quote becomes a normal order). (cheap)
- **Limits:** 3 open quotes per customer, 20 quote requests per hour, 30 customer messages per quote per hour, accept 20 per 10 min. (cheap)
- **Expiry:** an offer is valid 1–30 days; when it runs out the worker closes the quote as `expired` (`offer_expired`); a quote nobody writes on for 30 days expires as `inactive`. (cheap)
- **Staff:** new permissions `quotes:read` and `quotes:negotiate` (ops manager, city manager, super admin; city managers only in their city), `quotes:request` for customers. Migration 0049 inserts them for the system roles so the desk works before `pnpm db:seed` runs. Staff see the contact phone masked to the last 4 digits. (cheap)
- **Notifications:** live pings (customer + city staff) and an email when an offer is sent (verified addresses only); no new WhatsApp template until Meta approval. (cheap)
- **Review fixes before merge (2026-11-14):** quote lines carry `order_items.cost_ceiling_paise` (the catalogue price at checkout) and routing compares shops against it, not the negotiated price; routing snapshots the routed shop's price into `shop_unit_paise`; shop views show the shop's own price, its payout and the cash to collect, never the customer price. Staff must tick a confirmation (API: `confirmLowPrices`) for a price below the shop price or under a tenth of list. New setting `quotes.cod_cap_paise` (default ₹50,000): above it a quote cannot be accepted cash on delivery. **Supersedes "Expiry" above:** an offer that runs out reopens talks (quote back to `negotiating`, offer `expired`); only 30 days without a message expire the quote. Customers with an `orders`/`cod_only` block cannot ask for a quote. (cheap; medium for the COD ceiling: big buyers wait for online payment, #18)
- **List price snapshot:** each line keeps the catalogue price per unit for the PIN at request time (nearest shop with stock for one unit; null = price on request); the quote keeps the total when every line has one. Information only (Q20). (—)

## 2026-11-14 — Adding products: admin form and CSV import (plan 2026-11-14, Stream B)

The reset database has no products, so staff add them (runbook `docs/runbooks/catalogue-import.md`). Rulings taken while building (cost if wrong in brackets):

- **Permissions:** the form needs `products:write`; the import needs `products:import` (the RBAC catalogue already had it; `catalogue_manager` and `super_admin` hold both). Creating as **live** needs `products:publish` too and goes through `productMachine` (draft → live); otherwise products start as drafts. (cheap: one middleware line)
- **CSV in rupees and per cent** (`mrp_rupees`, `gst_rate_percent`), converted exactly to integer paise / basis points by string parsing (`toPaise`, `percentToBp`); the JSON API takes `mrpPaise` / `gstRateBp`. Staff type rupees, never paise. (cheap)
- **GST slabs accepted:** 0, 5, 12, 18, 28, 40 % (`PRODUCT_GST_RATES_BP`), the old slabs kept so a product is never blocked by the GST 2.0 change. (cheap)
- **All or nothing:** every row is checked first (file shape, Zod body, catalogue rules); any problem → nothing written, every problem listed by row and column. A **dry run** ("Check file") is the first step in the screen. Valid rows go in **one transaction** under an advisory lock shared with the form, so concurrent imports cannot race on a slug or SKU.
- **Idempotent on SKU:** SKUs already in the catalogue are reported as skipped, never updated (updates stay in the editor, versioned). A slug already used by another product is an error (`SLUG_TAKEN`), not auto-suffixed — two products with the same brand + name need distinct names. (cheap: suffixing can be added)
- **Brands are created on the fly** from the brand name (slug of the name), audited `brand.created`; a brand editor comes later. (cheap)
- **Limits:** 500 rows and 300,000 characters per file, 30 checks/imports per person per hour (`catalogue_import` rate rule).
- **CSV only** for the import endpoint (no JSON rows): scripts can call the single-product endpoint. (cheap to add)
- CSV parsing is our own RFC 4180 reader in `@mechdost/shared/catalogue-import` (no new dependency).

## 2026-11-14 — Cart stepper and editable vehicles (user)

- **Quantity on the product card** (user: "just like swiggy or amazon"): after "Add to cart" the button becomes − / count / +; − at one removes the product (spec 03).
- **Saved vehicles can be edited** (user: "no option to edit the already added vehicles"), in place, one form at a time (spec 01).

## 2026-11-14 — Security review of 20 attack classes and fixes (user: "fix the other security stuff too")

Full review and evidence: `docs/research/security-vulnerabilities.md` § Review 2026-11-14. Decisions taken:

- **Token revocation is checked whenever a session is loaded**, on every route (once per 60-s cache period per user per instance), not only on chosen routes — a revoked or disabled account stops working within a minute everywhere, at one Firebase call per user per minute.
- **A staff phone code finishes one staff sign-in** (`STAFF_CODE_USED` on a replay; fails closed without Redis).
- **Sign-in emails are printable ASCII only** (no normalisation of look-alikes: they are refused).
- **Firebase admin credentials on the AWS server** (Q93, user: "just push it there too"): the project's service-account key is a server-only file mounted at `/run/secrets/firebase-admin.json`; production accepts a key file only from `/run/secrets/`. Replaces the 2026-11-13 "no key files (Cloud Run)" rule, which no longer applies on AWS.
- **AI assistant site-wide daily budget**: admin setting `assistant.daily_messages` (default 500, 0 = off). Turnstile follows with the web transport.
- **Docker images follow `.nvmrc`** (Node 24.22.3), enforced by a test; RLS on every table, no RLS-bypassing views and no client-role privileges enforced by a schema test.
- Answered later the same day: **Q90** keep first-come email ownership ("if a person has added an email then another person cant add it"); **Q92** no Cloudflare in front of the site for now. Still open: Q91 assistant Turnstile (with the web transport).
- **Admin prices plan complete (Task 6, docs):** customer price = PIN price, else city price, else (interim, Q83) the shop's price; never above MRP or below what a shop is paid; routing only to shops at or below the customer price; `order_items.shop_unit_paise` keeps the margin; `prices:write` for super_admin, ops_manager, finance (specs 02, 04, 08, 13, 14; runbook firebase.md).

## 2026-11-14 — Monitoring: Sentry (EU) and PostHog EU cloud, server-side (user: "lets do posthog on eu and sentry aswell")

Supersedes the 2026-10-31 "self-hosted PostHog … via the PostHog SDK; session replay, feature flags" line: no self-hosted PostHog, no posthog-js, no session replay and no PostHog feature flags for now. Runbook `runbooks/monitoring.md`; specs 08, 12, 16.

- **PostHog EU cloud, forwarded by the worker only.** The first-party event store stays the source of truth. The worker reads it every 10 s (rows older than 60 s, in-memory cursor; after a restart it starts 10 minutes back and PostHog drops duplicates by `uuid`) and posts batches of 100 to `POSTHOG_HOST/batch/` (default `https://eu.i.posthog.com`) with plain `fetch` — no `posthog-node`. Up to 3 attempts for network errors, 429 and 5xx; then the batch is dropped with a log line and a count. Never on a request path; unset `POSTHOG_KEY` = off.
- **Privacy rules for forwarding** (DPDP, hard rule 16): web events only when stored with analytics consent **given under notice `2026-11-14` or later** (the first notice that names PostHog; the web's `CONSENT_VERSION` moved to it, so earlier choices are asked again); distinct id = the random visitor id; every event personless (`$process_person_profile: false`) with GeoIP off; props scrubbed again (personal keys, free text, emails, phone-like numbers, coordinates, user/customer ids, strings > 200 dropped; search text → `query_length`). **Server events carry no user** (the server does not know the person's consent): one fixed id `mechdost-server`, business codes, ids of shops/cities and paise only. `page_view` arrives as `$pageview` with `$pathname` so PostHog web analytics works. [low: user-level funnels across web and server events need identify + consent sync later]
- **Sentry, EU region** (`*.ingest.de.sentry.io`, API `https://de.sentry.io`). SDKs **v10.78.0** (`@sentry/node` for the API, the worker and the website's server; `@sentry/browser` for the browser), not v11: v11 (latest 11.12.0, 2026-11-10) replaces `sendDefaultPii` with `dataCollection`, whose defaults collect cookies, bodies and user info; we stay on the v10 line (maintained, 17 days old) and move with an explicit `dataCollection` later. `@sentry/nextjs` is not used: it wraps the build (rollup, babel, webpack plugin) and adds router tracing we do not want; errors-only needs its two underlying SDKs. Build-only `@sentry/cli` 2.58.6 uploads the website's source maps; its postinstall download is denied (`allowBuilds`), the binary comes from its platform package.
- **Errors only, nothing personal**: `sendDefaultPii: false`, no tracing, no OpenTelemetry setup, no breadcrumbs, no sessions or replay; `beforeSend` = `scrubErrorEvent` (`@mechdost/shared/error-scrub`): no user, host name, request body, headers, cookies or query string; messages without emails, phone-like numbers, tokens, or the SQL + parameters database errors embed. API: exceptions the error handler cannot map (500s) plus every `log('error', …)` line (throttled to one per message per 10 minutes, so a failing loop cannot use up the quota). Website server: Next's `onRequestError`. Browser: **the SDK loads only after the first error** (two listeners and a queue ship with every page, ~0.5 KB), at most 10 reports per page; error boundaries report too. Error reports are essential processing (named in the privacy notice, no consent purpose).
- **Source maps**: only in the Deploy workflow, inside the website's Docker build, when the `SENTRY_AUTH_TOKEN` secret is set (BuildKit secret, never a build argument or layer); maps are uploaded for the release (= commit) and deleted in the same step; `.map` files are always removed from `.next/static`, so they are never served. The API image runs with `--enable-source-maps` (TypeScript frames in Sentry and logs).
- **CSP**: `connect-src` gains the ingest origin derived from `NEXT_PUBLIC_SENTRY_DSN` (https, `*.sentry.io` only), nothing when unset. `NEXT_PUBLIC_POSTHOG_*` build arguments removed (no browser key).
- **Admin → Errors** (user chose it): real sign-in only; the API reads the latest unresolved issues of both projects (`GET /v1/admin/errors`) with a read-only Internal Integration token (`SENTRY_API_TOKEN`; not the CI token), cached 60 s, counts/dates/links only, titles scrubbed. Permission: **`settings:read` with an all-cities grant** (super admin, operations manager) instead of a new `errors:read`: a new permission only reaches production with an RBAC sync (seed), which this launch change does not run. [low: city managers see nothing; a dedicated permission later]
- **Names** (user, 2026-11-14): org `mechdost`; website project slug `mechdost-api` (named by accident; it is the website), API project `mechdost-api-actual`.
- **Review fixes (code review 2026-11-14):** (1) server events forward their **pseudonymous public codes and row ids** (`orderCode`, `requestCode`, `shopId`, `workshopId`, …): they identify rows in our database, not a person to PostHog; the scrubbers now keep ids, because ~26 % of UUID v7s contained digit runs the phone mask removed. **Narrowed by the security review the same night:** only ids we issue, exactly (`isPseudonymousId`): lowercase UUIDs with version 1–8, variant 8–b and at least one hex letter; codes with our prefixes (MD, SR, REQ, QT, PA), year 20xx and a tail with at least one letter. **An all-digit code tail (`MD-RPR-2026-234567`, ~0.1 % of codes) or a letter-less UUID (~0.02 %) is masked like a phone number** — the safe side, since such a string could carry a number. In analytics props the exemption applies **only under id keys** (`id`, `ids`, `code`, `codes`, or names ending in Id/Ids/Code/Codes); any other key is free text and stays masked even when the value looks like an id. **Then by source (second security review, same night):** a UUID-shaped string with a single hex letter can still carry a phone number across its groups (`98765432-10ab-7…`), so the UUID exemption applies only to **server events** (props written by our code with database-issued ids). **Web/app event props get no id exemption at all**: their UUIDs go through the plain digit-run mask, so the ~30 % of client-supplied v7 ids with a 7+ digit run are dropped from PostHog (accepted: client ids are a small part of the analytics value, and they stay in our own event store). Server-side validation that the id exists was rejected as more code for no gain over that. **Error text keeps only public codes** (at most a 9-digit run); embedded UUIDs get the plain digit-run rule (our messages rarely need raw ids). User/customer/staff ids are still dropped by key. (2) Migration **0053** indexes `events (received_at, id)` for the forwarder. (3) Error text also loses URL query strings, Postgres-echoed input (`syntax for type …:`, `Key (…)=(…)`) and stack-frame query strings; ids inside messages are kept. (4) The forwarder never rejects: a bad row is skipped, a throwing sender counts as dropped, anything else logs `posthog_tick_failed`. Also: Sentry Node SDKs run with `registerEsmLoaderHooks: false`; `app/global-error.tsx` reports errors and shows the remembered error copy; browser listeners start when their module loads (before hydration).

## 2026-11-14 — Workshops backend (real-API launch, stream A; rulings, cost if wrong in brackets)

- **Bookable = published ∧ location verified ∧ standing approved ∧ not busy** — the only workshops listed, bookable or assignable by staff (admin reassign included). Staff-created workshops start `approved` (standing) but unpublished; publishing or vouching for the pin needs `partners:approve`, other edits `partners:write`. [low: one flag]
- **Proposals use the demo's three parts of the day** (morning / afternoon / evening) instead of hourly `workshop_slots` with capacity; slot capacity, the acceptance timeout for `awaiting_workshop` and customer reschedule come later (spec 06 "Not built yet"). [medium: a slot-capacity migration later]
- **A workshop decline detaches the workshop** (`workshop_id` null in `needs_routing`), so it no longer sees the request; who declined and why stays in `service_events` (staff only). [low]
- **Odometer history key** = the saved vehicle's id, else the normalised vehicle text, per customer. [low: free-text spelling changes start a new history]
- **Service bills are frozen snapshots without a gapless GST invoice number** for now: the workshop is the supplier and issues its own tax invoice; whether MechDost numbers service bills (spec 06 "gapless series") is queued with the payout model (pending #9). [medium if MechDost must invoice]
- **Paid at the workshop** completes the job in one step (`billed → paid` by the workshop, `paid → completed` by the system), as the demo. Online payment of bills later.
- **`user_roles.workshop_id` gets its FK** to `workshops` (it had none because the table did not exist).
- **Zod-free constants for the db layer**: `SERVICE_CUSTOMER_CANCELLABLE` and `ESTIMATE_SENDABLE_FROM` live in `@mechdost/shared/state`; the db package must not import the Zod DTO module at runtime, or its schemas are built before `@hono/zod-openapi` extends Zod and lose `.openapi()` (found by the API test).

## 2026-11-14 — Service-area PIN codes, admin-configurable (user: "do all Raipur PINs but make it admin configurable"; "admin configurable per shop or per pincode")

Advisor brief 2026-11-14; spec 15 "PIN codes", spec 03 "Delivery charges". Rulings (cost if wrong in brackets):

- **One master switch `pincodes.active`** decides serviceability for parts and services. Spec 15's model lists
  per-service flags (`serviceable_for {parts_delivery, doorstep_service, pickup_drop, rsa}`); those columns stay,
  unread, until a service is offered in some PINs and not others. [Low: one migration and a filter per flow later.]
- **Inactive = unknown** for new business (checkout, catalogue PIN price, nearby workshops, new service requests,
  new shop coverage); existing orders, coverage rows and partner addresses are untouched. Rows are never deleted.
- **Reason code + optional note** to switch off (rule 16); switching on needs a centroid. History = `audit_log`
  (no separate `pincode_events` table: there is no state machine). [Low.]
- **Permissions:** read with `settings:read`, write with the existing `cities:manage` ("Launch cities and manage
  pincodes": super admin; city manager for their city). No new permission. [Low.]
- **`source` column:** the reference seed refreshes only rows it added (`seed`); any admin write makes a row
  `admin` and the seed never touches it again; the seed never switches a PIN on or off. [Low.]
- **Sanity checks:** centroid inside India's box (Zod) and ≤ 150 km from the city centre (`PINCODE_FAR_FROM_CITY`);
  Hindi area name must contain Devanagari (rule 10).
- **Reference data:** Raipur's urban PINs active, the rest of Raipur district loaded switched off
  (`outside_service_area`) so the admin can switch them on; PINs that could not be verified are left out
  (`docs/research/raipur-pincodes.md`).
- **Free delivery chain:** PIN `free_delivery_min_paise` ?? shop override ?? city setting; NULL = no override,
  0 = always free.
- **Migration number 0048** (0045–0047 reserved for streams merging in parallel).

## 2026-11-14 — Cart on sign-out, demo controls, demo service estimates and bills (user)

- **Cart and compare list stay on sign-out** (Q85): they belong to the device, as for a guest.
- **Demo-only controls are hidden before launch** (Q86): "advance", "demo reply", "demo offer" — launch checklist item.
- **The demo gets the service estimate and bill** (user: "add the service estimates and billing in the demo too"): vehicle received with odometer → itemised estimate approved per line → work → ready → bill from approved lines → pay (paid at the workshop) → review, as in spec 06.
  Built the same day. Rulings (cost if wrong in brackets): the demo states are a subset of `serviceRequestMachine`, and `billed → paid → completed` is one workshop step ("Mark paid at the workshop"; the customer's confirmation and online payment for services come with the API — cheap to add); a "no work approved" job ends with "Vehicle returned" and no bill (the machine also allows billing an inspection charge — not in the demo); a revision is allowed from approved, in progress and no-work — not while the customer is still deciding (exactly the machine; review 2026-11-14); old saved jobs past "received" restart from "received" (no estimate to bill from) and starts from the approved lines (concept), every decision back to pending; the odometer must be at least the last reading recorded for that vehicle on the device; GST slabs 0/5/12/18/28 %, CGST + SGST (workshops bill in their own state); one demo workshop (Amapara Express Service) is not GST-registered so the 0 % path is visible. Bill maths shared with the API: `packages/shared/src/service-bill.ts` (property-tested).
- **Order lifecycle navigation test** (user asked whether the site was really used at every order stage by each role): `e2e/order-lifecycle-navigation.spec.ts` drives one real order through every stage and has the customer, the shop and the admin walk their pages at each stage, checking every view agrees.

## 2026-11-14 — Behaviour changes from the overnight QA (all with regression tests in `e2e/qa-regressions.spec.ts`)

- **Reason codes are always chosen, never preselected** (shop decline, admin reject/cancel, customer order and booking cancel): rule 16 — a default code nobody picked is bad data.
- **Order rejection:** the customer sees the reason code's sentence in their language, plus "nothing was charged" for cash-on-delivery orders, plus the admin's message (10–500 characters, the API's rule; no English default text — the admin writes it in the customer's language). Follow-up: the API's customer order view does not return the reason code yet (`customer-orders.ts`).
- **Delivery code:** shown only to the customer (or the guest who placed the order on that device), never to shops, workshops or staff.
- **Offers:** an open offer lapses at once when the shop is paused or suspended; routing never suggests a shop that stocks none of the order's categories (the admin is told when no shop can take it); shops see their missed offers; delivered orders get their own list (admin queue "Delivered", shop portal "Delivered").
- **Floating UI:** the compare tray and the shoppers' assistant stay out of `/admin` and `/partner`; the tray also stays out of `/checkout` and steps aside for the privacy banner. Later the same day (U16): the shopper bottom tab bar and the header cart are left out of the portals too (one rule, `apps/web/src/lib/portal-path.ts`); partners and staff still shop normally on the storefront.
- **Checkout:** prefilled from the signed-in customer (name, phone, default address and PIN); a known COD block is shown on load and ordering is disabled; field errors clear as the field is edited.
- **Signals:** admin Overview tiles for support requests to answer and price changes to approve; the customer's section bar shows replies and quote offers waiting for them.
- **Copy:** the account page no longer says "no password"; signed-in visitors on `/login` are told and offered the way back; `/support` redirects to the account's support section; footer "Account" instead of "Sign in".
- **Open (demo only):** an approved or invited seller cannot sign in to their shop in the browser demo; the real API links the owner on sign-in (`linkApplicantOwner` in the auth middleware) — Q89.

## 2026-11-13 — Compare tray on every page; language switch is a full page load (user UI review)

- **Compare tray:** mounted in the locale layout (outside the animated page wrapper), not only under `/shop` — user: "if something is on the list for the compare then compare should be a floating button". Hides itself on `/compare`. Replaces the 2026-11-13 "shop pages only, never the root layout (JS budget)" note: every page ships only a few-hundred-byte `CompareTrayLoader`, which loads the tray and its store once the list holds something. Budget kept (`measure-js`, all routes < 180 KB; `/workshops` 176.5 KB after its map component also moved to a lazy chunk).
- **Language switch:** a full document navigation that keeps the query string and hash. A client-side switch left the `NEXT_LOCALE` cookie unchanged (next-intl only syncs it on document requests), so Hindi → English bounced back, and it rebuilt `<html>` without the saved theme.
- **Theme guard:** the before-paint inline script also restores `data-theme` if React removes it and follows other tabs (inline: no bundle cost; CSP allows it by hash).
- **Compare page layout:** sticky product strip + page scroll (no inner scroll box), labels above values on phones, label column on tablets and up; a single product is allowed (with "Add a product").

## 2026-11-13 — Runtime Node 24 LTS (CI fix)

CI had failed at `pnpm install` since 2026-11-09 (`39e0eae`): `@firebase/app@0.16.5` requires Node ≥ 24.12.0, and `.nvmrc` pinned CI to 22.23.4. Local machines already ran Node 24, so it never showed up locally.

- **Runtime is Node 24 LTS ("Krypton").**
  - `.nvmrc` = 24.22.3, the latest security release (2026-11-10).
  - `engines.node` ≥ 24.22.1, which carries the October 2026 security fixes.
  - The API (Cloud Run) and the web (Vercel) use the same major.
- **Why not pin an older Firebase?** It would keep a superseded client SDK. Node 22 is in maintenance, and Node 24 is the active LTS line.
- **`@types/node` stays ^22** for now; nothing uses Node 24-only APIs. It is bumped with the next dependency sweep.

## 2026-11-13 — Email sender addresses (user)

User: "4 primary mails would be support@mechdost.com, promotions@mechdost.com, billing@mechdost.com and noreply@mechdost.com and we can also use … updates@mechdost.com … their usages are pretty self explanatory". Resend sends the email (the key is in `.env`; the domain must be verified, Q79).

| Sender                    | Used for                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `updates@mechdost.com`    | Order and service-request updates, seller invites, application and price decisions, agreement notices |
| `billing@mechdost.com`    | Invoices, receipts, refunds, credit notes, payment issues                                             |
| `support@mechdost.com`    | Support ticket replies; the reply-to address on every email                                           |
| `promotions@mechdost.com` | Offers and campaigns, only with marketing consent (DPDP), always with an unsubscribe link             |
| `noreply@mechdost.com`    | Account and system emails: email verification, password and security notices                          |

Each email template declares its purpose. The sender for a purpose comes from the shared `EMAIL_SENDERS` defaults, which the admin can override (rule 8).

## 2026-11-13 — Seller onboarding, price approval, buyer GSTIN, comparison (user requests)

User (2026-11-13), in order:

1. **Apply as a seller:**
   - Add a **GST number** field.
   - Replace the free-text "what you sell" field with a **tick-list of the products/categories the seller sells**.
   - Add an **address** field and a **location button**: pick the location on a map with a search, or "use my location".
2. **Customers may add a GSTIN at checkout** (optional) for a GST invoice.
3. **Product comparison:** compare several products (for example engine oils) with cost and everything; the user will give more detail later.
   - Research it and propose extra features.
   - Search gets a vehicle-type filter (2W/3W/4W). Built 2026-11-13: commit 1bb7cd2.
4. **Seller price changes need admin approval:** a seller can raise or lower a price. The change goes to the admin, who approves or rejects it.
   - If the admin rejects it, **that product is not shown for that seller**. Customers get it from other nearby shops (routing and pricing skip it).
   - This replaces "shop owners edit their selling price directly" (spec 07 § inventory).
   - Admin-set prices stay direct.
5. **After the application is confirmed:** the seller sees an option to sign an **end-to-end agreement with MechDost**. The user will provide its details later (Q77). Build the slot and the status, not the text.
6. **Admin invites a seller:**
   - The admin enters name, email and phone, and the seller gets a link.
   - The application counts as already verified, and the email and phone count as verified.
   - The seller still fills in the rest: GSTIN, product list, prices and so on.

Exploration first: specs 02, 03, 07, 08, 13 and 15, the skills, and research. A new comparison spec where needed.

## 2026-11-13 — Seller onboarding as built (rulings)

Design: `docs/superpowers/specs/2026-11-13-seller-onboarding-design.md`; plan ledger rulings in `.superpowers/sdd/2026-11-13-seller-onboarding/progress.md`.

- **GSTIN or GST enrolment number:** a seller is either GST-registered (15-character GSTIN, checksum verified) or enrolled (12-character enrolment number, for sellers below the GST threshold). Both are stored encrypted in `partner_applications.kyc_enc` with a blind index for duplicates. **Enrolled shops are onboarded but never priced or routed** until they register (`shops.gst_status = 'registered'` guard in catalogue, checkout and routing), because a marketplace sale needs a GST invoice.
- **Agreement gate:** a new shop goes live only after its prices are approved **and** it accepts the current agreement version (`maybeGoLive`), while `partners.agreement_required` is on. The setting is **off by default until the agreement text exists** (Q77): no placeholder is published, because shops would accept a meaningless agreement. When the text arrives the admin publishes it and turns the setting on. With the setting on and no version published, new shops wait (fail-closed; automated security review 2026-11-13 rejected an implicit "no version = not required" bypass). Shops see the card whenever a version exists. Accepting an old version is refused (`AGREEMENT_OUTDATED`); a new version asks every shop again.
- **Every price is a request** (approach 3): onboarding prices and later changes go through one queue (`shop_price_requests`, one pending per shop and variant); the old price stays live until a change is approved. **Approval changes only the price** of an existing listing; stock and the on/off switch stay the shop's own (final review). A rejected change on a live product takes it off sale for that shop (`shop_inventory.admin_blocked`) and routing skips that shop for orders with that product. Prices can never exceed the MRP.
- **Invites:** an invited application is approved on submit with the city's default delivery area (`defaultCoverage`); the admin edits the area later. Invites belong to a city; creating one needs `partners:approve`. **Name, email and mobile come from the invite row**, never from the form (final review). An invite past its date is expired when the same number is invited again; there is no separate "resend": revoke and invite again sends a fresh link.
- **Delivery area at approval** (user: "admin, at approval"): pre-filled with the city's PIN codes, the default charge (`partners.default_shipping_paise`, ₹40) and days (`partners.default_lead_days`, 2).
- **Admin screens:** invites, the price queue and the agreement sit on `/admin/partners` (no new admin section).

## 2026-11-12 — Three-wheelers first-class; fitment by vehicle type (default for Q76)

Follow-up to the 2026-11-11 answer "for both two wheelers, three wheelers and cars".

- **One vehicle-type list:** `packages/shared/src/vehicles.ts` holds `VEHICLE_TYPES` (2W, 3W, 4W), the label keys and the decorative icons (🛵 🛺 🚗). It matches the database CHECKs. It has no Zod, so browser islands stay inside the JS budget.
- **Electric is a fuel, not a type:** an e-rickshaw is a 3W with fuel `electric`.
- **Three-wheelers appear wherever 2W and 4W did:** account vehicles, the workshop finder filter, booking, the workshop portal, and partner applications. Labels: "Auto / e-rickshaw" and "ऑटो / ई-रिक्शा".
- **Workshop services:** "both" became `any`, meaning every type the workshop serves. One demo workshop (Mowa EV & Bike Point) serves 3W, so the filter is never empty.
- **Fitment depth (Q76, default until answered):**
  - Products are tagged by vehicle type, admin-editable.
  - The wording is "For three-wheelers" and a "my vehicle type" filter, never "Fits your vehicle". A type does not guarantee a fit, and there are no returns.
  - Exact make/model/year rows (`fitments`) are added later and take priority. Untagged products show "Fitment not listed".
  - No fitment is written from memory: the demo carries over only the existing `fits` values.
  - This supersedes spec 02's "Fits your {vehicle}" badge for type-level data.

## 2026-11-13 — Product comparison: typed attributes in code (user, Q80)

User (2026-11-13): "yes go ahead with option 1" for the design `docs/superpowers/specs/2026-11-13-product-comparison-design.md`.

- **Compare:** up to 4 products from one category, side by side, with price, MRP, ₹ per litre / kg / unit, delivery days, fit, specs, warranty, origin and ratings; "Only differences"; a shareable `/compare?p=…` link; the list is kept in the browser like the cart.
- **Data (option 1):**
  - The attribute list per category (key, type, unit, group, label key) lives in shared code.
  - The values are in `products.spec`, checked per category on every write; the admin edits the values.
  - A new attribute, or attributes for a category the admin creates, needs a code change. Admin-editable definitions are a P2 extra.
  - Categories without definitions compare on the shared rows only.
- **Unit price:** each pack (variant) carries a typed net quantity. The unit price is integer-paise maths rounded half up, always from the same pack as the price shown.
- **MVP attributes:** engine oil, battery, tyre. Other categories and the extras (compare with similar, share button, my-vehicle row, popular comparisons) follow as small changes.
- **Wording:** facts only, "Lowest price per litre", never "Best". The fit row keeps the type-level wording of the fitment decision ("For two-wheelers"), never "Fits your vehicle".

## 2026-11-13 — Hosting: Docker on the user's AWS server (user)

User (2026-11-13): "we have to setup the cd part too, basically i think we should dockerize it and use that and also i have the vps ready too … its an aws … ubuntu@13.201.82.82"; "the database would still be supabase tho". Answers to the design questions: build images in GitHub Actions, use mechdost.com now, demo website + live API.

- **Server address:** Elastic IP **13.207.157.3** (attached 2026-11-13; the launch address 13.201.82.82 is gone).
- **Supersedes** "Hosting: Vercel `bom1` (web), Cloud Run Mumbai (API)". The database stays Supabase (Mumbai); auth stays Firebase.
- **Stack:** one AWS server (Ubuntu 24.04, 2 vCPU, 1.9 GB + 2 GB swap) runs docker compose in `/opt/mechdost`: Caddy (HTTPS, `mechdost.com`, `www` → apex, `api.mechdost.com`), the Next.js standalone web image and the Hono API image.
- **Pipeline:** CI green on `main` → `Deploy` builds both images in Actions (the server is too small to build Next.js) → GHCR (private) → SSH with a dedicated deploy key (pinned host key) → `docker compose pull && up -d --wait`. Rollback = deploy an older SHA.
- **Secrets** only in the server's `.env` (mode 600) and GitHub secrets; `NEXT_PUBLIC_*` are GitHub variables compiled into the web image. No service-account key file on the server (the API's production check forbids it; tokens are verified with the project id).
- **API is opt-in** (`COMPOSE_PROFILES=api`) until its production settings exist (Upstash Q4, Turnstile Q5, Firebase web key); the website goes live first, in demo mode (Q69/Q70 defaults).
- **Migrations** stay manual (`pnpm db:migrate`) until a production Supabase project exists. Runbook: `docs/runbooks/deploy.md`.

## 2026-11-13 — Business rules answered (user, questions inbox walk-through)

Full answers in `docs/questions-for-user.md` (Answered log, 2026-11-13). The ones that change what is built:

- **Launch scope (Q71):** everything built so far ships at launch (parts and full workshop booking, coins, bulk quotes, assistant when Q19 is decided).
- **Pricing (Q26):** the **admin sets the customer price per PIN code**, helped by suggestions from the nearest shops' prices. Supersedes "PIN price = nearest covering shop with stock" (2026-11-01).
- **Earnings (Q11):** from shops, MechDost keeps the **margin** between the admin's PIN price and the shop's approved price; from workshops, a **flat fee per completed booking** (admin-set). **Weekly** payouts.
- **Claims and cancelling (Q25):** faulty, damaged or wrong items within **7 days** of delivery; cancelling **only through support**, which removes the customer self-cancel button.
- **Coins (Q24):** earned on delivered orders (%), the first order, workshop bookings and referrals, at admin-set rates. Usable after **8 days**; expiry **180 days**; both admin-configurable.
- **Referrals (Q31–Q34):** rewards are admin-set (no defaults); caps default 5 a month and 25 a year; coins unlock when the friend places an order (taken back on cancel or refund); any signed-up customer can refer. The rest of the referral questions are still open.
- **COD fee (Q66):** off by default, admin-configurable, can be set **per PIN code**; when on, the shop passes it to MechDost. **COD WhatsApp confirmation (Q74):** the admin sets the time; with no reply the order goes to a "call the customer" queue.
- **Partners (Q28, Q78, Q59):**
  - pause end dates optional;
  - no fixed warn → pause → suspend ladder;
  - one admin can offboard;
  - invited sellers' phones count as verified (the admin's entry);
  - WhatsApp alerts to shops and workshops, with opt-in as one line in the partner application.
- **After-sale at launch (Q1):** service reminders, disputes, order chat.
- **WhatsApp (Q54–Q62):**
  - marketing from launch (opt-in recipients);
  - budget alert set by the admin;
  - OTP over both WhatsApp and Firebase SMS (order to be given);
  - templates **English only at launch**, a deliberate exception to hard rule 10 for WhatsApp templates.
- **Kept as built:** type-level fitment (Q76, Q10 not needed yet), deny-all RLS (Q73), suspension within 60 s (Q29), customer blocks by super admins only (Q65), English road names on the Hindi map (Q64), checked security fixes may skip the 3-day wait (Q67).
- **Admin catalogue screen (Q82): build now**, before the website switch, including the Q26 PIN prices.

## 2026-11-14 — MechDost Coins on the real API (spec 20; Q24, Q31–Q34; launch scope Q71)

Coins work in real mode and are **no longer hidden** (removed from `BROWSER_ONLY_SECTIONS`; supersedes the coins part of "Launch scope in real mode: features with no API are hidden"). Rulings taken while building (cost if wrong in brackets):

- **Rules are site-wide admin settings** (`coins.*` in the settings registry, global only): coin value, maximum share, minimum order, order reward (basis points), first-order bonus, workshop-booking bonus, unlock days (default 8) and expiry days (default **180**, replacing the earlier 365). Every reward is **0 until the admin sets it** (Q24, Q31). Saving a coin rule needs `coins:rules` as well as `settings:write`. (cheap: per-city values can be added later)
- **The public quote stays anonymous.** The checkout reads the balance and rules from `GET /v1/me/coins`, computes the coins with the shared `coinRedemption`, and sends `coins` with the order; the server re-checks inside the order transaction (409 `COINS_CHANGED`). Deviates from "extend the quote" because a personal balance in a public, per-IP-limited endpoint would need optional sign-in on it. (cheap)
- **Each sub-order carries its share** of the coins (`orders.coins_redeemed`, split by product subtotal, never above a part's subtotal), so what a shop collects for COD, what Razorpay asks for, and a part's cancellation all stay exact; a cancelled or rejected part returns its own share as coins, once. (medium: migration 0047)
- **Returned coins get a fresh expiry**; spending, deductions and expiry use the earliest-expiring coins first. (cheap)
- **Earned coins wait in `coin_rewards`** and the worker credits them after the unlock days; a refund before then cancels them (`cancelPendingOrderRewards`, to be called by the refund flow when it exists). No claw-back after credit: the 8-day wait outlasts the 7-day claim window (Q25). (medium)
- **The first-order bonus** is paid on the customer's first _delivered_ order, once per customer (unique index). (cheap)
- **Staff adjustments** need a reason code (hard rule 16) plus an optional customer-visible note, the account version the screen showed (409 `STALE_COINS`) and an `Idempotency-Key`. Four-eyes waits for an approval-threshold setting (spec 13). (cheap)
- **Coin discounts are MechDost-funded**: invoices stay at full price (Q41 default until the CA answers). (medium: invoice copy if the CA says otherwise)
- **Referrals are not built** although Q31–Q34 are answered: the programme itself (codes, sign-up attribution, Q35–Q38, Q44, Q45) is still open under Q47, whose default is "do not build until discussed". (cheap to add: a `referral` reward source)
- **Migration number 0047**: 0045 and 0046 are reserved for the parallel quotes and reviews streams; renumber at merge if needed. (Renumbered to **0050** at the merge, see "Coins code review: user rulings".)
- **Workshop booking rewards are guarded against fake bookings** (security review 2026-11-14, MEDIUM: "paid at the workshop" is self-attested): no reward below `coins.workshop_reward_min_bill_paise` (default ₹500); at most one per customer per workshop in `coins.workshop_reward_cooldown_days` (default 30), checked under a per customer + workshop lock; the reward stays pending for the unlock days and is cancelled by any later move that undoes the payment (`cancelPendingServiceRewards`). Support requests cannot name a service request yet, so cancelling on a ticket waits for that link. Spec 20 § Anti-abuse. (cheap: both limits are admin settings)

## 2026-11-14 — Coins code review: user rulings (spec 20)

- **Staff coin adjustments: super admin only + daily cap** (user). `coins:adjust` is removed from marketing (RBAC stays the single source); never to one's own account (`COINS_SELF`); `coins.adjust_daily_cap` (default 5,000 coins per customer per IST day, grants and deductions together, under a per-customer lock). (cheap)
- **Order rewards: "decide when enabling"** (user). `coins.earn_order_bp` and `coins.first_order_bonus` can only be saved as 0 (`COIN_GUARD_REQUIRED`) until an anti-farming guard is chosen — pending decision #19 below. (cheap)
- **Shops: "show line + payout ledger"** (user). Shop order cards show the coin discount (paid by MechDost) and the cash to collect; delivery writes the owed amount to the new append-only `shop_payout_entries` (`coin_discount`); finance report `GET /v1/admin/payouts/entries`. Weekly payouts (Q11) will read this ledger. (medium: migration 0050)
- **Migration renumbered to 0050** at the merge with main (0046 reviews and 0048 PIN service area are applied live; 0049 quotes, 0051 shops).

## 2026-11-14 — Coins meet bulk quotes (merge rulings, specs 19 + 20)

- **No coins on bulk quote orders:** the prices were negotiated with staff, so a quote order with `coins` is refused (`COINS_NOT_ON_QUOTES`). Quote orders keep their own COD ceiling (`quotes.cod_cap_paise` at acceptance); the checkout COD cap (checked after coins for normal orders) does not apply to them. (cheap: allowing coins later is one check)
- **One shop money model:** payout = the shop's own price × qty (spec 19 I1, unchanged by coins); collect = the customer's total after coins, on cash on delivery only; the coin line shows the discount MechDost pays. The coordinator asked for the customer-facing total on the shop card too; I1 ("never the customer price") wins, and on COD the collect amount is that total. (cheap: one line on the card)
- **Settlement precondition:** the weekly payout job must not count the coin discount twice (spec 20 § Rules). (medium if missed)

## 2026-11-14 — Customer reviews on the API (launch stream; user: "BUILD ALL OF THEM WE NEED THEM ALL")

Built per decision 2026-10-31 (verified purchase only, admin approves before publish). Details: spec 02 § Reviews.
**Supersedes for reviews only** the 2026-11-14 ruling "features with no API are hidden in real mode": review sections,
the write form and Admin → Reviews now work in real mode (quotes and coins unchanged by this entry).

- **Verified = one purchase:** a delivered sub-order containing the product, or a service request in `paid` /
  `completed` at the workshop (spec 06 "review after paid"; `completed` also covers a returned vehicle with no work).
  One review per customer, target and purchase; buying the same product again allows another review. (Cost if
  wrong: low — tighten to one per customer and target with a unique index change.)
- **Velocity follows spec 13 ("Reviews 5/user/day"):** 5 accepted reviews per customer per 24 h, counted in the
  database; plus 20 attempts per hour on the write route. (Cost if wrong: a customer with more than 5 delivered
  products waits a day for the rest; the number is one constant.)
- **Plain text only**, ≤ 1000 characters, stars required, text optional; no title field (the demo's title is not
  carried over: fewer fields, same signal). Reviewer shown publicly as first name + last initial.
- **Moderation is reversible** (hidden → approved allowed); hiding needs a reason **code** (spam, abusive,
  personal_data, off_topic, not_genuine, other) with an optional staff-only note (hard rule 16). Customer edits after
  sending, staff text edits, delete and partner reply are **not built** (queued in spec 02 § Reviews "Not built yet").
- **Who moderates:** the existing `reviews:moderate` permission (super admin, catalogue manager, marketing), verified
  staff, city-scoped by the purchase's city; the RBAC catalogue is unchanged.
- **Ratings:** workshop `rating_avg` / `rating_count` are recomputed in the moderation transaction (workshop row
  locked first); product ratings stay computed live from approved rows (no new product columns). Public reads are
  cached 60 s (HTTP + Next fetch cache), so an approval shows within a minute.
- **Admin → Reviews visibility:** demo queue in the browser demo, API queue with real sign-in, hidden in the mixed
  build (real data + demo sign-in), as no queue there matches what customers see.

## 2026-11-14 — UI state audit: component × state checklist as a test gate (coordinator, after the user's four layout bugs)

- UI coverage is modelled **per component** (`apps/web/e2e/state-audit/model.ts`): interaction states, cross-entity
  relations, data shapes and the widths 320–1920, combined by a deterministic pairwise generator, with full crosses
  for the high-risk components. Every combination is a line in `docs/qa/ui-state-checklist.md` and one Playwright
  test with the same id; results are ticked into the checklist from the JSON report. Why: the page matrix rendered
  the states of bug 4 sixteen times and passed (`docs/research/ui-testing-gap-2026-11-14.md`).
- Assertions are **geometric** (inside, overlap, painted over, clipped, aligned, ≥ 24 px, focus ring), also while
  each control is hovered and focused; P0/P1 fail, P2 is a note.
- CI: the 84 `core` items run on every push (report-only until the first full run is triaged, Q101); everything
  nightly (`.github/workflows/ui-state-audit.yml`, artifact only, never commits). Not part of `pnpm e2e`.
- Tooling: `apps/web/tsconfig.json` sets `allowImportingTsExtensions` so the audit's pure modules can use explicit
  `.ts` imports and run directly in Node 24 (checklist writer and ticking script); no new dependency. (Cost if
  wrong: none at runtime; `noEmit` is already on.)
- The first run is the overnight run (coordinator 2026-11-14: "dont do the tests just yet we can do them
  overnight"); the harness is type-checked, linted and unit-tested only.

## 2026-11-14 — Compare control and card actions redesigned (user: "that ui is really really buggy")

- **Replaces** the 2026-11-13 flow "another category shows 'You can compare one category at a time.' with Start a new
  comparison" on the card: cards and the product page never show compare messages. The compare tray asks once
  ("Start a new comparison with {to}? This removes {n} {from} item(s)." — **Start new** / **Keep current**) and tells
  "full" / "save refused" with **OK**. Non-modal, inside the tray; Escape keeps the list. One shared store and prompt.
- **Card action row:** superseded on 2026-11-15 by the checkbox ruling below. No new colours, fonts or radii.
- **Stored list** gains optional `name` + `lang` (category name in the page language) for the tray; never shown in
  another language. Events `compare_switch_prompted`, `compare_switch_answered`, `compare_limit_shown` (spec 12).
- Locale keys `compare.otherCategory` and `compare.startNew` removed; `switch*` and `dismiss` added (en + hi).
- Spec 21 § "Redesign 2026-11-14"; geometry tests written first and run overnight (user asked to hold browser runs).
- **Review round (2026-11-15):** the question logic moved out of the always-loaded store into the lazy tray chunk
  (controls `signal()` a CustomEvent; the loader holds the request and owns the one live region); cart limits from
  cards are told in the tray, not inside the card; the assistant button steps aside while the tray asks; the
  privacy banner and the tray publish their heights (`--consent-h`, `--tray-h`) for placement and scroll padding;
  the repeated card controls' styles are component classes in `globals.css` and the compare icons CSS masks
  (always-loaded islands 4,535 B gz vs 4,516 B before the redesign). No `cn()`/`clsx`: the project has none and
  adding a dependency for it is not worth it here (template strings stay short).
- **User ruling 2026-11-15 — "Checkbox style":** the compare control is a small "☐ Compare" checkbox (a real
  `<input type="checkbox">` with its visible word, the whole label clickable, ≥ 44 px), placed under the price and
  above the action row on product cards and right above "Add to cart" on the product page, separate from "Add to
  cart"; checked = in the compare list; accessible name "Compare {product}"; the box in the brand colour
  (`accent-color`). It replaces the icon-only ⇄ button and its word / icon / stacked modes, so "Add to cart" or the
  stepper gets the full action-row width at every card width. Another category still goes through the tray question
  and the box stays unchecked until "Start new".

## 2026-11-14 — Shop management and shop hours on the API (rulings; user: hours "keep it configurable")

Specs 03, 04, 07 and 08; migration 0051. Rulings, with the cost if wrong in brackets:

- **Why a shop is paused or suspended is a code plus a note** (hard rule 16). The codes are in
  `PARTNER_STANDING_REASONS`, stored in `partner_status_events.reason_code`. The note is the 5–300 character text the
  shop reads. The code is never preselected. Older rows and workshops keep a null code (workshops still use free
  text). (cheap: add codes to workshops later)
- **Free delivery per order group** uses the first threshold set: PIN ?? shop ?? city setting. The shop value is
  `shops.free_delivery_min_paise` (NULL = city, 0 = always free). The first set value wins even when it is higher
  than the city's. (cheap)
- **Staff edits:** a GSTIN change is an approval. It needs `partners:approve` covering the shop's city, the GSTIN
  must be valid and from the shop's state, and setting it makes an enrolled shop `registered`. A GSTIN can be
  corrected, never removed. (medium: invoices depend on it)
- **Coverage** may only use PIN codes of the shop's own city. A shop elsewhere is another shop (spec 15). Coverage
  edits are a compare-and-set on the shop's `version`. (cheap)
- **Who can do what:**
  - The admin shop inventory routes moved under one `/admin/shops/*` router (L54: no double authentication or rate
    counting).
  - Reading a shop's offers needs `partners:read` (was `partners:write`).
  - Portal access refuses staff accounts (`MEMBER_IS_STAFF`).
  - Adding a member writes `shop_users` as well as the role grant, so live pings reach shops. The owner link on
    sign-in does too: before this, production never wrote `shop_users`. (cheap)
- **Going live:** a pending shop also goes live when staff add a PIN code or a product, not only on price approval
  or the agreement. A pending shop can only be suspended by hand (kept dark while it is set up).
- **Minutes to accept:** a shop's own value (5–120) now applies when routing (the column existed but was ignored).
- **Working hours** (user 2026-11-14):
  - One window on chosen weekdays, in IST. The default for every shop is **09:00–21:00, Monday to Saturday**.
    Closing "24:00" means open until midnight.
  - The owner edits them, and so does staff. Shop staff (non-owner) cannot.
  - Routing ranks open shops first among eligible shops (before distance). Routing to a closed shop is allowed: the
    shop gets the offer at once and has until **opening + `orders.closed_shop_grace_min`** (default 60, 15–240,
    city override) to accept.
  - The stock hold is stretched to cover that.
  - **Closing soon counts as closed** (user 2026-11-14, "Yes, treat as closed"): if the timer would run past
    today's closing time, the deadline is the next opening + grace.
  - Not built: lunch breaks, holidays, a per-shop grace. (cheap: the rules live in `@mechdost/shared/shop-hours`)
- **Code review rulings (2026-11-14):**
  - A pending shop can be suspended to keep it dark; the UI warns that saving a PIN and a product publishes it.
  - A GSTIN held by another shop or a live application is refused (409 `GSTIN_TAKEN`).
  - Only active PIN codes count for going live.
  - Owners are never downgraded by "Portal access"; deactivated accounts are refused.
  - Migration 0051 backfills `shop_users` from the shop grants.
- **Seller application picker:** in real sign-in builds it lists the live API catalogue (the mode in which the form
  posts to the API). (cheap)

## 2026-11-14 — Admin analytics from our own data (user: "i want to be able to view them in our website for the admin")

- **Built-in page, not embedded PostHog** (user's choice): Admin → Analytics reads our tables through
  `GET /v1/admin/analytics/dashboard` and the Overview reads `GET /v1/admin/overview` (spec 08 "Analytics").
- **Live queries, no rollups yet:** every query is bounded by an IST date range (≤ 180 days) on an indexed column and
  cached 2 min per instance; `metrics_daily` (spec 12) waits until volume needs it (~1M events/month or p95 > 1 s).
  Each report runs in one read-only, repeatable-read transaction with a 10 s local statement timeout (one pooled
  connection, one snapshot; timeout → 503 `QUERY_TIMEOUT`), with explicit city-id lists so city indexes are used
  (code review 2026-11-14).
- **City scope:** staff see only their analytics cities (another city = 404). Web events have no city yet, so site
  traffic, the funnel's visitor steps and searches are site-wide and shown only to all-cities staff.
- **Order = cash on delivery or paid online** (the routing queue's rule); GMV excludes cancelled/rejected parts.
- **Search phrases need ≥ 3 distinct visitors** before an admin sees them (k-anonymity; they are user text; raised
  from 2 in the code review 2026-11-14). New/repeat customers are judged on the selected cities' orders only.
- **Analytics charts in SVG (no Recharts yet):** Recharts is the decided chart library (2026-10-31) but is not
  installed; the dashboard needs only single-series daily bars and a funnel, so it uses small accessible SVG/HTML
  charts on the existing tokens (accent bars, `line` gridlines, keyboard read-out, table view) instead of adding a
  dependency (lockfile churn across parallel branches, bundle weight, release-age check) the week of launch. Recharts
  stays the choice for richer interactive charts later, loaded with `next/dynamic`.
- **Indexes (0050):** `service_requests (city_id, created_at)` replaces `service_requests (city_id)`;
  `order_assignments (offered_at)` added.

## 2026-11-15 — Launch features round: refunds, account API, emails, give-up + warnings, push, home service, proof photos, workshop analytics, trust wording (user)

User 2026-11-15 ~01:00 IST: "go ahead and work on the 1,2,3,4,5,6" (6 = shop WhatsApp alert, deferred to 2026-11-16 by the user) plus new features. Answers given in the question round:

- **Refunds:** "All need approval". Every refund (rejected, cancelled, unfulfilled, support claims, part refunds) waits in a finance queue and goes to Razorpay only after a finance / super admin approves it. Refunds go to the original payment method (spec 20: never a wallet).
- **Shop gives up an accepted order:** before packing, with a reason code, the order goes back to admin to reroute (2026-11-14 ruling) and counts against the shop's score. Admin can issue a **warning** with a reason code that the shop sees. After N warnings in 30 days (admin setting, default 3) admin is **prompted** to pause the shop; it never happens automatically.
- **Push notifications (Firebase Cloud Messaging, web push):** customers (order/service/quote/support updates), shops and workshops (new order or request, timers, warnings), staff and admin (needs routing, gave up, applications, tickets), and **promotions only after a separate opt-in** (DPDP consent per purpose). Each person turns push on in their browser; an in-app notification bell shows the same items.
- **Emails:** transactional emails through Resend for orders, service requests, quotes, support and refunds, en + hi, with the sender by purpose (2026-11-13 entry). Admin can edit the templates (rule 8).
- **Home servicing:** each workshop opts in, sets its own visit fee and travel radius (km), and ticks which menu services it can do at home. The customer picks "At my home" or "At the workshop" when booking. Only workshops that cover the address are listed.
- **Before/after photos (proof of work):** required by default (at least 1 "before" at vehicle received, at least 1 "after" before marking ready). Admin settings decide whether they are required and whether they are public (shown on the workshop profile) or private (customer and admin only).
- **Workshop analytics:** both. Admin → Analytics gets a workshops section, and each workshop sees its own numbers in its portal.
- **Trust wording ("genuine", "genuine parts"):** wording only, no money-back guarantee. The user picked both tones: "Genuine parts from verified Raipur shops" and the stronger "100% genuine parts" / "Only original parts". **Advisor flag:** a stronger claim is a representation under the Consumer Protection (E-Commerce) Rules, and with no guarantee every shop must actually meet it. Mitigations: the copy is admin-editable (rule 8), and a "genuine parts only" clause is proposed for the seller agreement (Q77). Queued as Q102.
- **Process (user):** "make sure u follow the proper rules, skills and stuff for these". Each feature gets the advisor brief, a design note, a plan, TDD, docs and the gate, plus a review before merge. Agents run on Sonnet and the main session verifies their work. Market research first ("do research around more on already existing stuff + what else is out there on the market").

## 2026-11-15 — Launch features round, second answers (user, before sleeping)

- **Design docs approved** ("Approve, build them"): `docs/superpowers/specs/2026-11-15-account-api-design.md`,
  `2026-11-15-emails-design.md`, `2026-11-15-bell-push-design.md`.
- **Push:** Firebase Cloud Messaging, browser library loaded only after "Turn on". The prompt card shows **soon after
  sign-in** (user's choice over "after an order"; market scan warns a "no" is near-permanent on iPhone, so the card never
  triggers the browser prompt itself and "Not now" snoozes 14 days). VAPID key: Q103, the user sends it 2026-11-16.
- **Emails:** admin edits text per language in a fixed layout, with preview, test send and reset.
- **Home service:** the visit fee is shown upfront and added as a line on the final bill. If the job can't be done at
  home, the workshop offers to move it to the workshop with a new estimate, and the customer accepts or declines. The
  visit fee is still charged unless the workshop waives it.
- **Before/after photos public:** the admin setting alone decides; no per-request customer OK (user: "No, admin setting is
  enough"). **Advisor flag:** photos show the customer's number plate and possibly faces. Mitigations: EXIF stripped, the
  public setting is off by default, the privacy notice says workshop photos may be shown publicly when the admin enables
  it, and number-plate blur is queued as P2 (market scan). (Cost if wrong: a DPDP complaint; reversible by turning the
  setting off.)
- **COD refunds (Q104):** the customer gives a UPI ID or bank details on the support ticket. They are stored encrypted
  (spec 05 `destination_enc`) and go through the same finance approval queue. Finance pays out by hand and marks the
  refund paid with the UTR.
- **Genuine clause (Q102):** yes. The seller agreement gets a "genuine parts only" clause. A confirmed fake means the
  product is pulled and the seller can be suspended (with a reason code). The agreement text still comes from the user
  (Q77).
- **30-day labour promise (Q105):** yes, admin-configurable (on/off and the number of days, off by default). It is shown on
  workshop pages and bills when on, and workshops accept it at onboarding.

## 2026-11-15 — Next tier answers (user)

- **Coupons:** MechDost-funded and shop-funded coupons both exist from the start, and **only admin creates and configures
  them** (user: "go with option 3 but only admin configures them"). Each coupon is marked with who funds it. A shop-funded
  coupon lowers what the shop is owed on that order, and a MechDost-funded one does not. Types: % / flat / free delivery,
  minimum order, per-user limit, first order (spec 03 rules; CCPA price display rules in `research/promotions-referrals.md`).
- **Order chat / disputes:** customer ↔ MechDost support only. Support talks to the shop or workshop, and no direct
  customer ↔ partner chat.
- **Payout statements:** decide later (ties to the commission model, PENDING #9). Not built until then.
- **Product photos:** admin uploads by default. Admin settings decide whether shops may add photos to products they sell,
  and photo uploads by shops can be switched on or off. Uploads by shops show only after catalogue approval.
- **Market scan adopted (coordinator, 2026-11-15):** P0 items go into the current builds (refund status + approval SLA,
  visit fee line + arrival code, push pre-prompt, give-up reason codes that separate legitimate give-ups, and a
  dark-patterns self-audit of checkout and booking before launch). The P1 items (fixed-price inspection package, "responds
  within X min", service reminders) are queued after the next tier.

## 2026-11-15 — Test runs and GitHub Actions minutes (user)

- The repo is private, and GitHub's free plan includes 2,000 Actions minutes a month. Estimated use this month is
  already about 2,000–2,500 billable minutes (about 1,000 minutes of run time, with CI running about 4 jobs in parallel).
  Running out would stop CI and the deploy.
- **The full UI state audit is manual only** (the nightly 02:00 schedule was removed; the workflow keeps its Run button).
  Full runs happen **on the development PC**, in the early morning with one browser
  (`node apps/web/scripts/state-audit-run.mjs all`, runbook § 9.3), **once everything in the build queue is done**
  (user: "After everything"). The result is a bug report with screenshots in `docs/qa/`, and fixes follow with the user.
- **CI skips docs-only pushes** (`paths-ignore: docs/**, **/*.md` on push and pull request; no deploy follows). Code
  changes run every check as before. This also stops docs pushes from cancelling a running code CI.
- Supersedes the 2026-11-14 "nightly" line in the UI state audit entry. The per-push `core` subset stays in CI.

## 2026-11-15 — Shop gives up an accepted order; warnings to partners (user rulings; design note 2026-11-15)

- **Give-up:** a shop may give up an accepted order before packing, with a reason code; it returns to admin to reroute
  (never auto-cancelled); the customer is not told; stock goes back; it counts against the shop's score and is in its
  history. Assignment status `given_up`, order transition `confirmed -> needs_rerouting` (shop).
- **Warnings:** append-only records with a reason code (+ optional note); the shop reads its own; staff are **prompted**
  (never automatic) to consider a pause at N warnings in a rolling window (settings `partners.warning_threshold` = 3,
  `partners.warning_window_days` = 30, global-only); pausing stays the existing standing flow.
- **Calls made (cost if wrong in the design note):** a shop that gave an order up stays offerable (flagged); the customer's
  earlier "confirmed" row stays visible while the step back is hidden; the window is 30 x 24 h UTC; workshop warnings are
  built in the model and repository, HTTP/UI later.

## 2026-11-15 — Email merge rulings (coordinator, security review)

- **Public partner applications are not emailed.** The address on the public form is unverified and anyone can type
  it, so mailing it would make MechDost a spam/phishing relay (security review). Invited applicants (whose address an
  admin entered) get "received"/"approved". Public applicants keep the reference shown on screen. Staff decisions
  (approve or reject) still mail the form's address once per human decision; that is low risk and accepted.
- **Refund emails use the shared catalogue.** `refund_requested`, `refund_processed` and the new `refund_declined` (en +
  hi, admin-editable) are sent through `queueRefundEmail`. The customer sees the order (group) code.
- The email migration was renumbered **0056** at merge.

## 2026-11-15 — Workshop benchmark anonymity (coordinator, security review)

- The city benchmark in a workshop's own portal leaves out **every workshop the asking owner holds** and needs at least
  **five other workshops** with each figure (`WORKSHOP_BENCHMARK_MIN`). A median is always one real workshop's value, so
  a small group would let an owner work back to a competitor's numbers. Admin medians (admin sees every workshop by
  name) keep the per-metric minimum of three. Cost if wrong: small cities show no benchmark until five workshops have
  data.

## PENDING DECISIONS (ask "what's pending" to review)

| #   | Topic                                                                                                                                                                                                                                                                                                            | Leaning                                                                             | When                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Payment methods at launch (COD + Razorpay vs COD only vs Razorpay only)                                                                                                                                                                                                                                          | Most probably COD + Razorpay                                                        | Later                                |
| 2   | Post-purchase P1 items at launch (exchanges, reminders, disputes, order chat)                                                                                                                                                                                                                                    | Probably include all (option 3)                                                     | Later (user, 2026-11-01)             |
| 3   | WhatsApp handoff from support tickets — **built 2026-11-03**: inbound WhatsApp → tickets, replies inside the 24 h window (spec 09)                                                                                                                                                                               | —                                                                                   | Later                                |
| 4   | Vehicle master data source (curated CSV vs licensed DB)                                                                                                                                                                                                                                                          | Most probably curated CSV, admin-editable, Vahan later                              | Later                                |
| 5   | Vehicle fields may change                                                                                                                                                                                                                                                                                        | Option 1 for now                                                                    | Open                                 |
| 6   | Messaging provider (MSG91 vs Twilio) — **SMS only**; WhatsApp decided 2026-11-02: Meta Cloud API direct                                                                                                                                                                                                          | MSG91                                                                               | Later (setup only, not during build) |
| 7   | Geocoding/autocomplete + routing provider (Google Places vs Ola Maps; OSRM/Ola routing)                                                                                                                                                                                                                          | Decide via 50-address Raipur bake-off                                               | During service-flow build (Phase 2)  |
| 8   | ~~Hindi UI at launch or P1~~ decided: both at launch                                                                                                                                                                                                                                                             | —                                                                                   | Done                                 |
| 9   | Commission and payout model for shops/workshops                                                                                                                                                                                                                                                                  | Ledger built generically; rates configurable per category/partner; user will decide | Later ("ill tell u on this later")   |
| 11  | GSTIN + address confirmed 2026-11-01; CIN + grievance officer name still needed                                                                                                                                                                                                                                  | —                                                                                   | Before launch                        |
| 12  | Razorpay MCP connection (test keys)                                                                                                                                                                                                                                                                              | Add when Razorpay account is ready                                                  | Later                                |
| 13  | ~~"ux superpower" skill identity~~ confirmed obra/superpowers (2026-11-01)                                                                                                                                                                                                                                       | —                                                                                   | Done                                 |
| 14  | Baseline walkthrough: remaining untouched P0 items use the baseline defaults (coupons engine, attribute sets, part numbers, SEO, OOS handling, admin CRUD conventions, impersonation in P1)                                                                                                                      | Defaults                                                                            | Confirm anytime                      |
| 15  | Vehicle fields, commission, payment methods, post-purchase P1 — see rows 1, 2, 5, 9                                                                                                                                                                                                                              | —                                                                                   | —                                    |
| 16  | Hindi map: roads without `name:hi` in OSM show their local (English) name on `/hi` — keep, or hide them (inbox Q64)                                                                                                                                                                                              | Keep showing the local name; refs (NH30) always                                     | Before launch                        |
| 17  | Bulk quotes: attachments (≤ 5 MB images/PDF) and read receipts in the thread (spec 19)                                                                                                                                                                                                                           | Build with Supabase Storage after launch                                            | After launch                         |
| 18  | Bulk quotes: online payment (Razorpay) for an accepted offer, and whether staff choose COD / online per offer                                                                                                                                                                                                    | COD only at launch; add online with the Razorpay live keys                          | After launch                         |
| 19  | Coin order-reward guard: what stops order → delivery → claim → repeat farming before `coins.earn_order_bp` / `coins.first_order_bonus` can be above 0 (options: rewards only after the claim window with no open ticket, per-customer monthly cap, minimum order, first order only for verified phone + address) | Decide when enabling (user 2026-11-14); saving above 0 is refused meanwhile         | Before order rewards are switched on |
| 20  | Job photo purge: how long soft-deleted and orphaned photo objects stay in the private bucket, and who may restore one                                                                                                                                                                                            | Keep them (audit and complaints) until a retention job is chosen                    | Before launch                        |

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

## 2026-11-15 — Refunds for prepaid orders (launch features round)

- **User rulings (fixed):** every refund is a request that waits for approval by finance or super admin; the approver is not the requester; system-created requests (order rejected or cancelled) need approval too; refunds go to the original payment method only; coins follow spec 20. Q104 (user): cash-on-delivery refunds go to a UPI id or bank account the customer gives on the support ticket, stored encrypted, same approval queue, finance pays by hand and records the UTR. This supersedes "unfulfilled orders are refunded automatically" in spec 05 (updated there).
- **My rulings (cost if wrong):**
  - Reserve the amount at request time (`payments.refund_reserved_paise`, CHECK ≤ captured), not at approval: a second request can never promise the same money. Cost low (a rejection frees it).
  - **An uncertain outcome never frees the money** (security review): after a failed Razorpay call the refund is looked up there first; only a confirmed absence fails it; otherwise `needs_reconciliation` keeps the amount reserved. A processed webhook can still settle a refund we had failed (matched by our refund id in notes), re-holding the amount. Cost: more states (medium); the alternative risked double refunds.
  - No public refund code (admin uses the uuid). Cost low.
  - `needs_refund` payments (captured after the order closed) still only audit; no request yet. Cost medium, follow-up.
  - A fully refunded order's pending coin rewards are cancelled; a part refund keeps them. Cost low.
  - The customer sees "processing" (never "refunded") until Razorpay confirms; a declined or failed refund shows a support link. Cost low.
  - Approval SLA is the admin setting `refunds.approval_sla_hours` (default 24, city override), rule 8.
  - The state audit lists the new screens (`ADM-REFUNDQ`, `ORD-REFUNDLINE`) (renamed `API-ADM-REFUNDQ`, `API-ORD-REFUNDLINE` on 2026-11-15) and they now run in the API-mode audit (runbook § 9.7). Cost low (they stay unticked in the checklist).
- **Not built** (spec 05): the ticket-side form for the payout destination, a finance action to settle an unsure refund by hand, requests for captured-after-close payments, the Overview tile and a staff alert channel, credit notes for refunds.

## 2026-11-15 — Customer account on the API: builder rulings

- **Gate:** the account sections switch on `AUTH_MODE === 'firebase'` (real sign-in), not `DATA_MODE`: they need a signed-in API user, not catalogue data. Demo unchanged. Cost if wrong: low (one condition).
- **Name rule:** 2 to 60 characters after NFKC cleaning (spec 01), stricter than the old 1 to 80; too long is refused, never cut. Existing longer names stay as stored until edited.
- **No migration:** `users.language` and both tables already had everything needed.
- **Defaults:** first address is the default shipping address; deleting the default leaves none until the customer picks one (checkout falls back to the first). Billing default exists in the API only (no UI yet).
- **Map pin:** the API accepts `lat`/`lng` (stored as `location`); the form has no pin picker yet. Queued as a later improvement (map adapter).

## 2026-11-15 — Transactional emails built (builder rulings under the approved design)

Design: `docs/superpowers/specs/2026-11-15-emails-design.md`. Spec 10 "Transactional emails" is the built description.

- **Quote offer email now follows the setting:** it used to require a verified address always; it now sends to the stored address unless `customers.require_verified_email` is on (design: "otherwise to the stored email"). Partners always need a verified address.
- **Order placed (online) is sent when the payment is captured,** with the receipt, not at checkout (an unpaid online order is not "being confirmed with a seller"). COD is sent at checkout.
- **Applicants (no account) get `application_received` / decision emails at the address on the form, in English.** The public form is behind Turnstile and the rate limits; the worst abuse is one calm acknowledgement to a third party per submission. Cost if wrong: a harassment vector (low); fix = send the first mail only after the applicant opens an emailed link, or only for invited applications.
- **The delivery code is in the "out for delivery" email** (design); WhatsApp still never carries it. It is sealed in the outbox and opened only at send. Cost if wrong: an email account takeover could read the code; mitigation is the "only at the door" text and the delivery-code attempt limit.
- **Button colour in emails is `#bf3c12`** (the design system's accent-soft text colour) so white label text passes AA; `#ea5728` stays the header stripe. No new token.
- **Grievance contact** is an env var (`EMAIL_GRIEVANCE_CONTACT`), hidden until set (Q15b), because settings has no text kind yet.
- **Not built, by the design's own rule:** `coins_expiring` (no reminder job), Resend bounce webhooks, workshop warning emails (no workshop login email), applicant language.

## 2026-11-15 — UI state audit covers navigation and real-sign-in screens

- **Navigation is audited** like any component: header nav, tab bar, account and admin section bars, shop chips and footer links, per role, route, width (320 to 1920), language and theme, with a click-through walk (runbook ui-test-catalogue § 9.6). The section lists per build mode are unit-tested against `src/lib/sections.ts` so a new section cannot ship without a row.
- **Real-sign-in screens are audited on a mocked API** (Q106 answered by implementation): a real-mode build in `.next-api`, a signed-in Firebase user seeded in the browser, and typed fixtures parsed with the shared Zod schemas; no emulator, no test switch in `src/`. Manual only, no CI job (the "Test runs and GitHub Actions minutes" ruling stands); whether to add API-mode rows to the per-push subset is Q108 (default: no).
- Only production-file edits: `distDir` follows `NEXT_DIST_DIR` in `next.config.ts` (default `.next`, unchanged for the deployed image) and a `data-track="shop_order_give_up_open"` attribute on the give-up button (hard rule 9; spec 12 lists the id).

## 2026-11-15 — Bell and web push built (builder rulings under the approved design)

Design `docs/superpowers/specs/2026-11-15-bell-push-design.md` (user choices: FCM, prompt card soon after sign-in, 14-day snooze, promotions only with marketing consent). Spec 10 "Bell and web push", runbook `docs/runbooks/push.md`. Rulings made while building, each with what it costs if wrong:

- **`@firebase/messaging` 0.13.3, not the `firebase` umbrella package** (the umbrella was tried and removed 2026-11-09: it pulls `@firebase/firestore` → `@grpc/grpc-js` with a high advisory). Published 2026-09-09 (67 days, past `minimumReleaseAge`), no advisory of its own; `pnpm audit --prod` unchanged (the same 5 older findings). Matches the `@firebase/app` 0.16.5 already used. Cost if wrong: swap the one file `lib/push/enable-push.ts`.
- **A plain service worker with no Firebase code** (`public/firebase-messaging-sw.js`, a `push` and a `notificationclick` handler); no `importScripts`, no keys, no PWA/serwist. The page registers it and passes it to `getToken`. Cost if wrong: FCM's own worker file would need the public config served; the card and API are unaffected.
- **Polling, not live pings, feeds the bell for now.** There is no browser Realtime Database client yet (spec 10 "Live updates": "the next step"), so the bell polls `GET /v1/me/notifications?limit=10` every 15 s (partners, staff) / 60 s (customers) while the tab is visible, plus a push wake-up message to open tabs. New arrivals fire a window event the shop offers list and the admin routing queue use to refetch (the vendor assessment's "offers must arrive live": within about 15 s, not 30 s, and at once with a push). Cost if wrong: swapping the poll for the ping is one hook (`use-notice-feed`).
- **One writer, hooked into `queueEmail`:** every email milestone already runs in the right transaction with the right entity and version, so its notice is written there (`NOTICE_FOR_EMAIL`), before any email check (a customer with no email still gets the bell). Cost if wrong: a notice and an email always move together; a future notice with no email needs its own call (`queueNotice`).
- **`notifications.dedupe_key` added** (the design listed category, kind, entity, link): without it a retried transaction would write twice (rule 3). Unique per person.
- **Staff alerts are part of the in-app and push fan-out**, not live pings: "needs routing" is written when a checkout is placed (`queueOrderPlacedEmail`), declined/timed-out/gave-up in the assignment code (the existing `notifyStaffShopGaveUp` hook now does its job), new application and new ticket where they are created, refund-overdue by a worker job.
- **Both small jobs were built** (one query each): offer-expiry reminder every 60 s and refund-SLA alert hourly; retention daily. New global settings `notifications.retention_days` (90), `push_prompt_snooze_days` (14), `promo_per_week` (2), `offer_expiry_reminder_min` (5), editable in Admin → Settings.
- **Public build variables:** `NEXT_PUBLIC_FIREBASE_VAPID_KEY` and `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` (the SDK refuses to register without the sender id; the design named only the VAPID key). Both repository variables, Docker build args, in `.env.example`. Q103 now asks for both.
- **The "Messages" admin editor is separate from the generic template endpoint** (which refuses `inapp`/`push`), so every text is checked against its closed placeholder list.
- **A browser that signs in as someone else takes over the token row** (token unique): a shared computer must not keep delivering the first person's messages. Someone who knew another browser's secret token could redirect their own notices to it (messages are title and short body only; tokens are never exposed by any API).
- **Not built (listed in spec 10):** live pings in the browser, foreground FCM messages, promotional senders, native app tokens.
- **`getToken`/`deleteToken` are marked deprecated in `@firebase/messaging` 0.13.x** (replaced by an FID-based `register` + `onRegistered`; `firebase-admin` 14.5.0 accepts `token` or `fid`). Kept the registration-token flow (two targeted `eslint-disable no-deprecated` lines in `lib/push/enable-push.ts`): it cannot be tried against real FCM from here and the FID path is new. Migration path when staging proves it: register with `register`/`onRegistered`, store the FID in the same `push_devices.fcm_token` column, send `{fid}` in `apps/api/src/notify/push.ts`. Cost if wrong: Google removes `getToken` in a future major (we pin 0.13.3, exact).

## 2026-11-15 — Trust wording, seller clause, labour promise, dark-pattern audit built (builder rulings)

Design: `docs/superpowers/specs/2026-11-15-trust-wording-design.md`; plan `docs/superpowers/plans/2026-11-15-trust-wording.md`; audit `docs/research/dark-patterns-audit-2026-11.md`. Specs 02, 06, 07, 08, 09, 10, 12 carry the built description.

- **Storage:** the existing content module (a key per language, draft and published) already had everything needed, so the eight trust lines are content keys `trust.*` (no new table, no settings keys). **Hide = publish the text `-`** (one dash) in that language: it needs no new column and works through the same API and demo editor; the editor says so. Cost if wrong: an admin who types a dash for another reason hides a line; the field then reads "Hidden" (low).
- **Storefront reads the published text on the server** (`GET /v1/content`, 60 s cache, tag `content`; empty on failure) and the demo keeps its browser-stored override in a tiny client island, so product pages gain no client JS beyond what the header already loads.
- **Truthful defaults (design check):** "Bill with every order" (not "GST bill on every order"); "GST bill" only beside a GST-registered seller, which the product page cannot know, so it is left out; no "sealed pack". Strong tone ("100% genuine parts", "Only original parts") kept on the home strip and at checkout as the user chose; every line is admin-editable or hideable. Cost if wrong: a consumer complaint over an over-strong claim; mitigated by the clause, `counterfeit_confirmed` and the hide switch (Q110 asks for legal review).
- **Order-email footer line** is added to `order_*` templates only, read by the worker at send time with a safe default; the default sits in `email-layout.ts` (like the other footer lines) and a test keeps it equal to the locale text.
- **Seller clause:** drafted in `packages/shared/src/seller-clause.ts` (en + hi, **draft, pending legal review**) and added to the agreement text by an admin button, so it is inside the version shops accept. It is not a second checkbox. `counterfeit_confirmed` joins `PARTNER_STANDING_REASONS` (migration 0057).
- **Labour promise:** settings are site-wide (`globalOnly`); the days are frozen on the bill (`service_bills.labour_promise_days`); a bill made while the promise was off never gets one. "Redo under the labour promise" is ticket kind `labour_redo`, raised only from the bill with the job code; the API checks ownership (404), a running window (422) and one open claim per job (409). Cost if wrong: a customer cannot claim on a pre-promise bill (intended). Workshop acceptance is a tick on the demo application form; the API workshop application and a workshop agreement do not exist yet (Q111).
- **Demo setting:** `labourPromiseDays` (0 = off, 1 to 6 raised to 7, max 90) because the demo settings are numbers only.
- **Dark-pattern audit fixes made here:** (F1) the checkout summary now lists the cash-on-delivery fee as its own line and the total follows the chosen payment method (it ignored the quote's fee); (F2) closing a bulk quote no longer requires choosing a reason. Listed, not fixed: preselected cash on delivery (Q109), demo-only scarcity labels (rule added to spec 02), the push prompt checklist for its builder, the home-service visit fee rule. Cost if wrong: low.
- **New questions:** Q109 (default payment), Q110 (legal review of clause and strong claims), Q111 (labour promise terms and a workshop agreement).

## 2026-11-15 — Home servicing built (builder rulings under the approved design)

Design: `docs/superpowers/specs/2026-11-15-home-service-design.md`; built description: spec 06 § "Built: home servicing". The user rulings ("Workshop opts in", "On the final bill", "Offer to move it") are unchanged; the builder's calls inside them:

- **Fee snapshot at booking, not at "confirmed".** The customer sees the fee on the card and the review; a workshop that changes it before the customer books gets `409 FEE_CHANGED`, so what was shown is what is charged. Cost if wrong: low (one column set earlier). A later admin reassign keeps the customer's snapshot (the workshop absorbs a higher fee). Cost if wrong: a workshop may dispute; revisit with ops.
- **Arrival code is encrypted, not hashed.** The customer must read it again on the request page, exactly like the delivery code (`delivery.ts` stores it as an AES-GCM envelope); the brief said "hashed like the delivery code". Stored in its own table so guesses never bump the request version. Cost if wrong: none (same protection class, same key ring).
- **GST on the visit fee goes on top, only when the workshop is registered** (18 %, like estimate labour lines); the card and the review show the GST next to the fee, so there is no surprise at the bill. Cost if wrong: a flat tax-inclusive fee would be simpler for customers; changing it is one function (`computeServiceBill`).
- **"Let MechDost choose" is not offered at home** (the fee depends on the workshop). Cost if wrong: customers without a nearby home workshop get an empty list and the workshop option.
- **A wrong or locked arrival code is a `200 { ok: false }`**, not an error, so the attempt counter commits (same as the delivery code).
- **Declined move reuses the existing `no_work_approved` → `billed` path** (one new edge `vehicle_received → no_work_approved` by the customer, one admin actor on the arrival edge); `billJob` bills the fee alone (`service_bills.estimate_id` nullable with a one-line CHECK). Cost if wrong: none; the edges are used only by the home paths.
- **Per-city cap in the settings registry** (`service.home_fee_max_paise`, default ₹500, DB hard cap ₹500); the admin settings label key lives in the `portal` namespace like the coin settings (the settings screen needs it there).
- **Not built:** editing the mechanic name after the proposal; email/push for the offer and arrival (bell/push build); live tracking.

## 2026-11-15 — Admin next tier part 1: staff and roles, customer search and view, audit log (builder rulings under the approved design)

Built on branch `worktree-agent-ac725264bf04a59b2` (not merged). Design `docs/superpowers/specs/2026-11-15-admin-next-tier-design.md` items 1 to 3; plan `docs/superpowers/plans/2026-11-15-admin-tier1.md`.

- **No new permission.** `customers:read_pii` already exists (the design said `customers:pii`), `audit:read` and `staff:manage` exist. The coordinator does not need `pnpm db:seed` for this change. Cost if wrong: none; adding a permission later is one catalogue line and a seed.
- **"Last sign-in" is recorded by us.** No sign-in time was stored anywhere, so a completed staff sign-in (password plus fresh phone code) writes one `auth.staff_signed_in` audit row; the screen reads the latest. Customers' sign-ins are not recorded. Cost if wrong: one small audit row per staff sign-in; a column on `users` would be cheaper to read but needs a write on a hot path.
- **"2FA state" = phone code readiness.** Second factor today is a fresh phone code, not TOTP, so the screen shows `ready` (verified phone) or `phone_missing` (that person cannot finish sign-in). It will show TOTP when TOTP exists.
- **Search lists are always masked; the profile unmasks (audited).** An unmasked list of 20 would need 20 audit rows per search. Cost if wrong: support/admin need one extra click for full contact details.
- **The audit viewer never unmasks**, even for a super admin: `before`/`after` JSON is redacted (phone/email masked, address and bank fields hidden). The customer view is the one audited unmasking path. Cost if wrong: an admin who needs a raw value reads it in the database.
- **One super admin always remains**: removing the last one is refused, serialised by an advisory lock so two admins removing each other cannot leave none. Cost if wrong: someone asks for a second super admin before offboarding the first.
- **Role removal ends the person's Firebase sessions** (best effort) besides dropping the session cache, so a removed staff member signs in again and loses staff access at once on that instance; other instances converge in 60 s.
- **City scope is set when the role is given**; to change it, remove and give again (no in-place edit). Customers and staff have no city, so these screens need an all-cities grant (`SCOPE_REQUIRED` for city managers).
- Customer search needs a full 10-digit number (a partial number is refused, 422 `SEARCH_QUERY`) and at least 2 letters for a name; name search is prefix only (`lower(name) like 'ab%'`), so mid-name search is not offered. Cost if wrong: trigram index and `ilike` later.
- Migration `0060_admin_people_indexes` (6 indexes, no table change) is not applied; the coordinator renumbers at merge.

## 2026-11-15 — Job photos built (builder rulings under the approved design)

Design: `docs/superpowers/specs/2026-11-15-service-photos-design.md`; built description: spec 06 § "Built: job photos"; security: spec 13 § "Uploads".

- **Images reach the browser through the API with short-lived signed URLs, not through bearer-authenticated fetches.** An `<img>` cannot send the token, and blob URLs break `next/image`. The listing (rights-checked) issues a 10-minute HMAC URL for one photo; the image route verifies it on each read. Cost if wrong: a URL copied within 10 minutes shows that one photo to whoever holds it; shorten the TTL or move to cookie auth.
- **HEIC is refused** (clear message, JPG/PNG), because the bundled libvips has no HEVC decoder. Cost if wrong: Android/iOS users who force HEIC uploads must switch format; adding a decoder later is a dependency decision.
- **The audited admin arrival override skips the photo gate** (staff cannot upload on the workshop's behalf). Cost if wrong: an override can start a job without a before photo; it is audited with its reason.
- **Photo settings are site-wide** (`globalOnly`), like the labour promise. Cost if wrong: no per-city difference.
- **Gallery URLs carry no token**; the image route re-checks setting + completed + published on every read, so turning public off hides pictures at once (cached copies live up to 5 minutes in browsers).
- **Soft delete keeps the objects** (audit and complaints) until a purge job exists; added to PENDING DECISIONS.
- **The bucket is created by the API on start** (idempotent; refuses a public bucket), with the dashboard route as the manual fallback (runbook photos.md).
- **State audit:** two API rows (`API-WS-PHOTOS`, `API-SVC-PHOTOS`); the public gallery is covered by API and repository tests because its page fetches the workshop on the server (the browser mock cannot feed it).

## 2026-11-15 — Admin next tier part 2: policy pages, home layout, city values, company details (builder rulings under the approved design)

- **Company details are one jsonb document** (`settings` key `company.details`, global) with its own API (`/admin/company`, `/company`), not new "text" kinds in the numeric settings registry. Reason: the registry (`settings.ts`) is typed int/boolean everywhere (labels, bounds, units); a text kind would touch every consumer for ten fields that always save together. Cost if wrong: moving to per-key text settings later is one data migration of one row.
- **Legal name, GSTIN and registered address keep the built-in user-confirmed values (Q15) until the admin fills them**; CIN and the grievance officer are hidden until filled (the design's rule). Hindi pages never fall back to the admin's English text: they use the Hindi field, else the built-in Hindi text. Cost if wrong: one line in `companyFor` (show nothing for an empty field instead).
- **Home layout: live on save, no draft**, permission `content:publish` (it changes the live home page), stored as a `settings` document per scope (`site.home_layout`; a city row beats the global one; no row = the default). Cost if wrong: add a draft status and a publish step (same shape as policies).
- **Policy history: a new append-only table `content_versions`** for every content key (only policies have the UI), not the audit log. Reason: history must be queryable and restorable without parsing audit JSON, and the audit log is redacted. **Restore publishes at once as a new version** (needs `content:publish`), instead of creating a draft. Existing published rows become version 1 in the migration.
- **Cache refresh by tag through `POST /api/revalidate`** (server to server, shared secret `REVALIDATE_SECRET`, tags `content`, `site-layout`, `company` only, constant-time compare, 404 when unset), with the 60 s revalidate window as the fallback. New env on API and web. Cost if wrong: remove the route; changes then show within 60 s.
- **The footer stays a synchronous server component**: only its legal block and copyright line are small async server children (`company-legal.tsx`), so nothing is added to any client bundle the header or layout loads (JS budget incident 2026-11-15). Locale passed as a prop, not read with `getLocale()`, so the page stays static.
- **City values screen shows the picker only to staff with `settings:write`** (super admin today, unchanged); city managers do not get write access to settings. The layout screen uses the same picker (marketing sees "All cities" only).
- **No new permission** (reused `content:write`, `content:publish`, `settings:read`, `settings:write`); so no `db:seed`. Migration `0063_admin_policy_history` is not applied; the coordinator renumbers at merge.
- **Not done:** the map default is stored and served but the workshop map still reads the browser store (the map is a client component under three pages; passing the value from the server is a follow-up); public policy pages read the launch city only until the city selector (spec 15).

## 2026-11-15 — Workshop analytics built (rulings)

- Portal Performance is for the `workshop_owner` grant only (staff would see money); no new permission. Admin needs `analytics:read`, one city at a time.
- City medians are medians of workshops' own figures and are shown only from three workshops with requests (anonymity). The portal never carries another workshop's name.
- Acceptance = proposed ÷ (proposed + declined): workshops have no response timer, so "timed out" does not exist. Services are paid at the workshop only, so "paid online vs at the workshop" is by method (cash / UPI / card).
- "Returned within 30 days": same customer, same vehicle (saved id, else vehicle key) and same workshop, a new request that is not cancelled or rejected within 30 days of completion. Label is neutral on purpose.
- Migration `0064_workshop_analytics` adds `service_requests (workshop_id, created_at)` only. Events use camelCase props (`rangeDays`), like the rest of the catalogue. Plan: `docs/superpowers/plans/2026-11-15-workshop-analytics.md`.

## 2026-11-15 — Support threads, photo attachments and the COD refund destination built (builder rulings under the approved design)

Design: `docs/superpowers/specs/2026-11-15-support-next-tier-design.md` items 1 to 3; built description: spec 09 § "Order and request threads, photos and the COD refund destination"; security: spec 13 § "Support attachments and payout details".

- **One open thread per customer and order or job, by database index; a closed thread frees the slot.** The design says "one open ticket", and `closed` is terminal in `ticketMachine`, so the partial unique indexes exclude closed. Cost if wrong: after a close the customer's next help gets a new `REQ-` code instead of reopening the old one.
- **The subject is the checkout group code; the ticket links its first sub-order.** A multi-shop order has one conversation (customers do not think in sub-orders). Cost if wrong: a refund made from the ticket targets that one sub-order; staff use the refunds screen for the others.
- **Attachments are `media_objects` rows with owner kind `ticket_message`**, not the unused jsonb `ticket_messages.attachments` column. Cost if wrong: a dead jsonb column stays (dropping it is a later migration).
- **Image URLs reuse the job-photo signing key and rule** (10 minutes, one photo; media ids are unique, so a signature for one photo opens no other). Cost if wrong: rotating the keyring invalidates both families at once, which is harmless (URLs are re-issued on every listing).
- **A message must have text; photos alone are not a message** (the body CHECK is 1 to 5000 characters and a photo-only row would need placeholder text in the database). Cost if wrong: customers type one line with their photos.
- **The payout destination lives on the ticket (encrypted + mask) and is copied into the refund; the ticket copy is locked once a manual refund exists.** Cost if wrong: two encrypted copies exist until a purge job runs; a purge after payout is queued (`docs/questions-for-user.md` Q115, default keep 30 days after the ticket closes, not built).
- **The refund from a ticket needs both `tickets:reply` and `refunds:initiate`** (support agents and ops have both). Cost if wrong: a role with only one cannot use the button; they use the refunds screen.
- **Staff cannot attach photos** (items 1 to 3 are customer evidence). Cost if wrong: staff describe in words.
- **No new notification template**: `ticket_received` and the `staff.new_ticket` bell fire on a new thread, `ticket_reply` and `ticket_resolved` as before. A customer message on an existing thread does not bell staff yet (pre-existing gap for every ticket). Cost if wrong: a reply waits in the inbox until someone looks; follow-up with inbox tools (item 4).
- **Rate limits:** threads 20 an hour, photo uploads 20 per 10 minutes, payout destination 10 an hour, per customer.

## 2026-11-15 — Repository public for now (Q113)

- **User (2026-11-15):** "ive made the repo public just for now" — GitHub Actions minutes ran out; a public repository makes
  standard runners free, so CI and deploy run again.
- **Checked first:** full-history secret scan (counts and masked values only): no `.env` file ever committed; Razorpay,
  `sk_live`, PostHog and Postgres-URL matches are all test fakes or `.env.example` placeholders. Deploy runs only on a push
  to `main` of this repository (`workflow_run` guard); fork pull requests get no secrets (GitHub default).
- **Rules while public:** never commit real keys (already a hard rule); keep fork-PR workflows on "require approval";
  security findings are fixed before they are described in commit messages in detail.
- **Later:** before going private again, set an Actions spending limit or move CI to a self-hosted runner that is not
  the production server (Docker builds would starve the live site of memory).

## 2026-11-15 — Coupons built (builder rulings under the user's "Next tier answers")

- **Who funds what is money in the payout ledger.** MechDost-funded: the delivering shop is paid in full, so a `coupon_discount` payout entry (positive, like `coin_discount`) makes it whole for the discount it did not collect. Shop-funded: no entry, the shop's payout is simply the lower amount, and the shop must have accepted the terms first. A shop-funded discount on an order routed to a different shop is made good by MechDost (the funder never pays for another shop's goods). Cost if wrong: finance changes one function (`recordShopCouponDiscount`); the order keeps its snapshot, so no history is lost.
- **Free delivery is always MechDost-funded** (CHECK). A shop does not control the delivery charge. Cost if wrong: one CHECK and the admin form.
- **Minimum order is measured on the products the coupon applies to** (a shop's offer cannot be unlocked by another shop's goods). Cost if wrong: one line in `applyCoupon`.
- **Coins after the coupon, on the net products; COD cap after both; GST stays on the gross line** (the same as coins today). Under CGST s.15(3)(a) a discount shown on the invoice reduces the taxable value, which matters for shop-funded coupons: queued as Q114 with the current behaviour as the default. Cost if wrong: invoice tax lines change (needs a design for tax on the net line).
- **Release on cancel or reject only when every part of the order is dead; partial refunds, partial cancels and delivered orders keep the use.** Cost if wrong: customers on a multi-shop order cannot reuse a limit-1 coupon after one part is cancelled (they can still get the money back).
- **No coupons on bulk quote orders** (spec 19), same as coins.
- **Codes are never listed publicly.** The customer types a code and sees its conditions and saving before applying; checks are rate limited (30 per hour per user, 60 per IP). Cost if wrong: a public "offers for you" list needs a new endpoint and a visibility flag per coupon.
- **Admin edits compare-and-set on `config_version`**, not `version` (the usage counter bumps `version` with every order). Funder, kind and shop lock after the first use; money changes on a shop-funded coupon re-ask the shop.
- **Largest-remainder allocation across lines** (ties to the earlier line); recorded in spec 03.
- Not built (queued in the ledger): public offers list, coupon reports (usage per coupon in analytics), campaigns/automatic offers, whole-order refund after delivery releasing the use.

## Workshops tier 1 rulings (2026-11-15)

- **Slots are a table with a unique hour row and a CHECK, not an exclusion constraint.** Spec 06 mentioned an exclusion constraint for capacity 1; the unique row plus `booked <= capacity` covers every capacity with one mechanism. Cost if wrong: none visible; a per-bay model would need a different table.
- **Slots are made on demand**, not by a nightly job: no job to fail, no rows for closed or far-future days. Changing the default capacity affects hours not yet touched; existing rows keep their own number.
- **`hour` is optional in the propose API for now** (the older hourless form still works, takes no capacity) so existing clients and tests keep working; the web portal always sends an hour. Cost if wrong: a client that skips `hour` bypasses capacity. Queued as Q116 to make it mandatory.
- **A reschedule that the workshop does not answer goes back to routing** (the old booking was released at once). Cost if wrong: the customer loses their confirmed slot on a timeout; the alternative (keeping the old slot until the new one is accepted) needs a second live proposal per request.
- **Pin and GSTIN changes are requests; the old values stay live meanwhile** (instead of setting `location_verified` false, which would unlist the workshop). Cost if wrong: a moved workshop keeps its old pin on the map until staff act.
- **A self-service pin change stays inside the workshop's city** (security review): approving a PIN of another city would move the workshop out of the approver's scope without its `city_id`. City moves remain an admin edit.
- **Busy mode and menu ranges reuse `service_menu:write`**; no new permission, so no `db:seed`.
- **No new email or bell templates** for the timeout and the reschedule: the timeout is internal (like a decline) and the customer started the reschedule. Queued as Q117.

## 2026-11-15 — Shop portal tier 2 (stock CSV, packing slip, performance, status lookup)

- **CSV is all-or-nothing and re-checked on apply.** The preview is advice; apply parses and checks the file again inside one transaction and refuses the whole file on any line error. A price in the file is only a price request (decision 2026-11-13 "shop prices need approval" stands). A price for a SKU not yet sold is a request to start selling (needs stock). Cost if wrong: a shop that wants direct price edits still uses the price-request screen; nothing is bypassed.
- **No new CSV dependency; own QR encoder.** The existing RFC 4180 parser is reused; the packing-slip QR is a small encoder in `packages/shared/src/qr.ts` (byte mode, level L, versions 1 to 4) instead of a package (`docs/research/security-vulnerabilities.md`: smaller supply chain, no install scripts). It is verified by reading the symbol back (format bits, Reed-Solomon syndromes, text); a real scan is Q119, and the order code is printed beside it. Cost if wrong: re-draw with a package, the slip layout stays.
- **Packing slip shows first name and masked phone** (Q99 pending; masked by default), no prices, no street address, no delivery code; only while the shop is fulfilling the order.
- **Performance: owner only; anonymity as the workshop benchmark.** Median of other shops in the city, all of the owner's shops left out, at least 5 others per metric, none shown for an owner spanning cities. "On time" = shipped within 24 h of accepting, a constant for now (Q118).
- **Status lookup proves the phone with a Firebase one-time code, not an account.** The API verifies the ID token directly and creates no user; the answer is the stage only and identical for a wrong reference or phone; no Turnstile on top of Firebase's reCAPTCHA plus limits (Q120).
- **Fix:** the shop portal page now loads the `shopTier1` namespace too (it was missing from its `ClientMessages` list).

## 2026-11-15 — CSV exports built (builder rulings under the approved design, admin next tier item 4)

- **Advisor brief (key lines):** "Areas: UI · API · DB (indexes) · RBAC · security · analytics · i18n · docs." "Hard rules at risk: 3 (bounded reads, audit), 4 (permission in the API, city scope, rate limit), 9 (events), 10 (en + hi)." "Conflicts: design says pg-boss job + bucket; the brief allows synchronous streaming for small ranges." Applicable learnings L170 (reuse `customers:read_pii`), L194 (tooling).
- **New permission `exports:run`** (the design allowed it "if missing"; `orders:export` exists but covers orders only and nobody holds it for refunds or partners). Held by super admin (all), ops manager, city manager, finance. **`pnpm db:seed` needed on the live database.** Each dataset also requires its own read permission, so finance exports orders, sub-orders, refunds and partners but not customers or service requests. Cost if wrong: a role exports less or more than wanted; a grant list edit in `rbac.ts` plus a seed fixes it.
- **Streamed download, not a stored file (Q121).** The brief offered either; the design's job and bucket add retention and purge work for exported personal data, and the bounds (180 days, 50,000 rows) fit one request. `POST /admin/exports` audits and returns a signed 10-minute path bound to the staff member; `GET /admin/exports/download` re-authenticates and re-checks. Cost if wrong: a range that needs more than 50,000 rows is refused (narrow it) and files cannot be shared by link; the stored-file route can be added behind the same request endpoint.
- **Replayable inside 10 minutes** by the same signed-in person (each download audited); one-time use would need Redis state. Cost if wrong: a leaked link is useless to anyone else anyway (actor-bound).
- **Datasets:** the design's "events (pseudonymous)" export is left out (no owner for the event store dump yet); "orders" means checkouts (`order_groups`), "sub-orders" the per-shop orders; "partners" is shops plus workshops by creation date; "customers" is every non-deleted account created in the range (staff and partner owners included; Q121). Cost if wrong: a filter or a dataset is added later.
- **Money and time in the file:** `<x>_rupees` (two decimals, string maths from integer paise) next to `<x>_paise`; times formatted to IST in SQL; CSV header names are English snake_case codes in both locales (machine-readable file, not UI text).
- **Migration 0066_export_indexes** (orders by city + placed time, refunds by time, users by time) so every export read is an index range scan; not applied.
- **Link signing** uses the keyring index key (like photo URLs); without a keyring the routes answer 503 `EXPORTS_UNAVAILABLE`. 40 calls an hour per staff member.

## 2026-11-15 — Support next tier items 4 to 7: builder rulings

- **First-reply SLA replaces the 48-hour acknowledgement** (`sla_ack_due` is the first-reply deadline: 120 working minutes inside support hours 9:00 to 21:00 IST, every day; admin settings `support.hours_start_minute`, `support.hours_end_minute`, `support.first_reply_working_minutes`). Support hours are minutes after IST midnight (the settings registry holds integers and booleans only), and an inverted window falls back to the defaults. The WhatsApp bridge and thread routes use the same helper.
- **Auto-close:** setting `support.auto_close_days` (default 7); only `resolved` closes by itself (waiting-on-customer requests stay open). Worker sweep every 10 minutes, one conditional UPDATE per request on `version`.
- **Assignment permissions:** `tickets:assign` managers assign anyone in their city scope; agents with only `tickets:reply` may take a free request or release their own (security review). Canned reply editing needs an all-cities `content:write` (global list); reading needs `tickets:reply`.
- **Guest ticket key:** 16 base-32 characters (80 bits), shown once, SHA-256 stored (high entropy, no salt needed), constant-time compare; per-reference limit of 10 attempts an hour deliberately also blocks the right key once spent. Guests can ask about order, fitment, account or other (no refund or redo: they have no account). **No email, WhatsApp or SMS to anything a guest typed**, so the key is the only way back (it cannot be recovered; the guest opens a new request if lost). Public routes live under `/support-guest` because `/support/*` is the signed-in stack.
- **Deletion request route:** `POST /v1/support/deletion-request` instead of `/me/deletion-request` (spec 01) so it uses the support guards and limits; confirming needs `customers:block` (super admin today). Confirming records the step only; the erase job is Q122.
- **No new ticket events table:** `audit_log` rows (`ticket.assigned`, `ticket.auto_closed`, `ticket.guest_created`, `user.deletion_requested`, `user.deletion_confirmed`, `canned_reply.created|updated`) plus server events cover it, as the existing ticket actions do.

## 2026-11-15 — Catalogue tier 2 built: recommendations, privacy, notify me (builder rulings)

- **Co-purchase at product level, by order group, delivered only, min 3 checkouts, top 20 per product, nightly** (03:00 IST) plus once a minute after the worker starts. Cost if wrong: counts for pack sizes merge (a variant table is a migration); three checkouts is a low bar on a tiny catalogue (one setting).
- **Rules first, then co-purchase; rules fill the cap if they have enough products.** Spec 11 order kept. Cost if wrong: a busy rule hides co-purchase results (a per-rule limit or an interleave is a small change in `recommendFor`).
- **Cart suggestions use a cookie of product slugs** because the cart page is a Server Component and the cart is in localStorage until the server cart lands. Slugs only, no person, no consent needed (functional). Cost if wrong: a few bytes in the cart bundle and a per-request cart page (Q141); the server cart removes it.
- **Cart uses a client-free card, the product page the full card** (JS budget). Cost if wrong: a customer opens the product to add; one more tap.
- **Rules reuse `categories:write`; waitlist demand reuses `cities:manage`.** No new permission or `db:seed`. Cost if wrong: finance or marketing cannot manage rules without the catalogue role.
- **Privacy lists only purposes that have an effect today (`marketing`, `analytics`).** Showing `whatsapp`, `location` or `share_with_partner` toggles that do nothing would be a dark pattern. Cost if wrong: add rows to one constant when a feature uses them.
- **Analytics consent is both the server row and this browser's choice.** The server row is the record; the browser choice is what stops events. Cost if wrong: another browser of the same person keeps its own choice until they open Privacy there.
- **The data download is the authenticated API route, not a signed public URL**, with the JSON kept in the export row for 24 h and cleared by the worker; no Storage bucket, no new secret. Cost if wrong: a larger export (over 2 MB) is refused (`too_large`) until a Storage-backed export is built.
- **One export per person at a time and one a day; a failed one does not count.** Cost if wrong: support gets "I need it again today" requests.
- **Account deletion is a hook, not a system.** The Privacy page links to Account -> Support with `topic=account_deletion` (`ACCOUNT_DELETION_HOOK`) until the support ticket kind from "Support next tier" is merged; then swap the constant (Q140). Cost if wrong: the support screen ignores the topic and the customer types the request.
- **Notify me needs a verified phone or email on the account, joins are idempotent, five per person, the PIN need not be listed, "now served" is a bell notice (push per choices).** Email/WhatsApp for it needs a template and consent (Q142). Cost if wrong: customers who never open the app miss the message.
- **Migration `0068_catalogue_tier2`** (four tables, RLS, triggers); not applied; the coordinator renumbers at merge.

## 2026-11-15 — Product photos, server cart and wishlist built (builder rulings under the user's "Next tier answers")

- **Public photo serving goes through the API by id with a one-year immutable cache, not through a public bucket.** Reason: the bucket stays private (a refused or removed photo stops at once; no Storage URL or key ever leaves the server; Storage keys are still unverified, Q112); the id is never reused, so a long cache is safe. Cost if wrong: images read Storage once per cache miss; put Caddy or a CDN in front of the path (Q131) or switch to a public bucket for approved photos only (one repository function and the web loader change).
- **No Next image optimizer for product photos.** The API already stores 320/640/1600 WebP; the web loader maps widths onto them, so no remote pattern and no resize work on the web server. Cost if wrong: add the Storage/API host to `images.remotePatterns` and drop the loader.
- **`product_photos` reshaped in place and emptied by the migration** (it was never written). Cost if wrong: none (no data existed).
- **Photos limit counts pending and approved together** (8 live rows), so shops cannot crowd out the cover; refused photos free their slot.
- **Cart merge takes the larger quantity (idempotent), the server cart wins on the first visit of a page load, later edits are last-writer-wins.** Cost if wrong: two devices editing in the same second can overwrite each other; a per-line version would fix it.
- **Only merge is audited in `audit_log`; cart replaces and wishlist changes write events only** (high-volume, customer-owned data; the event store is append-only). Cost if wrong: add one insert per write.
- **The wishlist and the server cart exist in real sign-in builds only**; the demo build keeps its browser cart and has no wishlist.
- **The cart holds SKU + quantity only; prices are never stored or accepted.** The "re-validate prices" requirement is met by pricing every cart through the checkout quote.
- Questions queued: Q130 (shop photo uploads on/off at launch), Q131 (cache in front of the photo route; Hindi word for wishlist).

- **Shared-device rule for storefront client state (security review follow-up, 2026-11-15):** the browser cart carries an owner uid and is cleared on sign-out; the wishlist cache is keyed by uid and reset on sign-out and uid change; both ignore late answers (generation counter). Cost if wrong: a stray cart line is lost when a customer signs out and back in on a device without the server having it yet (the server copy returns it at sign-in).

## 2026-11-15 — Several devices at once: per-line cart operations, polling now, pings ready (builder rulings, user request)

- **Per-line server operations instead of a versioned whole-cart PUT.** Add (increment), set (that line), remove, each a single conditional statement under the user-row lock; the browser sends only the difference between its cart and the last server snapshot it saw. Why: edits on two devices compose without a retry loop, a stale copy can never wipe another device's line, and the limits hold under parallel requests. Cost if wrong: the same line set on two devices in the same second keeps the later value; a per-line version would add 409 handling.
- **The server cart wins on page load; the browser never pushes a whole stale copy.** The snapshot (account, version, lines) is kept in the browser; a copy equal to it has no pending edits.
- **Freshness by a 60 s visible-tab poll with `?since=<version>`**, plus an immediate check on visible/focus, on opening the cart or checkout and after sign-in; back-off to 5 min on errors; none for signed-out shoppers. Cost if wrong: a change shows up to a minute late until the live listener exists.
- **Live pings are written now (triggers → `live_outbox`, kinds `cart`/`wishlist`, topic `user:<id>`), the browser listener is the next step** (one lazy shared RTDB listener for bell + shop offers + cart + wishlist; `refreshStorefront` is its entry point). No Firebase database SDK in the web bundle in this task (JS budget). Cost if wrong: none; pings are hints.
- **An order removes the ordered packs from the saved cart in the same transaction** (COD at placement, online at payment). Cost if wrong: an abandoned online payment keeps its lines in the cart (they are removed only once paid, on purpose).
- **Wishlist ping versions are commit-time seconds** (pings are hints; the refresh uses a content fingerprint). Cost if wrong: two changes in the same second may share a ping version; the poll covers it.

## 2026-11-15 — Workshops next tier, items 5 to 7 (builder rulings)

- **Bill payments reuse the order payment tables, widened, not a parallel set.** `payments` gets `purpose` and `bill_id` (group nullable, CHECK exactly one), `refunds` gets `bill_id`. One webhook, one verify route, one refund queue and finance approval (decision 2026-11-15 "all refunds need approval" stands). Cost if wrong: a later split into separate tables means a data move; the CHECKs make the two kinds distinguishable.
- **The workshop's "paid at the workshop" stays; no customer confirm step was added.** Both settle paths take the request row first and only one can leave `billed`. A capture that arrives late is recorded and refunded by request, never a second settlement. Cost if wrong: a customer who paid cash and online gets the online money back after finance approval (days), which is the safe side.
- **No coins or coupons on service bills** (Q150). Cost if wrong: a later discount path through the bill snapshot, whose total is a CHECKed sum.
- **Staff cancel works from every live state, so the machine gained admin-only cancel edges from the job states.** Completed stays final. Permission `service:cancel` is new (ops_manager, city_manager, super_admin): run `pnpm db:seed` after merge. Cost if wrong: remove the edges and the permission; no data depends on them yet.
- **Ranking constants are builder choices** (Q152): equal weights, 25 km, load = open jobs / (capacity x 4), 90-day window, neutral score for a missing value (a new workshop is neither punished nor favoured), timeouts count against acceptance (design 2026-11-15). Cost if wrong: change constants in one file; no stored data.
- **Bill orders never expire** (Q153): the amount of a bill cannot change, so an old open order stays valid and a late capture is refunded. Cost if wrong: a sweep job later.
- **Idempotency of "pay online" is structural:** the unique open-order index returns the same Razorpay order to a double click, so no `Idempotency-Key` header was added to the new route.

### 2026-11-15 - Browser live listener (builder rulings)

- **Single read path:** the browser reads only `inbox/<uid>`; shop, workshop and city staff topics are resolved to user ids by the relay (permission-based, Postgres), so no topic rules exist in RTDB. Cost if wrong: a new rule per topic family and a second listener; the relay would not change.
- **Rules harden anonymous:** the read rule also requires `sign_in_provider != 'anonymous'` (anonymous Firebase users have `auth != null`). No code uses anonymous auth, so nothing breaks.
- **Hub plus listener split:** a light hub (no Firebase) is imported by consumers; the heavy listener only by dynamic import from the hub. Connection closed while the tab is hidden, one catch-up refresh on return. Polling is never switched off (a ping is an accelerator). Cost if wrong: a few more conditional reads per minute; no data risk.
- **New public config `NEXT_PUBLIC_FIREBASE_DATABASE_URL`:** unset means the browser never connects (Q160). New web dependency `@firebase/database` pinned to 1.1.5 (already in the lockfile through firebase-admin, so no new release to vet; it is lazily loaded).
- **No analytics event for the connection** (no catalogue place; spec 12 untouched). Rule emulator tests queued (Q160) because the repo's emulator setup has Auth only.
- Supersedes the "no browser listener yet" note of 2026-11-15 "Polling, not live pings, feeds the bell for now": the bell and shop offers now also refresh on a ping; polling stays as the fallback.
- **Audit round (same day):** hub fetches the listener only when idle and visible and closes 2 s after the last release (no churn on effect re-runs); listener callbacks are uid-bound; rules gained a `$node` guard (`.write` and `.validate` false). Cost if wrong: a one-second later first connection; nothing stored.

## 2026-11-15 — UI audit decisions (Q170, user)

- **Compare with one product (user: "the compare tray shouldnt show with only one product selected but it also
  shouldnt give the impression that the button did nothing").** The tray appears from 2 products. Ticking the first
  product gives immediate, visible feedback next to the control: the box stays ticked and a short line says it was
  added and to pick one more (en + hi), also announced through the existing live region. The UI state audit rule
  changes from "list holds 1 → tray shown" to "list holds 1 → no tray, a visible confirmation; 2+ → tray".
- **Privacy banner on phones (user: "the cookie banner shouldnt cover the checkout button or other buttons on
  phone").** While the banner is open it must not cover any control: the page reserves bottom space equal to the
  banner (and the tab bar / compare tray when present) so the last controls scroll clear, and fixed launchers (Ask
  MechDost) sit above it. The audit keeps "covered by the banner" as a real finding.
- **Footer "Privacy choices" link covered by the open banner:** still open (Q170 part 3); default: acceptable, since the
  link reopens the same banner.

## 2026-11-16 — Testing against the real API and live database (user)

- **User: "idm u using real api and real deployed website for testing either bc like we are going to reset the
  database before launch anyway".** Tests may use the real API (`api.mechdost.com`) and the live database; the database
  is reset before launch, which removes test data.
- **Ruling (coordinator):** the live website runs in demo mode (`NEXT_PUBLIC_AUTH_MODE` / `NEXT_PUBLIC_DATA_MODE` =
  `demo`), so real-sign-in screens are tested with a local real-sign-in build pointed at the real API, using only the
  seeded demo accounts (`docs/runbooks/demo.md`). Before such a run: the demo accounts' email addresses point at inboxes
  the user controls (no mail to strangers), Razorpay stays on test keys, WhatsApp/SMS stay off. Plan: the mocked UI state
  audit (chunk G) keeps covering states real data cannot produce; a real-API pass covers the main flows end to end
  (order → shop accept → delivery code; service request → estimate → bill → pay; support ticket → reply; refund →
  finance approval; coupons; wishlist and cart across two sessions).

## 2026-11-16 - Client message bundles must cover every client namespace (builder ruling)

- Real-sign-in screens showed raw keys / `MISSING_MESSAGE` (workshopTier1, supportThread, workshopAnalytics, portal, refunds, plus accountApi, storefront, coupons, shopGiveUp, adminEmails, adminTier2, adminExports, trust, workshop, checkout). Fix: namespaces added to each page/shell `ClientMessages` list (api branch only where the page is conditional); `apps/web/test/client-messages-coverage.test.ts` is a standing guard with no allowlist (hard rule 10, spec 16 unaffected).
- Style constants moved from `portal-guard.tsx` to `portal-styles.ts` and `useNow` to `use-now.ts` so a page importing only styles no longer drags the guard namespaces. No behaviour or bundle change.

## 2026-11-16 — Audit harness, tooling and CI (batch 0b, builder rulings)

- **Baseline mocks for every API-mode row.** The calls signed-in pages make by themselves (bell, cart and wishlist refresh, lists after sign-in, a workshop page, home-visit settings, photo-queue card) are answered by `api-mode/baseline-fixtures.ts` with quiet typed fixtures; a row's own mock listed first wins. Reason: they produced about 1,300 false P0 "unmocked API call" lines in chunk G.
- **Checker corrections (the site was right):** wrapped inline links measured per line box; controls under an open modal (aria-modal, `dialog[open]`, open popover sheet) skipped; the Hindi gate ignores the visitor's echoed query values; `covered` judges positioned `pointer-events: none` overlays that paint (opaque background, image, svg, own text) by box overlap, so real overlaps are still reported; the compare rule follows "UI audit decisions": 1 gives no tray and a visible `[data-compare-hint]`, 2+ gives the tray.
- **The privacy banner opened on every audit row** because the seeded consent used notice version `2026-11` instead of `CONSENT_NOTICE_VERSION`. The harness now imports the constant; only rows with `consent=open` show the banner. Part of the 2026-11-15 banner-over-buttons findings may be explained by this; re-run before counting them.
- **`[data-compare-hint]` is the contract** for the one-product confirmation of batch 1a (rendered only while the list holds exactly 1 product, visible, next to the control).
- **CI builds the launch configuration (Q171, default yes):** job `web-real-mode`, `NEXT_PUBLIC_AUTH_MODE=firebase` + `NEXT_PUBLIC_DATA_MODE=api`, fake public Firebase values, build only. Costs about 3 more build minutes per push.
- **Tooling:** `state-audit-run.mjs G` builds `.next-api` when missing; `state-audit-api-build.mjs` resolves its paths from its own file.
- **2026-11-16 (builder ruling, batch 1c):** portal/forms audit fixes. Job-photo remove button sits beside its thumbnail (44 px, no overlay); portalField/portalPrimary/portalQuiet draw their own 3 px focus-visible outline in the focus token (both themes); a static test forbids outline-none without a focus-visible replacement (allowed: the main landmark and consent banner, programmatic focus only); demo login picker is one column under 640 px and wraps names; the workshop menu low/high price fields stack under 640 px. No new colours or radii.

## 2026-11-16 — Audit batch 1a, builder rulings

- **Product card badges (audit item 1).** "Bestseller", the vehicle type and "Fitment not listed" sit in normal flow in a
  wrapping row directly under the picture (`data-slot="card-badges"`), not absolutely over it. The SKU stays printed at
  the picture's foot, so nothing can cover it at any width or language. Same colours and shapes; the badge row belongs
  to the card's first grid row, so the card still has eight rows. Spec 02 and 21 updated.
- **Names are never cut (items 2, 3).** The compare column header and the workshop finder's service list wrap (no
  `line-clamp`); the service list keeps its first four services joined with " · " (no "+N more" needed).
- **Compare with one product (item 4, Q170).** The box shows `data-compare-hint` ("Added to compare — pick one more" /
  "तुलना में जुड़ा — एक और चुनें") only while its product is the single one in the list; the live region reads the
  same text instead of "(1 of 4)". A few lines inside the existing toggle (no new chunk, no new import).

## 2026-11-16 — Site chrome fixes, batch 1b (builder rulings)

- **Header at 1024-1279 px is icon-only for cart and account.** The cart label, the "Sign in" / first-name text and
  the brand tagline show from `xl` (1280 px); between 1024 and 1279 px the cart pill is emoji + count, the account
  entry is its icon or initial (the screen-reader name stays), nav links use `px-2.5`. A two-digit cart count and the
  signed-in header now fit at 1024 px in English and Hindi (audit item 2). CSS only, no new client code.
- **Open privacy banner reserves its height.** While `html[data-consent-open]`, `body` gets bottom padding of the
  banner height (`--consent-h`) plus the tab bar (phones) plus the compare tray when it asks; the assistant button
  rides just above the banner on every width instead of hiding (user, 2026-11-15, Q170: the banner never covers a
  button). Supersedes "the assistant button is hidden while the banner is open" (design-system, 2026-11-03).
- **Sticky header height is fixed, so `scroll-padding-top: 96px` stays.** Header = 72 px (84 px from 1024) + 1 px
  border, never taller (nothing in it wraps: labels are nowrap or icon-only); the account side menu is itself
  sticky at `top-28` (112 px) and the admin menu does not stick. The audit's "covered by the header" findings on
  side-menu links come from the checker scrolling with Playwright's own method (ignores scroll padding).

- **Icon-only header entries keep a hover title (2026-11-16 review).** The cart pill and the signed-out sign-in link carry itle={label} / itle={signIn} (same locale strings, so Hindi too) so sighted users still get the word at 1024-1279 px.
