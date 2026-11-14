# Trust wording, seller clause, labour promise, dark-pattern audit: implementation plan (2026-11-15)

Design: `docs/superpowers/specs/2026-11-15-trust-wording-design.md` (approved, with the coordinator's "Builder check").
Execution: native, TDD (failing test first, then code). Skills: mechdost-advisor, writing-plans,
test-driven-development, domain-modeling, drizzle-postgis-supabase, supabase-postgres-best-practices, next-intl-hindi,
ui-ux-pro-max, frontend-design, web-design-guidelines, vercel-react-best-practices, core-web-vitals, seo,
website-testing, verification-before-completion. `grill-me` is not installed (noted).

## Architecture

- **Trust lines = content keys.** `packages/shared/src/content.ts` gains `TRUST_PLACEMENTS`, eight `trust.*` keys in
  `CONTENT_KEYS`, `TRUST_HIDDEN` (`-`), `trustLineText(override, fallback, {brand})`, and a 140-character limit for them.
  The db content repo, the content API, the demo editor and the API editor are generic over `CONTENT_KEYS`, so they need
  no new routes. `publishContent` / `unpublishContent` add the server event `trust_line_edited {placement}`.
- **Reading:** `apps/web/src/lib/trust-content.ts` (`publishedTrust`: API mode, 60 s cache, `{}` on failure);
  `components/site/trust-line.tsx` (async Server Component: default from the `trust` namespace, published override, hide);
  `TrustText` (tiny client island for the demo's browser-stored override, in `site-overrides.tsx`).
- **Placements:** home hero list, product page under the price, cart and checkout under the title, workshop header,
  partner page seller card; order emails via `email-layout.ts` `trustLine` option, the adapter's `loadTrustLine` and the
  worker (`order_*` templates).
- **Clause:** `packages/shared/src/seller-clause.ts`; `GenuineClauseButton` in both agreement editors;
  `counterfeit_confirmed` in `PARTNER_STANDING_REASONS` + label keys.
- **Labour promise:** settings `service.labour_promise_enabled` / `_days` (global-only); `currentLabourPromiseDays` in
  `packages/db/src/repo/labour-promise.ts`; `billJob` writes `service_bills.labour_promise_days`; `GET /workshops/{slug}`
  adds `labourPromiseDays`; `LabourPromise` component; bill line + claim link; ticket kind `labour_redo` with
  `serviceCode` checks; demo setting `labourPromiseDays`; tick on the demo workshop application form.
- **Migration** `0058_trust_labour_promise` (drizzle-kit): drop and re-add `support_tickets_kind_valid` and
  `partner_status_events_reason_code_valid`; add `service_bills.labour_promise_days` + range CHECK. Never applied here.
- **Audit:** `docs/research/dark-patterns-audit-2026-11.md`; small fixes in this branch (COD fee line, optional quote-close
  reason, with `checkout-totals.ts` and its test).

## Tasks (each: failing test, implement, pass)

1. shared: content keys, `trustLineText`, clause, reason code, settings, ticket kind, bill helpers (`trust.test.ts`).
2. db: migration, content events, `currentLabourPromiseDays`, `billJob` snapshot, `createSupportTicket` `labour_redo`
   (`content.test.ts`, `service-requests.test.ts`, `partner-pause.test.ts`).
3. api: workshop detail field, support route body, email footer (`email.test.ts`, `service-requests.test.ts`, `support.test.ts`).
4. web: locale keys en + hi (Hindi gate, i18n test), components, placements, admin editors, support form, bill line,
   demo setting, workshop tick (`trust-content.test.ts`, `site-config.test.ts`, `checkout-totals.test.ts`).
5. UI state audit: model dimensions, harness seeds, `API-ADM-CONTENT`, regenerate the checklist.
6. Docs: specs 02, 06, 07, 08, 09, 10, 12, 14, decisions, progress, runbook § 9.8, README, learnings.
7. Gate: `pnpm check` once.
