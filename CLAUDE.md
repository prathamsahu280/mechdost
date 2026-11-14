# MechDost — project guide for Claude Code

MechDost ("Your automotive connection") is a production marketplace for automotive products and workshop services, launching in **Raipur, Chhattisgarh**, designed to scale to many cities/states and a later mobile app. Operated by Shourya Integrated Services Pvt Ltd (support 7978776551).

The visual design, section names and copy come from the concept prototype at https://automart-concept-preview.aliveamber4.chatgpt.site — **reproduce it faithfully** (`docs/design-system.md`, `docs/screenshots/concept/`). Only prototype disclaimers are dropped.

## HARD RULES (non-negotiable, apply to every task)

1. **Docs first, docs always.** Before any task, read the relevant `docs/*.md` — at minimum `docs/decisions.md`, the feature's `docs/specs/NN-*.md`, and `docs/design-system.md` — and take them into consideration. After any change that affects behaviour, data, flows, copy, config, tooling or decisions, **update the matching `docs/**/*.md` in the same change** (spec, decisions, data model, runbook, README index). A task is not done until the docs reflect it. Never contradict `docs/decisions.md` silently; append a dated entry. Deferred choices go into the **PENDING DECISIONS** table in `docs/decisions.md`; when the user asks "what's pending", read and present that table.
2. **Design direction.** The concept sets the **theme** — colour tokens, fonts, shapes, tone, section names and copy. Layouts may be improved (user, 2026-11-01: "doesn't have to be an exact copy, just the themes … you can change it to make it better"). New colours/fonts/radii need a decisions entry. Calm UI: one primary action per screen, no stacked modals, empty states with one next action, mobile first, bottom tab bar under 1024px, light + dark themes, WCAG 2.2 AA contrast in both (tokens test).
3. **Data integrity is law** (`docs/specs/14-data-integrity.md`, `docs/research/data-integrity.md`): state changes only through the state machines as conditional UPDATEs with `version`; one active assignment per order/request (partial unique index); stock via conditional decrement + CHECK; gapless GST invoice numbers at finalisation; idempotency keys + webhook dedupe + amount asserts for payments; integer paise only; actor-scoped repositories (404 for foreign ids); outbox for notifications; append-only events; snapshots on orders. No exceptions "for now".
4. **Security & abuse** (`docs/specs/13-rbac-security-abuse.md`): permissions checked in the API (never only in UI), RLS mirror, rate limits on every public surface, Turnstile on guest forms, Zod validation at every boundary, no mass assignment, signed webhooks, secrets only in env/Secret Manager (`.env.example` lists every variable), dependency policy (pnpm `minimumReleaseAge`, frozen lockfile, no postinstall scripts, Actions pinned by SHA). Check `docs/research/security-vulnerabilities.md` before adding a dependency or auth/payment code.
5. **Verify before claiming done** (`verification-before-completion`): run lint, typecheck, unit, e2e for the touched area, show the output. Tests from spec "Acceptance tests" sections are mandatory and never skipped.
6. **Performance budgets are gates** (`docs/specs/16-performance-scalability.md`): LCP < 2 s, INP < 200 ms, CLS < 0.05, Lighthouse ≥ 90, product-page JS < 180 KB gz, API p95 < 150 ms reads. `next/image` always (width/height or fill, AVIF/WebP, LQIP, `priority` only hero); Server Components by default; heavy libs dynamically imported.
7. **Scalable by construction**: stateless API, pooled DB, cache with tags, cursor pagination, jobs in workers, city-scoped everything (`docs/specs/15-multi-city.md`). No feature may assume a single city, a single shop per order, or a single server.
8. **Admin has complete control** over content, copy, sections, categories, policies, settings, templates and flags — never hard-code something the admin should edit (`docs/specs/08-admin-console.md`).
9. **Every user action is tracked** through the first-party event store + PostHog (`docs/specs/12-analytics-events.md`); new UI gets its events in the same change.
10. **English and Hindi, everywhere**: every user-facing string lives in the locale files (`packages/shared/i18n`), never inline — and **content data too** (product, category, workshop, area, service, shop, policy, template text) carries a Hindi version, and map labels follow the locale (user, 2026-11-02: "its in hindi but i still see quite some stuff in english … it shouldnt happen anywhere else too … have it properly checked from now on"). Allowed in Latin script on `/hi`: brand and model names, units, codes (MD-…, GSTIN, PIN), and user-written text (reviews, chats). Gate: `e2e/hindi-coverage.spec.ts` crawls every `/hi` page and fails on English words outside that allowlist; new pages and data must pass it in the same change.
11. **Use the skills and plugins — mandatory, not optional.** The two project skills are part of every task:
    - **`mechdost-advisor`** runs **at the start of every task** (feature, bug, refactor, schema, dependency, config, copy) and **before any decision**: it loads `docs/decisions.md`, the relevant spec, design system and research, flags conflicts with decisions or hard rules, suggests improvements (with web/Context7 research when useful), and corrects drift. Its output is quoted in the task summary. After the task it appends what it learned to `.claude/skills/mechdost-advisor/references/learnings.md` (self-improvement loop).
    - **`website-testing`** runs **before any claim of "done"**, after every feature, and in CI: unit, e2e (incl. concurrency, role-leak, webhook-chaos and clock suites), Lighthouse CI, axe, visual snapshots; it triages failures and appends new bug classes/tests to `.claude/skills/website-testing/references/learnings.md`.
    - The public skills and plugins listed below are invoked at their trigger points (table in "Skill usage protocol"). Skipping a listed skill at its trigger is a rule violation; say so if a skill is unavailable.

