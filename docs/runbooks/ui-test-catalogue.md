# MechDost test catalogue: states, world states, routes, flows, permutations

Written 2026-11-14 from a read of the code (no browser run). Scope: `apps/web` in demo mode (`NEXT_PUBLIC_DATA_MODE`
unset, demo sign-in), which is what `e2e/*.spec.ts` runs against `next start --port 3100`.

How to read it:

- **Section 1** lists every dimension that changes what a page shows, with the exact storage key and value shape.
- **Section 2** maps the shared status codes to what the demo store can and cannot represent.
- **Section 3** is the curated list of world states (seeds).
- **Section 4** lists every route, per role: the states that change it, its controls, and the cross-role effect.
- **Section 5** lists the cross-role flows with the check at each step.
- **Section 6** is the permutation strategy with test counts.
- **Section 7** lists the bug classes found on 2026-11-13/14 and the regression check for each.
- **Section 8** ranks the untested states by risk.

How sure each part is:

- **Traced to code:** every storage key and shape (section 1), the status mapping (section 2), and the controls of
  `order-view`, `request-view`, `shop-portal`, `workshop-portal`, `cart-view`, `checkout-form`, `account-area`,
  `admin-console` (orders, services, quotes, reviews), `admin-support`, `admin-partners`, `admin-customers`,
  `shop-prices`, `agreement-cards`, `quote-thread`, `support-section`, the header and the guards.
- **Inferred from the store functions and the existing test titles, not from the component:** the controls of
  `admin-applications`, `admin-invites`, `admin-coins`, `admin-site`, `admin-notifications`, `admin-price-requests`,
  `login-flow` (steps traced, controls not), `shop-browser`, `product-card`, `compare-table`, `booking-form`,
  `quote-request-form`, the application forms, `local-reviews`, the workshop finder and map.
- Items marked **(unverified)** are guesses that need a look before a test relies on them.

The repo changed while this was written: commits `d0268e5`, `d395200`, `5e8ca6b`, `83c9223` (2026-11-14) added a
`busy` world to the matrix (`e2e/fixtures/demo-world.ts`), the runbook `docs/runbooks/ui-testing.md` and skill
lines. Sections 6.1 and 8 describe the matrix **after** those commits.

---

## 1. State dimensions

All keys are `localStorage` unless stated. Most arrays are read through a type guard that **drops invalid rows
silently** (`store.ts` `read()`), so every seeded test must assert "rows seeded = rows shown". The support store is
the exception: it checks only that `tickets` is an array, so a partial ticket is kept and can break the page.

### 1.1 Environment (not stored state)

| Dimension                | Values                                                                                   | Set by                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locale                   | `en` (no prefix), `hi` (`/hi/...`)                                                       | URL prefix, then cookie `NEXT_LOCALE`, then browser language (`src/i18n/routing.ts`, `src/proxy.ts`)                                                                                                                                            |
| Language cookie          | absent, `en`, `hi`                                                                       | Set on document requests and by the header switcher (`components/site/language-switcher.tsx`, `lib/locale-path.ts`). A `hi` cookie redirects unprefixed URLs to `/hi`                                                                           |
| Theme                    | no saved choice (follows system), `light`, `dark`                                        | `mechdost-theme` = `'light'` or `'dark'` (plain string). Pre-paint script `THEME_INIT_SCRIPT` in `lib/theme.ts`                                                                                                                                 |
| System colour scheme     | `light`, `dark`                                                                          | Playwright `colorScheme`. Set it opposite to the saved theme so a lost choice shows                                                                                                                                                             |
| Viewport                 | 320, 360, 390, 414, 430, 480, 540, 600, 760 (`tab`), 768, 1024 (`nav`), 1280, 1440, 1920 | Playwright projects: `desktop` 1440x900, `mobile` Pixel 7 390x844. **No tablet project exists.** Breakpoints: `--breakpoint-tab: 760px`, `--breakpoint-nav: 1024px` (`packages/ui/src/tokens.css`); the header also uses 440px and `sm` (640px) |
| Reduced motion           | `no-preference`, `reduce`                                                                | Playwright `reducedMotion`                                                                                                                                                                                                                      |
| Data mode                | `demo`, `api`                                                                            | `NEXT_PUBLIC_DATA_MODE` (`lib/data-mode.ts`); build-time                                                                                                                                                                                        |
| Auth mode                | `demo`, `firebase`                                                                       | `NEXT_PUBLIC_AUTH_MODE`; build-time. `real-auth.spec.ts` covers `firebase`                                                                                                                                                                      |
| Online payment available | no (demo), yes (API mode, signed in, verified)                                           | `checkout-form.tsx` `onlineAvailable`. Demo orders are always `payment: 'cod'`                                                                                                                                                                  |
| Clock                    | now, just before or after a deadline                                                     | `page.clock.install({ time })`                                                                                                                                                                                                                  |
| Storage                  | works, blocked or full                                                                   | Every store's `write()` returns `false`; UI must say so (`AddResult 'save_failed'`)                                                                                                                                                             |
| Network                  | own server only, API down                                                                | `page.route` abort of non-localhost (state matrix); `E2E_API_DOWN=1` for API mode                                                                                                                                                               |

### 1.2 Identity

| Dimension                              | Values                                                                                                                                                                                                                                                                  | Key and shape                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session                                | signed out, customer, shop, shop 2, workshop, admin, new sign-up                                                                                                                                                                                                        | `mechdost-demo-session` = `[{ "accountId": "demo-customer", "signedInAt": "<ISO>" }]`; signed out = `[]` or absent                                                                                                                                                                                   |
| Accounts                               | 5 seeded, plus edits and sign-ups on this device                                                                                                                                                                                                                        | `mechdost-demo-accounts` = `DemoAccount[]`; merged over `SEEDED_ACCOUNTS` by `id` (`session-state.ts`)                                                                                                                                                                                               |
| Seeded logins (password `Raipur@2026`) | `demo-customer` 9876543210 (Ravi Sahu, 2 vehicles, 1 address) · `demo-shop` 9000000001 (`sharma-auto-parts`) · `demo-shop-2` 9000000004 (`raipur-battery-point`) · `demo-workshop` 9000000002 (`telibandha-car-clinic`) · `demo-admin` 9000000003 (needs code `123456`) | `SEEDED_ACCOUNTS`                                                                                                                                                                                                                                                                                    |
| Vehicles saved                         | 0, 1, 2 (seed), max (`MAX_ACCOUNT_ITEMS`)                                                                                                                                                                                                                               | `DemoAccount.vehicles[]` in `mechdost-demo-accounts`                                                                                                                                                                                                                                                 |
| Addresses saved                        | 0, 1 default (seed), several, max, none default                                                                                                                                                                                                                         | `DemoAccount.addresses[]`                                                                                                                                                                                                                                                                            |
| Profile language                       | `en`, `hi`                                                                                                                                                                                                                                                              | `DemoAccount.language` (`updateProfile`)                                                                                                                                                                                                                                                             |
| Login lock                             | none, 1-4 failures, locked 15 min                                                                                                                                                                                                                                       | `mechdost-demo-login-failures` (shape in `demo/passwords.ts`, **unverified**)                                                                                                                                                                                                                        |
| Password reset link                    | none, valid, used or expired                                                                                                                                                                                                                                            | `mechdost-demo-reset-links` (**shape unverified**)                                                                                                                                                                                                                                                   |
| Customer block                         | none, `cod_only`, `orders`, `full`; each permanent or with `endsAt`; lifted                                                                                                                                                                                             | `mechdost-demo-customer-blocks` = `DemoCustomerBlock[]` `{id, accountId, level, reasonCode, note, endsAt, by, at, liftedAt, liftedBy, liftedReason}`. Effects (`blockEffects`): `full` = no session at all; `orders` = no order; `cod_only` = no cash on delivery, which in demo mode means no order |

Direct-seed sign-in: writing the session key through `addInitScript` skips the login form and the staff code, so a
matrix can open any role in one step. Keep the UI sign-in in the flow tests only.

### 1.3 Shopping state

| Dimension         | Values                                                                                                                                                                                                  | Key and shape                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cart              | empty · 1 line qty 1 · 1 line qty 99 (`MAX_QTY`) · 20 lines (`MAX_LINES`) · below free delivery (< Rs 999) · above it · unknown slug in a line · `low_stock` or `on_request` product                    | `mechdost-cart` = `[{ "slug": "...", "qty": 1 }]`. Rows with qty outside 1-99 are dropped                                                                                                                                                                                                                 |
| Out-of-stock line | **Not representable in demo.** `Availability` is `in_stock`, `low_stock`, `on_request` only. Test in API mode or at unit level                                                                          | `demo/catalogue.ts`                                                                                                                                                                                                                                                                                       |
| Compare list      | empty · 1 · 2 · 4 (`COMPARE_MAX`) · **other category than the page (tray active with another category: every other-category card, and the tray question open)** · full + a fifth pressed · invalid JSON | `mechdost-compare` = `{ "category": "lubricants", "slugs": ["a","b"], "name": "Lubricants", "lang": "en" }` (name/lang optional, 2026-11-14); removed when empty. Change event `mechdost-compare-change` (`detail: 'prompt'` when the tray must ask). `/compare` reads `?p=a,b` from the URL, not storage |
| Consent           | never asked (banner open) · declined · accepted · stale version (asks again)                                                                                                                            | `mechdost-consent` = `{ "analytics": false, "version": "2026-11", "at": "<ISO>" }` (`lib/consent.ts`, `CONSENT_VERSION`)                                                                                                                                                                                  |
| Visitor id        | absent, present                                                                                                                                                                                         | `mechdost-visitor` (local and session storage); only after consent                                                                                                                                                                                                                                        |
| Demo event log    | any                                                                                                                                                                                                     | `mechdost-demo-events` (`lib/analytics.ts`, `demoEventLog()`): use it to assert that a control fired its event (hard rule 9)                                                                                                                                                                              |
| Map mode          | admin default, viewer choice                                                                                                                                                                            | `mechdost-map-mode`; admin default in `mechdost-demo-site.layout.mapDefault`                                                                                                                                                                                                                              |
| Chosen PIN        | none, covered `4920xx`, uncovered, GPS-derived                                                                                                                                                          | **Not stored.** Component state in `workshop-finder.tsx` (and form fields in checkout and quotes). There is no site-wide "my PIN" yet                                                                                                                                                                     |

### 1.4 Transactions

