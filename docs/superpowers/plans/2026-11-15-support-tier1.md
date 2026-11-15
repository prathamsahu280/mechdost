# Support next tier part 1: implementation plan (2026-11-15)

Design: `docs/superpowers/specs/2026-11-15-support-next-tier-design.md` items 1 to 3 (binding). Built description: spec 09 "Order and request threads, photos and the COD refund destination". User rulings (decisions 2026-11-15): chat is customer and MechDost support only; COD refunds (Q104) take a UPI id or bank details on the ticket, encrypted, into the finance queue.

Approach: database rules first (migration, repository tested against PGlite), then the HTTP layer with a fake Storage, then the website, then docs and audit rows. Each task ends green on its own targeted tests; the full gate runs once at merge (coordinator).

## Tasks

1. **Shared contract** (`packages/shared/src/support-thread.ts`): issue codes (enum), subject-specific subsets, limits, masked destination, DTOs, the staff refund body, error codes. Export in `package.json`. Test: web `support-thread.test.ts` (messages, shapes).
2. **Schema + migration `0064_support_threads`**: `issue_code`, encrypted destination + mask, partial unique indexes (open statuses only), `media_objects` owner kind `ticket_message`. Test first: db test "the database refuses a second open thread".
3. **Repository** (`support-threads.ts`, extensions in `support.ts`): `openSupportThread` (advisory lock, continue-or-open, daily limit), `attachMessageImages`, `assertCanAttach`, `saveTicketRefundDestination`, `createRefundFromTicket` (reuses `createStaffRefund`), `findTicketMediaForServing`; attachments in every thread view. Tests: `packages/db/test/support-threads.test.ts`.
4. **API** (`routes/support-threads.ts`, mounted inside `supportRoutes`): multipart open and photo-message routes, destination `PUT`, staff refund `POST`, signed image route; body-limit and CORP exceptions in `middleware/security.ts`; rate limits. Tests: `apps/api/test/support-threads.test.ts`.
5. **Website** (real sign-in only, lazy inside the support screens): thread opener with issue chips and photo picker, photos in the thread, COD destination panel, staff refund panel; links from the order and service pages; locale namespace `supportThread` (en + hi); events. Tests: unit (`support-thread.test.ts`), state-audit rows `API-ACC-SUPPORT`, `API-ADM-SUPPORT`.
6. **Docs + ledgers**: specs 09, 05, 12, 13, 14, decisions, progress, questions (Q113), both learnings files, checklist regenerated.

## Order of risk

Integrity first (one open thread, locks, destination encryption, idempotent refund), then security (magic bytes, rights before image work, signed reads, masks), then UI. JS budget: nothing in the header, layout or shop modules; everything sits inside the two dynamically loaded support screens (import-graph test).

## Not in this plan

Items 4 to 7 of the design (inbox tools, auto-close, guest tickets, deletion request), staff attachments, the payout-destination purge (Q113).
