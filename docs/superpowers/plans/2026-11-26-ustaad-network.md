# Ustaad Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (one builder agent per
> workstream, a fresh reviewer per workstream, the lead merges) or superpowers:executing-plans. Steps use checkbox
> (`- [ ]`) syntax. Every builder brief embeds `.claude/skills/mechdost-advisor/references/agent-brief.md`.

**Goal:** build the mechanics-only Ustaad Network of spec 23 in one release: join (replacing "Apply as a mechanic"),
tutorial, ID card, verification, levels and Izzat, Q&A, a feed with every media kind incl. stories and 180 s video,
social graph and messages, Discover, garage pin and zones, jobs, smart correction, moderation and the admin.

**Architecture:** one foundations workstream (A) owns every migration and every shared registry and ships the
membership, settings, media pipeline and `/ustaad` shell; six feature workstreams (B–G) then build in parallel on
those interfaces, each in its own folders. Hono routes per area under `apps/api/src/routes/ustaad/`, repositories under
`packages/db/src/repo/ustaad/`, shared contracts under `packages/shared/src/ustaad/` and `src/state/ustaad-*.ts`, web
under `apps/web/src/app/[locale]/ustaad/` and `apps/web/src/components/ustaad/<area>/`.

**Tech stack:** Next.js 16 (Server Components, dynamic imports), Hono + zod-openapi, Drizzle + Supabase Postgres +
PostGIS, pg-boss worker, Upstash Redis, Firebase Auth, existing `sharp` pipeline, Cloudflare R2 / Supabase Storage via
`MediaHost`, Anthropic / Gemini HTTP via `SmartCorrectionEngine`. **No new npm dependency by default** (SigV4, hex grid, magic bytes and duration parsers are written in-house with tests). Three places will probably need a vetted exception, decided in the A4 spike: an on-phone video muxer for re-encoding (WebCodecs + an MP4/WebM muxer), the Public Suffix List for registrable-domain display (a vendored snapshot or a small library), and the Unicode TR39 confusables data (a vendored data file). Every exception goes through `docs/research/security-vulnerabilities.md`, the release-age policy and a decisions entry first.

**Spec:** `docs/specs/23-ustaad-network.md` (+ design `docs/superpowers/specs/2026-11-26-ustaad-network-design.md`).

## Global constraints

- Hard rules 1–16 of CLAUDE.md; spec 23 § 14a security requirements SR-1…SR-46 (ids kept in test names).
- No age check anywhere: no DOB, no age column, no age screen (ruling). Never Aadhaar.
- Staff final approval of verification and of Bada/Master promotions is locked on; the Sponsored label "Sponsored" /
  "प्रायोजित" is locked; `zones.hide_below ≥ 5`; `promo.every_n ≥ 8`; `posts.video_max_s` 180 default, above 180 only by
  a super admin with a reason; `media.video_max_mb ≤ 150`.
- No speech-to-text, no voice search, no server transcoding in v1.
- Phone numbers never in an Ustaad API response; non-members get 404 on member routes; signed media URLs ≤ 10 min.
- Every string in the `ustaad` locale namespace (en + hi); content tables carry `*_hi`; `/hi/ustaad/*` passes
  `e2e/hindi-coverage.spec.ts`.
- Every new table: RLS on, grants revoked, `rls-inventory.ts` entry `none`, `bump_version` / `touch_updated_at`
  triggers or `forbid_update_delete()` for append-only; every FK and filter indexed.
- Migrations **named, not numbered** (latest on main 0087; the lead renumbers at merge): `ustaad_foundations`,
  `ustaad_identity`, `ustaad_qa`, `ustaad_feed`, `ustaad_local`, `ustaad_moderation`, all written by workstream A.
- `/ustaad` feed first-load JS < 150 KB gz; LCP < 2 s, INP < 200 ms, CLS < 0.05.
- Screenshots (390 / 768 / 1440, light + dark, en + hi) of every new screen go to the user before shipping
  (memory "UI redesign feedback": restyle real pages only, MechDost tokens, no invented toggles).
- Gates per workstream: `pnpm check`, vitest per package one at a time, the touched e2e specs, `website-testing` then
  `verification-before-completion`, TEST REPORT block. No push.

## Review focus (inputs no task's happy path covers)

1. Two taps on Like / Follow / Vote at once, and unlike racing like → counters never drift or go negative (task D2,
   test `counters survive double like and like/unlike race`).
2. A story that expires while its signed URL is being issued, and a takedown while a video is streaming → URL refused
   after expiry, object gone within 60 s (A4 `url refused for expired story`, F3 AT-TAKEDOWN-1).
3. A member who leaves the network, then rejoins with the same phone → old handle reserved, consents re-asked,
   counters not double-counted (A2 `rejoin after leave`).
