# Backlog audit 2026-11-28 23:30 IST (lead)

Read-only reconciliation of the 67 rows still marked "open" in `qa-backlog-2026-11-27.md` (code reads, git history,
progress/decisions/questions; nothing run live). Result: **every P1 is fixed**; 15 rows were fixed but never marked
(now marked); **42 open (P2 28, P3 14)**, 8 need a live check, 1 waits on the founder (SIM-P21 = Q-NTC-1), 1 decided
(DC-P3, `customers.require_verified_email`; check the account-page copy still says "required").

## Open — delivery, COD, checkout (batch DC)

| Id            | P   | What is missing (file:line at audit time)                                                                                 |
| ------------- | --- | ------------------------------------------------------------------------------------------------------------------------- |
| DC-B4         | P2  | Agent invite and revoke act on one click, no confirm or email field: admin-delivery.tsx:912, 1063                         |
| DC-B8         | P2  | Stale COD approve error sits in the card that refresh() removes: admin-cod-requests.tsx:203, 453                          |
| DC-B10        | P2  | Suggestions UI ignores `eligible`, still shows "Offer": admin-delivery.tsx:399                                            |
| DC-B13        | P2  | Queue DTO uses s.name only (no Hindi), waitingMin keeps running for done jobs: delivery-jobs.ts:1860, 1902                |
| DC-F2         | P2  | Verify button not gated on an audited document view: admin-delivery.tsx:~1636                                             |
| DC-G1         | P2  | No admin screen calls PUT /shop/{id}/delivery-mode; api-clients.ts:160-170 only the request flow                          |
| DC-P14        | P2  | Checkout treats only role==='customer' as a buyer (workshop owners, new agents told "Sign in"): checkout-form.tsx:84, 101 |
| DC-P15        | P2  | Rider job items use orderItems.title, no titleHi / Hindi area (rule 10): delivery-jobs.ts:1699                            |
| DC-B5         | P3  | Application reject uses APPLICATION_REJECT_REASONS without a note: admin-delivery.tsx:1001                                |
| DC-B9         | P3  | Same cause as DC-P14                                                                                                      |
| DC-B12        | P3  | A repeat payout correction returns ok, so "added" still shows: delivery-payouts.ts:130, admin-delivery-payouts.tsx:125    |
| DC-B14        | P3  | "Attempt {n}" shown, retry/send-back on one click: admin-delivery.tsx:389, 470-490                                        |
| DC-F1 / DC-P2 | P3  | submitAgentApplication has no phone dedupe: delivery-agents.ts:98                                                         |
| DC-F3         | P3  | Per-user COD rate limit counts refused attempts: cod.ts:207                                                               |
| DC-P6         | P3  | Only err_COD_REQUEST_TOO_SOON, no "ask again on" date                                                                     |
| DC-P7         | P3  | SHOP_MODE_REQUEST_REASONS all about delivering itself: codes.ts:200                                                       |
| DC-P12        | P3  | customer-delivery-api.tsx untouched since 11-27 (see bug detail on D:)                                                    |
| DC-P16        | P3  | status_changed notice params {} so it never says what changed: delivery-agents.ts:915                                     |
| DC-P19        | P3  | Seed change not made                                                                                                      |
| SIM-LEAD-7    | P2  | Admin → Delivery section tabs and job filters (admin-delivery.tsx)                                                        |

## Open — Mechanic Network (batch U)

**2026-11-29 update (batch U builder):** fixed in code (see spec 23 § 21j): SIM-P12, P15, F7, P14, P3, P6, P29, B4, B10, B11, B12 (basis; picker queued). Still open, queued as Q-U-*: B9, G14, G15, LEAD-1, P25, P30, P5, P7/P9, LEAD-8, RT3.

| Id          | P   | What is missing                                                                                 |
| ----------- | --- | ----------------------------------------------------------------------------------------------- |
| SIM-B4      | P2  | Pre-moderation hold shown as "Other · Word list" with a raw code as the reporter's note         |
| SIM-B9      | P2  | Same post reported by two members = two queue items (reports.ts:4; group per post)              |
| SIM-B10     | P2  | console-verify.tsx: a level review (Bada/Master) looks like a first verification                |
| SIM-B11     | P2  | Ban confirm has no summary; member card hides the pending ban: console-members.tsx:388          |
| SIM-B12     | P2  | Takedown form needs a typed 36-char id; default basis court_order: console-records.tsx:136, 159 |
| SIM-F7      | P2  | Hindi "question waiting" bell shows the raw segment code: publish.ts:101                        |
| SIM-G14     | P2  | No members/joins counter in the console                                                         |
| SIM-G15     | P2  | Promotions: no targeting (city / vehicle type), no card preview                                 |
| SIM-LEAD-1  | P2  | Email verification lags on other tabs/devices (no "I've verified, check again")                 |
| SIM-P12     | P2  | Follow / Follow tag keep the same label, aria-pressed only: profile-screen.tsx:249-254          |
| SIM-P14     | P2  | New message to a connection shows request-only rules + "Send request": new-thread.tsx           |
| SIM-P15     | P2  | Phone-number and number-plate blocks use the generic forbidden-words message: en.json:8542      |
| SIM-P25     | P2  | No line clamp in network cards                                                                  |
| SIM-P29     | P2  | Composer MAX_PHOTOS = 10 hard-coded (needs member limits endpoint): composer.tsx:36             |
| SIM-P3      | P2  | Media "complete" step has no retry                                                              |
| SIM-P30     | P2  | No save count in post DTOs                                                                      |
| SIM-P5      | P2  | /partners/status step key outside ustaad.* left untranslated                                    |
| SIM-P6      | P2  | No lock/restriction check before upload in composer.tsx                                         |
| SIM-P7 / P9 | P2  | Coach marks: only one target (page.tsx:119); P7 not fixed (P8 fixed)                            |
| SIM-LEAD-8  | P3  | reCAPTCHA badge not hidden (needs the allowed text instead)                                     |
| SIM-RT3     | P3  | Copy strings unchanged: en.json:7720, hi.json:7529                                              |

## Needs a live check

SIM-F5 (keyboard/NVDA walk), SIM-P13 (released held post bumps Posts), SIM-P31 (post card at 320 px), SIM-P32 (first
post/question badges), SIM-P33 (R2 PDF headers), DC-P17 (/hi/orders/{rejected}: empty label), DC-P18 (seller shown to
customer? ruling never queued → Q-DCP18), SIM-LEAD-5 (probably a bad test URL).
