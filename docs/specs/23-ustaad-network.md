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
| `/ustaad/s/[token]`                                        | Share teaser for non-members (sign in to see; no content; no gate or shell, § 21g)                                                                                                                                           |
| `/partners/status`                                         | For mechanics: verification progress (§ 4a)                                                                                                                                                                                  |
| `/ustaad/ask`, `/ustaad/ask/new`                           | Q&A list (All, For you, Mine, No answer yet) and the composer sheet                                                                                                                                                          |
| `/ustaad/q/[code]`                                         | Question thread with answers, best answer, parts used, report                                                                                                                                                                |
| `/ustaad/create`                                           | Composer (quick start + any media), draft restore                                                                                                                                                                            |
| `/ustaad/p/[id]`                                           | Post detail with replies                                                                                                                                                                                                     |
| `/ustaad/stories/[memberId]`                               | Full-screen story viewer                                                                                                                                                                                                     |
| `/ustaad/discover`                                         | Search, work and level filters, top helpers, tags, Top this week (§ 21g)                                                                                                                                                     |
| `/ustaad/tags/[slug]`                                      | Tag page (posts, questions, follow tag)                                                                                                                                                                                      |
| `/ustaad/u/[handle]`                                       | Member profile (card, counts, Follow / Connect / Message, posts; was `/m/`, § 21g)                                                                                                                                           |
| `/ustaad/me`                                               | My card (share as image, QR), stats, level ladder, badges, my work, settings and my choices                                                                                                                                  |
| `/ustaad/me/verify`                                        | Get verified                                                                                                                                                                                                                 |
| `/ustaad/network`                                          | Followers, following, connections, requests, blocked (§ 21g); mentors later                                                                                                                                                  |
| `/ustaad/messages`, `/ustaad/messages/[id]`                | Message requests and threads; `?to=<handle>` starts a request (§ 21g)                                                                                                                                                        |
| `/ustaad/jobs`, `/ustaad/jobs/[code]`, `/ustaad/jobs/mine` | Jobs list, detail + apply sheet, employer's jobs and applicants                                                                                                                                                              |
| `/ustaad/learn`                                            | Courses, short videos, MechDost training                                                                                                                                                                                     |
| `/ustaad/area`, `/ustaad/me/location`                      | Zone map; pin my garage (`/ustaad/pin` redirects here, § 21c)                                                                                                                                                                |
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

