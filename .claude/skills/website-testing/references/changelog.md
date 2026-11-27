# website-testing changelog

- 2026-10-31 — v1: procedure (map → catalogue → acceptance → run → triage → report → learn), bug catalogue
  (13 sections, 70+ classes with tests), commands and suite map, test recipes, seeded learnings T1–T4.
- 2026-11-14 — T68 promoted: § 3a item 9 (geometry, interactions, data shapes, grid widths) and the UI state audit in the suite map (§ 1).
- 2026-11-15 — Bug catalogue E9 (uncertain provider outcome frees the money) and E10 (our own refund id on a webhook parked or ignored) added after the refunds security review; learnings T71, T72.
- 2026-11-15 · UI state audit also covers every navigation bar (`NAV-*`, check `nav`) and the real-sign-in screens in a second config on a mocked API (`API-*`, chunk G, runbook § 9.7). Bug classes N9, N10, learning T79.
- 2026-11-15 - Bug catalogue section O (live updates: stale ping after sign-out, ping for another uid, connection while hidden, duplicates, bundle leak, polling kept, CSP origin) and a live-listener recipe, after the browser listener build; learning T145.
- 2026-11-16 - Bug catalogue section P (client message bundles) and learning T149 after the second raw-keys bug; the coverage guard test is a standing gate.
- 2026-11-26 - Bug catalogue section Q (sr-only escaping scroll boxes, observers that fight the user, e2e literals left behind by copy rulings) and learnings T-QA5a-c, T-FX5.
- 2026-11-27 - Bug catalogue section T (promoted repeats): T1 raw Date in SQL (T169, T-DATE2; guard `rejectDateParams`),
  T2 per-file tree-shaking (T-SAV2, T-BUDGET2), T3 Hindi crawl render path (T-NIGHT1, T-SAV1), T4 stale ID token
  (T-DCSIM-P3 + SIM-LEAD-1), T5 short test bearer tokens (T221, T-USAGE1, T-COD1), T6 demo/API contract drift (T-DLV3,
  T-DLV-1, T-DCSIM-P1), T7 error codes without messages (T-DCSIM-P4, T-DCSIM-L2), T8 notice links (T-QA-A1, T-RT2),
  T9 e2e port/locale leaks (T-FX5, T-FX6, T-P23c), T10 per-user limits in shared tests (T-QA-A3), T11 worktree tsc
  (T-B3). Learnings marked "promoted"; missing guards listed in `docs/progress.md` "Guards to add".
