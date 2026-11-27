# Ustaad simulation — fix plan (2026-11-27)

Source of truth for each item: `D:\mechdost-qa\ustaad-sim-2026-11-27\logs\bugs.md` (repro, screenshot, clip) and
`logs\audit.md` (ranked improvements, live evidence). This file groups them into builder batches; every fix is
test-first (spec 23 acceptance tests + a regression test per bug), en + hi, light + dark, and re-checked live in a real
browser by the lead before it is called done (founder, 2026-11-27: "review it all directly and properly and visually").
Builders start after the run ends (16:15 IST) so the run's system under test stays stable.

## Batch A — trust & safety, money-free but member-facing (P0/P1 first)

| Id                 | P   | What                                                                                                         | Notes                                                   |
| ------------------ | --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| SIM-P18            | P0  | Jobs: employer never told about applications and cannot see them                                             | bell + "Applicants" list on the job                     |
| audit #2 / SIM-P19 | P0  | Strike/removal notices: no reason, link `/ustaad/notifications` 404s, no appeal route                        | notice page + Appeal action; bell links resolve         |
| audit #4           | P0  | Jobs scam line lacks "Call 1930 / cybercrime.gov.in"                                                         | en + hi copy                                            |
| SIM-P16            | P1  | Common Hindi slur published, not held                                                                        | word list + test with Devanagari and Hinglish spellings |
| SIM-P10            | P1  | Voice recorded and uploaded with no `ustaad_voice` consent prompt                                            | consent before first recording (DPDP)                   |
| SIM-P20 / SIM-G17  | P1  | Smart correction applied without the author choosing; Haiku path unreachable; "Fix by itself" not selectable | suggest mode must only suggest                          |
| SIM-B8             | P1  | Held scam DM: only Release/Remove, no Warn/strike; reason label wrong                                        |                                                         |
| SIM-P11            | P1  | No bell `ustaad.vouch_requested` to the voucher                                                              |                                                         |

## Batch B — privacy and gating

| Id                | P        | What                                                                                                             |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| SIM-B1 / audit #8 | P1       | Signed-out `/ustaad/*` answers 200 + Ustaad strings in the HTML; must be the real 404 with no `ustaad` namespace |
| SIM-B5            | P2→check | A community manager sees every admin section in the side nav (API still guards; verify no data leaks, then hide) |

## Batch C — render, accessibility, performance (lead verifies each live)

| Id            | P   | What                                                                                                                               |
| ------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| audit #1      | P0  | Member pages jump on load (CLS 0.83 Home, 0.11–0.63 others): client gate swaps skeleton → page; JS 455 KB on Home vs 150 KB target |
| audit #5      | P1  | Hindi dock/rail never marks the current tab (`ustaad-nav.tsx:48` `canonicalPath` → `stripLocale`)                                  |
| audit #6      | P1  | Dark contrast: coach-mark "समझ गया" 1.17:1, Best-answer pill 1.72:1, recorder stop 2.17:1, WhatsApp share 3.07:1                   |
| audit #3      | P0  | Like/Comment icon-only below 420 px — always show the word                                                                         |
| audit #9      | P1  | Recorder: no Cancel, label stays "Record" while recording, no time-left announcement                                               |
| audit #10     | P1  | Dock: no word on Create, 11.5 px labels, 1.1:1 current-tab tint; 0 community-rules links on Home/Jobs/Me                           |
| audit new     | P1  | Two headers + two bells + parts search inside the network (landscape / 200 % zoom leave little content)                            |
| audit new     | P1  | Dock covers the focused "About the job" textarea (`/ustaad/jobs/new`)                                                              |
| SIM-P12       | P2  | Follow/Save/Follow tag keep the same label when on (aria-pressed only) — say "Following"/"Saved"                                   |
| SIM-P8, audit | P2  | "अपना गैराज पिन करो" 22 px, "1 comment" 20–22 px — 24 px minimum                                                                   |
| SIM-LEAD-9    | P3  | "← Back to partners" 18 px                                                                                                         |
| SIM-LEAD-4    | P3  | "+91 9000000005" breaks across lines on the staff two-step                                                                         |
| SIM-LEAD-8    | P3  | reCAPTCHA badge inside the sign-in form on phones → hide badge + one-line notice                                                   |
| audit         | P2  | Composers keep no draft; Devanagari line-height 1.25; Latin member names not marked user content                                   |

## Batch D — Hindi / i18n (hard rule 10)

| Id                 | P   | What                                                                                                                                                                        |
| ------------------ | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| audit #7 / SIM-P21 | P1  | Bell rows English on `/hi`: text composed at insert in `users.language` (`notices.ts:169,185`) and topic is a raw code → store keys + params, render in the viewer's locale |
| SIM-P4             | P1  | `/en/ustaad/me` shows Hindi level/badge names and "Unlocks" lines                                                                                                           |
| SIM-P5             | P2  | `/partners/status` step "पक्का" collides with level "पक्का उस्ताद"                                                                                                          |
| SIM-P15            | P2  | Phone-number / number-plate blocks use the generic "forbidden words" message                                                                                                |

## Batch E — admin console (network)

SIM-B2 (save bar keeps the alert after the fix) · SIM-B3 (row errors at the region top) · SIM-B4 (first-post hold shown
as "Other · Word list" + raw code) · SIM-B6 (approval shows as "Other network action") · SIM-B7 (Promotions → Add shows
errors before typing) · SIM-B9 (same post reported twice = two queue items) · SIM-B10 (level review looks like a first
verification) · SIM-B11 (ban confirm has no summary; member card hides pending ban) · SIM-B12 (takedown form needs a
36-char id no screen shows; default basis "Court order") · SIM-B13 (ban proposer offered "Decide the appeal", API 403) ·
SIM-B14 (leaving settings drops unsaved edits without asking) · SIM-B15 (audit log raw codes, no Ustaad filter, second
approver missing) · SIM-G14 (no member/joins overview) · SIM-G15 (promotions: no targeting, no preview) · SIM-LEAD-7
(Delivery tabs vs filters look identical, no counts) · SIM-LEAD-5 (staff sign-in ignores the return page — verify).

## Batch F — content, data, flows

SIM-P2 / SIM-G16 (no curated hashtags on live: seed them) · SIM-P3 (media `complete` 504 once; retry re-uploads all) ·
SIM-P6 (story and other locks known only after the upload → orphan media) · SIM-P13 (profile Posts counter 0 after a held
post was released) · SIM-P14 (new message to a connection shows request-only rules) · SIM-P7 (Chhotu Home shows the
answerer block) · SIM-LEAD-1 (email verification lags on other devices: "I've verified — check again").

## Founder decisions needed (queued, not built)

- Voice items without a text alternative (audit item 5): transcripts / speech-to-text or a typed summary.
- Dock tabs (audit item 7): Home · Ask · Learn · Jobs · Me vs today's Home · Discover · Create · Learn · Me.
- Community rules page public before the network opens.

## Member-side batch B status (builder, 2026-11-27 night; details in spec 23 § 21i)

| Id     | Status | Note                                            |
| ------ | ------ | ----------------------------------------------- |
| SIM-P4 | fixed  | card route takes `?lang`; web passes its locale |
