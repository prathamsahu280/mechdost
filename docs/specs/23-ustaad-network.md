# 23 · Ustaad Network (mechanics-only professional network)

Status: **decided, not built** (spec written 2026-11-26) · Design: `docs/superpowers/specs/2026-11-26-ustaad-network-design.md`
· Plan: `docs/superpowers/plans/2026-11-26-ustaad-network.md` · Decisions: 2026-11-26 "Ustaad Network" · Questions:
Q-U1, Q-U3, Q-U4, Q-U5, Q-U6, counsel Q-UC1–7 (Q-U2 withdrawn by ruling) · Replaces: spec 17 § E, Q219 · Related: 01 (sign-in), 07 (trade
accounts, workshop portal), 08 (admin), 09 (appeals as tickets), 10 (notices), 12 (events), 13 (RBAC, limits, uploads),
14 (integrity), 15 (cities), 16 (budgets), 17 § B (learning), 20 (Coins).

Tagline: **"हुनर दिखाओ। पहचान बनाओ।" / "Hunar dikhao. Pehchaan banao."** Inputs: the founder's demo, the product study,
the market, legal and new-features research, the workflow page, the admin settings page and the clickable app
prototype (session scratchpad `ustaad/`, 2026-11-25/26). Where these disagree the order of precedence is: coordinator
provider rulings (2026-11-26) → founder rulings (2026-11-26) → the admin settings page (`ustaad-admin.html`, the later
of the two admin defaults) → the app prototype → the study and research. Every number below is an admin setting
unless it says "locked".

## 1. Purpose

A closed professional network inside MechDost for people who repair vehicles in Chhattisgarh: juniors (**Chhotu**)
learn and ask; experts (**Ustaad**) answer, teach, show their work and earn respect (**Izzat**) and levels. It combines
an ID card (pehchaan), voice-first Q&A, a work feed with photos, voice notes, short video and stories, learning,
jobs, mentorship, hashtags, follow/connect, discovery and a garage map, all moderated by a new staff role. MechDost
earns from parts mechanics buy (the normal shop, plus its own labelled promotions), never from fees on workers.

**Design rule (founder, binding): "something an Indian mechanic would actually use".** WhatsApp/YouTube-familiar
patterns (hold-to-talk mic, chat rows, bottom tabs, big tiles), voice first, targets ≥ 48 px, plain words with an icon
on every action, low data (no autoplay, sizes shown, data saver on), "proper modern components, not too complex".
MechDost tokens only (navy `#101f34`, accent `#ea5728`, filled buttons `#d2461a`, Manrope / DM Sans, Noto Sans
Devanagari for Hindi), light and dark themes, WCAG 2.2 AA. The demo's own colours and fonts are not used.

### Founder rulings (2026-11-26, binding)

| Topic            | Ruling                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope            | Everything at once: feed incl. stories and short video, Q&A, jobs, Discover, mentorship, hashtags, follow/connect, garage pin + zones, smart correction, moderation, admin settings |
| Names            | Juniors **Chhotu**, experts **Ustaad** with levels **Naya → Pakka → Bada → Master**; level rules are the founder's demo rules (followers count)                                     |
| Age              | **No age check** (no age screen, no date of birth, no age column). Legal cost recorded in decisions 2026-11-26                                                                      |
| Currency         | **Izzat** = reputation, never spendable; **MechDost Coins** (spec 20, discount only) are the only reward. No other currency                                                         |
| Verification     | Garage owner confirms + Ustaad vouch; **MechDost staff give final approval**; certificate upload not decided (off)                                                                  |
| Who can join     | Open to all mechanics from day one (no invite-only phase)                                                                                                                           |
| Out of scope     | Udhaar/credit, job card / GST invoice for mechanics, trade prices: **decide later** (PENDING #25–#27)                                                                               |
| Location         | Default = area name + rough circle; **exact pin only if the mechanic opts in**                                                                                                      |
| Short video      | Up to **180 s**, admin-configurable                                                                                                                                                 |
| Counts           | Like and follower counts **visible**                                                                                                                                                |
| Audience         | Network visible to **mechanics only** (locked); reach **within Chhattisgarh**                                                                                                       |
| Moderation       | New staff role **`community_manager`**                                                                                                                                              |
| Promotions       | **MechDost's own** only, labelled **Sponsored / प्रायोजित**; no outside advertisers                                                                                                 |
| Smart correction | Both modes (suggest before posting; auto-fix keeping the original) and off; admin picks the default                                                                                 |
| Language         | UI Hindi + English; voice notes in any language                                                                                                                                     |
| Configurability  | Every rule and threshold admin-configurable (hard rule 8)                                                                                                                           |

### Provider rulings (coordinator, 2026-11-26, binding)

1. **Voice notes are posted as they are (audio only). No speech-to-text at all.** Transcripts: **not planned**. Voice
   search is not built either (it would be speech-to-text). Text-to-speech "Listen" on typed posts uses the browser's
   own `speechSynthesis` and sends nothing anywhere.
2. **Smart correction uses an LLM behind a `SmartCorrection` adapter** (default a small, cheap model: Claude Haiku
   class via the Anthropic API; alternative Google Gemini free tier), with the **rule/word-list engine as fallback**
   when no key is set, on error or on timeout (§ 11).
3. **Media storage: Cloudflare R2** (free tier 10 GB-month, zero egress) behind a `MediaHost` adapter; uploads go
   **direct from the phone with short-lived presigned PUT URLs**, verified server-side after upload; private bucket with
   signed GET URLs. Client-side compression; **no server transcoding in v1**. Supabase Storage stays as the fallback
   adapter (and is the default until Q-U1 is answered) with the same caps (§ 10).

## 2. Glossary (domain-modeling; the repo has no GLOSSARY.md, so terms live here)

- **Member**: a user holding the `mechanic` grant. One per user. The same person may also be a workshop owner, a shop
  user or a trade buyer; these are separate grants, never one "type".
- **Track**: `apprentice` (learning; shown "Chhotu" / "छोटू", the code is neutral so the label can be renamed without a migration, security review §0) or `ustaad` (expert). Chosen at join, changes only by level rules or staff.
- **Level**: a step on the ladder: `apprentice` (Chhotu), `ustaad_pending` (shown "Ustaad · to verify" / "उस्ताद · जाँच बाकी"),
  `naya`, `pakka`, `bada`, `master`. Levels are **data, not roles**.
- **Verification**: a member's request to have their work confirmed; evidence = **attestation** (a garage owner says
  "X works here") and **vouches** (a Pakka+ Ustaad says "I know X's work"); a community manager decides.
- **Izzat**: non-spendable reputation points from an append-only ledger. Never money, never converted to Coins.
- **Speciality**: a vehicle or work tag a member declares (2W, 4W, EV, AC, electrical…), with a step `shuru`
  (declared), `pakka`, `mahir` (earned).
- **Post**: anything shown in the feed (voice, photo, video, text, document, poll, link, mixed; templates Fix log, Tip,
  Before/After). A **question** is a Q&A thread, not a post; a **story** is a post that expires.
- **Zone**: a fixed hexagonal cell (~5 km²) used only for counting mechanics per area.
- **Garage pin**: the location a member confirms; shown as an **area + circle** unless they opt in to the exact pin.
- **Report / moderation action / strike**: a member's complaint with a reason code; a staff decision; a recorded
  penalty with a reason code that can restrict or ban.
- **Promotion**: a MechDost-authored card in a named slot, always labelled Sponsored.

## 3. Roles and RBAC

Permissions are checked in the API (`requirePermission`) and scoped in repositories; RLS mirror deny-all (spec 13).

**Member (`mechanic` role, scope `self`).** Joining grants the role (existing `user_roles`; the role row exists today
with `account:read`, `account:write`, `tickets:create`). New permissions added to it:

