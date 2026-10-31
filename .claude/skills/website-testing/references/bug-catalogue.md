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

## L. Admin & CMS

- **L1 · Admin edit not audited** → audit_log row per mutation test.
- **L2 · Four-eyes bypass** (same person requests and approves) → refund/payout approval test.
- **L3 · Content publish not live / draft leaks** → CMS publish + revalidation test; drafts never served.

## M. Test-suite hygiene

- **M1 · Flaky timing** — real clocks/sleeps → use DB `now()` manipulation or fake timers.
- **M2 · Order-dependent tests** — shared fixtures mutated → each test creates its own data or resets.
- **M3 · Skipped tests forgotten** → CI fails on `.only`/`.skip` without a linked reason.
- **M4 · PGlite ≠ real Postgres** — single connection hides true concurrency → concurrency suite also runs against real Postgres in CI.
