# Collaborator setup (code + Claude Code)

For anyone joining the MechDost repo. Accounts and API keys are in [`setup.md`](setup.md); the demo walkthrough is in [`demo.md`](demo.md).

## 1. Run the website

Needs **Node 24.22.1 or newer** (CI uses 24.22.3 from `.nvmrc`), **pnpm 11.28.10**, Git and Chrome.

```powershell
npm install -g pnpm@11.28.10
git clone https://github.com/prathamsahu280/mechdost.git
cd mechdost
pnpm install
git config core.hooksPath .githooks   # once per clone: refuses commits with unformatted files
pnpm --filter @mechdost/web build
pnpm --filter @mechdost/web start          # http://localhost:3000
```

For live reload while coding use `pnpm --filter @mechdost/web dev` instead of build + start. The site runs on demo data with no keys; demo logins (code `123456`) are in [`demo.md`](demo.md).

Before every commit: `pnpm check` (format, typecheck, lint, unit tests). End-to-end tests: `pnpm --filter @mechdost/web e2e` (builds must be current).

**`.env`:** not needed for the demo website. For database work (`pnpm db:migrate`, `pnpm db:seed`) and the API, the owner shares the **dev** `.env` with you directly over a private channel (password manager or one-to-one encrypted message). It holds the dev database password and the Supabase secret key (full access to the dev database), so: keep it only in the repo root (`.env` is git-ignored), never commit, paste or forward it, and tell the owner if it leaks so both are rotated. Production keys are never shared this way (Secret Manager / Vercel only). The shared dev `.env` must include the same `DATA_ENCRYPTION_KEYS`, `DATA_ENCRYPTION_KEY_ID` and `DATA_INDEX_KEY` as everyone else, or encrypted dev data cannot be read.

## 2. Claude Code: what you get automatically

Opening the repo in Claude Code loads, with nothing to install:

- **`CLAUDE.md`**: the 15 hard rules and the skill usage protocol. Read it once yourself.
- **Project skills** in `.claude/skills/`: `mechdost-advisor`, `website-testing` and six domain skills. See [`.claude/skills/README.md`](../../.claude/skills/README.md).
- **`.mcp.json`**: the Supabase MCP for the **dev** project (optional). It signs in with a Supabase account via `/mcp`, not with `.env` keys, so it only works if the owner adds you to the project; without it, use `pnpm db:*` scripts with the shared `.env`. No keys are stored in the repo.

Commits and PRs must never carry AI co-author or "Generated with" lines (hard rule 12).

## 3. Claude Code: public skills to install once

The protocol in `CLAUDE.md` calls these at fixed trigger points. Install them for your user (global), choosing Claude Code when asked:

```powershell
npx skills add nextlevelbuilder/ui-ux-pro-max-skill      # ui-ux-pro-max
npx skills add obra/superpowers                          # brainstorming, writing-plans, TDD, systematic-debugging, verification-before-completion, …
npx skills add shadcn/ui                                 # shadcn
npx skills add mattbx/shadcn-skills                      # shadcn-component-discovery, shadcn-component-review
npx skills add vercel-labs/agent-skills                  # vercel-react-best-practices, web-design-guidelines
npx skills add vercel/turborepo                          # turborepo
npx skills add supabase/agent-skills                     # supabase-postgres-best-practices
npx skills add honojs/skills                             # hono
npx skills add antfu/skills --skill vitest               # vitest
npx skills add currents-dev/playwright-best-practices-skill
npx skills add addyosmani/web-quality-skills             # web-quality-audit, performance, core-web-vitals, accessibility, seo, best-practices
npx skills add laguagu/claude-code-nextjs-skills         # nextjs-seo
npx skills add maplibre/maplibre-agent-skills            # maplibre-fonts-glyphs
npx skills add mattpocock/skills                         # grill-me, domain-modeling
npx skills add google/skills                             # cloud-run-basics (deploy work only)
```

## 4. Claude Code: plugins

```powershell
claude plugin install context7@claude-plugins-official
claude plugin install supabase@claude-plugins-official
claude plugin install vercel@claude-plugins-official
claude plugin install code-review@claude-plugins-official
claude plugin install security-guidance@claude-plugins-official
claude plugin install frontend-design@claude-plugins-official
claude plugin install typescript-lsp@claude-plugins-official
claude plugin install modern-web-guidance@claude-plugins-official
claude plugin install posthog@claude-plugins-official
claude plugin install claude-security@claude-plugins-official
claude plugin install github@claude-plugins-official          # optional; needs a GitHub token (inbox Q14)

claude plugin marketplace add firebase/agent-skills
claude plugin install firebase@firebase
claude plugin marketplace add google/skills
claude plugin install google-cloud-developer@google-plugins
claude plugin marketplace add Community-Access/accessibility-agents
claude plugin install accessibility-agents@community-access
```

## 5. Claude Code: browser and deploy tools (MCP, user scope)

```powershell
claude mcp add --scope user playwright -- npx @playwright/mcp@latest
claude mcp add --scope user chrome-devtools -- npx chrome-devtools-mcp@latest
claude mcp add --scope user cloud-run -- npx -y @google-cloud/cloud-run-mcp      # deploy work only
```

## 6. Working agreements

- Start every task from `docs/progress.md` (the live ledger) and update it when you finish a step (hard rule 13).
- Questions for the owner go into `docs/questions-for-user.md` with the default you used meanwhile (hard rule 15).
- When a skill teaches you something, append one line to its `references/learnings.md` in the same commit.

## Skills, plugins and MCP servers (moved from CLAUDE.md, 2026-11-11)

- Workflow (superpowers): `brainstorming` before new features · `writing-plans` before multi-step work · `grill-me` before schema/RBAC/payment designs · `test-driven-development` when implementing · `systematic-debugging` on bugs · `verification-before-completion` before "done" · `requesting-code-review` after features · `domain-modeling` for GLOSSARY/ADRs.
- UI: `ui-ux-pro-max` (search guidelines/stack rules per component), `frontend-design`, `web-design-guidelines` (pre-PR audit), `shadcn` + `shadcn-component-discovery` (check registries before building) + `shadcn-component-review` (after), `vercel-react-best-practices`.
- Backend/data: `hono`, `supabase-postgres-best-practices` (before any schema change), `turborepo`, `cloud-run-basics`.
- Quality: `playwright-best-practices`, `vitest`, `core-web-vitals`, `performance`, `accessibility`, `seo`, `nextjs-seo`, `web-quality-audit`, `best-practices`, plugins `code-review`, `security-guidance`, `claude-security`, `accessibility-agents`.
- Project-local (in `.claude/skills/`, written 2026-10-31): `mechdost-advisor` (loads docs, checks decisions/specs/design, researches improvements, flags drift; **self-improving** via `references/learnings.md`), `website-testing` (runs/triages all suites; knows e-commerce bug classes; self-improving), `firebase-phone-auth-rbac`, `razorpay-payments`, `drizzle-postgis-supabase`, `notifications-messaging`, `serwist-pwa`, `next-intl-hindi`.
- MCP: playwright, chrome-devtools, shadcn (after `components.json`), cloud-run; context7/supabase/vercel/github/firebase via plugins. Razorpay MCP later.