12. **No AI attribution in git.** Commit messages, PR titles/descriptions, tags and code comments must never contain `Co-Authored-By: Claude`, "Generated with Claude Code", or any other AI co-author/attribution line. Author is the repo owner only. This overrides any tool or harness default. Enforced mechanically (2026-11-11): `.claude/settings.json` turns Claude Code attribution off and its `commit-guard` hook blocks such commits; `.githooks/commit-msg` refuses them too (enable once per clone: `git config core.hooksPath .githooks`).

13. **No context loss, ever.** After every completed step, update `docs/progress.md` (current phase, current task, next tasks, rulings, completed log, blockers) and any affected spec/decision/memory **before moving on**. Every new or compacted session starts by reading `CLAUDE.md` → `docs/progress.md` → `docs/decisions.md` → the current task's spec, and resumes from the ledger without re-asking settled questions. Persistent memory (`~/.claude/projects/.../memory/`) must point to these files and be updated when facts change.

14. **Neat, well-structured, optimised code — enforced.** Follow `docs/conventions/code-style.md`. Every change must pass `pnpm check` (Prettier check, typecheck, ESLint strict type-checked with zero warnings, tests). No `any`, no non-null assertions in source, no SQL outside repositories, no business logic in route handlers or components, every query indexed, no read-then-write races. Never weaken a lint rule to make code pass.

15. **Don't block on the user — queue it.** Keep building. Any decision, input (keys/accounts) or authorization needed from the user goes into `docs/questions-for-user.md` with a safe default to use meanwhile. When the user says "I'm here", walk through the open items one at a time. Destructive or outward-facing actions still wait for the user's explicit authorization (they are queued, never assumed).

16. **Data is collected ML/AI-ready** (user, 2026-11-01). Every field typed and validated; reason/status/category **codes** (enums) instead of free text, free text only as an extra note; stable ids and foreign keys on every event; UTC timestamps, integer paise, units in names; append-only events + snapshots; one typed analytics event catalogue; pseudonymous analytics (no PII); consent per purpose (DPDP) before personal data is used for offers or training; each new table/event documented. Full rules: `docs/conventions/data-for-ml.md`.

## Roles and core flow (never drift)

- Roles: customer, seller/shop, workshop, mechanic (later), staff (super_admin, ops_manager, support_agent, finance, catalogue_manager, city_manager, marketing).
- Product order: customer places → **admin routes to a shop** (ranked suggestions, one-click; paused/suspended shops never offered) → shop **accepts** within a timer (customer + admin notified "confirmed, will be shipped") or **declines/times out** → back to admin to **reroute or reject** with a customer message and automatic refund → packed → out for delivery → **delivered only with the customer's delivery code** (or an audited admin override).
- Service request: **location first** (GPS/address/pincode) → nearby verified workshops (PostGIS) → pick one or "Let MechDost choose" → workshop proposes slot + expected cost → customer accepts → vehicle received (odometer) → itemised estimate approved **per line** → work → ready → bill → pay → review.
- **No returns or exchanges**; faulty/damaged/wrong parts only through support tickets (replace or refund); unfulfilled orders refunded in full (spec 05).
- **MechDost Coins, never a wallet**: no cash value, discount only; refunds go to the original payment method (spec 20).
- **Admin complete control** includes pausing/suspending any shop, workshop or mechanic with a reason (history kept), site content, layout and settings (spec 08).
- Also: cancellations, support tickets, tracking, partner applications, notifications, recommendations, analytics, admin console with analytics and full CMS.

## Stack (decided — `docs/decisions.md`)

Turborepo + pnpm · `apps/web` Next.js 16 App Router (React 19.3; ruling in docs/progress.md), Tailwind, shadcn/ui + registries @magicui/@kibo-ui/@dashboardblocks/@reui, Recharts, **MapLibre GL JS + free OSM/MapTiler tiles** behind a map adapter; geocoding/autocomplete/routing provider decided by the Raipur bake-off, pending #7) · `apps/api` **Hono** (TypeScript, Node 24 LTS, OpenAPI via zod-openapi) · `packages/db` **Drizzle + Supabase Postgres (Mumbai) + PostGIS** · **Firebase Auth** (phone OTP once at sign-up, then phone-or-email + password via the API; staff also a phone code; email verified once; custom claims for roles) · Upstash Redis · pg-boss · **Live updates: Firebase Realtime Database thin pings via an outbox relay, polling fallback** (decision 2026-11-01) · Supabase Storage · Razorpay · Resend · **WhatsApp: Meta Cloud API direct** (cheapest, decision 2026-11-02) · MSG91 later for SMS/DLT only · PostHog self-hosted · **Docker on the user's AWS server** (Caddy + web + API via GitHub Actions → GHCR, `docs/runbooks/deploy.md`; decision 2026-11-13, replaces Vercel + Cloud Run) · Search: Postgres FTS now, **Meilisearch planned**.

