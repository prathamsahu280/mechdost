# Commands, suite map and environments

## Gates (run from the repo root)

| Command                              | What it runs                                                                     | When                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `pnpm check`                         | Prettier check + typecheck + ESLint (0 warnings) + all package tests (Turborepo) | Before every commit                                      |
| `pnpm test`                          | Vitest in every package                                                          | Fast loop                                                |
| `pnpm --filter @mechdost/<pkg> test` | One package                                                                      | While working on it                                      |
| `pnpm e2e`                           | Playwright (web) — added with `apps/web`                                         | Before UI commits / CI                                   |
| `pnpm lhci`                          | Lighthouse CI budgets — added with `apps/web`                                    | Before UI commits / CI                                   |
| `pnpm db:migrate`                    | Apply migrations to `DATABASE_URL` (Supabase dev)                                | After schema changes, then run Supabase advisors via MCP |

## Suite map (what exists today, what is planned)

| Suite                                                                                    | Location                                                                                            | Status                     |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------- |
| Unit + property (money, GST, allocation, ids, invoice, IST, state machines)              | `packages/shared/test`                                                                              | ✅ 30 tests                |
| DB integrity (constraints, triggers, CAS, assignments, stock, invoices, dedupe, PostGIS) | `packages/db/test/integrity.test.ts` (PGlite)                                                       | ✅ 19 tests                |
| API (auth, RBAC, role-leak, validation, rate limits, idempotency, errors, headers)       | `apps/api/test`                                                                                     | ⏳ with apps/api           |
| Webhook chaos (Razorpay)                                                                 | `apps/api/test/webhooks`                                                                            | ⏳ with payments           |
| Concurrency on real Postgres                                                             | `packages/db/test/concurrency.pg.test.ts` (runs when `TEST_DATABASE_URL` set; CI service container) | ⏳ with CI                 |
| E2E (Playwright: chromium, webkit, mobile 390, tablet 768, desktop 1440; en + hi)        | `apps/web/e2e`                                                                                      | ⏳ with apps/web           |
| Accessibility (axe via @axe-core/playwright)                                             | `apps/web/e2e/a11y.spec.ts`                                                                         | ⏳                         |
| Visual snapshots vs concept                                                              | `apps/web/e2e/visual.spec.ts` + `docs/screenshots/concept`                                          | ⏳                         |
| Lighthouse CI                                                                            | `lighthouserc.json`                                                                                 | ⏳                         |
| RLS policy matrix (pgTAP or SQL tests)                                                   | `packages/db/test/rls.test.ts`                                                                      | ⏳ when policies are added |

## Environments

- **PGlite** (in-process Postgres 17 + PostGIS/citext/pg_trgm/btree_gist) via `@mechdost/db/testing` → `createTestDb()`. Single connection: proves constraints/triggers/CAS, not true parallelism.
- **Supabase dev** (`ewrszfqhgbrriqqggjts`) — migrations + advisors; never run destructive test data there.
- **Firebase Auth Emulator** (`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, OTP `123456`); fetch codes via
  `GET http://127.0.0.1:9099/emulator/v1/projects/<id>/verificationCodes`.
- **Turnstile test keys**: site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA` (always pass);
  `2x...` variants always fail — use both in tests.
- **Razorpay**: test mode keys only; webhook tests sign payloads locally with a test secret.

## CI (to add)

`pnpm install --frozen-lockfile` → `pnpm check` → Postgres service container + `TEST_DATABASE_URL` concurrency suite →
Playwright (sharded) → Lighthouse CI → `pnpm audit --audit-level=high`. Fail on skipped tests without a reason.
