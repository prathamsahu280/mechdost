# E-commerce & marketplace bug catalogue

Each entry: **ID · bug class** — how it shows up → **test that catches it**. Status column in learnings tracks
which are automated. Add new classes at the end of the relevant section.

## A. Identity, auth & access

- **A1 · IDOR / BOLA** — user reads/edits another's order, address, vehicle, ticket by changing an id →
  role-leak matrix: for every resource route, actor from another tenant gets **404**; DB repository tests with foreign actor.
- **A2 · Privilege escalation via body** — client sends `role`, `shopId`, `price`, `userId` → API test posts extra
  fields; `.strict()` DTO rejects (422) and DB row unchanged.
- **A3 · Stale permissions** — role revoked but token still works → test revocation path (`checkRevoked`, permission cache TTL ≤ 60 s, forced refresh).
- **A4 · OTP abuse** — SMS pumping, brute force, enumeration → rate-limit tests (per phone/IP/device), 5 attempts then lockout, identical responses for known/unknown phones, Turnstile required.
- **A5 · Session issues** — logout not server-side, session fixation, partner/staff timeouts → API test: revoked session/token rejected; staff idle timeout.
- **A6 · Verified-only actions** — unverified phone/email can order/book → API test returns 403 `VERIFICATION_REQUIRED`.
- **A7 · Cross-city staff leak** — city_manager sees other cities → role matrix with city-scoped actor.

## B. Catalogue, search & pricing

- **B1 · Price drift** — price changes between cart and order; client-sent price used → checkout test re-prices server-side and shows notice.
- **B2 · Unpublished/paused offers visible or purchasable** → catalogue query tests for draft product, paused offer, unapproved shop, zero stock, expired, other pincode.
- **B3 · Fitment wrong** — badge shows "fits" for wrong year/variant → unit tests on fitment resolver incl. year boundaries.
- **B4 · Search misses** — typos, Hinglish, part numbers with spaces/dashes → search tests (`castrl`→Castrol, `brake pad`/`disc pad`, `MD-CAS 001` normalised).
- **B5 · Pagination drift** — duplicates/missing items when new rows arrive (offset) → cursor pagination test inserting mid-scroll.
- **B6 · Facet counts wrong** with combined filters → facet test with known fixture counts.
- **B7 · MRP < selling price / negative or zero price** → DB CHECK + admin form validation test.
- **B8 · Wrong GST** — CGST≠SGST, intra vs inter-state mix-up, rounding → property tests + order_items CHECK.

## C. Cart & checkout

- **C1 · Double submit** — double click / retry creates two orders or charges → idempotency test: same key twice → same order; concurrent → one 2xx one 409.
- **C2 · Oversell** — two buyers take the last unit → concurrency test N parallel reservations vs stock.
- **C3 · Reservation leak** — abandoned checkout holds stock forever → TTL release job test (expired once, idempotent).
- **C4 · Coupon abuse** — over-limit use, stacking, first-order bypass, race on usage count → coupon tests incl. concurrent redemption and per-user limits.
- **C5 · Allocation rounding** — discount lines don't sum to total; refunds recompute differently → Fowler allocation property test; refund uses stored per-line amounts.
- **C6 · Address/pincode** — unserviceable pincode accepted; city mismatch → checkout test with paused city and uncovered pincode.
- **C7 · COD rules** — cap bypass, blocked customer, category exclusion → COD rule tests.
- **C8 · Cart merge** — guest cart lost or duplicated on login → merge test (union, higher qty, flagged changes).
- **C9 · Multi-shop split** — wrong grouping, shipping per shop, one payment → split test with 2 shops.
- **C10 · Totals mismatch** between UI, API and DB → DB CHECK on totals + e2e asserts displayed total equals charged amount.

## D. Orders, routing & fulfilment