| Table                       | Key columns                                                                                                                                                                                                                                                                                                                                                            | Constraints                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ustaad_reports`            | `code`, `target_type` (`post\|story\|comment\|question\|answer\|member\|job\|message`), `target_id`, `reporter_id` (null for staff/legal), `source` (`member\|auto_word\|auto_scam\|auto_safety\|legal_order\|grievance\|staff`), `reason_code`, `note`, `clock` (`intimate_2h\|legal_3h\|removal_36h\|standard_24h\|grievance_7d`), `due_at`, `status`, `assigned_to` | partial unique (`target_type`,`target_id`,`reporter_id`) WHERE open; (`status`,`due_at`) |
| `ustaad_moderation_actions` | append-only: `report_id` null, `target_type`, `target_id`, `action` (`keep\|hold\|remove\|restore\|warn\|restrict\|ban\|unban\|strike\|level_review\|takedown`), `reason_code`, `days`, `actor_id`, `second_actor_id`, `note`                                                                                                                                          | (`target_type`,`target_id`,`created_at`)                                                 |
| `ustaad_strikes`            | `member_id`, `reason_code`, `izzat_delta`, `expires_at`, `appeal_ticket_id`, `status` (`active\|overturned\|expired`)                                                                                                                                                                                                                                                  | (`member_id`,`status`)                                                                   |
| `ustaad_word_lists`         | admin: `list` (`banned\|scam_phrase\|protected\|pii_pattern`), `phrase`, `phrase_norm`, `lang`, `active`                                                                                                                                                                                                                                                               | unique (`list`,`phrase_norm`)                                                            |
| `ustaad_report_reasons`     | admin: `code` (fixed codes for analytics: `wrong_unsafe\|illegal_modification\|abuse\|spam\|privacy\|minor\|not_work\|fake\|job_scam\|ip\|ncii_impersonation\|other`), `label_en`, `label_hi`, `active`, `default_clock`                                                                                                                                               | unique `code`; `other` cannot be turned off                                              |
| `ustaad_removed_archive`    | `target_type`, `target_id`, `snapshot` jsonb (text + media keys), `removed_at`, `retain_until` (removed_at + `mod.retention_days`)                                                                                                                                                                                                                                     | purge job deletes after `retain_until` unless a legal hold is set                        |

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
6. **Report:** `open → in_review → actioned | dismissed`; `actioned → appealed → upheld | overturned` (`upheld` = the
   decision stands, `overturned` = it is reversed; ruled 2026-11-26 F2) (appeal via a
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

| Area          | Routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Limit (default)                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Membership    | `GET /ustaad/me`, `POST /ustaad/join` (needs a verified phone; Turnstile; 3/day; optional `fromApplication` code), `GET /ustaad/onboarding`, `PUT /ustaad/onboarding` (card reached, skipped, completed, coach-mark seen), `POST /ustaad/onboarding/reset`, `GET /ustaad/tutorial` (cards + coach-marks in the member's language), `GET /ustaad/verification-status` (for `/partners/status`), `PATCH /ustaad/me`, `PUT /ustaad/me/specialities`, `PUT /ustaad/me/choices` (consents, dm mode, suggest me, correction mode), `POST /ustaad/me/leave`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 30 writes/10 min                                                                                                          |
| Verification  | `POST /ustaad/verifications`, `POST …/{id}/withdraw`, `POST /ustaad/vouches` (`ustaad:vouch`), `POST /ustaad/vouches/{id}/give\|decline\|revoke`, `GET\|POST /ustaad-attest/{token}` (public, outside `/ustaad/*`, Turnstile, 10/IP/h; § 21b)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | vouches 5/day                                                                                                             |
| Workshop      | `GET /workshop/ustaad/attestations`, `POST …/{id}/confirm\|decline` (`service_menu:write` on that workshop)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 60/10 min                                                                                                                 |
| Media         | `POST /ustaad/media` (declare kind, mime, bytes, sha256, duration → presigned PUT, 10 min), `POST /ustaad/media/{id}/parts` (more part URLs for a resumable upload, only up to the declared size), `POST /ustaad/media/{id}/complete` (verify; parts list for multipart), `GET /ustaad/media/{id}/url?variant=` (signed GET)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 40 uploads/day, 3 videos/day; reads 600/min/IP                                                                            |
| Feed & posts  | `GET /ustaad/feed?tab=for_you\|following&cursor=`, `POST /ustaad/posts`, `GET\|DELETE /ustaad/posts/{id}`, `POST\|DELETE …/{id}/like`, `…/save`, `POST …/{id}/share` (channel code), `GET\|POST …/{id}/comments`, `POST /ustaad/polls/{id}/vote`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | posts `posts.per_day`; comments 30/h; likes 100/day (SR-43)                                                               |
| Stories       | `GET /ustaad/stories`, `POST /ustaad/stories` (a post with kind `story`), `POST /ustaad/stories/{id}/view`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | stories 10/day                                                                                                            |
| Q&A           | `GET /ustaad/questions?filter=`, `POST /ustaad/questions`, `GET /ustaad/questions/{code}`, `POST …/{code}/answers` (`ustaad:answer`), `POST /ustaad/answers/{id}/helpful`, `POST /ustaad/questions/{code}/best`, `PUT /ustaad/answers/{id}/parts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | questions 10/day, answers 30/day, votes 100/day                                                                           |
| Graph         | `PUT\|DELETE /ustaad/follows/{memberId}`, `POST /ustaad/connections`, `POST …/{id}/accept\|ignore\|remove`, `PUT\|DELETE /ustaad/blocks/{memberId}`, `…/mutes/…`, `DELETE /ustaad/followers/{memberId}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | follows 20/day (SR-43); connect 20/day                                                                                    |
| Mentorship    | `POST /ustaad/mentorships`, `POST …/{id}/accept\|decline\|end`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 5/day                                                                                                                     |
| Messages      | `GET /ustaad/threads`, `POST /ustaad/threads` (first message = request), `POST …/{id}/accept\|decline`, `GET\|POST …/{id}/messages`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | new threads 20/day (SR-33); messages 120/h; accounts younger than `limits.dm_min_account_days` cannot start threads       |
| Discover/tags | `GET /ustaad/discover?q=&work=&area=&city=`, `GET /ustaad/tags`, `GET /ustaad/tags/{slug}`, `PUT\|DELETE /ustaad/tags/{slug}/follow`, `POST /ustaad/tag-suggestions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | search 60/min; 20 per page, cursor only, no total count, 200 profiles viewed per day (SR-37); no bulk export for any role |
| Members       | `GET /ustaad/members/{handle}`, `GET /ustaad/members/{handle}/posts\|answers`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 120/min                                                                                                                   |
| Location      | `PUT /ustaad/me/location` (point, accuracy, source, landmark, three choices), `POST /ustaad/me/location/signboard`, `GET /ustaad/zones?city=` (verified members; banded)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 10/day                                                                                                                    |
| Jobs          | `GET /ustaad/jobs`, `GET /ustaad/jobs/{code}`, `POST /ustaad/jobs` (`ustaad:jobs_post`), `PATCH …/{code}`, `POST …/{code}/pause\|close\|fill`, `POST …/{code}/apply`, `POST /ustaad/applications/{id}/withdraw`, `GET /ustaad/jobs/mine`, `POST /ustaad/applications/{id}/seen\|shortlist\|reject\|hire` (employer of that job)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | jobs 5/day; applications 20/day                                                                                           |
| Learn         | `GET /ustaad/learn`, `PUT /ustaad/learn/{resourceId}/progress`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 120/h                                                                                                                     |
| Correction    | `POST /ustaad/correct` (text ≤ 2,000 chars, lang hint, mode) → `{ text, changes[], engine }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `correction.per_member_per_10min` (30)                                                                                    |
| Reports       | `POST /ustaad/reports`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 20/day                                                                                                                    |
| Share teaser  | `GET /ustaad/s/{token}` (public, generic card only, `noindex`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 60/min/IP                                                                                                                 |
| Promotions    | (served inside feed/search/jobs/learn responses; `POST /ustaad/promotions/{id}/hide` reason code)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                         |
| Admin         | `GET /admin/ustaad/overview`, `GET /admin/ustaad/settings` (`ustaad:settings` or `ustaad:read`), `PATCH /admin/ustaad/settings` (batch of changed keys with versions, `ustaad:settings`; G1) and `PUT …/settings/{key}` (one key), create + edit `/admin/ustaad/levels\|badges\|tags\|words\|reasons\|reach-cities\|tutorial-cards\|coachmarks` (`ustaad:settings`), `POST /admin/ustaad/tags/{id}/merge`, `/admin/ustaad/promotions` + `…/{id}/move` (`ustaad:promotions`), `GET /admin/ustaad/verifications?status=`, `POST …/{id}/approve\|reject\|revoke` (`ustaad:verify`), `GET /admin/ustaad/moderation/reports` (`?queue=open\|appealed\|decided`), `GET …/reports/{code}`, `POST …/reports/{code}/act` (keep\|remove\|warn\|restrict\|ban), `…/ban/confirm`, `…/appeal`, `…/appeal/decide`, `GET …/reports/{code}/thread?reason=` (`ustaad:moderate`; reads also `ustaad:read`), `POST /admin/ustaad/moderation/takedowns` (`ustaad:takedown`) — as built F2, § 21f, `GET /admin/ustaad/members/{id}` (masked), `GET …/{id}/location` (`ustaad:location_exact`, audited), `GET /admin/ustaad/zones` (exact), `GET /admin/ustaad/audit` | staff 300/min                                                                                                             |

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
- **Cash on delivery (perk, founder ruling 2026-11-26; spec 03 § Cash-on-delivery eligibility):** a member with
  `verification_state = 'verified'`, `status = 'active'`, `restricted_mode = 'none'`, perks not frozen
  (`perks_frozen_until` past or empty) and a level at or above `checkout.cod_ustaad_min_level` (0 Naya … 3 Master;
  Chhotu and `ustaad_pending` never) may pay cash on delivery without asking, while the city's
  `checkout.cod_ustaad_verified` switch is on. A member who is not verified yet sees "Get verified on Ustaad" at
  checkout and on Account → Payments. Not built: the inactivity pause for this perk (the 90-day pause is not read).

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

### 11.1 As built (task F1, 2026-11-26)

- **Files.** API `apps/api/src/ustaad/correction/` (`engine.ts` seam, `anthropic.ts`, `gemini.ts`, `wordlist.ts`,
  `guard.ts`, `mask.ts`, `prompt.ts`, `cache.ts`, `service.ts` = `runCorrection`), route
  `apps/api/src/routes/ustaad/correct.ts`, repo reads `packages/db/src/repo/ustaad-correction.ts`, contract
  `packages/shared/src/ustaad/correction.ts` (request/response, word-level `correctionSegments`), web
  `apps/web/src/lib/ustaad/correction.ts` and `apps/web/src/components/ustaad/correction/` (`SmartCorrection`,
  `SuggestCard`, `EditedText`, `correctForSend` for auto mode), copy `ustaad.correction.*` (en + hi).
- **Provider switch.** `SMART_CORRECTION_PROVIDER` defaults to `none`: the assistant's `ANTHROPIC_API_KEY` alone never
  sends member text anywhere. `anthropic` uses model `SMART_CORRECTION_MODEL` (default `claude-haiku-5-5`, constant
  `DEFAULT_ANTHROPIC_CORRECTION_MODEL`) over plain `fetch`, API version `2026-10-21`, `output_config.effort: low` and a
  JSON-schema output, no sampling parameters, no tools, no metadata; a reply that is not a complete `end_turn`
  (refusal, `max_tokens`, non-200, bad JSON) falls back. `gemini` needs `SMART_CORRECTION_MODEL` (config refuses to
  start without it); its request shape is from Google's REST reference and **not yet tested live** (Q-U3).
- **Consent gate.** The LLM runs only for a member whose latest `ustaad_correction` consent is granted; everyone else
  gets the word list on our server.
- **Response.** `{ mode, engine, text, original, changed, changes, segments[] }`; `engine` null and the text unchanged
  when the mode is `off` or the language is switched off. Mode = network default, or (when
  `correction.member_can_change`) the request's mode, else the member's own; a member's own `off` always wins.
- **Gate.** `ustaad.access` off, or staff preview without a staff session → the generic 404 even for anonymous callers
  (checked before sign-in); open + anonymous → 401; non-members and members who left → 404; banned → 403
  `USTAAD_BANNED`. The route is mounted in `ustaadRoutes` behind A3's `ustaadGate` and `requireUstaadMember`; the
  fresh member row is the authority (not the session-cached grant), so a member who just joined can use it at once.
- **Length rule.** ±`max_length_change_pct` **or 12 characters, whichever is larger** (`kya h` → `kya hai` is +40 %).
- **Numbers.** Compared exactly as written (`६३०१` turned into `6301` is refused); protected words, units and
  negations are compared normalised (NFC, lower case, Devanagari digits as ASCII). Negations count as one class
  (`nhi` → `nahi` is a fix; `mtlb` → `matlab` is not a negation).
- **Word list.** Built-in list from the concept prototype plus the admin's `correction` rows; protected words are never
  touched, not even their case; capital first letter and a closing full stop only on Latin text and never next to a
  word with a digit (`DOT 3`, `175/65 R14`); a change the guard would refuse is skipped.
- **Masking (security review 2026-11-26, four rounds).** E-mail, UPI, `@handle`, GSTIN, PAN, IFSC, Aadhaar, phones
  (separators space . - / ( ), `+91`, Devanagari digits), long numbers (≥ 9 digits: cards, accounts), plates, PIN
  codes. **Fail closed** (word list only) when: masking fails; any numeral other than ASCII or Devanagari digits
  (Bengali, fullwidth, circled, superscript…); both digit scripts in one text; or the masked text, NFKC-normalised,
  still holds **8 or more numerals counted over the whole text** after removing known-safe mechanic tokens (tyre
  sizes, viscosity, battery, rupee amounts up to ₹99,99,999 — each unless chained with another of its kind — and
  model codes / numbers of ≤ 4 digits with no other numeral within 6 characters). No segmentation, so letters, marks,
  format characters or symbols between digits cannot split a number. Residual risk: a number cut into safe tokens
  separated by words (`₹987 aur ₹654 aur ₹3210`) still passes; it is the member's own deliberate disguise.
- **Cache.** LLM results only, masked text in and masked text out (no PII in Redis), Upstash when configured else a
  per-instance memory cache; a hit is restored and guarded again. The daily budget is reserved only on a cache miss.
- **Logs.** `ustaad_correction {engine, mode, cached, llmSkipped, changes, chars, ms}`, never the text.
- **Web.** The suggest card highlights the **changed** words (tint, underline and a screen-reader "changed"), not
  the protected words. The card and Undo apply only while the field still holds the checked text; Keep mine and Edit
  myself never rewrite the field. Components are not mounted yet: composers in C, D and E add them (and their
  state-audit rows).
- **Word list.** The built-in list (`BUILT_IN_CORRECTIONS`) is a fallback in code; admin rows of list `correction`
  override any entry (same phrase → the admin's replacement). An admin cannot yet switch a built-in entry off; seeding
  the built-ins as `ustaad_word_lists` rows (so G1 can edit and deactivate them) is proposed (Q-U7).
- **Residual masking risk.** One tyre-shaped token can carry up to 12 numerals (`987/65 43 210S` matches the tyre
  pattern), and a number cut into safe tokens separated by words still passes. Both are deliberate disguises by the
  member; queued as Q-U7 with the default "accept until the LLM is switched on, then tighten the tyre pattern".

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
| `ustaad.appeal_upheld` / `ustaad.appeal_overturned` (SIM-P26)                                                     | appellant                      | bell                                                  | —                          |
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

| Key                                                                                                                                                                                | Default                                                                                              | Range / note                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `general.enabled`                                                                                                                                                                  | on                                                                                                   | off hides the network for every member; content kept                                                                                                        |
| `general.mechanics_only`                                                                                                                                                           | on (locked)                                                                                          | cannot be turned off                                                                                                                                        |
| `general.all_state`                                                                                                                                                                | off                                                                                                  | on = every Chhattisgarh district                                                                                                                            |
| `general.join_mode`                                                                                                                                                                | `all`                                                                                                | `all` (starts as Chhotu) · `verified_only` · `invite_only`                                                                                                  |
| `general.default_lang`                                                                                                                                                             | `hi`                                                                                                 | `hi` · `en`                                                                                                                                                 |
| `levels.*` (table)                                                                                                                                                                 | § 9.2                                                                                                | 0 = rule not used                                                                                                                                           |
| `levels.follower_min_age_days`                                                                                                                                                     | 30 (SR-9)                                                                                            | 7–180 (qualified followers are also verified and not in a ring)                                                                                             |
| `levels.follower_exclude_same_garage`                                                                                                                                              | on (ours, SR-9)                                                                                      |                                                                                                                                                             |
| `levels.inactive_pause_days`                                                                                                                                                       | 90 (study)                                                                                           | 30–365                                                                                                                                                      |
| `izzat.answer_posted` / `best_answer` / `helpful_received` / `follower_gained` / `video_completed`                                                                                 | 2 / 10 / 1 / 1 / 0                                                                                   | 0–100 each                                                                                                                                                  |
| `verify.owner_enabled` / `vouch_enabled` / `certificate_enabled`                                                                                                                   | on / on / **off**                                                                                    | certificate off until PENDING #28                                                                                                                           |
| staff final approval (verification, Bada, Master)                                                                                                                                  | **locked on** (ruling, SR-8)                                                                         | not a setting; shown read-only in admin                                                                                                                     |
| `verify.vouches_needed`                                                                                                                                                            | 2 (prototype copy)                                                                                   | 1–5                                                                                                                                                         |
| `verify.vouch_min_level`                                                                                                                                                           | `pakka`                                                                                              | level code                                                                                                                                                  |
| `verify.evidence_retention_days`                                                                                                                                                   | 30 (research)                                                                                        | 7–180                                                                                                                                                       |
| `posts.video_max_s`                                                                                                                                                                | **180** (ruling)                                                                                     | 15–180; **raising it above 180 (to 300) needs a super admin and a reason code, audited** (`ustaad:settings` is super admin only; a community manager reads) |
| `posts.max_photos`                                                                                                                                                                 | 6                                                                                                    | 1–10                                                                                                                                                        |
| `posts.per_day`                                                                                                                                                                    | 20                                                                                                   | 1–100 (answers not counted)                                                                                                                                 |
| `posts.types.*`                                                                                                                                                                    | all on (voice, photo, video, text, document, poll, question, stories, mixed, link)                   | off hides it in the composer                                                                                                                                |
| `stories.hours`                                                                                                                                                                    | 24                                                                                                   | 1–72                                                                                                                                                        |
| `stories.purge_grace_hours`                                                                                                                                                        | 24 (ours)                                                                                            | 0–168                                                                                                                                                       |
| `media.data_saver_default`                                                                                                                                                         | on                                                                                                   |                                                                                                                                                             |
| `media.video_kbps` / `video_max_mb` / `voice_max_s` / `doc_max_mb` / `image_max_mb`                                                                                                | 1000 / 150 (hard cap) / 120 / 5 / 3 (coordinator, SR-15)                                             | video_max_mb ≤ 150 locked ceiling                                                                                                                           |
| `media.member_quota_mb`                                                                                                                                                            | 500 (ours)                                                                                           | 50–5000                                                                                                                                                     |
| `media.network_budget_gb` / `budget_warn_pct`                                                                                                                                      | 10 / 80 (coordinator: R2 free tier)                                                                  | 1–1000 / 50–95                                                                                                                                              |
| `media.video_archive_months`                                                                                                                                                       | 0 (keep)                                                                                             | 0–60                                                                                                                                                        |
| `media.url_ttl_min`                                                                                                                                                                | 10 (SR-21)                                                                                           | 2–10                                                                                                                                                        |
| `correction.default_mode`                                                                                                                                                          | `suggest`                                                                                            | `suggest` · `auto` · `off`; `auto` needs a non-empty protected-word list (SR-40)                                                                            |
| `correction.member_can_change`                                                                                                                                                     | on                                                                                                   |                                                                                                                                                             |
| `correction.langs.*`                                                                                                                                                               | hi, en, hinglish, cg on                                                                              |                                                                                                                                                             |
| `correction.timeout_ms` / `llm_daily_calls` / `per_member_per_10min` / `max_length_change_pct`                                                                                     | 2000 / 5000 / 30 / 30 (coordinator, ours)                                                            | bounded                                                                                                                                                     |
| protected words (table)                                                                                                                                                            | Splendor, Activa, self-start, clutch plate, Exide, Pulsar, carburettor, jugaad, mistri, ustaad       | admin list                                                                                                                                                  |
| `loc.default_display`                                                                                                                                                              | `area_circle`                                                                                        | `area_circle` · `city_only`                                                                                                                                 |
| `loc.allow_exact_optin`                                                                                                                                                            | on                                                                                                   | off = nobody can share an exact pin                                                                                                                         |
| `loc.gps_max_m`                                                                                                                                                                    | 100                                                                                                  | 20–500                                                                                                                                                      |
| `zones.exact_from` / `hide_below` / `round_above_exact`                                                                                                                            | 20 / 5 / on                                                                                          | hide_below ≥ 5 and < exact_from (SR-31, SR-40)                                                                                                              |
| `loc.pin_changes_per_day` / `pin_changes_per_30d` / `exact_audience_default`                                                                                                       | 3 / 6 / `connections`                                                                                | SR-30, SR-32                                                                                                                                                |
| `zones.cell_edge_m`                                                                                                                                                                | 1400 (ours)                                                                                          | 500–5000, global                                                                                                                                            |
| `zones.verified_only`                                                                                                                                                              | on (research)                                                                                        |                                                                                                                                                             |
| `feed.show_like_counts` / `show_follower_counts`                                                                                                                                   | on / on (ruling)                                                                                     |                                                                                                                                                             |
| `feed.w_follows` / `w_city` / `w_tag` / `w_recency` / `w_helpful`                                                                                                                  | 30 / 25 / 20 / 15 / 10                                                                               | sum = 100                                                                                                                                                   |
| `feed.window_days`                                                                                                                                                                 | 14                                                                                                   | 3–60                                                                                                                                                        |
| hashtags (table)                                                                                                                                                                   | seed: #battery, #selfstart, #clutchplate, #mileage, #selfstartproblem (+ Hindi names, aliases)       | max 5 per post, ≥ 1 curated (`tags.max_per_post`)                                                                                                           |
| `discover.w_*` / `new_slots`                                                                                                                                                       | § 9.4                                                                                                | sum = 100                                                                                                                                                   |
| `promo.enabled` / `every_n`                                                                                                                                                        | on / 12                                                                                              | 8–50 (SR-40)                                                                                                                                                |
| promotion label                                                                                                                                                                    | **"Sponsored" / "प्रायोजित", locked** (ruling, ASCI, SR-41)                                          | not editable                                                                                                                                                |
| `promo.place.feed` / `stories` / `search` / `jobs` / `learn`                                                                                                                       | on / off / off / on / on                                                                             |                                                                                                                                                             |
| `promo.daily_cap_per_member` / `whatsapp_per_week`                                                                                                                                 | 3 / 2 (study)                                                                                        |                                                                                                                                                             |
| banned words, report reasons (tables)                                                                                                                                              | seed from the admin page                                                                             | `other` always on                                                                                                                                           |
| `mod.retention_days` / `restrict_days` / `four_eyes_from_ban_days`                                                                                                                 | 180 / 3 / 7 (research, ours)                                                                         |                                                                                                                                                             |
| `mod.clock_intimate_h` / `clock_legal_h` / `clock_removal_h` / `clock_standard_h` / `clock_grievance_days` (F2: + `mod.rules_reminder_days` 90, `mod.false_report_strike_after` 3) | 2 / 3 / 36 / 24 / 7                                                                                  | counsel to confirm                                                                                                                                          |
| `jobs.enabled` / `employer_verification` / `never_charge_candidates`                                                                                                               | on / on / on (locked)                                                                                |                                                                                                                                                             |
| `jobs.require_adult_attestation`                                                                                                                                                   | on (ours)                                                                                            |                                                                                                                                                             |
| scam phrases (table)                                                                                                                                                               | registration fee, pay to join, deposit required, advance for uniform, security deposit, training fee |                                                                                                                                                             |
| `jobs.expiry_days`                                                                                                                                                                 | 30                                                                                                   | 7–90                                                                                                                                                        |
| `qa.voice_max_s` / `notify_ustaads` / `widen_after_h` / `auto_close_days` / `best_per_week` / `apprentice_can_answer`                                                              | 120 / 10 / 24 / 60 / 5 / off                                                                         | bounded                                                                                                                                                     |
| `learn.self_mark_daily_cap`                                                                                                                                                        | 5                                                                                                    | 0–50                                                                                                                                                        |
| `limits.*`                                                                                                                                                                         | § 8 table                                                                                            | bounded                                                                                                                                                     |
| `limits.dm_min_account_days`                                                                                                                                                       | 7 (research)                                                                                         | 0–60                                                                                                                                                        |
| `dm.default_mode`                                                                                                                                                                  | `request` (Q-U5 default, SR-33)                                                                      | `everyone` · `request` · `nobody`                                                                                                                           |
| `mod.premod_first_posts` / `premod_account_days` / `nsfw_hold_score`                                                                                                               | 3 / 30 / 0.7                                                                                         | until classifier + hash list (Q-U6)                                                                                                                         |
| `mod.links_min_account_days` / `minor_report_restricts`                                                                                                                            | 7 / on (locked on)                                                                                   | § 13                                                                                                                                                        |
| `security.high_level_freeze_hours`                                                                                                                                                 | 72 (SR-2)                                                                                            | 24–168                                                                                                                                                      |
| `stories.min_account_days`                                                                                                                                                         | 30 (security review § 0)                                                                             | 0–90                                                                                                                                                        |
| `verify.attest_per_owner_quarter` / `attest_photo_max_m`                                                                                                                           | 10 / 200 (SR-6)                                                                                      | 1–50 / 50–1000                                                                                                                                              |
| `verify.attest_distance_tries`                                                                                                                                                     | 1 (lead ruling 2026-11-26)                                                                           | 1–5; failed owner location checks before the link closes (never shown to the owner)                                                                         |
| `verify.vouch_min_account_days` / `vouch_per_month`                                                                                                                                | 60 / 3 (SR-7)                                                                                        | 30–365 / 1–10                                                                                                                                               |
| distance band edges                                                                                                                                                                | 2 / 5 / 10 km (SR-29), **locked**                                                                    | changing them would let differencing reveal positions                                                                                                       |
| `loc.exact_fuzz_m` / `big_move_km` / `big_move_accuracy_m`                                                                                                                         | 50 / 1 / 50 (SR-30, SR-32)                                                                           | 20–200 / 0.5–5 / 10–100                                                                                                                                     |
| `discover.profiles_per_day` / `limits.new_threads_per_day`                                                                                                                         | 200 / 20 (SR-37, SR-33)                                                                              | 50–1000 / 5–50                                                                                                                                              |
| tutorial cards, coach-marks (tables)                                                                                                                                               | 6 cards + 6 coach-marks (§ 4 flow 15), en + hi                                                       | admin-editable copy, pictures and narration                                                                                                                 |

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
media_count, tag_count, correction}`, `ustaad_story_created {kind}`, `ustaad_comment_posted {input, reply}` (D1), `ustaad_question_asked {input, segment, work,
correction}`, `ustaad_answer_posted {input}`, `ustaad_answer_helpful`, `ustaad_best_answer_chosen`,
`ustaad_followed`, `ustaad_connected`, `ustaad_mentorship_changed {to}`, `ustaad_message_thread_started`,
`ustaad_job_posted {role}`, `ustaad_job_applied`, `ustaad_application_moved {to}`, `ustaad_report_created {reason,
target}`, `ustaad_moderation_action {action, reason, clock, on_time}`, `ustaad_media_rejected {kind, reason}`,
`ustaad_media_budget_full`, `ustaad_location_confirmed {source, accuracy_band}`, `ustaad_zone_counts_built {zones}`,
`ustaad_application_mapped {outcome}`, `ustaad_takedown_executed {clock, seconds}`, `ustaad_restricted_mode {reason}`,
`admin_ustaad_settings_saved {keys}`, `admin_ustaad_invariant_refused {key}`, `admin_ustaad_access_changed {from, to}`,
`admin_ustaad_table_saved {table, action}` (G1), `ustaad_profile_updated {fields}`, `ustaad_choices_saved {fields}`,
`ustaad_security_freeze {reason}`, `ustaad_attest_link_issued`, `ustaad_counter_drift {members}` (B round 3). Client
(owner page, B round 3): `ustaad_attest_opened {valid}`, `ustaad_attest_location {outcome}`, `ustaad_attest_sent
{decision, ok}`. Client (admin, G1): `admin_ustaad_change {area, action, fields}`.
Client: `ustaad_feed_viewed {tab}`, `ustaad_post_liked {via: button|double_tap}` (U2), `ustaad_post_saved`, U2: `ustaad_post_useful`, `ustaad_before_after_toggled {to}`, `ustaad_composer_more_opened`, `ustaad_camera_opened {source}`, `ustaad_post_shared {channel}`,
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
- **Preview testers (founder 2026-11-27, migration 0110):** table `ustaad_preview_testers` (one active row per user,
  removal keeps the row with a reason code; RLS on, grants revoked). During `staff_preview` a listed non-staff account
  passes the access gate (`ustaadAccessDecision` viewer `tester`); `off` hides it, `open` ignores the list. A tester is
  **not staff**: no staff preview on `/ustaad/me` (a non-member tester gets `USTAAD_NOT_MEMBER` and the web shows the
  join card), no `general.enabled` bypass, no admin route. The gate caches the list with the mode (10 s per instance;
  an add/remove clears this instance at once, others follow within 10 s). Admin: `GET|POST /v1/admin/ustaad/preview-testers`,
  `POST …/{id}/remove` (`ustaad:settings` = super admin, for reads too; add by phone or email, answer = masked phone;
  reason codes `qa_run|beta_mechanic|founder_request|other`, removal `run_finished|no_longer_needed|added_by_mistake|other`;
  audit `ustaad.preview_tester.added|removed`; cap 50). UI: Admin → Ustaad → General, card under the access switch.
  The web gate asks the gated `/v1/ustaad/me` for signed-in non-staff viewers (`lib/ustaad/tester-probe.ts`); the
  "Staff preview" banner shows to staff only. Tests: shared access matrix, `packages/db/test/ustaad-preview-testers.test.ts`,
  `apps/api/test/ustaad-preview-testers.test.ts` (role leak, RBAC, cache), `apps/web/test/ustaad-tester-probe.test.ts`.
- Settings: `USTAAD_SETTINGS` registry (not `OPERATIONAL_SETTINGS`), `/v1/admin/ustaad/settings`.
- Media: § 10 as amended by decisions 2026-11-26 (private-copy verification, container allowlists, fragmented MP4 and
  extra metadata refused with `MEDIA_LOCATION`, deny-by-default reads, Supabase 2 h signed upload URL caveat).
- Stubs for B–F with final signatures: `recordIzzat`, `recomputeUstaadLevel`, `screenUstaadContent`,
  `assertUstaadNameAllowed` (`packages/db/src/repo/ustaad/`), `applyCorrection` (`apps/api/src/ustaad/correction`),
  real `notifyUstaad`, `recordUstaadEvent` (no analytics for restricted members, SR-42), `USTAAD_RATE_RULES`.
- Not done in A: `/ustaad/notifications` page (the bell links to the site's inbox), the web media components
  (compress, recorders, trim, blur, upload) and the `ustaad_media_purge` worker job (the repository functions
  `dueUstaadMediaPurges` / `markUstaadMediaPurged` exist), Supabase TUS resumable uploads, the state-audit rows.

## 21b. Workstream B as built (2026-11-26, partial)

- **Engines (pure, `packages/shared/src/ustaad/`):** `levels.ts` (`qualifiedFollowers()`, `levelFor()` one step at a
  time with OR groups, Bada/Master always a staff review even if a rule row says otherwise, Naya without a verification
  opens a request, never a drop; `levelRuleRefusal()` = `COIN_GUARD_REQUIRED` above 10000 bp, `perksActive()`),
  `izzat.ts` (`izzatPoints()`: settings, sponsored 0, strike −500…−50), `verify.ts` (SR-6/SR-7 refusal codes,
  `vouchesSufficient()` = needed givers from ≥ 2 garages), `rings.ts` (24 h reciprocal bursts > 30 % of new followers,
  dense clusters ≥ 3 with ≥ 60 % mutual pairs), `badges.ts` (typed rules, same `count` shape as G1's admin DTO).
- **Repositories (`packages/db/src/repo/ustaad/`):** real `recordIzzat` (idempotent ledger, counter moves only on
  insert) and `recomputeUstaadLevel`; `verification.ts` (request, withdraw, vouches, partner-workshop attestations,
  staff approve/reject/revoke with CAS, `SELF_MODERATION`, four-eyes revoke, `audit_log`, back-fill of **visible**
  answers only); `onboarding.ts` (tutorial progress, reset, cards in the member's language); `application-links.ts`
  (§ 4a mapping + invite check by phone hash); `runUstaadRingDetect`, `expireUstaadAttestations`.
- **Security review fixes (2026-11-26):** vouch cap and reciprocity count given **and revoked** vouches; an expired vouch
  request is refused (`VOUCH_EXPIRED`); a revoke that breaks the evidence of a request in review writes an
  `evidence_withdrawn` event for staff (the machine has no way back to `requested`); `SELF_ATTESTATION` (403) on request
  and on confirm; only `approved` workshops see, confirm or are asked (paused/suspended/pending → 404).
- **Level reviews for Bada/Master** are rows of `ustaad_verifications` with `requested_level` bada/master (no new table).
  **Ring flags** are `ustaad_follows.counted = false` + a `ring_flagged` event (no new table).
- **API:** member routes `GET|PUT /ustaad/onboarding`, `POST /ustaad/onboarding/reset`, `GET /ustaad/tutorial`,
  `GET /ustaad/verification-status`, `POST /ustaad/verifications[/{id}/withdraw]`, `POST /ustaad/attestations`,
  `POST /ustaad/vouches[/{id}/give|decline|revoke]`; staff `GET /admin/ustaad/verifications`,
  `POST …/{id}/approve|reject|revoke` (`ustaad:verify`, city scoped); workshop `GET /workshop/ustaad/attestations`,
  `POST …/{id}/decide`; `POST /partner-applications` with `kind: mechanic` → 410 `MOVED_TO_USTAAD` **only while
  `ustaad.access` = `open`** (the web page follows the same switch; `off`/`staff_preview` keep the old form).
- **Worker:** one hourly timer (attestation expiry; once a day the ring check then the level recompute).
- **Migration `0094_ustaad_identity_seed`** (data only): level rules (founder's demo rules), 8 badges, 6 tutorial cards
  and 6 coach-marks, en + hi, `ON CONFLICT DO NOTHING`.
- **Web:** `/ustaad/join` and (only while `ustaad.access` = `open`) `/partners/apply/mechanic` render the same 5-step
  `UstaadJoinFlow` (`ustaad.join` en + hi). `/ustaad/welcome`: the guide (cards from the admin table, Listen = staff
  recording via a signed URL or the browser's speech, never autoplay; Next / Back / Skip; swipe with button
  equivalents; `tutorial_*` events). Coach-mark on Home under the mic (one at a time, inline, "Samajh gaya").
  `/ustaad/me`: ID card (level chip, verified tick, specialities, WhatsApp teaser share = fixed sentence + join link
  only), stats (Izzat never money), level ladder with "You are here" and qualified followers, badges, "Kaise use
  karein" (resets progress, replays the guide). `/partners/status`: a signed-in member's verification progress (asked →
  proof → MechDost review → verified, or the reason); nothing for anyone else. API `GET /ustaad/me/card`.
- **Script:** `pnpm db:ustaad:map-mechanic-applications [--dry-run]` (links only; partner application rows untouched
  because their status list has no "closed").
- **Round 3 (2026-11-26, branch `worktree-agent-ab7b78a32bea2c97c`, migrations `0098_ustaad_identity_b3` (schema)
  and `0099_ustaad_reserved_names_seed` (data), not applied):**
  - **Names (SR-4, AT-NAME-1):** `packages/shared/src/ustaad/names.ts` `nameSkeleton()` = NFKC, lower case, accents
    and the Devanagari nukta removed, a curated subset of the UTS #39 confusables (Cyrillic, Greek, ø/ł/đ…, `0`→o,
    `1`→l, `rn`→m), joiners/spaces/punctuation dropped (no dependency). `isReservedName()`: whole name or any run of
    its words equals a reserved skeleton; reserved skeletons of 6+ characters also match inside a longer name
    ("MechDostOfficial"); "Badmin Singh" passes. `displayNameRefusal()`: `NAME_CONTACT` (6+ digits in any script, a
    link, `@`), `NAME_FORMAT` (no letter, bidi/zero-width controls; ZWJ/ZWNJ allowed). `assertUstaadNameAllowed()`
    (join, `PATCH /ustaad/me` for the name and the Hindi name) also refuses a name that reads the same as a staff
    member's own full name (whole-name match only). Seed (0099): 24 brand/operator/staff-role words in Latin and
    Devanagari; "Ustaad" alone is not reserved. Admin: `GET|POST /admin/ustaad/reserved-names`,
    `PATCH …/{id}` (on/off with version; `ustaad:settings`; audited; `admin_ustaad_table_saved {table:
reserved_names}`); a look-alike of an existing name is 409 `NAME_EXISTS`. A db test checks every seeded skeleton
    against the function.
  - **Profile and choices:** `PATCH /ustaad/me` (`expectedVersion`, strict DTO, 409 `STALE_MEMBER`, a new `areaLabel`
    without `areaLabelHi` clears the stale Hindi label, `profile_updated` event + `ustaad_profile_updated {fields}`),
    `PUT /ustaad/me/specialities` (codes from the shared list; earned steps kept, never delete-all),
    `GET|PUT /ustaad/me/choices` (message mode, suggest me, data saver, smart correction only while
    `correction.member_can_change` else 422 `USTAAD_SETTING_LOCKED`, the three optional join consents appended to
    `consents` only when changed; `ustaad_choices_saved {fields}`). Repository `repo/ustaad/profile.ts`.
  - **SR-2 freeze:** `freezeUstaadPerksAfterCredentialChange()` on a Pakka+ member: `perks_frozen_until` = now +
    `security.high_level_freeze_hours` (only ever extended), `security_freeze` event, `ustaad_security_freeze
{reason}`, notice `ustaad.security_freeze` (copy no longer says "72 hours"). Called by `ensureUser` when the
    verified token's phone or email differs from the stored one, and when a password change is announced (counted
    from the change time). Job posting already refuses `USTAAD_PERKS_FROZEN`. **Not built:** a "new device" signal
    (the `sessions` table is never written) and a forced re-OTP for password sign-ins of Pakka+ members (Q-UB1).
  - **Garage owner not on MechDost (SR-6):** member `POST /ustaad/attestations/owner` (owner mobile, encrypted, keyed
    blind-index hash for the cap; `SELF_ATTESTATION` for the member's own number; never returns a link). Staff
    `GET /admin/ustaad/attestations` (open owner requests, no phone) and `POST …/{id}/owner-link` (`ustaad:verify`,
    city scoped): a fresh 64-hex token (shown once; a re-issue replaces it) and the owner's number for the call,
    written to `audit_log` (`ustaad.attest_owner_phone_read`). Public `GET|POST /v1/ustaad-attest/{token}` (outside
    `/ustaad/*`, because the member gate would 404 a signed-out owner): 404 while access is `off`, 10/IP/h,
    `no-store`, `noindex`, `no-referrer`; one 404 for unknown, used, re-issued and expired tokens; GET never consumes;
    POST (Turnstile) consumes with a conditional UPDATE on token hash + status + version. Confirm needs a well-formed
    GSTIN/Udyam (`ATTEST_BUSINESS_ID`) and passes the quarter caps **per owner phone and per business number**
    (keyed hashes, counted under `pg_advisory_xact_lock(hashtext(…))` so two confirmations cannot race;
    `ATTEST_QUARTER_CAP`). The distance check (owner's browser position within `verify.attest_photo_max_m` of the
    member's garage pin, **only when the member allowed "use pin for verification"**) never changes the answer
    (security review 2026-11-26: no location oracle): pass or fail, a confirmation answers `{outcome: "received"}`; a
    failure stores the distance and the GSTIN for staff, counts `owner_distance_failures`, and at
    `verify.attest_distance_tries` (default 1, 1–5; lead ruling 2026-11-26) clears the token (staff decide). Only the distance is stored, never
    the position. The workshop-portal confirm takes the same kind of lock per workshop. Web page `/ustaad-attest/[token]` (same
    reason: the `/ustaad` shell hides itself from non-members), en + hi (`ustaad.attest`), client-side fetch (per-IP
    limit), focus to each step's heading, errors under their control. **Not built:** the shop photo of SR-6 (needs a
    public upload path), sending the link by WhatsApp/SMS (templates not live; staff call meanwhile).
  - **Evidence purge:** `purgeUstaadAttestationEvidence()` clears owner phone, GSTIN/Udyam and token after
    `verify.evidence_retention_days` (decided or expired rows), sets `evidence_purged_at`; the keyed hash stays (the
    quarter cap needs it). CHECK `ustaad_attestations_purged_clear`.
  - **Jobs (`repo/ustaad/maintenance.ts`, `apps/api/src/ustaad/identity-jobs.ts`, worker timer):** hourly
    attestation expiry + qualified followers for members whose followers changed (`UstaadFollowChangeSource`; the D2
    contract: an `ustaad_events` row `entity_type = member`, `entity_id` = followee, `kind` = `followed|unfollowed`;
    D2 is not on main, tests use a double); nightly ring check → `reconcileUstaadCounters` (one `UPDATE … FROM
(aggregate)`, drift → `counter_drift` event + `ustaad_counter_drift {members}`; `posts` left to D) →
    `refreshUstaadCounters30d` (best answers chosen from `best_chosen` events, helpful votes received) → qualified
    followers stored in `ustaad_member_counters.qualified_followers` (level recompute when it changed) → level
    recompute → `awardUstaadBadges` (held = every award incl. revoked, so a staff revoke is final; event, analytics and
    notice only on an inserted row; badge name in the member's language; a "tag" = the question's work or vehicle
    code) → evidence purge. No pg-boss queue: the worker's timers with a busy flag and idempotent SQL.
  - **Voucher trust (security review 2026-11-26):** `vouchRefusal()` refuses `VOUCH_NOT_TRUSTED` unless the voucher is
    `verified` and `active`. `ustaadVoucherLostTrust()` (called by staff revoke and by F2's ban in `applySanction`): the voucher's
    requested vouches expire, given vouches are revoked (`voucher_untrusted`, recommendations follow), vouchees with an
    open request in review get `evidence_withdrawn`, and a verified vouchee whose approved verification no longer has
    enough evidence gets a new `in_review` re-check row (`recheck_queued` event) for staff.
  - **Web:** Partners › Applications notice (`UstaadMechanicNotice`: count from `GET
/admin/ustaad/verifications/open-count`, city scoped, shown only to `ustaad:verify` staff while access is `open`,
    link `/admin/ustaad?section=verify` for G2's queue); the "Apply as a mechanic" page title, eyebrow and lead use
    `ustaad.join` copy while access is `open`. UI state audit rows `API-USTAAD-JOIN`, `API-USTAAD-WELCOME`, `API-USTAAD-ME`,
    `API-USTAAD-PARTNERS-STATUS`, `API-USTAAD-ATTEST`, `API-ADM-APPS-USTAAD` (API mode, `model-api.ts`, chunk G).
- **Not built yet (B):** QR on the card (no new dependency), coach-marks on the other five controls (their screens
  belong to C–E), SR-6 shop photo, link delivery by WhatsApp/SMS, new-device signal and forced re-OTP (Q-UB1), the
  profile/choices web screens (API only), screenshots.

## 21c. Workstream C as built (2026-11-26, partial: API done, web UI not started)

- **Shared:** `packages/shared/src/ustaad/dto/qa.ts` (strict `AskQuestionDto` / `AnswerDto` / `BestAnswerDto` /
  `AnswerPartsDto` / `QuestionListQueryDto` / `LearnProgressDto` and the views), `ustaad/public-code.ts`
  (`ustaadPublicCode('UQ'|'UJ'|'UR', city)`: RFC 4648 base32, because the DB CHECKs use `[A-Z2-7]`, unlike the
  Crockford marketplace codes in `ids.ts`). A voice-only question stores the title `…` (`VOICE_ONLY_TITLE`; the column
  is NOT NULL) and every view returns `title: null` for it.
- **Repositories** `packages/db/src/repo/ustaad/qa.ts`, `learn.ts`: ask (idempotent on `(asker, idemKey)`, UQ code
  with retry on collision, `screenUstaadContent` hook, `question_waiting` to ≤ `qa.notify_ustaads` verified Ustaads of
  the city with a matching speciality, most helpful first, never blocked pairs); voice notes must be the caller's own
  verified audio in the `media` bucket within `qa.voice_max_s` (`USTAAD_MEDIA_INVALID`); `reach: state` only while
  `general.all_state` is on (`USTAAD_REGION`); EV questions default to the `ev_hv` safety tag. Answer gate:
  `USTAAD_CANNOT_ANSWER` for a Chhotu (unless `qa.apprentice_can_answer`), a restricted member or the asker;
  `counts_for_levels = false` while the author is `apprentice`/`ustaad_pending` (no Izzat until B's back-fill);
  first visible answer moves `open → answered` (conditional UPDATE with version). Helpful: one row per voter (PK,
  `ON CONFLICT DO NOTHING`), `USTAAD_SELF_VOTE`, counters by conditional increments, `helpful_received` Izzat only for
  counting answers. Best answer: asker only (others 404), answer of the same question, `USTAAD_ALREADY_SOLVED` 409 on a
  second pick or a race, `USTAAD_WEEKLY_CAP` past `qa.best_per_week` in 7 days (counted from `ustaad_events`),
  `best_answer` Izzat + `recomputeUstaadLevel`, `ustaad.best_answer` notice. Parts: the best answer's author sets ≤ 5
  live products (`USTAAD_NOT_BEST`, `USTAAD_PART_INVALID`). Reads: removed questions, blocked pairs (either way) and
  questions outside the viewer's city (unless state-wide) are 404 / not listed; keyset cursor; no phone selected.
  Learn: courses + resources + my progress; a hosted video completes at ≥ 80 % of `duration_s`, seconds never go down;
  external links self-marked, `learn.self_mark_daily_cap` a day (IST); a first completion bumps `videos_watched`,
  records `video_completed` Izzat (idempotent) and recomputes the level once.
- **Review fixes (2026-11-26, lead review MEDIUM):** one write guard `assertUstaadMemberCanWrite` (status `active`
  and `restricted_mode = none`, else 403 `USTAAD_RESTRICTED`) on ask, answer, helpful, best answer and parts;
  restricted members still read. Learn progress for hosted videos is a heartbeat `deltaSeconds` (1–300): the server
  credits at most the time since the row's `updated_at` on the DB clock (`now() - updated_at`, touched on every
  write); only the first heartbeat gets a 30 s slack, so the gaps telescope and the total never exceeds the time since
  the first write + 30 s, however many heartbeats are sent (second review fix); a jump to the end never completes a video (no new column, no migration). First completions of hosted videos and self-marked
  links share one daily cap, `learn.self_mark_daily_cap` (IST day; Q-U-C1 asks whether videos need their own setting).
- **API** `apps/api/src/routes/ustaad/qa.ts` (mounted in `routes/ustaad/index.ts`): `GET/POST /ustaad/questions`,
  `GET /ustaad/questions/{code}`, `POST …/{code}/answers`, `POST …/{code}/best`, `POST /ustaad/answers/{id}/helpful`,
  `PUT /ustaad/answers/{id}/parts`, `GET /ustaad/learn`, `PUT /ustaad/learn/{id}/progress`; `requireUstaadMember` on
  every path; rate rules `questions` 10/day, `answers` 30/day, `votes` 100/day, `learn` 120/h, reads `memberReads`.
- **Tests:** `packages/db/test/ustaad-qa.test.ts` (20), `apps/api/test/ustaad-qa-api.test.ts` (5: role leak,
  end-to-end flow, strict bodies, 11th question → 429, Learn).
- **Not built yet (next):** web screens (`/ustaad/ask`, composer sheet with hold-to-talk recorder and photo picker in
  `components/ustaad/media/*`, `/ustaad/q/[code]` chat-bubble thread with Listen, `/ustaad/learn`), `ustaad.qa.*` /
  `ustaad.learn.*` locale strings, question **photos** (no table: needs a `ustaad_question_media` /
  `ustaad_answer_media` migration after 0093 and a host line in `readableUstaadMedia`), the widening job after
  `qa.widen_after_h` and auto-close after `qa.auto_close_days` (worker), admin CRUD for courses/resources, the seed
  "How to use Ustaad Network" course, vehicle-model picker data, and a Hindi `topic` placeholder for
  `question_waiting` (today the notice receives the work/segment **code**; it must be the localized label).

## 21d. Workstream D part 1 (feed) as built (2026-11-26, branch `worktree-agent-af781c8d402431a61`, no migration, no UI)

- **Shared:** `ustaad/dto/feed.ts` (strict `CreatePostDto` with the shape of every kind and template: text needs a
  body or a fix log; voice/photo/video/document/mixed need media; poll 2–4 options only on a poll; link only on a link
  and only a `safeLinkUrl`; fix log = symptom + fix (cause optional); before/after = photo post with a before and an
  after role; roles only there; no duplicate media or tags; `bodyOriginal` only with a correction; `status`,
  `authorId`, `contentType`, counters never accepted), `CreateStoryDto`, `CommentDto`, `ShareDto`, `PollVoteDto`,
  feed/page/tag queries and the views); `ustaad/links.ts` (`safeLinkUrl`: http/https, ports 80/443, no user-info, no IP
  literal or local names; `linkDisplayHost`: registrable domain in punycode from a small multi-part suffix list,
  AT-SSRF-3); `ustaad/feed-score.ts` (`feedScore`, `wilsonLowerBound`, `rankFeed`, § 9.5; post views are not counted
  yet, so the helpful term is Wilson of likes + saves over max(views, likes + saves)).
- **Repositories** `repo/ustaad/{feed-common,posts,stories,comments,reactions,tags,previews,feed}.ts`. One
  visibility rule (`postVisibleTo` / `visibleUstaadPost`) for every by-id read and write: own `visible|held`, else
  `visible`, author active with no restricted mode, no block either way (SR-35), stories only until `expires_at` on
  the DB clock; mutes hide authors in lists only. Create post: member row locked, `posts.types.*`, `posts.per_day`
  (IST day, stories excluded; API answers 429 `USTAAD_DAILY_CAP`), links only after `mod.links_min_account_days`
  (`USTAAD_LINKS_LOCKED`) and not on the admin `link_domain` list incl. parent domains (`USTAAD_LINK_BLOCKED`), media
  own + verified + live bucket + **not attached anywhere else** (`USTAAD_MEDIA_INVALID`; a story purge can never
  delete a post's file), kind shape and caps (`USTAAD_MEDIA_LIMIT`, `USTAAD_MEDIA_TOO_LONG` against
  `posts.video_max_s` / `media.voice_max_s`; video may carry one poster image), curated tags (slug, Hindi name or
  alias; merged → target; inactive/unknown → `USTAAD_TAG_UNKNOWN`; distinct > `tags.max_per_post` →
  `USTAAD_TAG_LIMIT`), `screenUstaadContent` on every readable text **including the pre-correction original**
  (`ustaadScreenText`; the original is stored only with a correction, `ustaadStoredOriginal`) → `held` / refused
  `USTAAD_CONTENT_BLOCKED`; post + media + counter row + poll + tags + `ustaad_events` + `ustaad_post_created`.
  Members post `ugc` only. Delete = author `→ hidden_author` (machine, conditional UPDATE with version).
  Likes / saves / poll votes / story views are rows with `ON CONFLICT DO NOTHING RETURNING` and conditional
  counters (`> 0` guard down); likes never touch Izzat or levels; `feed.show_like_counts` off → `likes: null`; the
  save count is shown to the author only. Comments: text / voice / photo (own unused media), one level of replies
  (`USTAAD_REPLY_DEPTH`), idempotent, screened, not on stories, author hides (`→ hidden_author`, counter back).
  Stories: one photo / voice / video (+ poster), `stories.hours`, `stories.min_account_days` (`USTAAD_STORIES_LOCKED`),
  rings = mine, followed, my city; "Seen by N" for the owner only; `expireUstaadStories` (worker every 5 min) moves
  `visible → expired` and sets the media `purge_after = expires_at + stories.purge_grace_hours`.
  Feed: For you candidates (window `feed.window_days`; followed, followed tag or own speciality segment, my city,
  mine; not muted; ≤ 1000) ranked with the admin weights (≤ 300 ids); Following keyset `(created_at, id)`; Saved and
  tag pages keyset; hydration re-checks visibility per page. Tags: search (slug prefix, names, alias), tag page,
  follow / unfollow, suggestions. Previews: one row per sha256(URL), refreshed after 7 days, only `ok` shown.
- **API** `routes/ustaad/feed.ts`: `GET /ustaad/feed?tab=for_you|following`, `POST /ustaad/posts`,
  `GET|DELETE /ustaad/posts/{id}`, `POST|DELETE …/like`, `…/save`, `POST …/share` (channel → teaser token),
  `GET|POST …/comments`, `DELETE /ustaad/comments/{id}`, `POST /ustaad/polls/{id}/vote`, `GET /ustaad/saved`,
  `GET|POST /ustaad/stories`, `POST /ustaad/stories/{id}/view`, `GET /ustaad/tags`, `GET /ustaad/tags/{slug}`,
  `PUT|DELETE /ustaad/tags/{slug}/follow`, `POST /ustaad/tag-suggestions`, `GET /ustaad/shares/{token}` (member →
  post id) and the **public** `GET /ustaad/s/{token}` mounted before the gate (rate limited per IP, `noindex`,
  `{ kind: 'ustaad_post' }` only, 404 unless `ustaad.access = open`, the HMAC token is genuine and the post is live).
  Share tokens: `{post id}.{HMAC-SHA256/128}` base64url with `USTAAD_SHARE_SECRET` (unset → 503
  `SHARE_UNAVAILABLE`). For you snapshot: `FeedSnapshotStore` (Upstash, else memory), 10 min, key per member, cursor
  = position; an expired snapshot answers 410 `USTAAD_FEED_EXPIRED`. Link previews:
  `apps/api/src/ustaad/link-preview/` (no DB access): `safeLinkUrl` per hop, one DNS resolution, every address
  checked (`BlockList`: private, loopback, link-local/metadata, CGNAT, documentation, multicast, ULA, 6to4, NAT64,
  Teredo, every IPv4-mapped IPv6), the socket's `lookup` pinned to the checked address, ≤ 3 redirects, 3 s total,
  512 KB, `text/html` only, og:title / og:description (or `<title>`) as plain text; started after the post commits,
  failures stored as `failed` / `blocked` and never shown.
- **Notices:** `ustaad.reply` to the post author and the parent comment's author (grouped per post per IST day,
  link `/ustaad/p/{postId}`); `ustaad.likes_digest` on the first like of the day per post (count at that moment).
  Never for one's own action or for held content. **Analytics:** `ustaad_post_created`, `ustaad_story_created`,
  new `ustaad_comment_posted {commentId, postId, input, reply}`; likes, saves, shares and story views stay client
  events and write `ustaad_events` rows.
- **Tests:** `packages/shared/test/ustaad-feed.test.ts` (14), `packages/db/test/ustaad-feed.test.ts` (31),
  `apps/api/test/ustaad-link-preview.test.ts` (8: AT-SSRF-1, AT-SSRF-2, parsing, pinned connector on a local
  server), `apps/api/test/ustaad-feed-api.test.ts` (role leak in staff preview and open, flow, snapshot cursor,
  daily cap 429, link preview after commit, stories gate, teaser, SR-34 sweep).
- **Not done (next):** web UI (composer, post card, story ring/viewer, players, Saved, tag page, teaser page) with en
  - hi strings; the og:image through the image pipeline; the preview fetcher as a separate process; the HMAC-signed
    "leaving MechDost" warning page (SR-23: today the post view carries the URL and its registrable domain); the
    real-Postgres race suite for double like / like–unlike (PGlite runs them sequentially); a DB trigger for ≤ 5 tags
    (the repository enforces it; tags are only written in the create transaction); post view counting; the nightly
    `ustaad_counter_reconcile` job; a true daily likes digest job; promotions in the feed, follow/connect, blocks/mutes
    writes, messages and Discover (workstream D part 2).

## 21d. Workstream D2 as built (2026-11-26: follow, connect, block/mute, messages, Discover, promotions; API only)

- **Migration `0097_ustaad_social`** (written, not applied; D1 may take 0095 and F2 0096, the lead renumbers):
  `ustaad_thread_members` (per side: `last_read_at` read receipt, per-thread `muted`; separate from the thread so a
  read never moves the thread's `version`), `ustaad_messages.held_reason_code` (`screened | scam_phrase`),
  `ustaad_threads.blocked_from` (the status before a block; CHECK: set exactly while `blocked`),
  `ustaad_daily_counters` (`member_id, kind, day` IST; kinds `promo_served | profiles_served | follows |
new_threads | connect_requests`; one conditional upsert `n + k where n < cap`, never count-then-insert),
  `ustaad_promo_hides` (member, promotion, reason code). RLS on, grants revoked, `touch_updated_at` triggers,
  rls-inventory `none`. The thread machine gained `declined → blocked`, `blocked → requested | declined` (unblock
  restores `blocked_from`; a request never becomes `open` without the receiver accepting).
- **Connections:** A's unique `(low_id, high_id)` index already allows one row per pair (stronger than a partial
  "one pending" index), so a re-request is a conditional UPDATE on that row; crossed requests become one accepted
  connection. Security review fixes (2026-11-26): restricted members cannot ask (403 `USTAAD_RESTRICTED`); the same
  requester waits `limits.connect_cooldown_days` (default 7) after a decline, withdraw or removal (409
  `USTAAD_CONNECT_COOLDOWN`; the other member may ask at once); `limits.connect_requests_per_day` (default 20) through
  the atomic daily counter (429 `USTAAD_DAILY_CAP`); the connect notice is deduped per pair and requester, so request
  → withdraw → request loops notify once.
- **Follows:** idempotent insert, counters only from inserted/deleted rows (`> 0` guard), no self-follow (422), 404
  when blocked or the member left. Daily cap `limits.follows_per_day` through the atomic counter after a real insert;
  unfollow does not give the slot back. `followed` / `unfollowed` events on the followee (workstream B's level job reads
  them; `ustaad_follows.counted` untouched), follower Izzat keyed on the pair (no farming), one `ustaad.follow` notice
  per follower and member ever. Remove follower.
- **Blocks and mutes:** a block (any member, even restricted) removes follows both ways, moves the connection to
  `removed`, the thread to `blocked` (remembering `blocked_from`) and ends open mentorships with reason `blocked`, in
  one transaction; mutual 404 on profile relationship, follow, connect, threads and media. Unblock restores the thread
  only when no block is left either way. Mutes are a row each, listed with the blocks (never who blocked me).
- **Messages (SR-33–35):** `POST /ustaad/threads` = first message, text only; account on the network ≥
  `limits.dm_min_account_days` (403 `USTAAD_DM_TOO_NEW`); `limits.new_threads_per_day` (atomic, 429); receiver
  `dm_mode` `nobody` → 403 `USTAAD_DM_NOT_ALLOWED`, `everyone` or an accepted connection → open at once, else a request.
  While `requested`: one message only (409 `USTAAD_DM_PENDING`), a link → 422 `USTAAD_DM_LINK`, phone numbers, emails
  and UPI ids masked to "#" (`dmTextCheck`, `shared/ustaad/social-rules.ts`), no media. Every message passes
  `screenUstaadContent` (`block` → 422 `USTAAD_CONTENT_BLOCKED`, `hold` → held) and the scam signals (fee phrase, UPI,
  pay-app ask, admin `scam_phrase` list) → held: invisible to the receiver, no notice, `last_message_at` unchanged,
  shown to the sender as pending (a thread whose request message is held does not exist for the receiver, gated on content: the requester's latest
  message must be unheld while `requested`, an unheld message must exist otherwise; a re-request after a decline resets
  `last_message_at`; not
  listed, 404 to open or accept); its media is not readable by the receiver (`readableUstaadMedia` now requires an
  `open` thread and an unheld message). Voice/photo only the sender's own verified audio/image in `media`; a shared
  post must be visible to both. Read receipts, per-thread mute (no notice), one `ustaad.message` bell entry per thread
  and IST day. Report hook for F2: `ustaadMessageReportTarget(tx, reporterMemberId, messageId)`.
- **Staff read (SR-38):** `GET /admin/ustaad/threads/read?reportCode=&reason=` (`ustaad:moderate`, staff session,
  city scoped through the report's city): only an open or in-review report on a message of the thread; reason codes
  `report_review | legal_order | child_safety`; every read writes `audit_log` `ustaad.dm_read` and an event.
- **Discover (§ 9.4, SR-37):** `GET /ustaad/discover?q=&work=&level=&city=` ranks by Wilson of helpful answers, best
  rate (30-day best answers weigh double, approximating the 90-day half-life from B's counters), distinct askers,
  trust, new-member boost; followers weigh 0; `discover.new_slots` per page; 20 a page, position cursor, no total;
  `discover.profiles_per_day` through the atomic counter (429); opted-out members only for a typed search;
  restricted/banned/left/blocked never. Distance bands from E's `ustaadDistanceBands` only when
  `USTAAD_LOCATION_SECRET` is set (new config variable, `.env.example`). `GET /ustaad/discover/tags` (popular tags in
  reach, 14 days) and `GET /ustaad/discover/top-posts` ("Top this week": visible member posts in my city, saves × 2 +
  likes, no stories, no blocked or muted authors) read A's/D1's tables only. § 9.5 says "no trending tab" for the
  feed; this is a Discover section and is queued as Q-U-D2a.
- **Promotions (serve side; CRUD is G1's `/admin/ustaad/promotions`, `ustaad:promotions`, audited):**
  `GET /ustaad/promotions?slot=` (`feed | stories | search | jobs | learn`; `answer_parts` is not a served slot) returns
  one promotion or null with the locked label `{ en: 'Sponsored', hi: 'प्रायोजित' }` (`SPONSORED_LABEL`) and `href`, a
  MechDost internal path built on the server (`promotionHref`: `/shop/{slug}`, `/shop?category=`, `/offers`,
  `/ustaad/learn…`, or a stored internal path) re-checked by `isSafeInternalPath`; no redirect endpoint exists.
  Rules: `promo.enabled` + `promo.place.<slot>`, `live` or `scheduled` inside its window (G1 has no
  `scheduled → live` move, so a scheduled promotion goes live by its start time), city/speciality targeting only, never on a
  member's first day or in restricted mode, never once hidden, `promo.daily_cap_per_member` (atomic).
  `POST …/{id}/click` answers the same link; `POST …/{id}/hide` takes a reason code. The feed's `promo.every_n` spacing
  is the feed's job (D1/D2 feed).
- **Events:** server events added `ustaad_unfollowed`, `ustaad_connection_changed`, `ustaad_member_blocked`,
  `ustaad_member_muted`, `ustaad_message_thread_changed`, `ustaad_message_sent {kind, held}`,
  `ustaad_dm_read_by_staff`, `ustaad_discover_served`, `ustaad_promo_served`, `ustaad_promo_clicked`,
  `ustaad_promo_hidden_by_member` (ids and codes only). Settings added `limits.connect_requests_per_day`,
  `limits.connect_cooldown_days` (en + hi labels).
- **Rate rules (SR-43):** follows 20/day, connects 20/day, new threads 20/day, messages 120/h, search 60/min, reads and
  promotion calls the member read rule, block/mute/unfollow the membership write rule, staff read 300/min. Member guard
  and limits are bound to each file's own prefixes (`onUstaadPaths`).
- **Tests:** `packages/shared/test/ustaad-social.test.ts` (12), `packages/db/test/ustaad-social.test.ts` (31: double
  follow, double accept, crossed requests, block cascade, unblock restore, AT-DM-1, masking, held scam message and its
  media, parallel caps at cap − 1, staff read via report only, Discover ranking/opt-out/cap, promotions label/window/
  cap/hides/targeting), `apps/api/test/ustaad-social-api.test.ts` (11: role leak on 27 routes for a non-member and
  under staff preview, strict bodies, flow with no phone, block 404, AT-RATE-1, Discover, promotions, staff read by
  role). PGlite serialises transactions, so the parallel tests prove the single-statement caps but not a real
  interleaving; the real-Postgres concurrency run is owed (`TEST_DATABASE_URL`).
- **Not built (D2):** web screens (My network, message request, thread, Discover), mentorship routes (machine and
  table exist; block ends them), tag follows (`/ustaad/tags*` belong to D1), message delete/unsend, the feed's own
  promotion spacing, push channel tuning for `ustaad.message`, the Discover `area=` filter of § 8 (the strict query
  answers 400 to it today), a staff release path for held messages (F2: set `last_message_at`, send the notice),
  real-Postgres concurrency run. Known limits: restricted members may still follow, block and mute; the fixed rate
  rules (20 a day for follows, connects and new threads) sit in front of the admin caps, so raising a cap above 20
  has no effect until the rate rules read the settings. The `ustaad.follow` notice now reads "New followers:
  {count}" (en + hi) so a count of 1 reads naturally.

## 21e. Workstream E as built (2026-11-26, branch `worktree-agent-a53f6c8fce669739a`, no migration)

- **Pure rules** `packages/shared/src/ustaad/local.ts`: `noisyDistanceBand(metres, noiseUnit)` (± 25 % stable
  perturbation, band codes only); `pinChangeDecision` (first pin free; zero-metre save free; GPS worse than
  `loc.gps_max_m` → `USTAAD_PIN_GPS_WEAK`; move > `loc.big_move_m` without a GPS fix ≤ `loc.big_move_accuracy_m` →
  `USTAAD_PIN_FIX_REQUIRED`; `loc.pin_changes_per_day` / `_per_30d` → `USTAAD_PIN_LIMIT`, HTTP 429); `bandZone`
  (floor 5 locked, per-speciality cells banded, complementary suppression: while the hidden cells hold a small non-zero
  total the smallest visible cell is hidden too, and the total is rounded to 5); `jobScamSignals` (fee phrases en + hi,
  known UPI PSP handles even before a full stop, any other `handle@word` that is not an email, pay-app asks, plus the
  admin `scam_phrase` word list; text NFKC-normalised, format characters stripped, digits of every script mapped to
  ASCII for the filters only).
- **Repositories** `packages/db/src/repo/ustaad/{location,zones,jobs}.ts`: pin save in one transaction with the member
  row locked, region check (city centre + radius, else within 15 km of one of the city's PIN centres; fail closed →
  `USTAAD_REGION`), fixed per-member circle offset drawn once (0–150 m) and kept on moves, a real move clears the
  signboard check; `ustaadPairNoise` = HMAC-SHA256(secret, sorted ids) → [0, 1); `ustaadDistanceBands` skips hidden and
  home/roadside members (AT-LOC-3). Zone counts rebuilt under an advisory lock from active, unrestricted, verified
  (`zones.verified_only`) members with "count me" on and location not hidden, in enabled reach cities; staff reader
  exact, member reader banded; disabled city → no zones. Jobs: employer = workshop grant on the named workshop or a
  verified trade account (`USTAAD_EMPLOYER_REQUIRED`, re-checked on resume), attestation (`USTAAD_ADULT_ATTESTATION`),
  every free-text field (title, description, timing, area labels) through `jobScamSignals` + `screenUstaadContent`
  (signal → `pending_review`, reason `scam_phrase`, invisible to others), restricted or perk-frozen members can neither
  post, apply, resume nor move applications (`USTAAD_RESTRICTED`, `USTAAD_PERKS_FROZEN`), `jobs.enabled` off → 404 on
  every job surface except withdraw, closing / filling / expiring closes live applications with `job_closed`.
  **Job codes** use RFC 4648 base32 (A–Z, 2–7) because A's CHECK `ustaad_jobs_code_format` is `[A-Z2-7]{6}`, not the
  Crockford alphabet of `publicCode` (lead: decide whether to align the CHECK instead).
- **API** `apps/api/src/routes/ustaad/local.ts`: `GET|PUT /ustaad/me/location`, `POST /ustaad/me/location/signboard`,
  `GET /ustaad/zones?city=` (verified members, bands), `GET /ustaad/jobs` (cursor), `GET /ustaad/jobs/{code}`,
  `POST /ustaad/jobs`, `POST /ustaad/jobs/{code}/pause|resume|close|fill`, `POST /ustaad/jobs/{code}/apply`,
  `POST /ustaad/applications/{id}/seen|shortlist|reject|hire|withdraw`. DTOs `packages/shared/src/ustaad/dto/local.ts`.
- **Worker** (`apps/api/src/worker.ts`): `ustaad_zone_counts` nightly at 02:00 IST; `ustaad_jobs_expire` every 10 min.
- **Not done in E (next):** web UI (Pin my garage, area map, jobs list / detail / apply sheet / applicants), en + hi
  `ustaad` locale strings for those screens, `GET /ustaad/jobs/mine`, `PATCH /ustaad/jobs/{code}`, staff
  `GET /admin/ustaad/zones` and `GET /admin/ustaad/members/{id}/location` (audited), exact-pin display to connections
  (needs D's connections), "near you" lists (D's Discover calls `ustaadDistanceBands` with a server secret; a
  `USTAAD_LOCATION_SECRET` env variable is still to be added to config and `.env.example`), notifications on
  application moves, AT-LOC-1 trilateration simulation.

## 21f. Workstream F2 / F3 as built (2026-11-26, migration `0096_ustaad_moderation_f2`, unapplied)

- **Migration 0096** (0094 is B's identity seed, 0095 left for another agent): report clock `removal_36h` (Rule 3(1)(b)
  removal grievances, setting `mod.clock_removal_h` 36), report source `auto_safety` (classifier), reason
  `ncii_impersonation` (2 h, seeded en + hi, admin-editable), media reject reason `safety_block`,
  `ustaad_members.restricted_until` (+ CHECK: only with status `restricted`). New settings: `mod.clock_removal_h`,
  `mod.rules_reminder_days` (90), `mod.false_report_strike_after` (3).
- **Screen** (`screenUstaadContent`, A's signature; rules in `@mechdost/shared/ustaad/moderation`): one normaliser on
  both sides (NFKC, format characters stripped, every script's digits → ASCII); banned words, admin scam phrases,
  built-in illegal-modification phrases, UPI ids, pay-app and OTP asks, phone numbers, number plates, links, denied
  link domains, media flagged by the classifier. **Block** (the author can fix it): a phone number in a post, story,
  question or answer; a plate in any public text; any link from an account younger than `mod.links_min_account_days`;
  a denied domain. **Hold**: everything else above, a phone number in a comment, message or job, and pre-moderation of
  media **posts, stories and comments** from accounts younger than `mod.premod_account_days` or with fewer than
  `mod.premod_first_posts` visible media posts (voice notes on questions and answers are never pre-moderated:
  verification is never a wall). Callers open the queue entry with `openUstaadAutoHoldReport` (C answers and
  questions, E jobs wired; D must do the same). Questions have no `held` status: a held question stays open, gets no
  Ustaad notices and sits in the queue.
- **Reports** `POST /v1/ustaad/reports` (member, 20 a day): one open report per reporter and item (repeat = same
  code), no self-report (`USTAAD_REPORT_SELF`), inactive reason `USTAAD_REASON_OFF`, a message only by its thread's
  members (404 otherwise). **Qualified reporter** (verified, account ≥ 30 days, no active `false_report` strike):
  a `minor` report sets the author's `restricted_mode = minor_report` until a decision; an `ncii_impersonation`
  report hides the item at once (`visible → held`). From anyone else both are only queued (minor reports and
  classifier hits sort first). Dismissed minor **and** NCII reports count toward the `false_report` strike.
- **Staff routes** `/v1/admin/ustaad/moderation/*` (not `/admin/ustaad/reports…` as § 8 first said): `GET reports`
  (`?queue=open|appealed|decided&city=&cursor=`), `GET reports/{code}`, `POST reports/{code}/act`
  (`keep | remove | warn | restrict | ban`), `POST reports/{code}/ban/confirm`, `POST reports/{code}/appeal`
  (links the author's `REQ-…` ticket), `POST reports/{code}/appeal/decide`, `GET reports/{code}/thread?reason=`
  (DM read, audited `ustaad.dm_read`), `POST takedowns` (`ustaad:takedown`). Reads `ustaad:moderate | ustaad:read`,
  writes `ustaad:moderate`; city scope of the permission; texts masked (`[phone]`, `[email]`); no phone, no export.
- **Decisions:** keep (dismiss; held → visible, held job → open), remove (archive + media `removed_archived` + objects
  moved to the evidence bucket by the API), warn (strike, no Izzat), restrict (`mod.restrict_days`), ban N days /
  permanent: from `mod.four_eyes_from_ban_days` (or permanent) the first call proposes (`ustaad_events`
  `ban_proposed`) and a different staff member confirms (`FOUR_EYES` for the proposer). Staff never decide on their
  own content (`SELF_MODERATION`). A sanction never shortens or dates a stronger one (a permanent or later-ending
  ban; a frozen `review` or `minor_report` account is never given an end date).
- **Appeals (§ 7.6 names ruled):** `upheld` = the decision stands; `overturned` = reversed: content and media restored,
  strikes overturned (Izzat `reversal`), and the member's status **recomputed** from the ban/restrict actions that
  still stand on other reports (only this report's sanction is lifted); a frozen `review` (POCSO) account is never
  lifted by an appeal. Decided by someone who took no part (`FOUR_EYES`). A legal removal (source `legal_order` or a
  `takedown` action) can be overturned only with `ustaad:takedown`, and nothing is restored while any archive row of
  the item is on legal hold (`USTAAD_LEGAL_HOLD`). Removed jobs stay removed (terminal in § 7.7).
- **Takedown fast path:** one call opens the report on the right clock (3 h orders, 2 h NCII, 36 h removal
  grievance), removes and archives the item (legal orders `legal_hold = legal_order`, also applied to media an earlier
  removal archived), moves the objects (main key and image variants) out of the live bucket, audits the reference and
  returns `seconds`. AT-TAKEDOWN-1 is proven for **signed media URLs of a removed post** (DB + API tests); the
  question, answer, comment, job and message branches of `targets.ts` are written but not yet exercised by a test, and
  feed, profile, search, tag pages and share teasers do not exist yet (D): all must join the test.
- **Child safety:** `ImageSafetyClassifier` adapter (`apps/api/src/ustaad/safety/classifier.ts`; `NoOp` default,
  `HashListImageSafetyClassifier` test double) runs on images in the verify step: a hash match copies the private
  copy to the evidence bucket, marks the media `rejected` / `safety_block` / `legal_hold = pocso`, freezes the account
  (`restricted`, `review`, no end date), opens a 2 h `auto_safety` report and notifies every `ustaad:takedown` holder
  (POCSO task, runbook § 6); a score ≥ `mod.nsfw_hold_score_pct` writes `safety_flagged` and the screen holds posts
  using the file. Videos and voice notes are not classified in v1 (no posters without transcoding).
- **Jobs (worker):** `ustaad_report_clock` (every minute: `staff.ustaad_report_overdue` at 50 % and 100 %, once per
  stage; expired bans and restrictions end), `ustaad_removed_archive_purge` and `ustaad_rules_reminder` (hourly tick;
  the reminder once per `mod.rules_reminder_days` period, notice version = period number).
- **F3:** `docs/runbooks/ustaad.md` (grievance desk, rota, clocks, takedown, agency 72 h, POCSO, CERT-In 6 h / DPDP 72 h
  with en + hi templates, ICT logs, archive, reminder, tabletop drill, SSMI); `docs/research/processors.md`;
  Community Rules page `/policies/community-rules` (en + hi, admin-editable as `policy.community_rules`; the
  reminder notice links there).
- **Screen patterns (advisor + security review, 2026-11-26):** a phone number is **blocked** in public text only
  when written like one (contiguous or split by spaces, optional +91 / 0); any other phone shape (dashes, mixed
  separators, `+91-98765-43210`, `9-8-7-6-5-4-3-2-1-0`, also part numbers such as `94109-12000`) is `phone_like` and
  **holds**; staff masking uses the broad pattern, so no number reaches a staff screen. Plates need a valid state
  code: one token (`CG04AB1234`) or spaced/dashed capitals block (`number_plate`); separated lower case
  (`cg 04 ab 1234`, also Hinglish like "ka 97 cc 2018") is `plate_like` and holds. Links: scheme, `www.` or a bare
  domain with a TLD people rarely type by accident; short redirector/messaging domains (`t.me`, `wa.me`, `bit.ly`,
  `tinyurl`, `goo.gl`, `rb.gy`, `cutt.ly`) always count, also spelled `t . me`, `wa dot me`, `bit (dot) ly`; the
  admin `link_domain` denylist runs on all text (dotted spellings too) and blocks. UPI / pay-app patterns are E's
  (`hasUpiId`, `hasPayAppAsk` in `local.ts`). The built-in illegal-modification phrases are a floor; the admin
  `banned` list adds to them (G1).
- **Not done (F), first:** a staff route to view reported or held media (blurred, audited) — pre-moderated media posts
  cannot be reviewed in the console until it exists (G2 needs it); `keep` on a held answer or question does not run the
  publish side effects (question → answered, Izzat, Ustaad notices); plan tests not yet written: restricted-mode
  effects (no events, recommendations, promos, jobs, messages), AT-UP-7 (EICAR in a new account's PDF post held), a
  DB-level screen test with admin word lists; the state-audit row for `/policies/community-rules`.
- **Not done (F):** consent toggles per purpose with "withdrawal stops the job" (B3's "Settings and my choices" owns
  the route; the purposes and notice version exist), the `ustaad_grievance` support-ticket kind with its own timers
  (grievances enter through staff intake `POST …/takedowns` with `grievance_removal` meanwhile), ICT log retention on
  the server (Q-UF1), a staff read of evidence (two-person access is an ops step), D's surfaces in AT-TAKEDOWN-1, the
  G2 console UI.

## 21c. Workstreams C + E web screens as built (2026-11-26)

- **Routes** (`apps/web/src/app/[locale]/ustaad/`): `ask` (filters All · For you · Mine · No answer yet as links,
  `?filter=`; keyset "Show more"), `ask/new` (the composer as a sheet with Close; Home's mic opens it), `q/[code]`
  (thread; malformed codes 404 before any request), `learn`, `me/location` (Pin my garage; **`/ustaad/pin` redirects
  here**, Home links updated), `area`, `jobs` (`?role=`), `jobs/[code]`, `jobs/new`. All server shells with one client
  island each, inside A's layout (shared frame, no reload; noindex).
- **One client seam** `apps/web/src/lib/ustaad/client.ts`: real sign-in builds load `api-client.ts` (signed calls, every
  answer checked with the shared schemas, response shapes in `packages/shared/src/ustaad/dto/responses.ts`); the browser
  demo (staff preview, no API) loads `apps/web/src/demo/ustaad.ts`, labelled **Sample data** on every screen, kept in
  memory only. Both are dynamic imports: no storefront bundle carries them.
- **Media components** (`components/ustaad/media/`, for D to reuse): `VoiceRecorder` (hold to talk, release to finish;
  tap to start / tap to stop on the same button for keyboards, screen readers and single-pointer use; timer; auto-stop at
  the limit; under 0.7 s discarded; playback with native controls; record again / remove; Opus WebM → Ogg → MP4 by
  `MediaRecorder.isTypeSupported`, declared as the plain MIME; duration measured on the phone), `ImagePicker` (camera
  or gallery, canvas re-encode = EXIF/GPS stripped, upright, long edge ≤ 1600 px, WebP else JPEG), `UploadProgress`
  (native progress + words), `VoiceNote` (signed URL fetched on tap, `preload="none"`, no autoplay), `ListenButton`
  (browser `speechSynthesis`, hi-IN for Devanagari or the Hindi page, en-IN otherwise; never starts by itself). Upload =
  declare (sha256 on the phone) → PUT with progress (XHR) → complete; multipart (> 16 MB) is left to D.
- **Q&A:** composer = big mic first, one typed line (title) and "More details" with `SmartCorrection` (the corrected
  field is the body, so `bodyOriginal` matches the DTO), vehicle tiles (segments + EV) and work choices (radio groups, each with "Not sure"), one
  primary "Send question"; voice uploads on send with progress; the idempotency key is kept across retries. Thread =
  navy question bubble (voice note, Listen, chips), safety note for brake/steering/fuel/airbag/EV tags, answers as chat
  bubbles with the best answer first (badge, "Parts used in this fix" linking to `/shop/{slug}`), Helpful once
  (`aria-pressed`, stays focusable; a second press does nothing), "Mark as best" only when the API says `can.chooseBest`, answer composer (voice or
  text) only when `can.answer`, otherwise the "Ustaads answer here" note; the disclaimer under the answers.
- **Learn:** courses with "N of M lessons done" and a bar, short videos; data saver on by default (this phone only,
  `localStorage`, `ustaad_data_saver`): nothing loads before Play; off loads the first picture (`preload="metadata"`).
  Hosted video: heartbeat `deltaSeconds` every 15 s while playing (`learn-meter.ts`: only play time, seeks pause the
  clock, fractions carried, ≤ 300); `ustaad_video_played {secondsBand}` once per player; `ustaad_learn_completed` on
  the first completion. External links open in a new tab and can be self-marked (`USTAAD_DAILY_CAP` shown in words).
- **Pin my garage:** shows where the member works (from `GET /ustaad/me`, read-only: `PATCH /ustaad/me` is not
  mounted yet, B); "Use my location" with the accuracy circle on a lazy MapLibre map, drag / tap / four arrow buttons
  (~10 m each); source is `gps` while the pin stays inside a good fix (≥ 30 m), else `manual` and a landmark is
  required (`pinSource`); readings worse than 100 m (`loc.gps_max_m` default) say "rough location only"; the three
  choices start off; "Show my exact pin" and its audience are hidden for home/roadside members; "This is my garage" /
  "यही मेरा गैराज है" saves; API errors (`USTAAD_PIN_LIMIT`, `_FIX_REQUIRED`, `_GPS_WEAK`, `USTAAD_REGION`) in words;
  then the signboard photo and "Hide my location for now" / "Show my area again".
- **Area map:** stylised SVG of the zone cells (hexagons shaded by the server's band, numbered) plus the same zones as a
  list (the accessible view; tap for the per-work cells). Text is exactly the band: "Few mechanics nearby", "N+ mechanics"
  or "N mechanics"; nothing is summed. `USTAAD_VERIFIED_ONLY` → a lock card with one next action (pin your garage).
- **Jobs:** the anti-scam banner (`role="note"`) on the list, the job, and the post form; list with role filter links;
  detail with pay (₹ a month from paise), timing, experience, area (Hindi label when given), vehicles, the employer's
  18+ line, "Open till"; one primary "Apply with my card" opening a native modal `<dialog>` (Escape closes, focus back to
  the button; phone shared only when ticked; optional 30 s voice intro). The employer sees "Your job · status" with
  pause / open again / filled / close. Post form: fields with errors beside them, whole rupees → paise, the locked 18+
  box, posts as `employer.kind = trade`.
- **Copy:** `ustaad.qa`, `ustaad.learn`, `ustaad.local`, `ustaad.jobs`, `ustaad.labels` (levels, work, roles, safety,
  shared errors, sample note) and more of `ustaad.media`, en + hi (`test/ustaad-ce-view.test.ts` checks key parity).
- **Analytics:** existing client events only (`ustaad_voice_played`, `ustaad_video_played`, `ustaad_data_saver`,
  `ustaad_learn_completed`, the correction events) plus `data-track` on every control; question, answer, job and
  location events are server-side (spec 23 § 16).
- **Tests:** `apps/web/test/ustaad-media-core.test.ts`, `ustaad-ce-view.test.ts` (recorder MIME, photo fit, hold vs
  tap, watch meter, zone text and shade, projection, pin source, pay, copy parity); e2e `apps/web/e2e/ustaad-ce.spec.ts`
  (every screen, axe on `main`, signboard photo upload, apply dialog focus, post form errors, landmark rule) and
  `ustaad-ce-mic.spec.ts` (Chromium fake microphone: hold to talk, tap to talk, ask by voice and play it back, no CSP
  errors) and the
  Hindi crawl (`hindi-coverage.spec.ts`, ten `/hi/ustaad/*` pages).
- **Accessibility review (2026-11-26, aria / keyboard + modal / forms + media specialists):** recorder has one name
  ("Record voice note") with `aria-pressed`, one always-mounted live region for every outcome, focus kept across the
  mic ↔ recorded swap, pointer cancel handled and a hold released during the permission prompt cancels the start;
  vehicle and work choices are radio groups with "Not sure"; field errors sit beside their fields (`aria-invalid` +
  `aria-describedby`); busy buttons use `aria-disabled` (focus stays); writes refresh the thread without blanking it;
  close and filled ask first; the arrow buttons place a pin without GPS (keyboard path); map container `role="group"`;
  live regions use `empty:sr-only` (never `display: none`). Hosted videos have no captions yet (Q-U-CE7).
- **Membership gate:** every screen is wrapped in `MemberGate` (no membership → "join" card, `ustaad.shell.join*`).
- **Permissions-Policy:** `microphone=(self)` (decisions 2026-11-26).
- **Low data on the pin screen:** the map (MapLibre, style, tiles) loads only once there is a pin (GPS reading, an
  arrow press from the city centre, or a saved pin).
- **Not built (API gaps, queued Q-U-CE1…7):** question **photos** (no field in `AskQuestionDto`, no table) — the
  picker exists and is used for the signboard; the employer's **applicants list** and `GET /ustaad/jobs/mine` (no
  route lists applications; `POST /ustaad/applications/{id}/{action}` exists) — so no applicants screen; "already
  applied" state on a job (not in `JobDto`); posting for a **MechDost workshop** (needs a workshop picker); changing
  **shop vs home/roadside** on the pin screen (`PATCH /ustaad/me`, B); vehicle **model** picker (no data); video **size**
  on Learn (no bytes in `LearnResourceView`; duration is shown); zone **names** (cells are numbered "Area 1…").

## 21g. Workstream D web screens (feed + social) as built (2026-11-26)

- **Scope split (lead, 2026-11-26):** this pass built the feed, post cards, composer, comments, stories, post page, tag
  page, Saved, the member profile, the share teaser and the shell entries. `/ustaad/messages`, `/ustaad/network` and
  `/ustaad/discover` are built by a separate agent in their own files and namespaces (`ustaad.messages`,
  `ustaad.network`, `ustaad.discover`); the profile and the shell link to them.
- **Routes** (`apps/web/src/app/[locale]/ustaad/`): `/ustaad` (Home now shows the story ring and the feed islands),
  `create` (`?story=1` adds a story), `p/[id]` (uuid or 404), `saved`, `tags/[slug]` (`TAG_SLUG_RE` or 404),
  `u/[handle]` (**renamed from `/m/[handle]`**, brief 2026-11-26), `s/[token]` (`{22}.{22}` or 404). Server shells
  with one client island each, inside A's layout; `noindex`.
- **New read API for the profile** (the D2 routes had no read by handle): `GET /ustaad/profiles/{handle}` →
  `ProfileViewDto` (card, specialities, followers/following only when `feed.show_follower_counts`, posts, helpful and
  best answers, my relationship, null on my own) and `GET /ustaad/members/{memberId}/posts` (feed visibility rule,
  keyset, no stories; mutes do not hide a member's own profile). Both in `routes/ustaad/social.ts` behind the gate and
  member guard, member-read rate rule; repository `repo/ustaad/profile-view.ts`; 404 for unknown, left, banned,
  restricted or blocked either way. Tests: `packages/db/test/ustaad-profile-view.test.ts` (5),
  `apps/api/test/ustaad-social-api.test.ts` (role leak on both routes, flow, no phone, 404 after a block).
- **Seam:** `lib/ustaad/social-client.ts` (interface, dynamic import) → `social-api.ts` (every answer checked with the
  shared schemas; inline route shapes now named in `shared/ustaad/dto/responses.ts`) or `demo/ustaad-social.ts`
  (labelled sample data, in memory; drawn picture tiles; demo share tokens have the real `{22}.{22}` shape). Uploads and
  the voice note stay on the C + E seam (`client.ts`, `MediaDeclare.kind` now also `video` and `document`).
- **Post card** (`components/ustaad/feed/post-card.tsx`): author (link to the profile), level chip or MechDost badge,
  time, segment; the locked Sponsored label (`SPONSORED_LABEL`) when `contentType = sponsored`; held note on one's own
  post; template chip; corrected text with "see original" (`EditedText`); fix log as a definition list; media
  (`post-media.tsx`: swipe gallery with scroll-snap + Previous / Next + "Photo 1 of 3" live text, before/after chips,
  video cover with duration and size that loads nothing before the tap, voice note, PDF chip, link card "opens outside
  MechDost" with the registrable host, poll with whole-percent bars that add to 100); tags as links; four actions with
  icons and words: Like + count (`aria-pressed`, rolls back on refusal; no count when the admin hides likes), Comment +
  count, Save (`aria-pressed`), WhatsApp (teaser link via `POST …/share`; `wa.me` in a new tab; no post text leaves the
  network). ⋯ opens one sheet: Copy link, Report (F2 reasons, pick-a-reason error, optional note), Hide (this screen
  only, Q-U-DW2), Mute, Block (asks first), Delete for one's own post (asks first). Removing a card for mute or block
  drops every card by that member; one live region per card and per list.
- **Lists** (`feed-list.tsx`): For you / Following tabs stay links; Show more by cursor; an expired For you snapshot
  (410 `USTAAD_FEED_EXPIRED`) restarts from the top silently; one served promotion after the third card (Q-U-DW4) with
  "Hide this" asking a reason code; empty states with one action.
- **Sheets** (`sheet.tsx`): native modal `<dialog>`, bottom sheet under 760 px, Escape and backdrop close, focus back
  to the opener; content swaps in place (no stacked dialogs). Comments (`comments-sheet.tsx`): one level of replies,
  text (auto smart correction on send, original kept), voice (recorder, 60 s) or photo (picker), held note, delete
  own; the post page shows the same panel inline. The sheets, the story viewer and the comments load with
  `next/dynamic` on first open.
- **Stories** (`story-row.tsx`, `story-viewer.tsx`): ring row (orange = new, grey = all seen; Add story); full-screen
  dialog with progress bars, photo stories advance after 6 s, hold to pause, a Pause button (WCAG 2.2.2), invisible
  left/right halves as Previous/Next buttons, swipe down or Close; voice and video play only on tap; "Seen by N" on
  one's own; Reply in messages → `/ustaad/messages?to={handle}`; each story viewed is reported once.
- **Composer** (`composer.tsx`): kind tiles (Voice, Photos, Video, Write, Poll, Link, PDF) and quick start (Fix log,
  Tip, Before / After), "Have a question? Ask an Ustaad"; photos up to 10 (re-encoded on the phone, EXIF gone; before /
  after roles), video and PDF with size shown (≤ 16 MB single PUT, Q-U-DW1), poll 2–4 options, link field, smart
  correction (suggest while typing, auto on send), curated tag picker (search, max 5), progress, one primary button;
  `buildPostInput` (pure, tested) mirrors `CreatePostDto`; API codes in words (`USTAAD_DAILY_CAP`, links locked or
  blocked, unknown tag, media limits, stories locked). Story mode: photo / voice / video + a one-line caption.
- **Profile** (`profile-screen.tsx`): initial avatar, name, level, Verified, area (Hindi when given), helpful / best /
  posts (followers and following only when shown), "Works on" chips, Follow (`aria-pressed`), Connect → Request sent /
  Accept (links to `/ustaad/network`) / Connected, Message (thread or `/ustaad/messages?to=`), More sheet (Mute /
  Unmute, Block with confirm, Report member), then the member's posts. Own profile: "This is your profile" + My card.
- **Teaser** (`share-teaser.tsx`, page `s/[token]`): while `ustaad.access = open` rendered without the network gate and shell (during the staff preview the gate decides and the title does not name the network; e2e)
  (`UstaadPublicSwitch` in the layout, `lib/ustaad/public-paths.ts`); a signed-in member goes to the post
  (`GET /ustaad/shares/{token}` → `router.replace`); otherwise the public `GET /ustaad/s/{token}` decides between the
  generic card (Sign in) and "This link is not working any more". `referrer: no-referrer`; the token is redacted from
  analytics paths (`redactPath`) and from the Caddy access log.
- **Shell:** the five-tab dock is unchanged; the phone header gains Messages next to the bell; the desktop rail gains My
  network, Messages and Saved (`ustaad.shell.{network,messages,saved}`).
- **Copy:** `ustaad.feed` and `ustaad.social` (profile keys only), en + hi; WhatsApp, MechDost and PDF allowed in Latin
  (`packages/shared/test/i18n.test.ts`). Hindi crawl pages added (`/ustaad?tab=following`, `create`, `create?story=1`,
  a post, `saved`, a tag, a profile, the teaser).
- **Tests:** `apps/web/test/ustaad-feed-view.test.ts` (17: poll shares, first-message rule, WhatsApp link, story
  stepping, media labels, composer body for every template, 410), `packages/shared/test/analytics-path.test.ts`
  (teaser redaction), e2e `apps/web/e2e/ustaad-d.spec.ts` (Home kinds + promo label + like/save/poll + Saved, comments
  sheet focus return, report + mute, WhatsApp link shape, story viewer, composer errors + tag + post, post / tag /
  profile / teaser with axe on `main`). State-audit rows `API-USTAAD-{FEED,POST-SHEETS,CREATE,STORY-VIEWER,TAG-SAVED,
PROFILE,TEASER}` (fixtures owed, Q-U-DW3).
- **Found in testing (fixed, 2026-11-26):** the teaser token has a dot (`{22}.{22}`), so the locale proxy's "files
  with an extension" exclusion skipped it and `/ustaad/s/…` answered 404 → `proxy.ts` matcher adds `/ustaad/s/:token`
  and `/hi/ustaad/s/:token` (e2e `ustaad-d.spec.ts` guards it). Poll option text moved out of `aria-label` (member text
  must stay inside `data-user-content`, Hindi crawl). A11y review (aria/keyboard, modal/live regions, forms/media):
  focus goes back to the opener only after the native dialog is closed (in `Sheet` / `StoryViewer` cleanup), every
  in-sheet step focuses its first control, poll and video keep focus, the photo strip is a named focusable region and
  its counter speaks only on button use, story rings say new / seen in words, reduced motion starts stories paused.
- **JS (measured on the build, before the split below):** `/ustaad` 226.8 KB gz first load vs `/ustaad/learn` 175.2 (the
  shared Ustaad frame is already over § 17's 150 KB target before D). Zod (31 KB) came in through the correction
  schemas (`EditedText`) and the composer rules; fixed by `lib/ustaad/correction-text.ts` and
  `lib/ustaad/feed-format.ts` (source guard in `ustaad-feed-view.test.ts`). The re-measure needs the next build (the
  lead allowed one build this round), queued in progress. Storefront unchanged: `/shop` 178.6, product 178.4 KB.
- **Accepted gaps (a11y):** member videos have no captions and voice notes no transcript (speech-to-text is ruled out,
  § 22); the post text is the text alternative. Story captions are linked by position, not `aria-describedby`.
- **Not built here:** messages / network / Discover (other agent), resumable video upload (Q-U-DW1), a lasting
  per-member hide (Q-U-DW2), photo avatars (no profile photo upload on the web yet), offline drafts in IndexedDB
  (§ 17), link-preview images (D1 has no og:image yet), 1440 screenshots (lead: 390 + Hindi 390 only this round).

## 21g. Messages, My network and Discover web screens as built (2026-11-26, D2 web)

- **Routes** (`apps/web/src/app/[locale]/ustaad/`, server shells with one client island each, inside A's layout,
  noindex, `MemberGate`): `messages` (tabs Chats · Requests · Sent as links, `?box=`; with `?to=<handle>` the request
  form), `messages/[id]` (one conversation; a malformed id is a 404 before any request), `network` (`?tab=followers |
following | connections | requests | blocked`), `discover` (`?q=&work=&level=`, the `area=` filter is not served).
  Profile links go to **`/ustaad/u/<handle>`** (the profile page another agent builds; § 5 still names `/ustaad/m/`).
- **One seam** `apps/web/src/lib/ustaad/messages-api.ts`: real sign-in calls `/v1/ustaad/{threads,follows,followers,
members/{id}/relationship,connections,blocks,mutes,discover,discover/tags,discover/top-posts,reports}` with every
  answer checked (shared DTOs; small write answers by hand-written guards, the web app has no zod); the browser demo
  loads `apps/web/src/demo/ustaad-messages.ts` (labelled **Sample data**, in memory only; imitates the request rules:
  one text-only message, link refused, fee/UPI phrase held, cooldown after a withdrawn request). Uploads and signed
  URLs reuse the C + E seam (`client.ts`). Pure view rules in `components/ustaad/messages/view.ts`.
- **Messages (WhatsApp habit):** list rows = initials, the name as written, an unread dot with the word "New", muted
  bell, time (the API serves no last-message text, so none is shown). Thread = their bubbles left on the surface, mine
  right in navy, oldest at the top with "Show older"; ticks in words and icons (**Sent / Seen**), my held message
  says **"Being checked"** with "Only you see this" (never shown to the receiver). Read receipt (`POST …/read`) once an
  open conversation is on screen. Before acceptance: the receiver gets Accept / Decline (no composer), the sender a
  waiting note (no composer). Open: composer with a text line (Enter sends, Shift+Enter new line), **Voice** (opens
  the hold-to-talk recorder, 90 s) and **Photo** (camera or gallery, cleaned on the phone, optional caption), uploads
  with progress; the recorder and picker load only when opened. Photos load their signed URL when scrolled into view.
  "More": notices off/on per conversation, **Report** (native modal dialog, reason radio group + note; target = the
  other member's latest message so staff can open the thread through the report, SR-38, else the member), **Block**
  with a confirm step, then a "You blocked …" card with Unblock.
- **Start a conversation (`?to=<handle>`):** no handle route exists, so the handle is resolved through the typed
  Discover search (caller's city, spends the daily profile budget, exact handle only) — **API gap, Q-U-DM1**. An
  existing conversation opens instead; otherwise the request rules are shown before typing (one message until they
  accept, text only, no links, phone/UPI hidden as #, new accounts wait a few days — no number, the setting is
  admin's) and API refusals come back as words beside the field (`USTAAD_DM_TOO_NEW`, `_DM_NOT_ALLOWED`,
  `_DM_PENDING`, `_DM_LINK`, `USTAAD_CONTENT_BLOCKED`, `USTAAD_DAILY_CAP`, `RATE_LIMITED`).
- **My network:** five tabs; rows with Message (→ `?to=`), Remove follower, Unfollow, Accept / Decline (to me),
  Take back (mine), Remove connection, Unblock, Unmute; keyset "Show more"; the limits note on Requests (daily cap and
  the wait after a withdrawn or declined request, `USTAAD_CONNECT_COOLDOWN` in words). No totals (the API serves none).
- **Discover:** search on submit (2–60 letters; `next/form`, no reload), work and level filters; "Top helpers this
  month" with the ranking rule ("not by followers") when nothing is searched; people cards: initials, name, level
  chip, verified tick, area and **distance band** (never km), specialities, helpful / best counts, followers when the
  admin shows them, "New" for the new-member slots, **Follow** (count updated from the answer), **Connect**,
  **Message**. Without a search: popular **tags** (links to `/ustaad/tags/<slug>`) and **Top this week** (links to
  `/ustaad/p/<id>`). Following state is not in `DiscoverPersonDto`, so a card starts at "Follow" (PUT is idempotent).
- **Copy:** `ustaad.messages`, `ustaad.network`, `ustaad.discover` (en + hi, `test/ustaad-dm-view.test.ts` checks key
  parity and every error code in both). **Analytics:** spec 12 § "Ustaad messages, My network and Discover".
- **Accessibility review (2026-11-26, six specialists: ARIA, keyboard, forms, modal, live regions, contrast +
  headings):** focus follows every swap (block → Unblock, unblock → More, Accept → message field, Decline → the closed
  note, Voice/Photo → their panel, removed row or ended list → the list heading, Show older end → the conversation);
  row buttons carry the member's name (sr-only); the report dialog starts on its title, ties the "pick a reason"
  error to the group, closes natively so focus returns to Report; one status + one alert per Discover list (not per
  card) and the result count is announced; the thread `h1` is the name only; busy buttons say "Working…"; Enter-sends
  is described; the composer panels follow the `data-panel-cancel` contract (Escape closes). Not fixed here (shared
  `common.tsx`): `LoadingBlock` wraps its status in `aria-busy`, `LoadFailed` mounts its alert with content.
- **Tests:** `apps/web/test/ustaad-dm-view.test.ts` (box/tab parsing, ticks, order, initials, handle rules, composer
  mode, filters, error keys, copy parity); e2e `apps/web/e2e/ustaad-dm.spec.ts` (tabs, accept a request, ticks and
  held message, send text and photo, mute/report/block/unblock, `?to=` rules and link refusal, network actions and
  cooldown words, Discover search/filters/follow and the search event, axe on `main`); Hindi crawl
  (`USTAAD_DM_PAGES`, eleven `/hi` pages); state-audit rows `API-USTAAD-MESSAGES`, `-THREAD`, `-NETWORK`, `-DISCOVER`.
- **Not built:** a handle lookup route (Q-U-DM1), following state on Discover cards, my own follower/following
  counts, "Suggest me to others" (choices page, B), the city filter (no city list served), mentorship, message
  delete/unsend, live updates (screens refresh after each write; RTDB pings later), a thread-opened client event.

## 21g. Workstream G2 as built (2026-11-26: community manager console + the API F2 left)

- **Migration `0100_ustaad_console_g2`** (hand-written: drizzle-kit refuses to generate while the 0096/0097 snapshots
  collide, L-B5): report source `staff` (a community manager restricted or banned a member from Members). Not applied.
- **Keep runs the publish side effects (F2 not-done item).** `repo/ustaad/publish.ts` is the one place both sides use
  (no import cycle): the writers call `publishUstaadQuestion` / `publishUstaadAnswer` / `publishUstaadComment` /
  `publishUstaadMessage` when an item goes out at once; `actOnUstaadReport(keep)` calls `releaseUstaadHeldTarget`
  after the move. Exactly once: an item whose creation event already reached `visible`, or that has a `released`
  event, is only made visible again (an NCII-hidden answer kept later is not re-notified or counted twice); Izzat uses
  the writer's key `answer:{id}`. Questions have no `held` status, so the release reads the `asked` event's
  `screen = hold`. A held post or story also clears `held_reason_code`.
- **Held messages (staff release).** `loadUstaadTarget` now reports a message with `held_reason_code` as `held`;
  keep releases it (`held_reason_code` cleared with a conditional UPDATE), moves `last_message_at` (never backwards)
  and sends the request or message notice unless the receiver muted the thread; remove deletes it for both. No
  separate release route: keep covers it.
- **Holds reach the queue.** Posts, stories, comments and messages now call `openUstaadAutoHoldReport` when held
  (only Q&A and jobs did); a message held by D2's own fee-phrase check opens an `auto_scam` report (`scam: true`).
- **Staff media view.** `GET /v1/admin/ustaad/moderation/reports/{code}/media/{mediaId}?reason=` — `ustaad:moderate`
  only (the `ustaad:read` GET pass-through excludes this path), city scoped through the report, only a file of that
  report's item (404 otherwise), never a message's file (DM content only through the audited thread read), never a
  file in quarantine or the evidence vault, on legal hold or not verified/archived (403 `USTAAD_MEDIA_RESTRICTED`;
  evidence reads stay the two-person ops step). Every call writes `audit_log` `ustaad.media_view` (reason code)
  before the URL is signed; 120 s URL, signed per view, `Cache-Control: private, no-store`; PDFs as attachments. The
  console shows "Hidden for your protection" until the moderator asks (that is the audited view), then a blurred
  preview with "Show clearly" (`aria-pressed`).
- **Queue filters and four-eyes flags.** Queue `held` (open reports from `auto_word | auto_scam | auto_safety`),
  `reason` and `target` filters; rows and detail carry `banWaiting`, `proposedByMe`, `decidedByMe` (booleans, never
  staff ids) so the UI shows "Waiting for approval" and hides Approve from the proposer and Decide from the decider.
- **Members for staff** (`routes/admin-ustaad-console.ts`, exact paths only, L-UD3): `GET /admin/ustaad/console`
  (capabilities + city codes the UI uses to hide sections), `GET /admin/ustaad/members?q=` (handle prefix, 20,
  city scoped, no phone or email), `GET /admin/ustaad/members/{id}` (status, sanction end, restricted mode, strikes,
  moderation history of the member and their content, open reports, `pendingUnban`), `POST …/{id}/sanction`
  (restrict or ban through a `staff` report and the queue's own decision path, so long bans are proposed for a second
  staff member), `POST …/{id}/unban` and `POST …/{id}/unban/confirm`.
- **Unban follows four-eyes (lead security review 2026-11-26).** Unban lifts the member's standing bans (or, with no
  ban, the standing restrictions): a ban at or above `mod.four_eyes_from_ban_days` (or permanent) is only proposed
  (`unban_proposed` event, `audit_log ustaad.unban_proposed`) and a different staff member confirms; nobody who
  proposed, confirmed or decided a sanction being lifted may propose or confirm (403 `FOUR_EYES`); only those
  sanctions' strikes are overturned and the status is recomputed from what still stands (a restriction from another
  report stays); a child-safety freeze (`review`) is never lifted here (409 `USTAAD_MEMBER_FROZEN`) and a minor-report
  mode stays until its report is decided; append-only `unban` action with the second actor + `audit_log` + event.
- **Legal list** `GET /admin/ustaad/legal` (`ustaad:takedown | ustaad:moderate`): takedowns and grievances
  (source `legal_order | grievance`, basis from the takedown action, 100 newest) and archive rows on legal hold with
  how many of their files sit in the evidence vault, city scoped through the report on the item.
- **Own audit trail** `GET /admin/ustaad/my-actions` (any Ustaad staff permission): the caller's own `ustaad.*`
  audit rows, keyset on the audit id, 30 a page. Community managers have no `audit:read`, so G1's link to Admin →
  Audit is shown only to staff with `ustaad:settings`.
- **Web** (`components/portal/admin-ustaad/ustaad-console.tsx`, `console-*.tsx`, `lib/admin-ustaad-console.ts`): one
  switcher with two groups, Community (Queue, Holds, Appeals, Verify, Members, Takedowns and legal holds, Reserved
  names, My actions) and Network settings (G1's ten sections, G1 rendered in a controlled mode and kept mounted so
  unsaved edits survive). `?section=verify` (Partners › Applications) opens Verify; `?section=settings&sec=mod` a
  settings section. Clock badges say the time left or overdue in words (amber under half the clock, red overdue).
  Decisions with a reason code and note; remove, warn, restrict and ban confirm first; holds offer Release or Remove;
  appeals: link a `REQ-…` ticket to a decided report, decide upheld / overturned. Verify: the B queue with proof,
  vouches and the owner's answer; approve a level no higher than asked or reject with a reason; issue the owner link
  (shown once with the owner's number for the call, as B built it). Reserved names: read for every reader, add and
  switch with `ustaad:settings`. Strings `ustaad.console.*` en + hi; client events `admin_ustaad_console_viewed
{section}`, `admin_ustaad_console_action {action, outcome}`.
- **Accessibility (specialists 2026-11-26: aria, keyboard, forms, live regions):** section heading focused after a
  switch from the list (never on a select change), the report/member heading focused when opened and after each
  decision, one status line per panel that survives the form swaps, result counts announced, owner link focused when
  it appears and Close returns to the section, per-field hints, `aria-invalid` and focus for the appeal, takedown,
  verify-note and unban-note fields, busy guards on the audited reads and the owner link.
- **Tests:** db `ustaad-console.test.ts` (22), api `ustaad-console-api.test.ts` (7), web `admin-ustaad-console.test.ts`;
  e2e `e2e/state-audit/ustaad-console.shots.ts` (`playwright.ustaad-console.config.ts`, the API-mode build, a Raipur
  community manager: every section's heading, focus on open, holds offer only Release/Remove, no phone or email,
  no unmocked call; screenshots with `USTAAD_CONSOLE_SHOTS=<dir>`); state-audit row `API-ADM-USTAAD-CONSOLE` (the
  settings row now opens `?section=settings&sec=…`).
- **Not done (G2):** zone counts and the exact-pin view (`ustaad:location_exact`) in the console; a staff read of
  evidence-vault files (two-person ops step); setting or clearing a legal hold by hand (holds come from takedowns and
  the classifier); the `ustaad_grievance` ticket kind; the shared `LoadState` live-region pattern (admin-wide);
  "Show more" keeps focus on the last row; queue filters are not in the URL; the full `API-ADM-USTAAD-CONSOLE` audit
  sweep and 768 px / dark screenshots (lead's speed-up: 1440 light + Hindi only).

## 21h. QA simulation fixes, batch A (2026-11-27; `docs/qa/ustaad-sim-fix-plan-2026-11-27.md`)

Each fix has a regression test named after the QA id.

- **SIM-P18 — the employer hears about and sees applications.** `applyToUstaadJob` now queues
  `ustaad.job_application` to the employer inside the apply transaction, keyed on the **application** id (a second
  applicant rings again; a repeat tap returns the existing application and rings nothing). The notice opens the job
  page (`/ustaad/jobs/{code}`; the catalogue's old `/ustaad/jobs/mine` was never a page). New
  `GET /v1/ustaad/jobs/{code}/applications?cursor=&limit=` (`listUstaadJobApplicants`): the job's employer only, an
  unknown code and anyone else get the same 404; newest first, keyset cursor on (created_at to the millisecond, id);
  each row has the applicant's name (and Hindi name), level, verified tick, status, "shared their number" and "sent a
  voice intro" flags, never a phone number. The job page shows the employer an **Applicants** card under the job:
  the moves the application machine allows (`applicantMoves`: seen, shortlist, not this time, hire; hire and "not this
  time" confirmed inline), and "See card and message", which opens the member's card where the existing Message
  button lives. Client event `ustaad_job_applicants_viewed { count }`; the moves are the existing server event
  `ustaad_application_moved`. Tests: `ustaad-local.test.ts` "employer sees and hears about applications (SIM-P18)",
  `ustaad-local-api.test.ts` "SIM-P18 …", `apps/web/test/ustaad-applicants-view.test.ts`.
- **SIM-P18 security follow-up (lead's review, 2026-11-27).** The applicants list runs the same member gate as the
  employer's moves (restricted, frozen, banned or departed employers refused) and answers 404 for a draft, held or
  removed job as for an unknown code. It leaves out withdrawn applications (the applicant took theirs back; ruling:
  hidden, not shown greyed), banned or departed applicants and anyone blocked either way with the employer (SR-35,
  `ustaadNotBlockedSql`). Applying to a job whose employer is blocked either way answers 404 and rings nothing. The
  verified tick comes from `ustaadMemberCard` (verified state and a level past `apprentice` / `ustaad_pending`), the
  same trust signal as every other card. Tests: the four "security: …" cases in `ustaad-local.test.ts`.
- **SIM-P11 — the voucher is asked in the bell.** `requestUstaadVouch` queues `ustaad.vouch_requested` (the asker's
  name) to the voucher in the same transaction, keyed on the vouch row. The notice opens `/ustaad/me` (the
  catalogue's `/ustaad/me/verify` was never built). Not done: there is still no member screen to give or decline a
  vouch (Q-SIM-4; the API `POST /ustaad/vouches/{id}/give` exists), so the bell leads to Me, not to the request.
- **SIM-P20 — suggest mode only suggests.** The composers call `correctForSend` (mode `auto`) on send when the member
  did not open the suggestion, and `POST /ustaad/correct` honoured the asked mode, so suggest mode silently replaced
  text. The route's mode is now: the member's own choice (when `correction.member_can_change` is on) or the admin
  default; `off` wins; a request may only **step down** to `suggest`, never up to `auto`. In suggest mode the send-time
  call therefore answers `suggest` and the composer keeps the member's words. "Fix by itself" applies only when the
  admin default is `auto` or the member chose it (G17: the member control is in "My choices", see SIM-P10 below).
  Test: `ustaad-correct-route.test.ts` "SIM-P20 …".
- **SIM-P19 / audit #2 / SIM-P24 — every notice link is a page; the member's standing and appeal.** Links fixed in
  `notice-catalogue.ts`: `ustaad.content_removed`, `ustaad.strike`, `ustaad.appeal_*` → `/ustaad/me/standing`;
  `ustaad.report_outcome` and the reply fallback → `/notifications` (the existing notification centre);
  `ustaad.verification_decided` and `ustaad.vouch_requested` → `/ustaad/me`; `ustaad.job_application` → the job.
  Guard test `apps/web/test/notice-links.test.ts`: every catalogued link must match a page in the route tree (the
  root `[...rest]` not-found catch-all does not count). New **`/ustaad/me/standing`** ("Your account standing"):
  one summary line (blocked until a date / with no end date; limited until a date — you can read but cannot post,
  comment, answer, message or use jobs; limited while the team checks; or all clear with a link to the community
  rules), then each decision on the member or their content (removed, taken down on a legal order, warning,
  limited, blocked) with the **reason as a plain label** (`ustaad.standing.reason_*`, never the code), the decision
  date, the end date, the appeal state and **one Appeal action** (inline form, reason 10–1,000 characters, Escape and
  Cancel close it). API: `GET /v1/ustaad/me/standing` and `POST /v1/ustaad/me/appeals {reportCode, note}` behind
  `requireUstaadMemberAnyStanding` (banned members pass; members who left and non-members get the generic 404; rate
  limits `memberReads` / `membershipWrites`). `ustaadMyStanding` lists the last 50 decisions (`remove`, `takedown`,
  `warn`, `restrict`, `ban` actions on reports whose target is the member or something they wrote; one line per
  report; never the reporter, the staff member or a staff note). `fileUstaadAppeal` (one transaction): someone else's
  report or an unknown code → 404; a report not `actioned` → 409 `USTAAD_APPEAL_CLOSED`; otherwise a support ticket
  of the new kind **`ustaad_appeal`** (migration `0111`, spec 09) through `createSupportTicket`, the report moves
  `actioned → appealed` (conditional on status and version, `ustaad_events` `appealed` by the member, server event
  `ustaad_appeal_filed { reportId }`). Staff still decide it in Admin → Ustaad → Appeals (four-eyes). The GAC line
  (gac.gov.in) closes the decisions list. Tests: `ustaad-moderation.test.ts` "member standing and appeal …",
  `ustaad-moderation-api.test.ts` "member standing and appeal …", `apps/web/test/ustaad-standing-view.test.ts`.
- **SIM-P27 / SIM-P23 — banned and limited members see why, on every network page.** The API already answered
  403 `USTAAD_BANNED`, but only the join flow understood it, so a banned member saw "check your internet" everywhere.
  `MemberGate` (every network page, and now Me too) decides with `memberGateView`: banned (from `GET /ustaad/me`
  `status`, or a 403 `USTAAD_BANNED`) → the **banned screen** (the standing panel titled "Your network account is
  blocked": until when or no end date, each decision with its plain reason and the Appeal action); restricted or
  under review (`MemberView.restrictedMode`, new field, default `none`) → the page under **one limited banner**
  ("Until {date} you can read, but you cannot post, comment, answer, message or use jobs" / "While our team checks your
  account …", link "See why and appeal"); not a member → the join card. Both views load on demand (`next/dynamic`)
  so the pages' first load does not grow; the banner reserves its height while the date loads. Every gated page loads
  the `ustaad.standing` messages. Test: `apps/web/test/ustaad-standing-view.test.ts` "SIM-P27 …". Not done: the
  composers' own refusal texts for `USTAAD_RESTRICTED` stay as they were (the banner is the one wording).
- **SIM-B8 — holds can be warned; scam holds say "job scam".** Admin → Ustaad → Holds offers Release, Remove and
  **Remove and warn** (`decisionsFor(…, 'held')`). On a held item (`held`, or a job in `pending_review`) the `warn`
  decision also takes the item down (the archive path of `remove`), writes the strike and sends one notice, the
  strike; on visible content it stays a plain warning. An automatic hold from the caller's own fee-phrase check (a
  scam DM) is reasoned `job_scam` (was `abuse`), and money asks in the first pass (fee phrase, UPI id, pay app, OTP)
  map to `job_scam` (a bare phone number stays `spam`). Tests: `ustaad-console.test.ts` "SIM-B8 …",
  `admin-ustaad-console.test.ts` "holds: …".
- **SIM-P10 / G17 — voice consent before the first recording; "My choices" on Me.** `declareUstaadMedia` refuses an
  `audio` upload with 403 `USTAAD_VOICE_CONSENT` until the member's latest `ustaad_voice` consent row is a grant
  (`ustaadConsentGranted`; the API is the boundary). `PUT /ustaad/me/choices` now also takes `consents.ustaad_voice`
  and `consents.ustaad_correction` (append-only rows, source `ustaad_choices`); `GET` returns both (default false).
  The voice recorder asks once, before the first recording, in place of the mic ("Allow voice notes?" — what is stored
  and who hears it, where to turn it off; **Allow and record** / **Not now**); nothing is recorded until the member
  allows; after allowing, the member taps the mic again (announced). Me has a **My choices** card: the smart-correction
  mode — "Suggest fixes, I choose" / **"Fix by itself"** / "Off" — when `correction.member_can_change` is on, and the
  two consents (store and play my voice notes; send my typed text, phone numbers hidden, to the correction service,
  which lets the LLM engine run instead of the word list). Each change saves at once. Not done: the admin "Fix by
  itself" default still needs at least one protected word (seed gap, runbook). Tests: `ustaad-media.test.ts` "voice
  consent (SIM-P10 …)", `ustaad-profile.test.ts` (choices shape), `apps/web/test/ustaad-voice-consent.test.ts`.
- **SIM-P34 — a ban closes the banned member's conversations.** Derived, not stored (ruling: a ban ends by the clock,
  an unban or an overturned appeal, and a stored `blocked` status would need restoring and could be lifted by the
  other member): while the other member of a thread is banned or has left, `sendUstaadMessage` and accepting their
  request answer 403 `USTAAD_DM_NOT_ALLOWED` ("This conversation is closed", the existing copy); the banned member
  cannot reach messages at all (403 `USTAAD_BANNED`). Test: `ustaad-social.test.ts` "SIM-P34 …". Not done: the inbox
  does not yet mark such a thread as closed before a send is tried.
- **SIM-P26 — the appellant hears the appeal's outcome.** `decideUstaadAppeal` sent the reporter's
  `ustaad.report_outcome` ("Your report was checked – thank you") to the appellant. New kinds `ustaad.appeal_upheld`
  ("The decision stays") and `ustaad.appeal_overturned` ("We took the decision back"), en + hi in `notify.*`,
  placeholder `reportCode`, tones info / success (§ 12 table). Tests: `ustaad-moderation.test.ts` "appeal: …" and
  "SIM-P26 …".
- **SIM-P17 — the server decides the employer.** `PostJobDto.employer` is optional and the web form no longer sends
  one (it hard-coded `trade`, so a workshop owner got 403). `ustaadJobEmployerOptions(userId, memberWorkshopId)`
  lists what the user may post as: every workshop they hold a grant on (the member's own linked workshop first),
  then their verified trade account. No employer named → the first option; named → honoured only when it is in the
  list; nothing → 403 `USTAAD_EMPLOYER_REQUIRED`. Resuming a job re-checks through the same list. Not done: a member
  who is both a workshop owner and a trade account cannot pick the trade account in the form (the API still accepts
  `{kind:'trade'}`); the form does not yet say which account it posts as.

## 21i-U2/U3. UI upgrade batches U2 + U3 (minus voice) as built (2026-11-27 night; design doc `docs/superpowers/specs/2026-11-27-ustaad-ui-upgrade-design.md` § 3.2, 3.4, 3.7, 3.10, § 8.2/8.3)

- **"Kaam ki baat / Useful" reaction (founder Q-UI-3).** A second reaction beside Like on every post. Same table
  (`ustaad_reactions.kind` now `like | useful`, primary key `(post_id, member_id, kind)`), new counter
  `ustaad_post_counters.useful` (CHECK ≥ 0), migration `0122_ustaad_useful_reaction` (number for the lead to
  renumber on merge). Repository `markUstaadPostUseful` / `unmarkUstaadPostUseful`: insert `ON CONFLICT DO NOTHING
RETURNING`, only an inserted/deleted row moves the counter by a conditional ± 1 (`> 0` guard), `ustaad_events`
  `marked_useful` / `unmarked_useful`; a restricted member is refused (`USTAAD_RESTRICTED`), blocks are 404 like
  likes. The count is **always shown** (a quality signal; `feed.show_like_counts` governs likes only), it **never
  touches Izzat or levels** and sends **no notice**. API `POST|DELETE /v1/ustaad/posts/{id}/useful` → `{ useful,
usefulCount }`, rate rule `likes`, member gate. `PostView` gains `counts.useful` and `usefulByMe`; `likedByMe` now
  reads `kind = 'like'` rows only. Tests: `packages/db/test/ustaad-feed.test.ts` ("Useful" case),
  `apps/api/test/ustaad-feed-api.test.ts` (route + role leak rows).
- **Pehchaan tag (E6).** `components/ustaad/common/pehchaan-tag.tsx` (`PehchaanTag {level, size, onOpen?, tone}`,
  `MemberName`) — "Bench kit" key tag (clip-path point + hole, 1 px edge, metal finishes, 0–4 grade lines; tokens `zinc`, `brass`, `brass-text`, `surface-raised` added), colours in `pehchaan-tones.ts` (contrast in
  `apps/web/test/tokens.test.ts`). Opens `onOpen` (U4's level sheet) or links to `/ustaad/me#levels`. Used in
  `AuthorLine` (Ask list/thread), the post card header and the Messages member line. Profile and Discover chips are
  U4's files (not changed here).
- **Post card (E8, E12).** Fix log = `<dl>` rows with a 3 px accent rule (`feed/fix-log-body.tsx`); a tip sits in a
  `surface-alt` panel with the "Tip / टिप" tag; `before_after` posts with a before and an after photo show
  `feed/before-after.tsx` (radio group under 600 px, side by side from 600 px; `ustaad_before_after_toggled {to}`).
  Double tap on a photo likes (touch: two pointer-ups within 250 ms; mouse: dblclick), only ever likes, the Like
  button stays the equivalent. Like / Useful / Save are optimistic through `lib/ustaad/reactions.ts`
  (`toggleReaction`) with rollback; a failed like says "पसंद नहीं हो पाया, फिर कोशिश करो". Saved state says "सेव
  किया / Saved". Events `ustaad_post_liked {via: button|double_tap}`, `ustaad_post_useful`.
- **Composer (E14).** Three big tiles first (बोलो / फ़ोटो खींचो / वीडियो), "काम दिखाने के तरीके" (Fix log, Tip,
  Before/After), then "और: लिखो, पोल, लिंक, PDF" in a `<details>` (opens by itself when one of those is chosen;
  `ustaad_composer_more_opened`). Photos: Camera (`capture="environment"`) and Gallery buttons
  (`ustaad_camera_opened {source}`). Draft + leave confirm belong to the wording builder; the two labelled
  Before/After slots are **not built** (the per-photo role select stays).
- **Ask (E9).** Best answer carries the stamp "पूछने वाले ने चुना / Chosen by the asker" (the article is named by
  it); "सबसे अच्छा चुनो / Choose as best" is a quiet outlined button for the asker with an inline confirm
  ("इसे सबसे अच्छा जवाब चुनें? [हाँ, चुनो] [रहने दो]"), focus to the confirm and back on "Not now".
- **Not done in this batch:** Ask list card restyle (state chip with icon + word, vehicle title for voice-only),
  Messages inbox/thread restyle and the `closed` flag (copy keys `ustaad.messages.{previewVoice, previewPhoto, closed,
requestsTab}` and `ustaad.qa.{stateSolved, stateOpen}` are in the locale files, unused yet), optimistic Follow
  (profile is U4's), the level explainer sheet (U4), similar questions (needs a spec addition), the `helpful` /
  `before` icons (U1 owns `icons.tsx`; Useful uses `check` for now).

## 22. Not built / later

Speech-to-text and transcripts (ruled out), voice search, auto-translation, server video/audio transcoding and the
ffmpeg sandbox (SR-13/14), server auto-blur and OCR (SR-19), PDF sanitiser and antivirus (SR-16), Web Risk link checks
(SR-24), CSAM hash matching (needs access, Q-U6), certificate upload, skill
quizzes, paid mentorship/trainers, "featured in workshop booking", public profiles for customers, roadside responder
pool for Bada+ (spec 22 phase 2), udhaar, mechanic job cards and GST invoices, trade prices, brand advertisers, mobile
app.
