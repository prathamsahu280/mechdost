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

## Accessibility requirements (accessibility lead, 2026-11-22; WCAG 2.2 AA, en + hi, light + dark)

All components: design tokens only (contrast ≥ 4.5:1 text, ≥ 3:1 UI/focus in both themes); visible focus ring
(`focus-visible:outline-3 outline-focus`); targets ≥ 44 px (≥ 24 px minimum per 2.5.8); no meaning by colour alone;
`lang` follows the page locale, Latin brand words inside Hindi copy need no `lang` change, English-only fragments on
`/hi` (column codes, "MechDost Uptime") get `lang="en"`; reflow to 320 px with no horizontal scroll; motion respects
`prefers-reduced-motion`.

1. **Home audience band:** a `<section aria-labelledby>` with a visible `h2` ("Who are you shopping for?") — keep the
   heading order (h1 in hero → h2 here); a `<ul>` of three cards; each card is ONE link (the whole card clickable via a
   stretched link, accessible name = the card title, description via `aria-describedby` or plain text inside) — no
   nested interactive elements; decorative icons/emoji `aria-hidden="true"`.
2. **Landing pages:** one `h1`; benefits as a list with `h2`/`h3` per benefit; the status label ("Live" / "Coming for
   verified trade accounts") is text, not only a colour chip; one primary action as a link styled as a button; the
   page `<title>` and `h1` match the purpose.
3. **Apply form:** every field has a visible `<label>`; required fields marked in text ("required"), not only `*`;
   enums as native radio groups / checkbox groups inside `<fieldset>` + `<legend>`; GSTIN `inputmode="text"`
   `autocomplete="off"` with a hint (format) linked by `aria-describedby`; numbers `inputmode="numeric"`; errors
   inline next to the field (`aria-invalid` + `aria-describedby` to the message) and an error summary at the top that
   receives focus on submit failure, each item linking to its field; Turnstile labelled; the signed-out trade prompt is
   a heading + a sign-in link (`loginHref` returning here); on success move focus to the success heading, which shows
   the application code as text (copyable); no timeouts on input (2.2.1).
4. **Order again:** a native `<button>`; while busy `aria-busy="true"` + `disabled` + visible "Adding…" text; the
   result goes to a polite live region (`role="status"`) AND a visible panel listing added and missing lines (a list,
   not a sentence of names); the panel is closable (Cancel/Close button with `data-panel-cancel`, Escape) and focus
   returns to the button; a link "Go to cart" inside the panel; on the orders list each button's name includes the
   order code (`aria-label` or visually hidden text: "Order again: MD-…").
5. **"For business" nav:** a plain link in the header nav list (≥ 1024 px) and in the mobile menu, not a new bottom tab;
   footer column is a `<nav aria-label>` with a heading like the other footer columns; current page gets
   `aria-current="page"`.

Before merge the accessibility lead runs the specialists (ARIA, keyboard, forms, contrast, live regions) on the built
components and the state audit covers geometry (focus ring, targets, overlap) in en/hi × light/dark × 320–1440 px.
