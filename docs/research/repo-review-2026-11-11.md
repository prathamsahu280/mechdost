# Whole-repo review — 2026-11-11

The user asked for a review of the whole repo, skills and tooling, with suggested improvements, features and breakable flows.
Five read-only reviewers ran on Fable 5.2: architecture, tooling/CI/skills, product/roadmap, an API + DB bug hunt and a web bug hunt.
The advisor (Fable 5.2) checked the approach.
Everything here comes from reading code. No tests or builds were run.

Each finding carries one of three evidence tiers:

- **[traced]** I opened the cited code and confirmed the failure path myself.
- **[reviewer]** A reviewer traced it end to end, and I have not re-traced it.
- **[plausible]** It depends on router, hydration or external-service behaviour that nobody has run.

Items already tracked elsewhere are not repeated here: per-shopper rate limits, cart/checkout/orders on the API, the data switch, API categories, and the 12 deferred minors in the catalogue-on-API ledger.

## 1. Bugs and breakable flows

| #   | Sev    | Tier      | Finding                                                                                                                                                                                                                                                                                                                                                                                                          | Fix                                                                                                                                                                                              |
| --- | ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | High   | traced    | **Open redirect after sign-in.** `safeNext` (`apps/web/src/demo/session.ts:250`) rejects `//` and `\` but not ASCII control characters, which the URL parser strips, so a crafted `?next=` resolves to another host (verified with node). The result goes straight into `next/navigation` `router.push(next …)` with no locale prefix (`components/auth/login-flow.tsx:126,214`), in both demo and real sign-in. | Resolve with `new URL(next, location.origin)`, require the same origin, reject control characters, and push only `pathname + search + hash`. Unit-test control characters and encoded slashes.   |
| B2  | High   | traced    | **A delivery-code lockout strands the order forever.** `overrideDelivery` (`packages/db/src/repo/delivery.ts:113`) has no caller in the API. After 5 wrong codes there is no re-issue, no override and no admin transition out of `out_for_delivery`. Spec 04 (lines 76, 86) describes the audited admin override as existing, so this is a spec-vs-code gap, not a tracked item.                                | `POST /v1/admin/orders/{code}/deliver-override` (`orders:route`, city-scoped, reason code) in one transaction with the transition, plus a "re-issue code" action. Test the lock → override path. |
| B3  | High   | plausible | **Password guessing can bypass our lockout and Turnstile.** `apps/api/src/auth/password-authority.ts:48` checks passwords through Identity Toolkit `signInWithPassword` with the public web key. An attacker can guess directly against Google and use our endpoint only once they have the right password. Firebase throttling the account then makes `check()` throw → 503 for the real user.                  | Fix to be researched in the Firebase docs (key restrictions, App Check, Identity Platform lockout, or server-side verification). Check the project settings first.                               |
| B4  | High   | traced    | **The admin quote screen crashes on a malformed price and accepts ₹0.** `admin-console.tsx:731-734`: the price boxes are text inputs (`inputMode="decimal"`, lines 820/840), so `.` is possible; `Number('.')` → NaN survives `Math.max(0, NaN)`; `formatINR` throws on any non-safe-integer (`packages/shared/src/money.ts:35`) during render. An empty field becomes 0, and `send` has no check (demo admin).  | Strict rupee parsing; Send disabled on invalid or zero prices; a root `[locale]/error.tsx` (see A2).                                                                                             |
| B5  | Medium | traced    | **Illegal state moves return 500.** `IllegalTransitionError` / `ActorNotAllowedError` (`packages/shared/src/state/machine.ts:15,23`) are not mapped in `apps/api/src/errors.ts`. Examples: ticket `open → closed`, product `live → submitted`.                                                                                                                                                                   | Map both to 409 `INVALID_TRANSITION`; add API tests.                                                                                                                                             |
| B6  | Medium | traced    | **A forged or cross-sort cursor returns 500 on the public catalogue.** `packages/db/src/repo/cursor.ts:29` only checks that `k` is a string ≤ 64 chars; it is then cast in SQL (float8/bigint/timestamptz). Spec 05 promises 422 `INVALID_CURSOR`.                                                                                                                                                               | Validate `k` per sort type in `decodeCursor` (or map 22P02/22007/22008 to 422). The web already restarts on 422.                                                                                 |
| B7  | Medium | reviewer  | **COD group totals and payment status go stale.** `cod_collected` is never set; delivery, cancel and reject never update `order_groups`; the COD fee on a cancelled first sub-order is collected by nobody (`shop-orders.ts:424`, `customer-orders.ts:219`, `checkout.ts:465`).                                                                                                                                  | Derive the group total and status from live sub-orders on every delivery, cancel and reject; move the fee to the first surviving sub-order.                                                      |
| B8  | Medium | reviewer  | **Routing keeps holds without extending them.** `routing.ts:378` keeps same-shop reservations but leaves `expires_at`; the sweep can free them inside the 15-minute accept window → `STOCK_NOT_HELD` on accept.                                                                                                                                                                                                  | Set `expires_at = now() + ttl` for kept holds in `moveReservations`.                                                                                                                             |
| B9  | Medium | reviewer  | **Ticket replies are unbounded.** `customerReplyTicket` (`support.ts:218`) has no per-ticket or daily cap; `messagesOf` has no LIMIT.                                                                                                                                                                                                                                                                            | Cap replies per ticket per day; page messages.                                                                                                                                                   |
| B10 | Medium | reviewer  | **Quote acceptance skips checkout rules (demo).** `demo/store.ts:417-451` creates a COD order with address `'—'`, any PIN, and no block check.                                                                                                                                                                                                                                                                   | Collect and validate the address; reuse the checkout's block and service-area checks. The real API version must not copy this.                                                                   |
| B11 | Medium | reviewer  | **Corrupt or old browser data can break every page.** Shallow validators (`demo/store.ts:259-271`, `demo/session-state.ts:159-165`) accept negative quantities and accounts without `name` → a throw in the header (`account-link.tsx:33`). `write()` swallows storage failures, so "Added ✓" shows while the cart stays empty.                                                                                  | Zod-parse on read, clamp quantity to 1–99, add a root error boundary with "reset saved data", and tell the user when storage fails.                                                              |
| B12 | Medium | reviewer  | **The customer "advance" control strands orders (demo).** `order-view.tsx:137-149` can move an order still only offered to a shop into stage 2; the shop portal then hides it.                                                                                                                                                                                                                                   | Show it only in the demo-guide mode, or refuse unless the shop has accepted.                                                                                                                     |
| B14 | Medium | plausible | **Booking date goes stale on the prerendered workshop page.** `booking-form.tsx:41,223`: `min` and the default date are build-time; there is no `max`.                                                                                                                                                                                                                                                           | Set the date after mount; add a `max`.                                                                                                                                                           |
| B15 | Medium | plausible | **Real sign-up can dead-end after the password is linked.** A retry relinks and gets "unavailable" (`login-flow.tsx:604-623`); `auth/code-expired` maps to `otp`, so "code expired, resend" is unreachable (`firebase-client.ts:113`).                                                                                                                                                                           | Skip linking when the password provider exists; return `expired`.                                                                                                                                |

Low (reviewer):

- `blockCustomer` can block admin-created staff roles (`customer-blocks.ts:20,69` vs `isStaffGrant`).
- A WhatsApp receipt is marked processed before it is applied, so a failure in between loses it (`whatsapp-webhook.ts:112,126`).
- The guest assistant endpoint has only a per-IP limit and no Turnstile (`assistant.ts:12`).

API areas not reviewed: `repo/coins.ts`, `repo/invoices.ts`, the live relay, content, notification admin, `config.ts`.

### In the uncommitted catalogue fix pass

Both touch `shop-browser.tsx`, which the pending commit changes. Both are traced in code; the router outcome is untested.

- **B13 [traced code]** Demo-mode filters fall out of step with the URL.
  - In demo mode a chip click only calls `history.pushState` (line 165), so the server's `initial` stays unfiltered.
  - The new reset (lines 101-108) compares against the last server `initial`. Clicking the header "Shop" link while filtered therefore renders the same key, nothing resets, and the list stays filtered under `/shop`.
  - Back from a product to a pushState entry may restore an unfiltered render under a filtered URL [plausible].
  - Fix: in demo mode, derive the filters from `useSearchParams()` (or navigate with `router.push`, as API mode does).
- **B16 [traced code]** "Load more" can override a filter click.
  - `loadMore` checks `navigating` only before the `await` (line 169).
  - A filter click during the await starts `router.push`; afterwards `router.replace` runs with the old URL plus `pages` (lines 185-188, built from `window.location.href`), and can supersede the filter navigation.
  - Fix: capture the listing key before the await, bail out if it changed or a navigation is pending, and build the URL from `server.query`.
- **Status:** proposed for the pending fix pass before it is committed, if the user agrees.

## 2. Architecture and launch readiness

**P0**

- **A1 [traced: no Dockerfile; reviewer: no HTTP port]** There is no deploy path. There is no Dockerfile and no deploy job. `apps/api/src/worker.ts` calls itself a Cloud Run service but opens no port.
  - Change: a Dockerfile (`pnpm deploy --prod`), and run the worker as a Cloud Run worker pool or give it a `/health` listener.
- **A2 [traced]** Production errors are invisible.
  - No Sentry SDK in either app. No `unhandledRejection`/`uncaughtException` handlers.
  - No `instrumentation.ts`, `global-error.tsx` or root `error.tsx` in the web; only `shop/error.tsx` exists.
  - Change: Sentry (or PostHog error tracking) with a PII scrubber, process handlers, and root error boundaries.
- **A3 [traced]** There are no database timeouts. `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout` are set nowhere, while Hono times out at 10 s and the query keeps a pool connection.
  - Change: set them per role, or `SET LOCAL` in transactions.
- **A4 [reviewer; already a ledger ruling: "PGlite until Docker/Supabase local exist" — the new point is that a CI service container needs no local Docker]** CI never touches real Postgres, so the "races" run on one PGlite connection. `packages/db/src/testing.ts:3` says CI runs them on real Postgres; it does not.
  - Change: a `postgis/postgis` service-container job running the migrations plus the concurrency suites (double accept, oversell, invoice sequence, idempotency).
- **A5 [traced]** `price_history_daily` does not exist. The 1 Jan 2027 "lowest price in the previous 30 days" rule needs history from **1 Dec 2026** (`docs/research/promotions-referrals.md:100,182,385`).
  - Change: the table plus a nightly job (and a write on price change) this month.

**P1**

- **A6 [traced; known — the ledger calls it "intentional deny-all until per-table policies"]** The "RLS mirror" (hard rule 4) has no policies: there are 0 `CREATE POLICY`. Today it is a deny-all lockdown. Decide (Q73), then test that `anon`/`authenticated` read nothing.
- **A7 [reviewer]** Contract drift is about to start. Only the catalogue has shared DTOs; checkout, orders and support define theirs inline in routes.
  - Change: move them to `packages/shared` before the switch, commit an `openapi.json` snapshot with a CI diff, and use one typed client (`openapi-fetch` or Hono `hc`).
- **A8 [reviewer]** The web has four hand-rolled API callers (`api-source.ts`, `firebase-client.ts`, `event-transport.ts`, `assistant/transport.ts`).
  - Change: one `lib/api` module for base URL, timeout, error envelope, auth header and request id.
- **A9 [reviewer]** The demo stores have no boundary: 44 files import `@/demo/*`, and `store.ts` has 6 stages against 10 shared order states.
  - Change: a view-model + source per domain (as the catalogue does) and a lint ban on `@/demo/*` outside the sources.
- **A10 [traced]** The cache tags are dead: no `revalidateTag` call exists. Admin edits wait out the 30–60 s TTL.
  - Change: a signed revalidate route, called by the worker from an outbox row on catalogue, price or stock changes.
- **A11 [traced; already planned in `worker.ts:3`]** Jobs are four `setInterval` loops. pg-boss is decided but not installed.
  - Change: adopt it before payments, refunds and invoice jobs.
- **A12 [reviewer]** The web's env vars are not validated at build time. API: `DATA_ENCRYPTION_*` and `DATABASE_CA_CERT` bypass `config.ts`. `/ready` doesn't turn 503 on SIGTERM. `system.ts:44` logs a raw error.

## 3. Tooling, CI, skills

Already in place, so not recommended: Dependabot (3-day cooldown), SHA-pinned actions, the Prettier pre-commit hook, and no attribution lines in the last 200 commits.

**P0**

- **T1 [traced]** There is no shared `.claude/settings.json`. Proposed (needs approval, Q72):
  - `attribution` off (stops the co-author reminder at the source);
  - `permissions.deny` on reading `.env` and `*firebase-adminsdk*.json`;
  - a `PreToolUse` hook that blocks `git commit` with an attribution line;
  - a `SessionStart` (compact) hook that prints the ledger's NOW block and "advisor first, review + website-testing last";
  - a `Stop` hook that warns when source changed but `docs/progress.md` did not.
- **T2 [traced]** Add a `.githooks/commit-msg` attribution check; only `pre-commit` exists. Make `pre-commit` refuse staged `.env`, `*adminsdk*`, `*.pem` and service-account files.
- **T3 [traced]** `docs/progress.md` is about 44 KB and its "Current status" was stale (fixed today: a NOW block added). Next: move the completed log to `docs/progress-archive.md` so the resume read is short.

**P1**

- **T4 [traced]** CI never runs `next build`, and two past bugs only showed up there. Add `turbo run build`.
- **T5 [reviewer; tracked in the ledger as "once a preview deploy exists" — the point is it need not wait]** Run the demo-mode Playwright suites in CI now, since the config already self-hosts `next start`. That covers Hindi coverage, axe and `measure-js.mjs`, and takes the runs that get killed on the laptop off it.
- **T6 [traced]** Bake in the low-memory flags:
  - `pnpm check` → `--concurrency=1`;
  - Playwright `workers: process.env.CI ? 2 : 1`;
  - the commit chain then becomes `pnpm check && …`.
- **T7 [traced]** CI uses Node 24 while `.nvmrc` says 22.23.4. Use `node-version-file: .nvmrc`.
- **T8 [reviewer]** Add `eslint.config.mjs` and `.prettierrc.json` to the turbo `globalDependencies`, otherwise lint results can replay from the cache after a rule change. Use `--affected` for mid-task checks.
- **T9 [reviewer]** Phantom tooling: `pnpm lhci` and pgTAP are listed in CLAUDE.md but don't exist, and `website-testing/references/commands.md` is out of date. Implement them or mark them "planned".

**P2**

- **T10 [traced]** The advisor skill says "15 hard rules"; there are 16, so rule 16 (ML-ready data) is never walked.
- **T11 [reviewer]** Tidy the checklist (items under the wrong area). The advisor `learnings.md` is 27 KB and loaded every task: archive promoted entries.
- **T12 [reviewer]** `msg91-messaging` describes WhatsApp via MSG91 and a `packages/notify` that doesn't exist; the decision is Meta Cloud API direct. Rename it and fix it.
- **T13 [reviewer]** CLAUDE.md lists the skills twice; keep the table.
- **T14 [traced]** The github plugin fails auth and the firebase MCP times out every session: fix the GitHub token or disable both.
- **T15 [reviewer]** Add CodeQL, GitHub secret scanning with push protection, and `pnpm audit --audit-level=high` in CI.

## 4. Product: launch blockers, decisions, features

**Where it is:**

- **Real (behind switches that default to demo):** Firebase sign-in, and catalogue + search.
- **Server-only:** COD checkout, routing, shop fulfilment, cancellations, blocks, catalogue editor, settings, content, support + the WhatsApp ticket bridge, events, the Coins ledger.
- **Demo-only:** the cart/checkout/orders UI, the portals, the admin console, the whole workshop flow (no service-request API yet), and bulk quotes.
- **Not started:** Razorpay, invoice generation, refunds, payouts, the partner application API, reviews, reminders, deploy and monitoring.

**Blockers before real orders and money:**

1. Deploy and staging (Q17, Q30, Firebase prod + Blaze + App Check, Supabase Pro + PITR, Enforce SSL Q23).
2. Payments: Razorpay KYC takes days (Q8, Q2).
3. GST invoices: generation and PDF, plus the CA questions (Q11, Q66, Q41).
4. Legal:
   - CIN + grievance officer (Q15b: legally required, should be P1);
   - terms of use and account deletion;
   - `price_history_daily` (A5).
5. DPDP consent on the server.
6. A partner agreement + commission (Q11, Q28).
7. Email and WhatsApp verification, which have lead time (Q7, Q50–Q52).
8. Redis + Turnstile keys (Q4, Q5).
9. Monitoring (A2).
10. Proof of concurrency on real Postgres (A4).

**Features worth pulling forward:**

1. **Two-wheelers and three-wheelers first-class.** Raipur has about 1.46M 2W against 240k cars.
2. **"Fits your vehicle" + My Garage.** Specced in spec 02.
3. **WhatsApp order updates and "Ask about this product".** Specced.
4. **COD confirmation on WhatsApp + a COD cap.** Not specced.
5. **"Can't find your part? Send a photo" quote request.** Not specced for retail.
6. **Buy + fit:** a battery or tyre fitted by a partner workshop. Not specced.
7. **Service, insurance and PUC reminders.** Spec 17 G.
8. **A fixed-price inspection or basic-service SKU as an easy first booking.** Not specced.

**Scope to defer for a sooner launch** (Q71): referrals and Coins earning, the promotions engine and brand deals, the LLM assistant, bulk quotes, satellite imagery, the geocoding bake-off, self-hosted PostHog, Meilisearch, realtime pings (polling is enough), recommendations, WhatsApp OTP, CMS layout editing, and spec 17. Optionally run workshop booking concierge-style (admin + WhatsApp) at first.

## 5. Claude Code features worth using

- **Hooks + `attribution` + `permissions.deny`** in a shared `.claude/settings.json` (T1). Rules then hold mechanically instead of relying on memory after compaction.
- **`--affected` turbo runs and CI e2e** (T5, T8). These move heavy runs off the low-memory laptop.
- **`/model`** to run the main session on Fable 5.2 when wanted; reviewer agents can be pinned per call (done in this review).
- **`/code-review ultra`** (user-triggered, billed): a multi-agent cloud review of the branch before a release, so the laptop's memory isn't used.