4. A city disabled while members from it are active → their content stays, new joins refused with `USTAAD_REGION`,
   zone counts hidden (A2 `disabled city`, E2 AT-REGION-1).
5. Hindi text with Devanagari digits ("६३०१") and mixed scripts through smart correction and the scam filters → digits
   normalised for the guard and the filters, never altered in the output (F1 `devanagari digits kept`, F2
   `scam filter normalises digits`).

---

## Dependencies and parallelism

```
A (foundations) ──► B identity (incl. verification admin routes) ──┐
                 ├─► C Q&A + Learn                                    │
                 ├─► D feed + graph + messages + Discover + promotions │
                 ├─► E local (pin, zones, jobs)                       │
                 ├─► F smart correction + moderation (incl. admin moderation routes) + compliance
                 ├─► G1 admin settings UI (needs only A's settings API)
                 └────────────── G2 community manager console UI ◄── after B4 and F2
```

- **A first, alone** (it touches every shared registry). After A merges, **B, C, D, E, F and G1 run concurrently**; G2 (UI only) starts once B4 and F2 have merged their admin routes: each
  owns its own folders; A pre-creates every file they would otherwise both edit.
- **Shared slots A pre-creates** (empty sections with an owner comment, so later edits never collide): `rbac.ts`
  (all Ustaad permissions and `community_manager`), `settings.ts` (every `ustaad.*` key with bounds and invariants),
  locale files (`ustaad.<area>` sub-objects per workstream: `ustaad.join`, `.card`, `.qa`, `.feed`, `.local`, `.jobs`,
  `.correction`, `.moderation`, `.admin`, `.tutorial`), `analytics.ts` (every event of spec 23 § 16), the notice
  catalogue (every kind of § 12), `rls-inventory.ts`, `schema/index.ts` (one file per area: `schema/ustaad-*.ts`), the
  API router (`routes/ustaad/index.ts` mounting one file per area), the worker job registry, the admin settings
  registry (category `ustaad`), the state-audit model rows `USTAAD-*` / `ADM-USTAAD-*`, `.env.example`, `csp.ts`.
- **Interface stubs from A** so streams do not wait on each other: `izzat.record(tx, actor, {memberId, reason, source,
idemKey})` and `levels.recompute(tx, memberId)` (B implements; A ships no-op versions with the signature),
  `moderation.screen(tx, {kind, text, mediaIds, authorId}) → 'ok'|'hold'|'block'` (F implements; A ships "ok"),
  `correction.apply(text, mode)` (F implements; A ships identity), `notify.ustaad(kind, …)` (A, real).
- Estimated sizes: A **L** (5–6 days), B **L**, C **M**, D **XL** (split D1–D3 into two agents if needed), E **M**,
  F **L**, G **M**. Critical path ≈ A + D.

---

## Workstream A — Foundations (schema, roles, settings, media pipeline, `/ustaad` shell, membership)

### Task A1: Shared contracts and registries

**Files:** create `packages/shared/src/ustaad/{codes.ts,settings.ts,dto/*.ts,zones.ts,levels.ts,izzat.ts}`,
`packages/shared/src/state/ustaad-{verification,attestation,vouch,level,content,question,report,job,application,media,
graph}.ts`; modify `rbac.ts`, `settings.ts` (new `enum` kind + `ustaad.*` keys), `privacy-api.ts` (`PRIVACY_PURPOSES`

- 8 Ustaad purposes), `analytics.ts`, `notice-catalogue.ts`, `i18n/en.json` + `hi.json` (namespace slots), `state/index.ts`.

**Interfaces (produced):** `USTAAD_LEVELS = ['apprentice','ustaad_pending','naya','pakka','bada','master']`,
`USTAAD_TRACKS`, `REPORT_REASONS`, `POST_KINDS`, `MEDIA_KINDS`, `SEGMENT_CODES`, `WORK_CODES`; each machine as
`machine.assert(from, to, actor)`; `ustaadSettingInvariant(values, actorRole, reason?) → null | {key, code}`;
`zoneCell(lat, lng, edgeM) → 'hx:q:r'`, `zoneNeighbours(cell)`; `bandCount(n, {hideBelow, exactFrom, round}) →
{kind:'few'|'band'|'exact', value?}`; `distanceBand(metres) → 'lt2'|'2to5'|'5to10'|'10plus'`.

- [ ] Failing tests `packages/shared/test/ustaad-*.test.ts`: every machine edge and actor rule (spec § 7); settings
      bounds and invariants (AT-LEVEL-2 setting part, hide_below 4 → `SETTING_INVARIANT`, every_n 7 → invariant, video 181 without a reason code → invariant, with a reason code by a super admin → ok, auto mode with empty protected list → invariant,
      weights summing 99 → `SETTING_RELATION`); `zoneCell` stable ids for fixed Raipur points, edge 1400 m area ≈ 5.1 km²;
      `bandCount` (4 → few, 5 → band, 19 → band, 20 → exact, 23 → 25 when rounding); `distanceBand` edges; DTO strictness
      (unknown keys refused, e.g. `official: true` on `PATCH /ustaad/me`, SR-5); permissions present on `mechanic` and
      `community_manager` (no `customers:read_pii`, no `exports:run`, SR-38).
