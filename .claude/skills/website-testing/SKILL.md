---
name: website-testing
description: MechDost test lead. MUST run before claiming any MechDost work is done, after every feature or bug fix, when a test fails, and when setting up CI. Maps the change to the right test suites (unit, property, DB integrity, API, e2e, concurrency, role-leak, webhook chaos, clock, accessibility, visual, Lighthouse/Core Web Vitals, i18n), runs them, triages failures with systematic debugging, adds a regression test for every bug, checks the change against a catalogue of known e-commerce/marketplace bug classes, and grows that catalogue via references/learnings.md.
---

# Website Testing (MechDost)

You own quality for MechDost. "Done" means **proven**: the relevant suites ran, their output was read, and
every acceptance test in the feature's spec exists and passes. You know the ways e-commerce and marketplace
sites break (`references/bug-catalogue.md`) and you test for them before users find them.

## When to run

- Before saying a task is done, before every commit that changes behaviour, before every PR/deploy.
- After every feature or bug fix (a fix without a failing-then-passing regression test is not a fix).
- Whenever a test fails or is flaky — hand off to `systematic-debugging`, never to retries or skips.
- When adding CI or a new package (wire its suites into `pnpm check`).

## Procedure

### 1. Map the change to suites

Use `references/commands.md` § Suite map. At minimum: `pnpm check` (format, typecheck, lint 0 warnings, all
unit/integration tests). Then add, by area:

- money/state/ranking logic → unit + **property tests** (fast-check)
- schema/SQL/repositories → **DB integrity tests** (PGlite), migration applies on a fresh DB, Supabase advisors
- API routes → API tests via `app.request()` incl. auth, **role-leak matrix**, validation, rate limits, idempotency
- order/assignment/stock/payment flows → **concurrency** and **clock** suites
- payments/webhooks → **webhook chaos** suite (replay, out-of-order, tamper, rotated secret)
- UI → Playwright e2e at 390/768/1440, **axe** scan, keyboard path, **visual snapshot vs concept**, Hindi locale
- pages → **Lighthouse CI** budgets (LCP < 2 s, INP < 200 ms, CLS < 0.05, ≥ 90 scores, JS budget)

### 2. Check the bug catalogue

Open `references/bug-catalogue.md`, find every section the change touches, and confirm each listed bug class
has a test (existing or added now). Missing coverage for a touched class is a blocker, not a TODO.

### 3. Check the spec's acceptance tests

Every "Acceptance tests" bullet in `docs/specs/NN-*.md` for the touched feature must map to a named test.
List the mapping in your summary.

### 4. Run and read

Run the suites (commands in `references/commands.md`). Read the actual output: counts, failures, warnings,
skipped tests. **Never** claim success from a partial run, a cached result you didn't verify, or "should pass".
Skipped/`.only`/`.todo` tests are failures unless documented in `docs/progress.md` with a reason and date.

### 5. Triage failures

Use `systematic-debugging`: reproduce → isolate → hypothesis → fix root cause → regression test. Flaky tests
are bugs: find the race/clock/order dependency (see catalogue § Test-suite hygiene). Never raise timeouts or
add retries to make a test pass without explaining the cause.

### 6. Report

```
TEST REPORT — <task>
Suites run: <name: passed/failed/skipped counts>
Acceptance tests (spec NN): <bullet → test name>
Bug classes covered: <catalogue ids touched → test names>
New tests added: <names>  ·  Regression tests for bugs fixed: <names>
Gaps / follow-ups: <anything not covered + why, also recorded in docs/progress.md>
```

### 7. Learn and improve (self-improvement loop)

1. Every bug found (by tests, review, or the user) → append to `references/learnings.md`:
   `T<n> · <date> · <area> · <bug> · <root cause> · <test that now guards it>`.
2. If it is a new _class_ of bug, add it to `references/bug-catalogue.md` with a test recipe and log in
   `references/changelog.md`.
3. If the same class appears twice, add an automated guard (lint rule, DB constraint, shared test helper) so it
   cannot recur, and note it in the catalogue.
4. Keep `references/test-recipes.md` current with the helpers that actually exist in the repo.

## References

- `references/commands.md` — suite map, commands, environments, CI gates.
- `references/bug-catalogue.md` — e-commerce/marketplace bug classes with the test that catches each.
- `references/test-recipes.md` — reusable patterns (concurrency, property, webhook chaos, clock, role matrix, a11y, visual, Lighthouse).
- `references/learnings.md` — bugs found and how they are now guarded (append-only).
- `references/changelog.md` — changes to this skill.
