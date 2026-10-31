# Progress ledger — read this first after any context compaction

This file is the single source of truth for **where the build is right now**. It is updated after every completed step (CLAUDE.md hard rule 13). A new or compacted session must read, in order: `CLAUDE.md` → this file → `docs/decisions.md` (incl. PENDING DECISIONS) → the spec(s) for the current task.

## Current status
- **Phase:** 0 — Setup (in progress)
- **Current task:** scaffold `packages/shared` (money/GST, state machines, ids, invoice numbers, IST time) test-first.
- **Next tasks (in order):** `packages/db` (Drizzle schema + migrations + constraint tests on PGlite) → `apps/api` (Hono skeleton: security middleware, auth, RBAC, rate limits, OpenAPI, health) → `packages/ui` tokens + `apps/web` (Next.js 16 shell, header/footer/mobile tabs, home hero, en/hi) → 8 project-local skills (`mechdost-advisor`, `website-testing`, `firebase-phone-auth-rbac`, `razorpay-payments`, `drizzle-postgis-supabase`, `msg91-messaging`, `serwist-pwa`, `next-intl-hindi`) → CI workflow + Renovate + security settings → `docs/runbooks/setup.md` (accounts the user must create) → Phase 1.
- **Blocked on user:** external accounts (Supabase, Firebase, Upstash, MapTiler, Turnstile, Resend, Vercel, GCP, Razorpay test) — not needed until DB/auth integration; Docker Desktop not installed (Supabase local needs it; PGlite used for tests meanwhile).

## Repository
- GitHub: `https://github.com/prathamsahu280/mechdost` (branch `main`). Commits must never carry AI co-author/attribution lines (hard rule 12).
- Local path: `C:\Users\Admin\Desktop\automart`. Package manager pnpm 11.28.10 (installed globally via npm). Node local v24.22.1 (engines ≥22.23.4).

## Rulings made during execution (decide → record → continue)
| Date | Ruling | Why | Cost if wrong |
|---|---|---|---|
| 2026-10-31 | Next.js **16.4.x** instead of 15 | Security research requires ≥16.4.1 (or ≥15.5.28); 16 is current; React 19.3 | Some Next 15 docs/examples differ (`proxy.ts` replaces `middleware.ts`) |
| 2026-10-31 | TypeScript **~6.0.3**, not 7.0 | typescript-eslint supports `<6.1`; TS 7 native compiler JS API not yet supported by tooling | Upgrade to 7 later when ecosystem catches up |
| 2026-10-31 | pnpm `minimumReleaseAge: 4320`, `onlyBuiltDependencies` allow-list | Supply-chain policy from security research | Newest releases (<3 days) unavailable unless excluded |
| 2026-10-31 | Tests for DB constraints run on **PGlite** until Docker/Supabase local exist | No Docker/psql on this machine | PGlite is single-connection: true concurrency tests wait for real Postgres |

## Completed log (newest first)
- 2026-10-31 — Root workspace files: `package.json`, `pnpm-workspace.yaml` (supply-chain policy), `.npmrc`, `turbo.json`, `tsconfig.base.json`, `.editorconfig`, `.prettierrc.json`, `.nvmrc`, `.gitattributes` (LF).
- 2026-10-31 — Git initialised, first commit (docs foundation) pushed to GitHub; co-author line removed via amend + force-push (user approved).
- 2026-10-31 — Tooling installed globally: 46 skills, 14 plugins, MCP playwright + chrome-devtools (cloud-run registered, needs gcloud).
- 2026-10-31 — Planning complete: CLAUDE.md, decisions, design system, concept inventories, research (5), specs (18), plan approved.

## Open questions waiting on the user
See PENDING DECISIONS in `docs/decisions.md` (payment methods; post-purchase P1 pull-forward — answer due 2026-11-01; WhatsApp handoff; vehicle master; commission; geocoding/routing bake-off; etc.).