- [ ] Run `pnpm --filter @mechdost/shared test` → fail; implement; pass.
- [ ] Commit `feat(ustaad): shared contracts, machines, settings and registries`.

### Task A2: Schema and migrations (all six, owned here)

**Files:** `packages/db/src/schema/ustaad-{members,trust,graph,content,qa,media,local,jobs,moderation,onboarding}.ts`,
`schema/index.ts`, `drizzle/<n>_ustaad_*.sql` (generated + hand SQL: RLS, REVOKE, triggers, partial uniques,
`forbid_update_delete`, consents CHECK widened with the 8 purposes), `test/rls-inventory.ts`.

- [ ] Failing DB tests `packages/db/test/ustaad-schema.test.ts`: every table in spec § 6 exists with RLS and the
      triggers (`schema-invariants` passes); partial uniques (one open verification, active vouch pair, one best answer,
      one vote, PK follow pair, ordered connection pair, one open attestation, one link per application); CHECKs (no self
      follow/vouch/mentor, pay min ≤ max > 0, adult attestation not null on jobs, media mime per kind and bytes caps, object
      key regex, `hide_below`-style CHECKs are not in SQL but in settings); append-only tables refuse UPDATE/DELETE
      (`ustaad_events`, `ustaad_izzat_ledger`, `ustaad_moderation_actions`); consents accept `ustaad_profile` …
      `ustaad_ml_training`.
- [ ] `drizzle-kit generate --name=ustaad_foundations` etc. + fix script; append hand SQL; run tests → pass.
- [ ] Commit `feat(ustaad): schema and migrations`.

### Task A3: Membership, reach, roles and the `/ustaad` shell

**Files:** `packages/db/src/repo/ustaad/members.ts`, `apps/api/src/routes/ustaad/{index,members}.ts`,
`apps/api/src/middleware/ustaad-member.ts` (404 for non-members, status checks, restricted mode), web
`app/[locale]/ustaad/layout.tsx` (shell, bottom tabs Home · Discover · Create · Learn · Me, hides the site tab bar),
`components/ustaad/shell/*`, `ustaad/page.tsx` (Home skeleton with empty states), `noindex` metadata.

