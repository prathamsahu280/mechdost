# Code style and structure (CLAUDE.md hard rule 14)

Neat, consistent, optimised code is enforced by tooling, not by memory. A change is not done until
`pnpm check` passes (format check + typecheck + lint with zero warnings + tests).

## Tooling
- **Prettier** (`.prettierrc.json`): single quotes, trailing commas, width 110. Run `pnpm format`.
- **ESLint** (`eslint.config.mjs`): `typescript-eslint` strict + stylistic **type-checked** rules, `eqeqeq`,
  `prefer-const`, consistent `import type`, no unused vars, no floating promises, no unnecessary casts or
  conditions. `--max-warnings=0` in every package. Never disable a rule inline without a comment explaining why.
- **TypeScript**: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. No `any`; prefer `unknown` + narrowing.

## Repository layout
```
apps/web        Next.js (App Router) — routes, Server Components, UI only; calls the API
apps/api        Hono — routes → validated DTOs → services → repositories; no SQL in handlers
packages/shared Pure TS: money, time, ids, invoice numbers, state machines, Zod DTOs, i18n. No I/O.
packages/db     Drizzle schema, migrations, repositories (the ONLY place that writes SQL), test harness
packages/ui     Design tokens + primitives (shadcn-based)
packages/notify Notification channel adapters + templates
docs/           Decisions, specs, research, runbooks, progress ledger
```

## Rules of thumb
- **One responsibility per file**; files over ~300 lines get split by concept, not by type.
- **Pure core, thin edges**: business rules live in `packages/shared` (pure, unit-tested); I/O lives at the
  edges (repositories, adapters, route handlers).
- **Repositories own SQL**: every state change goes through a repository function that takes an `actor`,
  uses a conditional UPDATE with `version`, and maps Postgres errors via `mapPgError`.
- **No non-null assertions in source**: check and throw a typed error instead (`NotFoundError`, `ConflictError`).
- **Name things for the domain** (`acceptAssignment`, not `updateRow`); comments explain *why*, not *what*.
- **Optimise deliberately**: index every foreign key and every query filter; single round-trip conditional
  updates instead of read-then-write; cursor pagination; no N+1 (batch or join); measure before micro-tuning.
- **Tests sit next to their package** (`test/*.test.ts`), named after behaviour, not functions.
