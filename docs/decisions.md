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

| #   | Topic                                                                                                                                                                                                                                                                                                            | Leaning                                                                                | When                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Payment methods at launch (COD + Razorpay vs COD only vs Razorpay only)                                                                                                                                                                                                                                          | Most probably COD + Razorpay                                                           | Later                                |
| 2   | Post-purchase P1 items at launch (exchanges, reminders, disputes, order chat)                                                                                                                                                                                                                                    | Probably include all (option 3)                                                        | Later (user, 2026-11-01)             |
| 3   | WhatsApp handoff from support tickets — **built 2026-11-03**: inbound WhatsApp → tickets, replies inside the 24 h window (spec 09)                                                                                                                                                                               | —                                                                                      | Later                                |
| 4   | Vehicle master data source (curated CSV vs licensed DB)                                                                                                                                                                                                                                                          | Most probably curated CSV, admin-editable, Vahan later                                 | Later                                |
| 5   | Vehicle fields may change                                                                                                                                                                                                                                                                                        | Option 1 for now                                                                       | Open                                 |
| 6   | Messaging provider (MSG91 vs Twilio) — **SMS only**; WhatsApp decided 2026-11-02: Meta Cloud API direct                                                                                                                                                                                                          | MSG91                                                                                  | Later (setup only, not during build) |
| 7   | Geocoding/autocomplete + routing provider (Google Places vs Ola Maps; OSRM/Ola routing)                                                                                                                                                                                                                          | Decide via 50-address Raipur bake-off                                                  | During service-flow build (Phase 2)  |
| 8   | ~~Hindi UI at launch or P1~~ decided: both at launch                                                                                                                                                                                                                                                             | —                                                                                      | Done                                 |
| 9   | Commission and payout model for shops/workshops                                                                                                                                                                                                                                                                  | Ledger built generically; rates configurable per category/partner; user will decide    | Later ("ill tell u on this later")   |
| 11  | GSTIN + address confirmed 2026-11-01; CIN + grievance officer name still needed                                                                                                                                                                                                                                  | —                                                                                      | Before launch                        |
| 12  | Razorpay MCP connection (test keys)                                                                                                                                                                                                                                                                              | Add when Razorpay account is ready                                                     | Later                                |
| 13  | ~~"ux superpower" skill identity~~ confirmed obra/superpowers (2026-11-01)                                                                                                                                                                                                                                       | —                                                                                      | Done                                 |
| 14  | Baseline walkthrough: remaining untouched P0 items use the baseline defaults (coupons engine, attribute sets, part numbers, SEO, OOS handling, admin CRUD conventions, impersonation in P1)                                                                                                                      | Defaults                                                                               | Confirm anytime                      |
| 15  | Vehicle fields, commission, payment methods, post-purchase P1 — see rows 1, 2, 5, 9                                                                                                                                                                                                                              | —                                                                                      | —                                    |
| 16  | Hindi map: roads without `name:hi` in OSM show their local (English) name on `/hi` — keep, or hide them (inbox Q64)                                                                                                                                                                                              | Keep showing the local name; refs (NH30) always                                        | Before launch                        |
| 17  | Bulk quotes: attachments (≤ 5 MB images/PDF) and read receipts in the thread (spec 19)                                                                                                                                                                                                                           | Build with Supabase Storage after launch                                               | After launch                         |
| 18  | Bulk quotes: online payment (Razorpay) for an accepted offer, and whether staff choose COD / online per offer                                                                                                                                                                                                    | COD only at launch; add online with the Razorpay live keys                             | After launch                         |
| 19  | Coin order-reward guard: what stops order → delivery → claim → repeat farming before `coins.earn_order_bp` / `coins.first_order_bonus` can be above 0 (options: rewards only after the claim window with no open ticket, per-customer monthly cap, minimum order, first order only for verified phone + address) | Decide when enabling (user 2026-11-14); saving above 0 is refused meanwhile            | Before order rewards are switched on |
| 20  | Job photo purge: how long soft-deleted and orphaned photo objects stay in the private bucket, and who may restore one                                                                                                                                                                                            | Keep them (audit and complaints) until a retention job is chosen                       | Before launch                        |
| 21  | Credit notes: who issues them once Q97 (invoice issuer) is decided, and whether they need a PDF (Q174)                                                                                                                                                                                                           | MechDost `CN` series for orders with a MechDost tax invoice; no PDF                    |
| 22  | Settling an unsure refund by hand: a second person above an amount threshold (Q175)                                                                                                                                                                                                                              | One finance user other than the requester, no threshold                                |
| 23  | A second capture for an already paid checkout: refund request or dashboard only (Q176)                                                                                                                                                                                                                           | Flag only; refund from the Razorpay dashboard                                          |
| 24  | ~~Notification priority per kind editable by admin~~ **Closed 2026-11-25: user ruled no; the code constant stays**                                                                                                                                                                                               | Keep the constant until ops asks; then a per-kind override table read by `queueNotice` | After the first week of real use     |

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

## 2026-11-16 — Audit batch 2B builder rulings (admin audit log, coupons, refunds, shop CSV, compare)

- **The compare bar appears from two products** (UI audit decisions, 2026-11-15, now built): `trayVisible()` in `lib/compare/tray-visible.ts`; with one product the card shows the `[data-compare-hint]` line and the bar stays away (a question or notice still opens it). The tray loader no longer loads the tray for a list of one.
- **Compare page scroll padding includes the sticky product strip:** `[data-compare-head]` is measured (ResizeObserver, `--compare-head-h`) and `html:has([data-compare-head])` adds it to `scroll-padding-top` (71 px / 83 px from 1024 px + height + 12 px), so focused names and remove buttons are never left under the strip. The strip stays as is.
- **Audit log shows codes as words:** entity and action filters are selects of the known codes; rows show `auditLabel()` wording from `adminPeople.auditWord` (per token) and `auditAction` (whole code); an unworded code is shown in `<code lang="en">`. Diff paths are shown as code.
- **Refund failure codes are worded:** `refunds.failure_*` through `refundFailureKey()`; the raw provider code is never shown. Staff notes and finance references carry `data-user-content`.
- **Stock file column names and yes/no values are shown as `<code lang="en">`** (the file's literal text; the API also accepts 1/0, which the Hindi problem line names). A coupon's pause reason and the shop's give-up note are staff or shop typed text: `data-user-content`.
- **Shop active-order cards:** actions sit at the foot of the card (`mt-auto`) so side-by-side cards line their buttons up.
- **Audit batch 2a rulings (2026-11-16, builder).** (1) Sideways-scrolling tables use `components/ui/scroll-region.tsx` (`role="region"`, `tabIndex=0`, accessible name, shared focus ring) so a keyboard can reach them (axe `scrollable-region-focusable`); never a bare `overflow-x-auto` div around a table. (2) `role` goes on an inner span, never on an `<li>` (it replaces `listitem`; axe `list`): refund lines use `<li><span role="status">`. (3) The signed-in header carries a bell, so the cart label waits for 560 px (was 480). (4) The UPI example is `9876543210@upi` in both languages (no English words on /hi). (5) Date/time inputs: Chrome's native picker button is its own tab stop that draws its own ring, but the host input is not `:focus-visible` then; the audit's "no visible focus ring" on `input""` (HOMEJOB, RESCHEDULE) is the checker, verified in Chrome 2026-11-16.

- **Signed-in header fits by construction (2026-11-16, builder; replaces ruling 3 of batch 2a).** The bell makes the signed-in row wider, so: the account name is text only from `xl` (an avatar with the name as `title` and screen-reader text before that; was from 640 px); the cart label from 560 px; the tagline from 760 px; brand 30/19 px until 460 px; bell, account, cart and language targets 40 px under 440 px (24 px AA minimum kept, 44 px from 440 px); primary-nav links `px-2` and the row gutter `px-6` between 1024 and 1279 px. Guards: `test/signed-in-header-fit.test.ts`, `test/site-chrome-fit.test.ts`, and signed-in cases (customer, shop, workshop; en + hi; 320-1280 px) in `e2e/chrome-fit.spec.ts`.
- **2026-11-16 (builder ruling, audit batch 2c): the audit harness answers server-side fetches and classifies its own noise.** A local server on `127.0.0.1:4100` (Playwright `globalSetup`, `e2e/state-audit/api-mode/server-mock*.ts`) answers the Next server's catalogue, product and workshop reads from the same typed fixtures as the browser mock; sticky or fixed items "covered by the header" are re-measured after `scrollIntoView({ block: 'center' })`; the Hindi gate accepts codes by shape (city codes, file formats, CIN/UTR, UPI ids, snake_case and dotted identifiers) but never generic words; fixtures carry Hindi like real content data; console errors caused by the audit's own blocking of third-party origins are not findings; the focus check accepts the native picker stop of date and time inputs. Details and manual checks: `docs/runbooks/ui-test-catalogue.md` § 9.10. No change to the shipped site.

## 2026-11-16 — Next builds, WhatsApp ready, Product Lens dropped (user)

- **Build next** (user: "we can work on building the refunds, bulk qoutes, and the smaller items too"): the refund
  follow-ups (spec 05 "Not built"), bulk quote follow-ups (spec 19 "Not built yet") and the smaller items (coupons
  public list / usage reports / automatic offers, shop staff performance and earnings, live service-request pings,
  RLS policies, review follow-ups). Order: after the audit fixes are deployed, alongside the visual review and the
  real-API pass.
- **WhatsApp is ready** (user: "the meta account is ready and the templates u gave me earlier have been approved"):
  Meta Cloud API direct (decision 2026-11-02). The approved templates are switched on per template once their names
  and languages are confirmed against the catalogue; sending stays off until the real-API pass proves it with the
  user's own number.
- **Templates created from the repo** (user: "can u like create the templates urself too like from here?"): yes, by a
  CLI that submits the repo's template catalogue to the WhatsApp Business Management API (create if missing, report
  status; token and WABA id from env, never printed). Submitting templates is outward-facing: the list is shown to
  the user and submitted only on their go-ahead (Q173).
- **Product Lens dropped** from the later phases (user: "for the later phases we will drop the product lens").
  Spec and plan updated to say so; nothing built for it.
