# Real-API launch (Monday 2026-11-16) — plan

User 2026-11-14: "switch on the real api", "we have to kinda launch on monday", scope **"Everything, accept risk"**
(AskUserQuestion), database: keep `mechdost-dev`, **full reset done 2026-11-14** (74 tables from migrations, RBAC
seed, Raipur city + 5 PINs + 9 categories; no products, shops, users or orders).

Goal: mechdost.com runs on real sign-in (Firebase) and the API for every flow, with the demo store off.

## Streams (parallel; each in its own worktree/branch, merged to main when green)

| Stream | Owner                | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Depends on |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A      | agent (Opus)         | **Workshops + service requests backend**: schema + migration 0044 (`workshops`, `workshop_services`, `service_requests`, `service_proposals`, `estimates`, `estimate_items`, `service_bills`, `service_events`, PostGIS location, RLS/triggers), repos (state machine `serviceRequestMachine` as conditional UPDATEs with version; estimate versions clear approvals; bill = approved lines via `@mechdost/shared/service-bill`), API routes (customer: create/accept proposal/cancel/approve estimate/view; workshop: list/propose/decline/receive/estimate/start/ready/bill/mark paid; admin: list/reassign; public: nearby workshops), tests (db + api). Spec 06. | —          |
| B      | agent (Opus)         | **Product creation + import**: API `POST /v1/admin/catalogue/products` (product + first variant: SKU, MRP, HSN, GST rate, category, brand, name/texts en+hi, vehicle types, net quantity) and CSV import endpoint (validate all rows, report per-row errors, insert in one transaction); admin screen tab "Add product" + "Import CSV" in `admin-catalogue-editor.tsx`. Spec 02/08.                                                                                                                                                                                                                                                                                  | —          |
| C      | main session         | **Order loop on the API** in the web app behind `AUTH_MODE === 'firebase'` (data via `lib/admin-api.ts`-style typed clients): checkout COD (`POST /v1/orders`), order page + cancel (`GET /v1/orders/{code}`), account orders, shop portal (`/v1/shop/*`), admin orders (`/v1/admin/orders*`).                                                                                                                                                                                                                                                                                                                                                                       | API exists |
| D      | main session / agent | **Partner onboarding + support + admin settings/content/customers/notifications** on the API (all routes exist).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | API exists |
| E      | main session         | **Workshops on the web** (finder, booking, request page, workshop portal, admin services) on Stream A's API.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A          |
| F      | main session         | **Launch switch**: worker deployed (done), GitHub vars `NEXT_PUBLIC_AUTH_MODE=firebase`, `NEXT_PUBLIC_DATA_MODE=api`, demo controls hidden (Q86), first admin granted (`pnpm db:grant-role`), WhatsApp events enabled, smoke test on mechdost.com.                                                                                                                                                                                                                                                                                                                                                                                                                   | all        |

## Rules for every stream

- CLAUDE.md hard rules apply (data integrity, Zod at boundaries, RBAC in the API, en + hi strings, tests first,
  `pnpm check` green, no AI attribution). Accepted risk = less exploratory QA, **not** fewer automated tests.
- Locale keys: each stream adds keys only under its own namespace (A: none in web; B: `portal.cat_add_*`;
  E: `request.*`/`portal.*` new keys) to keep merges simple.
- Migrations are numbered in order of merge; Stream A takes 0044, Stream B 0045 if it needs one.
- Ledger lines go in this file's "Progress" section.

## Progress