| Dimension        | Key                         | Shape and notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders           | `mechdost-demo-orders`      | `DemoOrder[]` (see `seedData()` in `e2e/fixtures/demo-world.ts`). Status is derived, see section 2. **Not account-scoped**: `/account/orders` and `/orders/[code]` show every order in this browser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Self-cancel      | on the order                | `selfCancel: true` is copied at placement. Seed it on the order; the rules key only affects new orders                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Order rules      | `mechdost-demo-order-rules` | `{ "customerSelfCancel": false }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Service requests | `mechdost-demo-requests`    | `DemoServiceRequest[]`, `stage` 0-5 = `REQUEST_STAGES`, plus `proposal`, `declinedBy[]`, `cancellation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Quotes           | `mechdost-demo-quotes`      | `DemoQuote[]`, `status`: `open`, `offered`, `accepted`, `declined`; `offers[].validUntil` gives "expired"; `orderCode` after acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Support tickets  | `mechdost-demo-support`     | **Object, not array:** `{ "tickets": DemoTicket[] }`. A **missing key yields one seeded WhatsApp ticket** (`REQ-RPR-2026-WA7K2Q`, `open`, `accountId: null`). "No tickets" = `{ "tickets": [] }`. Status: `open`, `in_review`, `awaiting_customer`, `resolved`, `closed`. SLA (`slaState`): `ok`, `ack_overdue` (48 h), `resolve_overdue` (30 days). Daily limit 5 per account. A complete ticket literal: `supportTicket()` in `e2e/fixtures/demo-world.ts`. **Fixture bug (read from code, not run):** `busyWorld()` writes `[supportTicket(now)]` (an array) under this key; the store then finds no `tickets` field and falls back to the WhatsApp seed, so the busy world has **no customer ticket**. It must be `{ tickets: [supportTicket(now)] }` |
| Coins            | `mechdost-demo-coins`       | `CoinEntry[]` `{id, accountId, delta, kind, reason, orderCode, by, at}`. **A 250-coin seed for `demo-customer` is always merged in**: zero balance = one entry with `delta: -250`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Reviews          | `mechdost-demo-reviews`     | `DemoReview[]`, `status`: `pending`, `approved`, `hidden`; `target`: `product`, `workshop`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### 1.5 Partners

| Dimension             | Key                                   | Shape and notes                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Applications          | `mechdost-demo-applications`          | `DemoApplication[]`; `kind`: `seller`, `garage`, `mechanic`; `stage` 0-3 = `received`, `review`, `verification`, `onboarded`; `rejected`, `rejectReason`; `source`: `public`, `invite`; `coverage` set at approval; duplicate GSTIN warning (`applicationsWithSameGstin`) |
| Invites               | `mechdost-demo-invites`               | `DemoInvite[]` `{token, name, email, phone, createdAt, expiresAt, status}`; `sent`, `used`, `revoked`; `expired` is derived from `expiresAt` (7 days)                                                                                                                     |
| Partner standing      | `mechdost-demo-partner-status`        | **Append-only** `StatusChange[]` `{kind, slug, status, reason, by, at}`; the **latest** row per partner wins. `active`, `paused`, `suspended`. `takesNewWork` = active only; `visibleToCustomers` = not suspended                                                         |
| Price requests        | `mechdost-demo-price-requests`        | `DemoPriceRequest[]` `{id, shopSlug, productSlug, pricePaise, mrpPaise, status, reason, createdAt, decidedAt}`; `pending`, `approved`, `rejected`, `withdrawn`, `superseded`                                                                                              |
| Shop listings         | `mechdost-demo-shop-listings`         | `Listing[]` `{shopSlug, productSlug, livePaise, blocked, rejected}` giving `ListingState`: `none`, `pending`, `on_sale` (with or without a pending change), `rejected`, `blocked`                                                                                         |
| Agreement versions    | `mechdost-demo-agreements`            | `DemoAgreement[]` `{version, textEn, textHi, publishedAt}`                                                                                                                                                                                                                |
| Agreement acceptances | `mechdost-demo-agreement-acceptances` | `[{shopSlug, version, acceptedAt}]` giving `none`, `to_accept`, `accepted`; a newer published version makes an open tab stale                                                                                                                                             |

### 1.6 Admin configuration

| Dimension             | Key                           | Shape and notes                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Site config           | `mechdost-demo-site`          | `SiteConfig` object: `versions{content,layout,categories,settings}`, `content{key:{en,hi}}`, `layout{order[],hidden[],mapDefault}`, `featured[]` (3-6) or `null`, `emoji{}`, `settings{acceptMinutes 5-120, bulkMinUnits 2-500, deliveryFeePaise, freeDeliveryFromPaise, coinValuePaise, coinMaxRedeemBp}`, `audit[]`. Applied before paint by `SITE_LAYOUT_SCRIPT` into `<style id="md-site-layout">` |
| Notification settings | `mechdost-demo-notifications` | `NotifyConfig` `{events{key:{enabled, body{en,hi}, version}}, budgetPaise, budgetVersion, history[]}`                                                                                                                                                                                                                                                                                                  |

---

## 2. Shared status codes against the demo store

Shared machines live in `packages/shared/src/state/index.ts`. The demo store uses a numeric `stage` plus side fields.
`routingState(order, now)` derives the admin view.

### 2.1 Orders (`ORDER_STATES`)

| Shared code                                                      | Demo seed                                                                                                                                                                                                    | UI label source                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `placed` (waiting for the admin to route)                        | `stage: 1`, no `shop`, no `declined` (what `placeDemoOrder` writes; demo `stage: 0` is never used); `routingState` gives `needs_routing`                                                                     | admin queue "needs"                             |
| `awaiting_shop`                                                  | `stage: 1`, `shop: {slug, status: 'offered', offeredAt, expiresAt: future}`                                                                                                                                  | admin "awaiting"; shop "offered"                |
| offer timed out (`assignment` `expired`)                         | same with `expiresAt` in the past gives `routingState` `expired`                                                                                                                                             | admin "needs" queue                             |
| `needs_rerouting` (after a decline)                              | `stage: 1`, `shop: null`, `declined: [{slug, reason, at}]`; `reason` from `ASSIGNMENT_DECLINE_REASONS` (`out_of_stock`, `too_far`, `shop_closed`, `too_busy`, `price_mismatch`, `other`) or a timeout marker | admin "needs" with history                      |
| `confirmed`                                                      | `stage: 2`, `shop.status: 'accepted'`                                                                                                                                                                        | customer timeline; shop "active"                |
| `packed`                                                         | `stage: 3`                                                                                                                                                                                                   | shop button "mark shipped"                      |
| `shipped` and `out_for_delivery`                                 | **One demo stage:** `stage: 4` with `delivery: {code, attempts, confirmedAt: null, method: null}`                                                                                                            | customer sees the 4-digit code                  |
| delivery code locked                                             | `stage: 4`, `delivery.attempts: 5`                                                                                                                                                                           | shop sees "locked"; admin override form         |
| `delivered` (code)                                               | `stage: 5`, `delivery.confirmedAt`, `method: 'code'`                                                                                                                                                         | "delivered with code"                           |
| `delivered` (override)                                           | `stage: 5`, `method: 'override'`, `overrideReason`, `overrideBy`                                                                                                                                             | "delivered by support"                          |
| `cancelled`                                                      | `cancellation: {by: 'customer' or 'staff', reasonCode, actor, at}`; `reasonCode` from `ORDER_CANCEL_REASONS`                                                                                                 | red panel, queue "cancelled"                    |
| `rejected`                                                       | `rejection: {message, at, reasonCode}`; `reasonCode` from `ORDER_REJECT_REASONS`                                                                                                                             | message to the customer, queue "rejected"       |
| refunded, `payment` states (`created` ... `refunded`, `expired`) | **Not representable in demo** (`payment: 'cod'` only). API, unit and webhook-chaos suites                                                                                                                    | -                                               |
| COD against online                                               | Demo: COD only. Online: API mode with Razorpay test keys (`checkout-form.tsx` `payOnline`)                                                                                                                   | -                                               |
| with coins                                                       | `coins: {accountId, coins, discountPaise}`                                                                                                                                                                   | coins line on the order; restored on reject     |
| business purchase                                                | `business: {gstin, businessName}`                                                                                                                                                                            | GST line; the shop sees it only after accepting |

Cancel rules: `customerMayCancel` = `selfCancel === true`, not closed, `stage <= 2`. `cancelViaSupport` = the same
window without `selfCancel` (link to `/account/support?order=CODE`). `staffMayCancel` = not closed, `stage <= 3`.

### 2.2 Service requests (`SERVICE_REQUEST_STATES`)

