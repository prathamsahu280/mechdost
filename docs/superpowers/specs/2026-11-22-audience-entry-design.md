# Audience entry: car/bike owners, mechanics and garages, fleets — design (2026-11-22)

User (2026-11-22): "Split the entry by audience. The homepage is retail-first. Add clear paths for car/bike owners,
mechanics and garages, and fleets. For mechanics, offer trade pricing after login, GST invoices, reorder, and bulk.
Fleets can lead to your Uptime concept." The user is away ("do this … and then ask me questions later"), so the open
choices below are **rulings with safe defaults**, each queued in `docs/questions-for-user.md` (Q202–Q206).

## Intent

One site, three entry paths, without making the retail visitor work harder:

- **Car/bike owners (retail, default):** the home page stays as it is — shop, find a workshop, my vehicle.
- **Mechanics and garages (trade buyers):** people who buy parts for their customers' vehicles. They want lower
  prices, GST invoices to claim input credit, fast reorders of the same parts, and bulk orders.
- **Fleets** (auto/taxi operators, delivery fleets, company vehicles): they want vehicles back on the road fast,
  scheduled maintenance, one monthly bill. The user calls this the **"Uptime"** offer.

Non-goals now: credit terms, a separate B2B storefront, a fleet dashboard, a mechanic app. Anti-goal: a home page
that reads like a B2B portal to a retail visitor.

## Approaches considered

1. **Audience band on the home page + one landing page per business audience** (chosen). Retail-first page keeps
   its order; a compact "Who are you shopping for?" band (three cards) sits right after the hero; header/footer get
   "For business". Each business audience gets a landing page that explains the offer with real, working links.
2. Audience switcher in the header that re-skins the whole site per audience — confusing (prices and copy would
   change under the visitor), more client JS on every page (budget), two sites to test.
3. A separate B2B sub-site (`business.mechdost.com`) — duplicate catalogue, auth and SEO, far too early.

## What gets built now (no pending decision needed)

1. **Home audience band** — new home section `audiences` (`packages/shared/src/site-layout.ts`), placed right after
   the hero by default, show/hide/reorder in Admin → Layout like the other sections (hard rule 8). Three cards:
   "For your car or bike" (→ shop + find workshops), "For mechanics & garages" (→ `/business/garages`), "For fleets"
   (→ `/business/fleets`). Server component, no client JS (budget). Analytics: `click` ids
   `home_audience_retail|garages|fleets`.
2. **Landing pages** `/business/garages` and `/business/fleets` (en + hi, SEO metadata, sitemap, hreflang).
   - **Garages:** four benefits with honest status — _Bulk orders_ (live, → `/quotes/new`), _GST invoice details at
     checkout_ (live: optional buyer GSTIN), _Order again in one tap_ (built now), _Trade prices after you sign in_
     ("for verified trade accounts — apply now"; prices arrive with Q203). Primary action: **Apply for a trade
     account** (one primary action per screen).
   - **Fleets — "MechDost Uptime":** priority workshop slots, scheduled maintenance reminders, pickup where
     available, one monthly GST statement, a named contact. Labelled as a programme we are onboarding fleets into
     (no promise of features that don't exist). Primary action: **Talk to us about your fleet** (enquiry).
   - All copy in the locale files; the page sections are content blocks the admin can edit (existing content/CMS
     mechanism), so the user can rewrite the Uptime offer without a deploy.
3. **Business applications** — reuse the partner application pipeline (codes, status, admin review, emails) with two
   new kinds: `trade` (mechanic/garage/retailer buying for resale or repair: business name, type, GSTIN optional,
   city/PIN, monthly spend band, categories bought) and `fleet` (company, fleet size by type 2W/3W/4W, city, contact,
   needs). Enum codes, not free text (hard rule 16); Turnstile + rate limit (rule 4); admin queue filters by kind.
   - Approving a `trade` application marks the **applicant's account** as a verified trade account
     (`trade_status: verified`, audited, reversible with a reason). The applicant must be signed in to apply
     (the account to verify); a `fleet` enquiry can be sent signed out (a lead, no account effect).
   - A verified trade account sees a "Trade account" badge, its GSTIN pre-filled at checkout, and — once Q203 is
     answered — trade prices.
4. **Order again** (all customers, retail too): on a past order (account orders list and order page) one button adds
   the same SKUs and quantities to the cart, re-priced live; lines no longer sold are reported, never silently
   dropped. Lives only on account/order pages (not in the `/shop` or `/cart` first load; budget).
5. **Header/footer:** a "For business" link (footer column "For business": Mechanics & garages, Fleets, Bulk orders;
   header: one link that fits the existing nav at 1024+ and sits in the mobile menu, not a 6th tab — the bottom tab
   bar stays at 4).

## Rulings (defaults until the user answers)

- **R1 Uptime:** "MechDost Uptime" = the fleet programme above; landing + enquiry only (Q202 asks what Uptime means
  to the user: SLA, subscription, pricing).
- **R2 Trade pricing:** not shown until Q203 is answered (who sets the trade price — shop per offer with admin
  approval, or a MechDost-set percentage — and who funds it; ties to the open commission decision). The landing says
  "for verified trade accounts" and the account flag ships now so pricing plugs in later.
- **R3 Trade eligibility:** GSTIN optional (many mechanics are unregistered); admin verifies by phone/visit (Q204).
- **R4 GST invoices:** today = buyer GSTIN on the order; real GST tax invoices wait for Q97 — copy says "GST details on
  your bill", never "GST invoice" until Q97.
- **R5 Nav label:** "For business" (Q206).

## Later (after answers)

Trade price display and checkout pricing (Q203), fleet accounts with monthly statements and credit (Q205), fleet
dashboard, per-vehicle maintenance plans.

## Acceptance

Home band visible after the hero in en/hi, light/dark, 320–1920 px, hidden/reordered from Admin → Layout; both landing
pages pass the Hindi coverage crawl and are in the sitemap; trade and fleet applications reach the admin queue with
emails; approving a trade application flips the account badge and GSTIN prefill (audited); Order again re-prices and
reports missing lines; JS budget unchanged on `/`, `/shop`, `/cart`; analytics events in spec 12.
