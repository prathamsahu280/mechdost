# Admin CSV exports (item 4) Implementation Plan

> For agentic workers: implement task by task, test first. Steps use checkboxes.

**Goal:** Staff download CSV exports of orders, sub-orders, refunds, service requests, partners and customers (masked unless `customers:read_pii`), audited, bounded to 180 days, link valid 10 minutes.

**Architecture:** `POST /v1/admin/exports` validates, counts (capped), writes `audit_log` + analytics event, and returns a signed 10-minute token path. `GET /v1/admin/exports/download?t=` re-authenticates the same staff member, re-checks permission and city scope, then streams keyset pages as CSV (BOM, RFC 4180, formula-neutralised). No pg-boss/storage hop (ruling: the file is never stored, so there is nothing to leak at rest; the design's storage route is the alternative if files must be shared).

**Tech Stack:** Hono + zod-openapi, Drizzle raw SQL in a repository, PGlite tests, Next.js admin screen.

**Spec:** docs/superpowers/specs/2026-11-15-admin-next-tier-design.md (CSV exports bullet), docs/specs/08, 12, 13, 14.

## Global Constraints

- Integer paise in the DB; file shows `<x>_rupees` (two decimals, string maths) and `<x>_paise`.
- Max 180 days inclusive, IST day boundaries; cap 50,000 rows; indexed keyset reads (migration adds 3 indexes).
- Permission `exports:run` plus the dataset's read permission; city scope from the grants; customers need an all-cities grant.
- en + hi strings; analytics events in the same change; no AI attribution in commits.

## Review Focus

- Formula cells (`=`, `+`, `-`, `@`, tab, CR) neutralised: csv tests.
- Hindi opens in Excel: BOM test.
- A city-scoped manager asking for another city: 404; support agent / shop / customer: 403.
- Token of one staff member used by another, expired, tampered: rejected.
- Range over 180 days, reversed, impossible date: 422.

### Task 1: shared helpers and permission

Files: packages/shared/src/exports.ts, rbac.ts, analytics.ts; test packages/shared/test/exports.test.ts.

- [ ] failing csv/range/paise tests; implement; run vitest.

### Task 2: repository

Files: packages/db/src/repo/exports.ts, schema indexes + migration; test packages/db/test/exports.test.ts.
Produces: `countExportRows`, `exportPages`, `recordExportRequest`, `recordExportDownload`.

- [ ] failing tests per dataset (columns, masking, city scope, window edges, keyset paging, cap); implement; run.

### Task 3: API

Files: apps/api/src/routes/admin-exports.ts, export-token.ts, app.ts; test apps/api/test/admin-exports.test.ts.

- [ ] role-leak, scope, token, stream, audit tests; implement; run.

### Task 4: web screen and docs

Files: admin Exports tab, locale en/hi, state-audit model, docs (spec 08/12/13, decisions, progress, questions, learnings).