- **D1 · Same order to two shops** → DB partial unique index test + concurrent offers test.
- **D2 · Late accept after timeout** / accept vs expiry race → clock + CAS test.
- **D3 · Shop accepts another shop's offer** → API/repo test (ASSIGNMENT_UNAVAILABLE).
- **D4 · Illegal status jump / wrong actor** → state machine unit tests for every forbidden edge + API test.
- **D5 · Lost update** — two admins act on the same order → stale `version` returns 409.
- **D6 · Timeline gaps** — status changed without event → trigger test: one event per change with actor.
- **D7 · Cancel after packed by customer** → actor rule test.
- **D8 · Notifications on rolled-back changes / duplicates** → outbox tests (no row on rollback, dedupe key).
- **D9 · Courier webhook out of order** → monotonic shipment state test.

## E. Payments & refunds

- **E1 · Webhook replay** → same event id ×3 → one state change, one notification.
- **E2 · Out-of-order events** (`failed` after `captured`, `captured` before order exists) → monotonic machine + parked/orphan test.
- **E3 · Amount/currency tampering** → mismatch flagged, order not marked paid.
- **E4 · Signature bypass** — HMAC over parsed JSON, wrong secret, rotated secret → raw-body tests.
- **E5 · Double refund / over-refund** → concurrent refund requests; remaining-balance check under lock.
- **E6 · Refund API failure after DB commit** → reconciliation job resends with same idempotency key.
- **E7 · Gapless invoice numbers** → rollback test; Rule 46 format CHECK.
- **E8 · COD refund without UPI/bank details** → validation test.
- **E9 · Uncertain provider outcome frees the money** (a timeout or a differing amount marks the refund failed and releases the reserved amount while Razorpay did create it → double refund) → `needs_reconciliation` keeps the amount reserved; look the refund up at the provider (our id in notes/receipt) before failing; only a confirmed absence may fail + release; tests: timeout after create → lookup finds it, one create call; refusal + lookup down → unsure; amount mismatch → unsure with the amount reserved.
- **E10 · Our own refund id on a webhook is parked or ignored** (matched only while `approved`, so a processed event for a failed or unsure refund is lost) → match by Razorpay id, else by our id in notes in any state; failed/unsure → processed re-holds the amount (CHECK still caps the sum) and alerts; a never-sent refund id is an alert, never `parked`; tests for each.

## F. Service requests & workshops

- **F1 · Double booking a slot** → capacity/exclusion constraint test with concurrent bookings.
- **F2 · Estimate revision keeps old approvals** → revision resets approvals test.
- **F3 · Work started on unapproved lines** → only approved lines billable/startable test.
- **F4 · Odometer regression** → odometer ≥ last recorded test.
- **F5 · Nearby search wrong** — radius/units/ordering → PostGIS distance tests with fixtures.
- **F6 · Unverified/unpublished/busy workshop listed** → listing filter tests.

## G. Time & locale

- **G1 · IST vs UTC day boundaries** ("today", cancellation windows, reports) → clock tests at 23:59/00:01 IST, 05:29 UTC.
- **G2 · Financial year boundary** (31 Mar/1 Apr IST) → invoice FY tests.
- **G3 · Hindi layout** — text overflow, truncation, Devanagari font missing, mixed-script search → e2e in `hi` at 390 px + visual snapshot.
- **G4 · Number/currency format** — lakh grouping, ₹ placement, Hindi numerals policy → unit tests on formatters.

## H. Rendering, UX & accessibility