| Permission         | Allows                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ustaad:use`       | Read the network, post, comment, react, save, share, follow, connect, message, report, ask, learn                                                              |
| `ustaad:answer`    | Answer questions; the repository also requires track `ustaad` (or setting `qa.apprentice_can_answer`)                                                          |
| `ustaad:vouch`     | Vouch for another member; the repository requires level ≥ `vouch.min_level` and account age                                                                    |
| `ustaad:jobs_post` | Post jobs; the repository also requires an **employer check** (workshop owner/staff grant, or a verified trade account of type `garage`/`mechanic` with GSTIN) |

Levels, track, status (banned, restricted) and per-feature switches are checked in repositories on every call, never
cached in the token. A non-member (customer, shop user, staff without an Ustaad permission) gets **404** on every
`/v1/ustaad/*` member route (the network is invisible, not "forbidden").

**Workshop owner / staff** (existing grants): see "Confirm your mechanics" in the workshop portal (attestations for
their workshops only; foreign ids 404) and may post jobs for their workshop when they are also members.

**Staff role `community_manager`** (new, `staff: true`, scope `city` like `city_manager`; a grant with no city covers
all cities): moderation and verification. Permissions:

| Permission              | Allows                                                                              | Roles                                      |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| `ustaad:read`           | Read members (masked phone), posts incl. held/removed, reports, queues, zone counts | community_manager, super_admin, ops (read) |
| `ustaad:moderate`       | Keep/remove/hold/restore content, warn, restrict, ban, decide reports and appeals   | community_manager, super_admin             |
| `ustaad:verify`         | Decide verification requests, revoke verification, confirm level reviews            | community_manager, super_admin             |
| `ustaad:location_exact` | See a member's exact pin (every view written to `audit_log`)                        | community_manager, super_admin             |
| `ustaad:promotions`     | Create and schedule MechDost promotions in Ustaad slots                             | marketing, super_admin                     |
| `ustaad:settings`       | Edit every `ustaad.*` setting and the admin tables (levels, badges, tags, words)    | super_admin (community_manager reads)      |
| `ustaad:takedown`       | Execute a legal takedown order (fast path, § 13)                                    | community_manager, super_admin             |

Four-eyes (spec 13 pattern): a **strike above `mod.four_eyes_from`** (default: any ban ≥ 7 days), a **level
demotion**, and every **appeal** need a second staff member (decider ≠ original actor; 403 `FOUR_EYES`). Staff never
moderate their own content (403 `SELF_MODERATION`).

**`community_manager` limits (SR-38):** city scoped (a city-A manager gets 404 on city-B queues and members), staff 2FA
always (spec 01 two-step), **no `customers:read_pii`, no `exports:run`**, phone numbers masked everywhere. Message
(DM) content is readable only from an open report on that thread: the call carries the report id and a reason code and
writes an `audit_log` row (`ustaad.dm_read`); no other staff path reads messages. **Staff final approval of
verification and of every promotion to Bada or Master is locked on (SR-8, founder ruling): no setting can switch it
off** (the prototype admin's "Without it, proofs approve automatically" switch is dropped). The official/staff badge
on a member comes only from a server-side flag set by a super admin (SR-5).

**Role-leak matrix (security review § 4.2, adapted to the rulings):** anonymous 401 on every route; customer, shop,
workshop, support, finance and marketing accounts without a membership 404 on member routes (the network is
invisible) and 403 on staff routes (marketing reaches only the promotions routes through `ustaad:promotions`); a new or unverified member uses feed, Q&A, posts, follows and Learn at once
(ruling: verification is never a wall) but cannot post jobs, see the area map or start messages before the limits in
SR-33; a member blocked by an author gets 404 on that author's profile, posts, media and messages (SR-35);
community managers as above; super admin everything, invariants enforced. SR-1's "unverified members read only their
own profile" is **not** adopted because it contradicts the founder's "open to all from day one" (recorded in decisions).

## 4. User flows

1. **Join = "Apply as a mechanic" (under 2 minutes, never waits for verification; founder 2026-11-26: "make changes to
   the apply as a mechanic accordingly").** One flow, reachable at `/ustaad/join` and at the existing public
   `/partners/apply/mechanic` (the same component; § 4a). Signed out → existing phone OTP sign-in (spec 01), then back
   to the step. **Five steps, as in the prototype:** (1) "Who are you?" two picture buttons Chhotu / Ustaad (an Ustaad
   starts as `ustaad_pending`, shown "Ustaad · to verify"); (2) what you fix: vehicle and work speciality tiles; (3)
   name, garage or workshop name (hidden by default), area (city must be an enabled Chhattisgarh city, § 15), years of
   experience, "Shop or garage" / "From home or roadside"; (4) how to verify: garage owner confirms / an Ustaad I know
   vouches / certificate ("Coming soon", off) / "Do it later"; (5) choices: **one required consent** ("Save my profile
   for the mechanic network") and three optional, **unticked** (directory/Discover, training updates, parts and
   business offers on WhatsApp). **No age screen** (ruling). Submit creates the membership at once with
   `verification_state = pending_verification` when a method was picked (else `unverified`); the member uses the
   network right away as Chhotu or "Ustaad · to verify"; staff give the final approval (flow 2). Then the card ("Your
   card is ready") and the first-time tutorial (flow 15).
2. **Get verified.** Pick one or more proofs (at join or later from Me): garage owner confirms (a MechDost workshop → its owner confirms in the
   workshop portal; a garage not on MechDost → the owner gets a one-time link by WhatsApp/SMS when templates are
   live, otherwise staff call), and/or 2 Pakka+ Ustaads from 2 different garages vouch; ask for a level (Naya default
   for Ustaads). Certificate upload is shown as "Coming soon" (off, PENDING #28). **Evidence rules (SR-6, SR-7):** an
   attestation counts only when the owner is a verified MechDost workshop partner, or (a garage not on MechDost) the
   owner gives a GSTIN or Udyam number plus a shop photo whose pin is within 200 m of the member's garage pin; at most 10
   attestations per owner per quarter. A vouch counts only from a Pakka+ Ustaad whose account is ≥ 60 days old, who is
   not vouched for by the same member (no reciprocal pairs), at most 3 vouches a month per voucher; a verification by
   vouches needs vouchers from ≥ 2 different garages. When the evidence is in, the request
   enters the community manager queue; approve sets a level ≤ the level asked (reason codes on reject:
   `owner_unreachable`, `proofs_mismatch`, `duplicate_account`, `other` + note). **Never Aadhaar.**
3. **Ask (Q&A, the daily loop).** Home "Stuck on a job? Ask an Ustaad" → hold-to-talk voice (≤ `qa.voice_max_s`),
   photo, or text; pick a vehicle tile (+ optional model); smart correction on typed text → send. The question goes
   first to up to `qa.notify_ustaads` matching Ustaads (speciality + city, by Discover score) → answers by voice, photo
   or text → helpful votes → the asker marks one **best answer** → Izzat and counts update → "Parts used in this fix"
   (MechDost catalogue links chosen by the answerer or staff) under the best answer. No answer in `qa.widen_after_h`
   → widened to all enabled cities. Safety notes on brake, steering, fuel, airbag and EV/high-voltage tags; disclaimer
   on every answer ("Community advice, not a professional guarantee…").
4. **Post your work ("Kaam dikhao").** Create (+) → quick start Fix log (problem / reason / what fixed it), Tip,
   Before/After, Question (goes to Ask), or any media: photos (≤ `posts.max_photos`), voice (hold mic), short video
   (≤ `posts.video_max_s`, trimmed on the phone), text, document (PDF), poll, link, story, photo + voice → tags (≤ 5,
   at least 1 curated, suggested from the vehicle) → privacy checks (blur faces/plates tool on by default, "cover
   customer details" on bills, no phone numbers) → smart correction → preview → Post (2 taps on the fast path). Offline:
   the draft is kept on the phone and sent when the network returns. Cap `posts.per_day`.
5. **React.** Like (count visible, ruling), Reply (voice, photo or text), Save, Share (WhatsApp teaser link / copy link /
   send to a mechanic), Report. Tap a tag to see its posts and questions; follow a tag.
6. **Stories.** "Today at the garages" rings on Home; add a photo, voice or short video story; gone after
   `stories.hours`; viewers tap sides, hold to pause, swipe down to close; "Seen by N" visible to the owner only; reply
   goes to messages.
7. **Follow / connect / message.** Follow (one tap, no approval, open to all members). Connect (two-way request →
   accept/ignore). Messages (SR-33, SR-34): **request-only for every member by default** (`dm.default_mode` =
   `request`, admin-configurable; no gender field is ever collected; each member can change it in their choices,
   Q-U5): the first message is a text-only request, **no links or media before the receiver accepts**; accounts
   younger than 7 days cannot start a thread; at most 20 new threads a day. **The phone number never appears in any
   Ustaad API response** (only what a member types into a message themselves); job applicants share it only by
   ticking the box. Mute, block (404 everywhere, SR-35), remove follower.
8. **Discover.** Search by name, area, work or tag (typed; no voice search, ruling 1); filters work / area / city;
   "Top helpers this month" ranked by helpful and best answers (§ 9.4), new Ustaads guaranteed slots; "Suggest me to
   others" switch (opt-out, no penalty).
9. **Mentorship.** A Chhotu asks "Be my Ustaad" → the Ustaad accepts or declines → both cards show the link ("Trained
   by" / "My shagirds") → the Ustaad can vouch from the shagird list → either side ends it with a reason code.
10. **Pin my garage and area map.** Pin: three location choices (all off at start: use pin for verification, count me
    in my area total, show my exact pin to other mechanics) → "Use my location" (accuracy circle; readings worse than
    `loc.gps_max_m` ask for a landmark) → drag/nudge buttons → "This is my garage" (`यही मेरा गैराज है`) → optional
    signboard photo for "Verified location" (staff check). Area map (verified members only): zones shaded by count
    with privacy bands (§ 9.6). Home/roadside members never show a point, only the area name. "Near you" lists show
    **distance bands** ("under 2 km", "2–5 km", "5–10 km", "10+ km"), never a km number, and are never sorted by exact
    distance (§ 9.6, SR-29–32). The pin can be moved at most 3 times in 24 h and 6 times in 30 days (SR-30).
11. **Jobs (Naukri).** Verified employer posts a job (role code, pay range per month in paise, timing, experience,
    area, vehicle types, "I hire only people aged 18 or older" attestation, expiry) → scam-phrase check → listed →
    member taps "Apply with my card" (phone shared only if ticked, optional voice intro) → employer sees the card →
    seen / shortlisted / rejected / hired, each notified. "MechDost never asks for money for a job" banner on every
    job screen.
12. **Learn (Seekho).** Courses and curated videos (`ustaad_courses`, `ustaad_learning_resources`; spec 17 § B idea, first built here) by vehicle/work; data saver (tap to play, size
    shown); "videos watched" counts toward the Naya rule; MechDost training cards labelled.
13. **Report → moderation → appeal** (§ 13).
14. **Settings and my choices.** Language, data saver, smart correction mode (if `correction.member_can_change`),
    message mode, suggest-me switch, location choices, the four join consents, leave the network (keeps the MechDost
    account; content handled per § 13 retention).
15. **First-time tutorial and coach-marks (founder 2026-11-26: "a tutorial sort of thing for them too").** Right after
    join: 4–6 short swipeable cards with a big picture or light animation each, a **play button for voice narration**
    (recorded audio in Hindi and English uploaded by staff; if a card has no recording, the browser's own
    `speechSynthesis` reads the text, never auto-played), Next / Back, **Skip anytime**. Default cards (admin-editable,
    en + hi): "Sawaal poocho" (ask by voice), "Kaam dikhao" (post a photo, voice or video), "Jawab do aur Izzat kamao",
    "Level badhao: Chhotu → Master", "Apna garage pin karo", "Dukaan" (parts from MechDost). After the cards,
    **contextual coach-marks** the first time each main control is seen (mic, Create +, Like/Reply, Discover, Pin
    garage, Jobs): one at a time, a small bubble pointing at the control, dismissable with "Samajh gaya / Got it", never
    blocking the screen or stacking. "Help / Kaise use karein" in Me replays the cards and resets coach-marks; Learn has
    a "How to use Ustaad Network" course of short how-to videos (tap to play, size shown). Progress is stored per member
    and tracked (§ 16). Accessible: focus moves to the card heading, swipe has button equivalents, `prefers-reduced-motion`
    shows static pictures, narration has the text on screen. Low data: pictures are small WebP/SVG, narration ≤ 30 s per
    card (Opus), nothing plays by itself.

### 4a. "Apply as a mechanic" becomes the Ustaad join (spec 07 change)

- **Form.** `/partners/apply/mechanic` (kind `mechanic` of `partner_applications`) no longer writes a partner
  application: it renders the Ustaad join flow (flow 1). **Seller and workshop (`garage`) applications are unchanged.**
- **Status page.** `/partners/status` (and `/partners/applications/[code]` for old codes) shows a mechanic's
  **verification progress** (method chosen → owner confirmed / vouches 1 of 2 → MechDost review → verified or the
  reason) read from `ustaad_verifications`, with the "Open Ustaad Network" button.
- **Copy.** The partners page card and the footer link "Apply as a mechanic" now explain the network (locale keys
  `partners.mechanicTitle/Body/Point1-3`, `apply.title_mechanic`, `details_mechanic`, en + hi): "Join the Ustaad
  Network: ask Ustaads, show your work, earn Izzat and levels, find jobs. Only mechanics can see it." The old point
  "a skills profile that garages and **customers** can trust" is replaced (the network is mechanics-only).
- **Admin.** Partners › Applications, Mechanics tab: a notice "Mechanic applications moved to the Ustaad Network" with
  a link to Admin › Ustaad › Verification (`/admin/ustaad?section=verify`) and the count of open requests; old rows
  stay readable (history). The Partners › Mechanics list links each member to their Ustaad admin page.
- **Existing mechanic applications (data migration, script `pnpm db:ustaad:map-mechanic-applications [--dry-run]`).**
  A membership needs the member's own required consent, so old applications are **not** turned into members
  silently. Instead: every `partner_applications` row with `kind = 'mechanic'` gets a `ustaad_application_links` row
  (application id, phone hash, prefill json with name, PIN and the free-text details as a note, status
  `invited|joined|closed`); open ones (`new`, `in_review`) are closed with reason code `moved_to_ustaad` (status
  history kept) and the applicant is invited (bell if they have an account; WhatsApp/SMS invite when templates are
  live; otherwise a CSV for staff calls) with a link `/ustaad/join?from=<application code>` that pre-fills steps 3–4.
  When that person joins, the link row becomes `joined` and `ustaad_members.source_application_id` is set; staff may
  fast-track the verification for applications that had already been approved (`verify.fast_track_approved_apps`).
  The `kind` CHECK keeps `mechanic` so history stays valid; the public API refuses new `mechanic` application bodies
  with 410 `MOVED_TO_USTAAD` (the web form never sends one).

## 5. Screens (mobile first; route group `apps/web/src/app/[locale]/ustaad/`)

The Ustaad shell has its own bottom tab bar (Home · Discover · Create (+, raised) · Learn · Me) at every width under
1024 px and a left rail above; the site tab bar is hidden inside `/ustaad` (one tab bar per screen). Shared frame in
the layout (no reload feel); every opened sheet closable; one primary action per screen; empty states with one next
action; Hindi default for new members (`general.default_lang`), English switch in the header.

| Route                                                      | Screen                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/ustaad`                                                  | Home: greeting, stories row, shortcuts (Ask, Jobs, Dukaan, Learn, My network, Area map, Saved, Pin garage, My card), "Questions waiting for you" (Ustaad) or "Your questions" (Chhotu), feed For you / Following, pin prompt |
| `/ustaad/join`, `/partners/apply/mechanic`                 | The 5-step join (one component; non-members land here from any `/ustaad` link); then the tutorial                                                                                                                            |
| `/ustaad/welcome`                                          | First-time tutorial cards (flow 15); replay from Me › Help / Kaise use karein                                                                                                                                                |
| `/ustaad/s/[token]`                                        | Share teaser for non-members (sign in to see; no content)                                                                                                                                                                    |
| `/partners/status`                                         | For mechanics: verification progress (§ 4a)                                                                                                                                                                                  |
| `/ustaad/ask`, `/ustaad/ask/new`                           | Q&A list (All, For you, Mine, No answer yet) and the composer sheet                                                                                                                                                          |
| `/ustaad/q/[code]`                                         | Question thread with answers, best answer, parts used, report                                                                                                                                                                |
| `/ustaad/create`                                           | Composer (quick start + any media), draft restore                                                                                                                                                                            |
| `/ustaad/p/[id]`                                           | Post detail with replies                                                                                                                                                                                                     |
| `/ustaad/stories/[memberId]`                               | Full-screen story viewer                                                                                                                                                                                                     |
| `/ustaad/discover`                                         | Search, filters, top helpers, tags                                                                                                                                                                                           |
| `/ustaad/tags/[slug]`                                      | Tag page (posts, questions, follow tag)                                                                                                                                                                                      |
| `/ustaad/m/[handle]`                                       | Member card and profile (posts, answers, badges, level ladder with "You are here")                                                                                                                                           |
| `/ustaad/me`                                               | My card (share as image, QR), stats, level ladder, badges, my work, settings and my choices                                                                                                                                  |
| `/ustaad/me/verify`                                        | Get verified                                                                                                                                                                                                                 |
| `/ustaad/network`                                          | Requests, near you, mentors / my shagirds, connected                                                                                                                                                                         |
| `/ustaad/messages`, `/ustaad/messages/[id]`                | Message requests and threads                                                                                                                                                                                                 |
| `/ustaad/jobs`, `/ustaad/jobs/[code]`, `/ustaad/jobs/mine` | Jobs list, detail + apply sheet, employer's jobs and applicants                                                                                                                                                              |
| `/ustaad/learn`                                            | Courses, short videos, MechDost training                                                                                                                                                                                     |
| `/ustaad/area`, `/ustaad/pin`                              | Zone map; pin my garage                                                                                                                                                                                                      |
| `/ustaad/saved`, `/ustaad/notifications`                   | Saved posts; notices filtered to the network (reuses the bell inbox, spec 10)                                                                                                                                                |

Admin (`/admin/ustaad`, page pattern of spec 08 "Page pattern"): sections General, Levels & Izzat, Verification (queue),
Posts & media, Smart correction, Location & zones, Feed & hashtags, Promotions, Moderation (reports queue sorted by
legal clock, banned words, reasons, blocked users, audit log), Jobs, Tutorial (cards, narration uploads, coach-marks, en + hi). One sticky save bar for settings; queues act
immediately. Workshop portal: "Confirm your mechanics" card. Copy for all screens comes from the prototype's locale
files (`app-i18n.js`, `app-social-i18n.js`) moved into the `ustaad` namespace (en + hi).

## 6. Data model

Conventions (spec 14): uuid v7 PKs; `version`, `created_at`, `updated_at`, `created_by` on mutable rows with
`bump_version` / `touch_updated_at` triggers; append-only tables use `forbid_update_delete()`; status columns are
`text` + CHECK generated from `packages/shared/src/state/ustaad-*.ts`; every FK indexed; RLS on, grants revoked, every
table in `rls-inventory.ts` as `none`; soft delete via `deleted_at` with partial uniques `WHERE deleted_at IS NULL`;
`city_id` on everything that is listed or counted. Public codes `UQ-{CITY}-{YYYY}-{6 base32}` (questions),
`UJ-…` (jobs), `UR-…` (reports). Migrations are **named, not numbered** (latest on main is 0087; the coordinator
renumbers at merge).

### 6.1 Identity and trust

| Table                        | Key columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Constraints / indexes                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ustaad_members`             | `user_id` FK, `handle` (citext), `display_name`, `display_name_hi` (optional), `photo_media_id`, `track`, `level`, `level_since`, `status` (`active\|restricted\|banned\|left`), `banned_until`, `city_id`, `area_label`, `area_label_hi`, `pincode`, `work_place` (`shop\|home_roadside`), `garage_name`, `show_garage` (default false), `workshop_id` (nullable FK),`years_claimed`smallint,`verified_years`smallint null,`verified_at`, `dm_mode` (`everyone\|request\|nobody`), `suggest_me` bool, `correction_mode` (null = network default), `lang`, `founding` bool, `last_active_at` | unique `user_id`; unique `handle`; (`city_id`,`level`); (`status`); (`last_active_at`)                    |
| `ustaad_member_specialities` | `member_id`, `code` (vehicle `two_wheeler\|three_wheeler\|car_suv\|light_commercial\|truck_bus\|tractor_farm\|ev` reusing `VEHICLE_SEGMENTS` where they match; work`engine\|electrical\|ac\|diagnostics\|tyres\|battery\|denting_painting\|suspension_brakes`), `step` (`shuru\|pakka\|mahir`), `earned_at`                                                                                                                                                                                                                                                                                  | unique (`member_id`,`code`); (`code`,`step`)                                                              |
| `ustaad_verifications`       | `member_id`, `requested_level`, `granted_level`, `status`, `proof_kinds` text[], `decided_by`, `decided_at`, `reason_code`, `note`                                                                                                                                                                                                                                                                                                                                                                                                                                                           | partial unique (`member_id`) WHERE status in (`requested`,`in_review`); machine § 7.1                     |
| `ustaad_attestations`        | `verification_id`, `member_id`, `workshop_id` null, `owner_user_id` null, `owner_phone_hash` null (non-partner owner; phone encrypted per spec 13, hash for dedupe), `since_year`, `status`, `token_hash`, `expires_at`                                                                                                                                                                                                                                                                                                                                                                      | partial unique one open per verification; (`workshop_id`,`status`)                                        |
| `ustaad_vouches`             | `voucher_id`, `vouchee_id`, `relation` (`worked_together\|trained_by\|known_work`), `status`, `verification_id`null,`revoked_reason_code`                                                                                                                                                                                                                                                                                                                                                                                                                                                    | CHECK voucher ≠ vouchee; partial unique (`voucher_id`,`vouchee_id`) WHERE status in (`requested`,`given`) |
| `ustaad_level_rules`         | `level`, `rule_group` (a level is reached when **any** group is fully met), `min_followers`, `min_best_answers`, `min_helpful_pct`, `min_verified_years`, `min_videos`, `min_recommendations`, `needs_staff_review` bool, `perk_en`, `perk_hi`, `coin_multiplier_bp` (default 10000), `name_en`, `name_hi`, `position`                                                                                                                                                                                                                                                                       | unique (`level`,`rule_group`); CHECK all ≥ 0, pct 0–100, multiplier 10000–30000                           |
| `ustaad_izzat_ledger`        | append-only: `member_id`, `delta` int, `reason_code` (`answer_posted\|best_answer\|helpful_received\|follower_gained\|video_completed\|strike\|reversal\|correction`), `source_type`, `source_id`, `idem_key`unique,`actor_id`                                                                                                                                                                                                                                                                                                                                                               | (`member_id`,`created_at`); reversal rows instead of edits                                                |
| `ustaad_member_counters`     | `member_id` PK, `followers`, `following`, `posts`, `answers`, `best_answers`, `helpful_votes`, `helpful_answers`, `videos_watched`, `recommendations`, `izzat`, `best_answers_30d`, `helpful_30d` (refreshed nightly)                                                                                                                                                                                                                                                                                                                                                                        | CHECK ≥ 0 (izzat may be negative, shown as 0)                                                             |
| `ustaad_badges`              | admin table: `code`, `name_en`, `name_hi`, `rule_en`, `rule_hi`, `icon`, `kind` (`speciality\|fun\|level`), `rule` jsonb (`schema_version`, `kind`∈`best_answers_with_tag\|helpful_answers_in_segment\|apprentice_answers_in_week\|first_post\|first_question\|first_answer\|founding`, params), `active`                                                                                                                                                                                                                                                                                    | unique `code`                                                                                             |
| `ustaad_badge_awards`        | `member_id`, `badge_code`, `awarded_at`, `revoked_at`, `revoked_reason_code`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | partial unique (`member_id`,`badge_code`) WHERE `revoked_at` is null                                      |
| `ustaad_events`              | append-only: `entity_type` (`member\|verification\|attestation\|vouch\|post\|question\|answer\|comment\|report\|job\|application\|mentorship\|connection\|message_thread\|media\|location`), `entity_id`, `kind`, `from_status`, `to_status`, `reason_code`, `actor_id`, `actor_role`, `city_id`, `props` jsonb (`schema_version`), `occurred_at`                                                                                                                                                                                                                                            | (`entity_type`,`entity_id`,`occurred_at`); BRIN `occurred_at`                                             |

### 6.2 Social graph and messages

| Table                           | Key columns                                                                                                      | Constraints / indexes                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ustaad_follows`                | `follower_id`, `followee_id`, `created_at` (hard delete on unfollow; the event row keeps history)                | PK (`follower_id`,`followee_id`); CHECK not self; index (`followee_id`,`created_at`)        |
| `ustaad_connections`            | `low_id`, `high_id` (ordered pair), `requested_by`, `status` (`requested\|accepted\|declined\|removed`)          | unique (`low_id`,`high_id`); CHECK `low_id < high_id`                                       |
| `ustaad_mentorships`            | `ustaad_id`, `shagird_id`, `status` (`requested\|active\|declined\|ended`), `ended_reason_code`                  | partial unique (`ustaad_id`,`shagird_id`) WHERE status in (`requested`,`active`); CHECK ≠   |
| `ustaad_blocks`, `ustaad_mutes` | `member_id`, `target_id`                                                                                         | PK pair; CHECK ≠; a block also removes follows/connection both ways in the same transaction |
| `ustaad_threads`                | `low_id`, `high_id`, `status` (`requested\|open\|declined\|blocked`), `requested_by`, `last_message_at`          | unique pair                                                                                 |
| `ustaad_messages`               | `thread_id`, `sender_id`, `kind` (`text\|voice\|photo\|post_share`), `body`, `media_id`, `post_id`, `deleted_at` | (`thread_id`,`created_at`)                                                                  |
| `ustaad_tag_follows`            | `member_id`, `tag_id`                                                                                            | PK pair                                                                                     |

### 6.3 Content

| Table                                                      | Key columns                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Constraints / indexes                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ustaad_posts`                                             | `author_id`, `city_id`, `kind` (`voice\|photo\|video\|text\|document\|poll\|link\|mixed\|story`), `template` (`fix_log\|tip\|before_after\|null`), `content_type` (`ugc\|mechdost_authored\|sponsored`), `body`, `body_original` (null when unchanged), `correction` (`none\|suggested_used\|auto`), `fix_symptom`, `fix_cause`, `fix_fix`, `segment_code`, `vehicle_model_id`, `link_url`, `ai_generated` bool, `status`, `expires_at` (stories), `held_reason_code` | (`author_id`,`created_at` desc); (`city_id`,`status`,`created_at` desc); partial (`expires_at`) WHERE kind = `story`; machine § 7.4 |
| `ustaad_post_media`                                        | `post_id`, `media_id`, `position`, `role` (`before\|after\|null`)                                                                                                                                                                                                                                                                                                                                                                                                     | unique (`post_id`,`position`)                                                                                                       |
| `ustaad_polls`, `ustaad_poll_options`, `ustaad_poll_votes` | poll: `post_id`, `closes_at`; option: `label`; vote: `option_id`, `member_id`                                                                                                                                                                                                                                                                                                                                                                                         | one vote per member per poll: unique (`poll_id`,`member_id`)                                                                        |
| `ustaad_post_tags`                                         | `post_id` or `question_id` (exactly one, CHECK), `tag_id`                                                                                                                                                                                                                                                                                                                                                                                                             | unique pair; (`tag_id`,`created_at` desc); ≤ 5 per post enforced in the repository + trigger count check                            |
| `ustaad_tags`                                              | admin: `slug`, `name_en`, `name_hi`, `group` (`vehicle_model\|repair\|part\|tool`), `aliases` text[] (normalised), `active`, `merged_into_id`                                                                                                                                                                                                                                                                                                                         | unique `slug`; GIN on `aliases`; trigram on `name_en`                                                                               |
| `ustaad_tag_suggestions`                                   | `member_id`, `text`, `status` (`open\|accepted\|rejected\|merged`)                                                                                                                                                                                                                                                                                                                                                                                                    | (`status`)                                                                                                                          |
| `ustaad_reactions`                                         | `post_id`, `member_id`, `kind` (`like`)                                                                                                                                                                                                                                                                                                                                                                                                                               | PK (`post_id`,`member_id`,`kind`)                                                                                                   |
| `ustaad_saves`                                             | `post_id`, `member_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                | PK pair; (`member_id`,`created_at` desc)                                                                                            |
| `ustaad_comments`                                          | `post_id` or `answer_id`, `author_id`, `parent_id` (one level of replies), `body`, `body_original`, `media_id`, `status`                                                                                                                                                                                                                                                                                                                                              | (`post_id`,`created_at`)                                                                                                            |
| `ustaad_story_views`                                       | `post_id`, `viewer_id`, `viewed_at`                                                                                                                                                                                                                                                                                                                                                                                                                                   | PK pair; deleted with the story                                                                                                     |
| `ustaad_post_counters`                                     | `post_id` PK, `likes`, `comments`, `saves`, `shares`, `views`                                                                                                                                                                                                                                                                                                                                                                                                         | CHECK ≥ 0                                                                                                                           |
| `ustaad_questions`                                         | `code`, `asker_id`, `city_id`, `reach` (`city\|state`), `segment_code`, `vehicle_model_id`, `work_code`, `title`, `body`, `body_original`, `voice_media_id`, `status`, `best_answer_id`, `safety_tag` (`brake\|steering\|fuel\|airbag\|ev_hv\|null`), `hide_garage` bool                                                                                                                                                                                              | (`city_id`,`status`,`created_at` desc); (`segment_code`,`work_code`,`created_at` desc); machine § 7.5                               |
| `ustaad_answers`                                           | `question_id`, `author_id`, `body`, `body_original`, `voice_media_id`, `status`, `counts_for_levels` bool (false while the author is `ustaad_pending`; set true on verification), `helpful_count`                                                                                                                                                                                                                                                                     | (`question_id`,`created_at`); partial unique one best per question via `ustaad_questions.best_answer_id`                            |
| `ustaad_answer_votes`                                      | `answer_id`, `voter_id`, `created_at`                                                                                                                                                                                                                                                                                                                                                                                                                                 | PK pair; CHECK voter ≠ author (trigger)                                                                                             |
| `ustaad_answer_parts`                                      | `answer_id`, `product_id` (MechDost catalogue), `added_by`                                                                                                                                                                                                                                                                                                                                                                                                            | unique pair; ≤ 5                                                                                                                    |
| `ustaad_promotions`                                        | `slot` (`feed\|stories\|search\|jobs\|learn\|answer_parts`), `title_en`, `title_hi`, `body_en`, `body_hi`, `target` (`product\|category\|coupon\|learning\|url_internal`), `target_id`, `city_ids`, `segment_codes`, `starts_at`, `ends_at`, `status` (`draft\|scheduled\|live\|ended`), `label` always shown                                                                                                                                                         | (`slot`,`status`,`starts_at`); MechDost-authored only (no brand or advertiser columns)                                              |
| `ustaad_courses`, `ustaad_learning_resources`              | course: `code`, `title_en`, `title_hi`, `position`, `active`; resource: `course_id` null, `kind` (`hosted_video\|external_link`), `title_en`, `title_hi`, `segment_code`, `work_code`, `duration_s`, `media_id` (hosted) or `url` (external), `label` (`none\|mechdost_training`), `position`, `active`                                                                                                                                                               | admin-curated (spec 17 § B data model, first built here); (`course_id`,`position`)                                                  |
| `ustaad_learning_progress`                                 | `member_id`, `resource_id` (FK `ustaad_learning_resources`), `watched_seconds`, `completed_at`                                                                                                                                                                                                                                                                                                                                                                        | unique pair                                                                                                                         |

### 6.4 Media (new table; the existing `media_objects` is CHECK-locked to WebP ≤ 8 MB and stays unchanged)

| Table                   | Key columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Constraints                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ustaad_media`          | `owner_member_id`, `host` (`r2\|supabase`), `bucket` (`quarantine\|media\|docs\|evidence`; prefix `q/`, `m/`, `d/`, `e/` in `object_key`), `kind` (`image\|video\|audio\|document`), `status`, `declared_bytes`, `declared_mime`, `sha256`, `duration_ms`, `width`, `height`, `object_key` (random `{prefix}/{memberId}/{uuid}.{ext}`, CHECK regex), `uploaded_at`, `verified_at`, `reject_reason_code`, `removed_retain_until`, `purge_after`, `lqip` (≤ 400 bytes base64 WebP, images and video posters) | CHECK mime per kind (image `image/webp\|image/jpeg`; video `video/mp4\|video/webm`; audio `audio/ogg\|audio/webm\|audio/mp4`; document `application/pdf`); CHECK bytes ≤ kind cap; machine § 7.8 |
| `ustaad_media_variants` | `media_id`, `variant` (`img_1080\|img_480\|thumb\|poster`), `object_key`, `bytes`, `width`, `height`                                                                                                                                                                                                                                                                                                                                                                                                       | unique (`media_id`,`variant`)                                                                                                                                                                    |
| `ustaad_media_usage`    | `member_id`, `day` (IST), `bytes`, `videos`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | PK pair; conditional increment for quotas                                                                                                                                                        |

### 6.5 Location and zones

| Table                | Key columns                                                                                                                                                                                                                                                                                                                                                                                     | Constraints                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ustaad_locations`   | `member_id` PK, `location` geography(Point) (exact, staff-only unless opted in), `accuracy_m`, `source` (`gps\|manual`), `mock_suspected` bool, `landmark`, `circle_center` geography(Point) (fixed per-member offset 0–150 m, set once), `zone_cell` text, `share_exact` bool, `count_in_zone` bool, `use_for_verify` bool, `hidden` bool, `confirmed_at`, `verified_at`, `signboard_media_id` | GIST on `location` and `circle_center`; (`zone_cell`)                           |
| `ustaad_zone_counts` | `zone_cell`, `city_id`, `computed_at`, `members`, `by_segment` jsonb (`schema_version`, counts per code), `center` geography(Point)                                                                                                                                                                                                                                                             | PK (`zone_cell`); exact counts **staff-only**; the member API applies the bands |

Zones are a fixed hexagonal grid computed in `packages/shared/src/ustaad/zones.ts` (pure function, no new dependency:
axial hex coordinates on a local equirectangular projection centred on 21.25°N, 81.63°E, edge `zones.cell_edge_m`
default 1,400 m ≈ 5.1 km²; cell id `hx:{q}:{r}`). H3 was considered and rejected (new dependency / extension not on
the Supabase allow-list without checking).

### 6.6 Jobs

| Table                     | Key columns                                                                                                                                                                                                                                                                                                                                                                                               | Constraints                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ustaad_jobs`             | `code`, `employer_member_id`, `workshop_id` null, `trade_account_id` null, `city_id`, `area_label`, `role_code` (`helper\|mechanic_2w\|mechanic_4w\|electrician\|ac_technician\|denter_painter\|tyre_technician\|other`), `title`, `description`, `pay_min_paise_month`, `pay_max_paise_month`, `timing`, `experience_min_years`, `segment_codes`, `adult_attested_at` (required), `status`, `expires_at` | CHECK pay min ≤ max, both > 0 (pay stated is mandatory); exactly one of workshop/trade account; (`city_id`,`status`,`created_at` desc) |
| `ustaad_job_applications` | `job_id`, `member_id`, `status`, `share_phone` bool, `voice_intro_media_id`                                                                                                                                                                                                                                                                                                                               | unique (`job_id`,`member_id`); machine § 7.7                                                                                           |

### 6.7 Moderation

| Table                       | Key columns                                                                                                                                                                                                                                                                                                                           | Constraints                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ustaad_reports`            | `code`, `target_type` (`post\|story\|comment\|question\|answer\|member\|job\|message`), `target_id`, `reporter_id` (null for staff/legal), `source` (`member\|auto_word\|auto_scam\|legal_order\|grievance`), `reason_code`, `note`, `clock` (`intimate_2h\|legal_3h\|standard_24h\|grievance_7d`), `due_at`, `status`, `assigned_to` | partial unique (`target_type`,`target_id`,`reporter_id`) WHERE open; (`status`,`due_at`) |
| `ustaad_moderation_actions` | append-only: `report_id` null, `target_type`, `target_id`, `action` (`keep\|hold\|remove\|restore\|warn\|restrict\|ban\|unban\|strike\|level_review\|takedown`), `reason_code`, `days`, `actor_id`, `second_actor_id`, `note`                                                                                                         | (`target_type`,`target_id`,`created_at`)                                                 |
| `ustaad_strikes`            | `member_id`, `reason_code`, `izzat_delta`, `expires_at`, `appeal_ticket_id`, `status` (`active\|overturned\|expired`)                                                                                                                                                                                                                 | (`member_id`,`status`)                                                                   |
| `ustaad_word_lists`         | admin: `list` (`banned\|scam_phrase\|protected\|pii_pattern`), `phrase`, `phrase_norm`, `lang`, `active`                                                                                                                                                                                                                              | unique (`list`,`phrase_norm`)                                                            |
| `ustaad_report_reasons`     | admin: `code` (fixed codes for analytics: `wrong_unsafe\|illegal_modification\|abuse\|spam\|privacy\|minor\|not_work\|fake\|job_scam\|ip\|other`), `label_en`, `label_hi`, `active`, `default_clock`                                                                                                                                  | unique `code`; `other` cannot be turned off                                              |
| `ustaad_removed_archive`    | `target_type`, `target_id`, `snapshot` jsonb (text + media keys), `removed_at`, `retain_until` (removed_at + `mod.retention_days`)                                                                                                                                                                                                    | purge job deletes after `retain_until` unless a legal hold is set                        |

### 6.8 Settings storage

Scalar settings are `ustaad.*` keys in the existing `settings` table / `OPERATIONAL_SETTINGS` (`int`, `boolean`, plus a
new `enum` kind with an allowed-values list). Lists live in the admin tables above (levels, badges, tags, words,
reasons, promotions) and in `ustaad_reach_cities` (`city_id`, `enabled`). Weights that must sum to 100 use a
relation check like `apiLimitRelationProblem` (422 `SETTING_RELATION`). Every save: `settings:write` or
`ustaad:settings`, compare-and-set, `audit_log` (`setting.saved`).

### 6.9 Counters (no read-then-write)

A reaction, save, follow, vote or comment inserts its row with `ON CONFLICT DO NOTHING RETURNING`; only when a row
was inserted does the same transaction run `UPDATE … SET likes = likes + 1` on the counter row (delete mirrors with
`- 1` guarded by `> 0`). Counter rows are created with the parent. A nightly `ustaad_counter_reconcile` job recomputes
from source rows, fixes drift and logs `ustaad_counter_drift` when it finds any. Hot rows are acceptable at this
scale; sharded counters are the documented next step if lock waits appear (spec 16 dashboards).

### 6.10 Join, tutorial, previews, security extras

| Table / column                         | Purpose                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ustaad_members.verification_state`    | `unverified\|pending_verification\|verified\|revoked`(set by § 7.1 moves;`pending_verification` at join when a method was picked)                       |
| `ustaad_members.source_application_id` | the old `partner_applications` row when the member came from an invite (§ 4a)                                                                           |
| `ustaad_members.official`              | staff/official badge, set only by a super admin (SR-5)                                                                                                  |
| `ustaad_members.restricted_mode`       | `none\|minor_report\|review`(§ 13);`perks_frozen_until` (SR-2)                                                                                          |
| `ustaad_follows.counted`               | false when the ring check removed the follow from level counting (§ 14)                                                                                 |
| `ustaad_application_links`             | `application_id` unique, `phone_hash`, `prefill` jsonb (`schema_version`), `status` (`invited\|joined\|closed`), `member_id` (§ 4a)                     |
| `ustaad_tutorial_cards`                | admin: `position`, `code`, `title_en`, `title_hi`, `body_en`, `body_hi`, `image_media_id`, `audio_en_media_id`, `audio_hi_media_id`, `active` (flow 15) |
| `ustaad_coachmarks`                    | admin: `target` (`mic\|create\|like_reply\|discover\|pin\|jobs`), `text_en`, `text_hi`, `position`, `active`                                            |
| `ustaad_member_onboarding`             | `member_id` PK, `tutorial_completed_at`, `tutorial_skipped_at`, `last_card`, `coachmarks_seen` text[] (reset by "Help / Kaise use karein")              |
| `ustaad_link_previews`                 | `url_hash` PK, `final_host`, `title`, `description`, `image_media_id`, `status` (`ok\|blocked\|failed`), `checked_at`                                   |
| `ustaad_pin_changes`                   | `member_id`, `changed_at`, `distance_m`, `accuracy_m` (pin-change limits, SR-30)                                                                        |
| `ustaad_reserved_names`                | admin: `name`, `skeleton` (TR39 confusable skeleton of the NFKC-folded name; SR-4)                                                                      |
| evidence vault bucket                  | `ustaad-evidence` (CSAM and legal holds; `ustaad:takedown` only; excluded from purge jobs)                                                              |

## 7. State machines (`packages/shared/src/state/ustaad-*.ts`; every move = `machine.assert` + conditional UPDATE on `(id, status, version)` + `ustaad_events` row + `audit_log` for staff actions, one transaction)

1. **Verification:** `requested → in_review` (evidence complete: an attestation `confirmed` or ≥ `verify.vouches_needed`
   vouches `given`, or staff pull it in) `→ approved | rejected`; `requested → withdrawn` (member);
   `approved → revoked` (staff, reason code, four-eyes). Approval writes `verified_at`, `granted_level ≤
requested_level`, flips `counts_for_levels` on the member's answers, Izzat back-fill rows (idempotent keys).
2. **Attestation:** `requested → confirmed | declined | expired` (token 7 days); `confirmed → revoked`.
   **Vouch:** `requested → given | declined | expired`; `given → revoked` (voucher, any time; reason code).
3. **Level:** `apprentice → naya` (or `ustaad_pending → naya` on approval) `→ pakka → bada → master`, upward only by the
   engine (§ 9.2) or staff approval; downward only by a staff `level_review` with four-eyes after an upheld strike.
   Levels **never drop for inactivity** (perks pause after `levels.inactive_pause_days`).
4. **Post / story / comment:** `held` (auto: banned word, new-account media rule) `→ visible`; `visible → hidden_author`
   (author deletes; soft), `visible → removed` (moderation; archived), `removed → visible` (appeal upheld);
   stories `visible → expired` (job, at `expires_at`).
5. **Question:** `open → answered` (first visible answer) `→ solved` (best chosen) ; `open|answered → closed` (asker or
   inactivity `qa.auto_close_days`); any `→ removed`; `removed → previous` on appeal. Answer: `visible → removed →
visible`, `visible → hidden_author`.
6. **Report:** `open → in_review → actioned | dismissed`; `actioned → appealed → upheld | overturned` (appeal via a
   support ticket `REQ-…`, decided by a different staff member); an overdue clock raises `staff.ustaad_report_overdue`.
7. **Job:** `draft → pending_review` (scam/employer checks) `→ open → paused ↔ open → filled | closed | expired`; any
   `→ removed`. **Application:** `applied → seen → shortlisted → hired | rejected`; `applied|seen|shortlisted →
withdrawn` (member); a job leaving `open` moves open applications to `closed` with reason `job_closed`.
8. **Media:** `pending_upload → uploaded → verified | rejected`; `verified → removed_archived → purged` (removal) or
   `verified → purged` (story expiry + grace, account deletion); `pending_upload` older than 1 hour is purged.
9. **Connection / mentorship / thread / follow:** per the status lists in § 6.2; a block forces `blocked`/`removed`
   on all of them in one transaction.

## 8. API surface (Hono, all under `/v1`, Zod at the boundary, strict bodies, no mass assignment)

Member routes need `ustaad:use` + an active member row (404 otherwise); writes take `Idempotency-Key` where a double tap
would duplicate (create post, question, answer, comment, job, application, report). Lists use keyset cursors
(`cursor.ts`). Limits are Upstash sliding windows per member unless stated; all are settings `limits.*`.

| Area          | Routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Limit (default)                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Membership    | `GET /ustaad/me`, `POST /ustaad/join` (needs a verified phone; Turnstile; 3/day; optional `fromApplication` code), `GET /ustaad/onboarding`, `PUT /ustaad/onboarding` (card reached, skipped, completed, coach-mark seen), `POST /ustaad/onboarding/reset`, `GET /ustaad/tutorial` (cards + coach-marks in the member's language), `GET /ustaad/verification-status` (for `/partners/status`), `PATCH /ustaad/me`, `PUT /ustaad/me/specialities`, `PUT /ustaad/me/choices` (consents, dm mode, suggest me, correction mode), `POST /ustaad/me/leave`                                                                                                                                                                                                                                                                                                                                                                                 | 30 writes/10 min                                                                                                          |
| Verification  | `POST /ustaad/verifications`, `POST …/{id}/withdraw`, `POST /ustaad/vouches` (`ustaad:vouch`), `POST /ustaad/vouches/{id}/give\|decline\|revoke`, `GET\|POST /ustaad/attest/{token}` (public, Turnstile, 10/IP/h)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | vouches 5/day                                                                                                             |
| Workshop      | `GET /workshop/ustaad/attestations`, `POST …/{id}/confirm\|decline` (`service_menu:write` on that workshop)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 60/10 min                                                                                                                 |
| Media         | `POST /ustaad/media` (declare kind, mime, bytes, sha256, duration → presigned PUT, 10 min), `POST /ustaad/media/{id}/parts` (more part URLs for a resumable upload, only up to the declared size), `POST /ustaad/media/{id}/complete` (verify; parts list for multipart), `GET /ustaad/media/{id}/url?variant=` (signed GET)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 40 uploads/day, 3 videos/day; reads 600/min/IP                                                                            |
| Feed & posts  | `GET /ustaad/feed?tab=for_you\|following&cursor=`, `POST /ustaad/posts`, `GET\|DELETE /ustaad/posts/{id}`, `POST\|DELETE …/{id}/like`, `…/save`, `POST …/{id}/share` (channel code), `GET\|POST …/{id}/comments`, `POST /ustaad/polls/{id}/vote`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | posts `posts.per_day`; comments 30/h; likes 100/day (SR-43)                                                               |
| Stories       | `GET /ustaad/stories`, `POST /ustaad/stories` (a post with kind `story`), `POST /ustaad/stories/{id}/view`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | stories 10/day                                                                                                            |
| Q&A           | `GET /ustaad/questions?filter=`, `POST /ustaad/questions`, `GET /ustaad/questions/{code}`, `POST …/{code}/answers` (`ustaad:answer`), `POST /ustaad/answers/{id}/helpful`, `POST /ustaad/questions/{code}/best`, `PUT /ustaad/answers/{id}/parts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | questions 10/day, answers 30/day, votes 100/day                                                                           |
| Graph         | `PUT\|DELETE /ustaad/follows/{memberId}`, `POST /ustaad/connections`, `POST …/{id}/accept\|ignore\|remove`, `PUT\|DELETE /ustaad/blocks/{memberId}`, `…/mutes/…`, `DELETE /ustaad/followers/{memberId}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | follows 20/day (SR-43); connect 20/day                                                                                    |
| Mentorship    | `POST /ustaad/mentorships`, `POST …/{id}/accept\|decline\|end`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 5/day                                                                                                                     |
| Messages      | `GET /ustaad/threads`, `POST /ustaad/threads` (first message = request), `POST …/{id}/accept\|decline`, `GET\|POST …/{id}/messages`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | new threads 20/day (SR-33); messages 120/h; accounts younger than `limits.dm_min_account_days` cannot start threads       |
| Discover/tags | `GET /ustaad/discover?q=&work=&area=&city=`, `GET /ustaad/tags`, `GET /ustaad/tags/{slug}`, `PUT\|DELETE /ustaad/tags/{slug}/follow`, `POST /ustaad/tag-suggestions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | search 60/min; 20 per page, cursor only, no total count, 200 profiles viewed per day (SR-37); no bulk export for any role |
| Members       | `GET /ustaad/members/{handle}`, `GET /ustaad/members/{handle}/posts\|answers`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 120/min                                                                                                                   |
| Location      | `PUT /ustaad/me/location` (point, accuracy, source, landmark, three choices), `POST /ustaad/me/location/signboard`, `GET /ustaad/zones?city=` (verified members; banded)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 10/day                                                                                                                    |
| Jobs          | `GET /ustaad/jobs`, `GET /ustaad/jobs/{code}`, `POST /ustaad/jobs` (`ustaad:jobs_post`), `PATCH …/{code}`, `POST …/{code}/pause\|close\|fill`, `POST …/{code}/apply`, `POST /ustaad/applications/{id}/withdraw`, `GET /ustaad/jobs/mine`, `POST /ustaad/applications/{id}/seen\|shortlist\|reject\|hire` (employer of that job)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | jobs 5/day; applications 20/day                                                                                           |
| Learn         | `GET /ustaad/learn`, `PUT /ustaad/learn/{resourceId}/progress`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 120/h                                                                                                                     |
| Correction    | `POST /ustaad/correct` (text ≤ 2,000 chars, lang hint, mode) → `{ text, changes[], engine }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `correction.per_member_per_10min` (30)                                                                                    |
| Reports       | `POST /ustaad/reports`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 20/day                                                                                                                    |
| Share teaser  | `GET /ustaad/s/{token}` (public, generic card only, `noindex`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 60/min/IP                                                                                                                 |
| Promotions    | (served inside feed/search/jobs/learn responses; `POST /ustaad/promotions/{id}/hide` reason code)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                         |
| Admin         | `GET /admin/ustaad/overview`, `GET /admin/ustaad/settings` (`ustaad:settings` or `ustaad:read`), `PATCH /admin/ustaad/settings` (batch of changed keys with versions, `ustaad:settings`; G1) and `PUT …/settings/{key}` (one key), create + edit `/admin/ustaad/levels\|badges\|tags\|words\|reasons\|reach-cities\|tutorial-cards\|coachmarks` (`ustaad:settings`), `POST /admin/ustaad/tags/{id}/merge`, `/admin/ustaad/promotions` + `…/{id}/move` (`ustaad:promotions`), `GET /admin/ustaad/verifications?status=`, `POST …/{id}/approve\|reject\|revoke` (`ustaad:verify`), `GET /admin/ustaad/reports?sort=due`, `POST …/{code}/assign\|keep\|remove\|warn\|restrict\|ban\|restore` (`ustaad:moderate`), `POST /admin/ustaad/takedowns` (`ustaad:takedown`), `GET /admin/ustaad/members/{id}` (masked), `GET …/{id}/location` (`ustaad:location_exact`, audited), `GET /admin/ustaad/zones` (exact), `GET /admin/ustaad/audit` | staff 300/min                                                                                                             |

Errors (stable codes): `USTAAD_NOT_MEMBER` (only on `/ustaad/me` and join; other member routes 404), `USTAAD_BANNED`,
`USTAAD_RESTRICTED`, `USTAAD_REGION` (city not enabled), `USTAAD_CANNOT_ANSWER`, `USTAAD_DAILY_CAP`,
`USTAAD_TAG_LIMIT`, `USTAAD_DM_NOT_ALLOWED`, `USTAAD_EMPLOYER_REQUIRED`, `USTAAD_SCAM_PHRASE`, `MEDIA_TOO_LARGE`,
`MEDIA_TYPE`, `MEDIA_TOO_LONG`, `MEDIA_MISMATCH`, `MEDIA_BUDGET_FULL`, `MEDIA_QUOTA`, `FOUR_EYES`, `SELF_MODERATION`,
`SETTING_RANGE`, `SETTING_RELATION`, `SETTING_INVARIANT`, `NAME_RESERVED`, `USTAAD_PIN_LIMIT`, `USTAAD_ADULT_ATTESTATION`,
`MOVED_TO_USTAAD`. Over-limit responses are 429 with `Retry-After` and rate-limit headers. A posting member never sees why a post was auto-held beyond "Our team will
check it first" (no filter oracle).

Worker jobs (pg-boss, CAS first, `singletonKey`): `ustaad_levels_nightly` (and on-event recompute), `ustaad_counters_30d`,
`ustaad_counter_reconcile`, `ustaad_zone_counts` (nightly), `ustaad_story_expire` (every 5 min), `ustaad_media_purge`
(hourly), `ustaad_removed_archive_purge` (daily), `ustaad_report_clock` (every minute: overdue alerts), `ustaad_jobs_expire`
(hourly), `ustaad_attestation_expire` (hourly), `ustaad_ring_detect` (nightly, § 14), `ustaad_rules_reminder` (daily:
the 3-monthly community-rules notice per member).

## 9. Rules engines

### 9.1 Izzat (ledger, defaults from the admin page)

`answer_posted` +2 · `best_answer` +10 · `helpful_received` +1 · `follower_gained` +1 · `video_completed` +0 (setting) ·
`strike` −50 to −500 (staff, reason code). Unfollow and vote removal write `reversal` rows (no edits). Only answers with
`counts_for_levels` earn; sponsored and MechDost-authored content earns nothing (locked). Izzat is shown on the card
and ranks Discover; it is **not spendable** and never converts to Coins (locked).

### 9.2 Levels (founder's demo rules; defaults from the admin page)

A member reaches a level when **every number in one of its rule groups** is met, checked by the nightly job and on the
triggering event (best answer, follow, video completed, verification approved):

| Level         | Group | Default rule                                                          | Perk (editable text)                   |
| ------------- | ----- | --------------------------------------------------------------------- | -------------------------------------- |
| Chhotu        | —     | Start level for the junior track                                      | Can ask, watch and follow              |
| Naya Ustaad   | A / B | A: 3+ verified years. B: 1 Ustaad recommendation + 10 training videos | Can answer, gets a badge               |
| Pakka Ustaad  | A     | 100+ followers and 25 best answers                                    | Coins multiplier (see below)           |
| Bada Ustaad   | A     | 500+ followers, 100 best answers, 80% helpful                         | Coins multiplier; "featured" text only |
| Master Ustaad | A     | 2,000+ followers, 300 best answers                                    | "Paid trainer" text only               |

- Ustaad levels (Naya and up) also need an **approved verification** (ruling: staff final approval). A Chhotu who
  meets Naya by group B gets a verification request opened for them automatically.
- **Bada and Master need a staff approval row (locked, SR-8):** the engine queues a level review instead of
  promoting; the community manager confirms through the state machine (conditional UPDATE with `version`). No
  setting bypasses it; `needs_staff_review` is editable only for Naya and Pakka (default off).
- **Only "qualified followers" count for levels (SR-9; founder's follower rules kept, followers still count):** a
  follower counts only if they are a **verified** member, their account is ≥ `levels.follower_min_age_days` (30) old,
  and they are **not in a ring** flagged by the nightly check (§ 14) (the coordinator's three conditions). Our
  additions, each behind a setting: followers from the same garage do not count (`levels.follower_exclude_same_garage`,
  default on, from SR-9 and AT-LEVEL-1); banned or departed accounts never count (locked). The calculation is one pure, unit-tested function
  (`qualifiedFollowers()` in `packages/shared/src/ustaad/levels.ts`). The profile still shows the plain follower count
  (ruling: counts visible; rounded above 1,000 as "1.2k"); the level card shows "qualified followers" next to the
  rule so the member understands the number. "Helpful %" = helpful votes ÷ answers with ≥ 1 view by others, over the last 12 months.
  "Recommendation" = a vouch `given` by a Pakka+ Ustaad. "Training videos" = learning resources completed (≥ 80 % of
  duration for hosted videos; self-marked "watched" for external links, capped at `learn.self_mark_daily_cap` (5) a
  day).
- **Perks that would be money are off until their own decisions:** `coin_multiplier_bp` above 10000 is refused with
  422 `COIN_GUARD_REQUIRED` while spec 20's order-reward guard (PENDING #19) is open (the prototype's "1.5× points"
  and "2× points" are this setting). "Featured in workshop booking" (Bada) is customer-facing and is **not built**
  (needs a customer-facing consent; the network is mechanics-only). "Paid trainer" (Master) is **not built** (no paid
  mentorship until counsel). Perk text stays editable.
- Inactivity: after `levels.inactive_pause_days` (90) without activity a grey "not active right now" dot shows and
  perks pause; the level stays.

### 9.3 Badges and specialities

Badge rules are typed (`ustaad_badges.rule.kind`), evaluated by the level job; awards are unique while not revoked.
Seed badges from the admin page (Battery expert, Two-wheeler doctor, Helping hand, Wiring wizard (off)) plus first-time
badges (First post, Pehla sawaal, Pehla jawab, Founding Ustaad). Speciality steps: `shuru` (declared), `pakka`
(`badges.speciality_pakka_best` = 10 best answers in that code), `mahir` (40 best answers from ≥ 20 distinct askers).

### 9.4 Discover ranking (per city, then state)

Score = `discover.w_helpful` (45) × Wilson lower bound of helpful votes over answers seen + `discover.w_best` (25) ×
best-answer rate with a 90-day half-life + `discover.w_breadth` (15) × distinct askers helped (log-scaled) +
`discover.w_trust` (10) × verification and level + `discover.w_new` (5) × new-member boost fading over 30 days;
`discover.new_slots` (2) guaranteed slots per page for members under 30 days. Followers and likes have weight 0 here
(the founder's rule counts followers for **levels**; Discover is "ranked by helpful and best answers, not by
followers", prototype copy). Members with `suggest_me = false` never appear in suggestions (search by name still finds
them).

### 9.5 Feed ranking

Candidates (last `feed.window_days` 14): posts by followed members, posts with followed or matching tags, same city;
promotions inserted at most once every `promo.every_n` (12) items, never two in a row, none on ask/answer screens, none
on a member's first day. Score = weights (admin, sum 100; defaults from the admin page) follows 30 · same city 25 ·
vehicle/tag match 20 · recency 15 (half-life 3 days) · helpfulness 10 (Wilson of likes + saves per viewer). No
trending tab, no autoplay. The ranked list (≤ 300 ids) is computed per request into Redis for 10 minutes and the
cursor is a position in that snapshot, so pages never repeat or skip while scrolling.

### 9.6 Location display, distance and zone counts (security review § 1.3, SR-29–32)

- Others see by default (`loc.default_display` `area_circle`): area name + a ~1 km circle around `circle_center`
  (fixed per-member offset, so the circle is never centred on the garage); alternative `city_only`. Home/roadside
  members: area name only, never a circle or point (locked). Members who hid their location return **no area, no
  distance and no zone membership**.
- **Exact pin only by the member's opt-in** (ruling): "Show my exact pin" (`loc.allow_exact_optin` on network-wide;
  off per member by default) with an audience the member picks: **my accepted connections** (default, SR-32) or all
  verified mechanics; shown with a fixed 50 m display fuzz; never to followers who are not connections unless the
  member picked "all".
- **Distance is server-side only:** computed from stored pins (never from a client-sent point), perturbed by stable
  per-pair noise (seeded HMAC of the two member ids, so repeated queries give the same answer), then returned as a
  **band code** (`lt2`, `2to5`, `5to10`, `10plus`), never a number. No distance filter below 2 km; lists are ordered
  by band, then by Discover score (never by distance within a band).
- **Pin changes:** at most `loc.pin_changes_per_day` (3) per 24 h and `loc.pin_changes_per_30d` (6) per 30 days
  (429 `USTAAD_PIN_LIMIT`); a move over 1 km needs a GPS fix with accuracy ≤ 50 m. GPS readings worse than
  `loc.gps_max_m` (100 m) are not accepted as a pin; the member places it by hand + landmark. `accuracy_m`, `source`
  and a mock-location hint are stored.
- **Zone counts** (nightly; verified, active members who ticked "count me"): `≥ zones.exact_from` (20) → exact number
  (rounded to 5 above 20 when `zones.round_above_exact` on); `zones.hide_below` (5) to exact_from − 1 → "5+" band;
  below → "Few mechanics nearby". The same suppression applies to **every per-speciality cell** (e.g. "EV mechanics
  in this zone") and to complementary cells (a total minus the visible specialities never reveals a suppressed one).
  Invariants (server-side, 422 `SETTING_INVARIANT`): `hide_below ≥ 5`, `hide_below < exact_from`. Members see bands;
  staff with `ustaad:read` see exact counts. No radius counts anywhere. Refresh nightly only.

## 10. Media pipeline (`MediaHost` adapter, `apps/api/src/ustaad/media/`; SR-12–21)

```
interface MediaHost {
  presignPut(bucket, key, { mime, bytes }, ttlSec): Promise<{ url, headers }>;          // single PUT ≤ 16 MB
  createMultipart(bucket, key, mime): Promise<{ uploadId }>;                           // resumable, > 16 MB
  presignPart(bucket, key, uploadId, partNo, bytes, ttlSec): Promise<{ url }>;
  completeMultipart(bucket, key, uploadId, parts): Promise<void>;
  head(bucket, key): Promise<{ bytes, mime } | null>;
  getRange(bucket, key, start, end): Promise<Uint8Array>;
  copy(fromBucket, key, toBucket, toKey): Promise<void>;                               // quarantine → live
  presignGet(bucket, key, ttlSec, { disposition? }): Promise<string>;
  put(bucket, key, bytes, mime): Promise<void>;                                        // server-written image variants
  remove(bucket, key): Promise<void>;
}
```

Implementations: `r2MediaHost` (S3-compatible; SigV4 presigning written in-house over `node:crypto` and checked
against AWS's published test vectors, **no SDK dependency**) and `supabaseMediaHost` (signed upload URLs and TUS resumable uploads; the default until Q-U1). The Supabase adapter clamps every cap to the project's real limits: the per-file upload limit (`SUPABASE_MAX_UPLOAD_MB`, default 50, the free-plan limit; check the project's Storage settings) and the plan's total storage for the budget, so a 150 MB video is refused with `MEDIA_TOO_LARGE` until R2 is on. Three private buckets: **`ustaad-quarantine`** (every upload lands here;
nothing in it is ever readable by a member, SR-12), **`ustaad-media`** (verified images, audio, video) and
**`ustaad-docs`** (PDFs, served from a separate cookieless host, SR-16). Env: `MEDIA_HOST` (`supabase|r2`),
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_QUARANTINE`, `R2_BUCKET_MEDIA`,
`R2_BUCKET_DOCS`, `R2_MEDIA_HOST`, `R2_DOCS_HOST` — all added to `.env.example`. CSP: `connect-src` gains the R2
S3 endpoint (PUT), `img-src` / `media-src` the media host; the docs host is only ever a download link.

1. **Phone first (client).** Images: resize to ≤ 1080 px long side, WebP (quality ~0.75), EXIF dropped by re-drawing
   on a canvas; a blur brush and "blur faces and number plates" (on by default, on-device face detection where the
   browser offers it). Video: record or pick, trim to ≤ `posts.video_max_s`, re-encode on the phone (MediaRecorder /
   WebCodecs where available) to ≈ 480p at ≈ `media.video_kbps` (1000 kbps): 180 s ≈ 20–25 MB. A phone that cannot
   re-encode uploads the original only if it is within the **hard server cap of 150 MB** (`media.video_max_mb`,
   default 150, locked ceiling; SR-15), else "compress and retry" (en + hi). Voice: Opus (WebM/Ogg) or AAC at
   ≈ 24–32 kbps, ≤ `media.voice_max_s` (120 s). Documents: PDF ≤ `media.doc_max_mb` (5). The size is shown before
   upload ("About N MB on mobile data"). Files over 16 MB go up in resumable 8 MB parts (an interrupted upload resumes
   from the last part).
2. **Declare.** `POST /ustaad/media` with kind, mime, bytes, sha256, duration. The server refuses SVG, HTML, archives
   and executables for every kind (SR-17), checks the kind caps, the duration against `min(posts.video_max_s, 180)`
   unless a super admin raised it (§ 15), the member's daily quota (`ustaad_media_usage`, conditional increment) and
   the network budget (step 4), then returns presigned URL(s) valid **10 minutes**, bound to the member, the declared
   kind, size and a random key `q/{memberId}/{uuid}`, signing `Content-Type` and `Content-Length` so the host refuses
   any other size or type (SR-12). A URL used by another member or after expiry is refused (the complete call checks
   the owner).
3. **Verify after upload** (`…/complete`, in the API worker): `HEAD` must match the declared bytes and mime; the first
   64 KB are read and the **magic bytes** must match the kind (WebP `RIFF…WEBP`, JPEG `FFD8FF`, MP4/M4A `ftyp`, WebM
   `1A45DFA3`, Ogg `OggS`, PDF `%PDF-`); container duration is parsed from the MP4 `mvhd` / WebM `Duration` / Ogg last
   granule and must be ≤ the cap (+1 s); MP4 location atoms (`©xyz`, `loci`) and any external reference (HLS
   playlist, `dref` URL, concat) reject the file (`MEDIA_MISMATCH`). **Images** (≤ 3 MB) are downloaded, the pixel
   count checked from the header before decoding (decompression-bomb guard, as spec 13), re-encoded with the existing
   `sharp` pipeline into `img_1080`, `img_480` and a 24 px LQIP with all metadata gone, written to `ustaad-media`; the
   quarantine original is deleted. **Video and audio are not transcoded in v1** (ruling 3; SR-13's server transcode
   and SR-14's ffmpeg sandbox are the documented next step, built before raising any cap or before a server-side
   classifier needs frames): after the byte checks they are copied to `ustaad-media` with a new random key; a poster
   frame captured on the phone is uploaded and verified as an image. **PDFs** are copied to `ustaad-docs` and always
   served as a download (`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
sandbox`) from the separate docs host, never rendered inline on the main site; sanitising and an antivirus scan
   (SR-16, EICAR test) are part of the same next step and, until then, documents from accounts younger than 30 days
   are pre-moderated. A failed check deletes the object and marks the media `rejected` with a reason code.
4. **Child-safety and nudity screening (SR-18, compliance § 13):** an `ImageSafetyClassifier` adapter (NSFW score on
   images and video posters; provider Q-U6, default **none**). Until a classifier and CSAM hash-list access exist,
   **media from new accounts is pre-moderated**: the first `mod.premod_first_posts` (3) media posts and every media
   post of an account younger than `mod.premod_account_days` (30) are `held` until a community manager approves them;
   stories are off for accounts younger than 30 days. When a classifier is configured, a score above
   `mod.nsfw_hold_score` holds the post; a CSAM hash match (once access exists) blocks publishing, moves the file to the
   **evidence vault** (separate bucket, staff `ustaad:takedown` only, never purged by normal jobs), freezes the account
   and opens a POCSO report task (§ 13).
5. **Budget and quotas (SR-20).** `media.network_budget_gb` (10) across all Ustaad media (storage maths: at the client target of ~25 MB per 180 s video, 10 GB holds roughly 400 videos; at the 150 MB hard cap only about 66; the 500 MB member quota is about 20 typical or 3 maximum-size videos); at `media.budget_warn_pct`
   (80 %) staff get `staff.ustaad_media_budget`; at 100 % new **video** declarations fail closed with
   `MEDIA_BUDGET_FULL` ("Videos are paused for a short while; photos and voice still work") until staff raise the
   budget or the purge frees space. Per member: `media.member_quota_mb` (500) total, 3 videos a day. Story media are
   purged `stories.purge_grace_hours` (24) after expiry unless a report or legal hold exists. `media.video_archive_months`
   (0 = keep) optionally purges old video files, keeping the post text and poster. Removed content is archived
   `mod.retention_days` (180), then purged. A `pending_upload` row older than 1 hour is purged with its object.
6. **Reads (SR-21, SR-35).** `GET /ustaad/media/{id}/url` checks membership, that the viewer is not blocked by the
   author, that the content is visible (not removed or held) and that a story has not expired, then returns a signed
   GET valid for `media.url_ttl_min` (**10 minutes**, upper bound locked) whose expiry is rounded to the next 10-minute
   window so the same URL repeats within it and the browser cache works. Keys are random; nothing is guessable.
   A takedown (§ 13) deletes the live object copy, so already-issued URLs stop working within 60 s. Non-members never
   get a media URL.
7. **Shares (SR-44).** "Share on WhatsApp" sends a **teaser link only** (`/ustaad/s/{token}`): the page shows "A post
   on Ustaad Network. Sign in as a mechanic to see it" with a generic image; never the post text, media, names or
   counts; `noindex`, rate limited per IP; signed-in members are redirected to the post.

### 10a. Link previews (SR-22–24)

Link posts show a preview fetched by an **isolated preview worker** (`apps/api/src/ustaad/link-preview/`, a separate
process with no database or storage credentials): http/https only, ports 80/443; the host is resolved and every
address checked against a deny list (private, loopback, link-local incl. `169.254.169.254`, CGNAT, ULA, multicast,
IPv4-mapped IPv6, decimal/hex IP forms); the connection is made to the checked IP (no second lookup, so no DNS
rebinding); at most 3 redirects, each re-checked; 3 s total timeout; 512 KB body; `text/html` only; no cookies; only
`og:title`, `og:description` and `og:image` are kept (the image goes through the normal image pipeline). The host shown
is the registrable domain parsed with the WHATWG URL parser, IDN in punycode (`https://mechdost.in@evil.com/` shows
`evil.com`). Links leave through a warning page with an HMAC-signed target (no open redirect). Accounts younger than
`mod.links_min_account_days` (7) cannot post links at all (scam control). A Web Risk / Safe Browsing check (SR-24)
needs a key (Q-U6); until then an admin domain deny list in `ustaad_word_lists` (`link_domain`) applies.

## 11. Smart correction (`SmartCorrection` adapter, `apps/api/src/ustaad/correction/`)

Modes (`correction.default_mode`: `suggest` default · `auto` · `off`; `correction.member_can_change` on). Languages
handled (`correction.langs`: hi, en, hinglish, cg). Applies to **typed text only**: post bodies and captions, fix-log
fields, questions, answers, comments, job text. Voice notes are never corrected (no transcripts). Suggest mode shows
"You wrote / Suggestion" with protected words highlighted, **Use suggestion / Keep mine / Edit myself**; auto mode
fixes on send and keeps the original; readers see "Edited · see original". Both texts are stored (`body`,
`body_original`) with `correction` (`none|suggested_used|auto`).

```
interface SmartCorrectionEngine {
  readonly id: 'llm_anthropic' | 'llm_gemini' | 'wordlist';
  correct(input: { text: string; langHint: 'hi'|'en'|'hinglish'|'cg'|null; protected: readonly string[] },
          signal: AbortSignal): Promise<{ text: string }>;
}
```

- **Engines.** LLM via plain `fetch` to the provider's HTTP API (**no SDK dependency**): default Anthropic, a small
  cheap model of the Claude Haiku class; alternative Google Gemini (free tier). Model ids are **not hard-coded**: env
  `SMART_CORRECTION_PROVIDER` (`anthropic|gemini|none`), `SMART_CORRECTION_MODEL`, `ANTHROPIC_API_KEY`,
  `GEMINI_API_KEY` (all in `.env.example`). Fallback `wordlist` engine (common Hinglish/Hindi misspellings →
  corrections table in `ustaad_word_lists` + punctuation/spacing rules) when no key is set, on error, on timeout or
  when the daily LLM budget `correction.llm_daily_calls` (5,000) is used up.
- **Meaning guard (both engines, server-side, after the call):** the result is accepted only if every protected word
  (admin list: part names, brands, models, slang like jugaad, mistri, ustaad), every number and part number (`6301`,
  `12V`, `5Ah`), every unit and every negation (`nahi`, `nhi`, `na`, `mat`, `no`, `not`, `नहीं`, `ना`, `मत`) appears in
  the result as often as in the input (case/spacing-insensitive for protected words); the script stays the same
  (Devanagari share within ±10 points; Hinglish stays Latin); length within ±`correction.max_length_change_pct` (30 %).
  Otherwise the single failing change is dropped (word-list engine) or the whole LLM result is discarded and the
  word-list result is used. Never translate unless asked (not built).
- **No PII sent:** before any call, phone numbers, e-mail addresses, vehicle registration numbers, PIN codes and
  `@handles` are replaced by placeholders (`⟦1⟧`…) and restored afterwards; text containing a placeholder the model
  dropped is rejected by the guard.
- **Prompt-injection safe:** fixed system prompt (in code, versioned `CORRECTION_PROMPT_VERSION`); the user text is
  passed only as data inside a delimited block with the instruction that it is text to correct, never instructions;
  the model must return JSON `{ "text": string }` (validated with Zod: plain text, no markup, no URLs not present in the
  input, length rule); no tools; `max_tokens` ≈ 2 × input; output is always rendered as escaped text.
- **Timeout and cache:** `correction.timeout_ms` (2,000) via `AbortSignal`; Redis cache keyed by
  sha256(engine id, model, prompt version, protected-list version, lang, text) for 7 days; per-member limit
  `correction.per_member_per_10min` (30).
- **DPDP processor note:** the LLM provider is a **data processor** for the "smart correction" purpose; the in-app
  notice and the privacy policy name it; only placeholder-masked text is sent; no member id is sent; confirm the
  provider's retention and no-training terms before turning the key on (Q-U3). Correction text is never used to
  train MechDost models without the `ustaad_ml_training` consent.
- **Analytics:** `ustaad_correction_shown {engine, mode, changes}`, `ustaad_correction_choice {choice}`; never the text.

## 12. Notifications (spec 10; bell + push via `queueNotice` in the transaction; texts in `notify.ustaad_*` en + hi; placeholders are names, codes and counts only)

| Kind                                                                                                              | To                             | Channel                                               | Resolved when              |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------- | -------------------------- |
| `ustaad.question_waiting`                                                                                         | matching Ustaads (≤ N)         | bell/push; WhatsApp UTILITY if opted in               | question solved/closed     |
| `ustaad.answer_received`                                                                                          | asker                          | bell/push; WhatsApp UTILITY                           | asker opens the thread     |
| `ustaad.best_answer`                                                                                              | answerer                       | bell/push                                             | —                          |
| `ustaad.reply`                                                                                                    | post/answer author             | bell (grouped per post)                               | opened                     |
| `ustaad.likes_digest`                                                                                             | author                         | bell, once a day ("12 people liked …")                | —                          |
| `ustaad.follow` (grouped daily)                                                                                   | followee                       | bell                                                  | —                          |
| `ustaad.connect_request` / `_accepted`                                                                            | member                         | bell/push                                             | accepted/ignored           |
| `ustaad.message_request` / `ustaad.message`                                                                       | member                         | bell/push (message text never in the push)            | thread opened              |
| `ustaad.vouch_requested`                                                                                          | voucher                        | bell/push; WhatsApp UTILITY                           | given/declined/expired     |
| `ustaad.attestation_requested`                                                                                    | workshop owner                 | bell/push; WhatsApp UTILITY (non-partner owner: link) | confirmed/declined/expired |
| `ustaad.verification_decided`                                                                                     | member                         | bell/push; WhatsApp UTILITY                           | —                          |
| `ustaad.level_up` / `ustaad.badge_earned`                                                                         | member                         | bell/push (celebration sheet in app)                  | —                          |
| `ustaad.mentor_request` / `_accepted`                                                                             | member                         | bell/push                                             | decided                    |
| `ustaad.job_application`                                                                                          | employer                       | bell/push                                             | seen                       |
| `ustaad.application_status`                                                                                       | applicant                      | bell/push; WhatsApp UTILITY                           | —                          |
| `ustaad.report_outcome`                                                                                           | reporter                       | bell                                                  | —                          |
| `ustaad.content_removed` / `ustaad.strike` / `ustaad.rules_reminder`                                              | author/member                  | bell + email (reason in Hindi/English, appeal route)  | —                          |
| `ustaad.invite` (old mechanic applications, § 4a)                                                                 | applicant with an account      | bell; WhatsApp/SMS when templates are live            | joined                     |
| `ustaad.security_freeze` (SR-2)                                                                                   | member (old channels too)      | bell/push + email                                     | —                          |
| `staff.ustaad_report` / `staff.ustaad_report_overdue` / `staff.ustaad_media_budget` / `staff.ustaad_verification` | community managers in the city | bell/push                                             | decided                    |

WhatsApp templates (UTILITY, en + hi) are catalogued but stay off until Meta approves them and staff switch them on
(spec 10 approval gate). Offers on WhatsApp only with the `ustaad_offers` consent, MARKETING category, at most
`promo.whatsapp_per_week` (2). No streak timers, no guilt copy. Weekly digest instead of many pings for low-priority
kinds (`notify.ustaad_digest` on).

## 13. Moderation and legal duties (research, not legal advice; every clock to be confirmed by counsel)

- **Intermediary duties (IT Rules 2021 as amended, incl. the Feb 2026 amendment per research):** Community Rules,
  Terms and Privacy Notice in English and Hindi with the prohibited-content list; a plain reminder every 3 months
  (`ustaad.rules_reminder`, event logged); a named **Grievance Officer** with published contact (Q-U4; default
  meanwhile: the support number and `grievance@` mailbox of Shourya Integrated Services, staff on call), ticket flow
  with acknowledgement ≤ 24 h and resolution ≤ 7 days, appeal route and the GAC (gac.gov.in) line in rejection
  messages.
- **Clocks** (report `clock`, settings so counsel can change them; security review L2–L4, SR-39): nudity, sexual
  content, impersonation or morphed imagery on the person's complaint **2 h** (auto-hidden on the complaint pending
  review, reason `ncii_impersonation`); court order or authorised government intimation **3 h**; removal grievances
  under Rule 3(1)(b) **36 h**; other grievances resolved in **7 days** (acknowledged in 24 h); ordinary member reports
  **24 h** (our internal target). Queue sorted by `due_at`; `staff.ustaad_report_overdue` at 50 % and 100 % of the
  clock. **Takedown service:** one action (`ustaad:takedown`) disables the item across feed, profile, search, tag
  pages, share teasers and signed media URLs **within 60 s** (live object copy deleted, caches tagged and purged)
  while the content and its records stay in the removed-content archive for 180 days. Grievances use support tickets `REQ-…` with
  category `ustaad_grievance` and the same timers. 24×7 on-call rota and the agency-request runbook (72 h) are ops
  tasks (runbook `docs/runbooks/ustaad.md`).
- **Child safety and POCSO (security review T14, L15, SR-18):** prohibited content includes any sexual material
  involving children; a CSAM hash match or a credible report blocks publishing, moves the file to the evidence vault,
  freezes the account and opens a report task to the police / SJPU / cybercrime.gov.in (POCSO s.19/s.20, POCSO Rules
  2020 Rule 11) handled by the Grievance Officer; moderators see blurred previews by default (moderator protection).
  Until classifier and hash-list access exist (Q-U6) new accounts' media are pre-moderated (§ 10 step 4).
- **CERT-In and DPDP incidents (L9, L12, SR-45):** ICT logs (API, auth, moderation, media access) kept 180 days on the
  India-hosted server, clocks synced to NTP; incident runbook with a **6 h** CERT-In report and a **72 h** DPDP
  report (en + hi templates for affected people), rehearsed in a tabletop drill before launch.
- **Processors (L13):** a processor register (media host, LLM provider, Firebase, PostHog, Sentry) with contracts,
  regions and no-training terms; the LLM providers are not India-region (SR-28 residual risk, accepted by the
  provider ruling; masking applies; counsel item).
- **Removal = archive, not delete:** removed content and its media move to `ustaad_removed_archive` for
  `mod.retention_days` (180) and are then purged unless on legal hold; reconciled with DPDP erasure (the author's
  personal fields are erased on account deletion, the archive keeps only what the legal duty needs).
- **Content types kept apart:** `ugc`, `mechdost_authored`, `sponsored` (MechDost promotions are first-party speech,
  never treated as UGC). Ranking is rules-based and documented (§ 9.4–9.5).
- **AI-generated media:** "Made or edited with AI" switch at upload → visible label on the post; prohibited synthetic
  content (fake documents, falsely depicting a person) is removed.
- **Report reasons (fixed codes, admin labels en + hi):** wrong or unsafe advice · illegal modification (silencer,
  odometer, emission, DPF/cat delete, plate tampering, non-approved kits) · abuse or bad language · spam or selling ·
  shows a customer face, plate or phone number · someone under 18 · not about work · fake or misleading · job scam ·
  copyright (IP, Rule 75 workflow: restrict pending 21 days) · other (always on).
- **Automatic first pass and scam controls (SR-36, top-15 #9):** banned words and scam phrases hold content for
  review (`held`); phone-number and plate patterns in text are blocked before posting ("Hide the customer's number
  first"); fee phrases ("registration fee", "security deposit", "training fee"…), UPI ids (`name@bank`), "share the
  OTP" patterns and phone numbers in job posts, comments and messages hold the item for review and flag the author;
  no links at all from accounts younger than 7 days; job posts with fee phrases are blocked (`USTAAD_SCAM_PHRASE`).
  "MechDost never asks for money for a job; report anyone who does (1930, cybercrime.gov.in)" on every job screen. Composer warnings on modification-tagged and safety-tagged
  content; EV/high-voltage note; disclaimer on every answer.
- **Actions:** keep, hold, remove, restore, warn, restrict (no posting `mod.restrict_days`), ban 7 days / custom /
  permanent, strike (Izzat delta), level review. Every action reason-coded, append-only, audited; the author is told
  why in their language with the appeal route (support ticket `REQ-…`, decided by a different staff member).
- **DPDP consents per purpose** (new purposes added to the `consents` CHECK **and** `PRIVACY_PURPOSES`; notice versions
  kept; withdrawal one tap in "Settings and my choices"; withdrawal stops the processing job):
  `ustaad_profile` (required to join), `ustaad_directory`, `ustaad_training`, `ustaad_offers`, `ustaad_location_verify`,
  `ustaad_zone_count`, `ustaad_exact_pin`, `ustaad_voice` (store and play my voice notes; asked the first time a member
  records), `ustaad_correction` (send my typed text, masked, to the smart-correction processor; asked when the LLM
  engine is on, otherwise the word list runs on our server), `ustaad_ml_training` (optional, never a condition). Verification evidence
  (signboard photo, attestation contact) is deleted `verify.evidence_retention_days` (30) after the decision unless a
  dispute is open; only the outcome, method and dates stay. **Never Aadhaar** (locked).
- **Mechanics-only (locked):** non-members get 404; WhatsApp shares are teaser links (§ 10 step 7) that open
  sign-in / `/ustaad/join` with a generic card (no author, text or media); `noindex` on every `/ustaad` page and
  excluded from the sitemap.
- **Sponsored label locked (L17–L18, SR-41):** every promotion shows **"Sponsored" / "प्रायोजित"** in its first line;
  the label text is **not editable** (the admin page's editable label and the prototype's "MechDost offer" are
  dropped); spacing at least 1 per `promo.every_n` (≥ 8) items.
- **No age check (ruling) and its cost:** no age gate, no DOB, no age column. Compensating controls (security review
  § 0, top-15 #10): a "Someone under 18" report puts the reported account in **restricted mode** (no analytics events, no
  recommendations or Discover suggestions, no promotions, no jobs, no messages; their posts stay as they are) until a
  community manager reviews it within the standard clock (`mod.minor_report_restricts` on). **False-report guard:** the
  restriction starts at once only when the reporter is a verified member with an account ≥ 30 days old and no upheld
  `false_report` strike; any other minor report goes to the top of the queue without restricting anyone, and a member
  whose minor reports are repeatedly dismissed gets a `false_report` strike; no photos or
  videos of minors working (moderation rule + upload reminder); employer attestation "I hire only people aged 18 or
  older" required on every job post (422 `USTAAD_ADULT_ATTESTATION`, locked); a content rule against glorifying or
  soliciting child labour; stories off for accounts younger than 30 days; pseudonymous analytics only. Whether the
  Terms may carry an adult self-declaration line, and what "actual knowledge" of a minor triggers under DPDP s.9, are
  counsel items (Q-UC1, Q-UC7). Legal cost recorded in decisions 2026-11-26.
- **Registered-user counter** with an alert at 4 million (SSMI threshold 5 million) on the admin overview.

## 14. Abuse and anti-gaming (detection, not new gates)

Founder rules count followers, so the defence is **detection + reversible counting**, surfaced to the community
manager: nightly `ustaad_ring_detect` flags (a) reciprocal follow bursts (A↔B within 24 h for > 30 % of a member's
new followers), (b) follower clusters with shared device or IP signals (spec 13 velocity data), (c) best answers
exchanged within the same garage or between connections made in the last 7 days, (d) vote reciprocity > 30 % between
two members, (e) a jump of ≥ 2 levels in 30 days. Flags open a review card; confirmed abuse writes `reversal` Izzat
rows, marks follows as `not_counted` (a flag column on `ustaad_follows`), and may trigger a level review (four-eyes).
Plus: daily caps (§ 8), new accounts' likes and votes count after 7 days, an asker can mark best at most
`qa.best_per_week` (5) times a week, staff can unmark, money perks re-checked at use time, one account per phone
(existing). Metrics: mutual-follow share, top-10 % poster share, report rate per 1,000 posts.

## 14a. Security requirements (security review 2026-11-26, ids kept; workstreams of the plan)

Source: the design-stage security, safety and compliance review (35 threats, 19 design flaws, 27 compliance rows,
46 requirements; copied to `docs/research/ustaad-security-review.md`). Each requirement is **adopted**, **adapted** (changed to
respect a ruling, reason given) or **later** (a documented next step with its v1 stand-in). Its acceptance tests
(AT-*) are listed in § 20 and in the owning workstream of the plan.

| SR    | Requirement (short)                                                                                            | Status / resolution                                                                                                                                                                                                | WS   |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| SR-1  | Authenticated, phone-verified user, `verifyIdToken(checkRevoked)`                                              | **Adapted:** required on every route; an unverified member is **not** limited to their own profile (ruling: open to all, verification never a wall); new-account limits instead (SR-3, SR-33, § 10 pre-moderation) | A    |
| SR-2  | Credential change / new device on Pakka+ → re-OTP, notify old channels, freeze perks and job posting 72 h      | Adopted (`security.high_level_freeze_hours`), plus "sign out everywhere"                                                                                                                                           | B    |
| SR-3  | Turnstile at Ustaad sign-up and on the first post, first message and first job                                 | Adopted                                                                                                                                                                                                            | A    |
| SR-4  | Reserved names: NFKC fold + TR39 confusable skeleton vs a reserved list → 422 `NAME_RESERVED`                  | Adopted (`ustaad_reserved_names`)                                                                                                                                                                                  | B    |
| SR-5  | Official/staff badge only from a server-side flag; strict Zod rejects unknown fields                           | Adopted                                                                                                                                                                                                            | B    |
| SR-6  | Attestation only from a verified workshop partner, or GSTIN/Udyam + shop photo ≤ 200 m; ≤ 10 per owner/quarter | Adopted (§ 4 flow 2)                                                                                                                                                                                               | B    |
| SR-7  | Vouch: Pakka+, ≥ 60 days, not reciprocal, ≤ 3/month; vouchers from ≥ 2 garages                                 | Adopted                                                                                                                                                                                                            | B    |
| SR-8  | Staff approval row for verification and every Bada/Master promotion; no setting bypasses it                    | Adopted, **locked on** (founder ruling)                                                                                                                                                                            | B    |
| SR-9  | Only qualified followers count for levels                                                                      | Adopted: verified, account ≥ 30 days, active, other garage, not in a detected ring; followers still count (ruling)                                                                                                 | B    |
| SR-10 | Nightly ring job (> 30 % reciprocity, dense subgraphs); flagged votes weigh 0 until reviewed                   | Adopted (§ 14)                                                                                                                                                                                                     | B    |
| SR-11 | Perks and Coin multipliers checked at use time                                                                 | Adopted (the multiplier stays off until PENDING #19)                                                                                                                                                               | B    |
| SR-12 | Signed upload URL bound to user, kind, size, 10 min, into a quarantine bucket                                  | Adopted (§ 10)                                                                                                                                                                                                     | A    |
| SR-13 | Magic bytes; images re-encoded; audio → Opus and video → H.264 with metadata stripped                          | **Adapted:** images re-encoded on the server; **no server transcoding in v1** (provider ruling); byte, duration and metadata-atom checks instead; transcoding is the next step                                     | A    |
| SR-14 | ffmpeg in a no-network sandbox                                                                                 | **Later** (comes with transcoding); v1 runs no ffmpeg                                                                                                                                                              | A    |
| SR-15 | Probe duration first; client compresses; resumable upload; hard cap 150 MB                                     | Adopted (180 s default, 150 MB cap, 8 MB resumable parts)                                                                                                                                                          | A    |
| SR-16 | PDF only, scanned, sanitised, attachment from a separate cookieless origin with `CSP: sandbox`                 | **Adapted:** separate docs bucket and host, attachment, nosniff, sandbox now; sanitiser + antivirus **later**; until then new accounts' PDFs are pre-moderated                                                     | A    |
| SR-17 | SVG, HTML, archives, executables refused                                                                       | Adopted                                                                                                                                                                                                            | A    |
| SR-18 | CSAM hash match + NSFW score before publishing; evidence vault; POCSO task; freeze                             | **Adapted:** classifier adapter (Q-U6) + **pre-moderation of new accounts until hash-list access**; vault and POCSO task built now                                                                                 | F    |
| SR-19 | Server auto-blur of faces/plates and OCR phone blocking                                                        | **Later** (with the media worker); v1: on-device blur tool on by default, phone/plate patterns in text blocked, report reason `privacy`                                                                            | A    |
| SR-20 | Per-user upload quota and site-wide budget; fail closed with a friendly message                                | Adopted (`media.*`)                                                                                                                                                                                                | A    |
| SR-21 | Signed read URLs ≤ 10 min after authorisation (member, not blocked, not removed, story not expired)            | Adopted                                                                                                                                                                                                            | A    |
| SR-22 | Isolated link-preview worker with SSRF protections                                                             | Adopted (§ 10a)                                                                                                                                                                                                    | D    |
| SR-23 | Registrable-domain display, punycode, signed warning-page redirect                                             | Adopted                                                                                                                                                                                                            | D    |
| SR-24 | Web Risk / Safe Browsing at post time and daily                                                                | **Later** (needs a key, Q-U6); v1 admin domain deny list                                                                                                                                                           | D    |
| SR-25 | Hashtag pattern after NFC; blocked-tag list; max per post                                                      | Adopted (max 5, curated tags only)                                                                                                                                                                                 | D    |
| SR-26 | No `dangerouslySetInnerHTML` for UGC; CSP nonces                                                               | Adopted (lint rule in the Ustaad folders)                                                                                                                                                                          | A    |
| SR-27 | Smart correction never changes a digit, unit, part code or protected term; original kept; "edited" mark        | Adopted (§ 11 meaning guard)                                                                                                                                                                                       | F    |
| SR-28 | Text to a processor: redacted, contracted, India region, logged without content                                | **Adapted:** redaction and content-free logs adopted; India region not offered by the ruled LLM providers (residual risk, counsel Q-UC6); no speech-to-text at all                                                 | F    |
| SR-29 | Server-side distance bands after stable noise; never a number                                                  | Adopted (§ 9.6)                                                                                                                                                                                                    | E    |
| SR-30 | Pin changes 3/24 h and 6/30 days; > 1 km move needs a ≤ 50 m fix; no filter under 2 km; no order within a band | Adopted                                                                                                                                                                                                            | E    |
| SR-31 | k ≥ 5 incl. speciality and complementary cells; rounding; nightly                                              | Adopted (exact from 20, band 5–19, hidden under 5)                                                                                                                                                                 | E    |
| SR-32 | Exact pin only to accepted connections of an opted-in member, 50 m fuzz; hidden = nothing                      | **Adapted:** opt-in per ruling; default audience connections; the member may pick "all verified mechanics"                                                                                                         | E    |
| SR-33 | Request-only messages for everyone; no links/media before acceptance; < 7 days cannot start; ≤ 20/day          | Adopted (`dm.default_mode`, no gender field)                                                                                                                                                                       | D    |
| SR-34 | Phone number never in an Ustaad API response                                                                   | Adopted                                                                                                                                                                                                            | D    |
| SR-35 | Block → 404 on profile, posts, media, messages                                                                 | Adopted                                                                                                                                                                                                            | D    |
| SR-36 | Jobs: verified employer, no-minors attestation, structured fields; phone/UPI/fee phrase → held                 | Adopted                                                                                                                                                                                                            | E    |
| SR-37 | Discover/search 20 per page, cursor only, no total, 200 profiles/day; no bulk export                           | Adopted                                                                                                                                                                                                            | D    |
| SR-38 | `community_manager` city scoped, 2FA, no PII, no exports, message content only via a report, audited           | Adopted (§ 3)                                                                                                                                                                                                      | A, G |
| SR-39 | Takedown in one action across all surfaces within 60 s; evidence 180 days; SLA timers by reason                | Adopted (§ 13)                                                                                                                                                                                                     | F    |
| SR-40 | Admin invariants server-side, 422 `SETTING_INVARIANT`, audited                                                 | Adopted; video above 180 s only by a super admin with a reason (founder wants it configurable)                                                                                                                     | G    |
| SR-41 | Promotions only from the promotions service, never UGC, label in the first line                                | Adopted, label locked                                                                                                                                                                                              | D    |
| SR-42 | Every action emits a typed pseudonymous event; a minor report turns analytics and recommendations off          | Adopted (§ 13 restricted mode)                                                                                                                                                                                     | A    |
| SR-43 | Rate limits per user and IP with 429 headers                                                                   | Adopted (§ 8 defaults)                                                                                                                                                                                             | A    |
| SR-44 | WhatsApp share pages: generic teaser, rate limited, `noindex`                                                  | Adopted (§ 10 step 7)                                                                                                                                                                                              | D    |
| SR-45 | ICT logs 180 days in India; CERT-In 6 h and DPDP 72 h runbooks with a tabletop drill                           | Adopted                                                                                                                                                                                                            | F    |
| SR-46 | Chhattisgarh only: garage pin inside enabled cities (`ST_Within` on city polygons) → 422 `USTAAD_REGION`       | Adopted; a city without a polygon falls back to its PIN codes (spec 15)                                                                                                                                            | A    |

**Top 15 from the review, all applied:** (1) child-safety pipeline (SR-18, § 13); (2) takedown and grievance clocks
(SR-39); (3) location bands, noise, pin limits, k ≥ 5 (SR-29–32); (4) upload pipeline with quarantine, caps and the
separate docs origin (SR-12–17, SR-20; ffmpeg sandbox later); (5) SSRF-safe previews (SR-22–23); (6) staff final
approval locked + qualified followers + ring detection (SR-8–10); (7) request-only messages and hidden phone for
everyone (SR-33–34); (8) `community_manager` limits (SR-38); (9) scam controls (SR-36, § 13); (10) restricted mode on
a minor report + no-minors job attestation (§ 13); (11) locked Sponsored label and promotion floor (SR-40–41); (12)
media authorisation, random keys, story expiry, RLS on every new table (SR-21, SR-35); (13) account-takeover
hardening for high levels (SR-2); (14) admin invariants (SR-40); (15) privacy-by-default media (EXIF strip, blur tool,
phone-pattern block, teaser shares, consents per purpose).

## 15. Reach, multi-city and admin control

Reach = enabled cities in `ustaad_reach_cities` (defaults: Raipur, Bilaspur, Durg-Bhilai, Korba, Rajnandgaon,
Jagdalpur, Ambikapur) or `general.all_state` (all Chhattisgarh districts, now and later; uses `states`/`cities` of
spec 15). A member's city comes from their area/PIN; joining from an unenabled city returns `USTAAD_REGION` with
"Ustaad Network is opening in your city soon". Q&A widening goes city → all enabled cities. Nothing assumes one city.

### Admin settings (every key; defaults from `ustaad-admin.html`, the newer admin page, unless marked)

| Key                                                                                                                   | Default                                                                                              | Range / note                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `general.enabled`                                                                                                     | on                                                                                                   | off hides the network for every member; content kept                                                                                                        |
| `general.mechanics_only`                                                                                              | on (locked)                                                                                          | cannot be turned off                                                                                                                                        |
| `general.all_state`                                                                                                   | off                                                                                                  | on = every Chhattisgarh district                                                                                                                            |
| `general.join_mode`                                                                                                   | `all`                                                                                                | `all` (starts as Chhotu) · `verified_only` · `invite_only`                                                                                                  |
| `general.default_lang`                                                                                                | `hi`                                                                                                 | `hi` · `en`                                                                                                                                                 |
| `levels.*` (table)                                                                                                    | § 9.2                                                                                                | 0 = rule not used                                                                                                                                           |
| `levels.follower_min_age_days`                                                                                        | 30 (SR-9)                                                                                            | 7–180 (qualified followers are also verified and not in a ring)                                                                                             |
| `levels.follower_exclude_same_garage`                                                                                 | on (ours, SR-9)                                                                                      |                                                                                                                                                             |
| `levels.inactive_pause_days`                                                                                          | 90 (study)                                                                                           | 30–365                                                                                                                                                      |
| `izzat.answer_posted` / `best_answer` / `helpful_received` / `follower_gained` / `video_completed`                    | 2 / 10 / 1 / 1 / 0                                                                                   | 0–100 each                                                                                                                                                  |
| `verify.owner_enabled` / `vouch_enabled` / `certificate_enabled`                                                      | on / on / **off**                                                                                    | certificate off until PENDING #28                                                                                                                           |
| staff final approval (verification, Bada, Master)                                                                     | **locked on** (ruling, SR-8)                                                                         | not a setting; shown read-only in admin                                                                                                                     |
| `verify.vouches_needed`                                                                                               | 2 (prototype copy)                                                                                   | 1–5                                                                                                                                                         |
| `verify.vouch_min_level`                                                                                              | `pakka`                                                                                              | level code                                                                                                                                                  |
| `verify.evidence_retention_days`                                                                                      | 30 (research)                                                                                        | 7–180                                                                                                                                                       |
| `posts.video_max_s`                                                                                                   | **180** (ruling)                                                                                     | 15–180; **raising it above 180 (to 300) needs a super admin and a reason code, audited** (`ustaad:settings` is super admin only; a community manager reads) |
| `posts.max_photos`                                                                                                    | 6                                                                                                    | 1–10                                                                                                                                                        |
| `posts.per_day`                                                                                                       | 20                                                                                                   | 1–100 (answers not counted)                                                                                                                                 |
| `posts.types.*`                                                                                                       | all on (voice, photo, video, text, document, poll, question, stories, mixed, link)                   | off hides it in the composer                                                                                                                                |
| `stories.hours`                                                                                                       | 24                                                                                                   | 1–72                                                                                                                                                        |
| `stories.purge_grace_hours`                                                                                           | 24 (ours)                                                                                            | 0–168                                                                                                                                                       |
| `media.data_saver_default`                                                                                            | on                                                                                                   |                                                                                                                                                             |
| `media.video_kbps` / `video_max_mb` / `voice_max_s` / `doc_max_mb` / `image_max_mb`                                   | 1000 / 150 (hard cap) / 120 / 5 / 3 (coordinator, SR-15)                                             | video_max_mb ≤ 150 locked ceiling                                                                                                                           |
| `media.member_quota_mb`                                                                                               | 500 (ours)                                                                                           | 50–5000                                                                                                                                                     |
| `media.network_budget_gb` / `budget_warn_pct`                                                                         | 10 / 80 (coordinator: R2 free tier)                                                                  | 1–1000 / 50–95                                                                                                                                              |
| `media.video_archive_months`                                                                                          | 0 (keep)                                                                                             | 0–60                                                                                                                                                        |
| `media.url_ttl_min`                                                                                                   | 10 (SR-21)                                                                                           | 2–10                                                                                                                                                        |
| `correction.default_mode`                                                                                             | `suggest`                                                                                            | `suggest` · `auto` · `off`; `auto` needs a non-empty protected-word list (SR-40)                                                                            |
| `correction.member_can_change`                                                                                        | on                                                                                                   |                                                                                                                                                             |
| `correction.langs.*`                                                                                                  | hi, en, hinglish, cg on                                                                              |                                                                                                                                                             |
| `correction.timeout_ms` / `llm_daily_calls` / `per_member_per_10min` / `max_length_change_pct`                        | 2000 / 5000 / 30 / 30 (coordinator, ours)                                                            | bounded                                                                                                                                                     |
| protected words (table)                                                                                               | Splendor, Activa, self-start, clutch plate, Exide, Pulsar, carburettor, jugaad, mistri, ustaad       | admin list                                                                                                                                                  |
| `loc.default_display`                                                                                                 | `area_circle`                                                                                        | `area_circle` · `city_only`                                                                                                                                 |
| `loc.allow_exact_optin`                                                                                               | on                                                                                                   | off = nobody can share an exact pin                                                                                                                         |
| `loc.gps_max_m`                                                                                                       | 100                                                                                                  | 20–500                                                                                                                                                      |
| `zones.exact_from` / `hide_below` / `round_above_exact`                                                               | 20 / 5 / on                                                                                          | hide_below ≥ 5 and < exact_from (SR-31, SR-40)                                                                                                              |
| `loc.pin_changes_per_day` / `pin_changes_per_30d` / `exact_audience_default`                                          | 3 / 6 / `connections`                                                                                | SR-30, SR-32                                                                                                                                                |
| `zones.cell_edge_m`                                                                                                   | 1400 (ours)                                                                                          | 500–5000, global                                                                                                                                            |
| `zones.verified_only`                                                                                                 | on (research)                                                                                        |                                                                                                                                                             |
| `feed.show_like_counts` / `show_follower_counts`                                                                      | on / on (ruling)                                                                                     |                                                                                                                                                             |
| `feed.w_follows` / `w_city` / `w_tag` / `w_recency` / `w_helpful`                                                     | 30 / 25 / 20 / 15 / 10                                                                               | sum = 100                                                                                                                                                   |
| `feed.window_days`                                                                                                    | 14                                                                                                   | 3–60                                                                                                                                                        |
| hashtags (table)                                                                                                      | seed: #battery, #selfstart, #clutchplate, #mileage, #selfstartproblem (+ Hindi names, aliases)       | max 5 per post, ≥ 1 curated (`tags.max_per_post`)                                                                                                           |
| `discover.w_*` / `new_slots`                                                                                          | § 9.4                                                                                                | sum = 100                                                                                                                                                   |
| `promo.enabled` / `every_n`                                                                                           | on / 12                                                                                              | 8–50 (SR-40)                                                                                                                                                |
| promotion label                                                                                                       | **"Sponsored" / "प्रायोजित", locked** (ruling, ASCI, SR-41)                                          | not editable                                                                                                                                                |
| `promo.place.feed` / `stories` / `search` / `jobs` / `learn`                                                          | on / off / off / on / on                                                                             |                                                                                                                                                             |
| `promo.daily_cap_per_member` / `whatsapp_per_week`                                                                    | 3 / 2 (study)                                                                                        |                                                                                                                                                             |
| banned words, report reasons (tables)                                                                                 | seed from the admin page                                                                             | `other` always on                                                                                                                                           |
| `mod.retention_days` / `restrict_days` / `four_eyes_from_ban_days`                                                    | 180 / 3 / 7 (research, ours)                                                                         |                                                                                                                                                             |
| `mod.clock_intimate_h` / `clock_legal_h` / `clock_standard_h` / `clock_grievance_days`                                | 2 / 3 / 24 / 7                                                                                       | counsel to confirm                                                                                                                                          |
| `jobs.enabled` / `employer_verification` / `never_charge_candidates`                                                  | on / on / on (locked)                                                                                |                                                                                                                                                             |
| `jobs.require_adult_attestation`                                                                                      | on (ours)                                                                                            |                                                                                                                                                             |
| scam phrases (table)                                                                                                  | registration fee, pay to join, deposit required, advance for uniform, security deposit, training fee |                                                                                                                                                             |
| `jobs.expiry_days`                                                                                                    | 30                                                                                                   | 7–90                                                                                                                                                        |
| `qa.voice_max_s` / `notify_ustaads` / `widen_after_h` / `auto_close_days` / `best_per_week` / `apprentice_can_answer` | 120 / 10 / 24 / 60 / 5 / off                                                                         | bounded                                                                                                                                                     |
| `learn.self_mark_daily_cap`                                                                                           | 5                                                                                                    | 0–50                                                                                                                                                        |
| `limits.*`                                                                                                            | § 8 table                                                                                            | bounded                                                                                                                                                     |
| `limits.dm_min_account_days`                                                                                          | 7 (research)                                                                                         | 0–60                                                                                                                                                        |
| `dm.default_mode`                                                                                                     | `request` (Q-U5 default, SR-33)                                                                      | `everyone` · `request` · `nobody`                                                                                                                           |
| `mod.premod_first_posts` / `premod_account_days` / `nsfw_hold_score`                                                  | 3 / 30 / 0.7                                                                                         | until classifier + hash list (Q-U6)                                                                                                                         |
| `mod.links_min_account_days` / `minor_report_restricts`                                                               | 7 / on (locked on)                                                                                   | § 13                                                                                                                                                        |
| `security.high_level_freeze_hours`                                                                                    | 72 (SR-2)                                                                                            | 24–168                                                                                                                                                      |
| `stories.min_account_days`                                                                                            | 30 (security review § 0)                                                                             | 0–90                                                                                                                                                        |
| `verify.attest_per_owner_quarter` / `attest_photo_max_m`                                                              | 10 / 200 (SR-6)                                                                                      | 1–50 / 50–1000                                                                                                                                              |
| `verify.vouch_min_account_days` / `vouch_per_month`                                                                   | 60 / 3 (SR-7)                                                                                        | 30–365 / 1–10                                                                                                                                               |
| distance band edges                                                                                                   | 2 / 5 / 10 km (SR-29), **locked**                                                                    | changing them would let differencing reveal positions                                                                                                       |
| `loc.exact_fuzz_m` / `big_move_km` / `big_move_accuracy_m`                                                            | 50 / 1 / 50 (SR-30, SR-32)                                                                           | 20–200 / 0.5–5 / 10–100                                                                                                                                     |
| `discover.profiles_per_day` / `limits.new_threads_per_day`                                                            | 200 / 20 (SR-37, SR-33)                                                                              | 50–1000 / 5–50                                                                                                                                              |
| tutorial cards, coach-marks (tables)                                                                                  | 6 cards + 6 coach-marks (§ 4 flow 15), en + hi                                                       | admin-editable copy, pictures and narration                                                                                                                 |

**Built (G1, 2026-11-26):** Admin → Network settings (spec 08 "Ustaad Network settings"). Registry names that
differ from this table: `loc.big_move_m` (metres, 500–5000), `mod.nsfw_hold_score_pct` (0.70 → 70); extra keys
`ustaad.access`, `verify.fast_track_approved_apps`, `media.uploads_per_day`, `media.videos_per_day`,
`limits.follows_per_day`, `limits.joins_per_day`, `notify.digest`, `tags.max_per_post`. `jobs.require_adult_attestation`
is locked on in the registry. Q&A and Learn keys sit in the "Posts & media" section. A save naming a locked item
(staff final approval, the label, the distance bands) answers `SETTING_INVARIANT`; the video reason rule applies only
to the save that changes the video length (decisions 2026-11-26 "Ustaad admin settings").

**Invariants checked server-side on every save (SR-40, 422 `SETTING_INVARIANT`, audited):** staff final approval
cannot be turned off; the Sponsored label cannot change; `zones.hide_below ≥ 5`; `zones.exact_from > zones.hide_below`;
`promo.every_n ≥ 8`; `posts.video_max_s ≤ 180` unless the save carries a reason code (super admin only, audited);
`media.video_max_mb ≤ 150`; `correction.default_mode = auto` needs ≥ 1 active protected word; feed and Discover weights
each sum to 100. The other bounds are proposals for the founder to confirm (decisions 2026-11-26).

The older `src/app-admin.js` defaults (photos 10, posts 3/day, promotion 1 per 10, exact zone count from 10, GPS 50 m)
are superseded by the admin page above. "Decide later" items shown greyed in admin: job card, trade prices, udhaar.

## 16. Analytics events (spec 12; `noun_verb`; ids, codes and counts only, never text, names, phones or locations)

Server (event store, forwarded to PostHog): `ustaad_joined {track, via}`, `ustaad_left`, `ustaad_verification_requested
{proofs}`, `ustaad_verification_decided {outcome, reason}`, `ustaad_vouch_given`, `ustaad_attestation_decided
{outcome}`, `ustaad_level_reached {level}`, `ustaad_badge_earned {badge}`, `ustaad_post_created {kind, template,
media_count, tag_count, correction}`, `ustaad_story_created {kind}`, `ustaad_question_asked {input, segment, work,
correction}`, `ustaad_answer_posted {input}`, `ustaad_answer_helpful`, `ustaad_best_answer_chosen`,
`ustaad_followed`, `ustaad_connected`, `ustaad_mentorship_changed {to}`, `ustaad_message_thread_started`,
`ustaad_job_posted {role}`, `ustaad_job_applied`, `ustaad_application_moved {to}`, `ustaad_report_created {reason,
target}`, `ustaad_moderation_action {action, reason, clock, on_time}`, `ustaad_media_rejected {kind, reason}`,
`ustaad_media_budget_full`, `ustaad_location_confirmed {source, accuracy_band}`, `ustaad_zone_counts_built {zones}`,
`ustaad_application_mapped {outcome}`, `ustaad_takedown_executed {clock, seconds}`, `ustaad_restricted_mode {reason}`,
`admin_ustaad_settings_saved {keys}`, `admin_ustaad_invariant_refused {key}`, `admin_ustaad_access_changed {from, to}`,
`admin_ustaad_table_saved {table, action}` (G1). Client (admin, G1): `admin_ustaad_change {area, action, fields}`.
Client: `ustaad_feed_viewed {tab}`, `ustaad_post_liked`, `ustaad_post_saved`, `ustaad_post_shared {channel}`,
`ustaad_story_viewed`, `ustaad_video_played {seconds_band}`, `ustaad_voice_played`, `ustaad_discover_searched
{results}`, `ustaad_tag_opened`, `ustaad_promo_impression {promo, slot}`, `ustaad_promo_click`, `ustaad_promo_hidden
{reason}`, `ustaad_correction_shown {engine, mode, changes}`, `ustaad_correction_choice {choice}`, `ustaad_data_saver
{on}`, `ustaad_learn_completed {resource}`, `ustaad_join_step {step, via: ustaad|partners_apply}`,
`tutorial_started`, `tutorial_step {card, narration_played}`, `tutorial_completed`, `tutorial_skipped {at_card}`,
`ustaad_coachmark_seen {target}`, `ustaad_coachmark_dismissed {target}`, `ustaad_help_replayed`. Metrics from day one: weeks-active members, answered within 24 h, time to
first answer, best-answer rate, verified share, report rate per 1,000 posts, takedowns on time, bytes per session,
mutual-follow share.

## 17. Performance budgets (spec 16)

- `/ustaad` feed first load JS **< 150 KB gz** (stricter than the 180 KB product page); Server Components for lists;
  the composer, story viewer, video player, recorder, map and admin are dynamically imported.
- Images: `next/image` with the `img_480` / `img_1080` variants and LQIP placeholders, width/height always, `priority`
  only on the first story ring row; WebP from the pipeline.
- Video and audio: native `<video preload="none" poster>` / `<audio preload="none">`, played only on tap (data saver)
  with the size shown; stories prefetch only the next poster; no autoplay anywhere.
- LCP < 2 s, INP < 200 ms, CLS < 0.05 on a mid-range Android over 4G; reserved space for badges and counts (Hindi
  is longer). API p95 < 150 ms for feed/question reads (snapshot cache, indexes in § 6), < 400 ms for writes.
- Works on a 2 GB RAM phone in Chrome; installable (existing PWA); offline drafts in IndexedDB (try/catch).

## 18. i18n (hard rule 10)

Every string in the `ustaad` locale namespace (en + hi), including errors, notices, emails, admin, empty states and the
Sponsored label. Content data carries Hindi: level names and perks, badge names and rules, tag names (+ aliases),
report reasons, speciality names, promotions, learning titles, job role names, area labels. Allowed Latin on `/hi`:
brands, models, units, codes (UQ-…, UJ-…), handles and **user-written text** (posts, answers, comments, messages,
garage names, job descriptions). `e2e/hindi-coverage.spec.ts` crawls every `/hi/ustaad/*` page with seeded demo data.
Voice notes in any language; nothing is translated automatically.

## 19. ML-ready data (hard rule 16)

Questions carry `segment_code`, `vehicle_model_id`, `work_code`, `safety_tag`; best answers link parts
(`ustaad_answer_parts`); fix logs have symptom / cause / fix fields; every action is an `ustaad_events` row with ids,
codes and UTC times; counts are reconstructible from source rows; reasons are codes with an optional note. Training
on community content needs the `ustaad_ml_training` consent (optional, unticked) and is excluded for withdrawn
members at the next run. Data dictionary: this § 6.

## 20. Acceptance tests (mandatory; owned by `website-testing`)

- **Shared (Vitest):** every machine in § 7 (legal and illegal moves, actor rules); level engine incl. OR groups, staff
  review, no inactivity drop, follower min age; Izzat rules and reversals; zone cell function (stable ids, neighbours,
  edge sizes) and banding incl. the relation rule; feed and Discover scoring (weights sum, Wilson); smart-correction
  meaning guard (protected words, numbers, negations, script, length, placeholders) with the prototype examples
  ("bhaiya splendor ka self nhi chl rha…", "ब्रेक सू घिस गया हे, 6301 बेरिंग…"); PII masking round-trip; SigV4 presign
  against AWS test vectors; magic-byte and duration parsers (MP4, WebM, Ogg, PDF); settings ranges and relations.
- **DB (PGlite + real Postgres for concurrency):** constraints and partial uniques (one open verification, one active
  vouch pair, one best answer, one vote, no self-follow, ordered pairs); counters under double like / unlike races;
  conditional quota increments; append-only `ustaad_events` / ledger / moderation actions refuse UPDATE/DELETE; block
  removes follows/connections in one transaction; story expiry and media purge; removed-archive retention; RLS inventory.
- **API:** non-member 404 on every member route; staff permissions per route; role-leak suite (customer, shop,
  workshop, staff without Ustaad perms); employer check for jobs; answer gate by track; rate limits and daily caps;
  idempotency on create routes; presign → complete happy path and every rejection (size, type, magic, duration,
  location atom, budget full, quota); signed GET only for members; four-eyes and self-moderation refusals;
  takedown fast path within one call; correction adapter fallback on timeout/error/no key and the injection test
  ("ignore previous instructions…" stays as text); `USTAAD_SCAM_PHRASE`; reach refusal.
- **Web (Vitest + Playwright, 390/768/1440, light + dark, en + hi):** join under 2 minutes with only the required
  consent; ask by voice (mock recorder) → answer → best → Izzat; create each post kind and template; story view;
  like/save/share/report; follow, connect, message request accept; Discover filters and opt-out; pin flow incl. weak
  GPS and home/roadside; area map bands; job post → apply (phone not shared unless ticked) → hire; smart correction
  suggest/auto/off and "see original"; admin settings save bar and relation errors; reports queue sorted by clock;
  verification approve/reject; Hindi coverage; axe; visual snapshots; UI state-audit rows `USTAAD-*`, `ADM-USTAAD-*`.
- **Security acceptance tests (review § 4.2, ids kept; each owned by the plan workstream in § 14a):** role-leak
  matrix (§ 3, every route × role); AT-LEVEL-1 (600 followers from accounts under 30 days or the same garage leave the
  qualified count at 0, no Bada); AT-LEVEL-2 (turning staff approval off → 422; a Bada promotion without a staff row
  fails the conditional UPDATE); AT-VOUCH-1 (a 4-member reciprocal ring is flagged; the 4th vouch in a month → 429);
  AT-LOC-1 (trilateration with 3 accounts over 30 days: same band per pair on repeat, 4th pin change in 24 h and 7th
  in 30 days → 429, median estimation error > 1 km); AT-LOC-2 (a zone of 4 shows "few"; a 1-member speciality cell is
  suppressed; complementary suppression holds); AT-LOC-3 (hidden location → in no count, no distance); AT-LOC-4 (exact
  pin to a connection, not to a follower); AT-DM-1 (< 7-day account starting a thread → 403; a first message with a
  link → refused); AT-JOB-1 (fee phrase or UPI id → held; missing attestation → 422); AT-SC-1 (auto mode never changes
  "DOT 3" or "175/65 R14"); AT-PROMO-1 (label change → 422; the label renders in the first line); AT-NAME-1
  ("MechDøst", "Mech Dost", Cyrillic look-alikes → 422 `NAME_RESERVED`); AT-TAKEDOWN-1 (signed URL, teaser, search hit
  and feed card 404 within 60 s, evidence row kept); AT-RATE-1 (21st follow in a day → 429 with headers);
  AT-REGION-1 (a Nagpur pin → 422 `USTAAD_REGION`; a disabled city's zones not shown); AT-HINDI-1; AT-UP-1 (GPS EXIF
  gone), AT-UP-2 (SVG, HTML renamed `.jpg`, JPEG+ZIP polyglot refused or neutralised), AT-UP-3 (decompression bomb →
  422 before decoding), AT-UP-4 (181 s or > 150 MB refused before any processing; a 180 s ~60 MB clip succeeds after an
  interrupted, resumed upload), AT-UP-5 (an MP4 with an HLS/concat/`dref` URL reference is rejected without any
  network or file read), AT-UP-6 (a PDF is always `attachment` from the docs host; sanitiser test joins when the
  sanitiser ships), AT-UP-7 (EICAR: pre-moderated now, blocked when antivirus ships), AT-UP-8 (a quarantine object is
  unreadable by members), AT-UP-9 (a benign fixture on a test hash list blocks publishing and opens a report task;
  runs against the classifier adapter's test double), AT-UP-10 (a signed upload URL used by another member or after
  expiry is refused); AT-SSRF-1 (`169.254.169.254`, `[::ffff:127.0.0.1]`, `0x7f000001`, `10.0.0.1`, a DNS-rebinding name
  and a redirect to localhost all refused), AT-SSRF-2 (3 s timeout, 512 KB cut), AT-SSRF-3 (`https://mechdost.in@evil.com/`
  shows `evil.com`). Plus: join via `/partners/apply/mechanic` creates a `pending_verification` member and the status
  page shows progress; the application-mapping script is idempotent and never creates a member without consent;
  tutorial skip/complete/replay and coach-marks one at a time.
- **Performance:** feed JS budget check in CI; Lighthouse ≥ 90 on `/ustaad` and `/ustaad/q/[code]` with seeded data.

## 21. Open questions (queued in `docs/questions-for-user.md`, defaults used meanwhile)

| #       | Question                                                                                                                                                                                                                         | Default meanwhile                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Q-U1    | Cloudflare account + R2 bucket + API keys for media                                                                                                                                                                              | Supabase Storage adapter with the same caps and budget                                       |
| Q-U2    | ~~Speech-to-text provider~~ **Dropped by ruling 2026-11-26: no speech-to-text**                                                                                                                                                  | —                                                                                            |
| Q-U3    | Smart-correction LLM: provider choice + API key (and the provider's data terms)                                                                                                                                                  | Claude Haiku class via Anthropic once a key is given; word-list engine until then            |
| Q-U4    | Grievance Officer: name, e-mail, phone to publish (IT Rules)                                                                                                                                                                     | Company support number + grievance mailbox, staff on call                                    |
| Q-U5    | Confirm only: request-only messages for every member by default (ruled with the security review; no gender is collected)                                                                                                         | Request-only for everyone; each member can change it; admin can change the default           |
| Q-U6    | Image-safety classifier (NSFW) and CSAM hash-list access (and a Web Risk key for links)                                                                                                                                          | No classifier: new accounts' media and PDFs pre-moderated; admin domain deny list            |
| Q-UC1–7 | Counsel: DPDP s.9 with no age check; CSAM evidence retention; 2 h / 3 h clock scope and dates; Code on Wages; Kerala HC defamation view; LLM processor outside India + s.194R Coins; an adult self-declaration line in the Terms | Build to the strictest reading; no self-declaration line until counsel and the founder agree |
| —       | Udhaar/credit, job card/GST invoice, trade prices, certificate upload                                                                                                                                                            | Not built (PENDING #25–#28)                                                                  |

## 21a. Workstream A as built (2026-11-26)

- Migrations (unapplied; renumber at merge): `0088_ustaad_foundations`, `0089_ustaad_identity`, `0090_ustaad_qa`,
  `0091_ustaad_feed`, `0092_ustaad_local`, `0093_ustaad_moderation` (62 tables, RLS on, grants revoked, triggers;
  `ustaad_media_totals` added for the budget; report reasons seeded; reach cities seeded from existing city slugs).
- Access: setting `ustaad.access` (`off | staff_preview | open`, default `staff_preview`); see decisions 2026-11-26 "workstream A".
- Settings: `USTAAD_SETTINGS` registry (not `OPERATIONAL_SETTINGS`), `/v1/admin/ustaad/settings`.
- Media: § 10 as amended by decisions 2026-11-26 (private-copy verification, container allowlists, fragmented MP4 and
  extra metadata refused with `MEDIA_LOCATION`, deny-by-default reads, Supabase 2 h signed upload URL caveat).
- Stubs for B–F with final signatures: `recordIzzat`, `recomputeUstaadLevel`, `screenUstaadContent`,
  `assertUstaadNameAllowed` (`packages/db/src/repo/ustaad/`), `applyCorrection` (`apps/api/src/ustaad/correction`),
  real `notifyUstaad`, `recordUstaadEvent` (no analytics for restricted members, SR-42), `USTAAD_RATE_RULES`.
- Not done in A: `/ustaad/notifications` page (the bell links to the site's inbox), the web media components
  (compress, recorders, trim, blur, upload) and the `ustaad_media_purge` worker job (the repository functions
  `dueUstaadMediaPurges` / `markUstaadMediaPurged` exist), Supabase TUS resumable uploads, the state-audit rows.

## 22. Not built / later

Speech-to-text and transcripts (ruled out), voice search, auto-translation, server video/audio transcoding and the
ffmpeg sandbox (SR-13/14), server auto-blur and OCR (SR-19), PDF sanitiser and antivirus (SR-16), Web Risk link checks
(SR-24), CSAM hash matching (needs access, Q-U6), certificate upload, skill
quizzes, paid mentorship/trainers, "featured in workshop booking", public profiles for customers, roadside responder
pool for Bada+ (spec 22 phase 2), udhaar, mechanic job cards and GST invoices, trade prices, brand advertisers, mobile
app.