| Shared code                                                                                | Demo seed                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requested`, `awaiting_workshop`                                                           | `stage: 0`                                                                                                                                                       |
| `needs_routing`                                                                            | `stage: 0` and `declinedBy` includes `workshopSlug` (admin `/admin/services`)                                                                                    |
| `proposed`                                                                                 | `stage: 1` with `proposal {date, slot, minPaise, maxPaise, note}`                                                                                                |
| `confirmed`                                                                                | `stage: 2`                                                                                                                                                       |
| `vehicle_received`                                                                         | `stage: 3` (`received`)                                                                                                                                          |
| `in_progress`                                                                              | `stage: 4`                                                                                                                                                       |
| `ready`                                                                                    | `stage: 5`                                                                                                                                                       |
| `cancelled`                                                                                | `cancellation {reasonCode, at}`, only while `stage < 3`; `reasonCode` from `SERVICE_CANCEL_REASONS`                                                              |
| `estimate_sent`, `approved`, `no_work_approved`, `billed`, `paid`, `completed`, `rejected` | **Not representable in demo.** No estimate lines, bill, payment or odometer in `DemoServiceRequest`. Per-line approval is API and unit level until the UI exists |

### 2.3 Other machines

| Machine       | Codes                                                          | Demo                                                                                                                                     |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Ticket        | `open`, `in_review`, `awaiting_customer`, `resolved`, `closed` | Full, with `version` checks (`SupportError 'stale'`)                                                                                     |
| Application   | `new`, `in_review`, `approved`, `rejected`                     | `stage` 0-3 plus `rejected`; invited applications land at `onboarded`                                                                    |
| Invite        | `sent`, `used`, `expired`, `revoked`                           | Full (`expired` derived)                                                                                                                 |
| Price request | `pending`, `approved`, `rejected`, `withdrawn`, `superseded`   | Full                                                                                                                                     |
| Assignment    | `offered`, `accepted`, `declined`, `expired`, `withdrawn`      | `shop.status` `offered` or `accepted`; the rest through `declined[]` and the clock; `withdrawn` = cancel while offered sets `shop: null` |
| Product       | `draft`, `submitted`, `live`, `rejected`, `archived`           | Not in demo (API catalogue)                                                                                                              |
| Payment       | 7 codes                                                        | Not in demo                                                                                                                              |

---

## 3. World states

Each world is a seed object applied with `addInitScript` before the first navigation. `iso(n)` = now plus n minutes.
All worlds also set `mechdost-consent` (decided) unless they test consent. Codes use Crockford base32 (no I, L, O, U).

Base records: reuse `seedData()` and `supportTicket()` from `e2e/fixtures/demo-world.ts` (orders, requests, quote,
application, review, cart) and add the named worlds beside `busyWorld()` in the same file.

### Guest

| Id                                | Seed                                                                                                                          | Why it matters                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| G0 First visit                    | nothing stored, no consent                                                                                                    | Consent banner (fixed) over the tab bar and assistant button; theme follows system; header "Sign in"                                   |
| G1 Guest with cart and compare    | `mechdost-cart` 2 lines, `mechdost-compare` 2 slugs                                                                           | Cart pill count, compare tray on `/shop*`, checkout as guest, "Sign in" prompts                                                        |
| G2 Guest at the limits            | cart 20 lines one at qty 99, compare 4                                                                                        | `max_lines`, `max_qty`, `full` messages; tray width at 320-390 px; long cart page; delivery fee flips to free                          |
| G3 Guest returning with history   | orders, requests, quotes in storage but session `[]`                                                                          | `/orders/[code]`, `/service/[code]`, `/quotes/[code]` open without sign-in in demo; the account area must show the guard, not the data |
| G4 Stale consent and admin layout | consent `version: '2025-01'`; `mechdost-demo-site` with 3 hidden sections, reordered, featured 3, content overrides en and hi | Banner returns; home order and hidden sections applied before paint in both languages; no flash                                        |

### Customer (`demo-customer`)

| Id                                              | Seed                                                                                                               | Why it matters                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| C0 New customer, nothing                        | session only; accounts entry with `vehicles: []`, `addresses: []`; coins `[{delta:-250}]`; support `{tickets: []}` | Every account section's empty state with one next action; checkout with no saved address; quote accept blocked by "add an address" |
| C1 Ongoing order only                           | one order `stage: 2` accepted                                                                                      | Account overview, order timeline, "cancel via support" link, cart pill 0                                                           |
| C2 Open ticket only                             | support with one `open` ticket for the account, tied to no order                                                   | Support list, reply box, the account overview tile                                                                                 |
| C3 Cart only                                    | cart 2 lines                                                                                                       | Checkout prefill from the saved address; coins offer                                                                               |
| C4 Order and ticket                             | C1 plus a ticket with `orderCode` = that order, `awaiting_customer`                                                | Order page "report a problem" preset; ticket thread; a reply moves it to `in_review`                                               |
| C5 Order, ticket and cart (the owner's example) | C4 plus cart 2 lines plus compare 2                                                                                | Every header and tab bar element at once; tray, assistant and tab bar stacking; checkout while another order is open               |
| C6 Everything at once                           | C5 plus request `stage: 1` (proposal) plus quote `offered` plus a pending review plus coins 250                    | Longest account overview; all "needs you" prompts together; Hindi length at 390 px                                                 |
| C7 Order out for delivery                       | order `stage: 4` with `delivery.code`                                                                              | Code panel, safety text; no cancel; the shop side needs the code                                                                   |
| C8 Order rejected, coins restored               | order with `rejection` and `coins`; coins entries `redeem` then `restore`                                          | Rejection message, coin ledger, balance back to the old value                                                                      |
| C9 Order cancelled by staff / by customer       | two orders with `cancellation.by` `staff` and `customer`                                                           | Cancelled panel wording per actor and reason code in both languages                                                                |
| C10 Self-cancel allowed                         | order `stage: 1` or `2` with `selfCancel: true`                                                                    | Inline cancel disclosure, focus on open and close (T42)                                                                            |
| C11 Many orders                                 | 12 orders across every row of section 2.1, plus 51 to cross the `slice(0, 50)` cap                                 | Long lists, no inner scroll box, counts on the overview equal the list                                                             |
| C12 Proposal waiting                            | request `stage: 1` with proposal                                                                                   | Accept button; cancel still offered; the workshop "waiting" list                                                                   |
| C13 Vehicle at the workshop                     | request `stage: 3`                                                                                                 | No cancel (`requestCancellable` false); timeline                                                                                   |
| C14 Quote offered, expiring                     | quote `offered`, `validUntil: iso(+2)`; then `page.clock` past it                                                  | Accept turns into "expired"; no order created                                                                                      |
| C15 Quote accepted                              | quote `accepted` with `orderCode` plus that order                                                                  | "View order" link; chat closed                                                                                                     |
| C16 Block `cod_only` or `orders`                | block row in force; cart 2 lines; quote `offered`                                                                  | Checkout refused with the right note (`blockedCod` or `blockedOrders`); quote accept refused; cart kept                            |
| C17 Block `full`                                | block row `full`                                                                                                   | Session reads as signed out everywhere; sign-in refused; header shows "Sign in"                                                    |
| C18 Block that ends                             | block with `endsAt: iso(+1)`, then clock forward                                                                   | Ordering comes back without a reload trap                                                                                          |
| C19 Ticket limit reached                        | 5 tickets created today                                                                                            | Sixth is refused with the `limit` message                                                                                          |
| C20 Tickets in every status                     | 5 tickets, one per status, one `ack_overdue`                                                                       | Reply box hidden only on `closed`; a reply to `resolved` reopens                                                                   |

### Shop (`demo-shop`, slug `sharma-auto-parts`)

| Id                                       | Seed                                                                                                     | Why it matters                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| S0 Empty portal                          | session only                                                                                             | Both empty states; prices list; no agreement card                          |
| S1 Offer just arrived                    | order `awaiting_shop`, `expiresAt: iso(+15)`                                                             | Accept or decline with a reason; GSTIN hidden until accepted               |
| S2 Offer about to time out               | `expiresAt: iso(+1)`, then clock past it                                                                 | Minutes counter; the card leaves the shop; admin sees `expired` in "needs" |
| S3 Active orders at each step            | orders at `stage` 2, 3, 4                                                                                | Buttons "mark packed", "mark shipped", then the delivery code form         |
| S4 Delivery code locked                  | `stage: 4`, `delivery.attempts: 5`                                                                       | Locked text, no form; admin override is the only way                       |
| S5 Paused with work in hand              | partner-status row `paused` plus S3 orders                                                               | Banner with the reason; existing orders still workable; no new offers      |
| S6 Suspended                             | partner-status row `suspended`                                                                           | Portal locked, call-support link; the customer side hides the shop         |
| S7 Prices in every listing state         | listings and requests giving `none`, `pending`, `on_sale`, `on_sale` with pending, `rejected`, `blocked` | Each row's form and message; a blocked row has no form                     |
| S8 Agreement to accept, then outdated    | agreements `[v1]`, no acceptance; then publish v2 from another context                                   | Accept needs the tick; a stale version says "outdated"                     |
| S9 Order cancelled by staff after packed | order `stage: 3` with `cancellation.by: 'staff'`                                                         | The shop stops seeing it                                                   |
| S10 Other shop's orders present          | orders for `raipur-battery-point` only                                                                   | `demo-shop` sees none (role and tenant leak)                               |

### Workshop (`demo-workshop`, slug `telibandha-car-clinic`)

| Id                          | Seed                                                                 | Why it matters                                                                             |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| W0 Empty portal             | session only                                                         | Three empty states                                                                         |
| W1 New request              | request `stage: 0`                                                   | Proposal form (date, slot, min, max, note) and decline                                     |
| W2 Waiting for the customer | request `stage: 1`                                                   | "Waiting" list, no actions                                                                 |
| W3 Jobs at each step        | requests `stage` 2, 3, 4                                             | "Mark received", "mark working", "mark ready"                                              |
| W4 Declined and cancelled   | request with `declinedBy` this workshop; another with `cancellation` | Neither is listed                                                                          |
| W5 Paused or suspended      | partner-status `paused`, then `suspended`                            | Banner or lock; `/workshops` shows "not taking bookings" or hides it; booking form refuses |

### Admin (`demo-admin`)

| Id                                    | Seed                                                                                                                                                                                                                           | Why it matters                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| A0 Empty console                      | session only, support `{tickets: []}`                                                                                                                                                                                          | Every section's empty state; overview tiles all zero                       |
| A1 Busy morning (the owner's example) | orders: 2 need routing (one after a decline, one timed out), 1 awaiting shop; request with `declinedBy`; 3 pending price requests; 2 pending reviews; 2 open tickets (one `ack_overdue`); quote `open`; application `stage: 0` | Overview counts equal each queue; every queue has work; long page in Hindi |
| A2 Routing with no shop available     | order needs routing; every shop that stocks it `paused` or price-rejected (`shopsOffSale`)                                                                                                                                     | Suggestions list empty or disabled; reject is the next action              |
| A3 Delivery override needed           | order `stage: 4`, `attempts: 5`                                                                                                                                                                                                | Override form needs a reason of 5+ characters                              |
| A4 Cancel and reject windows          | orders at `stage` 1, 2, 3, 4                                                                                                                                                                                                   | Cancel offered up to packed only; reject only while routing                |
| A5 Two admins                         | same world in **two pages of one context** (contexts do not share `localStorage`); both edit settings, content, or the same ticket                                                                                             | Stale `version` is refused with a message, nothing is overwritten          |
| A6 Partners and invites               | invites `sent`, `used`, `revoked`, one past `expiresAt`; applications at each stage, one rejected, two with the same GSTIN; partner history rows                                                                               | Invite list states; duplicate-GSTIN warning; approval needs coverage       |
| A7 Customers                          | blocks: one of each level, one lifted, one expired                                                                                                                                                                             | Block list, lift with a reason, history kept                               |
| A8 Site customised                    | `mechdost-demo-site` with overrides in all four areas and 30 audit rows                                                                                                                                                        | Editors load saved values; reset per area; audit list length               |
| A9 Notifications                      | notify config with one event enabled with en and hi bodies, budget changed, history                                                                                                                                            | Editor, preview, placeholder checks, budget limits                         |

**Core set (24 worlds, the wide matrix):** G0, G1, G2, G4, C0, C1, C2, C3, C4, C5, C6, C7, C11, C16, S0, S1, S3,
S5, S7, W0, W1, W3, A0, A1. The other 29 are the **extended set** (nightly). Total 53: 5 guest, 21 customer, 11 shop,
6 workshop, 10 admin. Today's `empty`, `cart` and `busy` worlds are close to C0/G0, G1/C3 and C6 + S1 + W1 + A1.

---

## 4. Routes

Every route exists as `/<path>` (English) and `/hi/<path>`. Source: `apps/web/src/app/[locale]/**`.
Site chrome on every public and account page: header (brand link, nav links from 1024 px, language switcher, theme
toggle from 640 px, account link as an icon from 360 px and with text from 640 px, cart pill), footer (WhatsApp, call,
links, "Privacy choices"), mobile tab bar under 1024 px (fixed), assistant launcher (fixed), consent banner (fixed,
when undecided), compare tray (fixed, on `/shop*` when the list is not empty).

### 4.1 Chrome controls (check on every route, every world)

| Control                                       | Expected effect                                                                                                                                                                                        | States that change it          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Brand link                                    | Home in the same language                                                                                                                                                                              | locale                         |
| Nav links / tab bar items                     | Target page; current section marked; exactly one of nav or tab bar visible                                                                                                                             | viewport, locale               |
| Language switcher (`a[hreflang]`)             | Same path, query and hash in the other language; theme kept; cookie updated; switching back works                                                                                                      | locale, cookie, theme          |
| Theme toggle                                  | `html[data-theme]` flips, saved, survives navigation and language switch. In the header only from 640 px; under that the only toggle is in the footer (`footer.tsx`), so phone tests must use that one | theme, system scheme, viewport |
| Account link                                  | Signed out: `/login`. Signed in: `homeFor(role)` (`/account`, `/partner/shop`, `/partner/workshop`, `/admin`)                                                                                          | session, block `full`          |
| Cart pill                                     | `/cart`; count equals the sum stored in `mechdost-cart`                                                                                                                                                | cart                           |
| Assistant launcher and panel                  | Opens; answers; Escape closes; steps aside while the consent banner is open                                                                                                                            | consent, viewport              |
| Consent banner: accept, decline, privacy link | Saves the choice; banner gone; no event sent before a choice                                                                                                                                           | consent                        |
| Footer "Privacy choices"                      | Reopens the banner                                                                                                                                                                                     | consent                        |
| Compare tray: open, clear                     | `/compare?p=...`; clear removes the key and the tray                                                                                                                                                   | compare                        |
| Skip link                                     | First focus stop; moves focus to main                                                                                                                                                                  | -                              |

### 4.2 Public routes

| Route                                                                      | States that change it                                                                                                                                                                                       | Controls and expected effect                                                                                                                                                                                                                          | Cross-role effect                                                                                                                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` home                                                                   | site config (order, hidden, featured, emoji, content overrides), locale, theme, partner standing (top workshops) **(unverified)**, consent                                                                  | Hero search goes to `/shop?q=`; category tiles go to `/shop?category=`; product cards; service section to `/workshops`; FAQ disclosures; partner teaser to `/partners`                                                                                | Admin layout and content edits show here in both languages without a flash                                                                      |
| `/shop`                                                                    | query `q`, `category`, `vehicle`, `sort`; compare list; cart; price listings (`shopsOffSale`) **(unverified on this page)**; data mode                                                                      | Search, category chips, vehicle filter, sort; URL always matches the controls; card: add to cart (`added`, `max_qty`, `max_lines`, `save_failed`), compare toggle (`added`, `full`, `other_category`), quick details popover; "Load more" in API mode | Cart pill and tray update at once; a rejected shop price takes a product off sale                                                               |
| `/shop/[slug]`                                                             | product availability, cart qty of this product, compare list, reviews (`approved` only shown; own `pending`), locale                                                                                        | Add to cart, quantity, compare toggle, "ask for a bulk price" to `/quotes/new`, review form (rating, title, body), related cards                                                                                                                      | A new review appears in `/admin/reviews` as `pending`; approved shows here, hidden does not                                                     |
| `/compare?p=`                                                              | URL list (0, 1, 2-4, bad slug, other category, more than 4), viewport                                                                                                                                       | Remove a product (URL updates), "only differences" toggle, add to cart per column, back to shop                                                                                                                                                       | -                                                                                                                                               |
| `/cart`                                                                    | cart (empty, lines, limits, unknown slug), site settings (fee, free-from)                                                                                                                                   | Minus (disabled at 1), plus (disabled at 99), remove, "checkout", "continue shopping", "ask for a bulk price" (`/quotes/new?from=cart`); empty state with category links                                                                              | Pill count follows                                                                                                                              |
| `/checkout`                                                                | cart (empty redirects or shows the empty state **(unverified)**), session (prefill, coins), saved address, coins balance and rules, customer block, online availability, site settings                      | Name, phone, address, PIN (`4920xx` only), payment radio (online disabled in demo), business toggle with GSTIN and business name (other-state note), use coins, consent tick, "place order"; error summary; blocked note                              | Creates an order at `stage: 1`; admin "needs routing" count +1; coins ledger `redeem`; cart cleared                                             |
| `/orders/[code]`                                                           | order row of section 2.1, `?new=1` banner, `selfCancel`, locale                                                                                                                                             | Cancel disclosure (reason select, confirm, keep), "cancel through support" link, "report a problem" link (`/account/support?order=`), demo control "advance" (inside a `details`; **demo only, hide in production**), not-found link to shop          | Cancel: the admin queue "cancelled" gets it, the shop loses it. Advance: skips the real actors, so never use it in a cross-role test            |
| `/workshops`                                                               | PIN typed, GPS permission (granted, denied, never answers), partner standing (paused shows "not taking bookings", suspended hidden), map mode, viewport (map above or beside the list), locale (map labels) | PIN field, "use my location", list cards, map pins and popups (details, book, directions), "show all", map or satellite toggle, zoom                                                                                                                  | -                                                                                                                                               |
| `/workshops/[slug]`                                                        | partner standing, session (prefill, vehicles), reviews                                                                                                                                                      | Booking form: vehicle type, vehicle, services, date, slot, concern, name, phone; review form                                                                                                                                                          | Creates a request at `stage: 0`; workshop portal "new requests" +1. A paused or suspended workshop refuses (`createDemoRequest` returns `null`) |
| `/service/[code]`                                                          | request row of section 2.2, `?new=1`, proposal                                                                                                                                                              | Accept proposal, cancel disclosure (reason), demo "advance", not-found link                                                                                                                                                                           | Accept: the workshop job list gets it. Cancel: the workshop stops seeing it                                                                     |
| `/quotes/new`                                                              | `?from=cart`, product preset, site setting `bulkMinUnits`, session                                                                                                                                          | Product lines and quantities, PIN, address, name, phone, message, send; below-minimum error                                                                                                                                                           | Creates a quote `open`; `/admin/quotes` +1                                                                                                      |
| `/quotes/[code]`                                                           | quote status, offer versions, `validUntil`, saved address, customer block                                                                                                                                   | Chat send, accept (needs an address of 10+ characters and a `4920xx` PIN; `stale`, `expired`, `blocked` messages), decline, "add address" link, "view order"; demo "reply" and "offer" buttons (**demo only**)                                        | Accept creates an order at `stage: 1` for admin routing                                                                                         |
| `/partners`                                                                | locale                                                                                                                                                                                                      | Three "apply" links (seller, garage, mechanic), application status lookup **(unverified)**                                                                                                                                                            | -                                                                                                                                               |
| `/partners/apply/[kind]` (`seller`, `garage`, `mechanic`)                  | kind, GPS permission, map                                                                                                                                                                                   | Seller form: contact, shop name, GST status and number (checksum), address, landmark, location picker (GPS, search, pin), product picker, submit. Garage and mechanic: simpler form (`application-form.tsx`). No nested forms (L83)                   | New application at `stage: 0` in `/admin/applications`                                                                                          |
| `/partners/applications/[code]`                                            | application stage 0-3, rejected with reason                                                                                                                                                                 | Status timeline only                                                                                                                                                                                                                                  | Follows the admin's approve or reject                                                                                                           |
| `/partners/invite/[token]`                                                 | invite `sent`, `used`, `revoked`, expired, unknown                                                                                                                                                          | Invited form with locked contacts, submit once                                                                                                                                                                                                        | Invite becomes `used`; the application lands at `onboarded`. The token never reaches analytics (`redactPath`)                                   |
| `/policies/company`, `/delivery`, `/privacy`, `/returns`, `/service-terms` | locale, content overrides **(unverified)**                                                                                                                                                                  | Links only                                                                                                                                                                                                                                            | -                                                                                                                                               |
| `/login`                                                                   | `?next=` (safe same-site only), reset link token, login failures, block `full`, session already present                                                                                                     | Steps: `signin`, `staff`, `signup-phone`, `signup-otp`, `signup-profile`, `signup-done`, `forgot`, `forgot-phone`, `forgot-otp`, `forgot-email`, `forgot-email-sent`, `reset-link`. Show or hide password, back links, resend                         | After sign-in each role lands on its home; `next` wins when safe                                                                                |
| `/[...rest]` and `not-found`                                               | locale                                                                                                                                                                                                      | Link home                                                                                                                                                                                                                                             | -                                                                                                                                               |
| `error.tsx`, `shop/error.tsx`, `shop/loading.tsx`                          | thrown error, slow load                                                                                                                                                                                     | Retry                                                                                                                                                                                                                                                 | -                                                                                                                                               |
| `/api/geo/pincode`, `/api/geo/search`                                      | query, rate limit                                                                                                                                                                                           | JSON only                                                                                                                                                                                                                                             | Used by the finder and the seller form                                                                                                          |

### 4.3 Customer account (`/account` and `/account/[section]`)

Guard: signed out shows "sign in to continue" with `next`; a partner or admin session shows a link to their own home.

| Section     | States that change it                                                        | Controls                                                                                                                                                   | Cross-role effect                                                                                        |
| ----------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `overview`  | orders, requests, quotes, vehicles, coins; all empty against all full        | Tiles to each section, "find a workshop", "shop", recent lists                                                                                             | -                                                                                                        |
| `orders`    | every order row; 0, 1, 50+                                                   | Row link to `/orders/[code]`; empty state to `/shop`                                                                                                       | -                                                                                                        |
| `services`  | every request row                                                            | Row link to `/service/[code]`; empty state to `/workshops`                                                                                                 | -                                                                                                        |
| `quotes`    | quote status                                                                 | Row link; empty state to `/quotes/new`                                                                                                                     | -                                                                                                        |
| `support`   | tickets by status, `?order=` preset, daily limit, orders list for the select | New request form (kind: `order_issue`, `refund`, `fitment`, `account`, `other`; order select; message up to 2000), per-ticket reply (hidden when `closed`) | New ticket in `/admin/support` as `open`; a reply moves `awaiting_customer` or `resolved` to `in_review` |
| `coins`     | balance 0, 250, after redeem, after restore, after an admin adjust           | Read-only ledger; policy text                                                                                                                              | Follows `/admin/coins` adjustments                                                                       |
| `vehicles`  | 0, 1, 2, max                                                                 | Add form (type, make, model, year, fuel, registration, odometer), edit, remove                                                                             | Booking form prefill                                                                                     |
| `addresses` | 0, 1, several, max, default                                                  | Add form, make default, remove                                                                                                                             | Checkout prefill; quote acceptance needs one                                                             |
| `profile`   | name, email, language; email verified (firebase mode)                        | Save, verify email, sign out                                                                                                                               | -                                                                                                        |

### 4.4 Shop portal (`/partner/shop`)

Guard: `PortalGuard role="shop"` keeps the URL and swaps the content (assert the guard heading, not a redirect, T21).
`PartnerGate`: `suspended` locks the portal; `paused` shows a banner.

| Block          | States                                             | Controls                                                                                               | Cross-role effect                                                                                           |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Stats line     | counts of offered and active                       | -                                                                                                      | Must equal the lists                                                                                        |
| Agreement card | `none` (hidden), `to_accept`, `accepted`, outdated | Tick plus "accept"                                                                                     | Published from `AdminAgreement` on `/admin/partners`; whether the admin sees who accepted is **unverified** |
| Offered orders | `awaiting_shop` not expired; minutes left          | Accept; decline with a reason select, confirm, back                                                    | Accept: customer timeline `confirmed`, admin queue "done". Decline: admin "needs" with the reason           |
| Active orders  | `stage` 2, 3, 4; not closed                        | "Mark packed", "mark shipped", delivery code form (4 digits; wrong shows attempts left; 5 wrong locks) | Customer timeline moves; at `stage: 4` the customer sees the code                                           |
| Prices         | listing state per product                          | New price field and send; a blocked row has no form                                                    | `/admin/partners` price requests +1; approval puts it on sale; a rejected change takes it off sale          |
| Sign out       | -                                                  | Clears the session                                                                                     | Header shows "Sign in"                                                                                      |

### 4.5 Workshop portal (`/partner/workshop`)

| Block                    | States                                                   | Controls                                                                                   | Cross-role effect                                                                       |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| New requests             | `stage: 0`, not declined by this workshop, not cancelled | Proposal form (date, slot, min cost, max cost at least min, note up to 300), send; decline | Proposal: the customer page shows it with "accept". Decline: `/admin/services` lists it |
| Waiting for the customer | `stage: 1`                                               | none                                                                                       | -                                                                                       |
| Jobs                     | `stage` 2-4                                              | "Mark received", "mark working", "mark ready"                                              | Customer timeline moves; cancel disappears at `stage: 3`                                |

### 4.6 Admin console (`/admin` and `/admin/[section]`)

Guard: `PortalGuard role="admin"`. Sign-in needs the password and the code.

| Section         | States                                                                                                        | Controls                                                                                                                                                                                                                                                                                           | Cross-role effect                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `overview`      | every count                                                                                                   | Tiles to each section                                                                                                                                                                                                                                                                              | Counts equal the queues                                                                                                                                                  |
| `orders`        | five queues from `routingState`: needs (`needs_routing`, `expired`), awaiting, confirmed, rejected, cancelled | Per order: ranked shop suggestions with one-click route (paused, suspended and off-sale shops never offered), view order, cancel with a reason (up to packed), reject with a reason code and a message of 10+ characters, delivery override with a reason of 5+ characters (out for delivery only) | Route: the shop gets an offer with a timer of `acceptMinutes`. Reject: the customer sees the message and coins come back. Override: customer sees "delivered by support" |
| `services`      | requests declined by their workshop                                                                           | Pick another workshop (paused and suspended excluded), reassign                                                                                                                                                                                                                                    | The new workshop sees it as new; the customer page shows the new name                                                                                                    |
| `quotes`        | `open`, `offered`, `accepted`, `declined`                                                                     | Open a quote, chat reply, offer form (unit prices, delivery, valid days, note; a stray "." is explained)                                                                                                                                                                                           | Customer sees offer version n; an older version cannot be accepted (`stale`)                                                                                             |
| `applications`  | stage 0-3, rejected, duplicate GSTIN, invited                                                                 | Move to review, approve with coverage (PIN codes, delivery charge, days), reject with a reason code                                                                                                                                                                                                | Applicant status page follows                                                                                                                                            |
| `partners`      | standing per partner, history, invites, price requests, agreement                                             | Pause, suspend, resume with a reason of 5-300 characters; create invite (name, email, phone), copy link, revoke; approve or reject each price with a reason; publish an agreement (en and hi text)                                                                                                 | Pause: no new offers or bookings, banner in the portal. Suspend: portal locked, hidden for customers. Publish: shops must accept again                                   |
| `customers`     | blocks in force, lifted, expired                                                                              | Block (level, reason code, until, note), lift with a reason, clear search **(unverified)**                                                                                                                                                                                                         | Checkout and quote acceptance refuse; `full` ends the session                                                                                                            |
| `reviews`       | `pending`, `approved`, `hidden`                                                                               | Approve, hide                                                                                                                                                                                                                                                                                      | Product and workshop pages follow                                                                                                                                        |
| `support`       | tickets by status and SLA, WhatsApp seed ticket                                                               | Filter **(unverified)**, open a ticket, reply, internal note toggle, resolve, reopen                                                                                                                                                                                                               | The customer sees public replies, never internal notes; status label follows                                                                                             |
| `coins`         | ledger, balances                                                                                              | Grant or remove with a reason; cannot go below zero                                                                                                                                                                                                                                                | `/account/coins` and checkout follow                                                                                                                                     |
| `content`       | overrides per key and language, version                                                                       | Edit, save, reset; a stale version is refused                                                                                                                                                                                                                                                      | Home and other pages show the text in the matching language                                                                                                              |
| `layout`        | order, hidden, featured, emoji, map default                                                                   | Move up or down, hide, pick 3-6 featured, emoji field, map default, reset                                                                                                                                                                                                                          | Home follows before paint; `/workshops` default view                                                                                                                     |
| `settings`      | six settings with limits, order rules                                                                         | Number fields (clamped), save, reset; "customers may cancel" switch                                                                                                                                                                                                                                | Shop timer, bulk minimum, delivery fee, coin value at checkout; self-cancel only on orders placed after the change                                                       |
| `notifications` | events on or off, bodies, budget, history                                                                     | Switch per event, body editor en and hi (placeholder and promo-wording checks), preview, budget field                                                                                                                                                                                              | Templates used by the outbox (API mode)                                                                                                                                  |

### 4.7 Role-leak grid (every protected route against every other role)

| Route               | guest | customer | shop             | workshop          | admin            |
| ------------------- | ----- | -------- | ---------------- | ----------------- | ---------------- |
| `/account/*`        | guard | own data | link to own home | link to own home  | link to own home |
| `/partner/shop`     | guard | guard    | own shop only    | guard             | guard            |
| `/partner/workshop` | guard | guard    | guard            | own workshop only | guard            |
| `/admin/*`          | guard | guard    | guard            | guard             | console          |

Known demo limits to keep in mind (real protection is in the API, hard rule 4): orders, requests and quotes are not
scoped to the account in the demo store, so two customers on one browser see each other's rows, and
`/orders/[code]` opens for anyone who has the code in this browser. Tickets **are** scoped (`accountId`).

---

## 5. Cross-role flows

Demo data and the session live in the same `localStorage`, and browser contexts do not share it. So a flow runs in
**one context**, switching role between steps: either through the UI (`signIn` / `signOut` helpers in
`e2e/roles.spec.ts`, as the existing flows do) or by rewriting `mechdost-demo-session` with `page.evaluate` and
reloading (faster; keep the UI sign-in for auth tests). "Another tab" cases (stale `version`, `storage` events) use a
second page of the same context. Use the real buttons, never the demo "advance" control. After each step check: the acting role's page, the other roles' pages, the overview counts, the
event in `mechdost-demo-events`, both languages for any new text.

### F1 Order, happy path

1. Customer: add to cart, checkout, place. Check: order page with `?new=1`, cart empty, pill 0, coins `redeem` if used.
2. Admin `/admin/orders`: order in "needs". Route to a shop. Check: queue "awaiting", timer = `acceptMinutes`.
3. Shop: offer shown without the GSTIN. Accept. Check: active list, GSTIN now shown, customer timeline `confirmed`.
4. Shop: mark packed, mark shipped. Check: customer sees the 4-digit code; shop sees the code form.
5. Shop: wrong code once (attempts left 4), then the right code. Check: `delivered`, "delivered with code", shop list empty, admin "done".

### F2 Order variants

| Variant                   | Steps                                                                         | Checks                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Decline and reroute       | Shop declines with each reason code; admin reroutes to shop 2 (`demo-shop-2`) | Decline history on the admin card; shop 1 no longer sees it; shop 2 does                     |
| Timeout                   | Offer with `expiresAt` near; clock past it                                    | Shop card gone; admin "needs" with a timeout marker; a late accept is refused                |
| Reject                    | Admin rejects with a code and a message                                       | Customer sees the message; coins restored once; no cancel controls                           |
| Customer cancel           | `selfCancel` on; cancel at `stage` 1 and 2                                    | Reason code stored; shop loses the offer; admin "cancelled"                                  |
| Cancel via support        | `selfCancel` off                                                              | Link opens support with the order preset; ticket in the admin inbox                          |
| Staff cancel after packed | Admin cancels at `stage: 3`                                                   | Shop stops seeing it; customer sees "cancelled by MechDost"                                  |
| Code locked               | 5 wrong codes                                                                 | Locked for the shop; admin override with a reason; "delivered by support"                    |
| Paused shop               | Pause the shop before routing                                                 | Not offered in suggestions; `routeOrder` refuses                                             |
| Business purchase         | GSTIN at checkout                                                             | Other-state note; GST line for the customer and staff; the shop sees it only after accepting |
| Blocked customer          | Block `orders` between cart and place                                         | Refused with the note; cart kept; lifting restores                                           |
| Settings change mid-flow  | Admin changes the fee or timer after the cart is filled                       | New orders use the new value; placed orders keep theirs                                      |

### F3 Service request

1. Customer: `/workshops`, PIN or GPS, pick a workshop, book. Check: request page `?new=1`; workshop "new" +1.
2. Workshop: propose a slot and a cost. Check: customer sees the proposal and "accept"; workshop "waiting".
3. Customer: accept. Check: workshop "jobs"; cancel still offered.
4. Workshop: mark received. Check: the customer cancel is gone.
5. Workshop: mark working, mark ready. Check: timeline; no further button.

Variants: workshop declines, admin reassigns (old workshop no longer sees it); customer cancels at stage 0, 1, 2
with each reason; paused workshop refuses new bookings; suspended workshop hidden and its portal locked.
**Not testable in the UI yet:** estimate per-line approval, bill, payment, review after completion, odometer. Cover
at API and unit level (`serviceRequestMachine`), and add UI tests in the change that builds those screens.

### F4 Seller onboarding

1. Applicant: `/partners/apply/seller` with GST, address, map pin, products. Check: status page `received`.
2. Admin: duplicate-GSTIN warning when it applies; approve with coverage, or reject with a reason. Check: status page.
3. Admin: create an invite; open the link. Check: contacts locked; submit once; second open says "used"; revoke and expiry states.
4. Admin: publish the agreement. Shop: accept. Admin: publish v2. Shop: must accept again; a stale tab says "outdated".
5. Shop: send a price. Admin: approve one, reject one with a reason. Check: listing `on_sale` or `rejected`; a rejected change takes it off sale; the shop is not suggested for that product.

### F5 Support ticket

Customer opens from the order page; admin replies (public and internal); status `open` to `in_review` to
`awaiting_customer`; customer reply returns it to `in_review`; resolve; a customer reply reopens; close hides the reply
box. Check: internal notes never reach the customer; stale `version` from a second admin tab is refused; sixth ticket
in a day refused; SLA labels after the clock moves 48 h and 30 days.

### F6 Bulk quote

Cart to `/quotes/new?from=cart`; below the minimum refused; admin chats and sends offer v1, then v2; customer tries
v1 (`stale`), waits past `validUntil` (`expired`), accepts v2 with a saved address; an order appears at `stage: 1` and
follows F1. Decline closes the chat. A blocked customer cannot accept.

### F7 Coins

Balance 250; use at checkout (COD only, capped by `coinMaxRedeemBp`); order rejected, coins restored once; admin
grants and removes with a reason; removal below zero refused; admin changes the coin value and the checkout follows.

### F8 Partner pause and suspend

Pause the shop: banner, no offers, existing orders finish. Suspend the workshop: hidden on `/workshops`, direct URL
refuses booking, portal locked. Resume: back to normal. The history keeps every change.

### F9 Customer block

Each level at each point: before sign-in, with a filled cart, with an offered quote, while signed in on another tab
(`storage` event). `full` ends the session on the next render.

### F10 Preferences across navigation

Saved theme and language through: direct visit, header switch both ways, sign-in redirect, sign-out, `next`
redirect, 404, error page, another tab.

---

## 6. Permutation strategy

### 6.1 What exists today (`e2e/state-matrix.spec.ts` after commit `d395200`)

Worlds: `empty`, `cart` (cart + compare), `busy` (`busyWorld()`: cart, compare, 3 orders, 3 requests, 1 quote, 1
application, 1 review, 1 ticket).

| Loop                                                 | Tests                | Page checks                                                                                            |
| ---------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| auth (2) x theme (2) x locale (2) x world (3)        | 24 x 2 projects = 48 | guest 12 x 11 + customer 12 x 15 + busy customer 4 x 6 = 336, x 2 = 672, plus 3 language switches each |
| portal role (3) x theme (2) x locale (2) x world (2) | 24 x 2 = 48          | (1 + 1 + 5) x 8 x 2 = 112                                                                              |
| width sweep (11 widths, desktop project, busy world) | 11                   | 11 x 14 = 154                                                                                          |
| **Total**                                            | **107**              | **about 940**                                                                                          |

Gaps that remain:

- One transaction world. No world for closed states (cancelled, rejected, delivered), limits, blocks, partner
  standing, customised site, invites, price requests, agreements, coins at zero.
- The busy world's ticket is seeded in the wrong shape (section 1.4), so the ticket dimension is not rendered.
- No must-show assertion: a dropped seed leaves an empty page that passes every check.
- Admin covers 5 of 14 sections; account covers 7 of 9 (no `coins`, `addresses`).
- The width sweep is signed out and light only; the header is longest signed in. No width between 430 and 480, or
  480 and 540, although the header fix was checked by hand for 320-700.
- No tablet project (760-1023 px is reached only by the sweep at 768).
- No `/workshops/[slug]`, `/partners/apply/*`, `/partners/applications/*`, `/partners/invite/*`, `/quotes/new`.
- Render-only: no control is clicked except the language switch.

### 6.2 Tiers

| Tier                                      | What                                                                                                                                                                                                                                                | Dimensions                      | Count                                                                                                                  | When                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| T1 Render matrix, full permutations       | Core 24 worlds x theme (2) x locale (2) x viewport (390, 768, 1440), every route that role can open                                                                                                                                                 | world, theme, locale, viewport  | 24 x 12 = **288 tests**, about 15 routes each = about 4,300 page checks                                                | Every PR that touches UI (4 workers, about 25-35 min **estimate**) |
| T2 Render matrix, remaining worlds        | Other 29 worlds x pairwise of theme, locale, viewport (6 rows cover every pair of 2 x 2 x 3)                                                                                                                                                        | world full, the rest pairwise   | 29 x 6 = **174 tests**, about 2,600 page checks                                                                        | Nightly                                                            |
| T3 Pairwise across independent dimensions | role (5) x cart (4) x compare (4) x order bucket (6: none, routing, active, out for delivery, closed, many) x ticket (4: none, open, awaiting customer, closed) x consent (3) x block (4) x site config (2) x theme (2) x locale (2) x viewport (3) | all pairs                       | Lower bound 6 x 5 = 30 rows; expect **36-45 rows** from a greedy generator                                             | Every PR                                                           |
| T4 Width sweep                            | 11 widths x (guest G1, customer C6, admin A1) x (en light, hi dark)                                                                                                                                                                                 | width full                      | 11 x 3 x 2 = **66 tests**                                                                                              | Every PR that touches layout or CSS                                |
| T5 Control tests                          | Every control of section 4 once in its base state, plus once per state that changes it                                                                                                                                                              | control x state                 | about 230 controls, about 420 cases **(estimate)**; run in en, desktop, light, and a 1-in-4 sample in hi, mobile, dark | Per feature; all nightly                                           |
| T6 Cross-role flows                       | F1-F10 with variants                                                                                                                                                                                                                                | flow x project                  | about 45 flows x 2 projects = **90 tests**; F1, F3, F5 also in Hindi                                                   | Every PR                                                           |
| T7 Clock and concurrency                  | Offer expiry, invite expiry, quote validity, block end, ticket SLA; two tabs editing the same row                                                                                                                                                   | deadline x side of the boundary | about 20 tests                                                                                                         | Every PR that touches those stores                                 |

Full permutations are kept for the four cheap, high-yield dimensions (world, theme, locale, viewport) because every
bug found on 2026-11-13/14 lived in one of their intersections. Everything else goes pairwise, since the stores are
independent keys and most defects need at most two of them to line up.

Rules that keep the pairwise set honest:

- Exclude impossible rows (guest with a block, shop with a cart-only world) in the generator, not by skipping tests.
- Three-way combinations named by the owner are world states (C5, C6), so they are always covered in T1.
- Any bug found in a combination becomes a named world, never just a fix.

### 6.3 How to run it with the existing pattern

1. `e2e/fixtures/demo-world.ts`: export `WORLDS: Record<string, { role: Role; seed: (now: number) => Record<string, unknown>; routes: string[]; mustShow: Record<string, string | RegExp> }>`. Build each seed from the existing helpers.
2. `seedWorld(page, world, { theme })`: one `addInitScript` that seeds **once per context**, guarded by a sentinel key (`if (localStorage.getItem('e2e-seeded')) return;` then write every key and the sentinel). The current per-key "only if absent" guard brings back a key the app removed (the compare store calls `removeItem` when the list empties), so a "clear the tray" test would see the list return on the next navigation. It also writes `mechdost-demo-session` for the role.
3. Keep `watchErrors`, `layoutFacts`, `checkPage`, `switchLanguage` and add to `checkPage`:
   - **must-show:** the world's marker text or count is visible on the route (a type guard may have dropped the seed, and a page that shows an empty state passes every layout check, T29);
   - **counts consistent:** cart pill = sum of `mechdost-cart`; admin overview tiles = queue lengths; shop stats = list lengths; account overview = list lengths;
   - **no inner scroll boxes:** no element other than the map, chat thread and code blocks has `scrollHeight > clientHeight + 1` with `overflow-y: auto|scroll`, and none scrolls sideways;
   - **fixed elements do not overlap** each other (pairwise rectangle intersection of visible `position: fixed` nodes);
   - **console errors**, not only `pageerror` (hydration and `MISSING_MESSAGE` arrive on `console`);
   - **failed requests** to our own server (already there).
4. Add a `tablet` project (768 x 1024) to `playwright.config.ts`, or set the viewport per test as the sweep does.
5. Freeze time with `page.clock.install({ time })` for worlds with deadlines; seed every timestamp from that `now`.
6. Build first (`pnpm --filter @mechdost/web exec next build`, T41); write the run to a log and read the exit code (T16).
7. Env switches: `MATRIX_SHOTS=<dir>` (screenshots), `MATRIX_TIMEOUT`, and a new `MATRIX_WORLDS=core|all|<ids>` and `MATRIX_TIER`.
8. Screenshots of fixed and sticky UI are taken as viewport shots after scrolling, not full-page (T15).

---

## 7. Bug classes found on 2026-11-13/14 and their regression checks

| #   | Bug class                                                                           | Root cause                                                                                                                                                                                                                                                      | Regression check                                                                                                                                                                                                                                                                         | Status                                                            |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Fixed element inside a transformed ancestor (compare tray rendered at the page end) | An entrance animation with `animation-fill-mode: both` leaves `transform` on a wrapper, which becomes the containing block for `position: fixed`                                                                                                                | `layoutFacts`: after scrolling, every visible fixed element's box is inside the viewport. Add: a static test that greps for `both` or `forwards` fill and `transform`, `filter`, `contain`, `will-change` on ancestors of the tray, tab bar, assistant and banner                        | Runtime check exists; static check missing                        |
| 2   | React clears `<html>` attributes when the per-locale root layout changes            | Client-side language switch rebuilds `<html>`; `data-theme` set outside React was lost                                                                                                                                                                          | `switchLanguage`: click the switcher both ways and assert `data-theme`; unit-level: remove the attribute and expect the `MutationObserver` to restore it (exists in `demo-flows.spec.ts`). Extend to every attribute set outside React (`data-consent-open`, the `md-site-layout` style) | Theme covered; other attributes not                               |
| 3   | Language cookie only synced on document requests                                    | A client-side switch left `NEXT_LOCALE=hi`, so Hindi to English bounced back                                                                                                                                                                                    | `switchLanguage` from a direct `/hi` visit, then open an unprefixed URL and expect English; keep query and hash. Tests that switch must switch back (T60)                                                                                                                                | Covered for 3 pages; extend to account, portals and dynamic pages |
| 4   | Header row overflow at 400-520 px                                                   | From the fix in `d0268e5`: the tagline and theme toggle appeared from 400 px and the account link showed its text from 420 px, so the row was wider than the screen until 640 px. Now: icon-only account link from 360 px, text, tagline and toggle from 640 px | Width sweep must include 400, 440, 480, 520 and run **signed in** (longer account label), in Hindi, with a cart count of 2 digits. Assert no sideways scroll and that header children do not overlap or wrap                                                                             | Sweep is signed out, English mostly                               |
| 5   | Inner scroll boxes                                                                  | Per the runbook and checklist: main content in a `max-h` + `overflow-auto` box (the compare table) trapped scrolling and cut content. Existing guard: `compare.spec` "on a phone two products use the full width"                                               | New `layoutFacts` rule (section 6.3)                                                                                                                                                                                                                                                     | Missing                                                           |
| 6   | Third-party widget restyle breaks contrast                                          | Dark CSS changed MapLibre's attribution background but kept its link colour                                                                                                                                                                                     | axe on `/workshops` and `/partners/apply/seller` in both themes **after the map has loaded** (wait for `.maplibregl-ctrl-attrib`), repeated 3 times; any rule that restyles a widget's background also sets its text and link colours                                                    | Flaky coverage only                                               |
| 7   | JS budget                                                                           | An every-page client component imported a shared module for one constant (T57, L90; tonight the compare tray was split into `compare-tray-loader.tsx` + `lib/compare/signal.ts` so pages ship only the key and event name)                                      | `node scripts/measure-js.mjs` after any import added to `demo/store.ts`, header islands, `error.tsx` or a component used on `/shop`; CI budget step                                                                                                                                      | Exists; make it part of the UI checklist                          |
| 8   | Tests that pass by scrolling                                                        | Playwright scrolls to an element before clicking, so off-screen fixed UI passes                                                                                                                                                                                 | Assert `boundingBox()` inside the viewport before the click for all floating UI                                                                                                                                                                                                          | Partly                                                            |
| 9   | Empty-state pages pass layout gates                                                 | A seed dropped by a type guard leaves an empty page that has no layout bugs                                                                                                                                                                                     | must-show assertion per world and route                                                                                                                                                                                                                                                  | Only in the Hindi gate                                            |
| 10  | Stacked floating UI                                                                 | Banner, tray, assistant and tab bar overlap at some widths                                                                                                                                                                                                      | Fixed-overlap check at 320-430 px in worlds G0 (banner open) and G2 (tray with 4)                                                                                                                                                                                                        | Banner against assistant only                                     |
| 11  | State-dependent layout: one list state breaks every card (2026-11-14)               | A per-card message ("You can compare one category at a time") entered a `shrink-0` column of the card's action row, which widened to the text and pushed "Add to cart" out of the card; the message state lived in each card, so other cards kept stale copies  | `e2e/compare-ui.spec.ts`: tray with another category × 390/768/1280/1920, plus cart + full list; every card's buttons and links inside the card (`expectChildrenInside`), equal heights per row; one shared prompt in the tray updates every card                                        | Written 2026-11-14, runs overnight                                |
| 12  | Hover/focus surface covers neighbouring content (stepper count hidden under "+")    | Text in a shrinkable flex item overflowed its box under the next button; the button's hover background painted over it. Presence checks passed (the count was in the DOM)                                                                                       | `e2e/cart-stepper-geometry.spec.ts`: − / count / + boxes and the count's **text box** never intersect, `elementFromPoint` on the count returns the count, at rest, hovering + and −, keyboard focus, qty 1/3/99, widths 360–1920; stepper height = "Add to cart" height                  | Written 2026-11-14, runs overnight                                |
| 13  | Columns misaligned by optional content                                              | An optional badge (saving) or a taller control (stepper) in one column moved that column's action down; artwork scaled with column width                                                                                                                        | `e2e/compare-table-geometry.spec.ts`: action tops/bottoms aligned ±1 px, prices aligned in the strip, artwork ≤ 176 px and under the strip, children inside their column; 2/3/4 products × in cart or not × 4 widths × light/dark × en/hi                                                | Written 2026-11-14, runs overnight                                |

### 7.1 Geometry, not just presence (2026-11-14)

Interactive states get **geometry** checks with `e2e/helpers/geometry.ts`: `expectInside` (a control inside its card or cell), `expectNoOverlap` (siblings such as − / count / +), `expectAligned` (one edge across columns or cards, ±1 px), `expectChildrenInside` (every button/link of every card), `expectEqualHeightsPerRow`, `textBox` (the painted text, which can overflow its element), `seedStorage` (seed once per test). Apply them to every **combination** of states, not each state alone: list state × cart state × hover/focus × width (360, 390, 768, 1024, 1280, 1500, 1920) × language. A new interactive control on a card, a table column or a floating tray adds a geometry test in the same change.

Floating-surface states to cover for any tray, banner or launcher (review 2026-11-14): the privacy banner open (a fresh visitor, not `consent-decided.json`) with the tray asking; the tray against the assistant button at 360/390 in English and Hindi with the longest bar (4 products + category); a question open and then a client-side navigation (it must close, focus must not drop to `<body>`); a notice with an empty list (refused save); Tab leaving a non-modal question; Escape anywhere; "Clear" while focus is inside the tray. Controls that swap (Add to cart ↔ stepper, bin ↔ Add) assert where focus lands, not only what is shown; a control at its limit stays focusable (`aria-disabled`). `expectChildrenInside` ignores visually hidden (sr-only) text. The compare control is a checkbox (ruling 2026-11-15): tests use `getByRole('checkbox', { name: 'Compare …' })`, `toBeChecked()`, Space to toggle, and check that it sits inside the card, clear of the price and of the action row, which holds only "Add to cart" or the stepper at full width (`compare-ui.spec.ts` "compare checkbox on cards").

---

## 8. Untested states, ranked by risk

"Untested" here means: no world in the matrix and no hit in a grep of `e2e/*.spec.ts` (titles, `page.clock`, second
pages, limit constants). Nothing was run.

1. **Order + ticket + cart together (the owner's example).** The busy world was meant to cover it, but its ticket is
   written as an array and the store ignores it, so no page has been rendered with a customer ticket next to an order.
2. **Signed-in header at 400-640 px in Hindi** with a 2-digit cart count: the sweep is signed out and light only, and
   the bug class was found exactly here.
3. **Closed and edge order states on the customer page** in dark and Hindi at 390 px: cancelled (by customer, by
   staff), rejected with coins restored, code locked, delivered by override. Functional tests exist in English
   desktop only.
4. **Offer timeout seen from three roles.** No e2e moves the clock across a deadline (`page.clock` appears once, to
   fix a date). Offer expiry, quote validity, invite expiry, block end and ticket SLA are untested in the browser.
5. **Paused or suspended partner with work in hand** (S5, W5), and routing when every shop is unavailable (A2).
6. **Nine admin sections in no matrix**: `services`, `quotes`, `applications`, `customers`, `reviews`, `support`,
   `coins`, `layout`, `notifications`; and account `coins` and `addresses`.
7. **Second tab or second admin on the same row**: stale `version` in site config, tickets and agreements; a block
   or sign-out arriving by `storage` event under an open page. Only the theme has a two-page test.
8. **Limits**: cart 20 lines x qty 99, compare 4 at 320 px, 50+ orders (the list cuts at 50), 5 tickets a day, max
   vehicles and addresses. No e2e names these constants.
9. **Customised site across theme, language and width** (G4, A8): hidden and reordered sections and overrides have
   one functional test; the injected `<style id="md-site-layout">` lives outside React, like the theme attribute.
10. **Phones cannot change theme from the header** (toggle hidden under 640 px; only the footer has one), and the
    tablet range 760-1023 px has no project.

Also worth a line each: storage blocked or full; stale consent version; no saved theme with system dark on portals;
the demo "advance", "demo reply" and "demo offer" controls reachable by any visitor; orders, requests and quotes not
scoped to the account in the demo store (two customers on one browser see each other's rows).

---

## 9. UI state audit: the component dimension model (2026-11-14)

Sections 6–8 model **pages × worlds**. They missed four layout bugs on 2026-11-14 because nothing varied
interaction states, cross-entity relations, data shapes or the widths between 390 and 1440, and nothing measured
geometry (`docs/research/ui-testing-gap-2026-11-14.md`). The UI state audit models **components × dimensions**
and measures boxes.

| Part                       | Where                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component state model      | `apps/web/e2e/state-audit/model.ts` (67 components, their dimensions and values; `ADM-REFUNDQ` and `ORD-REFUNDLINE` are real-API screens: listed, `test.fixme`) |
| Pairwise / cross generator | `apps/web/e2e/state-audit/pairwise.ts` (deterministic, no dependency, unit-tested)                                                                              |
| Cases and ids              | `apps/web/e2e/state-audit/cases.ts` (`SHOP-CARD-017` …; chunks for the overnight run)                                                                           |
| Geometry assertions        | `apps/web/e2e/state-audit/geometry.ts` (runs in the page)                                                                                                       |
| Runner per case            | `apps/web/e2e/state-audit/harness.ts`; tests in `state-audit.audit.ts`                                                                                          |
| Known, filed bugs          | `apps/web/e2e/state-audit/known-issues.ts` (annotations only with `STATE_AUDIT_KNOWN=allow`)                                                                    |
| Config                     | `apps/web/playwright.state-audit.config.ts` (one Chromium project; not part of `pnpm e2e`)                                                                      |
| Written checklist          | `docs/qa/ui-state-checklist.md` (1,844 items; one test each; ticked from the report)                                                                            |
| Scripts                    | `apps/web/scripts/state-audit-checklist.mjs` (regenerate), `state-audit-tick.mjs` (tick), `state-audit-run.mjs` (overnight chunks)                              |
| Part                       | Where                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------                              |
| Component state model      | `apps/web/e2e/state-audit/model.ts` (67 components, their dimensions and values)                                                                                |
| Pairwise / cross generator | `apps/web/e2e/state-audit/pairwise.ts` (deterministic, no dependency, unit-tested)                                                                              |
| Cases and ids              | `apps/web/e2e/state-audit/cases.ts` (`SHOP-CARD-017` …; chunks for the overnight run)                                                                           |
| Geometry assertions        | `apps/web/e2e/state-audit/geometry.ts` (runs in the page)                                                                                                       |
| Runner per case            | `apps/web/e2e/state-audit/harness.ts`; tests in `state-audit.audit.ts`                                                                                          |
| Known, filed bugs          | `apps/web/e2e/state-audit/known-issues.ts` (annotations only with `STATE_AUDIT_KNOWN=allow`)                                                                    |
| Config                     | `apps/web/playwright.state-audit.config.ts` (one Chromium project; not part of `pnpm e2e`)                                                                      |
| Written checklist          | `docs/qa/ui-state-checklist.md` (1,795 items; one test each; ticked from the report)                                                                            |
| Scripts                    | `apps/web/scripts/state-audit-checklist.mjs` (regenerate), `state-audit-tick.mjs` (tick), `state-audit-run.mjs` (overnight chunks)                              |

### 9.1 Dimensions

Every case has `width`, `theme`, `locale`, `auth`, `world` plus component dimensions. The harness gives each
value one meaning (`harness.ts` `seedFor` / `prepare` / `interact`):

| Dimension     | Values                                                                                                    | How it is set                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `width`       | 320, 390, 480, 768, 1024, 1280, 1440, 1920 (grid column counts change at 480/640/760/1024/1280)           | `page.setViewportSize`                                                                                                              |
| `theme`       | light, dark                                                                                               | `mechdost-theme`; system preference set to the opposite                                                                             |
| `locale`      | en, hi                                                                                                    | `/hi` prefix                                                                                                                        |
| `auth`        | out, customer, shop, workshop, admin                                                                      | `mechdost-demo-session` seeded directly (no sign-in form)                                                                           |
| `world`       | empty, cart, busy                                                                                         | as section 6 (`fixtures/demo-world.ts`)                                                                                             |
| `cart`        | none, c1, c2, c99, mixed (partial in-cart), many20 (limit), below (under free delivery), max (₹12,37,500) | `mechdost-cart` (`CARTS`)                                                                                                           |
| `compare`     | none, lub-1…lub-4, bat-2, bat-3, tyr-2, spa-2, spa-3 (mixed MRP / "on request" / no MRP)                  | `mechdost-compare` (`COMPARES`); `bat-2` on `/shop` = mixed categories                                                              |
| `stress`      | none, long-text, long-price, mixed-shape                                                                  | applied to the rendered DOM (`applyStress`): 70+ character names en/hi, ₹1,00,000, every other card without rating/MRP/saving/badge |
| `interaction` | hover-dec, hover-inc, focus-dec, focus-inc, active-inc (disabled covered at qty 1 / 99)                   | stepper part hovered, Tab-focused or held down while measuring                                                                      |
| `action`      | compare-other, start-new, add, inc, dec-remove                                                            | clicked before measuring; then every card is checked against the stored lists                                                       |
| `open`        | closed, first, last, all                                                                                  | FAQ items, quick-details popover, assistant panel                                                                                   |
| `data`        | empty, one, limit (10), long (very long Hindi text)                                                       | the demo customer's saved vehicles and addresses on `/account/vehicles` and `/account/addresses` (`customerWithSavedData`)          |
| `form`        | clean, errors (submitted empty), filled                                                                   | forms on checkout, booking, partner application, support, sign-in, quotes                                                           |
| `consent`     | decided, open                                                                                             | banner open = no `mechdost-consent`                                                                                                 |

Strategy: pairwise (all pairs) for every component; a **full cross** for the high-risk ones (card × compare ×
cart × width; card actions × width; stepper surface × quantity × interaction × width; compare table columns ×
cart × width; header width × auth; floating stack width × consent), with the other dimensions paired against the
cross. Constraints (for example, no signed-out `/account`) live in the model, never as skipped tests.

Not representable in demo mode: out of stock, unrated products, prices over ₹12,500 (stress covers the layout
side; API mode covers the data side). Map canvases are excluded (map specs cover them).

### 9.2 Assertions per state

The checks are `present`, `inside`, `overlap`, `covered`, `clipped`, `aligned`, `tap`, `hscroll`, `focus`,
`console`, `sync`, `axe` (every fourth case and every core case) and `hindi` (on `/hi`). The exact rules are in
`geometry.ts` and the checklist header. `inside`, `overlap` and `covered` run three times:

- on the whole component;
- again while each kind of control is hovered (up to the component's `sweep` cap);
- again while each of the first controls reached by Tab is focused.

Severity: P0 and P1 fail the test, P2 is an annotation. On failure the test attaches the following, and the test
output gives the state line and every finding:

- `state-audit-failure.png`: a viewport screenshot with the offending boxes outlined in red;
- `state-audit-findings` (JSON).

### 9.3 Running it overnight (low-memory machine)

```bash
# 1. One production build of the demo site (no other heavy suite at the same time, T41).
pnpm --filter @mechdost/web build
# 2. Optional: start the server once so every chunk reuses it (otherwise each chunk starts its own).
pnpm --filter @mechdost/web exec next start --port 3100
# 3. In another terminal: all five chunks, one after another, one browser (workers 1), ticking after each.
node apps/web/scripts/state-audit-run.mjs all --date 2026-11-15
#    or some chunks: node apps/web/scripts/state-audit-run.mjs B C
```

| Chunk | Id prefixes                                         | Tests |
| ----- | --------------------------------------------------- | ----- |
| A     | CHR-, HOME-                                         | 342   |
| B     | SHOP-, STEP-                                        | 444   |
| C     | PDP-, CMP-, CART-, CHK-                             | 296   |
| D     | ORD-, SR-, QT-, ACC-, WS-, PTN-, SUP-, LOGIN-, POL- | 377   |
| E     | PRT-, ADM-                                          | 272   |

Expected duration: about 6–8 s per test (load, settle, a scrolling scan, up to 16 hovers and 16 focus stops,
axe on a quarter of the tests), so **3–4 hours for all 1,795** with one worker. Each chunk takes 30–60 minutes
and is ticked as soon as it ends. Logs, JSON reports and screenshots are kept in
`apps/web/test-results/state-audit-<date>/<chunk>/`, which is git-ignored. The checklist links point there.

A single component: `STATE_AUDIT_ONLY=STEP- pnpm --filter @mechdost/web exec playwright test -c
playwright.state-audit.config.ts`. The per-push subset: `STATE_AUDIT_TIER=core STATE_AUDIT_KNOWN=allow …`.

After the run:

1. Read `## Run results` in the checklist (failures, worst first).
2. Expect the first run to need harness fixes. A `present` failure usually means a wrong scope selector. Many
   identical findings on unrelated pages usually mean a noisy rule. Fix the harness (and add a unit test where it
   is pure), then re-run that chunk.
3. Triage each real failure into `## Found bugs` with its ids and a severity. Fix it test-first, then re-run the
   chunk to tick it.
4. Add a filed bug to `known-issues.ts` only if the per-push subset must stay green while the fix is in review.
   Remove it in the fixing change.

### 9.4 CI

- **Every push** (`ci.yml` job `e2e-demo`, step "UI state audit (core subset)"): the 84 `core` items, about
  5 minutes on two workers, with `STATE_AUDIT_KNOWN=allow`. The step is **report-only**
  (`continue-on-error`) until the first overnight run is triaged (Q101), then it blocks.
- **Full run** (user 2026-11-15: manual only, no nightly schedule — Actions minutes on the private repo): normally on the development PC with `node apps/web/scripts/state-audit-run.mjs all --date <date>` (§ 9.3, early morning, one browser); `.github/workflows/ui-state-audit.yml` can be started by hand on GitHub (id prefixes optional, ~200–240 min). Every item.
  It ticks the checklist and uploads the ticked checklist, the JSON report and the screenshots as the
  `ui-state-audit` artifact (14 days). It never commits.
- `pnpm check` runs `apps/web/test/state-audit-*.test.ts`. These cover the pairwise coverage, the ticking and
  merging, and that the checklist matches the model. A model change without
  `node apps/web/scripts/state-audit-checklist.mjs` fails the gate.

### 9.5 Adding a component or a dimension

1. Add it to `COMPONENTS` in `model.ts`: code, page, scope selector, parameters, strategy. Add `align` for grids
   and tables, `mustShow` for seeded records, and `core` for the per-push subset.
2. If a new state key needs set-up, give it one meaning in `harness.ts` and document it in 9.1.
3. Run `node apps/web/scripts/state-audit-checklist.mjs`. Ids are positional per component, so adding a value
   renumbers that component's items, and they start unticked.
4. Run the new rows: `STATE_AUDIT_ONLY=<CODE>-`.

### 9.6 Real-API-mode views (2026-11-15)

The harness runs in demo mode, so views that only exist with real sign-in cannot be in `COMPONENTS` (they would fail
`present`). They are listed in `REAL_MODE_VIEWS` (`model.ts`) with the navigation that reaches each and the states an
API-mode audit must render; `test/state-audit-real-views.test.ts` checks the files and that their text comes from the
locale namespace. Current entries (shop give-up, shop warnings, admin warnings, admin reroute-queue give-up line):
`API-SHOP-GIVEUP`, `API-SHOP-WARNINGS`, `API-ADMIN-WARNINGS`, `API-ADMIN-GIVEUP-QUEUE`; emails `API-ADMIN-EMAILS`; bell and push (2026-11-15, spec 10): `API-BELL` (badge 0/1/99/99+, dropdown loading/list/long Hindi titles/empty/error, mark all), `API-NOTICE-CENTRE`, `API-PUSH-PROMPT` (normal, partner title, iPhone Home Screen, denied, snoozed, hidden without the key), `API-NOTICE-PREFS`, `API-ADMIN-NOTICES`. The API-mode audit must render them at 390, 768 and 1440 in light, dark and `/hi`; the real-sign-in run needs the VAPID key and Sender ID set for the card rows. Turning them into runnable
cases needs an API-mode run on a seeded emulator database (queued as Q106); until then they are covered by the DB and
API suites and the Hindi gate.