- **H1 · Hydration mismatch** (dates, random ids, locale) → e2e console-error check fails on hydration warnings.
- **H2 · Layout shift** — images without dimensions, late fonts, injected banners → Lighthouse CLS budget + visual stability check.
- **H3 · Slow LCP** — hero not prioritised, huge images → Lighthouse LCP budget per key page.
- **H4 · Broken responsive layout** at 390/768/1440, horizontal scroll → Playwright viewport suite + visual snapshots.
- **H5 · Keyboard traps / missing focus / modal focus** → keyboard e2e path through checkout; axe.
- **H6 · Contrast, labels, alt text, headings** → axe scan per page (0 serious/critical).
- **H7 · Back button / deep links** — state lost, broken order/ticket links → e2e navigates back and deep-links.
- **H8 · Empty / error / loading states** missing or flashing → component + e2e checks (skeletons, one next action).
- **H9 · Double-tap / slow network** — buttons not disabled while pending → e2e with throttled network.
- **H10 · Reduced motion ignored** → e2e with `prefers-reduced-motion` asserts no animation.
- **H11 · Safari/iOS quirks** (100vh, date inputs, sticky) → WebKit project in Playwright.
- **H12 · Fixed element inside a transformed ancestor** — a floating bar (tray, tab bar, assistant, banner) renders
  at the end of the page because a wrapper keeps `transform` (animation fill `both`/`forwards`), `filter`, `contain`
  or `will-change` → state matrix `layoutFacts`: every visible `position: fixed` box inside the viewport after
  scrolling; assert `boundingBox()` before clicking (Playwright scrolls first).
- **H13 · `<html>` attributes lost on a root-layout change** — a client-side language switch rebuilds `<html>` and
  drops attributes set outside React (`data-theme`, `data-consent-open`, the `md-site-layout` style) → use the real
  switcher both ways and assert each one; never `page.goto` for this.
- **H14 · Preference cookie out of step with the URL** — `NEXT_LOCALE` written only on document requests → switch,
  then open an unprefixed URL and expect the chosen language; query and hash kept; the test switches back.
- **H15 · Header overflow between breakpoints** (400-640 px) → width sweep in steps of 10-20 px, **signed in**,
  Hindi, 2-digit cart count; no sideways scroll, no overlapping header children.
- **H16 · Inner scroll box for main content** (`max-h` + `overflow-auto`) → matrix rule: no element except the map
  and chat thread with `overflow-y: auto|scroll` and `scrollHeight > clientHeight`.
- **H17 · Restyled third-party widget loses contrast** (MapLibre attribution in dark mode) → axe in both themes
  after the widget has loaded, run 3 times; a background override always sets text and link colours too.
- **H18 · Floating elements overlap each other** (banner, tray, assistant, tab bar) → pairwise rectangle check of
  visible fixed nodes at 320-430 px with the banner open and the tray full.