- 2026-11-14: DB reset + reference seed; worker service deployed; plan written.
- 2026-11-14: Stream C1 done on main (customer cart and quote, COD checkout, order page and cancel, account orders on the API; spec 03/04 "Real API mode"). Ruling: customer screens switch on `DATA_MODE`, portals on `AUTH_MODE`; launch flips both.
- 2026-11-14: Stream C2 (shop portal + admin orders) and Stream D (partners, support, settings, content, blocks, notifications) handed back by agents; merging.
- 2026-11-14: Stream C2 (branch worktree-agent-afee1627d3b370618): shop portal + Your prices + Admin → Orders on the API in real sign-in (dynamic imports; demo unchanged); real shop accounts land on /partner/shop. Gaps listed in spec 04/07 § Real API mode. Browser suites still to run at merge.
- 2026-11-14: Stream D on its branch — notifications (WhatsApp switches + budget), support (customer + inbox), settings,
  site content, customer blocks, seller application (Turnstile) + invite, admin applications / invites / price queue /
  agreement, shop prices + agreement accept, all behind `AUTH_MODE === 'firebase'` with dynamic imports. Gaps: no public
  application status route, no customer search, no PIN-list endpoint, product picker still demo catalogue, partner roles
  still land in the customer area (`demoRoleFor`).
- 2026-11-14 (Stream B, branch `feat/catalogue-create-import`): `POST /v1/admin/catalogue/products` + `POST /v1/admin/catalogue/import` (dry run, all-or-nothing, SKU-idempotent, 500 rows, 30/h), Admin → Catalogue "Add product" + "Import CSV" (en + hi), runbook + sample CSV, decisions entry. No migration needed. Tests: shared 12, db 6, api 4 new; `pnpm check` green.
- 2026-11-14: Stream A built on branch `feat/workshops-service-api` (not merged): migration 0044, repos, routes, db + API
  tests, spec 06 "Built: API", spec 14 note, decisions "Workshops backend". Migration not applied to any database yet.
- 2026-11-14: Stream E on its branch (worktree-agent-aaec16f4981c2a6b9): finder + map, "Let MechDost choose", workshop
  page, booking, home top workshops, request page (proposal, per-line estimate with consent, bill, cancel), account
  services, workshop portal (propose/decline, odometer, estimate, start/ready/bill/paid/return), Admin → Services
  (route/reject) and Admin → Partners → Workshops (add/edit with Hindi + menu, publish/verify, standing, members) on
  the API; workshop accounts land on /partner/workshop. Response schemas `@mechdost/shared/service-api`. API gaps
  listed in spec 06 § Real API mode (web) (no API change). Playwright not run (low-memory machine) — run the service
  e2e at merge.
- 2026-11-14: Reviews stream on its branch (worktree-agent-a31131dde8070eb42): migration 0046 (not applied),
  repo + routes `/v1/reviews/{product|workshop}/{slug}`, `/v1/my-reviews` (eligible, submit), `/v1/admin/reviews`
  (queue, moderate), product/workshop review sections (server-rendered), "Rate" on delivered orders and paid services,
  Admin → Reviews on the API; spec 02 § Reviews, decisions "Customer reviews on the API". Playwright not run.
- 2026-11-14 (PIN codes, branch `worktree-agent-a1386983dfc859158`): service-area PIN codes admin-configurable —
  migration 0048 (`active` + reason, Hindi area name, `source`, per-PIN free-delivery threshold, `version`), admin API
  `/v1/admin/pincodes*` (`settings:read` / `cities:manage`), public `/v1/cities/{city}/pincodes`, inactive PINs refused
  by checkout / workshops / service requests / coverage, Admin → Settings → Service area + approval-form pick list
  (en + hi), reference file of Raipur PINs + `pnpm db:seed:pincodes` (not applied). Spec 15 "PIN codes", spec 03
  "Delivery charges".
- 2026-11-14: Monitoring on branch `worktree-agent-a2669c70113cd7e74`: Sentry EU (API, worker, website server, browser loaded after the first error; scrubbed; source maps uploaded in Deploy when the secret is set), PostHog EU forwarding of consented events by the worker (plain fetch), Admin → Errors (`GET /v1/admin/errors`, read-only token), consent notice `2026-11-14` naming PostHog, privacy copy en + hi. Runbook `docs/runbooks/monitoring.md`.