**Interfaces:** `requireUstaadMember(c) → {member, grant}`; `membersRepo.join(tx, actor, JoinDto) → Member`;
`membersRepo.get(tx, actor, handle)`; `inEnabledRegion(tx, point|pincode) → cityId | null` (SR-46: `ST_Within` on the
city polygon, else the city's PIN list).

- [ ] Failing API tests `apps/api/test/ustaad-members.test.ts`: role-leak matrix rows for membership routes (anonymous
      401; customer/shop/workshop/support/finance/marketing 404; member 200); join needs a verified phone and Turnstile
      (SR-3); `USTAAD_REGION` for a Nagpur pin (AT-REGION-1); `rejoin after leave`; `disabled city`; `NAME_RESERVED` hook
      (implemented in B, stubbed here); rate limit 429 with headers (AT-RATE-1 pattern).
- [ ] Implement; web unit test for the shell (tabs, current tab, one tab bar); Playwright smoke `/ustaad` 390/1440.
- [ ] Commit.

### Task A4: Media pipeline (`MediaHost`, upload, verify, read, budget)

**Files:** `apps/api/src/ustaad/media/{host.ts,r2.ts,supabase.ts,sigv4.ts,sniff.ts,duration.ts,verify.ts,budget.ts}`,
`apps/api/src/routes/ustaad/media.ts`, `packages/db/src/repo/ustaad/media.ts`, worker jobs `ustaad_media_purge`,
web `components/ustaad/media/{compress-image.ts,record-voice.tsx,record-video.tsx,trim.tsx,upload.ts,blur-brush.tsx}`
(dynamic imports), `.env.example`, `apps/web/src/lib/csp.ts`.

**Interfaces:** `MediaHost` (spec § 10); `declareMedia(tx, actor, DeclareDto) → {mediaId, put|parts}`;
`completeMedia(tx, actor, mediaId) → Media` (status `verified|rejected`); `mediaUrl(tx, actor, mediaId, variant) →
string` (≤ 10 min, window-rounded expiry); `budget.check(tx, kind, bytes)`.

- [ ] **Spike first (half a day, write the result into the spec and decisions):** on a 2 GB Android in Chrome, can a
      180 s clip be re-encoded on the phone to ≈ 480p / 1 Mbps (MediaRecorder re-recording vs WebCodecs + muxer), how long
      it takes and how hot the phone gets; fallback = upload within the 150 MB cap. Also choose the PSL and TR39 sources.
- [ ] **First failing test (size enforcement is real, not assumed):** an opt-in integration test (`MEDIA_IT=1`, the dev
      bucket of each adapter) shows that a presigned PUT with a different `Content-Length` or `Content-Type` than declared
      is refused by the host; the unit test checks both headers are in the signed canonical request. Multipart: part URLs
      are issued only for `ceil(declared / 8 MB)` parts, each signing its exact part length, and `complete` refuses unless
      `HEAD` size equals the declared size (so the total can never exceed it).
- [ ] Failing tests: SigV4 presign against AWS published vectors; `sniff()` for WebP/JPEG/MP4/M4A/WebM/Ogg/PDF and
      refusals (SVG, HTML renamed `.jpg`, ZIP, EXE: AT-UP-2, SR-17); `duration()` from `mvhd`, WebM `Duration`, Ogg
      granule; 181 s → `MEDIA_TOO_LONG`, 151 MB → `MEDIA_TOO_LARGE` before any processing (AT-UP-4); MP4 with `©xyz` or
      `dref` URL / HLS reference → `MEDIA_MISMATCH` with no network or file read (AT-UP-5); JPEG with GPS EXIF → variants
      without metadata (AT-UP-1); decompression bomb → 422 before decode (AT-UP-3); PDF always `attachment` from the docs
      host (AT-UP-6 v1 part); quarantine object unreadable by a member (AT-UP-8); upload URL used by another member or
      after expiry refused (AT-UP-10); budget full → `MEDIA_BUDGET_FULL` for video only; member quota conditional
      increment race; `url refused for expired story`; blocked viewer → 404 (SR-35 media part); resumable parts resume.
- [ ] Implement; `supabase` adapter is the default (`MEDIA_HOST` unset).
- [ ] Commit.

### Task A5: Events, notices, rate limits, stubs

**Files:** `packages/db/src/repo/ustaad/events.ts` (`recordUstaadEvent`), `apps/api/src/notify/ustaad.ts`,
`apps/api/src/rate-limit/ustaad-rules.ts`, stubs `packages/db/src/repo/ustaad/{izzat,levels,moderation}.ts`,
`apps/api/src/ustaad/correction/index.ts` (identity), the `/ustaad/notifications` page (the bell inbox filtered to `ustaad.*` kinds), lint rule config banning `dangerouslySetInnerHTML` under
`components/ustaad` and `app/[locale]/ustaad` (SR-26).

- [ ] Failing tests: every server event of § 16 validates against the catalogue (`packages/shared/test/analytics.test.ts`);
      restricted-mode member emits no analytics events (SR-42); notice kinds render en + hi with only allowed placeholders;
      rate-limit rules exist for every route in § 8.
- [ ] Implement; commit `feat(ustaad): foundations`. **Screenshots:** shell + empty Home (390/768/1440, light/dark,
      en/hi) to the user.

---

## Workstream B — Identity (join = Apply as a mechanic, tutorial, card, verification, levels and Izzat)

### Task B1: Join flow and "Apply as a mechanic"

**Files:** web `app/[locale]/ustaad/join/page.tsx`, `app/[locale]/partners/apply/[kind]/page.tsx` (kind `mechanic`
renders the join component; seller/garage unchanged), `components/ustaad/join/*` (5 steps), `app/[locale]/partners/status/page.tsx`
(mechanic verification progress), partners page + footer copy (locale keys § 4a); API `routes/ustaad/members.ts` join
with `fromApplication`; `routes/partner-onboarding.ts` refuses `kind: mechanic` with 410 `MOVED_TO_USTAAD`; script
`packages/db/src/ustaad/map-mechanic-applications.ts` + root script `db:ustaad:map-mechanic-applications` (CLAUDE.md
commands); admin Partners › Applications mechanics notice and link.

- [ ] Failing tests: join creates a member with `verification_state = pending_verification` when a method was picked,
      `unverified` otherwise; only the required consent ticked → joins; optional consents start unticked (web test);
      no age field anywhere in the DTO (shared test asserts the schema keys); `/partners/apply/mechanic` and `/ustaad/join`
      render the same steps; seller and garage applications unchanged (existing tests stay green); 410 for a mechanic body;
      mapping script: dry run counts, idempotent second run, never creates a member, closes open rows with
      `moved_to_ustaad`, writes `ustaad_application_links`, prefill applied on join; status page shows progress states.
- [ ] Implement; e2e `e2e/ustaad-join.spec.ts` (both entry points, en + hi, 390/1440). **Screenshots** of the 5 steps
      and the status page.

### Task B2: First-time tutorial and coach-marks

**Files:** `app/[locale]/ustaad/welcome/page.tsx`, `components/ustaad/tutorial/{cards.tsx,narration.tsx,coachmark.tsx}`,
`repo/ustaad/onboarding.ts`, `routes/ustaad/onboarding.ts`, seed of 6 cards + 6 coach-marks (en + hi copy from spec
flow 15), Me › Help / Kaise use karein, Learn course "How to use Ustaad Network" (seeded resources).

- [ ] Failing tests: skip at any card records `tutorial_skipped {at_card}`; complete records `tutorial_completed`;
      narration never autoplays and falls back to `speechSynthesis` when a card has no recording; only one coach-mark at a
      time and never blocking (the control under it stays clickable); replay resets; reduced motion shows static images;
      focus moves to the card heading; Hindi coverage.
- [ ] Implement; **screenshots** of the cards and two coach-marks.

### Task B3: Card, profile, specialities, settings and my choices, leaving, reserved names, account-takeover hardening

**Files:** `app/[locale]/ustaad/{me,m/[handle]}/*`, `components/ustaad/card/*` (share as image, QR), `repo/ustaad/members.ts`
(profile, specialities), `packages/shared/src/ustaad/names.ts` (NFKC + TR39 skeleton), `apps/api/src/ustaad/security-freeze.ts`.

- [ ] Failing tests: "Settings and my choices" saves language, data saver, correction mode (only when allowed), message mode, suggest-me, the four join consents (one tap to withdraw); leaving keeps the MechDost account, removes the `mechanic` grant, hides the profile and keeps the handle reserved (`rejoin after leave`); AT-NAME-1 ("MechDøst", "Mech Dost", Cyrillic look-alikes → `NAME_RESERVED`); official badge only
      via the super-admin route (SR-5); phone never in any profile response (SR-34 profile part); SR-2: phone change or
      new device on a Pakka+ account → re-OTP required, `ustaad.security_freeze` notice, perks and job posting refused for
      72 h; counts rounded above 1,000.
- [ ] Implement; **screenshots** of the card, profile and level ladder.

### Task B4: Verification (attestation, vouches, staff queue)

**Files:** `repo/ustaad/{verification,attestation,vouch}.ts`, `routes/ustaad/verification.ts`, `routes/admin-ustaad-verification.ts` (staff queue, approve, reject, revoke, level reviews; G2 builds only the UI),
`routes/workshop-ustaad.ts` (workshop portal confirm), public attest page `app/[locale]/ustaad/attest/[token]/page.tsx`,
`components/ustaad/verify/*`, workshop portal card "Confirm your mechanics".

- [ ] Failing tests: machines through the API with version CAS (double approve → 409); SR-6 (non-partner owner needs
      GSTIN/Udyam + photo ≤ 200 m; 11th attestation in a quarter refused); SR-7 (voucher < Pakka, < 60 days, reciprocal,
      4th in a month → refused; AT-VOUCH-1 ring flagged by the B5 job); SR-8 / AT-LEVEL-2 (no approval path without a staff
      row; `staff_final` is not a setting); workshop owner sees only their workshops' attestations (foreign id 404);
      evidence deleted after `verify.evidence_retention_days`; answers flip `counts_for_levels` on approval with idempotent
      Izzat back-fill.
- [ ] Implement; **screenshots** of Get verified, the attest page, the workshop card.

### Task B5: Levels, Izzat, badges, ring detection

**Files:** `packages/shared/src/ustaad/{levels.ts,izzat.ts,badges.ts}` (pure), `repo/ustaad/{izzat,levels,badges,counters}.ts`
(replace A's stubs), worker jobs `ustaad_levels_nightly`, `ustaad_counters_30d`, `ustaad_counter_reconcile`,
`ustaad_ring_detect`.

**Interfaces:** `qualifiedFollowers(followers[], now, settings) → number`; `levelFor(stats, rules) → {level,
needsReview}`; `izzat.record(...)` real.

- [ ] Failing tests: AT-LEVEL-1 (600 followers from < 30-day or same-garage accounts → qualified 0, no Bada); unverified followers and ring members not counted; `levels.follower_exclude_same_garage` off → same-garage followers count; OR groups
      for Naya; Bada/Master always queue a staff review (locked); no drop for inactivity; perks paused after 90 days;
      `coin_multiplier_bp > 10000` refused with `COIN_GUARD_REQUIRED` (spec 20); Izzat reversals on unfollow/vote removal;
      ring job flags > 30 % reciprocity and dense clusters, sets `ustaad_follows.counted = false`, weighs flagged votes 0
      (SR-10); reconcile fixes injected drift and logs it; badge rules award once.
- [ ] Implement; **screenshots** of the level-up celebration and badges.

---

## Workstream C — Q&A

### Task C1: Questions, answers, votes, best answer, parts used

**Files:** `repo/ustaad/qa.ts`, `routes/ustaad/qa.ts`, `app/[locale]/ustaad/{ask,ask/new,q/[code]}/*`,
`components/ustaad/qa/*` (hold-to-talk mic reused from A4, vehicle tiles, safety notes, disclaimer), worker routing
(`question_waiting` to ≤ `qa.notify_ustaads`, widening after 24 h), `UQ-` codes.

- [ ] Failing tests: answer gate by track (Chhotu → `USTAAD_CANNOT_ANSWER` unless the setting); pending Ustaad answers
      stored with `counts_for_levels = false`; one vote per member, no self-vote; one best answer, only the asker, ≤ 5 a
      week; double best → 409; Izzat rows via `izzat.record`; widening job idempotent; safety tag shows the HV note;
      idempotent create; caps 10 questions / 30 answers / 100 votes a day; Devanagari digits kept by the correction stub
      path; e2e ask by voice (mock recorder) → answer → best → Izzat visible.
- [ ] Implement; **screenshots** of Ask, the composer sheet, a thread with a best answer and parts.

---

### Task C2: Learn (Seekho)

**Files:** `repo/ustaad/learn.ts`, `routes/ustaad/learn.ts`, admin CRUD for courses and resources in
`routes/admin-ustaad-learn.ts`, `app/[locale]/ustaad/learn/*`, `components/ustaad/learn/*` (player reused from D1 via
the A4 media component), seed "How to use Ustaad Network" course (used by the tutorial, B2).

- [ ] Failing tests: hosted video completes at ≥ 80 % watched; external links self-marked, capped at
      `learn.self_mark_daily_cap` (5) a day; completed videos feed `videos_watched` for Naya group B through
      `levels.recompute`; "MechDost training" label shown on labelled resources; data saver (tap to play, size shown);
      Hindi titles required (`title_hi` not null); 120 progress writes an hour.
- [ ] Implement; **screenshots** of Learn and a course.

## Workstream D — Feed, stories, reactions, hashtags, graph, messages, Discover, promotions, previews

### Task D1: Posts and stories

**Files:** `repo/ustaad/posts.ts`, `routes/ustaad/posts.ts`, `routes/ustaad/stories.ts`, `app/[locale]/ustaad/{create,p/[id],stories/[memberId]}/*`,
`components/ustaad/feed/{composer/*,post-card.tsx,story-ring.tsx,story-viewer.tsx,player.tsx}` (players and viewer
dynamically imported), worker `ustaad_story_expire`.

- [ ] Failing tests: every post kind and template validates (fix-log fields, before/after roles, poll ≥ 2 options);
      `posts.per_day` cap; types switched off are refused; stories expire and their media purge after the grace; stories off
      for accounts < 30 days; "Seen by" only to the owner; `moderation.screen` hook called with text + media; drafts
      survive offline (web test with IndexedDB mock).
- [ ] Implement; **screenshots** of Create (quick start + each media sheet), a post, the story viewer.

### Task D2: Feed ranking, reactions, comments, saves, shares, hashtags

**Files:** `repo/ustaad/{feed,reactions,comments,saves,tags}.ts`, `routes/ustaad/{feed,tags}.ts`, `packages/shared/src/ustaad/feed-score.ts`,
`app/[locale]/ustaad/{page.tsx,tags/[slug],saved,s/[token]}/*`.

- [ ] Failing tests: `counters survive double like and like/unlike race` (real Postgres suite); feed snapshot cursor
      never repeats or skips across pages; weights from settings; promotions inserted at most 1 per `every_n`, never two in
      a row, none on day one; tags ≤ 5, ≥ 1 curated, NFC pattern, blocked tags refused (SR-25); aliases match ("battri" →
      #battery); share teaser shows no text/media/names, `noindex`, rate limited (SR-44); like and follower counts visible
      per settings.
- [ ] Implement; Lighthouse + bundle check on `/ustaad` (< 150 KB gz). **Screenshots** of Home feed, a tag page, Saved.

### Task D3: Follow, connect, mentorship, block/mute, messages

**Files:** `repo/ustaad/{graph,mentorship,threads}.ts`, `routes/ustaad/{graph,mentorship,threads}.ts`,
`app/[locale]/ustaad/{network,messages,messages/[id]}/*`.

- [ ] Failing tests: AT-DM-1 (< 7-day account starting a thread → 403; first message with a link → refused); request-only
      default for everyone; no media/links before acceptance; ≤ 20 new threads a day; phone never in any response (SR-34
      sweep over every Ustaad route's JSON in the API suite); block → 404 on profile, posts, media, messages and removes
      follows/connections in one transaction (SR-35); 21st follow → 429 (AT-RATE-1); mentorship machine.
- [ ] Implement; **screenshots** of My network, message request, thread.

### Task D4: Discover, link previews, promotions

**Files:** `repo/ustaad/discover.ts`, `packages/shared/src/ustaad/discover-score.ts`, `apps/api/src/ustaad/link-preview/*`
(separate worker process, no DB credentials), `repo/ustaad/promotions.ts`, `app/[locale]/ustaad/discover/*`.

- [ ] Failing tests: Wilson ranking, new-member slots, `suggest_me = false` never suggested; 20 per page, no total, 200
      profiles a day (SR-37); AT-SSRF-1, AT-SSRF-2, AT-SSRF-3; links from < 7-day accounts refused; warning-page redirect
      HMAC-verified; promotions only `mechdost_authored|sponsored`, label in the first line (AT-PROMO-1 render part),
      never on ask/answer screens.
- [ ] Implement; **screenshots** of Discover and a link post with preview.

---

## Workstream E — Local (garage pin, distance bands, zones, jobs)

### Task E1: Pin, choices, distance bands

**Files:** `repo/ustaad/location.ts`, `routes/ustaad/location.ts`, `packages/shared/src/ustaad/distance.ts`
(stable per-pair noise via HMAC), `app/[locale]/ustaad/pin/*`, `components/ustaad/local/*` (MapLibre via the existing
map adapter, dynamic import).

- [ ] Failing tests: AT-LOC-1 (same band per pair on repeat; 4th change in 24 h and 7th in 30 days → 429; > 1 km move
      without a ≤ 50 m fix refused; simulated 3-account trilateration median error > 1 km); AT-LOC-3; AT-LOC-4 (exact pin
      to a connection, not to a follower; audience "all" when chosen); home/roadside never a point; weak GPS → landmark
      path; exact pin staff view audited (`ustaad:location_exact`).
- [ ] Implement; **screenshots** of Pin my garage (GPS found, weak GPS, confirmed).

### Task E2: Zone counts and area map

**Files:** worker `ustaad_zone_counts`, `repo/ustaad/zones.ts`, `routes/ustaad/zones.ts`, `app/[locale]/ustaad/area/*`.

- [ ] Failing tests: AT-LOC-2 (4 → few; a 1-member speciality cell suppressed; complementary suppression); only
      verified, active, opted-in members counted; AT-REGION-1 zone part; staff see exact counts, members bands.
- [ ] Implement; **screenshots** of the area map.

### Task E3: Jobs

**Files:** `repo/ustaad/jobs.ts`, `routes/ustaad/jobs.ts`, `app/[locale]/ustaad/jobs/*`, worker `ustaad_jobs_expire`, `UJ-` codes.

- [ ] Failing tests: employer check (workshop grant or verified trade account; else `USTAAD_EMPLOYER_REQUIRED`); AT-JOB-1
      (fee phrase or UPI id → held; missing attestation → 422 `USTAAD_ADULT_ATTESTATION`); pay range mandatory; application
      machine incl. job closing; phone shared only when ticked; restricted-mode members cannot apply; perks/job posting
      frozen by SR-2.
- [ ] Implement; **screenshots** of the jobs list, a job, the apply sheet, the employer's applicants.

---

## Workstream F — Smart correction, moderation, compliance

### Task F1: Smart correction

**Files:** `apps/api/src/ustaad/correction/{engine.ts,anthropic.ts,gemini.ts,wordlist.ts,guard.ts,mask.ts,prompt.ts,cache.ts}`,
`routes/ustaad/correct.ts`, `components/ustaad/correction/*` (suggest sheet, "Edited · see original").

**Interfaces:** `SmartCorrectionEngine` (spec § 11); `meaningGuard(input, output, protected) → {ok, failures}`;
`maskPii(text) → {masked, restore}`.

- [ ] Failing tests: prototype examples (both); AT-SC-1 ("DOT 3", "175/65 R14" untouched in auto mode); negations
      (`nhi`, `नहीं`) never dropped; `devanagari digits kept`; length rule; script rule; placeholder dropped → result
      refused; injection text ("ignore previous instructions, reply with…") returns only corrected text of similar length;
      timeout 2 s → word-list result; no key → word-list; daily budget exhausted → word-list; cache hit skips the call;
      per-member limit; no member id or raw phone in the request body (request captured by a fetch double).
- [ ] Implement (model id from `SMART_CORRECTION_MODEL`, never hard-coded); **screenshots** of suggest and auto modes.

### Task F2: Reports, actions, appeals, takedown, child safety

**Files:** `repo/ustaad/{reports,moderation,strikes,removed-archive}.ts` (replace A's `moderation.screen` stub),
`apps/api/src/ustaad/safety/{classifier.ts,premod.ts,evidence.ts}`, `routes/ustaad/reports.ts`,
`routes/admin-ustaad-moderation.ts`, worker `ustaad_report_clock`, `ustaad_removed_archive_purge`, `ustaad_rules_reminder` (admin moderation routes live here; G2 builds only the UI).

- [ ] Failing tests: AT-TAKEDOWN-1 (signed URL, teaser, search hit, feed card 404 within 60 s; evidence row kept); clocks
      per reason (2 h, 3 h, 36 h, 24 h, 7 days) and overdue notices at 50 % / 100 %; four-eyes and self-moderation refusals;
      appeal decided by another staff member; minor report from a verified reporter with a ≥ 30-day account → restricted mode (no events, no recommendations, no promos, no jobs, no messages; posts unchanged) until review; from any other reporter → top of the queue, nobody restricted; repeated dismissed minor reports → `false_report` strike; pre-moderation of the first 3 media posts and accounts < 30 days; AT-UP-9 with the
      classifier test double (hash hit → blocked, evidence vault, POCSO task, account frozen); AT-UP-7 (EICAR held by
      pre-moderation); scam/UPI/OTP patterns hold comments and messages; `scam filter normalises digits`; removed-content archive purged after 180 days unless on hold; DM content readable only with a report id, audited.
- [ ] Implement.

### Task F3: Compliance duties and docs

**Files:** `docs/runbooks/ustaad.md` (grievance desk and contacts, 24×7 rota, takedown fast path, agency requests 72 h,
POCSO reporting steps, CERT-In 6 h and DPDP 72 h incident runbooks with en + hi templates, tabletop drill checklist,
SSMI counter), Community Rules / Terms / Privacy notice sections (content pages in the CMS, en + hi), consent notices
per purpose, processor register (`docs/research/processors.md`), log retention config (180 days, India).

- [ ] Tests: consent per purpose writes and withdraws in one tap and stops the related job (location, zone count, offers, ML, voice, correction: without `ustaad_correction` only the word list runs); 3-monthly reminder job idempotent; ICT log retention setting present; grievance tickets carry the timers.
- [ ] Commit; tabletop drill is an ops step listed in the runbook.

---

## Workstream G — Admin settings UI and community manager console

### Task G1: `/admin/ustaad` settings

**Files:** `app/[locale]/admin/ustaad/*`, `components/portal/admin-ustaad/*`, admin settings registry category, routes
`routes/admin-ustaad-settings.ts` + CRUD for levels, badges, tags (merge), words, reasons, reach cities, promotions,
tutorial cards and coach-marks.

- [ ] Failing tests: every key of spec § 15 rendered with label, help, range, default (en + hi); invariants surface the
      server's `SETTING_INVARIANT` message; staff approval and the Sponsored label shown read-only; video above 180 needs a
      super admin and a reason; save bar, discard, confirm; audit rows; AT-PROMO-1 (label change → 422).
- [ ] Implement; **screenshots** of each section (1440 + 390).

### Task G2: Community manager console (UI only; starts after B4 and F2)

**Files:** `app/[locale]/admin/ustaad/{verification,reports,members,zones,audit}/*`.

- [ ] Failing tests: role-leak matrix staff rows (community manager city A → 200 for city A, 404 for city B; support,
      finance, marketing 403; super admin all); queue sorted by clock; verification approve/reject with reason codes and
      four-eyes where required; exact pin view audited; no export buttons, phones masked; DM view only from a report.
- [ ] Implement on the B4 and F2 routes; state-audit rows `ADM-USTAAD-*` regenerated; **screenshots**.

---

## Merge order and final gates

A → (B, C, D, E, F, G in any order; rebase on main, the lead renumbers migrations) → full suite: `pnpm check`, vitest
shared/db/api/web one at a time, Playwright `ustaad-*.spec.ts`, role-leak, concurrency (real Postgres), hindi
coverage, axe, visual snapshots, Lighthouse on `/ustaad` and `/ustaad/q/[code]`. Before going live: the user's
screenshot review, answers to Q-U1/Q-U3/Q-U4 (or the defaults), the tabletop drill, an independent security review
(`claude-security`), migrations applied before the push (runbook deploy § 6).

## Self-review

Spec coverage checked section by section (flows 1–15 and § 4a → B1–B5, C1–C2, D1–D4, E1–E3, F1–F3, G1–G2; § 10 → A4;
§ 13 → F2/F3; § 14a SR rows → the workstream named in their WS column; § 16 events → A5 + each task; § 17 → D2 check).
Review Focus items each have a named test in the owning task. Names used across tasks (`izzat.record`,
`levels.recompute`, `moderation.screen`, `mediaUrl`, `zoneCell`, `bandCount`, `distanceBand`, `qualifiedFollowers`,
`meaningGuard`) are defined in A1/A4/A5/B5/F1 Interfaces blocks.