- **H19 · Seeded state never rendered** — a seed in the wrong shape is dropped and the page shows its empty state,
  which has no layout bugs (2026-11-14: the busy world's ticket) → every matrix world asserts a marker per page
  (`mustShow`) and seeded count = shown count.

- **H-REAL-LAYOUT · Image or card wider than its grid cell (only with real data).** An inline px cap
  (`style={{maxWidth: 349}}`) overrides `max-w-full`; the image's intrinsic width becomes the grid item's min-content
  width, cards overlap and the page scrolls sideways. Demo data without photos hides it. Test: real-mode page in a
  browser at 390/1280 px, `document.documentElement.scrollWidth <= innerWidth`, screenshot of the grid; unit guard
  `apps/web/test/product-photo-size.test.ts`. (Live incident 2026-11-23, T190.)

## I. Performance, caching & scale

- **I1 · Stale cache after admin edit** (price, content, settings) → test tag invalidation/revalidation.
- **I2 · N+1 queries** → query-count assertion in API tests for list endpoints.
- **I3 · Missing index** → `EXPLAIN` check for top queries; Supabase advisors after migrations.
- **I4 · Bundle bloat** → bundle budget in CI.
- **I5 · Single-instance assumptions** (in-memory rate limit/cache in prod) → config test: production requires Redis.

## J. Security hygiene

- **J1 · Missing security headers / CSP** → API/web test asserts headers.
- **J2 · Open redirect** → redirect helper accepts only relative paths test.
- **J3 · Upload abuse** (SVG XSS, huge files, EXIF GPS) → upload tests: type sniffing, size limit, EXIF stripped.
- **J4 · Secrets exposure** — secret in `NEXT_PUBLIC_*`, in logs, in errors → env schema test + log redaction test.
- **J5 · Rate limits missing** on public endpoints → route inventory test: every public route has a limiter.
- **J6 · Dependency advisories** → `pnpm audit --audit-level=high` in CI.

## K. Notifications, analytics & search data

- **K1 · Duplicate or missing notifications** → outbox dedupe + relay retry tests.
- **K2 · Analytics event missing/duplicated** (esp. purchase) → server-side purchase event exactly once per order.
- **K3 · PII in analytics props** → schema validation rejects phone/email in props.
- **K4 · PII or secrets in off-site telemetry** (error reports carrying request bodies, headers, query strings, DB error messages with SQL parameters; analytics forwarded with user ids or free text) → scrubber unit tests on hostile fixtures (`packages/shared/test/error-scrub.test.ts`, `apps/api/test/monitoring.test.ts` scrubProps) asserting the serialised payload has no phone/email/token.
- **K5 · Events forwarded to a processor without matching consent** (no consent, or consent given under an older notice that did not name the processor) → forwarder consent-gate tests (`toPosthogEvent` with null / older `consentVersion`) and the reader's SQL filter (`packages/db/test/events.test.ts`).
- **K6 · Telemetry outage breaks the product** (provider down, 429, bad key) → sender tests: bounded retries, no throw, drop with a count; cursor still advances.
- **K7 · Provider read-token or admin panel leaks data to the browser** → route test asserts the token, emails and raw payload fields never appear in the answer; role matrix (super admin / ops 200, city manager 404, customer 403, stranger 401).

## L. Admin & CMS

- **L1 · Admin edit not audited** → audit_log row per mutation test.
- **L2 · Four-eyes bypass** (same person requests and approves) → refund/payout approval test.
- **L3 · Content publish not live / draft leaks** → CMS publish + revalidation test; drafts never served.

## N. State combinations & cross-role consistency

- **N1 · Counts disagree** — cart pill ≠ cart, admin overview tile ≠ queue, shop stats ≠ lists → matrix count checks.
- **N2 · Action available in the wrong status** — cancel after packed, accept after expiry, reply on a closed
  ticket, accept a stale or expired offer → one control test per status code of the machine, both sides of each window.
- **N3 · Other role not updated** — the shop still sees a cancelled order; the customer never sees the proposal →
  cross-role flow asserts the other roles' pages after every step.
- **N4 · Paused / suspended / blocked ignored on one path** — routing suggestions, direct URL booking, quote
  acceptance, a second tab → test each entry point, not only the main form.
- **N5 · Seed quirks hide states** — support store is `{ tickets: [] }`, is not validated per row, and seeds a
  WhatsApp ticket when the key is missing; coins always include a 250 seed for the demo customer; partner standing
  is append-only (latest wins); `selfCancel` lives on the order; other stores drop invalid rows silently → build
  seeds from `e2e/fixtures/demo-world.ts`, never hand-written JSON.
- **N6 · Demo-only controls reachable** ("advance", "demo reply", "demo offer") → flows use real role actions; a
  build check keeps these out of production.
- **N7 · Deadline boundary** — offer, invite, quote validity, block end, SLA → `page.clock` on both sides; all
  fixture times computed from one `now`.
- **N8 · Demo store not scoped to the account** — orders, requests and quotes show for whoever is signed in on
  this browser → role-leak e2e asserts guards, and the API suites own the real isolation.
- **N9 · Navigation never walked** — the current marker stuck on the old item after a click, a new section missing from a bar in one build mode, a bar that overflows with no scroll at 320 px or with long Hindi labels, a tab bar item under 24 px, a link that lands on a "not found" or the wrong page → the audit models every bar as a component (`NAV-*`, check `nav`, `walk=yes` clicks each item); the model lists are unit-tested against `src/lib/sections.ts` for demo, real and both mixed builds.
- **N10 · Real-sign-in screens have no demo twin** — a screen compiled only with `AUTH_MODE=firebase` / `DATA_MODE=api` is invisible to the demo audit and rots (refund queue, give-up, errors, analytics were all unlisted for days) → every such screen needs an `API-…` row in `model-api.ts` with typed fixtures; fixtures must parse with the same shared Zod schema as the screen (a friendlier fixture than the API hides a contract bug), and an unmocked API call fails the case.

## O. Live updates (RTDB pings)

- **O1 · Stale ping after sign-out or account switch** — a callback of the previous account's subscription fires late and refreshes (or shows) the next person's data. Test: `apps/web/test/live-listener.test.ts` "a late callback of the previous account ... is ignored" (callbacks are bound to the uid they were attached for); hub `resetLive` on sign-out.
- **O2 · Ping for another uid** — the rules or the path let one user read another's inbox, or a ping carries more than ids. Tests: `apps/api/test/live.test.ts` rules clauses (own uid yes; other uid, anonymous, signed-out no), tree walk (every `.write` false, the only non-false `.read` is `inbox/$uid`), `parseLivePing` exact five keys.
- **O3 · Connection while hidden** — an open socket in a background tab (battery, cost) or the chunk fetched for a tab nobody sees. Tests: listener closes on hidden and catches up on visible; hub fetches the listener only when idle and visible (`live-hub.test.ts`).
- **O4 · Duplicate or out-of-order pings** — repeated refreshes or an older version overriding a newer one. Tests: version gate (`newPings`), hub merge and 300 ms debounce.
- **O5 · Listener in the initial bundle** — the database SDK (~30 KB gz) leaks into a header or layout module and breaks the 180 KB gate. Test: `apps/web/test/live-lazy.test.ts`; the coordinator measures `/shop` and `/cart`.
- **O6 · Live is the only path** — polling removed or tied to the socket, so a blocked socket or unset URL freezes screens. Test: the hub is a no-op without the URL and the consumers' polling tests are unchanged.
- **O7 · New origin not in the CSP** — the socket works locally and is blocked in production. Test: `csp.test.ts` database host (https and wss), only a Firebase host, only in real mode.

## M. Test-suite hygiene

- **M1 · Flaky timing** — real clocks/sleeps → use DB `now()` manipulation or fake timers.
- **M2 · Order-dependent tests** — shared fixtures mutated → each test creates its own data or resets.
- **M3 · Skipped tests forgotten** → CI fails on `.only`/`.skip` without a linked reason.
- **M4 · PGlite ≠ real Postgres** — single connection hides true concurrency → concurrency suite also runs against real Postgres in CI.

- **N1 · Multi-device lost update** — a client that sends its whole copy of server-owned state ("the cart is exactly these lines") wipes what another device added meanwhile (laptop opened at 9:00, phone adds at 10:00, laptop edits at 11:00 and the phone's item is gone); also: a stale copy resurrects a line removed elsewhere, parallel adds pass a limit, an order placed on one device leaves the lines on the other. → Test recipe: (1) a fake server and a second "device" that changes it between this client's snapshots; assert a refresh shows the change and a local edit sends only its own line (log the writes: one line op, never the whole cart); (2) adds from both devices sum, a remove stays removed after a stale edit of another line, a page load with a stale copy sends nothing and adopts the server; (3) DB-level: two sessions of one user interleaving, parallel adds of 25 packs end at 20 lines, parallel adds of one pack stop at 99, every effective change moves the version and writes one ping and a no-op writes none; (4) polling: stops when hidden, resumes with an immediate check, never twice in 5 s, backs off to 5 minutes. Fix pattern: per-line conditional operations, snapshot-relative diffs, server wins on load.

## P. i18n bundles (client messages)

- P1. A client component calls `useTranslations('ns')` but no page or layout on the route passes `ns` to `ClientMessages`: the screen shows raw keys (`workshopTier1.f_low`) and the console logs `MISSING_MESSAGE: ns`, only in the real-sign-in (api) build where the lazily loaded `*-api` components render. Happened twice (shopTier1 2026-11-15; workshopTier1, supportThread, workshopAnalytics, portal, refunds 2026-11-16). Gate: `apps/web/test/client-messages-coverage.test.ts` (no allowlist). Fix pattern: add the namespace to the page/shell list (api branch of a conditional list); keep shared style constants out of translated client modules (`portal-styles.ts`).

## Q. Navigation feel

- Q1. Section switch remounts the frame: a route group whose pages each render the shell (guard, side bar, heading, message provider) tears the frame down on every click and Next scrolls to the page top; internal plain `<a href>` or `window.location` does a full document load. Test: layout-holds-frame source test, no-internal-plain-anchor scan, e2e frame-node/window-marker/scrollY survive.

## R. Opened panels

- **R1 · Opened panel cannot be closed** — a button opens a form/panel/sheet in place and there is no Cancel, Escape does nothing, or focus is lost on close. Recipe: click every `[data-disclosure-trigger]`, expect a visible `[data-panel-cancel]` (>= 44 px), press Escape, expect it gone and focus on the opener (`e2e/state-audit/dismiss.ts`, rule `dismiss`); source guard `test/panel-dismiss.test.ts` fails any component with `setOpen(true)`-style openers and no `data-panel-cancel`.

## S. Personal data to a third-party processor

- **S1 · PII mask split past the gate** — a phone, Aadhaar or account number reaches an LLM because the masking regex
  and a segment-based safety check can be split (other digit scripts, zero-width or combining marks, NFKC letters,
  long separator runs, several "safe" tokens side by side). Test: an `it.each` bypass table asserting
  `safeForLlm === false` and zero captured requests, plus an allowlist table of ordinary mechanic text that must still
  pass (`apps/api/test/ustaad-correction-engine.test.ts`). Guard: count numerals over the whole text, never per segment.
- **S2 · Key presence switches a processor on** — an existing API key for another feature makes a new feature send
  personal text. Test: config default `none` and a route test that sends nothing without the purpose consent.

## Q · Layout and tests that outlive rulings (2026-11-26)

- **Q1 · Screen-reader text escapes a scroll box** — `.sr-only` is `position: absolute`; inside an `overflow-x-auto`
  box with no positioned ancestor its containing block is the page, so a wide table's "Actions" header or row-action
  names widen the page at 320 px. Test: the state audit `hscroll` rule at 320 px with a table of row actions; guard
  `apps/web/test/audit-batch-2a.test.ts` (AdminTable and ScrollRegion carry `relative`).
- **Q2 · A "keep it applied" observer fights the user** — a MutationObserver that re-applies the stored value reverts
  a change that could not be stored (storage full). Test: fake observer in `test/theme-follows-device.test.ts`;
  e2e qa-regressions "theme toggle ... storage is full".
- **Q3 · Copy ruling leaves an e2e literal behind** — a ruling rewords customer copy, the e2e asserting the old text
  keeps failing for days. Test: `git log -S '<literal>'` on every failing text assertion; the ruling's change greps
  `apps/web/e2e` for the old literal.

## T · Promoted repeats (2026-11-27 self-improvement step)

Each class below was seen at least twice; the guard is named, or listed in `docs/progress.md` "Guards to add".

- **T1 · Raw JS `Date` in a `sql` template** (T169, T-DATE2) — PGlite accepts it, postgres-js throws
  `ERR_INVALID_ARG_TYPE`, so the job fails only in production. Rule: `${d.toISOString()}::timestamptz` or drizzle
  operators. Guard: `packages/db/src/testing.ts` `rejectDateParams` makes every test DB throw on a Date parameter.
- **T2 · One import ships a whole module** (T-SAV2, T-BUDGET2) — Turbopack tree-shakes per file, so one constant from
  `@mechdost/shared/state` or `/savings` puts the whole file on every page. Rule: small client values live in their
  own module. Guards: `apps/web/test/shared-state-barrel.test.ts`, `apps/web/test/savings-view.test.ts`; measure with
  `scripts/measure-js.mjs` before pushing.
- **T3 · Hindi crawl fixed by guess** (T-NIGHT1 three CI rounds, T-SAV1, L-UDM3) — the offending text came from a
  sample map the page did not use. Rule: grep the page's component for its sample/label source before editing and
  prove the fix locally with `latinOffenders()` from `apps/web/test/hindi-allowlist.ts`; the gate is
  `apps/web/e2e/hindi-coverage.spec.ts`. Demo names shown on `/hi` carry a transliterated `nameHi`.
- **T4 · Stale ID token after verification or a role grant** (SIM-LEAD-1, T-DCSIM-P3 / L317 delivery, L-SIMF1) — the
  API reads `email_verified` and roles from the token, so a change made on another device or by an invite stays
  invisible for up to an hour. Rule: after the action (or on "check again"), `currentIdToken(locale, true)` and
  re-read `/v1/me`. Test: e2e accept-invite → portal without re-sign-in; verify-email elsewhere → "check again" opens
  the console (guard to add).
- **T5 · Test bearer token under 20 characters** (T221, T-USAGE1, T-COD1) — `BEARER` in
  `apps/api/src/middleware/auth.ts` needs 20+ characters; a shorter test token is silently ignored and the test sees
  the signed-out path (401 / guest answer). Rule: `token-<area>-0000000NN`. Guard to add: the fake verifier throws on a
  token the regex would reject.
- **T6 · Demo store drifts from the API contract** (T-DLV3, T-DLV-1, T-DCSIM-P1, L-DLV5) — unit and e2e on the demo
  store passed while every real photo upload failed (422 `JOB_REQUIRED`). Rule: parse every demo answer with the
  shared schema, assert the API client's paths and bodies with a stubbed fetch, and run one e2e of the main path on
  the real API client. Guard: `apps/web/test/delivery-contract.test.ts` (delivery only; other seams: guard to add).
- **T7 · API error code without a message** (T-DCSIM-P4, T-DCSIM-L2, L315 delivery/i18n, L-QA-A3) — next-intl prints
  the key path instead of throwing, so staff saw `delivery.errors.STALE` or "check your internet". Rule: map codes
  through a typed list. Guard: `apps/web/test/delivery-error-codes.test.ts` (delivery); the same scan for Ustaad and
  other route families is a guard to add.
- **T8 · Notice link with no page** (T-QA-A1, T-RT2, T-SIM-P1) — catalogue links pointed at unbuilt pages, and the
  catalogue fix left stored rows broken. Guard: `apps/web/test/notice-links.test.ts`; stored rows need a backfill or a
  redirect in the same change (data check on stored rows: guard to add).
- **T9 · e2e runs against someone else's server or locale** (T-FX5, T-FX6, T-P23c, L-UCE1, L-UCE5) —
  `reuseExistingServer` reused another agent's `:3100`; another port loses the consent fixture; a visit to `/hi`
  stores `NEXT_LOCALE=hi` and later English locators time out. Rule: own `E2E_PORT` + check the port owner, seed
  `mechdost-consent` with `addInitScript`, clear `NEXT_LOCALE` and end shot helpers where they started.
- **T10 · Per-user limits spent by earlier tests** (T-QA-A3, L192, L-D1, L-DCSIM2) — a test fails only in the full run
  because an earlier test used the member's daily cap; live runs hit 429 after negative checks. Rule: a fresh member
  (or a raised cap in `beforeEach`) for rate-limited writes; negative live checks on a spare account.
- **T11 · Fresh worktree typecheck noise** (T-B3, L318 worktree) — web `tsc` fails on image imports without the
  gitignored `apps/web/next-env.d.ts`. Rule: copy it from the main checkout first; not a code error (bootstrap guard
  to add).
