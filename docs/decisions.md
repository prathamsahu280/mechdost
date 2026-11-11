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
- **Correction:** `price_history_daily` (review A5) is needed 30 days before the first production price reduction, not by a fixed 1 Dec 2026 date (nothing is deployed yet); it is built before launch.

## PENDING DECISIONS (ask "what's pending" to review)

| #   | Topic                                                                                                                                                                                       | Leaning                                                                             | When                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Payment methods at launch (COD + Razorpay vs COD only vs Razorpay only)                                                                                                                     | Most probably COD + Razorpay                                                        | Later                                |
| 2   | Post-purchase P1 items at launch (exchanges, reminders, disputes, order chat)                                                                                                               | Probably include all (option 3)                                                     | Later (user, 2026-11-01)             |
| 3   | WhatsApp handoff from support tickets — **built 2026-11-03**: inbound WhatsApp → tickets, replies inside the 24 h window (spec 09)                                                          | —                                                                                   | Later                                |
| 4   | Vehicle master data source (curated CSV vs licensed DB)                                                                                                                                     | Most probably curated CSV, admin-editable, Vahan later                              | Later                                |
| 5   | Vehicle fields may change                                                                                                                                                                   | Option 1 for now                                                                    | Open                                 |
| 6   | Messaging provider (MSG91 vs Twilio) — **SMS only**; WhatsApp decided 2026-11-02: Meta Cloud API direct                                                                                     | MSG91                                                                               | Later (setup only, not during build) |
| 7   | Geocoding/autocomplete + routing provider (Google Places vs Ola Maps; OSRM/Ola routing)                                                                                                     | Decide via 50-address Raipur bake-off                                               | During service-flow build (Phase 2)  |
| 8   | ~~Hindi UI at launch or P1~~ decided: both at launch                                                                                                                                        | —                                                                                   | Done                                 |
| 9   | Commission and payout model for shops/workshops                                                                                                                                             | Ledger built generically; rates configurable per category/partner; user will decide | Later ("ill tell u on this later")   |
| 11  | GSTIN + address confirmed 2026-11-01; CIN + grievance officer name still needed                                                                                                             | —                                                                                   | Before launch                        |
| 12  | Razorpay MCP connection (test keys)                                                                                                                                                         | Add when Razorpay account is ready                                                  | Later                                |
| 13  | ~~"ux superpower" skill identity~~ confirmed obra/superpowers (2026-11-01)                                                                                                                  | —                                                                                   | Done                                 |
| 15  | Vehicle fields, commission, payment methods, post-purchase P1 — see rows 1, 2, 5, 9                                                                                                         | —                                                                                   | —                                    |
| 14  | Baseline walkthrough: remaining untouched P0 items use the baseline defaults (coupons engine, attribute sets, part numbers, SEO, OOS handling, admin CRUD conventions, impersonation in P1) | Defaults                                                                            | Confirm anytime                      |
| 16  | Hindi map: roads without `name:hi` in OSM show their local (English) name on `/hi` — keep, or hide them (inbox Q64)                                                                         | Keep showing the local name; refs (NH30) always                                     | Before launch                        |

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