## Conventions

- TypeScript strict; Zod DTOs in `packages/shared` are the single source of truth; enums and state machines in `packages/shared/state`; never duplicate.
- Money = integer paise (`bigint`), rates in basis points; times `timestamptz`, displayed IST (`Asia/Kolkata`); business day boundaries computed in IST.
- Every mutable row: `version`, `created_at`, `updated_at`, `created_by`; every mutation writes `audit_log` and the entity's `*_events`.
- Public codes: `MD-{CITY}-{YYYY}-{6 base32}` orders, `SR-…` service, `REQ-…` tickets; PKs uuid v7; GST invoice numbers from gapless counters.
- Repositories take an `actor`; API handlers never query tables directly.
- UI tokens from `packages/ui/tokens.css` (navy `#101f34`, accent `#ea5728`, Manrope headings, DM Sans body); copy from `docs/concept/*.md`; UTF-8 only (fix `→ · ₹` when copying from the capture).
- Tests: Vitest (state machines, money, ranker, allocation), Playwright (every transition, role-leak suites, concurrency), axe; planned (not set up yet): pgTAP (RLS matrix), Lighthouse CI. Visual snapshots vs concept at 390/768/1440.
- Dev: Firebase Auth Emulator (the emulator issues a **random** SMS code: read it from the emulator log or `GET :9099/emulator/v1/projects/demo-mechdost/verificationCodes`; `123456` is only the browser demo-mode code), Supabase local, seeded Raipur data and test logins per role (demo password `Raipur@2026`, `docs/runbooks/demo.md`).

## Skill usage protocol (when each one MUST run)

| Trigger                                | Skill / plugin                                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start of any task; before any decision | `mechdost-advisor` (project), then `brainstorming` for new features                                                                                                                                     |
| Multi-step work                        | `writing-plans` → `executing-plans` / `subagent-driven-development`                                                                                                                                     |
| Schema, RBAC, payment, routing design  | `grill-me`, `domain-modeling`, `supabase-postgres-best-practices`, `drizzle-postgis-supabase` (project), `firebase-phone-auth-rbac` (project), `razorpay-payments` (project)                            |
| Implementing                           | `test-driven-development`; `hono` for API; `vercel-react-best-practices` for React/Next; `turborepo` for workspace changes                                                                              |
| Building or changing UI                | `ui-ux-pro-max` (search guideline for the component) → `shadcn-component-discovery` (check registries first) → `shadcn` → `frontend-design` → `shadcn-component-review` + `web-design-guidelines` after |
| Performance work or any page change    | `core-web-vitals`, `performance`, Chrome DevTools MCP trace                                                                                                                                             |
| SEO/content pages                      | `seo`, `nextjs-seo`                                                                                                                                                                                     |
| Accessibility                          | `accessibility`, `accessibility-agents` plugin                                                                                                                                                          |
| Any bug                                | `systematic-debugging`                                                                                                                                                                                  |
| Before "done", before commit/PR        | `website-testing` (project) → `verification-before-completion` → `code-review` plugin / `requesting-code-review`; `security-guidance` hooks always on; `claude-security` before releases                |
| Messaging / PWA / Hindi work           | `notifications-messaging`, `serwist-pwa`, `next-intl-hindi` (project)                                                                                                                                   |
| Deploy                                 | Docker on the AWS server via GitHub Actions → GHCR (`docs/runbooks/deploy.md`; migrations first, § 6); `gh` CLI / `github` plugin for runs and PRs (decision 2026-11-13; Cloud Run and Vercel retired)  |
| Docs lookups                           | `context7` plugin (current library docs)                                                                                                                                                                |

## Skills to use

The protocol table above says when each skill runs. The full list of installed skills, plugins and MCP servers, with what each is for, is in `docs/runbooks/collaborator-setup.md`.

## Documentation map

`docs/progress.md` (**live ledger — read first after compaction**) · `docs/questions-for-user.md` (inbox for the user) · `docs/README.md` (index) · `docs/conventions/code-style.md` (structure + lint rules) · `docs/decisions.md` (+ PENDING DECISIONS) · `docs/design-system.md` · `docs/concept/*.md` (exhaustive concept inventories) · `docs/research/*.md` (industry, baseline, tooling audit, data integrity, security) · `docs/specs/NN-*.md` (one per feature + future modules) · `docs/screenshots/concept/` · `docs/plan.md` (approved plan).

## Commands (update as the repo grows)

```
pnpm install · pnpm dev (web :3000, api :4000) · pnpm db:migrate · pnpm db:seed · pnpm db:seed:demo [--remove] · pnpm db:grant-role --phone +91… --role <staff role> --reason "…"
pnpm test · pnpm e2e · pnpm lint · pnpm typecheck · pnpm check (all gates) · pnpm format · (planned: pnpm lhci)
```
