# UI state audit coverage: navigation, recent features, API-mode fixture (2026-11-15)

Goal (user 2026-11-15): the states render tests must cover navigation and every recent feature, including screens
that exist only with real sign-in. Anchors: runbook `docs/runbooks/ui-test-catalogue.md` § 9, research
`docs/research/ui-testing-gap-2026-11-14.md`, Q101, Q106, decisions "2026-11-15 Test runs and GitHub Actions
minutes" (the full audit is manual only; no new per-push CI job).

## Tasks (test first where the code is pure)

1. **Nav helpers** `e2e/state-audit/nav.ts` (pure: current item from a path, expected-current rule) with a unit test
   `test/state-audit-nav.test.ts` written first.
2. **Nav components** in `model.ts` (new check `nav`: exactly one current marker where the route is a nav target,
   current item visible in an overflowing bar, targets at least 24 px, and with `walk=yes` every item opens its page
   marker): `NAV-HEADER`, `NAV-TABBAR`, `NAV-ACCOUNT`, `NAV-ADMIN`, `NAV-CATEGORY`, `NAV-FOOTER`; widths 320 to 1920,
   en/hi, roles, light/dark. Unit test: the section lists in the model match `src/lib/sections.ts` per build mode.
3. **Demo rows for onboarding** (partners page tabs, invites, price requests, agreement): `ADM-PARTNERS-TABS`.
4. **API-mode config** (`playwright.state-audit-api.config.ts`, `e2e/state-audit/api-mode/`): real-mode build into a
   separate `distDir`; signed-in session by seeding Firebase's own persisted user (IndexedDB) and answering
   Firebase's two token endpoints with `page.route`; every `/v1/*` call answered from typed fixtures parsed with the
   shared Zod response schemas (drift throws); an unmocked call is a failing finding. No production code switch.
5. **API rows** (`model-api.ts`): refunds, order refund line, shop give-up, warnings, reroute queue, admin shops,
   shop hours, analytics, errors, bulk quotes desk, coins, reviews, PIN admin, real-mode navs. Fixture contract test
   `test/state-audit-api-fixtures.test.ts`.
6. Docs (runbook § 9, checklist regenerated, progress, Q106 note, website-testing learnings), `pnpm check`, smoke.
