# mechdost-advisor changelog

- 2026-10-31 — v1: procedure (load context → classify → review → research → brief → learn), checklist per area,
  task-to-docs map, research playbook with improvement sweep, seeded with 14 learnings from Phase 0.
- 2026-11-01 — Promoted L10/L11/L18 (shell escaping) into checklist § Tooling.
- 2026-11-01 · Promoted L12 + L39 into checklist "Docs & process": after a superseding decision, grep CLAUDE.md, docs/README.md, design-system.md and memory for the old wording.
- 2026-11-03 — checklist: added "Demo/API parity" (L58, from the retrospective review that found the paused-shop accept gap).
- 2026-11-03 — Improvement sweep run (research-playbook § Sweep): security releases/advisories recorded in docs/research/security-vulnerabilities.md § Sweep 2026-11-03; added L63; learnings reviewed (no stale entries removed).
- 2026-11-04 — checklist § Tooling: added commit-gate pipefail rule (T44 + L64) and invisible-character rule (L65).
- 2026-11-13 — checklist § Performance: JS budget import rule promoted from L79 + L90 (comparison pushed /shop over 180 KB via client-imported demo data and translations).
- 2026-11-14 · checklist UI/UX: state matrix + five bug classes from the UI review (fixed-in-transform, <html> attributes on locale change, header widths, inner scroll boxes, every-page imports). website-testing step 1: state matrix + runbook `docs/runbooks/ui-testing.md`.
- 2026-11-16 - L234 promoted: client-messages coverage guard is part of the i18n check (hard rule 10).
- 2026-11-26 — checklist § UI/UX: retry/refresh focus rule promoted from L-G2d + L-SAV3 (savings card, G2 console).
- 2026-11-27 — Self-improvement step over the 2026-11-26/27 learnings. New learnings L319–L323 (skills skipped under a
  timebox, Turnstile key order, outbox count for QA, WhatsApp test range, inbox from the DB row). Promoted:
  § UI/UX focus-on-swap rule (L-B2, L-UCE2, L-UDW1, L-UDM1, L-P23e, L-USAGE2, L-DLV3); § Performance per-file
  tree-shaking (T-SAV2, T-BUDGET2); § Docs & process skill invocation (L199, L319) and verify-briefs-against-code
  (L-FX3, L-UDW3, L-DCSIM1); § Tooling drizzle-kit snapshot overwrite (L-USAGE1, L-DA1, L-B5, L-QA1, L-QA-A4),
  `.openapi()` on shared Zod (L101, L113, L313 api/zod, L317 api/zod), fresh-worktree typecheck (T-B3, L318
  worktree), Windows scripts (L311, L-G2c, L-P23d, L-UA3, L-UF3, L-COD3, L-DA2, L-QA-A4); new § Live QA runs
  (L-SIM1, L315 QA, L-SIMF1, L-DCSIM1, L-DCSIM2 conducting, L317 delivery/web, L320–L323). Guards still owed:
  `docs/progress.md` "Guards to add" (2026-11-27).