- **Every opened form or panel can be closed** (user: "if we click write a review we cant really close the form …
  check those type of stuff too"): bug class. Every in-page form, panel, sheet or menu opened by a button has a
  visible Cancel/close, closes on Escape, and returns focus to the button that opened it. Guarded by a UI state audit
  rule and unit tests.

## 2026-11-16 — No page may feel like a reload (user rule)

User: "none of the pages should function like that" (admin side-bar click "feels like the page got refreshed and
takes me to the top"). Rule for every page, now and for new work:

- Moving inside the site never reloads the document (in-app links only; no plain `<a>` to internal pages, no
  `window.location` for internal moves).
- A frame shared by several pages (portal side bars, account menu, tabs, filters) lives in a layout and stays mounted;
  only the changing part swaps. No guard, header or menu flashes or redraws on a section change.
- No jump to the top when the user switches sections or tabs inside a page they are already reading; a new page
  starts at its top, a switched section scrolls only as far as needed to show its heading.
- A click shows feedback at once (pending state on the link or a skeleton in the changing part only); no blank frame,
  no layout shift (CLS < 0.05).
- Screen readers hear the change (focus or announcement on the new heading).
- Guarded by a source test (portals have layouts; no internal plain anchors) and an e2e test (frame node survives,
  no reload, no scroll jump). Checked in every UI review (`docs/design-system.md` § Calm UI).

## 2026-11-16 — Builder ruling: portal frames live in layouts (section switch no longer remounts)

Cause of the user's "page got refreshed" report: `admin/page.tsx` and `admin/[section]/page.tsx` (and the account pair) each rendered the whole frame (container, heading, message provider, role guard, side bar) from the page, and there was no `layout.tsx`. On every side-bar click the dynamic segment changed, so React unmounted and rebuilt the entire frame, and Next scrolled to the changed segment's top, which was the page top. Ruling (implements "No page may feel like a reload"):

- `admin/layout.tsx` and `account/layout.tsx` hold Container, PageIntro, `ClientMessages` (the union of namespaces) and the client frame (`AdminFrame` / `AccountFrame`: guard or session branches + side bar). Pages render only the section (`AdminSectionContent`, `AccountSectionBody`). The current section comes from `useSelectedLayoutSegment()`, not a prop. `PortalGuard` publishes the account through `usePortalAccount()` so the section reads it without the render function.
- The clicked side-bar link shows a pending dot (`PortalNavLink`, `useLinkStatus`), absolutely positioned, so no layout shift. Section roots carry `scroll-mt-28`: Next brings the new section into view only when its top is above the viewport, clear of the sticky header.
- Screen readers: Next's route announcer reads the new page title (each section page has its own `generateMetadata` title); focus stays on the clicked link so keyboard users keep their place in the bar. No extra focus move.
- Internal plain `<a>` fixed: the consent banner privacy link and the admin invite "Open" now use `Link`. Deliberate exception kept: the language switcher does a full document load (bugs 2026-11-13: cookie and theme).
- Guards: `test/no-reload-navigation.test.ts` (layouts hold frames, pages do not, no internal plain anchors, `window.location` only in the switcher) and `e2e/no-reload-navigation.spec.ts` (frame node survives, no reload, no scroll jump).

## 2026-11-16 — Builder: every opened panel can be closed (built)

- **Built (2026-11-16, builder):** the rule above is now mechanical. `PanelDismiss` (mounted once in the layout) maps Escape to the Cancel button of the panel that holds focus and returns focus to the opener; markup contract in `apps/web/src/lib/panel-dismiss.ts` (`data-disclosure-trigger` on the opener, `data-panel-cancel` on a visible 44 px Cancel, `data-panel-for` for toggles). Review forms (product page and order/service) got Cancel (`reviews.cancel`, event `review_cancel_<target>`); about 45 other panels were fixed in the same sweep (account, checkout coupon, portals, admin). Rulings: Escape discards unsent text (no confirm modal); the product editor in admin (`ProductEditor`) keeps its Back button only and is not wired to Escape because it has many unsaved fields; master-detail selection lists (refunds, quotes), tab panels and native `<details>`/`<dialog>`/popover are not button-opened forms. Guards: `test/panel-dismiss.test.ts`, audit check `dismiss` (`e2e/state-audit/dismiss.ts`), `e2e/panel-dismiss.spec.ts`.

## 2026-11-16 — Full UI audits run on GitHub while the repo is public

User: "u can only rerun the failed and changed checks and maybe even offload some to github actions to speed things
up … since the minutes are free atleast for the time i keep the repo public". The manual workflow
`ui-state-audit.yml` now runs 10 parallel shards and has `mode: demo` (A–F) and `mode: api` (G, real-sign-in build
with the mocked API); reports and screenshots come back as artifacts, ticked locally. With the minutes free, full runs
replace the "failed and changed only" re-run. If the repo goes private again, return to manual targeted runs (decision
2026-11-15). Guard: `packages/shared/test/audit-workflow.test.ts`.

## 2026-11-16 — WhatsApp template CLI built (builder rulings; Q173 stays open for the go-ahead)

`pnpm wa:templates` exists (`apps/api/src/notify/wa-templates-cli.ts`, runbook `docs/runbooks/whatsapp-templates.md`).
Rulings made while building it:

- **Modes:** `--dry-run` (default, no network, no credentials), `--status [--save]` (read-only GET), `--submit --yes`
  (creates only the missing name/language pairs; never edits or deletes). Submitting stays the user's call (Q173).
- **Text source:** template bodies are the existing `notifyTemplates` locale text (the same defaults the admin edits);
  button labels (en + hi) and sample values live in `packages/shared/src/whatsapp-meta.ts`. `META_TEMPLATE_COPY` is
  typed over the catalogue keys, so a new catalogue entry (quote events) cannot be added without its Meta copy.
- **Token:** reuses `WHATSAPP_ACCESS_TOKEN`; `WHATSAPP_MANAGEMENT_TOKEN` overrides it when set (different permission).
  New names in `.env.example`: `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_MANAGEMENT_TOKEN`. Meta's `paging.next` URL embeds
  the access token, so paging uses the cursor only; every output line is scrubbed of the token.
- **Per-template switch-on:** the admin's per-event switch (enabled template row) already existed. New: Meta approval
  status stored in the `notifications.whatsapp_template_status` setting by `--status --save`. **Once that setting
  exists**, `notificationChannelEnabled` for WhatsApp also requires `approved` for the language of the enabled row, so a
  template Meta has not approved (or rejected, paused) is never queued. Before the first sync nothing changes (admin
  switch only), so existing behaviour and tests are untouched. Global `WHATSAPP_ENABLED` stays `off` by default.
- **Admin view:** Admin → Notifications shows "WhatsApp approval: English …, Hindi …" on each event card (en + hi labels);
  API `GET /v1/admin/notifications/templates` adds `status` per catalogue entry and `whatsappStatusSyncedAt`.
- **Hindi button labels and the `https://mechdost.com` button origin are builder choices** (labels at most 25 characters);
  the English templates the user already registered by hand are not touched by `--submit` (it only creates missing ones),
  so their text may differ slightly from the catalogue; compare with the runbook table.

## 2026-11-16 — Refund follow-ups built (builder rulings under the user's "we can work on building the refunds")

Spec: `docs/specs/05-cancellations-returns-refunds.md` § "Built: refund follow-ups". Migration `0073_refund_followups` (not applied).

- **Settling by hand needs another person, a reason code and a note, with no amount threshold.** Whoever asked for the refund cannot settle it (code `FOUR_EYES` and CHECK `refunds_settle_four_eyes`); every refund already waits for a finance approval (decision 2026-11-15), so a money threshold would add a rule the user never asked for. Cost if wrong: a large unsure refund can be settled by one finance user (Q175 asks).
- **Three honest outcomes, never a guess.** `refunded_full` (Razorpay refund id required), `refunded_other_amount` (the refund takes Razorpay's real amount, the ledger moves to match, never above the capture) and `not_refunded` (refused when Razorpay already reported a refund id). The reservation is only freed on `not_refunded`. Cost if wrong: finance has one more field to type.
- **A late capture becomes a paid payment row with a refund request, never a completed order.** The payment machine gained `expired → paid` (system only) so the refund ledger and Razorpay's refund call have a captured payment to hang on; the group status is left as it was. One request per closed sub-order, source and reason `payment_after_close`, idempotency key `sys_late_<order id>`. A second capture on an already paid group stays flag-only (Q176). Cost if wrong: an `expired` group has a `paid` payment until the refund is processed.
- **Refund alerts ring the bell by the audit action, not by hand at each call site.** `auditMismatch` queues `staff.refund_alert` for the finance staff of the refund's city, once per refund and alert. Cost if wrong: a new alert name needs no code to ring, which is the point, but also rings for every `refund.alert.*` ever added.
- **Credit notes are issued when a refund is processed, only if the order has an issued tax invoice, in a savepoint.** Own series `CN`, one per refund (unique index), the invoice row locked so they never exceed it; a failure to write the note raises `credit_note.alert.not_issued` and never undoes the settled money. No PDF (invoices have no renderer yet). Cost if wrong: Q97 (invoice issuer) may move credit notes to the shop (Q174).
- **Item 1 (ticket-side payout form) was already built on 2026-11-15** (spec 09, spec 05 "COD refund from the support ticket"); verified, not rebuilt. Staff views show only the mask; the approver sees the full destination after approval (audited).

## 2026-11-16 — Builder ruling: the RLS mirror (migration 0073)

Built the Supabase RLS mirror (spec 13, `docs/research/rls-matrix.md`). Rulings: (1) **Identity from the JWT `sub` only**, mapped to `users.firebase_uid` inside the database; no policy trusts a role claim, because Supabase needs the token claim `role = authenticated` for the database role while spec 01 uses `role` for the app role. Memberships come from `shop_users` / `user_roles`. (2) **`private.jwt_sub()` reads `request.jwt.claims`** (what `auth.jwt()` does) so the same SQL runs in PGlite tests and on Supabase. (3) **SELECT only, no client writes**; column-level grants with a deny list (PAN, margins, staff notes, idempotency keys); new columns are unreadable until granted on purpose. (4) **Partners never read customer orders directly** (only their assignments), staff have no direct path. (5) **PGlite harness, not pgTAP** (no real Postgres in dev; `set role` works). (6) Helpers live in `private` (not exposed by the Data API), `SECURITY DEFINER`, `search_path = ''`; the advisor WARN about executable definer functions is accepted and documented. (7) New tables must be classified in `packages/db/test/rls-inventory.ts` (test-enforced). Not applied to the live database; the Firebase third-party-auth console step is Q177.

## 2026-11-16 - Builder ruling: RLS identity is pinned to the Firebase issuer and audience (security review, HIGH)

`private.jwt_sub()` returns the token's `sub` only when `iss = 'https://securetoken.google.com/<project>'` and `aud = <project>`, where the project id comes from the one-row table `private.auth_config` (RLS on, no client grants, unique single row, definer functions read it). Empty table = every policy sees nothing (dormant by construction). Reason: Supabase accepts tokens from its own Auth and any added third-party issuer; without the check one could carry a Firebase uid in `sub` and impersonate that user. The `role = authenticated` claim is **not** required by the policies: Supabase already maps it to the database role and every policy is `to authenticated`/`anon`, so a second check adds nothing and could break Supabase's own role mapping.

## 2026-11-16 — Quote follow-ups: online payment, photos, read receipts, WhatsApp, PIN-aware minimum (builder; user: "we can work on building … bulk quotes")

- **Online payment of a quote order reuses the order payment path whole.** Accept takes `paymentMethod`; online places the normal unpaid online order and the API returns the handle of the group's one open Razorpay order. No new payment table, route or state: verify, webhook, amount assert and expiry are the existing ones. The COD ceiling for quotes limits **cash** only. A gateway that is off is refused before anything is placed. Cost if wrong: none for cash customers; an unpaid online quote order is released by the worker and the quote stays `accepted` (queued Q191).
- **Photos: images only; PDF stays refused** (spec 13 "Uploads": a PDF can carry active content). Queued Q190 with the options. Photo messages need text (Q192).
- **Read receipts are per side, not per person**: the customer is one side, the MechDost staff team the other; the marker is the time of the newest message seen and only moves forward. The other side only ever sees "Seen" on its own messages (no ids, no names). Staff mark read only with `quotes:negotiate` (the people in the thread).
- **WhatsApp quote templates are catalogue entries with their default bodies in the locale files** (`notifyTemplates.quote.*`, like the other default bodies); sending stays off until staff switch the events on and Meta approves the templates (Q193, Q173).
- **Migration 0073** (`quote_attachments_reads`): `media_objects.owner_kind` += `quote_message`; table `quote_reads`. Generated by drizzle-kit, not applied to any live database; the coordinator renumbers.
- **Panels:** the decline panel now closes with Escape and returns focus; photo thumbnails open in a new tab instead of an overlay (nothing to close).

## 2026-11-16 — Shop staff performance and earnings; live pings for service requests (built)

- **Staff see their own numbers.** User, 2026-11-16: "owner sees all staff, staff sees own". This refines the shop tier 1 design anti-goal ("staff do not see payouts/performance money"): the owner sees every member, the whole shop and the payout ledger; a staff member sees only their own row, including the ledger value of the orders they delivered, never the shop total or another person. Decided in the repository from the caller's grants; the API only passes them in.
- **Attribution is the actor on the order timeline** (`order_events.actor_id`, `actor_type = 'shop'`), read through the shop's own assignments; no new column. An admin override, or a person who has since left, counts in the shop total only. Cost if wrong: small (history is append-only; the attribution rule can change without a migration).
- **"Earnings" = the shop's payout ledger** (`shop_payout_entries`: MechDost Coins and coupon discounts owed on delivered orders), integer paise, **IST days** (window from midnight IST of its first day). Shop sales are not in the ledger until weekly payouts exist (Q11); the screen's lead text says so. Queued as Q178.
- **Live pings for service requests use one `request` topic** (customer, users of the workshop holding it, city staff with `service:read`) and one trigger on `service_requests` (migration `0073`); the pings stay hints and **polling is never removed** (no `LIVE_TRANSPORT=rtdb` or no database URL: exactly the old behaviour). The RTDB rules need no new path (the inbox is generic and read-only for its owner; rule-text test added). Rules are not deployed by the builder (Q160).
- Tests and docs: plan `docs/superpowers/plans/2026-11-16-shop-staff-live-pings.md`; specs 06, 07, 10, 12, 14.

## 2026-11-16 — WhatsApp go-ahead and real-API test sends (user)

- WhatsApp Business Account: **Shourya Integrated** (user confirmed). Token (system user, never expires, has
  `whatsapp_business_management` + `whatsapp_business_messaging`) and account id set in the local `.env` and the
  server `.env` by the coordinator at the user's request ("u do it"), without printing either file. The user should
  rotate the token later (it was pasted in chat).
- User: "yes u can submit the 14 missing whatsapp templates to meta" — the Hindi versions of the six approved English
  templates and the four quote templates (en + hi), via `pnpm wa:templates --submit --yes` after a read-only
  `--status`; never edits or deletes existing templates.
- User: "yes u can send whatsapp messages to [the user's number] and emails to [the user's inbox]" — real-API pass
  test sends go only to the user's own number and inbox (kept out of the public repo; Razorpay stays on test keys).

## 2026-11-16 - Builder ruling: the MechDost logo is in the product (Q172, user: "put the logo file yourself ... convert it to svg")

The user's logo image (`apps/web/public/brand/source/logo-source.jpeg`, 1280x426) was traced into SVG and replaces the old text mark ("m" + arrow + wordmark) in the header, footer and email header. Rulings:

1. **The logo keeps its own colours exactly; the site accent stays `#ea5728`** (buttons, links, focus; no token change, so no new UI colour). Brand-asset colours sampled from the image (median of solid interior pixels): navy `#092349`, orange `#f67411`. They are brand artwork only, never UI tokens (`docs/design-system.md` "Logo").
2. **Dark theme artwork** swaps the navy parts to `#f4f7fb` and keeps the orange; the swap is CSS only (`.brand-logo-light`/`.brand-logo-dark`, same trigger as the theme icon, no JS, the hidden image is never fetched).
3. **Traced, not typeset.** The wordmark is custom heavy rounded lettering (not Manrope), so the whole logo is traced from the image (sub-pixel marching squares, light smoothing, polygon simplification at 0.25 px); the traced edges inherit the source image's slight softness. If the user supplies a vector master, replace the four files and rerun `node apps/web/scripts/make-brand-icons.mjs` (the PNG icons are built from the SVGs).
4. **Contrast (WCAG 2.2):** navy `#092349` on white 15.6:1, white `#f4f7fb` on dark surface `#101d31` 15.7:1, orange on dark surface 6.0:1 (pass); orange `#f67411` on white is **2.83:1**, under 3:1. Logotypes are exempt from 1.4.3 and the brand name is always available as the image's alt text and in the page title, so the logo stays as supplied; no UI text uses this orange (button text keeps `#d2461a`, link text `#bf3c12`).
5. **Brand alt text is "MechDost" in both languages** (Latin, hard rule 10). Tagline under the logo unchanged (en "Your automotive connection", hi locale string), shown from the tablet width as before.
6. Icons: SVG favicon with a dark-scheme rule, `favicon.ico` (32 px), apple-touch 180, PWA 192/512 plus maskable 192/512 on navy (mark inside the 80 % safe zone), 1200x630 share image, email header PNG (`/brand/icons/email-logo.png`, absolute URL from the site origin; plain wordmark if no origin). `src/app/manifest.ts` serves the manifest (the service worker still comes with Serwist).

## 2026-11-16 - Coupon follow-ups: public list, usage reports, refund release, automatic offers (builder rulings)

User: "we can work on building ... the smaller items too". Rulings (plan `docs/superpowers/plans/2026-11-16-coupon-followups.md`, spec 03 § "coupon follow-ups"):

- **An automatic offer is a coupon row** (`auto_apply`), not a new table, so counters, snapshot, allocation, release, payouts and reports are the existing tested pipeline. MechDost-funded only (a shop cannot be asked to accept terms nobody shows it). Its code is internal; typing it is "not valid".
- **Stacking: never.** One discount per order. A typed code and the best automatic offer compete; the larger discount wins, a tie goes to the typed code; the customer is shown what the other would have given. Replaces the open "default no stacking" question.
- **Public offers are an admin choice** (`is_public`, off by default), city-scoped, live only, no usage numbers, an automatic offer never prints its code. No home or shop teaser (JS budget gates stay untouched; revisit with a measured server-rendered strip).
- **Release after refund:** a delivered order's use goes back when every live sub-order is refunded in full; a partial refund keeps it (spec 03 earlier said "a delivered order keeps the use": amended). Not reversing the shop payout entry is a known gap.
- **Reports** count orders, released, uses kept (= `used_count`), discount given on kept uses, unique customers, IST days; the CSV dataset `coupon_usage` needs `exports:run` + `coupons:write` and carries a hashed customer reference only.

## 2026-11-16 - Full re-run triage 3c-2 (builder): Escape, availability fit, tray under the banner, QT timeout

- **Escape closes the panel opened last, even when focus is on the page.** Many openers unmount when their panel opens (the focused button disappears, focus drops to `<body>`), and with another Cancel already on the page the old "only if exactly one" rule did nothing (120 audit findings). `PanelDismiss` now remembers the last clicked `data-disclosure-trigger` key; `findPanelCancel(active, doc, lastKey)` prefers that panel's Cancel, else the last Cancel in page order. Supersedes "never guesses between several" in the 2026-11-16 Built entry. Site fix.
- **Shop Availability card** (320 px): the hours select shrinks (`grid-cols-[minmax(0,1fr)_auto]`, `min-w-0`) and the group wraps under "Closed today". Site fix.
- **Order cards "action rows aligned"**: the checker compared the TOP of each card's last control; a button that wraps to two lines is taller but sits on the same foot. It now compares the bottom. Checker fix.
- **Compare tray under the privacy banner is by design hidden below 1024 px until answered** (decision 2026-11-14, `globals.css`). The audit demanded the tray at 2+ products with the banner open (7 rows, all `consent=open`, width under 1024). `compareFacts.bannerHidesTray` and `trayHiddenByBanner` now exempt exactly that state; with the banner answered the tray is still required. Checker fix.
- **QT-PAGES timeouts (all `form=errors` on the thread)**: the "errors" step clicked the first visible submit, the quote chat's Send, which is disabled while empty; Playwright waited for it to enable and used up the 90 s budget. The step now presses an enabled submit only, 3 s timeout. Checker fix. The same step serves API-ADM-POLICIES/SHOPS/STAFF (6 OTHER timeouts), expected to clear; not confirmed (no browser run).

- **2026-11-16 (builder 3c-1, audit fixes):** (1) Section bars re-centre the current item on load, section change, font arrival and when focus leaves the bar (`useCenterCurrent`); the audit blurs focus before the nav check. (2) The assistant button is `visibility:hidden` while its panel is open (an invisible button must not sit over content); `aria-controls` only once the panel exists; focus returns after it is visible. Sticky side cards (workshop booking form, cart summary) use `.sticky-aside`: capped above the button, scroll inside. (3) Compare head strip gets `scroll-padding-inline-start: 11rem` (sticky "Detail" column). (4) Text links use `accent-soft-text`, never brand `accent` (AA). (5) The header logo link may shrink (`min-w-0 shrink`, `max-w-full`) so the signed-in row cannot widen the page. (6) Hindi: header account link, admin person names are user content; admin coupon `shop` DTO carries `nameHi`; admin catalogue editor shows `nameHi`; company legal name/address inputs are `lang="en"` (statutory, English on purpose); stock-file header message renders column names as `<code lang="en">`. Audit harness: axe runs from scrollY 0. No new colours.

## 2026-11-16 — Brand SVG logo uses a plain `<img>` (budget incident; coordinator ruling)

The traced logo (Q172) was rendered with `next/image` (`unoptimized`) in the header. That pulled the `next/image` client
code into the first load of every page that has no other image: `/shop` 185.7, product 183.9, `/workshops` 184.6,
`/cart` 185.6 KB gz (budget 180, spec 16; home unchanged because its hero already loads it). Hard rule 6 says
"`next/image` always" for its raster benefits (AVIF/WebP, sizes, LQIP), none of which apply to an unoptimized SVG, and
the budget is also a hard gate. Ruling: brand vector assets (logo light/dark) use a plain `<img>` with `width`/`height`
(no CLS) and `decoding="async"`; every raster image still uses `next/image`. Guard:
`apps/web/test/brand-assets.test.ts`. User may revisit (it narrows rule 6 for vector brand files only).

## 2026-11-16 — WhatsApp token kept (user)

User: "we wont rotate the whatsapp token thats okay just keep the same one in both the .envs". The system-user token
set on 2026-11-16 stays in the local `.env` and the server `.env` (already set in both); no rotation. Supersedes the
"rotate later" note in the WhatsApp go-ahead entry.

## 2026-11-16 — Firebase Auth email domain is the user's (user)

User: "in the existing ones i have set the customized domain for review so make sure u dont disrupt that". The Firebase
Auth email templates and their custom sender domain (and its DNS) are managed by the user in the Firebase console;
the repo and the session never change them. Launch checklist entry in `docs/runbooks/deploy.md`.

## 2026-11-16 — Hand-made WhatsApp templates had a broken button URL (fixed, user)

The four English templates created by hand in Meta before the CLI (`order_confirmed`, `order_out_for_delivery`,
`order_rejected_refund`, `service_estimate_ready`) stored their button URL as `…/orders/%7B%7B1%7D%7D{{1}}` (a literal,
URL-encoded `{{1}}` in front of the variable), so the real-API WhatsApp test linked to
`/orders/%7B%7B1%7D%7DMD-…`. Our sender was correct (it passes only the code). User: "yeah edit the 4 whatsapp
templates" — edited through the Graph API (button URL only: `https://mechdost.com/orders/{{1}}`,
`/service/{{1}}`); all four back in review. The CLI-submitted templates were already correct. Follow-up: the CLI's
`--status` flags button URLs containing `{{`/`%7B` outside the variable.

## 2026-11-16 - Builder ruling: bill and receipt PDFs on the bill emails (Q194; user: "for the bills emails cant we just attach the bill pdfs right there?")

**What:** the emails `service_bill_ready`, `service_completed`, `order_delivered` and `payment_received` carry a PDF of the
bill or receipt, in the recipient's language (en or hi). Built at send time in the worker (`apps/api/src/notify/pdf/`) from
the stored bill or order snapshot (`packages/db/src/repo/bill-documents.ts`), never recomputed
(`packages/shared/src/bill-document.ts` is a pass-through model with a property test: document totals equal stored totals).
Titled **Bill** (service) or **Receipt** (orders); never "Tax invoice" (Q97 is open; gapless invoice numbers belong to
finalised invoices). The company block (name, address, GSTIN, CIN) comes from the admin's Company details, with the built-in
facts as fallback. The order receipt does not name the shop (like the order emails: area only); the service bill names the
workshop. Outbox rows hold only an id (`billRef` in the payload: request id, sub-order id or payment id); the worker loads the
document only when it belongs to the row's recipient (a forged or foreign id finds nothing). Size cap 1.5 MB; a bigger or
failed PDF is dropped and the mail still goes (the log holds the outbox id and error class only). Resend takes base64
`attachments: [{ filename, content }]`; file names `MechDost-bill-SR-...pdf` and `MechDost-receipt-MD-...pdf`.

**Library choice (dependency policy checked against `docs/research/security-vulnerabilities.md`):** `pdfkit@0.20.2` (MIT,
published 2026-08-30, older than `minimumReleaseAge`; dependencies fontkit 2, linebreak, png-js, fflate, @noble/hashes and
ciphers; no install scripts) plus `@fontsource/{dm-sans,manrope,noto-sans-devanagari}@5.3.0` (OFL fonts as data files, no
dependencies, no scripts) and `@types/pdfkit@0.17.7` (dev). Exact versions, frozen lockfile, no `allowBuilds` entry needed.

| Option                               | Devanagari shaping                                                                                                             | Cost / fit                                                                                                                                  | Verdict                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **pdfkit + fontkit 2**               | **Correct**, tested: "सर्विस बिल", "ब्रेक पैड (आगे)", reph, conjuncts क्ष त्र श्री द्वा, matras (`docs/screenshots/bill-pdf/`) | pure JS, ~11 MB unpacked (mostly its own builds), maintained (0.20.2, Aug 2026), runs on Node 24                                            | **chosen**                                |
| pdf-lib + @pdf-lib/fontkit 1.1.1     | **Crashes** on Devanagari (`regeneratorRuntime is not defined` in the Indic shaper of the 2021 fork), tested                   | pdf-lib's last release is 2022, unmaintained                                                                                                | rejected (tested)                         |
| @react-pdf/renderer 4.9              | Same engine underneath (depends on pdfkit 0.20.1 and fontkit), so shaping would match                                          | 12 direct dependencies (reconciler, layout, render, font...), a React tree in a worker for no gain                                          | rejected (by inspection, not benchmarked) |
| headless Chromium rendering the HTML | Correct (browser text engine)                                                                                                  | not in the API image (Playwright is a test tool); +300 MB, a browser process per mail, binary downloads that run scripts against the policy | rejected (policy and size)                |

**Fonts:** DM Sans (body) and Manrope (headings), the site's pairing; Noto Sans Devanagari for Hindi. The Devanagari subset
file has no ASCII and the Latin files have no Devanagari or rupee sign, so the renderer splits each string into runs by
character class and draws each run in the right font (this is also how Hindi mixed with codes, numbers and English workshop
text works). No new colours: navy `#101f34` band and text, accent `#ea5728` total rule, the existing button red `#bf3c12`
for "payment pending", muted grey for labels.

**Known limit:** the PDF draws correctly, but copying Hindi text out of it (or extracting it with a tool) gives the font's
glyph order, not logical order (matra before consonant: `िबल` for `बिल`). Display and printing are correct. A tagged PDF with
logical-order text (ActualText) is a later step if anyone needs to search or screen-read the PDF; the email body carries the
same numbers.

**Not changed:** nothing stored, no migration, no new env variable. Docker: the API image grows by about 20 MB (pdfkit,
fontkit, three font packages); `pnpm deploy --prod` installs them because they are declared in `apps/api/package.json`
(`scripts/build.mjs` keeps declared dependencies external; the fonts are read from `node_modules` at run time).

## 2026-11-16 — API rate limits per account for signed-in visitors, per IP for guests (user, Q195)

User: "yeah go with option C and keep it admin configurable too and the guests limit would be per ip". The global API
limit counted every request per IP (600/min); Indian mobile carriers put many customers behind one shared IP (CGNAT),
so a busy evening could block real customers (real-API pass 3 hit 429s with five sessions on one PC). Now:
signed-in requests count per **account** (only after the token is verified), guests per **IP**, and a higher per-IP
flood guard stays for everyone. Sign-in, OTP, password reset and payment limits keep their own strict rules. All three
numbers are editable in Admin → Settings (bounded, audited), cached, with code defaults if the setting is missing.
Rejected: keep as is (blocks shared IPs), only raise the IP limit (still blocks, more room for abuse). Cloudflare
in front (option D) can be added later on top.

Built 2026-11-16: `api_user:<firebase uid>` (300/min), `api_guest:<ip>` (600/min), `api_ip_flood:<ip>` (3000/min); keys
`api.signed_in_per_minute`, `api.guest_per_ip_per_minute`, `api.ip_flood_per_minute` in the settings registry (global
only, no migration: the `settings` table already holds them); flood is never below guest (validated on save and
enforced when read); 45 s cache. The per-route `apiPerUser` rule was renamed `api_route_user` so it no longer shares a
counter with the global `api_user` rule. Spec 13 "Global API limits".

## 2026-11-16 — Real-API pass 3 fixes: delivery hint, routing reasons, cancel help (bugs 7 to 15)

- **Free delivery (bug 7): the rule is unchanged, the text was wrong.** The charge follows spec 03 "Delivery charges":
  per shop group, threshold = PIN value, else shop value, else city setting. The checkout summary showed the city
  setting only, so a PIN or shop override made "Free delivery from ₹999" disagree with a ₹40 charge. The quote now
  returns `groups[].freeDeliveryMinPaise` (the threshold that applied, null = never free) and the summary says, per
  charged group, "Free delivery on orders from {shop} of {amount} or more." Money rules not touched. The cart page
  (no PIN yet) keeps the city text: Q196.
- **Routing reasons (bug 8):** the empty-suggestions message is chosen from the ranked list: nobody covers the PIN
  (paused, suspended, busy or not delivering), every covering shop already declined or timed out, or the others do not
  stock every item. No API change (`routeEmptyReason`).
- **Cancel help (bug 9):** no setting changed. Spec 05 / Q25 keep customer self-cancel off; an open part with no cancel
  button now says so and links to support. Whether COD should be self-cancellable by default is Q197.
- **Order totals (bug 14):** the order page shows "Order total when placed" (`placedTotalPaise`) and, only when parts
  were rejected or cancelled, "Still payable" (`totalPaise`), next to the refund lines.
- **Support live (bug 10):** the account support list re-reads every 20 s while visible and on tab return, like orders,
  bookings and quotes (no live ping kind for tickets exists yet).
- **Out for delivery (bug 12):** the two POSTs were two different steps (`shipped` then `out_for_delivery`, one button
  from "packed"), not a double submit; the API already refuses a repeated step (`WRONG_STEP`, version CAS). A ref guard
  now blocks a real double press.
- **Bulk-quote search (bug 13):** searches 350 ms after typing stops (two characters minimum), newest answer wins.
- **Hindi CSV hint (bug 15):** column names stay in `<code lang="en">` (codes); each is now explained in Hindi.

## 2026-11-16 - QA pass 4 bugs (builder rulings)

- **Out for delivery is one request (bug 3).** The two POSTs were `shipped` then `out_for_delivery`, by design of the
  state machine (spec 04). The API now accepts `out_for_delivery` with `handOverOwn: true` from `packed` and runs both
  moves in one transaction (version checked on the first move, version +2, same events/audit/code). Courier hand-over
  keeps its own `shipped` step. Cost if wrong: none for data (same rows as before); one extra field on the advance body.
- **Cart delivery text is neutral (Q196, bug 2).** No city amount on the cart or the checkout fallback; the real
  per-group threshold is shown at checkout only. User can revise (Q196).
- **Several shops, "Sell another product" (bug 1):** one block per shop, not a picker, like "Your prices".
- **Quote page payment (bug 4):** once the order is paid on the server, stale warnings are dropped (one state at a
  time); while "not confirmed yet" shows, the page re-reads every 4 s.
- **Orders list total (bug 5):** the list shows the placed total (`placedTotalPaise`), also for rejected orders.
- **Admin overview counts (bug 8):** refresh while the tab is visible (60 s, `startPolling`) and on tab return.
- **Split order link (bug 10):** `/orders/<code>-2` shows the whole order, marks (border, `aria-current`) and scrolls to
  the named part once; order and numbering are unchanged.
- **Wording (bugs 6, 9):** see spec 06 "Pass 4 wording".

## 2026-11-17 — SEO (user: "we need to do the SEO for the mechdost … make sure nothing gets broke")

- **Crawl rules:** `robots.txt` allows everything except the private screens (signed-in areas, portals, admin, cart,
  checkout, compare, sign-in, notifications, order / service / quote / application records, invite links) in both
  languages and `/api/`. Those pages stay `noindex` too. AI crawlers are treated like any crawler (Q200).
- **Sitemap:** one `sitemap.xml` (ISR): public pages, the 9 category pages, every product, every real workshop, each URL
  in English and Hindi with its `hreflang` set. A sitemap index split by type when the catalogue passes ~2,000 products.
- **Category pages are landing pages:** `/shop?category=…` is its own canonical with its own title and description;
  sort, vehicle and page parameters point back to it; any search (`?q=`) is `noindex, follow`.
- **Structured data only from real facts:** `Organization`, `WebSite`, `BreadcrumbList` and the home `FAQPage` in both
  modes; `Product` / `Offer` / `AggregateRating` and `AutoRepair` only in API data mode. Demo prices, seed reviews and
  demo workshops are not real, and fake markup risks a Google manual action. A product without price (on request) and
  without a rating gets no `Product` item (Google would reject it). Workshop phone numbers are never marked up (masked
  relay, spec 06).
- **Demo workshops are `noindex` and not in the sitemap** (fictional businesses with Raipur addresses); real workshops
  are indexed automatically once the site runs on real data.
- **Copy:** titles and descriptions say what + where ("… in Raipur"), English and fully Devanagari Hindi, from the
  locale namespace `seo` (home: `meta`), after a competitor study (GoMechanic, CarDekho/BikeDekho, Boodmo, Koovers,
  SparesHub, Raipur results; `docs/runbooks/seo.md` § 5). Hard rule 8 note: the copy is in the locale files like all
  copy; admin-editable meta text comes with the CMS (spec 08).
- **Search Console:** Domain property verified by a DNS TXT record (no code, no new env variable); steps in
  `docs/runbooks/seo.md` § 3.

## 2026-11-18 — SEO review follow-ups: no indexing before launch; Bulk orders page indexable (user)

Review of 94ba244 ("chore: SEO"); user: "yeah do both fixes".

- **No indexing while the site runs on demo data.** The live site is still the demo store (demo prices and stock
  text). `searchIndexingOpen()` (`apps/web/src/lib/seo.ts`) is true only in real data mode: until then every page
  carries `noindex, nofollow` (pages with their own `robots` keep theirs) and `sitemap.xml` is empty. The real-mode
  launch switch opens both; nothing else to change. `robots.txt` stays as is so crawlers can read the `noindex`.
- **`/quotes/new` (Bulk orders, footer link) is an indexable landing page** with its own title and description in
  English and Hindi (`seo.bulkTitle` / `seo.bulkDescription`) and is listed in the sitemap. It had `noindex` since it
  was built (2026-11-01, no recorded reason) and the SEO commit then blocked all of `/quotes/`. `robots.txt` now
  allows `/quotes/new` and `/hi/quotes/new`; quote records (`/quotes/<code>`) stay blocked and `noindex`.

## 2026-11-19 — Search indexing open now, on demo data too (user; supersedes the first bullet of 2026-11-18)

User: "yes i want all the pages to be indexed so do the fix". Reason: Google had nothing indexed for "MechDost" and
answered the brand search with a spelling suggestion ("techdost", an unrelated Meerut software company); the
site-wide `noindex` would also have dropped the two pages Google already had.

- `searchIndexingOpen()` and the layout's site-wide `noindex, nofollow` are removed; `sitemap.xml` lists every public
  page, category and product in both languages in every data mode.
- Unchanged: private screens blocked and `noindex`; search results `noindex, follow`; **demo workshop pages stay
  `noindex` and out of the sitemap** (fictional businesses with addresses must not show up as real local results);
  `Product` / `Offer` / `AutoRepair` structured data still only on real data (no markup of demo prices or reviews).
- Accepted cost: demo product prices and stock text can appear in search snippets until the real-data switch; those
  URLs refresh or drop (404) after it, and `sitemap.xml` is re-submitted then.

## 2026-11-22 — Order again (audience entry item 4)

- Builds the "reorder" of the 2026-10-31 order-history decision. A server endpoint (`POST /v1/me/cart/reorder`) rather than N client calls: it is actor-scoped (404 for others' orders), reads the order snapshot's SKUs and quantities, folds them into the cart in one transaction with the guest-merge rules (larger quantity wins, so a repeated press is a no-op: idempotent without a key), and reports lines no longer sold by name. Re-pricing is structural: the cart never stores a price.
- Offered when every part is delivered, cancelled or rejected. Area availability is left to the checkout quote (the cart is area-free by design). Limit 30 presses an hour per customer.
- Budget: button only on account orders list + order page; logic loaded on press (spec 16 incident rule).

## 2026-11-22 - Business applications built as their own tables (builder 2, audience entry item 3)

Trade and fleet applications get `business_applications` (+ events) and `trade_accounts` (+ events) instead of new kinds in `partner_applications`: that table's CHECKs and repository are seller-shaped (GST status, address, map pin, products, encrypted KYC), so reusing it would have weakened them. Reused: public codes, the status-machine and conditional-UPDATE pattern, reject reason codes, the admin queue screen helpers, the `staff.new_application` notice, the email outbox, Turnstile and rate-limit helpers. Rulings: GSTIN is a public identifier and is stored plain (like the order snapshot); the typed email of a signed-out fleet lead is never mailed (2026-11-15 spam-relay ruling); trade status is `none|pending|verified|revoked` (computed; `pending` = an open application); no rejection or revoke email until wording is approved; demo sign-in builds show "open soon" (no demo store for accounts). Spec 07 section "Business applications".

## 2026-11-22 - Smart search: vocabulary table, compact column, ranking weights (builder B, design item 4)

- Query understanding is one pure shared module (`packages/shared/src/search`) used by the API and the demo, so both behave the same. The vocabulary (Hinglish/Hindi synonyms, category words, vehicle words) is data, not code: table `search_synonyms`, admin-editable and audited (hard rule 8), seeded from the built-in list that is also the fallback.
- Attribute matching (viscosity, Ah, voltage, tyre size) uses a generated column `products.search_compact` + trigram GIN index rather than a regex over names: customers space `20W-40` every way and every query must be indexed (rule 14). Pack size uses the existing variant `net_qty/net_unit`.
- Ranking weights live in one table (`SEARCH_WEIGHTS`) shared by SQL and the demo and documented in spec 02; vehicle intent is strong (1.5) so "bike battery" shows 2W batteries before a car battery whose name says "battery".
- A word that is the category's own name matches the whole category; other category words only boost (otherwise "coolant" would return every lubricant).
- "Did you mean" runs a trigram scan only on the zero-result path (no index needed at a few thousand products; revisit with Meilisearch). Suggestions are cached 60 s per instance (stateless API, rule 7).
- The suggestion panel is lazy (first focus) because `/shop` sits at the first-load budget edge (spec 16 incident 2026-11-22); there is no header search today, the combobox is on `/shop` only.

### 2026-11-22 - Catalogue groups, optional MRP, import scope (Builder A)

Brand and range switches never change product status (lossless); one SQL rule `productVisible` for every storefront read. MRP may be NULL = not sellable ("price on request"); an MRP is never lowered below a stored price. catalogue-v2 import: price-list brands only, own picture with decodable bytes, idempotent by SKU, admin edits (`hindi_machine` false) and MRPs are never overwritten, Hindi from a glossary plus an optional translations file (no word-by-word description translation). Tyres HSN 4011 at 18 % (GST 2.0), batteries 8507 18 %; fallbacks (coolants 3820, brake fluid 3819, UPS/chargers 8504, auto care by keyword) are listed in the dry-run report for review. CLI lives in apps/api (needs sharp/Storage).

## 2026-11-22 — Real mode switched on (launch switch, step 1)

- **User:** "turn on real mode now"; asked how, chose **"Flip as is"** (not "hide test data first", not "wait for
  Razorpay live keys").
- **Done:** GitHub variables `NEXT_PUBLIC_DATA_MODE=api` and `NEXT_PUBLIC_AUTH_MODE=firebase`, deploy dispatched
  (run 45039072205 at cd22ed3). mechdost.com now serves the real database: the imported catalogue (219 products, MRP
  shown, price on request until a shop stocks them, Q208), real sign-in (Firebase phone + password), real orders.
- **Known and accepted at the switch:** the 23 seed demo products with offers from the 4 seed shops stay orderable;
  the test workshop stays published; 15 QA orders stay (visible only to the test accounts); online payment uses
  **Razorpay TEST keys** (no money taken; COD works) until live keys + webhook secret (Q75) are added; the shared
  dev/prod Supabase stays (separate prod project and the launch data reset are still open).
- **Undo:** set both variables back to `demo` and dispatch the deploy workflow.

## 2026-11-22 — Customers never see the shop; coverage copy says Chhattisgarh (user rulings A and B)

- **A (user):** "to the customer we never need to show that we are shipping via a shop so remove that mention from everywhere in the customer screens." **Done:** on every customer surface MechDost is the only party named. Removed or reworded: home "How your order reaches you" (now "Confirmed by MechDost", availability check, no shop step; stop 3 icon is a tick), checkout and paid notes, order stage "Confirming availability" (was "Confirming with a nearby shop"), order detail "MechDost confirmed your order", rejection reasons, cancel note, delivery / returns / terms policy pages, trust lines ("Genuine {brand} part", no "from a verified shop"), customer emails (order placed / confirmed / delivered, rejection reasons), customer notification bodies, the support-thread intro, the assistant's system prompt. Code: the product page no longer shows the "Sold by" row and the order page no longer shows "Fulfilled by {shop}" (the order API still returns the shop for portals and admin); shop-funded coupons and offers show the MechDost offer line; the cart free-delivery hint no longer names the seller; JSON-LD `Offer.seller` is the MechDost organisation.
- **Kept on purpose (named in `packages/shared/test/customer-copy.test.ts`):** shop, workshop and admin portals; admin; partner pages (`/partners`, apply forms, `/business` for sellers, `seo.partners*`, `pages.partners.*`); the legal pages that must name the seller (`policies.terms.whoBody`, `partnersTitle`, `partnersBody`, `policies.privacy.shareBody`: DPDP data recipients). Workshops stay visible to customers (the workshop is the service provider and is named on every estimate and bill).
- **Legal risk, open (Q221):** the Consumer Protection (E-Commerce) Rules 2020 require a marketplace to show seller identity to the buyer. Default until the user decides: the seller's name and GSTIN stay on the **GST bill / invoice PDF only** (never on a customer screen), and the Terms say "the seller's details are on your bill".
- **B (user):** "its not meant to be raipur centric rn its meant to be like chhattisgarh centric". **Done:** coverage copy uses a new `{region}` placeholder fed by `site.defaultRegion` (`'chhattisgarh'`, key into the new `regions` locale namespace: Chhattisgarh / छत्तीसगढ़), not `{city}`: meta title and description, every SEO title and description, announcement bar, hero lead, service note, top-workshops eyebrow, WhatsApp text, empty workshops text, trust lines, order-email footer, assistant prompt, JSON-LD `Organization.areaServed`. `{city}` and the `cities` namespace remain for real city data (city selector, saved addresses, admin city tools), so the multi-city model (spec 15) is untouched. The admin can still override the hero, announcement and trust lines (content keys); a per-city or editable region value is queued (Q222).
- **Kept as facts:** registered office (Raipur), order codes (MD-RPR-…), PIN checks (`checkout.pincodeHint` / `errService` say PIN 4920 = Raipur, true today), courts at Raipur in the Terms, demo shop and workshop addresses.
- **Guard:** `packages/shared/test/customer-copy.test.ts` fails on shop / seller wording in customer locale namespaces (English and Hindi, with explicit exceptions) and on Raipur in customer coverage copy.

## 2026-11-22 - Change password, Delete my account in Profile, header Sign out (user request, Q213)

- **User:** "add a change password in the profile and make the sign out button more prominent and also move the delete my account button inside the profile section and ... the sign out button on the top bar at the top right and add some colour".
- **Decided:** Account -> Profile gets a Security card (change password by Firebase re-authentication + `updatePassword`, no new API endpoint: Firebase revokes the other sessions on a password change). "Delete my account" moves from Privacy into that card (same request flow). Sign out is a coloured accent-soft button in the header, loaded lazily on click (JS budget). No new colours, fonts or radii (tokens only).
- **Not done:** no "sign out everywhere" button; demo mode has no change password (no Firebase account).

## 2026-11-22 - Shop accounts cannot order (user request)

- **User:** "a seller login wont have option to order stuff from the website at all".
- **Decided:** enforced in the API with 403 `SELLER_CANNOT_ORDER` for `seller_owner` / `seller_staff` on cart writes, checkout quote, order placement, coupon check and customer bulk quotes; the web hides the buying actions and shows one note. Workshop accounts keep ordering as customers (not sellers in the code). A staff account that also holds a seller role is blocked by the API; the web maps it to the admin role and does not hide the buttons (the API answer is the guard).

## 2026-11-23 — Seller details never on the bill (Q221 answered)

- **User:** "the seller details will not appear on the bill no". Customers never see the fulfilling shop anywhere,
  including the bill/invoice PDF, which shows MechDost's operator (Shourya Integrated Services Pvt Ltd, registered
  address, GSTIN, CIN) only. This is already how `apps/api/src/notify/pdf` renders; the Terms line "the seller's
  details are on your bill" must not promise otherwise (reworded in the next copy pass).
- **Note recorded:** under the Consumer Protection (E-Commerce) Rules 2020 a marketplace must make seller details
  available to buyers; selling as MechDost (seller of record) avoids that. The user to confirm the model with their CA.

## 2026-11-23 - Site chrome v4: floating glass header, account menu, search palette, v4 footer, floating dock (user-approved design)

- **User:** "looks good ... build this and push it after its done" (approving the standalone prototype `topbar-c-v4.html`; design direction rule 2: the concept sets the theme, layouts may improve).
- **Decided:** the header becomes a floating glass bar (segmented nav with a white chip and an orange dashed "tread" under the current page, search pill, bell, avatar menu, navy cart button); the account entry is an avatar that opens a menu (Profile & security, My orders, My vehicles, Saved items, Dark mode switch, language, Sign out last in the error colour; portal roles get their portal link). The separate header theme toggle and Sign out button are removed (supersedes the 2026-11-22 "coloured header Sign out" placement; the sign-out logic, status message and lazy loading are unchanged). A search palette (lazy) replaces nothing on /shop: it submits to `/shop?q=` and uses the existing smart-search suggest. The footer keeps all content and links, restyled as one card with "For partners" as a tinted fifth column (the orange "Apply as" pills of 2026-11-22 are replaced by icon-tile rows: still prominent, 40 px+ targets). Phones get a compact floating header plus a full-width search bar and the bottom tab bar becomes a floating dock. No emoji in the header, footer, dock or menus (lucide icons, rendered on the server and passed to the client islands, so no icon code ships in the first-load JS).
- **New tokens (hard rule 2):** `--color-chip`, `--color-cart`, `--color-cart-badge`, `--color-cart-badge-text`, `--shadow-float` (light, dark and system-dark blocks identical; contrast pairs added to `test/tokens.test.ts`). No new colours otherwise: glass is `surface/80` with a backdrop blur; the footer panel uses `bg`; sign out uses `error`.
- **Differences from the prototype, on purpose:** the sliding indicator is a CSS colour cross-fade between items (no client JS); no mini-cart popover (the cart button opens /cart); no "2 active" hint in the menu (needs data); no brand tagline under the logo; the bar shrinks with a CSS scroll-driven animation (browsers without it keep the full-size bar); the phone search bar is a trigger for the same palette (its data travels once).
- **JS budget (spec 16):** the account menu and the search palette are lazy chunks (loaded on hover, focus, tap or `/`); first-load islands import no icon library; guards `test/chrome-v4.test.ts` plus the existing budget tests.
- **Docs and tests:** design-system.md "Site chrome v4"; state-audit rows `CHR-ACCOUNT-MENU` and `CHR-SEARCH` (sweep only), checklist regenerated; e2e Sign-out steps now open the account menu.

## 2026-11-23 — Light mode by default

User: "make the website open on light mode by default". Without a saved choice the site opens light, whatever the
device's system theme (replaces "follow the system theme" from 2026-11-01). Dark mode stays one tap away (footer and
account menu) and a saved dark choice still applies on every visit. Code: `THEME_INIT_SCRIPT` in
`apps/web/src/lib/theme.ts`, fallbacks in `theme-client.ts` and the three maps; guard `test/theme-light-default.test.ts`.

## 2026-11-23 — Sign-out ends with a fresh load of the home page

User: "suppose im in admin section and i sign out … that page's data still shows for a bit after sign out". Every
sign-out (account menu, account page, portal guard) now hides the page content at once (`html[data-signing-out]`),
clears the session synchronously, waits for the Firebase sign-out (at most 4 s), then loads the home page fresh with
`location.replace` so no data of the signed-out account stays on screen, in memory or behind the Back button. This is
the one deliberate exception to "no reload feel" (security beats smoothness here). Code `apps/web/src/lib/auth/sign-out.ts`;
guard `test/sign-out-clean.test.ts`; e2e sign-out steps wait for the fresh load.

## 2026-11-23 — Exide catalogue replaced by the exidecare data (user request)

User: "Remove existing Exide batteries/products already listed and list the new ones with the proper info and exact model names … include models fitment etc … we need exact part names, not generic names." Then: "list all the products from exide" (all 211 rows, including inverter batteries, home UPS inverters, combos, lithium-ion, genset). Later the same day: "we are adding the model year too".

- **Archive, never delete:** the importer archives every existing product of brand `exide` that is not in the new list (conditional update on `version`, packs archived, audit row each) in one transaction with the new rows; old orders, carts and shop offers point at them. Other brands are never touched. Rows with the same slug or SKU are replaced in place.
- **Exact names:** "Exide <Range> <MODEL>" with the manufacturer's model code verbatim; the model is also the `mfr` part number and the SKU (`EXIDE-<MODEL>`). Price on request where the source has no MRP (3 combos).
- **Home power category:** inverter batteries, home UPS inverters, combos and the lithium-ion pack go into a new top-level category `home-power` ("Inverters & home UPS" / "इन्वर्टर और होम UPS"), admin-editable. Vehicle batteries stay under the existing `batteries` sub-categories. HSN 8507 for batteries, 8504 for inverters, UPS and combos, 18 % (assumption, accountant to confirm).
- **Fitment lives in `spec.fitment`** (full list with fuel, `yearFrom` / `yearTo` and `era` from the source's "Model year / era" column), with a capped searchable text in `compatibility`; the public product API leaves `spec.fitment` out of the page payload. The `fitments` / vehicle tables are NOT written: their constraints do not fit (no years for most rows, kick/electric start, trucks, tractors, gensets). Writing them is the next step of "find the battery for my vehicle".
- **Range photos:** 49 products only have Exide's generic range picture; they are live with `spec.photoKind = 'range'` and listed in the status report.
- **Event:** `admin_exide_imported` (spec 12). Runbook: `docs/runbooks/catalogue-import.md` "Exide import".

## 2026-11-23 — Sign-in speed and fewer captchas

User report: sign-in slow, captcha "every time", errors. Decided: (1) Turnstile stays `interaction-only` but starts at
the first touch of the form and its token is held (max 4 min, single use) until the button is pressed; (2) Firebase,
the Turnstile script and connections to Cloudflare, Google and the API are warmed when `/login` opens; (3)
`fetchMe` no longer forces a token refresh after sign-in (only the email-verified and pay-online paths do); (4) the API
password route looks up the account while Cloudflare verifies the token; (5) one silent retry for an expired or
used Turnstile token, a widget error, a network blink on the API call and on the custom-token exchange; a failed
API fetch now says "could not reach the sign-in service". The reCAPTCHA Enterprise and Cloudflare widget-mode
settings are console-only (`docs/runbooks/firebase.md`). Code: `lib/auth/sign-in-retry.ts`, `turnstile.ts`,
`login-flow.tsx`, `apps/api/src/routes/auth.ts`; test `apps/web/test/sign-in-retry.test.ts`.

## 2026-11-23 — Email links open our own page, `/auth/action` (user request; closes the email-link part of Q30)

User: "edit the firebase email templates and change the links in there to be mechdost.com links". Built the page
Firebase's custom action URL will point at (`/auth/action`, `/hi/auth/action`): `verifyEmail`,
`verifyAndChangeEmail`, `resetPassword`, `recoverEmail`, with localised failure states and one next action each. No new
dependency; the Firebase SDK is loaded on demand on this page only (JS budget unchanged). Passwords are held by
Firebase Auth and checked by the API through `accounts:signInWithPassword`, so Firebase's reset-by-link sets the real
password. `continueUrl` is honoured only for same-site URLs. The Firebase console change (template action URL ->
`https://mechdost.com/auth/action`) is a user action after deploy: `docs/runbooks/firebase.md` "Email links on
mechdost.com". Events and copy: spec 12, `emailAction` namespace in en.json/hi.json.

## 2026-11-23 — Actionable notices resolve themselves; customers get a Refunds page (user requests)

- **Stale "needs routing" (user: "the notification for the order routing on the admin didn't go away even after I rejected the order").** Bell rows had no notion of "done". Decision: a notice that asks someone to act is **resolved in the same transaction as the change that makes the action moot**, for everyone who got it (`resolveNotices`, new `notifications.resolved_at`, migration `0081_notice_resolved`, which also cleans the rows that were already stale). Resolved rows also get `read_at`, so the unread badge drops, and show a muted "Done" tag in the bell (never "New"). Covered kinds and where each resolves: spec 10 "Actionable notices resolve themselves". The hook for orders lives in `transitionOrder` (the single door for order status), so route, reject, cancel, payment expiry, accept, decline and expiry are all covered without per-caller code. Rejected alternatives: deleting the rows (loses history and breaks the dedupe key, a replayed change would re-notify), hiding resolved rows from the list (the person sees the badge fall but not why), and resolving on read only (the bug itself).
- **Refunds page for the customer (user: "the customer should also have a refund status page as well").** Account → Refunds with a plain-words stepper, `GET /v1/me/refunds`, actor-scoped by SQL ownership, no internal fields. It follows the 2026-11-15 and 2026-11-16 rulings: every refund needs approval, the page never promises an automatic or instant refund and says "Completed" only after the refund is `processed` (Razorpay confirmed, or finance recorded the payout). The Razorpay refund id is shown once a refund was sent, as the reference for the bank; nothing else of the provider. Cash-on-delivery refunds say "paid by our team by hand" (Q104). Spec 05 "Customer refund status page".

## 2026-11-23 — Amaron batteries listed too (user request)

User: "this now has amaron batteries too, add them as well on the website and properly check the readme". Built the same way as the Exide import, on shared code (`packages/db/src/battery-import`, `repo/battery-import.ts`, `apps/api/src/cli/battery-import.ts`); Exide behaviour unchanged. Details: `docs/runbooks/catalogue-import.md` "Amaron import".

- **All 144 rows are products**, named as Amaron names them, title-cased (not Amaron's capitals: "Amaron Pro 55B24LS"), model and item codes as manufacturer part numbers, SKU `AMARON-<item code>`.
- **MRP vs selling price:** `mrp_paise` = Amaron's crossed-out "Base Price". Its selling price, discount (ends "Till 30th Nov"), old-battery rebate, price before GST and GST rate sit in `spec.amaronPrice`; the customer price stays the MRP until shops or the admin price it. Two rows Amaron lists at 0 are price on request.
- **Combos are not products:** the 195 Home UPS + inverter battery pairs are kept in `spec.combos` of both products (plus one highlight); a combo listing can be added later.
- **Earth-moving category:** new sub-category `earth-moving-batteries` under batteries (5 products), admin-editable. The 11 batteries Amaron's finder does not list are sorted into an existing category by the most common type of their range and size (rule recorded in `spec.categoryRule`, listed in the status report).
- **Archive, never delete:** every existing product of brand `amaron` that is not in the plan (the demo `car-starter-battery-45ah`) is archived with its packs in the same transaction; other brands untouched.
- **Photos:** up to three per product, Front, Side, Top, first is main; shared pictures recorded in `spec.photoKinds` / `photoKind`.
- **Public page payload:** `spec.amaronPrice`, `spec.combos` and `spec.categoryRule` are kept out of it, like `spec.fitment`.
- **Event:** `admin_amaron_imported` (spec 12), same props as the Exide event.
- **Not done yet:** the real run (waits for the user, `--dry-run` first), and no `fitments` / vehicle tables (as for Exide).

## 2026-11-24 - Service-request notices resolve themselves

The customer asks `service.proposed`, `service.estimate_ready` and `service.bill_ready` are marked done (`resolved_at`, read) in the transaction of the move that makes them moot (`transitionRequest` calls `resolveServiceNotices`): leaving `proposed`, `estimate_sent` or `billed`, and every open ask when the request is cancelled, rejected or completed. Same mechanism as the order notices (2026-11-23); no migration. No staff or workshop notices exist for service requests, so none were added. Spec 10.

## 2026-11-24 — Rate limits on our own Redis (Upstash free plan exhausted; live outage)

At 11:29 UTC every API route started answering 500: the free Upstash plan's 500,000 requests a month were used up ("ERR max requests limit exceeded") and the rate limiter threw on every request. User asked for a free alternative and chose the server's own Redis (option 1 of 4: own Redis on the AWS server; Redis Cloud free; Postgres counters; in-memory).

- **Store:** `redis` (7.4.7-alpine, pinned by digest, no persistence, 48 MB, `volatile-lru`, password `REDIS_PASSWORD`) and `srh` (Serverless Redis HTTP 0.0.10, pinned by digest, token `SRH_TOKEN`) in `deploy/compose.yml`; private Docker network only, no host ports. The API keeps speaking the Upstash REST protocol: `UPSTASH_REDIS_REST_URL=http://srh:80`, `UPSTASH_REDIS_REST_TOKEN=$SRH_TOKEN`. Counters reset on a restart (they are abuse counters, not data); several API servers later share it the same way.
- **Limiter:** `@upstash/ratelimit` removed — its Lua scripts carry the Upstash-only flag `allow-key-locking`, which Redis 7/8 and Valkey refuse. `apps/api/src/rate-limit/redis-rest.ts` implements the sliding window with INCRBY + PEXPIRE + GET in one MULTI/EXEC (works on Upstash too).
- **Failure rule (changed):** a store failure used to throw → 500 on every route. Now ordinary rules allow and log `rate_limit_store_failed`; `failClosed` rules (password sign-in per IP and per account, staff code, reset email per IP and per address, verification email, assistant daily cap) still refuse (503). Codes that can be guessed (arrival, delivery, roadside) are locked after 5 tries in the database, independent of Redis.
- **Security review follow-up (same day):** Redis runs `--maxmemory 64mb --maxmemory-policy noeviction` (a full store refuses writes instead of silently dropping counters, which would reset limits). More rules are `failClosed`: guest support access (per IP and per code), partner status lookups (IP, phone), coupon checks (IP, user), fleet and partner applications per phone. A refused fail-closed limit answers 503 `RATE_LIMIT_UNAVAILABLE` everywhere (global error handler), never 500. Payment-start limits stay fail-open on purpose (amounts are asserted server-side; blocking payments in an outage costs orders).
- Tests: `apps/api/test/redis-rate-limiter.test.ts`. Why the plan ran out so fast: see progress (investigated separately).

## 2026-11-24 — Razorpay live keys are not rotated

User: "we wont generate new razerpay keys no". The live key secret and webhook secret that were pasted in chat on 2026-11-23 stay in use; the recommendation to rotate them is withdrawn at the user's decision. Accepted risk: the secrets exist in the chat transcript. If a leak is ever suspected, rotate in the Razorpay dashboard and update the server `.env` (`docs/runbooks/deploy.md`) and the local `.env`.

## 2026-11-24 — Turnstile: an early check is reused only in the form that started it

Bug (user, live): the reset-by-email form hung on "Sending…" and then failed the security check. The sign-in form starts the Cloudflare check early (decision 2026-11-23, sign-in speed); "Forgot password?" replaced that form, the early check died with it, and the reset submit waited on it. Rule now (`apps/web/src/lib/auth/turnstile.ts`): a prefetched check is reused only when its container is the one on screen and still connected; otherwise a fresh check runs in the current container, and a widget whose container already left the page is not "removed" again. Test: `apps/web/test/turnstile-stale-widget.test.ts`; learning T199.

## 2026-11-24 — We send the reset and verification emails ourselves (supersedes the console step of 2026-11-23)

Firebase refuses to save a custom action URL for project `mechdost-dev`: both the console and the Identity Toolkit admin API answer `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`, so the "customize action URL" route cannot work. Decision: **the API sends these emails through the existing outbox and Resend pipeline** and links them to our own page.

- **Link:** the Admin SDK (`generatePasswordResetLink`, `generateEmailVerificationLink`, no `actionCodeSettings`) makes the link; only its `oobCode` is used (and `mode` is checked). The mail links to `{WEB_BASE_URL}/auth/action?mode=…&oobCode=…&lang=…` (`/hi/auth/action` for Hindi). The base is the existing `WEB_BASE_URL` (default `http://localhost:3000`, https required in production), so no new variable. With the Auth Emulator the generated link points at the emulator; only its code is used, so dev and test links point at localhost.
- **Endpoints:** `POST /v1/auth/password-reset-email` (public: per-IP 10/hour, Turnstile, per-address 3/hour counted before any lookup, one `200 accepted` answer for every address, Firebase errors swallowed and logged, 600 ms minimum duration) and `POST /v1/auth/verification-email` (signed in, per-account 5/hour, address read from the Firebase account, never from the request). Limits and Turnstile fail closed (503). Changing the address (`verifyBeforeUpdateEmail`) is not used by the app, so it has no route; the action page still handles such links.
- **Templates:** `auth_verify_email` and `auth_password_reset` in the email catalogue (English and Hindi, sender `noreply@`, no placeholders, so an admin override cannot leak the code). The one-time code is sealed in the outbox payload (`tokenEnc`, like the seller invite) and opened just before the Resend call. Not tied to the on/off switch of Admin → Emails (nobody could reset a password with it off); the text can still be reworded.
- **Web:** the Firebase client SDK no longer sends any email (`sendPasswordResetEmail`, `sendEmailVerification` removed). Sign-up sends the verification mail after the API has signed the person in again (linking turns the Firebase session into a `password` one, which the API refuses). The forgot-password email form now carries the Cloudflare check.
- **Event:** server event `auth_email_action_requested { mode, queued }` (spec 12). The page events of 2026-11-23 are unchanged.
- **Runbook:** the "customize action URL" console step is removed from `docs/runbooks/firebase.md`; nothing to change in the Firebase console, but `mechdost.com` stays in Authorised domains for the page itself (the page applies the codes with the client SDK).

## 2026-11-24 — Tata Green batteries listed too, old Tata Green products replaced (user request)

User: "this now has tata batteries too so properly show them too and u might have to edit the images maybe if their sizes dont matter and replace any pre existing tata batteries on the site". Built the same way as Exide and Amaron on the shared battery-import code; details: `docs/runbooks/catalogue-import.md` "Tata Green import".

- **All 107 rows are products** named as Tata Green names them in title case, slug from the full name; MRP = "MRP incl. taxes", the offer price and discount in `spec.tataGreenPrice` (kept out of the public page payload like `amaronPrice`).
- **Replace the old ones:** the 15 generic `tata-green-*` products are archived (never deleted), together with anything else under brand `tata-green` that is not in the plan; other brands are untouched.
- **Categories:** the existing ones, the existing `e-rickshaw-batteries` for the lithium Sawaar-e pair, and ONE new sub-category `industrial-batteries` for the nine TGI sealed batteries (admin-editable). For vehicle batteries the name the site gives the product wins over its listing page (12 products move; `spec.categoryRule`).
- **Pictures are evened out, not edited:** plain borders trimmed where the corners agree, product centred on a square canvas with the same padding, at most 2x enlarged, at most 1600 px (`sharp`, already a dependency). **Watermarks, site URLs, copyright text and logos are never removed or painted out** (user ruling 2026-11-24; a sale sticker at an edge may be cropped); a photo that carries one is left out with `--skip-photos-for` and its product imports without it. The site's grey placeholder image (three products) is never imported; those products and PREMIO DIN44L (no file) are drafts.
- **Using Tata Green's photos and text:** the site says they may not be reproduced without written permission (README of the scrape: internal reference only). Queued as Q223 in `docs/questions-for-user.md`; the code is ready, the real run is the user's call.
- **Event:** `admin_tatagreen_imported` (spec 12). **Not done yet:** the real run (waits for the user: `--plan-only`, `--dry-run`, then real).

## 2026-11-24 - Admin settings grouped into categories with search and a sticky save bar (user request)

User: "improve the admin settings properly too and give it proper visibility and categorization, rn its really messy and hard to do and maybe give it modern components too". Decision: `/admin/settings` becomes one categorised screen (registry `admin-settings-registry.ts`, 13 categories incl. an empty Roadside slot), with search, one-line help per setting (en + hi), unit-aware inputs and switches, a sticky save bar with Discard, and a confirm step for risky changes. **No setting, API call, validation or demo behaviour was changed or lost**; the company details, service-area and PIN-waiting-list screens keep their own forms and now sit in their categories. Not done on purpose: per-setting "changed by / at" (the settings rows carry only a version; the audit log link is shown instead) and no new dependency (the shadcn registries were checked; the repo already had the native switch pattern, and a dialog/tabs library would add JS for a screen that needs one `<dialog>`). Spec 08 "Settings screen", design-system "Settings workbench", spec 12 events `admin_settings_*`.

## 2026-11-24 — Product photo gallery: switch the big photo in place, no raw image links (user report)

User: product photos opened the raw API image in a new tab, there was no slider, and a click should show that image in place. Decision:

- **One client island, server-rendered pictures.** `ProductGallery` (`components/catalogue/product-gallery.tsx`) receives the pictures as server-rendered nodes (the first big one `priority`, the rest lazy) and only switches between them, so no image code enters the client bundle and LCP is unchanged. The big photo is a fixed square frame (CLS) and a CSS scroll-snap track (swipe is the browser's own scrolling, no pointer-event code).
- **Thumbnails are buttons for all photos, the first too**, with a ring and `aria-current` on the active one, 64 px (80 px from 768). Prev/next arrows are always visible on touch and appear on hover or focus where hover exists; keys Left/Right work inside the gallery; the counter "2 / 5" is hidden from screen readers and a polite `role="status"` says "Photo 2 of 5".
- **Ends do not wrap** (arrows disable at the ends), like the job-photo viewer, so a keyboard user is never thrown from one end to the other.
- **Full view on click** of the big photo: `ProductPhotoViewer` (native `<dialog>`: trap, Escape, focus back to the opener; arrows, keys, swipe), a lazy chunk loaded on first open (`import()`, no `next/dynamic`, decision 2026-11-14), images through `next/image` with the shop loader (the 1600 px copy). `PhotoViewer` of the job photos was not reused: it is typed for before/after job photos (stage, API-signed URLs, `unoptimized`).
- **No new tab and no link to the API anywhere.** Locale key `storefront.photoOpens` removed; `photos.productLabel/productShow/productEnlarge/productViewer` added in en and hi (the `photos` namespace is handed to the gallery by `ClientMessages`; the counter is digits only).
- **Events (spec 12):** `product_photo_selected {index, method: thumb|arrow|swipe|key}` and `product_photo_viewer_opened {index, count}`.
- One photo: no strip, arrows or counter, the photo still opens the full view. No photo: `ProductVisual` as before.

## 2026-11-24 - Roadside assistance, phase 1 (user rulings, design approved)

Design `docs/superpowers/specs/2026-11-24-roadside-assistance-design.md`, spec 22, plan `docs/superpowers/plans/2026-11-24-roadside-assistance.md`. Q216 closed.

- **User rulings:** responder is a mechanic or a workshop (workshops first; mechanics phase 2); Raipur, 24x7, area by pincode and hours per city, admin-editable; routing mode (`manual` / `auto` / `auto_then_manual`) per city, stored now, manual dispatch built first; price per vehicle type, admin-editable; an **advance** is paid online at booking (default 50000 paise = 500 rupees per vehicle type), the responder enters the total after the work and the customer pays total minus advance; no memberships; commission later (pending #9); account required, verified email not required; customer cancellation off, admin cancels only when no one accepts; problem type optional ("I don't know what's wrong" is a choice).
- **Vehicle types: 2W and 4W only at launch (user, 2026-11-24).** 3W is dropped from the offered types, the advance settings and the UI. The code set stays 2W/3W/4W; the per-city setting "vehicle types offered" (default 2W, 4W) is what the API and UI follow, so 3W is added later by an admin edit with no code change.
- **Own entity and machine** (`rsa_requests`, `rsaMachine`), not a mode on `service_requests`. Extra pre-payment status `awaiting_payment` (not in the design draft) because the row must exist before the Razorpay order does; it is in no queue and expires. `no_responder`, `towing` and customer line approval are deferred.
- **Money.** Two payments per request (advance, balance): `payments` gets purposes `rsa_advance` / `rsa_balance` and `rsa_request_id`; the advance amount is snapshotted on the request and every amount is asserted against the snapshot. Balance = max(total - advance, 0); a zero balance completes the request with no Razorpay order; total below advance raises a refund request for the difference. A balance can be paid online or marked cash by the responder (the request row lock is the single arbiter).
- **Refunds stay approval-first.** "Automatic refund" in the design means the system raises the refund request by itself (admin cancel, total below advance, late capture) and idempotently; finance still approves it (decisions 2026-11-15, 2026-11-23 stand). Customer copy never promises an instant refund. Q225 asks whether roadside may auto-approve.
- **Settings** live in a typed per-city row `rsa_city_settings` (version compare-and-set, audit row, en/hi labels in the locale files), because the int/boolean operational-settings registry cannot hold lists, enums or hours.
- **Arrival code** reuses the encrypted code module (4 digits, 5 tries, audited admin override), parametrised by table (`rsa_arrival_codes`).
- **Extension points for later:** `rsa_offers.responder_type` (only `workshop` today), `rsa_city_settings.routing_mode` and `max_auto_attempts`, `rsa_events` for location pings.

## 2026-11-24 - Roadside: refunds keep approval; email and WhatsApp built (user rulings)

- **Refunds (Q225, answered).** Roadside refunds keep the finance approval step like every refund; the system still raises the request by itself (admin cancel, total under the advance, late capture). Nothing changes in the code or the copy.
- **Messages (Q226, answered: build both).** Customer emails (`rsa_received`, `rsa_accepted` with the arrival code, `rsa_arrived`, `rsa_bill_ready`, `rsa_completed`, `rsa_cancelled`, `rsa_refund_processed`) in en and hi through the outbox in the same transaction as each move; sender by purpose (updates or billing). WhatsApp UTILITY templates `roadside_mechanic_on_way`, `roadside_mechanic_arrived`, `roadside_bill_ready`, `roadside_refund_processed` (customer) and `partner_new_roadside_job` (workshop), request code only (no arrival code, no amount), queued only while staff switched the event on and Meta approved. Not submitted to Meta by the builder. The arrival code is in the accepted email only (the customer asked for it in writing), never in push or WhatsApp.
- **Security review of the roadside payment, refund and route code (same day).** Fixed: customer writes now need a verified phone (not email); suggestions need `roadside:dispatch`; a pin must lie inside its city; a roadside bill above ₹1,00,000 is refused; a paused, suspended, unpublished or busy workshop cannot accept an offer it already held.

## 2026-11-24 - Roadside: bill safeguards (independent security review; user rulings)

The workshop alone sets the roadside total, so the review asked for safeguards. **Q227 answered: no customer approval step for the bill** (the mechanic enters the total, the customer pays what is left after the advance). Safeguards instead:

- **Bill limit per city (admin setting `maxBillPaise`).** Default ₹25,000 (2500000 paise), editable per city, never above ₹1,00,000 (table CHECK, Zod and code agree). A bill above it is refused (`BILL_TOO_LARGE`) before it reaches the customer.
- **"Question this bill" (admin setting `billDisputeEnabled`, per city, OFF by default).** When off, the button is hidden and the API refuses (`RSA_DISPUTE_OFF`). When on, it opens a support request (kind `rsa_bill_dispute`, linked to the roadside request, one open at a time) that staff see in the support inbox and on the roadside queue ("Bill questioned"); the balance stays payable while it is open and nothing about the money changes.
- **Cash-mark alert stays on.** Whenever a workshop marks the balance as paid in cash, ops (`roadside:read` in the city) get a staff notice (`staff.rsa_cash`).
- **Other review fixes:** city-scoped finance sees roadside refunds; a second captured payment for a paid request and purpose raises a finance alert (`staff.refund_alert`, once per Razorpay payment) because the table cannot record it; the completed email and event carry the right total when the advance covers the bill (patched amounts are refreshed onto the locked request); the arrival code is removed from the stored email payload once the mechanic arrives or the email is sent; an admin may override the arrival code only when the code is locked, a super admin (who also edits the roadside settings) always; an offer shows a workshop only the pincode, distance, vehicle and problem type, and the note and address line appear after it accepts; the unpaid-request sweep logs failures and returns the failed rows.

## 2026-11-24 — UI state audit failures fixed (demo run 45380128050, API run 45380148904)

Both full audits failed on commit c73dd8a2. Product fixes: (1) the account menu hides "Saved items" when the Saved section does not exist (the demo build): the link's prefetch hit a 404 route and looped (`ERR_TOO_MANY_REDIRECTS`); (2) the search palette's Esc key label is marked `lang="en"` (a printed key name, as the language switcher does) and the Hindi hint says "एंटर" (hard rule 10); (3) the floating dock is `bg-surface/92` (was /80): the muted tab labels fell under 4.5:1 where the dock floats over the navy hero (design-system tokens unchanged, only the glass is less see-through); (4) the product gallery has one 44px enlarge button (top right) instead of a button over every picture, so the arrows and the "2 / 5" badge no longer sit over a control; a click on the picture still opens the full view (the button is the keyboard and screen-reader path); (5) admin settings: the category pill row can no longer widen the page (`min-w-0` on its grid cell), zero-hit categories use the muted colour instead of `opacity-50` (contrast), the save bar stays in the content column from 1200 px (it covered the category list), and the "No settings match" message marks the typed word as user text; roadside bill line descriptions (typed by the workshop) are marked as user text; (6) the admin Notifications tabs wrap at 320 px; (7) the admin catalogue product row wraps its Edit button instead of overlapping the name at 320 px. Test-setup fixes only where a mock was missing: quiet mocks for `GET /workshop/roadside`, `/admin/roadside/queue`, `/admin/roadside/settings`, `/me/refunds`, a billed request for `RSA-TRACK` (`api-mode/roadside-fixtures.ts`), and the settings `confirm` hook searches in Hindi on `/hi` (it typed an English word and waited 90 s for a setting that was not shown; 14 rows). No check was weakened; the console finding now names the failing URL.

## 2026-11-24 - Floating assistant button on phones; sign-in alert region

- **Assistant button (QA 2026-11-24, `/roadside` at 390 px: it covered the "Car / SUV" card).** CSS only, no new JS: under 1024 px it hides while a form field in `main` has focus-visible, and on a page whose form carries `data-launcher-avoid-phone` (roadside request). Rejected: a right gutter on every page (68 px of 390 px) and an observer in the launcher (it is in every first load; existing test forbids it). Other forms with right-edge controls can opt in with the same attribute. Tab bar, admin sticky save bar, cart and checkout bars are untouched (the button's `bottom`/z-index are unchanged).
- **Sign-in alert region.** The assertive region is emptied (and a pending message cancelled) whenever the form error is cleared: step change, a new submit, code resent. A new submit also clears the old error first. Logic moved to `apps/web/src/lib/auth/announcer.ts` so it is unit-tested.

## 2026-11-24 - Reset form prefetches its own Turnstile check; "your password was changed" notice

- **Slowness after "Send reset link" (user report).** Cause: `onFirstTouch` refused any early Cloudflare check within 60 s of the previous one, so the reset form (swapped in by "Forgot password") never had one and the check started on submit. The guard is now keyed by the container element (`shouldPrefetch` in `lib/auth/sign-in-retry.ts`): a swapped-in form starts its own early check; the same container is not started twice inside 60 s. Security unchanged (tokens single use, reused only for the container that started them, decision 2026-11-24 "an early check is reused only in the form that started it"; the API's 600 ms floor stays, it is anti-enumeration). The busy state was already set synchronously on submit; no change needed. Measured with a fake widget that issues a token in 400 ms (`test/turnstile-prefetch-timing.test.ts`): wait after the press 414 ms without the early check, 0 ms with it. The real saving is Cloudflare's own time (usually 0.3 to 1.5 s).
- **Notice mail.** New `POST /v1/auth/password-changed` and template `auth_password_changed` (en + hi). The server verifies against Firebase (`tokensValidAfterTime` within 10 minutes), one mail per change through the outbox, always `200 accepted`, limit 20/h per IP (fail closed; the per-address budget was removed after the security review, see below), no Turnstile (reasoning in spec 01). Event `auth_password_changed_notified`. Spec 01, 10, 12; runbook firebase.md.
- **Security review fixes (same day).** (1) No per-address budget on the page endpoint: it could be used up just before a takeover to suppress the notice; the per-IP limit (fail closed) stays, found changes are cached 30 s, "nothing changed" never. (2) Server-side catch-up at the first password sign-in (same dedupe key, uses the account's uid, creation guard widened to the window because sign-up sets the password after creating the account). (3) A change within 10 s of account creation is ignored on the page path. (4) The mail goes to the Firebase record's address. (5) `.max(254)` before `.trim()` in both public schemas. Whether `linkWithCredential` at sign-up moves `tokensValidAfterTime` was not verified against real Firebase; the wide guard covers either answer.
- **Pending (user):** none new. The live check needs Resend on the server.

## 2026-11-24 - Roadside help promoted everywhere it is relevant (user: "really hard to find")

- **User:** "the roadside assistance is really hard to find right now, you need to highlight it way more mate". The only way in was a small text link at the bottom of `/workshops`.
- **Decided (approved plan, spec 22 "Where it shows"):** header item (accent, siren icon) from 1024 px, fifth tab "SOS" in the dock, a home band right after the hero ("Stuck on the road? A mechanic comes to you in Raipur, 24 hours a day." with one primary button), a highlighted card at the top of `/workshops`, a "Roadside help" suggestion in the search palette and above `/shop?q=` results for breakdown words (English, Hinglish, Hindi), and a footer link under Vehicle care.
- **City gating:** every surface reads one cached server answer, `GET /v1/roadside/city?city=` (public, IP limited, 60 s cache, `{ enabled, alwaysOpen }`). Roadside off in a city or an API failure hides all six; the demo shows them. "24 hours a day" is printed only while the city's hours are all day.
- **Admin control (hard rule 8):** the band is the home section `roadside` (first in the default order; Admin → Layout can hide or move it; a saved layout that predates it gets it first). The city on/off switch stays in Admin → Roadside.
- **Header labels shortened:** the four main header labels use the tab words (Shop, Workshops, Vehicles); with six items the long labels wrapped and squeezed the logo at 1440 px. Tab labels are one short word each so five tabs fit on one line at 320 px.
- **Colours:** none new (`accent-soft`, `accent-soft-text`, `accent-button`). **JS budget:** unchanged (band, card and nav item are server-rendered; the intent matcher is a few hundred bytes in the lazy search chunk).
- **Docs and tests:** spec 22, spec 12, spec 08 (home section), design-system "Roadside promotion"; state-audit rows added and checklist regenerated.
- **Pending (user):** OK for the navigation change from the screenshots (queued in `docs/questions-for-user.md`).

## 2026-11-24 - Admin scroll model and side bar groups; WhatsApp wording; product card tools (user: "admin side ui ... scrolling isnt really nice", "talk to real people on whatsapp doesnt sound as good", "the i button and heart button gets over the images")

- **Admin scrolling.** Root cause and model in spec 08 "Frame: scroll model and side bar groups" and design-system.md "Portal scroll model". The page is the only vertical scroller; the side bar is sticky under the header and scrolls itself only when taller than the window; the settings category list no longer sticks; no `max-h` scroll panes inside admin sections (read-before-accept legal text boxes marked `data-scroll="box"` are the one exception). The account area side bar follows the same rule. No new colour, font or radius.
- **Side bar.** Five headings (Operations, Catalogue, People, Content, System), lucide icons instead of emoji, every section and route kept. Hindi headings: संचालन, कैटलॉग, लोग, कंटेंट, सिस्टम.
- **UI audit.** New checks `scroll` (rows `ADM-SCROLL`, `API-ADM-SCROLL`) and `offphoto` (rows `HOME-PRODUCTS`, `SHOP-CARD`, `SHOP-ACTION`, `SHOP-FILTERS`, `PDP-RELATED`); checklist regenerated.
- **WhatsApp wording.** One phrase everywhere a customer is sent to WhatsApp: "Contact support on WhatsApp" (hi: "WhatsApp पर सहायता से बात करें"); trust strip "Chat with the MechDost team in English or Hindi". The footer button drops the phone number from its label (the number stays in the assistant note, the Company page and the Call link target). Admin notification wording and the WhatsApp message drafts (`whatsapp.*`) are unchanged; they are what the customer sends, not what the site says. No admin-editable copy exists for these strings (the editable trust lines are `trust.*` content keys, a different set).
- **Product card tools.** The ⓘ and ♡ buttons moved from over the picture to the right end of the category line (`data-slot="card-tools"`). The card is 18 px taller (one 40 px row instead of a 16 px text line); the eight shared grid rows still align. "Card heights stay the same" was not fully possible without shrinking the picture or the 40 px targets; the lead should confirm in the screenshots.
- **Pending (user):** whether the footer should still show the phone number next to "Contact support on WhatsApp" (default: no).

## 2026-11-24 — Photo cache, crawler rules, visitor log (free-tier egress; "check the caching", "can we not prevent crawlers?")

After the Upstash outage the free-tier limits are watched. Supabase Storage egress (free plan about 5 GB/month) is spent on every new visitor or crawler of a product photo because there is no CDN (DNS at Hostinger, Caddy straight to the API). Three changes, all invisible to normal visitors (user: "make sure it doesnt affect normal users"):

- **Photo byte cache** (`apps/api/src/photos/byte-cache.ts`, `GET /v1/product-photos/{id}/{width}`): in-process LRU of the WebP bytes of **approved** photos only, key id + width, bounded by total bytes (`PHOTO_CACHE_MB`, default 64, max 128, 0 = off; one picture over a quarter of the budget is not stored). The route still does the database check (exists, approved, signature) on every request, so a hit can never show a photo that stopped being public; only the Storage fetch is skipped. Same bytes and headers on hit and miss. Pending/rejected previews (`private, max-age=300`), 404s and Storage errors are never cached. Removing or rejecting a photo evicts its id. Cache failures are swallowed: the route falls back to Storage. API `mem_limit` 384m to 448m in `deploy/compose.yml` (see spec 16 for the memory math). The other photo routes (service, quote, support attachments) are private (`private, max-age=300`, rights-checked), so they are not cached; there is no workshop-gallery route in the API.
- **Crawlers** (`apps/web/src/lib/crawler-blocklist.ts`, `apps/web/src/app/robots.ts`): robots.txt keeps the `*` group (public pages allowed, private screens disallowed) and adds one disallow-all group naming 12 AI-training scrapers (GPTBot, ChatGPT-User, CCBot, ClaudeBot, anthropic-ai, Google-Extended, Bytespider, PerplexityBot, Amazonbot, meta-externalagent, cohere-ai, Diffbot) and 7 SEO-tool crawlers (AhrefsBot, SemrushBot, MJ12bot, DotBot, BLEXBot, PetalBot, DataForSeoBot). Googlebot, Bingbot, DuckDuckBot, Applebot, YandexBot and the share-card fetchers (facebookexternalhit, WhatsApp, Twitterbot, TelegramBot, LinkedInBot, Slackbot) are not named, so they keep following `*`. It is a request only: no user-agent or IP blocking anywhere, no challenge, no new rate limit. Hard rule 8: the list is in code for now (a settings-driven robots.txt needs a cached API read at request time); queued as a question (Q229) with the in-code list as the default.
- **Visitor log** (`deploy/Caddyfile`, `docs/runbooks/traffic.md`): Caddy JSON access log to volume `caddy_logs`, 16 MiB per file, 5 rolled kept, 30 days at most (96 MiB cap). The query string is replaced by `?REDACTED` in the URI and in `Referer` (reset links `?oobCode=`, share tokens); Caddy redacts `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization` by default (`log_credentials` stays unset). **Privacy (DPDP):** client IPs are personal data: purpose is security, abuse handling and traffic statistics; retention 30 days maximum; not joined to accounts; add a line to the privacy notice.

Tests: `apps/api/test/photo-byte-cache.test.ts` (bound, LRU, eviction, off), `apps/api/test/product-photos.test.ts` (hit equals miss, previews never cached, eviction on remove), `apps/web/test/seo.test.ts` (robots groups, search engines and preview fetchers not named, sitemap kept).

## 2026-11-24 - CEAT and MRF tyre imports; tyre sub-categories; shared pattern pictures

User: "this now has ceat tyres and mrf tyres so make sure too add them to the product lists and also remove any existing ceat / mrf products and also properly check them and categorize them aswell for the admin". Built on the battery importers (runbook `catalogue-import.md` "CEAT and MRF tyre imports"; not run against any database by the builder).

- **Rulings reused from the batteries:** exact maker names in title case (size, load/speed, TL/TT/ZR and the like exact), slug from the full name, one product per source row, old products of the brand archived (never deleted), other brands untouched, rows with no price listed live as "price on request", products without a picture are drafts, watermarks and logos never painted out.
- **Hidden CEAT price (user ruling, answered and closed as Q228):** CEAT tyres whose price exists only in the maker's hidden site data stay "price on request". That price is NOT the MRP; it is kept privately in `spec.ceatPrice.siteData` (never in the public payload: `PRIVATE_SPEC_KEYS`). Only the price shown on the page ("Price incl. taxes") and MRF's "MRP incl. GST" are MRPs.
- **Categories (admin):** eight sub-categories of the existing `tyres`: `car-suv-tyres`, `two-wheeler-tyres`, `three-wheeler-tyres`, `light-commercial-tyres`, `truck-bus-tyres`, `farm-tyres`, `otr-tyres`, `tubes-flaps`, each with English and Hindi names and descriptions (`PlannedCategory` got optional descriptions; the writer saves them). The parent/child filter already lists a sub-category's products under `category=tyres`; nothing changes in the admin screens.
- **HSN and GST:** tyres 4011, flaps 4012, tubes 4013, all 18 % (GST 2.0 of 2025-09-22; same default as ruling Q210, which still asks the CA to confirm). No new question.
- **Shared pattern pictures (data-integrity change):** every size of a pattern shows the same pictures, so the importer uploads each once and adds a photo row per size on the same stored image (`attachSharedProductPhoto`). The guard "one photo row per stored image" (`product_photos_media_uq` on `media_id`) became "one per product and image" (`product_photos_product_media_uq` on `(product_id, media_id)` plus a plain index on `media_id`), **migration 0083**. Removing or refusing a photo now retires the stored image only when no other live photo uses it (`releaseMedia`), so deleting one size's photo cannot blank the others. CEAT uploads 304 pictures instead of 1,332 and MRF 559 instead of 2,028.
- **Source oddities:** MRF duplicate pages with the same data are merged (9), a different ply keeps both with "(4 Ply)" / "(6 Ply)" in the name, a ply rating that is a spreadsheet date (45634) is left blank, "undefined" tube flags are left blank, the 22 discontinued pages get no product; CEAT contradictions follow the CSV's reconciled value; all are listed in the status reports.
- **Hindi:** the maker's feature lines (MRF 376, CEAT 169 plus taglines, usage and applications) are hand-translated dictionaries; pattern names were added to the Latin allowlist in `catalogue-hindi.ts` (`TYRE_NAMES`), generic words of tube and flap names are translated. A missing line is left out of the product and stops a real run.
- **Shared code moved:** the picture-normaliser step of the Tata Green CLI is now `apps/api/src/cli/normalised-pictures.ts` (used by Tata Green, CEAT and MRF); the CLI core got `sharePhotos`. Battery tests unchanged and green.
- **Later rulings, same day (user), for all tyre brands (CEAT, MRF, Apollo):** (1) **Apollo sizes that are "Shop only"** (on shop.apollotyres.com but missing from the pattern's size table on the main site, 80 sizes, and Vredestein if shop-only) are ignored and listed as dropped in the status report: "if theres some that are like shop only u can ignore them". (2) **One product per tread pattern, sizes as variants**, "just like amazon lists two items that just vary in packing size like 500 ml and 1 L": "CEAT Milaze X3" is one product, each size ("145/70R12 69T TL") a variant with its own SKU, MRP or price on request, EAN, load/speed, TL/TT and fitment. Batteries stay one product per model. The storefront must show a size picker, price per size, and cart, stock, shop price and order lines per variant; if a piece is missing it is built with the UI chain, strings in both languages, analytics events and state-audit rows, within the product-page JS budget. **Status:** the CEAT and MRF importers were built and gated as one product per SIZE (before this ruling); converting them (and building Apollo with the India-only filter, `industrial-tyres` sub-category, shop-only drop) to one product per pattern depends on the variant investigation in `docs/progress.md` and is the next step.
- **Built later the same day (builder):** (1) the import writer takes `variants[]` per planned product (barcode written, a dropped size archived alone, a SKU of another brand stops the import `SLUG_TAKEN`, split SKUs stop it `SKU_SPLIT`); batteries keep one variant and every battery test is unchanged. (2) CEAT and MRF are now **one product per tread pattern (and kind), sizes as variants** (CEAT 71 products / 336 sizes, MRF 225 / 918); pattern products that mix kinds are split by kind; the variant label is the maker's size text; `options` = `{ size, loadIndex, speedRating, construction, tlTt, ply, frontRear }`; per-size private data under `spec.variantSpecs[sku]` (added to `PRIVATE_SPEC_KEYS`). (3) **Apollo, India only** (`pnpm db:import:apollo`): 179 "Shop only" rows (incl. 95 Vredestein) and 21 brochure-only sizes dropped, 3 duplicate listings merged, each listed with its reason; 468 sizes in 131 products; MRP only from the shop column, EAN in the variant barcode; new sub-category `industrial-tyres`, earthmover in `otr-tyres`; existing `apollo` and `vredestein` products archived, no other brand touched; fitment private per size; construction derived from the size notation; Hindi leftovers 0 with hand-made dictionaries (122 descriptions, 96 features). New event `admin_apollo_imported` (spec 12). Not run against any database; the live runs stay with the lead.
- **Pending (user):** none new (the hidden-price question is closed). The live runs (`--dry-run`, then real; migration 0083 first) are the lead's, and should wait for the per-pattern conversion.

## 2026-11-24 - Sizes as variants on the storefront (user: "just like amazon lists two items that just vary in packing size")

User, 2026-11-24: tyres are listed as one product per tread pattern with the sizes as variants, like 500 ml and 1 L on Amazon. The data side (importers) writes the variants; this change makes the storefront, cart, orders, compare and admin work per size. Rulings, in the order they were taken:

- **Native radios, not a custom radio group.** The picker uses the same pattern as the account forms (visually hidden `input type=radio`, `has-checked` styling): keyboard, focus and announcements are the browser's, which costs fewer bytes than a roving-tabindex widget (product-page JS budget). Only products with several sizes load it.
- **The picker owns the whole buying area** (price, trust line, stock, delivery, compare/wishlist, add to cart) so one state drives them; every text is translated and formatted on the server and passed in as props (no i18n runtime in the island). A single-size page is untouched.
- **Cards for several sizes have no "Add to cart"**: they show "from ₹X · N sizes" and "Choose size" (a link). A card cannot know which size is wanted; adding the cheapest one silently would be wrong.
- **Cart line key = SKU** (`sku ?? slug` in the browser). The server cart already keyed by SKU, which is globally unique and resolves to one `variant_id`; nothing on the server cart changes. Old slug-only browser lines become the product's first size.
- **Order snapshot names the size in the title** (single write point, so every order page, invoice and e-mail shows it) and keeps it apart in `order_items.variant_label` (migration 0084) for reports and training data (rule 16). Only products with more than one active size get a suffix.
- **Fits your vehicle is computed on the server** (`GET /v1/me/vehicles/fit`): the per-size fitment is private (`variantSpecs` joins `PRIVATE_SPEC_KEYS`); the page is cached and public, so the island asks after it loads, only in real sign-in mode, and a failed or empty answer changes nothing.
- **Admin edits sizes with a version column** (`product_variants.version`, migration 0084) and the existing permission `products:write` (the catalogue editor's gate; archive and restore also need `products:publish`, because they change what customers see). The MRP ceiling rule (never under a price already set) and "a live product keeps one active size" are enforced in the repository.
- **Migration number 0084** (0083 belongs to the tyre data branch): its journal entry is `idx 84`; the snapshot `0084_snapshot.json` was generated without the data branch's changes, so after merging both branches regenerate the snapshot (`pnpm --filter @mechdost/db generate` on the merged tree produces an empty diff when they agree).
- **User ruling the same night: "u can ship the size picker stuff ill review it myself in the morning."** The screenshots are taken for that morning review; shipping does not wait for approval of them.
- Not done tonight (follow-ups in spec 02): compare size chosen from the product page, photos per size, separate editing of load / speed / TL fields in the admin editor.

## 2026-11-25 - Notification inbox: unread first, priority colours, done notices clear (user: "keep the unread notifications at the top and give them a proper colour scheme like red for urgent etc and also u can clear the notifications those whos actions have been done and carry no further stuff we can do remove them")

Spec 10 "Inbox order, priority colours and clean-up" has the full tables. Choices made (mechdost-advisor brief for the task; the user gave the requirements, so these are the recorded design calls):

- **Order is computed in the database, not the page.** Three groups (unread urgent, unread, read), newest first inside each, by one SQL expression behind one partial index `notifications_inbox_idx (user_id, group, created_at desc, id desc) where dismissed_at is null and resolved_at is null`. The keyset cursor is (group, created_at, id). Alternatives rejected: sorting in the browser (breaks paging, hard rule 7) and a stored `sort_key` column (a second copy to keep in step on every read). Trade-off: reading a notice moves it between groups, so the browser re-fetches the pages it has loaded in one request instead of stitching pages.
- **Priority is a code per kind, stored on the row.** `NOTICE_PRIORITY_OF_KIND` in `packages/shared/src/notice-api.ts` (single source, a test keeps it equal to the catalogue), written by `queueNotice` into `notifications.priority` (CHECK). Stored, not computed per read, so the order is index-backed and old rows keep the priority they had when sent. **Not admin-editable yet** (hard rule 8 exception, queued as PENDING #24 with the code constant as the default). `order.rejected` and `refund.declined` are `info`, not `action`: the customer has nothing to do, so they must not look like a task.
- **Colours: existing tokens only.** urgent = `--color-error`, action = accent (`accent-button` bar, `accent-soft` tile), info = `muted` on `pill`, success = `success` on `success-bg`. No new colour, font or radius. Each priority also has its own icon and a visible text label, so colour is never the only signal (WCAG 1.4.1); contrast measured light and dark by the accessibility specialists (all text pairs 4.2:1 or more, bars 3:1 or more at full strength; read rows fade the bar to 70%).
- **Removal is a soft delete (`dismissed_at`), not a hard delete.** "Clear all read" needs an Undo toast (rule 2: no confirm modal), and Undo needs the rows. A token (the batch's `dismissed_at`) restores exactly one batch of the caller's own rows. The daily worker job hard-deletes removed rows after 7 days, done rows after 1 day, and read informational rows (`info`, `success`) older than `notifications.info_clear_days` (admin setting, default 30). The `notification_*` analytics events are separate append-only rows and are never touched (rule 16); new events `notification_dismissed`, `notifications_cleared`, `notifications_restored`.
- **Done notices leave the list at once.** A row with `resolved_at` set is no longer listed or counted (it was shown with a "Done" tag before; superseded). Hooks that were missing and are now in the same transaction as the state change: `ticket.reply` (customer replies, staff resolve or close, auto-close), `partner.warning` (warning withdrawn), `refund.failed` (refund processed or rejected). `staff.refund_alert` for an extra payment (entity = payment id) has no in-system completion and stays until removed.
- **Other devices:** each removal, clear or undo writes a `notice.changed` live ping to `user:<id>` (new live kind `notice`, check constraint widened in 0085); the poll stays the fallback.
- **Migration `0085_notice_inbox`** (columns `priority`, `dismissed_at`, four indexes, priority backfill from the kind, `live_outbox` kind check). Written and tested on PGlite, **not applied** to the real database; apply with the next release (migrations first, runbook deploy § 6). Expand-only: nothing dropped.
- **Test tooling:** `STATE_AUDIT_API_ORIGIN` and `STATE_AUDIT_DIST` let a second real-mode audit build run beside another one without sharing port 4100 or `.next-api`.

## 2026-11-25 - HP and BPCL MAK lubricant imports (automotive only; BPCL prices are MRPs; generic photos never used)

User: "HP and BPCL lubricants have been listed here now pls do check them as well" (`autoparts/hp_lubricants`, `autoparts/bpcl_mak_lubricants`). Runbook `docs/runbooks/catalogue-import.md` "HP and BPCL MAK lubricant imports".

- **Ruling 1 (user, 2026-11-25): automotive only.** Engine oils (car, bike and scooter, diesel and heavy-duty, CNG), gear and transmission oils, brake and fork fluids, radiator coolants, automotive greases, tractor and agriculture oils, the EV and hybrid range, FUTUR-X. Industrial, metal-working, hydraulic, quenching, compressor, rubber process, rust preventive, marine and industrial grease rows are skipped, each listed with its reason (`skipped` report). The rule where a row is ambiguous (HP "Specialties", BPCL blank or "Specialties" labels): decide by the row's category, then its application and description. Kept by that rule: HP diesel exhaust fluid, HP foam air-filter oil; BPCL AdBlue (DEF), chain spray, multi-purpose spray. Skipped by it: HP railroad engine oils (locomotives), HP natural gas engine oils A, L and M (stationary DG sets), HP spray oils (plantation crops), HP outboard marine oils.
- **Ruling 2 (user, 2026-11-25): BPCL prices.** "Rs 354/-" next to a pack is that pack's MRP; a pack without a price is price on request. HP shows no prices, so every HP pack is price on request.
- **Finding:** HP's "Pack sizes" column is empty on all 363 rows (the brief expected sizes). Each HP product gets one variant "Standard pack" (price on request); no size is guessed from picture file names. Queued as Q233.
- **One product per oil and grade**, packs as variants (labels "1 L", "900 ml", "3.5 L"; `netQuantity` ml or g; `options` `{ label }` as Castrol). Multi-grade pages are split per grade; duplicate listings merge by normalised name. SAE grades are written `10W-30` throughout (the pages mix "10W 30", "20W40", "10W-30").
- **Brand names:** HP (slug `hp`, existing) and "BPCL MAK" (slug `bpcl-mak`, from the source's Brand column; "MAK" alone is the product line, so products read "BPCL MAK Alpha Zenith 5W-40").
- **Categories:** existing `lubricants` children only (decision "new child only if clearly needed": none was). EV fluids go by what they are (`spec.evRange`). Auto-rickshaw oils: diesel -> diesel-engine-oil, petrol/CNG/LPG -> car-engine-oil, vehicle type 3W. HSN 2710 oils, 3403 greases and sprays, 3820 coolants, 3819 brake fluid, 3102 diesel exhaust fluid (differs from the catalogue-v2 fallback of 2710 for speciality rows; the admin can change it); GST 18 %.
- **Photos (user: a photo the source marks as generic must not be a product photo):** decided by the file's bytes, not only the source note: the same picture on 4 or more products or also on an unimported product is the stock drum -> draft `generic_photo_only`; the same picture on 2 or 3 different products is a pack photo of another product -> draft `photo_of_another_product` (a stricter reading than the ruling, to avoid showing the wrong label; reversible); no picture -> `no_photo_on_site`. Result: HP 124 of 187 and BPCL MAK 9 of 85 products are drafts (Q232). Watermarks, logos and text are never removed.
- **Data sheets:** the PDS URL is kept privately in `spec.sourceDocs` (`PRIVATE_SPEC_KEYS`); no downloads feature (Q231, default no).
- **Typed properties** from the grade tables (`spec.properties`: viscosity at 100 C and 40 C, viscosity index, flash point, pour point, TBN) with range checks; impossible values are dropped and reported (the HP tables have misread cells).
- **Hindi:** 800 source texts translated through helpers into dictionaries (`features-hi-*.ts`), 0 leftovers by `planHindiLeftovers`; makers, models and standards that stay Latin are listed in `hindi-allowed.ts`; a person should skim the dictionaries. The long marketing descriptions of the pages are not imported.
- **Events:** `admin_hp_imported`, `admin_bpcl_imported` (spec 12). `sourceDocs` joins `PRIVATE_SPEC_KEYS`. `parseApi`, `parseJaso`, `parseBaseType` in `catalogue-v2/plan.ts` are exported for reuse (no behaviour change).
- **Not done (by ruling):** no `--dry-run`, no real import, no database touched. The import is run by the lead after review.

### 2026-11-25 (later) - HP Racer4 kept; HP packs and prices from researched CSV; BPCL first (user rulings)

- **Keep HP Racer4 live (user).** The live product `hp-racer4-20w40-900ml` (SKU `HPL-RACER4-0900`, 2 orders, shop inventory) is never archived by the HP import: the writer config has `keepSlugs`, set for HP (`repo/lube-import.ts`); a dry run does not list it; test in `packages/db/test/lube-import.test.ts`. Every other old HP product not in the plan is still archived.
- **HP packs and prices from online research (user), supersedes "one Standard pack" for the products the research covers.** `pnpm db:import:hp --packs <csv>` (columns `plan_slug, product_name, grade, pack_label, net_qty, net_unit, mrp_inr, sale_price_inr, source_url, source_type, checked_on, confidence, status, note`): researched packs replace the "Standard pack" (canonical label from `net_qty` and `net_unit`, net quantity, unique SKU); MRP only from `mrp_inr` of a row with confidence high or medium; `sale_price_inr` is never the MRP; low confidence and packs whose accepted rows disagree stay at price on request and are listed in the report; `source_url` (all rows of the pack), `checked_on` (latest) and confidence are kept per pack in private `spec.packSources[sku]` (`packSources` is in `PRIVATE_SPEC_KEYS`); a product with no researched rows keeps the Standard pack; CSV rows for no planned product are listed. The CSV `status` and `note` columns are not used by the importer. Q233 is answered by this ruling.
- **BPCL goes first (user):** the branch is committed so the lead can merge and run BPCL before HP.

### 2026-11-25 (later still) - HP goes in with own-photo products live; no MRP from the research; Servo added (user rulings)

- **HP (user):** HP goes in with the products that have their own photo live at price on request; everything else stays draft. `--packs` uses only the pack sizes of `pack_only` and `found` rows whose note does not say "inferred link"; **no MRP at all is taken from the research, even from high or medium confidence rows**; `--packs-mrp off` is the default (`on` keeps the earlier MRP rules for a later decision). Tests: `packages/db/test/lube-hp-packs.test.ts`.
- **Servo (user): "import all that have images".** `pnpm db:import:servo`: automotive products with a picture only (12), everything else left out and listed with its reason (not even drafts). IndiaMART seller prices are asking prices, not MRPs: no MRP. Pack sizes only from listings with confidence High. Brand `servo` (display "Servo", maker IndianOil/IOCL in spec); old `servo` and `iocl` products not in the plan are archived. Seller photos are flagged in the report, nothing is painted out. A page with several grades whose photo shows one grade imports only that grade (Super MG 20W-40; the other 4 grades are listed). Event `admin_servo_imported`; `photoFlags` and `packSources` join `PRIVATE_SPEC_KEYS`.

## 2026-11-25 - Admin round 2: one page pattern for every admin section

User, 2026-11-25: "maybe admin ui can do a bit of improving", then "yes start the admin ui round 2". Rulings in the order they were taken:

- **Restyle the real pages only, invent nothing.** Two earlier redesign samples were rejected for copying another site and inventing toggles (memory ui-redesign-feedback); round 2 changes headers, cards, badges, tables and states of the existing screens and keeps every route, control and behaviour.
- **One header, rendered once by `AdminConsole`**, not copied into 23 screens: title from the side bar key, purpose from new `portal.adminHeader_<section>` keys (en + hi), the single primary action through a portal slot (`AdminHeaderActions`) so the button keeps its state and focus handling. Local title blocks were removed; their `aria-labelledby` now points at `admin-page-title`.
- **Heading levels:** the header is the section's only `h2`; queue and panel headings became `h3` (accessibility review, 2026-11-25).
- **One status mapping** (`lib/admin-status-tone.ts`) over existing token pairs; badges are words, 12 px minimum, and wrap. No new colour, font or radius. The admin card is the portal card at 16 px padding (20 px from tablet), used in admin files only; the storefront and account keep 20 px.
- **No sticky table header.** A box that scrolls sideways owns the sticky position and `overflow-x: clip` would hide columns (the keyboard review flagged the clip as a lost-content risk); today's admin tables are short. Revisit with a viewport-level sticky header if a long table appears.
- **No shared form-field component yet:** the review wants a render-prop that wires `aria-describedby` and `aria-invalid`; the existing forms already set them by hand, so the pattern is documented only. Follow-up in spec 08.
- **Accessibility review (2026-11-25, specialists aria, keyboard, headings and tables, contrast and forms):** applied the heading levels, the tile reading order (label first in the DOM), removal of the clipping sticky mode and of the unused field component. All badge tones pass AA in both themes (tightest: accent badge 4.88:1 light). Open, pre-existing and not changed here: focus is not moved into the Coupons form or back to the trigger after save (the trigger already unmounted before this change), the Errors retry drops focus, `AdminTable` is always a tab stop.
- **Audit:** new check `adminhead`, rows `ADM-HEADER` and `API-ADM-HEADER`.

## 2026-11-25 - Admin data colour (user: "u can use more colours in admin aswell to make the data more visible and easily understandable")

Colour may carry meaning in admin data (rule 2: a new colour needs an entry; this is it). Limits set by the lead with the ruling: always paired with words or an icon (WCAG 1.4.1), brand navy and orange stay the identity, red and green stay meaningful, not decorative.

- **New tokens in `packages/ui/src/tokens.css`**, light and dark: `--color-error-bg` (#fdeceb / #3a1a17), `--color-info-bg` (#e7f0fb / #12263d), `--color-info` (#1b4f8f / #a6c9f5). Success and warning pairs already existed. `bg-error-bg` was used by coupon, roadside and shop-CSV alerts without a token behind it (it rendered transparent); those alerts now get the soft red. Pairs asserted in `apps/web/test/tokens.test.ts` (text 4.5:1 on each tint, marks 3:1 on the card), both themes; tightest new pair is the accent badge, unchanged.
- **Status families, one shared map** (`lib/admin-status-tone.ts`, unit-tested): waiting / needs action amber, urgent / overdue / failed / declined red, in progress blue, done / paid / delivered green, cancelled / archived grey, information navy (neutral). Order queues, refund statuses, partner and customer-block states, error levels all read from it.
- **Stat tiles** (`admin-overview-tile.tsx`): soft tint by meaning when the queue has work (amber for routing, waiting and support, blue for in-progress counts, red for refunds to approve or check, green for order value today), grey when it is empty; the number in the tone colour, a coloured icon chip, and "Needs attention" in words on amber and red tiles.
- **Charts** are hand-made SVG (not Recharts) with one series each, so the `dataviz` rule "one hue per measure" applies instead of a categorical palette: counts blue, money green, visitors the brand orange, funnel blue; hover bar ink; every chart keeps its text readout, keyboard keys and table view. Marks are at least 3:1 on the card in both themes (tokens test).
- **Tables and lists:** coloured status badges, queue counts as badges (amber, amber, blue, green, red, grey), refund amounts in red (money going out) and an overdue refund row on the soft red tint with a red "Overdue" badge. No other money is coloured.
- Not done: coloured money in order tables (no negative amounts exist there), per-chart categorical palettes (none has two series).

## 2026-11-25 — Codes submit themselves at full length

User: "during forgot password or anything that requires a code, if the code entered matches you can directly accept it without having them to click the submit button". Decided: every fixed-length code (sign-up, staff and reset SMS codes, partner status code, order delivery code) is sent automatically once per distinct complete value, through one hook (`useAutoSubmitCode`); Submit stays as the fallback; a helper line announces the behaviour (WCAG 3.2.2); event `code_submitted` carries `auto`. Phone reset is split into code and new-password steps so the code can be checked alone. The delivery code auto-submits too (a try counts toward the 5-attempt lock either way). Same day: the staff code step starts its Cloudflare check as it opens and runs it beside the code check (30 s report). Details: spec 01.

## 2026-11-25 - Storefront "Edit" shortcut for catalogue staff (user: "if the login is admin ... a little edit button over the products ... proper security checks"; "both cards and product page")

- A pencil link on product cards and the product page for `products:write` holders only (super_admin, catalogue_manager); it opens the existing admin catalogue editor at `/admin/catalogue?product=<slug>`. No inline editing on the storefront.
- **Security:** authority is the API (role-leak tests); visibility from the live `/v1/me` permissions (no new API field: `permissions` already exists), one request per account, none for guests; shop pages stay cacheable because nothing staff-only is in the server HTML (client wrapper + lazy chunk).
- **Performance:** wrapper only in the shop bundles: /shop 174.0 to 174.3 KB gz, product page 175.1 to 175.5 KB gz (limit 180).
- Placement: on the picture's top right (the ⓘ ♡ buttons stay on the category line, decision 2026-11-24). New event in spec 12. No new colour, font or radius.

## 2026-11-25 - Search by size: every active size is searchable, the card says so, the picker shows sizes as tiles (user: "the different sizes of the same product does it show even if i search any of the size and it would open that product? and it would also like tell that the product exists so the customer wont be confused and also improve the way in which u show them")

- **Ruling.** A product is found by any of its active sizes, in any spacing; results say which size matched; the link opens the product with that size chosen. Spec 02 "Search by size".
- **Migration `0086_variant_size_search` (written, NOT applied):** `product_variants.size_compact` kept by a trigger from `options` + pack (function `variant_size_compact`), backfill without bumping `version`, trigram GIN index. Apply with the next release (migrations first).
- **Ranking change:** `SEARCH_WEIGHTS.tyreSize` 1 -> 3, so a size match outranks a brand-only match. A size-only query now filters on the size (it found nothing before).
- **API additions (additive):** `matchedSizes` on catalogue cards, `matchedSize` on suggestions. Analytics `search_size_match_clicked`.
- **Not built:** the card line "N sizes . range" (needs an API size-range field); queued as an improvement, no user decision needed.

## 2026-11-25 - User rulings on the open questions (evening)

- **Q229, crawler blocklist: not admin-editable (user: "the block list should not be editable in admin").** The list stays in code (`apps/web/src/lib/crawler-blocklist.ts`); a change needs a deploy. Recorded exception to hard rule 8.
- **Q231, data sheets: product pages do not offer the lubricant data sheet PDFs (user: "no").** `spec.sourceDocs` stays private (`PRIVATE_SPEC_KEYS`).
- **PENDING #24, notification priority: not admin-editable (user: "no").** `NOTICE_PRIORITY_OF_KIND` in code stays the single source.
- Still open: footer WhatsApp number (default hidden), Q232 shared-photo drafts, Super MG other grades (explained: only the 20W-40 can has a photo; recommendation: keep 20W-40 only, or other grades as drafts until photos exist).

## 2026-11-25 - Shopping personalisation plan; vehicle segments approved

User approved the eight vehicle segments ("yeah the segments are fine go ahead"): Two-wheeler, Three-wheeler, Car/SUV,
Light commercial, Truck & bus, Tractor & farm, Construction/OTR, Not a vehicle. Phases and rules in
`docs/superpowers/specs/2026-11-25-shopping-personalisation-design.md`: (1) segments as an admin-editable many-to-many
table back-filled from categories, chips + card tags + home tiles; (2) recently viewed (consent-gated server copy) and
Back keeps the list position; (3) "Similar options" / "Goes well with" rule-based suggestions; (4) honest savings (delivered
orders, printed-MRP snapshot, coupons, Coins, delivery fee; price-on-request lines not counted). Screenshots before each ships.
Also ruled today: Super MG stays 20W-40 only; footer WhatsApp number stays hidden.
