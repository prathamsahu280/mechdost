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
