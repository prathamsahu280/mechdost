# Catalogue tier 2: recommendations, privacy, notify me (plan)

> For agentic workers: implement task by task (TDD). Spec: `docs/superpowers/specs/2026-11-15-catalogue-storefront-next-tier-design.md` items 4, 6, 7.

**Goal:** "Goes well with" suggestions (admin rules, then nightly co-purchase counts), Account -> Privacy (consents, deletion hook, data export), "Notify me" for an unserviceable PIN with an admin demand view.

**Architecture:** One migration (0068): `recommendation_rules`, `copurchase_pairs`, `data_export_requests`, `pincode_waitlist`. Repos in `packages/db/src/repo/{recommendations,privacy,pincode-waitlist}.ts`; shared DTOs in `packages/shared/src/{recommendations,privacy-api,waitlist}.ts`; routes in `apps/api/src/routes/{recommendations,privacy,pincode-waitlist}.ts`; worker loops (co-purchase nightly, export build, export expiry, waitlist notify). Web: Server Component `RecommendationsSection` (no client JS), client Privacy section, client NotifyMe button (lazy), two admin panels.

## Global constraints

- No new permissions: rules use `categories:write`, demand view `cities:manage`; customer routes use the session user id only.
- Co-purchase counts: delivered orders only, product level, min support 3, never personal data.
- Consents append-only (existing `consents` table, `forbid_update_delete`).
- Export: JSON in the DB row (max 2 MB), one active per user, one per 24 h, 24 h expiry, owner-only authenticated download, audited.
- No guest email capture; notify-me needs a verified phone or email on the signed-in account.
- en + hi for every string and rule label.

## Tasks

1. Migration + schema + shared DTOs; schema-invariant tests.
2. `recommendations` repo (rules CRUD, co-purchase recompute, `recommendFor`) with tests (rule precedence, no out-of-stock, idempotent job, cap 4).
3. `privacy` repo (consent view/set, export request/build/expire/download) with tests (append-only, withdraw effect, one active export, bounded, expired).
4. `pincode-waitlist` repo (join idempotent, cap, serviceable refused, counts, notify) with tests.
5. API routes + worker loops + analytics events + api tests.
6. Web: recommendations section (product page, cart), Privacy section, NotifyMe, admin panels, i18n en/hi, state-audit rows.
7. Docs, learnings, targeted verification.
