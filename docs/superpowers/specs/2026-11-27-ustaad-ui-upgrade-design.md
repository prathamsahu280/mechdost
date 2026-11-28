# Ustaad Network — UI/UX upgrade design (2026-11-27)

Status: **design, for the lead's review (not committed).** Founder brief (2026-11-27 night, `docs/decisions.md`):
"the mechanic network ui could do a whole lot upgrade … get some inspirations from instagram and stuff and make it
interesting and interactive … usable, interactive and familiar to the mechanics", research first, then design, then
build. Scope: the **real** network pages under `apps/web/src/app/[locale]/ustaad/**` and
`apps/web/src/components/ustaad/**` (spec 23). Admin console is out of scope (fix plan Batch E covers it).

Inputs read: `CLAUDE.md`, `docs/progress.md` (top entries), `docs/decisions.md` (2026-11-27 night entry; Ustaad entries
by search), `docs/specs/23-ustaad-network.md` (§ 1, 5, 8, 9, 16–18, 21d excerpt, 21h, 22), `docs/design-system.md`
(header + tokens sections), `packages/ui/src/tokens.css` (light tokens), `docs/questions-for-user.md` (searched),
`docs/qa/ustaad-sim-fix-plan-2026-11-27.md`, the 2026-11-26 Ustaad design doc (outline only), memory notes (ustaad-network, ui-redesign-feedback, design-direction,
no-reload-feel, hindi-everywhere), the QA run's `logs/research.md` (RS1–RS9), `audit.md`, `improvements.md`,
`retest-2026-11-27.md` (audit.md and improvements.md: ranked lists and headlines, not every appendix), today's live screenshots (`screenshots/render/`, `screenshots/RT/`) and the components.

Visual study (internal reference only, never published or committed):
`D:\mechdost-qa\ui-inspiration-2026-11-27\board.html` — Google Play listing images of 14 apps (sources per image in
`sources.md` there) beside today's MechDost screens. Sections: `#story-rings`, `#post-card`, `#qa-best-answer`,
`#profile-grid`, `#badges-levels-streaks`, `#voice-notes`, `#composer-camera`, `#notifications`, `#onboarding`.
Each screen decision below cites its board section as **[board #id]**.

---

## 0. One-page summary for the founder (plain words)

**What we found.** Mechanics already know WhatsApp, YouTube and Instagram. What makes those apps easy is not their
colours — it is a handful of habits: a row of round faces at the top that light up when someone has something new; a
big photo with a few clear buttons under it; voice notes that show how long they are and can be sped up; a "new posts"
button instead of the screen jumping; a profile that says who you are in one look. Indian apps that won with
first-time internet users (ShareChat, Moj, Apna, Khatabook) add three more: Hindi first, **bigger buttons with words
on them**, and never changing everything at once (ShareChat lost returning users when it redesigned too hard).

**What is wrong today** (from yesterday's test run): the top 250 px of every network page is taken by the shop's
header, the parts search and a second network header, so a mechanic sees one card per screen; the page jumps when it
loads (the worst in the site); stories, voice notes and the ID card work but look plain; voice notes don't show how
long they are; the level you are working towards is hidden.

**What we will change (same MechDost colours, fonts and pages — nothing copied):**

1. **One small network header** on every network page; the shop's header and parts search step aside inside the
   network. More of the feed on the first screen, and no jump on load.
2. **Your level becomes a "Pehchaan tag"** — a small tag shaped like the key tag every garage hangs on a customer's
   keys. It sits next to every name (posts, answers, jobs, messages) and opens "what this level means and how to get
   the next one". This is our one bold, unmistakably-MechDost element.
3. **Repair posts look like repair work:** a Fix log card shows _Problem → Cause → What I did_; Before/After shows
   two photos with a "Before | After" switch. These templates already exist; today they look like plain text.
4. **Voice everywhere is easier:** a recorder with a clear Stop and Cancel, a time-left warning, listen-before-send;
   every voice note shows its length, a progress bar, 1× / 1.5× / 2× speed, and only one plays at a time.
5. **Every voice note and video carries a short typed summary** written by the author (you approved this), so people
   who cannot listen right now — or cannot hear — still get it, and search finds it.
6. **Best answer stands out** with a "chosen by the person who asked" stamp, and the person who asked sees a clear
   "Choose as best answer" under each answer.
7. **Me page = the ID card first**, then "next level" progress in plain numbers ("8 more best answers"), then badges
   and my work. No streaks or leaderboards that shame people (see questions).
8. **Small interactions that feel alive but cost nothing on a cheap phone:** double-tap a photo to like (the button
   stays), a "New posts" pill, instant like/save, a short vibration on record start/stop, skeletons in the exact
   shape of what is loading. No heavy animation library; everything still works with "reduce motion" on.

**What we will not do:** no Instagram-style gradient rings, hearts-burst, square photo grid or names like Reels /
Stories / Status; no new money or points; no daily streak guilt; no autoplay; no phone numbers anywhere.

**We need 4 answers from you** (§ 9): the bottom bar tabs; a weekly "you helped N mechanics" note instead of a streak;
a "Kaam ki baat" (useful) reaction on posts; and whether auto-captions may send voice to an outside service later.

---

## 1. Principles (binding for every batch)

1. **Inspiration, not imitation** (memory "ui-redesign-feedback"; decisions 2026-11-27 night). We take _interaction
   patterns_ (unseen-ring, action row with words, best answer pinned, voice note length + speed, "new posts" pill,
   ID card first). We never take a reference app's colours, glyphs, names, gradients, mascots or distinctive layouts.
   Each section of the board lists "What we must NOT copy"; builders check it.
2. **Restyle the real pages.** Every control on today's page stays (the wireframes list them). New behaviour only
   where a spec 23 line covers it, or marked "new — needs founder OK" in § 4 and not in a build batch.
3. **MechDost theme only** (hard rule 2): tokens from `packages/ui/src/tokens.css` (navy `#101f34`, accent `#ea5728`,
   filled buttons `#d2461a`, radii card 16 / tile 15 / pill 25 / button 9), Manrope + DM Sans + Noto Sans Devanagari,
   light and dark. The one new shape (the Pehchaan tag) gets a decisions entry; **no new colours**.
4. **Spend boldness in one place** (frontend-design critique): the Pehchaan tag and the ID card carry the identity;
   everything else is quiet. We drop the "identical rounded card for everything" kit where it hurts (feed posts sit
   edge-to-edge at 360–390 px so photos are bigger; cards stay for grouped content).
5. **Calm UI** (hard rule 2): one primary action per screen; secondary actions are outlined or text; no stacked
   sheets; every sheet closes with Cancel, Escape and focus return (memory "no-reload-feel").
6. **Words with every icon** (founder rule, spec 23 § 1; RS1-4, Medhi et al.): icon-only only where the word is
   impossible (and then the accessible name is the word). Labels ≥ 13 px; Hindi ≥ 14 px with line-height ≥ 1.45.
7. **Voice first, never voice only** (RS2): mic is the biggest control on Ask; every voice item has a length, a
   player that names its author, and a typed summary when the author gave one.
8. **Hindi first** (hard rule 10): every string in `ustaad.*` en + hi; spoken register with trade English words
   (engine, clutch, bike, job); member names and user text marked `data-user-content`; Devanagari never clipped
   (`overflow:hidden` banned on one-line labels with Hindi).
9. **Cheap phone, slow data** (spec 23 § 17): member routes ≤ 150 KB gz first-load JS (CI `scripts/measure-js.mjs`
   figure), CLS < 0.05, LCP < 2 s on a mid-range Android over 4G; no media bytes before tap; no animation library;
   CSS transitions on `transform`/`opacity` only, all off under `prefers-reduced-motion`.
10. **Respect, not addiction** (RS3, Duolingo critique below): status comes from helping (best answers, helpful votes,
    verified years), shown as plain progress. No loss-aversion mechanics, no public ranking of individuals beyond
    the existing Discover "Top this week".
11. **Privacy** (spec 23 § 9.6, § 14a): no phone numbers on any surface; location as area name + distance band; exact
    pin only opt-in; analytics carry ids, codes and counts only.

---

## 2. Research summary (sources accessed 2026-11-27)

Grades: **P** primary (company, standards body, peer reviewed), **S** press, **W** weak (blog/self-published).
Earlier research RS1–RS9 (QA run, `logs/research.md`) is reused and cited by id; new findings are R10–R24.

### 2.1 Familiar patterns and why they work

| #   | Finding                                                                                                                                                                                                             | What we take                                                                                                                     | Sources                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R10 | Story tray sits above the feed; a ring marks unseen updates, plain/grey = all seen. No official design rationale published; Instagram's CEO claims creators posting stories see fewer unfollows.                    | Keep the ring row above the feed; ring = unseen. Our ring is a solid accent stroke + thickness change, not a gradient.           | S https://sproutsocial.com/insights/instagram-stories/ · S https://www.shopify.com/blog/how-to-use-instagram-stories · W https://metricool.com/de/instagram-ringfarbe-bedeutung/                                                              |
| R11 | Instagram removed auto-refresh and added a **"New posts" button**: tap jumps to new posts, not tapping keeps your place, because a feed that jumps to the top "can feel unexpected".                                | "New posts" pill, never auto-jump.                                                                                               | P https://about.instagram.com/blog/announcements/new-posts-button-to-improve-instagram-feed · S https://techcrunch.com/2018/03/22/instagram-recent/                                                                                           |
| R12 | WhatsApp voice notes (2022): **1.5× / 2× speed, waveform with progress, listen before sending, pause/resume while recording, remember position**.                                                                   | Speed control, progress, review before send, Cancel; waveform later (needs peaks data).                                          | P https://about.fb.com/news/2022/03/new-voice-message-features-on-whatsapp/ · P https://blog.whatsapp.com/making-voice-messages-better · S https://www.engadget.com/whatsapp-voice-messages-draft-recordings-speed-up-playback-150034778.html |
| R13 | WhatsApp Communities: an announcement channel + small approved sub-groups, admins, rules posted in the description and the announcement group; not discoverable.                                                    | Network rules link visible on Home / Jobs / Me (audit #11); MechDost-authored posts labelled as such.                            | P https://blog.whatsapp.com/sharing-our-vision-for-communities-on-whatsapp · S https://techcrunch.com/2022/11/03/whatsapp-officially-launches-its-new-discussion-group-feature-communities                                                    |
| R14 | LinkedIn added reactions beyond Like (Celebrate, Insightful, …) because a plain like did not say _why_; set chosen from conversations people already have.                                                          | A single extra "useful" reaction fits mechanics (P2, founder question) — not a reaction tray.                                    | P https://blog.linkedin.com/2019/april-/11/introducing-linkedin-reactions-more-ways-to-express-yourself · S https://techcrunch.com/2019/04/11/linkedin-adds-a-range-of-reactions-to-spur-more-engagement-in-conversations                     |
| R15 | Double-tap is a single-pointer gesture — allowed by WCAG 2.5.1; the concern is path/multipoint gestures. Discoverability is separate: keep a visible button.                                                        | Double-tap photo = like, **plus** the Like button; drag-only controls get a tap alternative (2.5.7).                             | P https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures · P https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements                                                                                                             |
| R16 | Optimistic UI and skeletons make waits feel shorter; skeletons that flash for fast loads are worse than nothing. Vibration API works in Chrome Android after a user gesture; must be feature-detected and optional. | Optimistic like/save/follow with rollback; skeleton only after ~300 ms and in the real shape; 10 ms haptic on record start/stop. | W https://simonhearne.com/2021/optimistic-ui-patterns · P https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate · P https://caniuse.com/mdn-api_navigator_vibrate                                                                |

Verification: R11 (Instagram), R12 (WhatsApp) and R24's loss-aversion quote (Duolingo) were fetched from the primary
pages on 2026-11-27 and match; the rest are search-result level and graded as such.

| #    | Finding                                                                                                                                                                                                                                             | What we take                                                                                                                                                                                                                                          | Sources                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| R16a | Short video (Reels, Shorts, Moj, Josh): full-screen vertical player, actions in a side rail, endless swipe with autoplay (Play listing images, board `#post-card` Instagram 01, Josh/Moj folders). Josh/Moj grew on this after the 2020 TikTok ban. | We take vertical posters and tap-to-play for short repair videos (≤ 180 s, spec 23) in the feed, stories and Learn. We do **not** take the autoplay swipe feed: spec 23 § 9.5/§ 17 forbid autoplay (data cost), and it is the most addictive pattern. | S https://yourstory.com/2020/09/josh-dailyhunt-short-video-app-tiktok-aatmanirbhar-bharat · board images |
| R16b | Q&A sites (Quora, Reddit): an accepted/best answer plus vote ranking vs a flat thread; forum operators debate pinning the chosen answer because it pulls it out of the flow. No primary Quora/Reddit design source was found (gap).                 | Keep spec 23's asker-chosen best answer, show it first **and** keep the chronological list below; no downvotes.                                                                                                                                       | W https://meta.discourse.org/t/option-to-move-accepted-answer-to-the-top/58386 · RS4                     |

### 2.2 India, Hindi-first and low-literacy users

| #   | Finding                                                                                                                                                                                                                                                                                                                                    | What we take                                                                                                                        | Sources                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R17 | (Search-snippet level: the ShareChat engineering post refused automated fetch, 403.) ShareChat: Bharat users wanted **more colour and "verbose" like/share buttons**; a minimal app "wouldn't work". A radical UI overhaul **sharply hurt returning users**; even a small revision had a steep learning curve, so they test UI on the PWA. | Words on buttons; **evolve, don't replace** — keep every control in place, ship behind the existing pages, measure return rate.     | P https://medium.com/sharechat-techbyte/building-content-discovery-for-sharechat-users-78ad2e482f11 · S https://yourstory.com/2021/04/product-roadmap-social-media-startup-sharechat-unicorn                                                                                                                                        |
| R18 | Moj and Josh ask only for the **language** first (Josh needs no login to start); ShareChat dropped English entirely in 2016 and engagement rose (RS1-1). Play listings (board #onboarding) show native-script language tiles as the first screen.                                                                                          | Our join/tutorial opens in the page's language with a visible switch; no extra step.                                                | S https://www.gizbot.com/apps/news/josh-app-how-to-download-install-and-create-videos-on-josh-app-068990.html · RS1-1                                                                                                                                                                                                               |
| R19 | Text-only interfaces were unusable for first-time low-literate users and error-prone for literate novices (ToCHI 2011, 90 participants, 4 countries); short or abstract labels and culturally unadapted icons confuse ("Text is not the enemy").                                                                                           | Icon **and** word; concrete garage words; no abstract icons (no "spark", "flame", "gem").                                           | P https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ToCHI2711_Medhi.pdf · P https://researchgate.net/profile/Hendrik-Knoche/publication/266595198_Text_is_not_the_enemy_How_illiterates'_use_their_mobile_phones/links/5849ac7508ae5038263d88aa/Text-is-not-the-enemy-How-illiterates-use-their-mobile-phones.pdf |
| R20 | New internet users learn from **informal teachers** (family, friends) rather than by exploring; explaining _why_ raises comprehension (Google NBU, 5 countries, 1 year).                                                                                                                                                                   | The chhotu learns from the ustaad: "share to WhatsApp" teaser, tutorial cards with one reason each, coach-mark on one control only. | P https://services.google.com/fh/files/misc/informal_teachers_pivotal_role_new_internet_users.pdf                                                                                                                                                                                                                                   |
| R21 | Apna: communities per trade (carpenters, painters, …) where members swap interview and pay tips; profile = a digital visiting card; Play listing shows a **level chip on the avatar** (board #profile-grid).                                                                                                                               | The ID card (pehchaan) is the profile's first block; level tag beside the name everywhere.                                          | S https://techcrunch.com/2021/03/01/apple-alum-jobs-app-apna-for-india-workers-raises-12-5-million · S https://www.outlookbusiness.com/big-idea/blue-collared-workers-might-not-have-fancy-resumes-but-they-have-an-apna-6136                                                                                                       |
| R22 | Kutumb ("Reddit/Discord for Bharat") adds group hierarchy (team lead, sub-lead) on top of WhatsApp-group habits; 8 regional languages.                                                                                                                                                                                                     | Hierarchy is already ours (Chhotu → Master Ustaad); show it on cards, not in a separate leaderboard.                                | S https://yourstory.com/2022/09/bengaluru-social-media-startup-kutumb-building-discord-like-app-bharat · P https://seedtoscale.com/blog/how-kutumb-is-shaping-new-standards-of-community-engagement-across-bharat                                                                                                                   |

### 2.3 Reputation, levels and gamification that respects professionals

| #   | Finding                                                                                                                                                                                                                                                                                                                                       | What we take                                                                                                                                        | Sources                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R23 | Stack Overflow: the asker marks the accepted answer, and reputation unlocks privileges listed on a public privileges page with your progress; Discourse trust levels are discrete tiers from several activity signals, excluding private messages to prevent gaming. Badges alone do not sustain motivation; reputation rings are detectable. | Our levels already match the Discourse model (rule groups, staff review). Show the **next step in numbers**; keep anti-ring rules; no score in DMs. | P https://stackoverflow.blog/2010/10/07/membership-has-its-privileges/ · P https://blog.discourse.org/2018/06/understanding-discourse-trust-levels/ · P https://arxiv.org/abs/2111.07101 · RS3, RS4 |
| R24 | Duolingo's streak is explicitly **loss aversion**; freezes soften it. Research and journalism report misuse: users chase league XP instead of learning, leagues get cheated, losing a streak is an exit point for loyal users.                                                                                                                | No daily streak, no leagues. If any rhythm signal: a weekly, positive "you helped 6 mechanics this week" note (founder question Q2).                | P https://blog.duolingo.com/how-duolingo-streak-builds-habit · P https://arxiv.org/abs/2203.16175 · S https://kotaku.com/duolingo-app-cheats-hacks-leagues-xp-why-duohacker-1850506482              |

### 2.4 Indian mechanic work culture (grounding the content)

- **Ustaad–chela (chhotu) apprenticeship** is the low-cost, on-the-job way skills pass in Indian workshops; industry
  sees it as unstructured, and roadside mechanics say learning is hard "with limited source of learnings and no one
  to guide you". Sources: S https://www.ideasforindia.in/topics/poverty-inequality/unleashing-the-forgotten-billion-of-india ·
  S https://nationalskillsnetwork.in/empower-pragati-castrol-eklavya-project/ · P https://www.asdc.org.in/files/ASDC_RPL-1-E-Book.pdf
  → Ask is the centre (the chhotu asks, the ustaad answers), and the level ladder mirrors the real hierarchy.
- **New tech (EV, electronics) pushes small garages to learn from peers and short videos**; regional-language
  training apps (MechanikTV) and helplines exist. Sources: S https://yourstory.com/2026/01/gonda-mechanic-adapts-modern-vehicle-electronics ·
  S https://www.evoindia.com/article/mechaniktv-an-android-app-to-upskill-indias-mechanics → Learn shows progress
  that _counts_ (10 training videos is a Naya Ustaad rule, spec 23 § 9.2).
- **Parts access and price opacity** is a daily pain for single-mechanic workshops (Partnr connects 40,000 mechanics
  for transparent parts pricing). Source: S https://yourstory.com/2025/10/digitising-local-garages-how-partnr-is-empowering-unorganised-mechanics
  → "Parts used" chips on answers link to the MechDost shop (spec 23 § 5 q-thread "parts used"); trade prices stay
  out (PENDING #27).
- **Hindi repair content is a real genre** (e.g. Hindi repair channels with ~300K subscribers covering diagnosis and
  repair). Source: S https://vidiq.com/youtube-stats/channel/UCe9vIGL_VdILZUrJ56u7a3w → what mechanics would share,
  in order: **fault videos / sounds** ("ye awaaz kya hai?"), **before/after repair photos**, **fix logs**
  (symptom → cause → fix), **tool and part tips**, part-name questions with a photo. All five map to existing post
  kinds and templates (`voice`, `video`, `before_after`, `fix_log`, `tip`; spec 23 § 6.3). Not found by research:
  any study of mechanics' WhatsApp groups (flagged as a gap; the founder's own garage contacts are the better source).

### 2.5 What fails for low-literacy users (do-not list)

Icon-only actions; abstract icons; long paragraphs; hidden gestures without a button (swipe-only, long-press-only);
English-only error text; text that blames the user when voice fails (RS2-1); sudden full redesigns (R17); auto-jumping
feeds (R11); autoplay that eats data (RS6); badges that look like money (R24; spec 23: Izzat never spendable).

---

## 3. Per-screen design

Notation: wireframes are 390 px wide, light theme, Hindi labels where useful. `[…]` = button, `(…)` = chip/tag,
`▶` = play, `◉` = avatar. "Today" lists the real controls that must survive.

### 3.0 Shell (every member page) — [board #onboarding] for first run

**Change.** Inside `/ustaad` the storefront strip, site header and parts search step aside (decided in the server
HTML by path, so nothing shifts after load; § 8.1) for one 56 px network header; the network's own second header
goes. The neutral frame carries no network words (staff-preview secrecy, § 7). Dock labels 13 px (hi 14 px), word under Create, current tab = filled
icon + 3 px accent bar (contrast ≥ 3:1, audit #10). **Why:** at 390 px the first 250 px are chrome (`mB-390-en-light-ustaad.jpg`);
audit F-R13/F-R17 (landscape and 200 % zoom leave almost no room); R17 calls for more content per screen.

```
┌──────────────────────────────────────┐ 390
│ [◀]  उस्ताद नेटवर्क        [✉ संदेश][🔔 3] │ 56 px, sticky, surface
├──────────────────────────────────────┤
│                                      │
│            page content              │
│                                      │
├──────────────────────────────────────┤
│ [⌂ होम][⌕ खोजें][ ＋ बनाओ ][🎓 सीखें][◉ मैं] │ 64 px dock, word on every tab
└──────────────────────────────────────┘
```

- Back arrow only on sub-pages (thread, post, job); Home shows the MechDost mark (link to `/`, "MechDost होम").
- Messages and bell keep their counts (`role="status"` atomic text "3 नई सूचनाएँ", not a bare number).
- The dock hides while a text field has focus on phones (audit #18 / F-R17) and on message threads (composer owns the
  bottom); `scroll-padding-bottom` follows the dock height (audit #20).
- **Data/API:** none new. **Events:** existing `ustaad_header_messages`, `ustaad_bell`; new `ustaad_shell_home_logo`.
- **a11y:** one `<nav aria-label>`; exactly one `aria-current="page"`; header is a `<header>` landmark; 48 px targets.
- **Copy:** `ustaad.shell.brand` "Ustaad Network / उस्ताद नेटवर्क" (exists); `ustaad.shell.home_logo_aria` "MechDost
  home / MechDost होम"; `ustaad.shell.tab_create` "Create / बनाओ" (word now visible).

### 3.1 Home and feed — [board #story-rings], [board #post-card]

**Today (keep all):** greeting; "Stuck on a job?" voice hero with "Ask an Ustaad" + mic; coach-mark; "Today at the
garages" story row with Add story; 9 shortcuts; "Questions waiting for you" / "Your questions"; feed For you /
Following; pin prompt; Sponsored items.

**Change.**

1. Hero becomes a compact card (≈ 140 px instead of ≈ 300 px): mic (64 px, accent, hold or tap = record) + title +
   one-line hint, and the existing **"Ask an Ustaad / उस्ताद से पूछो"** button kept as the card's text-button (opens
   the full composer). The mic stays the one primary action; the button is secondary styling.
2. Story row moves **above** the hero (familiar order: faces first, R10) and gets real rings (§ 3.3).
3. Shortcuts: 4 visible tiles (Ask, Jobs, Dukaan, Learn) + "और / More" opening a sheet with the other 5 (network,
   area, saved, pin, card). Calm UI; spec 23 § 5 list unchanged.
4. "Questions waiting for you" becomes a horizontal strip of compact question cards (vehicle chip, voice length,
   "जवाब दो") — the Ustaad's most valuable action, 1 tap.
5. Feed tabs become a two-segment control under a sticky sub-header; a **"नई पोस्ट देखो ↑ / See new posts"** pill
   appears over the feed (fixed position, no layout shift) when the first page changed (R11).
6. Feed items sit edge-to-edge (no outer card margin) separated by an 8 px `bg` gap, so photos get the full 390 px.

```
┌ header ───────────────────────────────┐
│ नमस्ते, सुरेश                           │
│ (◉+)  (◉)  (◉)  (◉)  (◉)  →           │ stories: mine first; ring = new
│ आप   राजू  अनिल  सोनू  …               │
│┌─────────────────────────────────────┐│
││ (🎤 64)  काम में अटके हो?             ││ hero, navy, ONE primary (mic)
││          बोलकर पूछो — उस्ताद जवाब देंगे ││
││          [उस्ताद से पूछो]  ← kept, secondary ││
│└─────────────────────────────────────┘│
  (pin prompt and Sponsored items: kept, unchanged position in the feed — not drawn)
│ [🎤 पूछो] [💼 नौकरी] [🛒 दुकान] [🎓 सीखें] [⋯ और] │
│ आपके जवाब का इंतज़ार →                  │
│ ┌──────────┐┌──────────┐               │
│ │Splendor  ││ AC गैस    │ …            │
│ │▶ 0:42    ││ 3 फ़ोटो   │               │
│ │[जवाब दो] ││[जवाब दो] │               │
│ └──────────┘└──────────┘               │
│ [ आपके लिए | फ़ॉलो किए ]                 │
│ ───── post (edge to edge) ─────        │
│        ( नई पोस्ट देखो ↑ )  ← floating   │
└ dock ─────────────────────────────────┘
```

- **Interactions:** native pull-to-refresh (Chrome's own; no custom gesture); pill tap = smooth scroll to top +
  replace snapshot; tab switch keeps each tab's scroll position (no reload feel); infinite list with "और दिखाओ"
  button fallback (keyboard and slow data).
- **Motion:** pill slides down 8 px + fade 220 ms; nothing else animates on load. Reduced motion: appears instantly.
- **Data/API:** existing `GET /ustaad/feed?tab=&cursor=` (ranked snapshot per member, 10 min, § 9.5 / § 21d).
  **"New posts" needs a new endpoint** because the ranked snapshot's first id does not signal freshness:
  `GET /v1/ustaad/feed/fresh?tab=&since=<ISO of the snapshot's newest item>` → `{ count: 0..10 }` (capped), counting
  visible candidate posts newer than `since` with the same candidate rules as the feed (followed members, followed or
  matching tags, same city; blocks/mutes excluded; § 9.5) on the existing `(city_id, status, created_at desc)` index;
  member gate, rate limit `memberReads`. Called every 90 s only while the page is visible and data saver is off. Tap =
  drop the snapshot and fetch page 1. Extends § 9.5 (no ranking change); also closes SIM-F4 (open Home never
  refreshes). Questions strip: existing `GET /ustaad/questions?filter=` (first page, show 6).
- **Events:** existing `ustaad_feed_viewed {tab}`; new `ustaad_feed_new_pill_shown {}`, `ustaad_feed_new_pill_tapped
{}`, `ustaad_home_more_opened {}`, `ustaad_home_question_tapped {position}`.
- **a11y:** story row is a `<ul>` with buttons named "Raju Sahu ki story, nayi" ("राजू साहू की स्टोरी, नई"); pill is
  a button with `aria-live="polite"` announcement "नई पोस्ट आई हैं"; horizontal strips scroll with keyboard (focusable
  items, no hidden overflow traps).
- **Copy (new keys `ustaad.home.*`):** `heroTitle` "Stuck on a job? / काम में अटके हो?" (exists as `title`),
  `heroAction` "Ask by voice / बोलकर पूछो", `more` "More / और", `moreTitle` "More in the network / नेटवर्क में और",
  `waitingTitle` "Waiting for your answer / आपके जवाब का इंतज़ार", `answerNow` "Answer / जवाब दो", `newPosts` "See new
  posts / नई पोस्ट देखो", `newPostsSr` "New posts are here / नई पोस्ट आई हैं".

### 3.2 Post card — [board #post-card]

**Today (keep all):** author row (avatar, name, level, verified, official badge), Sponsored / held labels, `…` menu
(report, mute, block, delete), body with smart-correction "edited" note, Listen (TTS), media (photos, video tile,
voice), poll, link preview, tags, comments count, Like / Comment / Save / WhatsApp with words.

**Change.** Template-aware bodies (the repair content mechanics actually share, § 2.4) and the Pehchaan tag:

```
◉ सुरेश यादव  (🏷 पक्का उस्ताद) ✓        [⋯]
  गुढ़ियारी · 2 घंटे पहले
┌─────────────── FIX LOG ───────────────┐
│ ▍खराबी   स्टार्ट नहीं हो रही, क्लिक आवाज़     │
│ ▍वजह     स्टार्टर रिले जला हुआ               │
│ ▍क्या किया रिले बदला, टर्मिनल साफ़ किए         │
└───────────────────────────────────────┘
[ photo 390×293, LQIP, tap = open, double-tap = like ]
#बैटरी  #Splendor
[♡ 12 पसंद] [💬 3 कमेंट] [🔖 सेव] [WhatsApp]
```

Before/After:

```
[  पहले  |  बाद में  ]   ← segmented toggle (tap); ≥ 600 px: both side by side
[ photo (the chosen one) ]
```

- Fix log rows use a 3 px accent rule on the left (structure = information) and the existing `fix_symptom`,
  `fix_cause`, `fix_fix` fields. Tip posts get a `surface-alt` panel with "टिप / Tip" tag. Voice posts show the new
  VoiceNote (§ 3.10) with the author's summary under it. Video: poster + "▶ 0:48 · 4.2 MB" (size shown, RS6).
- Comment opens the existing `CommentsSheet` from the feed (post stays visible behind it); the post page keeps
  comments inline.
- **Double-tap on a photo = like** (only ever likes, never unlikes, R15); feedback is the Like button itself: icon
  fills, count ticks, 150 ms scale 1 → 1.15 → 1 on the button. **No** big overlay heart (distinctive Instagram mark).
  Single tap keeps today's behaviour (open viewer) after a 250 ms double-tap window; `touch-action: manipulation`.
- Like / Save / Follow are optimistic with rollback and a toast on failure ("पसंद नहीं हो पाया, फिर कोशिश करो").
- Saved state says "सेव किया / Saved" (SIM-P12).
- **Data/API:** existing. **Events:** `ustaad_post_liked {via: button|double_tap}` (add `via`), `ustaad_post_saved`,
  `ustaad_post_shared {channel}`; new `ustaad_before_after_toggled {to: before|after}`.
- **a11y:** article named "Post by …" (exists); double-tap has the button equivalent; toggle is a radio group;
  fix-log rows are a `<dl>`; counts in the button's name ("12 पसंद, पसंद करो").
- **Copy (`ustaad.feed.*`):** `fixSymptom` "Problem / खराबी", `fixCause` "Cause / वजह", `fixFix` "What I did / क्या
  किया", `before` "Before / पहले", `after` "After / बाद में", `tipTag` "Tip / टिप", `saved` "Saved / सेव किया",
  `likeFailed` "Couldn't like. Try again / पसंद नहीं हो पाया, फिर कोशिश करो", `videoMeta` "{duration} · {size}".

### 3.3 Stories (row + viewer) — [board #story-rings]

**Today:** ring row (mine first or Add story; orange = new, grey = seen), viewer loaded on tap, photo/voice/short
video + one-line caption, 24 h expiry.

**Change.**

- Ring: unseen = 3 px **accent** stroke with a 2 px surface gap; seen = 1.5 px `line` stroke. State never by colour
  alone: unseen avatars also get "नई" in the accessible name and a 6 px dot under the name. Own avatar shows a small
  "+" badge when I have no story today.
- Viewer: segmented progress bar at top (one segment per story), author + Pehchaan tag + time, **visible** buttons
  "◀ पिछली", "⏸ रोको", "अगली ▶", "✕ बंद करो" (48 px), plus tap-left/right zones and press-and-hold to pause.
  Photos advance after 6 s; voice and video stories wait for **tap to play** (no autoplay, spec 23 § 9.5) and then
  advance when they end. Caption and summary shown at the bottom on a navy scrim (contrast ≥ 4.5:1).
- Escape closes; focus returns to the ring.

```
┌──────────────────────────────────────┐
│ ▬▬▬▬ ▬▬▬▬ ▭▭▭▭                         │ progress
│ ◉ राजू साहू (🏷 छोटू) · 3 घंटे   [✕ बंद] │
│                                      │
│          [ photo / ▶ 0:21 ]          │
│                                      │
│ "आज 3 बाइक का क्लच बदला"               │ caption (user text)
│ [◀ पिछली]   [⏸ रोको]   [अगली ▶]         │
└──────────────────────────────────────┘
```

- **Data/API:** existing `GET /ustaad/stories`, `POST /ustaad/stories/{id}/view`. **Events:** existing `ustaad_story_viewed`; new
  `ustaad_story_paused {}`. **Motion:** progress bar is a CSS `transform: scaleX` animation; under reduced motion the
  bar shows steps and stories do **not** auto-advance (WCAG 2.2.2).
  **Ruling 2026-11-28 (lead, built in spec 23 § 21i-L):** photos never auto-advance (the U1 6 s timer is removed); a
  voice note or video the member played moves to the next story when it ends; a visible "Auto next" switch turns that
  off; under reduced motion nothing moves on. `ustaad_story_autonext {on}` replaces `ustaad_story_paused`.
  **Status 2026-11-28:** § 3.5 Continue + file size, § 3.6 job employer line and the saved-by-me flags are built (21i-L).
  State-audit rows and API-mode fixtures for Learn, Jobs and Saved are built (batch D1); the member profile `/u/[handle]` is restyled to the Me / ID card look (batch D2, § 3.8; the weekly "helped N" note stays Me-only, no field on the profile DTO).
- **Copy (`ustaad.story.*`):** `new` "new / नई", `prev` "Previous / पिछली", `next` "Next / अगली",
  `pause` "Pause / रोको", `play` "Play / चलाओ", `close` "Close / बंद करो".

### 3.4 Ask list, composer and thread — [board #qa-best-answer]

**Today:** list with filters All / For you / Mine / No answer yet, chips New / Solved, "Voice question" label;
composer (voice first, then type, title optional, details, vehicle, work type, send, smart correction); thread with
question card (navy), Play voice note, Listen, segment chips, answers, best answer pill, helpful, parts used, report.

**Change.**

- List cards: vehicle model as the title when the question is voice-only ("Splendor · आवाज़ वाला सवाल · 0:42"),
  answers count, state chip with icon+word ("✓ हल हुआ / Solved", "⏳ जवाब नहीं / No answer yet"), asker's tag.
- Composer: the mic button is 96 px with the word "बोलकर पूछो" under it; typing is a secondary text field below;
  after recording, the summary field appears (§ 5). **New (spec addition, P1):** "मिलते-जुलते सवाल / Similar
  questions" — up to 3 solved questions matching the typed title/vehicle, shown under the title field (reduces
  duplicates; Quora pattern, board).
- Thread:

```
┌ navy question card ───────────────────┐
│ ◉ राजू साहू (🏷 छोटू) · 33 मिनट          │
│ Splendor — स्टार्ट नहीं होती               │
│ [▶ आवाज़ सुनो · 0:42 ━━━━○──── 1×]       │
│ "सेल्फ़ दबाने पर टक-टक आवाज़"  ← summary   │
│ (दो-पहिया) (इलेक्ट्रिकल)                  │
└───────────────────────────────────────┘
2 जवाब
┌ best answer ──────────────────────────┐
│ ✔ पूछने वाले ने चुना                     │ stamp, success tokens
│ ◉ सुरेश (🏷 पक्का उस्ताद) ✓              │
│ Exide 12V 5Ah लगी है तो पहले टर्मिनल…    │
│ लगे पार्ट: (Exide 12V 5Ah →दुकान)          │
│ [👍 काम आया 8]                          │
└───────────────────────────────────────┘
┌ answer ───────────────────────────────┐
│ ◉ अनिल (🏷 नया उस्ताद)                   │
│ [▶ 0:58 ━━○───── 1×]  "रिले चेक करो…"    │
│ [👍 काम आया 2]  [★ सबसे अच्छा चुनो] ← asker only │
└───────────────────────────────────────┘
[ 🎤 बोलकर जवाब दो ]  [ ✎ लिखो ]           ← sticky composer (Ustaad), ONE primary
```

Kept, not drawn: "← All questions" back link, **Listen** (TTS) on typed text, **Report** in each item's `⋯` menu,
"Edited" smart-correction note, parts-used editor for the answerer, WhatsApp share of the question.

- Best answer always first, stamp text says who chose it (R23, RS4). "Choose as best" is a quiet outlined button on
  every answer, only for the asker, with an inline confirm ("इसे सबसे अच्छा जवाब चुनें? [हाँ, चुनो] [रहने दो]").
- **Data/API:** existing question/answer endpoints; summary fields (§ 5); **new** `GET
/v1/ustaad/questions/similar?q=&segment=&limit=3` (Postgres FTS on existing question search vector, member gate,
  rate limit `memberReads`, ids + titles only).
- **Events:** existing `ustaad_question_asked`, `ustaad_answer_posted`, `ustaad_answer_helpful`,
  `ustaad_best_answer_chosen`; new `ustaad_similar_shown {count}`, `ustaad_similar_opened {position}`.
- **a11y:** best answer is a `<section aria-labelledby>`; helpful is a toggle button with `aria-pressed` + changed
  word ("काम आया ✓"); voice player named with the author (§ 3.10).
- **Copy (`ustaad.qa.*`):** `bestStamp` "Chosen by the asker / पूछने वाले ने चुना", `chooseBest` "Choose as best /
  सबसे अच्छा चुनो", `chooseBestConfirm` "Make this the best answer? / इसे सबसे अच्छा जवाब चुनें?", `confirmYes` "Yes,
  choose / हाँ, चुनो", `confirmNo` "Not now / रहने दो", `helpful` "Helped / काम आया", `answerVoice` "Answer by voice /
  बोलकर जवाब दो", `answerType` "Write / लिखो", `similarTitle` "Similar questions / मिलते-जुलते सवाल", `stateSolved`
  "Solved / हल हुआ", `stateOpen` "No answer yet / जवाब नहीं आया".

### 3.5 Learn — [board #badges-levels-streaks]

**Today:** title, intro, a big Data saver card, empty state "No lessons yet … Ask an Ustaad", courses / short videos
/ MechDost training when present, completion counted for levels.

**Change.**

- Data saver becomes a compact switch in the page header row ("डेटा बचाओ ●"); the big card goes (calm UI).
- For Chhotu: a progress strip "नया उस्ताद बनने के लिए: 7/10 वीडियो देखे" (rule B, § 9.2) — this is _the_ reason to
  watch. For Ustaads: "आपने 12 वीडियो पूरे किए".
- Video cards: poster (LQIP), duration, **size**, "✓ पूरा देखा" when ≥ 80 %, "आधा देखा" bar otherwise; tap to play,
  pause when scrolled off-screen.
- "जारी रखो / Continue" row first when something is half-watched.

```
सीखें                              डेटा बचाओ [●]
नया उस्ताद बनने के लिए: 7/10 वीडियो देखे  ███████░░░   ← Chhotu only
जारी रखो
┌ poster 16:9 (LQIP) ─────────┐
│ ▶ 3:20 · 6.1 MB   आधा देखा ▬▬░│
└─────────────────────────────┘
MechDost ट्रेनिंग · उस्तादों के छोटे वीडियो · कोर्स   ← existing groups, kept
┌ poster ┐ बैटरी टर्मिनल की सफ़ाई      ✓ पूरा देखा
└────────┘ 1:12 · 2.3 MB
Empty state (kept): "अभी कोई पाठ नहीं…" + [उस्ताद से पूछो]
```

- **Motion:** none beyond the shared press feedback. **a11y:** poster buttons named "Play {title}, {duration},
  {size}"; progress as `<progress>` with text; the switch is a real `role="switch"` with its word.
- **Data/API:** existing learn list + completion; the Chhotu progress reads `MyCardDto.videos` and the ladder's
  `minVideos` (existing `GET /ustaad/me/card`). Half-watched position: `localStorage` per viewer (try/catch), no new
  API. **Events:** existing `ustaad_learn_completed {resource}`, `ustaad_video_played {seconds_band}`,
  `ustaad_data_saver {on}`; new `ustaad_learn_continue_tapped {}`.
- **Copy (`ustaad.learn.*`):** `dataSaverShort` "Save data / डेटा बचाओ", `towardsNaya` "To become Naya Ustaad:
  {done}/{need} videos watched / नया उस्ताद बनने के लिए: {done}/{need} वीडियो देखे", `watched` "Watched / पूरा देखा",
  `halfWatched` "Half watched / आधा देखा", `continue` "Continue / जारी रखो".

### 3.6 Jobs — (no board section; Apna pattern, R21, RS5)

**Today:** "Jobs near you", Post a job, scam warning (now with 1930 + cybercrime.gov.in), role filter chips, list,
detail with apply sheet (share number toggle, voice intro), employer applicants card (SIM-P18).

**Change.**

- Job card: role (big), pay range "₹12,000–15,000 / महीना", area + distance band, employer name + "✓ वेरिफ़ाइड गैराज",
  posted time, one line "🛡 पैसे माँगे तो मत देना" (RS5: on the card) linking to the full warning.
- The page-top warning becomes one compact line with "और जानो" (expands inline); full text stays on detail and in
  job chats.
- Detail: one primary "मेरे कार्ड से अप्लाई करो / Apply with my card"; voice intro optional in the sheet (existing).
- Selected filter chip: filled `accent-soft` + check icon (dark contrast fix, audit night list).

```
आसपास की नौकरियाँ                   [+ नौकरी डालो]   ← kept, outlined
🛡 नौकरी के लिए पैसे माँगे तो मत देना। [और जानो]       ← one line, expands inline (1930 text kept)
(✓ सब काम) (हेल्पर) (दो-पहिया मैकेनिक) →            ← chips, selected = filled + check
┌───────────────────────────────────────┐
│ दो-पहिया मैकेनिक                         │
│ ₹12,000–15,000 महीना · फ़ुल टाइम           │
│ सुरेश ऑटो वर्क्स ✓ वेरिफ़ाइड गैराज           │
│ गुढ़ियारी · 2–5 किमी · 2 दिन पहले           │
│ 🛡 पैसे माँगे तो मत देना                    │
└───────────────────────────────────────┘
Detail: [ मेरे कार्ड से अप्लाई करो ] (primary) · apply sheet (number toggle, voice intro) kept · Applicants card kept
```

- **Motion:** scam line expands with a 150 ms height-free reveal (opacity only). **a11y:** each card is a link with
  the role as its name; chips are a radio group; the warning keeps `role="note"`.
- **Data/API:** existing. **Events:** existing `ustaad_job_applied`, `ustaad_job_posted`; new `ustaad_job_scam_line_opened {}`.
- **Copy (`ustaad.jobs.*`):** `payRange` "₹{min}–{max} a month / ₹{min}–{max} महीना", `verifiedGarage` "Verified
  garage / वेरिफ़ाइड गैराज", `scamLine` "If anyone asks for money, don't pay / पैसे माँगे तो मत देना", `learnMore`
  "Learn more / और जानो", `applyWithCard` "Apply with my card / मेरे कार्ड से अप्लाई करो".

### 3.7 Messages — [board #voice-notes]

**Today:** inbox (threads, requests, sent), new thread `?to=`, thread view with bubbles, voice notes ("Play voice
note"), photos, seen ticks, More (report, block), request-only rules, scam hold, closed conversation copy.

**Change.**

- Inbox rows WhatsApp-familiar (habit, not look): avatar, name + Pehchaan tag, last message preview with an icon +
  word for media ("🎤 आवाज़ · 0:12", "📷 फ़ोटो"), time, unread count; Requests as a tab with a count.
- Thread: sticky compact header (back, avatar, name, tag, `⋯`); bubbles mine = navy, theirs = surface; voice bubble =
  new VoiceNote with speed + the sender's summary; composer sticky at the bottom: text field + mic (hold to talk **or**
  tap to start/stop) + send; dock hidden in a thread.
- A thread with a banned/left member shows "यह बातचीत बंद है" before a send is tried (SIM-P34 "not done" item).

```
Inbox                                  Thread
[ बातचीत | अनुरोध (2) | भेजे ]           ┌ [◀] ◉ सोनू पटेल (🏷 छोटू)   [⋯] ┐ sticky
◉ सोनू पटेल (🏷 छोटू)        1:29 pm    │        कल सुबह 10 बजे आ जाओ ▸│ mine: navy
  🎤 आवाज़ · 0:12               (2)     │◂ [▶ ━━○──── 0:12  1×]        │ theirs: surface
◉ अनिल शर्मा (🏷 पक्का उस्ताद)   कल      │   "क्लच प्लेट का नंबर?"        │ summary
  📷 फ़ोटो                              │  ✓✓ देखा                      │ seen (kept)
                                       ├───────────────────────────────┤
                                       │ [ संदेश लिखो… ] [🎤] [भेजो ➤]   │ sticky; dock hidden
                                       └───────────────────────────────┘
```

- Kept: request accept/decline, request-only rules note, report + block in `⋯`, scam-hold note, photos, seen ticks.
- **Motion:** new message bubble fades in 150 ms; nothing else. **a11y:** thread list is a `<ul>` of links with
  name + last-message text + unread count in the name; the message log is `role="log"` with polite updates; composer
  field has a visible label (sr-only text "संदेश") and the mic has its word in the name.
- **Data/API:** existing; thread "closed" flag: derive from the existing member status on the thread DTO if present,
  otherwise add `closed: boolean` to the thread view (read-only, computed — small API change, in U3).
- **Events:** existing `ustaad_message_thread_started`, `ustaad_voice_played`; new `ustaad_voice_speed_changed {speed}`.
- **Copy (`ustaad.messages.*`):** `previewVoice` "Voice · {duration} / आवाज़ · {duration}", `previewPhoto` "Photo /
  फ़ोटो", `closed` "This conversation is closed / यह बातचीत बंद है", `requestsTab` "Requests ({count}) / अनुरोध
  ({count})".

### 3.8 Me, ID card, profile, levels and Izzat — [board #profile-grid], [board #badges-levels-streaks]

**Today (Me):** My card (orange strip "MechDost Ustaad card", handle, avatar, name, garage + area, years, level chip,
verified, specialities, Share on WhatsApp), See verification progress, Izzat / Followers / … tiles, level ladder,
badges, my work, My choices, standing link, location, help/tutorial replay. **Profile (`/u/[handle]`):** card, counts,
Works on, Follow / Connect / Message / `⋯`, posts.

Kept on Me (not all drawn): handle, garage + area, years, specialities, Share on WhatsApp, QR, See verification
progress, Izzat and **Followers** (counts visible, ruling), level ladder (inside "next level" + level sheet), badges,
my work, My choices, standing link, location, tutorial replay. Kept on Profile: card, counts, Works on, Follow /
Connect / Message / `⋯`, request-only note, posts.

**Change — the Pehchaan tag (the one bold element).** A level chip shaped like a garage key tag: a rounded rectangle
with one angled end and a punched hole (CSS `clip-path` + radial mask, or a 1 KB inline SVG background), text = level
name, always with the word. Colours from existing tokens only, contrast-tested in both themes:

| Level                                    | Light (bg / text)                                                  | Dark (bg / text)                      |
| ---------------------------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| Chhotu (`apprentice`)                    | `pill` / `ink`                                                     | `surface-alt` / `ink`                 |
| Ustaad, check pending (`ustaad_pending`) | `surface` + 1.5 px dashed `input-border` / `ink`, word "जाँच बाकी" | same, dark tokens                     |
| Naya Ustaad                              | `accent-soft` / `accent-soft-text`                                 | `accent-soft` / `accent-soft-text`    |
| Pakka Ustaad                             | `navy` / white                                                     | `surface-alt` + 1 px `accent` / `ink` |
| Bada Ustaad                              | `accent-button` / white                                            | `accent-button` / white               |
| Master Ustaad                            | `navy` + 2 px `accent` inner border / white                        | `navy` + 2 px `accent-light` / white  |

Tapping a tag anywhere opens the **level sheet**: "पक्का उस्ताद क्या है" — the rule groups in plain words, the perk
text (admin-edited), and for my own tag "आपकी स्थिति" with the numbers (RS3, R23).

```
Me
┌ ID card (navy pass) ──────────────────┐
│ MechDost उस्ताद कार्ड       @suresh_5416 │
│ ◉ 72  सुरेश यादव                        │
│       सुरेश ऑटो वर्क्स, गुढ़ियारी          │
│       काम का अनुभव 10 साल               │
│ (🏷 नया उस्ताद)  ✓ MechDost से वेरिफ़ाइड   │
│ (बैटरी) (बाइक-स्कूटर)                    │
│ [ WhatsApp पर कार्ड भेजो ]   [▦ QR]      │ ONE primary
└───────────────────────────────────────┘
[ वेरिफ़िकेशन कहाँ तक पहुँचा देखो ]          ← kept (pending members: shown above "next level")
अगला लेवल: पक्का उस्ताद
  सबसे अच्छे जवाब  ████████░░ 17/25  → 8 और
  फ़ॉलोअर (गिनती वाले) ████░░░░░ 41/100 → 59 और
  [ये कैसे गिने जाते हैं?]
इज़्ज़त 214 │ फ़ॉलोअर 41 │ जवाब 33 │ सबसे अच्छे 17   ← one compact stat row (all of today's counts kept, followers visible per ruling)
बैज  (🔋 बैटरी एक्सपर्ट) (🤝 मददगार) (🔒 वायरिंग जादूगर — 3 और जवाब)
मेरा काम  [Fix log ▢][Before/After ▢]   ← 2-column tiles with template label
          [Tip ▢]    [Video ▢]
──────────
मेरी पसंद · मेरा खाता · मेरी जगह · कैसे इस्तेमाल करें · नेटवर्क के नियम
```

- Progress rows use the best-progressing rule group (closest to complete) and only numbers the member can act on;
  staff-review levels say "MechDost टीम जाँच करेगी" at the end.
- Badge shelf: held badges in colour; not-yet badges outlined with the rule ("3 और जवाब"), never greyed to invisibility.
- **Profile of others:** same card in `surface` style; Follow = primary; Message and Connect outlined; `⋯` for report /
  block; "Best answers" and "Work" tabs (2-column tiles, not a square grid). The private standing card is **never** on
  top of the ID card for a member in good standing (it moves to the settings list; banned members keep BannedGate).
- **Data/API:** existing `GET /ustaad/me/card` (`izzat`, `answers`, `bestAnswers`, `videos`, `recommendations`,
  `qualifiedFollowers`, `ladder[].groups`, `badges[].rule/held`). Badge "how far" numbers: compute client-side from
  the same counts where the badge rule is a count; otherwise show the rule text only. Profile tabs: existing member
  posts endpoint filtered by template client-side; "Best answers" tab uses the existing member answers list if
  present, else **new** `GET /ustaad/members/{handle}/best-answers?cursor=` (U4, read-only).
- **Events:** existing `ustaad_profile_updated`, `ustaad_post_shared {channel}`; new `ustaad_level_sheet_opened
{level, own}`, `ustaad_card_shared {channel}`, `ustaad_badge_opened {badge}`.
- **a11y:** progress rows are `<progress>` with text values; tag has no meaning by colour (name always printed);
  card is a `<section aria-label="My card">`; QR has a text alternative (handle link).
- **Copy (`ustaad.card.*`):** `nextLevel` "Next level: {level} / अगला लेवल: {level}", `more` "{n} more / {n} और",
  `howCounted` "How are these counted? / ये कैसे गिने जाते हैं?", `teamCheck` "The MechDost team will check / MechDost
  टीम जाँच करेगी", `levelSheetTitle` "What is {level}? / {level} क्या है?", `yourStatus` "Where you are / आपकी स्थिति",
  `badgeLocked` "{n} more to earn / पाने के लिए {n} और", `tabBest` "Best answers / सबसे अच्छे जवाब", `tabWork` "Work /
  काम", `sendCard` "Send my card on WhatsApp / WhatsApp पर कार्ड भेजो".

### 3.9 Notifications — [board #notifications]

**Today:** the site-wide `/notifications` page (bell inbox, spec 10); `/ustaad/notifications` redirects there
(SIM-RT2); rows for the network mixed with order alerts; Batch D fixes Hindi rendering (keys + params).

**Change (light, extends spec 23 § 5 "notices filtered to the network"):** a filter chip row "सब · उस्ताद · ऑर्डर ·
सर्विस"; rows grouped "आज / कल / इस हफ़्ते"; each network row has a type icon + word (जवाब, सबसे अच्छा जवाब, फ़ॉलो,
नौकरी, चेतावनी), the actor's avatar when there is one, and one inline action where natural (job application → "देखो";
vouch request → "जवाब दो"). Unread dot + bold title; "सब पढ़ा हुआ करो" once at the top.

```
सूचनाएँ                          [सब पढ़ा हुआ करो]
(✓ सब) (उस्ताद) (ऑर्डर) (सर्विस)
आज
● 🏆 सबसे अच्छा जवाब   आपका जवाब चुना गया · Splendor   2 घंटे
● 💼 नौकरी             नया आवेदन · सोनू पटेल        [देखो]
  👤 फ़ॉलो              अनिल शर्मा ने फ़ॉलो किया       5 घंटे
कल
  ⚠ चेतावनी             आपकी पोस्ट हटाई गई            [क्यों?]
```

- **Motion:** none. **a11y:** day groups are headings; unread is a word in the name ("नई"), not the dot alone; filter
  chips are links (URL state); inline actions are buttons/links with specific labels.
- **Data/API:** existing inbox with `kind`; filter by kind prefix `ustaad.` client-side or via existing query param if
  present. **Events:** new `notifications_filter {filter}`. **Owner:** U4 (after Batch D lands; touch only the
  filter/grouping, not the text rendering).

### 3.10 Composer, camera and voice recorder — [board #composer-camera], [board #voice-notes]

**Composer today:** "Show your work" with 7 kind tiles (Voice, Photos, Video, Write, Poll, Link, PDF) + Quick start
(Fix log, Tip, Before/After), tags, smart correction, draft restore, upload progress, story mode.

**Change.**

- Three big tiles first — **🎤 बोलो**, **📷 फ़ोटो खींचो**, **🎥 वीडियो** — then "काम दिखाने के तरीके" (Fix log,
  Before/After, Tip) and "और" (Write, Poll, Link, PDF) collapsed. Same 10 choices, calmer first view.
- Photo: two buttons "📷 कैमरा" (`<input accept="image/*" capture="environment">`) and "🖼 गैलरी"; Before/After shows two
  labelled slots "पहले" / "बाद में" with the role preset (existing `role`).
- Fix log: three labelled text fields (खराबी / वजह / क्या किया) plus one optional voice note for the whole log
  (no dictation per field: speech-to-text is ruled out, spec 23 provider ruling 1).
- Draft kept locally (text + voice take) and "छोड़ दें?" confirm on leaving with changes (audit #21).
- One primary "पोस्ट करो" sticky at the bottom; disabled-with-reason text when empty.

```
अपना काम दिखाओ                                  [✕]
┌──────────┐┌──────────┐┌──────────┐
│   🎤     ││   📷     ││   🎥     │   96 px tiles, word under icon
│  बोलो    ││फ़ोटो खींचो ││  वीडियो   │
└──────────┘└──────────┘└──────────┘
काम दिखाने के तरीके
[🔧 फ़िक्स लॉग] [◧ पहले/बाद में] [💡 टिप]
[⋯ और: लिखो · पोल · लिंक · PDF]                 ← collapsed, same choices as today
─ after choosing Before/After ─
┌ पहले ──────┐ ┌ बाद में ────┐
│ [📷 कैमरा]  │ │ [📷 कैमरा]  │
│ [🖼 गैलरी]  │ │ [🖼 गैलरी]  │
└────────────┘ └────────────┘
टैग · कैप्शन (smart correction kept) · ड्राफ़्ट वापस लाओ (kept)
[ पोस्ट करो ]                                   ← sticky, ONE primary
```

- **Motion:** "और" expands with opacity only; upload progress bar (exists) uses `transform: scaleX`. **a11y:** tiles
  are buttons in a radio-like group with `aria-pressed`; the two photo slots are labelled groups; errors beside the
  field; focus moves to the first field of the chosen template.

**Recorder (approved upgrade, § 6).** **VoiceNote player** (§ 6.3).

- **Events:** existing `ustaad_post_created {kind, template, …}`; new `ustaad_composer_more_opened {}`,
  `ustaad_camera_opened {source: camera|gallery}`.
- **Copy (`ustaad.feed.*` composer keys):** `tileVoice` "Speak / बोलो", `tileCamera` "Take photo / फ़ोटो खींचो",
  `tileVideo` "Video / वीडियो", `workWays` "Ways to show your work / काम दिखाने के तरीके", `camera` "Camera / कैमरा",
  `gallery` "Gallery / गैलरी", `post` "Post / पोस्ट करो", `leaveConfirm` "Leave without posting? / बिना पोस्ट किए
  छोड़ दें?".

### 3.11 First run and tutorial — [board #onboarding]

**Today:** join (5 steps), `/ustaad/welcome` tutorial cards with narration, coach-marks, privacy consent sheet (site),
voice consent before first recording.

**Change:** never stack: on the first network visit the order is (1) site privacy choice (if not given), (2) tutorial
cards, (3) **one** coach-mark on the hero mic; coach-marks wait while any sheet is open (board observation: consent
sheet over a coach-mark over the feed). Language: the page's locale with the switch on card 1 (R18). No new screens.

### 3.12 Admin

Nothing in this upgrade needs a new admin setting. Existing settings still govern behaviour (`feed.*`, `stories.*`,
`levels.*`, `learn.*`). The "new posts" poll interval (90 s) is a constant in v1; if the founder wants it editable it
becomes `feed.new_posts_poll_seconds` (spec 23 § 15 table) — listed, not built.

---

## 4. Enhancements ranked (impact × effort)

Effort S ≤ ½ day, M ≤ 2 days, L > 2 days (one builder). "Spec" says what authorises it.

| #   | P   | Impact | Effort | Enhancement                                                                                             | Spec authority                                                                 | Batch                       |
| --- | --- | ------ | ------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------- |
| E1  | P0  | High   | M      | No-shift frame + per-page real-shape skeletons (CLS 0.83 → < 0.05)                                      | spec 23 § 17; audit #1 (approved)                                              | U1                          |
| E2  | P0  | High   | M      | One compact network header; storefront chrome hidden inside `/ustaad`; dock words + current-tab bar     | spec 23 § 5 (one tab bar, shared frame); audit #10, #18 (approved)             | U1                          |
| E3  | P0  | High   | M      | Recorder upgrade: Stop word, Cancel, time-left announcements, review player, tap alternative            | decisions 2026-11-27 night (approved)                                          | U3                          |
| E4  | P0  | High   | M      | Typed summary on every voice item and video; shown, searchable, moderated                               | decisions 2026-11-27 night (approved); audit #12/#13                           | U3                          |
| E5  | P0  | High   | S      | VoiceNote: duration, progress, speed 1×/1.5×/2×, one player at a time, author in the name               | decisions 2026-11-27 night (approved); audit #16                               | U3                          |
| E6  | P1  | High   | M      | Pehchaan tag (key-tag level chip) on every name + level sheet                                           | spec 23 § 9.2 (levels shown), RS3/RA4; **decisions entry for the shape**       | U2 (component) / U4 (sheet) |
| E7  | P1  | High   | S      | Next-level progress in numbers on Me                                                                    | spec 23 § 5 Me "level ladder"; § 9.2 "level card shows qualified followers"    | U4                          |
| E8  | P1  | High   | M      | Template-aware post bodies: Fix log rows, Before/After toggle, Tip panel                                | spec 23 § 6.3 `template` + `fix_*` fields                                      | U2                          |
| E9  | P1  | Med    | S      | Best-answer stamp + "Choose as best" under each answer for the asker                                    | spec 23 § 5 q-thread "best answer"; RS4                                        | U3                          |
| E10 | P1  | Med    | M      | Story rings with real states + viewer with visible controls, tap-to-play media                          | spec 23 § 5 stories, § 4 flow 6                                                | U1                          |
| E11 | P1  | Med    | S      | "New posts" pill (no auto-jump), tab scroll memory                                                      | spec 23 § 9.5 snapshot feed; memory "no-reload-feel"                           | U1                          |
| E12 | P1  | Med    | S      | Double-tap to like + optimistic like/save/follow with rollback                                          | spec 23 § 5 feed like/save; § 16 `ustaad_post_liked`                           | U2                          |
| E13 | P1  | Med    | S      | Home: hero as one row, stories first, 4 shortcuts + More, "waiting for your answer" strip               | spec 23 § 5 Home (same items)                                                  | U1                          |
| E14 | P1  | Med    | S      | Composer: 3 big tiles first, camera/gallery buttons, labelled Before/After slots, draft + leave confirm | spec 23 § 5 composer; audit #21                                                | U2                          |
| E15 | P1  | Med    | S      | Learn: Chhotu "7/10 videos for Naya Ustaad", watched/half-watched, size on cards, compact data saver    | spec 23 § 9.2 rule B; § 17 (size shown)                                        | U4                          |
| E16 | P1  | Med    | S      | Jobs card: pay, verified garage, scam line on the card; compact page warning                            | spec 23 § 5 jobs; RS5 (approved list)                                          | U4                          |
| E17 | P1  | Med    | S      | Messages: familiar inbox rows, sticky thread header/composer, closed-thread state                       | spec 23 § 5 messages; SIM-P34 "not done"                                       | U3                          |
| E18 | P2  | Med    | M      | Similar questions while asking                                                                          | **spec addition** to § 5 `/ustaad/ask/new` (lead may approve; no product rule) | U3                          |
| E19 | P2  | Low    | S      | Haptic tick on record start/stop and like (feature-detected)                                            | spec 23 § 1 "familiar patterns"; ux guideline (R16)                            | U3                          |
| E20 | P2  | Med    | S      | Notifications filter chips + day groups + one inline action                                             | spec 23 § 5 "notices filtered to the network"                                  | U4                          |
| E21 | P2  | Med    | M      | Profile tabs: Work tiles (2-col, template label) and Best answers                                       | spec 23 § 5 `/ustaad/u/[handle]` "posts"                                       | U4                          |
| E22 | P2  | Low    | S      | Badge shelf with "N more" for count-based badges                                                        | spec 23 § 9.3                                                                  | U4                          |
| N1  | P2  | Med    | M      | Weekly "You helped N mechanics this week" note (instead of any streak)                                  | **new — needs founder OK** (Q2)                                                | —                           |
| N2  | P2  | Med    | M      | "Kaam ki baat / Useful" second reaction on posts                                                        | **new — needs founder OK** (Q3)                                                | —                           |
| N3  | P2  | Med    | L      | Auto-suggested summary / auto-captions from a speech provider                                           | **new — needs founder OK** (Q4); amends spec 23 provider ruling 1              | —                           |
| N4  | P2  | Low    | M      | Waveform on voice notes (peaks computed on the phone at record time, stored as ≤ 64 bytes)              | **new — spec addition** (new `ustaad_media.peaks` column)                      | —                           |
| N5  | P2  | Low    | M      | Story "highlights" kept on the profile past 24 h                                                        | **new — needs founder OK** (stories purge after expiry, § 6.3)                 | —                           |
| N6  | —   | —      | —      | Dock: Home · Ask · + · Jobs · Me (Learn/Discover from Home and header)                                  | **already queued founder decision** (audit #19; Q1)                            | —                           |

**Rejected on purpose:** daily streaks and leagues (R24), downvotes (RS4, board #qa-best-answer), photo filters /
beautify (honest shop-floor photos), square 3-column profile grid (distinctive Instagram layout), overlay heart-burst,
gradient rings, any "gems/points" visual (Izzat never looks like money).

---

## 5. Text alternatives for voice and video (founder-approved)

**Goal:** every voice item (question, answer, message, comment, audio post, story) and every video has text a person
can read when they cannot or may not listen, that search finds, and that moderators see (WCAG 1.2.1 audio-only
alternative, 1.2.2 captions; audit #12/#13).

### 5.1 v1 — author-written summary (buildable now, no provider)

- **Data:** migration adds to `ustaad_media`: `summary text NULL CHECK (char_length(summary) <= 280)`,
  `summary_source text NULL CHECK (summary_source IN ('author'))` (enum widened to `suggested` only with N3),
  `summary_updated_at timestamptz NULL`. One summary per media item, so posts, answers, questions, messages,
  comments and stories all get it through the media they already reference. `version` is bumped on edits
  (conditional UPDATE). ML-ready: free text is an extra note; the language is detected later, not stored now.
- **Write paths:** (a) at upload declaration: `POST /ustaad/media` body gains optional `summary` (Zod `string().trim()
.min(1).max(280)`); (b) later: `PATCH /v1/ustaad/media/{id}/summary {summary, version}` — owner only (actor-scoped,
  404 for others), refused while the parent item is held/removed, rate limit `membershipWrites`, writes
  `ustaad_events` `media_summary_set`. Both run the **same checks as body text**: banned words, phone-number and link
  blocks (§ 14), smart correction per the member's mode (§ 11; suggest never replaces).
- **Read paths:** every DTO that carries a media item (`PostMediaView`, question/answer/message/comment media) gains
  `summary: string | null`. Moderation queue item shows it. Search: question FTS vector and Discover search include
  the summaries of the question's and accepted answer's media (trigger or repository update in the same transaction).
- **UI:** the recorder's review step shows "इसमें क्या है? 1–2 लाइन में लिखो (ज़रूरी नहीं) / What is in it? Write 1–2
  lines (optional)" with a 280-character counter; the video picker shows the same field. Under every player the
  summary shows as user text (`data-user-content`, `dir="auto"`), linked by `aria-describedby`. When absent, the
  player name still says what it is ("Suresh का आवाज़ वाला जवाब, 0:42"); the owner sees a quiet "सार जोड़ो / Add a
  summary" link on their own item.
- **Nudge, not gate:** optional (founder: "short typed summary … author-written"); show a one-line reason ("जो सुन
  नहीं सकते वो भी समझ पाएँगे / People who can't listen will understand too"). Measure fill rate.
- **Events:** `ustaad_media_summary_added {kind, at: upload|later, length_band}` (server).

### 5.2 Captions for video

- v1: if a video has a summary, it is shown under the player; **no `<track>` until a caption file exists.**
- Later (N3, founder Q4): `ustaad_media_captions (media_id, lang, object_key, source auto|author, status, created_at)`
  with WebVTT in the media bucket and a `<track kind="captions" srclang>` + "CC" toggle. Needs: the provider
  research the night decision asked for (cost per minute, Hindi/Hinglish quality), a DPDP purpose consent for sending
  voice to that provider (extends the existing `ustaad_voice` consent), and an amendment to spec 23 provider ruling 1
  ("No speech-to-text at all") recorded in `docs/decisions.md`. **Conflict flagged:** the night decision mentions an
  auto-caption provider; spec 23 § 1/§ 22 still rule speech-to-text out — the builder must not add a provider until
  the founder answers Q4 and the decisions entry amends the ruling.

---

## 6. Recorder upgrade (founder-approved)

### 6.1 States

```
idle ──tap/hold mic──▶ (consent? once) ──▶ recording ──Stop/let go──▶ review ──Send──▶ uploading ──▶ done
                                             │  └─Cancel / pointer-cancel─▶ idle (discarded, announced)
                                             └─ max length reached ─▶ review (announced)
review ──"फिर से बोलो"──▶ idle (take discarded) · review ──"हटाओ"──▶ idle
```

### 6.2 Recording screen (inline in Ask, answer, messages, apply, composer)

```
┌───────────────────────────────────────┐
│ ● रिकॉर्ड हो रहा है   0:12 / 2:00        │ live timer (role=timer, not live-announced each second)
│ ▁▃▅▂▆▃▁▄▆▃  ← level bars (CSS, from AnalyserNode; static under reduced motion)
│ [ ✕ रद्द करो ]            [ ■ रोको ]      │ 48 px; Stop = primary (white on error-dark-safe token)
└───────────────────────────────────────┘
```

- **Hold-to-talk** stays (WhatsApp habit, spec 23 § 1); **tap to start / tap "रोको" to stop** is the equal
  alternative (WCAG 2.5.7); the button's accessible name changes "आवाज़ रिकॉर्ड करो" → "रिकॉर्डिंग रोको" (audit #9).
- **Cancel** visible beside the timer; releasing a hold outside the button or `pointercancel` = discard with the
  announcement "रिकॉर्डिंग हटा दी" (no slide gesture needed).
- **Time left:** `aria-live="polite"` messages at 30 s and 10 s before the admin max (`media.voice_max_s`, default 120 s; `qa.voice_max_s` on Ask) —
  "30 सेकंड बचे", "10 सेकंड बचे"; at the max, recording stops and review opens ("समय पूरा, सुन लो").
- Minimum length (existing `MIN_MS`) → friendly retry "थोड़ा लंबा बोलो, फिर से कोशिश करो" (never "error").
- Haptic: `navigator.vibrate?.(10)` on start and stop when available (E19).
- Mic permission denied → one-line help with a "कैसे चालू करें" link (existing copy area), and the text field stays.

### 6.3 Review and the shared VoiceNote player

```
[▶] ━━━━━━○──────── 0:12 / 0:42   [1×]
"सेल्फ़ दबाने पर टक-टक आवाज़"            ← summary (user text) or the summary field in review
[↺ फिर से बोलो]  [🗑 हटाओ]          [भेजो ➤]
```

- Replaces the native `<audio controls>` in review **and** `media/voice-note.tsx` everywhere (one component).
- Play/pause button named with author + length; progress is `<input type="range">` (seekable, keyboard arrows ±5 s)
  with `aria-valuetext="0:12 of 0:42"`; speed button cycles 1× → 1.5× → 2× (`playbackRate`), remembered per viewer
  (`localStorage`, try/catch).
- **One player at a time:** a tiny module-level registry pauses any other `HTMLAudioElement` it started.
- `preload="none"`; duration from the DTO's `durationMs` (no metadata fetch before tap, RS6); size shown on video only.
- Dark and light contrast: controls on `surface` / `navy` both ≥ 4.5:1 for text, ≥ 3:1 for the track.
- **Events:** existing `ustaad_voice_played`, `ustaad_voice_start/stop/rerecord/remove` (data-track); new
  `ustaad_voice_cancelled {at_seconds_band}`, `ustaad_voice_speed_changed {speed}`, `ustaad_voice_time_up {}`.
- **Copy (`ustaad.media.*`):** `recording` "Recording / रिकॉर्ड हो रहा है", `stop` "Stop / रोको", `stopAria` "Stop
  recording / रिकॉर्डिंग रोको", `cancel` "Cancel / रद्द करो", `discarded` "Recording deleted / रिकॉर्डिंग हटा दी",
  `left30` "30 seconds left / 30 सेकंड बचे", `left10` "10 seconds left / 10 सेकंड बचे", `timeUp` "Time's up — listen
  to it / समय पूरा, सुन लो", `tooShort` "Speak a little longer and try again / थोड़ा लंबा बोलो, फिर से कोशिश करो",
  `rerecord` "Record again / फिर से बोलो", `remove` "Delete / हटाओ", `send` "Send / भेजो", `playName` "{name}'s voice
  note, {duration} / {name} का आवाज़ संदेश, {duration}", `speed` "Speed {speed} / रफ़्तार {speed}", `summaryLabel`
  "What is in it? Write 1–2 lines (optional) / इसमें क्या है? 1–2 लाइन में लिखो (ज़रूरी नहीं)", `summaryWhy` "People
  who can't listen will understand too / जो सुन नहीं सकते वो भी समझ पाएँगे", `addSummary` "Add a summary / सार जोड़ो".

---

## 7. Performance plan (CLS < 0.05, ≤ 150 KB gz first-load on member routes)

**Evidence:** Lighthouse signed-in `/hi/ustaad` Performance 52, **CLS 0.822**, TBT 834 ms, 455 KB same-origin JS by
network idle; CI first-load figure 226.8 KB before the split (spec 23 § 17); LCP 5.9–6.8 s on post, Discover,
question, messages (audit F-R10, #14). **Cause:** `UstaadGate` renders a 384 px skeleton until hydration and the
tester probe finish, then swaps in the whole frame + page; `main` and the footer move together (0.78–0.85 on Home).
The JS metric we gate on is **`apps/web/scripts/measure-js.mjs` first-load gz per route** (the CI budget), with the
Lighthouse total recorded alongside.

**Constraint found:** the session is client-side (`@/demo/session`, Firebase in the browser; only `/cart` reads
cookies), so the server cannot know who is a member. During `staff_preview` the frame must not show the network's
name to outsiders (review 2026-11-26, SIM-B1 still open). So "server-render the member shell" is possible only when
`ustaad.access = open`.

**Plan (U1 owns it):**

1. **Neutral full-height frame now (both access modes).** The gate's placeholder becomes a frame with the final
   geometry and **no network words**: header bar (56 px, empty), content area `min-h-[calc(100dvh-56px-64px)]`, dock
   area (64 px, empty) — so the footer can never enter the first viewport and nothing below moves. Gate swap then
   replaces equal-height boxes → CLS ≈ 0 from the frame.
2. **When `access = open`:** the layout renders the real header + dock on the server (they hold no member data) and
   the gate wraps only the content column; sign-in and join cards render inside the same reserved column.
3. **Per-page skeletons in the real shape** inside the reserved column (Home: story row 96 px + hero 120 px + 2 post
   skeletons; Me: ID card 280 px + progress 120 px; lists: 3 rows of the row height), shown only after 300 ms (no
   flash), `aria-busy` on the region. MemberGate's banner keeps its reserved height (exists).
4. **Reserved slots** for every async badge/count (Pehchaan tag min-width per level name in Hindi, counts with
   `min-w` + `tabular-nums`), images with width/height or `aspect-ratio`, story ring row fixed height.
5. **JS:** (a) load only the needed client messages — Home passes `['ustaad.shell','ustaad.home','ustaad.feed',
'ustaad.labels']`, not the whole `ustaad` namespace (it is the largest JSON block in `en.json`); (b) dynamic import
   on intent: `CommentsSheet`, `PostMenu`, `StoryViewer` (exist), plus `VideoTile` player, `VoiceRecorder`, level sheet,
   "More" sheet, similar-questions panel; (c) no new runtime dependency (no animation, gesture or audio library —
   the level meter is ~40 lines over `AnalyserNode`, the player is the native `HTMLAudioElement`); (d) Pehchaan tag
   is CSS (no SVG sprite per render).
6. **LCP:** on post, question, thread and profile pages the first media/avatar gets `priority` + `sizes="100vw"` with
   `img_480` on phones and LQIP; in the feed only the first story row is `priority` (spec 23 § 17).
7. **Hiding the storefront chrome inside `/ustaad`** is decided in the server HTML (layout marker + `html:has()`),
   never after hydration, so it removes first-paint work without adding a shift (E2) — measure the delta.
8. **Motion budget:** CSS only (`transform`/`opacity`), durations from tokens (150/220 ms), `@media
(prefers-reduced-motion: reduce)` turns all of it off (existing utilities `press`, `skeleton`, `animate-page-in`).
9. **Gate:** `measure-js.mjs` ≤ 150 KB gz on `/[locale]/ustaad`, `/ustaad/ask`, `/ustaad/q/[code]`, `/ustaad/me`,
   `/ustaad/messages/[id]`; Lighthouse signed-in CLS < 0.05 and Performance ≥ 90 on Home and the post page; the lead
   verifies live (audit Batch C note).

---

## 8. Build plan — four independent builder batches

### 8.0 Rules for all batches

- **Every brief embeds `.claude/skills/mechdost-advisor/references/agent-brief.md`** (mechdost-advisor first with the
  brief quoted; UI chain as skills: accessibility-lead → ui-ux-pro-max → shadcn-component-discovery → shadcn →
  frontend-design → shadcn-component-review + web-design-guidelines; core-web-vitals + performance; next-intl-hindi;
  website-testing → verification-before-completion; learnings).
- **Absorbs fix-plan Batch C items that touch the same files** (so two builders never edit one file): audit #1, #9,
  #10, #18, #20, #21, SIM-P12, SIM-P8 targets, Devanagari line-height. Batch D (Hindi bell text) and E (admin) stay
  separate and touch none of these files.
- **File ownership:** a file is edited by exactly one batch (lists below). Shared files:
  - `packages/shared/src/i18n/en.json` / `hi.json`: each batch adds keys **only inside its own sub-namespaces**
    (U1: `ustaad.shell`, `ustaad.home`, **new `ustaad.story`** (story ring + viewer keys, moved out of `feed` so U1
    and U2 never share an object); U2: `ustaad.feed`; U3: `ustaad.media`, `ustaad.qa`, `ustaad.messages`; U4:
    `ustaad.card`, `ustaad.learn`, `ustaad.jobs`, `ustaad.network`, `ustaad.discover`, `notifications`). Append at
    the end of each object; the lead merges sequentially and runs the Hindi coverage e2e after each merge. (Wherever
    § 3 writes `ustaad.feed.story*`, read `ustaad.story.*`.)
  - `apps/web/src/components/ustaad/shell/icons.tsx`: **U1 only**. U1's first commit adds every new icon listed here:
    `before`, `after`, `fixlog`, `tip`, `camera`, `gallery`, `speed`, `stopSquare`, `cancel`, `helpful`, `bestStamp`,
    `shield`, `progress`, `prev`, `next`, `tag`. Others use these names and rebase on that commit.
  - `apps/web/src/app/[locale]/globals.css`: **U1 only** (`:lang(hi)` line-height, dock scroll padding, chrome hiding,
    ring classes). The Pehchaan tag's styling lives **inside its own component** (Tailwind classes + a small inline
    SVG mask), so U2 owns the tag, its tokens test and its decisions entry end to end.
  - `apps/web/src/components/ustaad/common.tsx`, `feed/social-common.tsx`: **U2 only** (shared `MemberName`,
    `PehchaanTag`, `Avatar`). U3/U4 import them; until U2 lands they rebase on U2's first commit (component stub with
    final props committed first).
  - **Route `page.tsx` files belong to the batch that owns the screen** (U1: `ustaad/page.tsx` + `layout.tsx`; U2:
    `create`, `p/[id]`, `saved`, `tags/[slug]`; U3: `ask/**`, `q/[code]`, `messages/**`; U4: `me/**`, `u/[handle]`,
    `learn`, `jobs/**`, `network`, `discover`). Each batch narrows `ClientMessages` namespaces and adds its
    `ShapeSkeleton` variant on its own pages; U1 ships `ShapeSkeleton` (in `common/shape-skeleton.tsx`) in its first
    commit together with the icons.
  - **Edge-to-edge feed items** are done inside U2's post card (`-mx-4 tab:mx-0` against the layout's `px-4`), so U2
    does not depend on U1's layout padding.
  - `docs/specs/23-ustaad-network.md`: each batch appends **its own** "§ 21i-U{n} as built" subsection; spec § 16
    events: U-batches append to one bullet each, prefixed with the batch id. `docs/decisions.md`: one dated entry per
    batch. `docs/progress.md`: one line per batch.
- **Merge order:** U2 first commit (tag + name stubs) → U1 icons commit → then any order; lead merges U1 → U2 → U3 → U4.

### 8.1 U1 — Shell, performance, Home and stories

- **Screens:** shell (all member pages), Home, story row + viewer, feed list wrapper ("new posts" pill, tabs).
- **Files:** `apps/web/src/app/[locale]/ustaad/layout.tsx`, `components/ustaad/shell/ustaad-gate.tsx`,
  `shell/ustaad-nav.tsx`, `shell/icons.tsx`, `shell/public-switch.tsx` (only if the open-mode server frame needs it),
  `app/[locale]/ustaad/page.tsx`, `components/ustaad/feed/story-row.tsx`, `feed/story-viewer.tsx`,
  `feed/feed-list.tsx` (`HomeFeed` wrapper only; `PostList` item rendering is U2's), `tutorial/coach-mark.tsx`
  (no-stacking rule), `apps/web/src/app/[locale]/globals.css`, `apps/web/src/components/site/header.tsx` and
  `site/header-search.tsx` (hide the announcement strip, parts search and site header inside the network **in the
  server HTML**, so nothing shifts after hydration: the Ustaad layout renders a name-free marker element (e.g.
  `<span data-shell-compact hidden />`) and CSS `html:has([data-shell-compact])` hides the storefront chrome — the
  same `:has()` technique `globals.css` already uses for the assistant launcher; the path test `isUstaadPath` exists
  in `lib/portal-path.ts`), new `components/ustaad/common/shape-skeleton.tsx`, `apps/api/src/ustaad/**` feed route
  file + `packages/db` feed repository for `GET /v1/ustaad/feed/fresh` (+ DTO in `packages/shared/src/ustaad/dto/feed.ts`
  — U1 adds only the `FeedFreshDto` at the end of the file; U3's `summary` change touches the media view object, a
  different hunk).
- **Secrecy note:** with the chrome hidden by path, a refused viewer's "page not found" inside `/ustaad` renders
  without the storefront header. That is a weaker tell than today's 200 status for `/ustaad/*` (SIM-B1, open); when
  SIM-B1 makes refused requests a real server 404, the normal not-found page (with full chrome) is served and the
  tell disappears. The neutral frame still carries no network words.
- **Components:** `NetworkHeader`, `NeutralFrame`, `ShapeSkeleton` (variants home/card/list/thread), `NewPostsPill`,
  `StoryRing`, `HomeMoreSheet` (reuses `feed/sheet.tsx`), `QuestionsWaitingStrip`.
- **Data/API:** new `GET /v1/ustaad/feed/fresh?tab=&since=` → `{ count }` (§ 3.1; member gate, `memberReads`, role-leak
  test in staff preview and open, uses the existing feed candidate rules and index). **Skills extra:** `hono`,
  `drizzle-postgis-supabase`, `test-driven-development`.
- **Copy keys:** `ustaad.shell.home_logo_aria`; `ustaad.home.{heroAction,more,moreTitle,waitingTitle,answerNow,
newPosts,newPostsSr}`; `ustaad.story.{new,prev,next,pause,play,close}`.
- **Events:** `ustaad_shell_home_logo`, `ustaad_feed_new_pill_shown`, `ustaad_feed_new_pill_tapped`,
  `ustaad_home_more_opened`, `ustaad_home_question_tapped`, `ustaad_story_paused` (spec 23 § 16 + analytics catalogue).
- **Acceptance checks:** Lighthouse signed-in `/hi/ustaad` and `/en/ustaad/me` CLS < 0.05 (3 runs median) at 390 and
  1440; `measure-js.mjs` ≤ 150 KB gz on Home; during `staff_preview` a signed-out or non-tester page source contains no
  `ustaad.*` copy and no network name (frame is neutral); exactly one `aria-current` per page in hi and en; dock words
  visible at 360 px, current tab ≥ 3:1; storefront strip + parts search absent inside `/ustaad`, present elsewhere;
  focus not obscured by the dock on `/ustaad/jobs/new` (2.4.11); pill appears after a new post by another account
  without moving content; story viewer: Escape closes and focus returns, reduced motion = no auto-advance; axe 0 on
  Home; Hindi coverage e2e passes; visual snapshots 390/768/1440 light + dark.

### 8.2 U2 — Post card, feed media and composer

- **Screens:** post card (feed, post page, tag page, saved), photos/video, comments sheet entry, composer (`/ustaad/create`,
  story mode).
- **Files:** `components/ustaad/feed/post-card.tsx`, `feed/post-media.tsx`, `feed/comments-sheet.tsx`,
  `feed/feed-screens.tsx`, `feed/post-menu.tsx` (labels only), `feed/composer.tsx`, `feed/social-common.tsx`,
  `components/ustaad/common.tsx` (`AuthorLine` → uses `PehchaanTag`, `MemberName`), `media/image-picker.tsx`,
  `media/upload-progress.tsx`, new `components/ustaad/common/pehchaan-tag.tsx`, new `feed/fix-log-body.tsx`,
  new `feed/before-after.tsx`; `feed-list.tsx` `PostList` item part only (coordinate the one hunk with U1: U1 owns the
  file, U2 sends its hunk to the lead if needed — preferred: U2 changes nothing in `feed-list.tsx`).
- **Components:** `PehchaanTag` (props `level`, `size`, `onOpen?`; level sheet itself is U4's — U2 renders the button
  and calls `onOpen`, defaulting to a link to `/ustaad/me#levels`), `MemberName` (`data-user-content`, `dir=auto`),
  `FixLogBody`, `BeforeAfter`, `DoubleTapLike` wrapper, optimistic toggle hook `useOptimisticToggle`.
- **Data/API:** none new (template + `fix_*` + media `role` exist). Add `via` to the client like event.
- **Copy keys:** `ustaad.feed.{fixSymptom,fixCause,fixFix,before,after,tipTag,saved,likeFailed,videoMeta,tileVoice,
tileCamera,tileVideo,workWays,camera,gallery,post,leaveConfirm}`; `ustaad.labels.level_*` reused for the tag.
- **Events:** `ustaad_post_liked {via}`, `ustaad_before_after_toggled {to}`, `ustaad_composer_more_opened`,
  `ustaad_camera_opened {source}`.
- **Decisions entry:** "Pehchaan tag shape (key-tag level chip), tokens only" + tokens test for the five level pairs
  in light and dark (`apps/web/test/tokens.test.ts`).
- **Acceptance checks:** fix log renders `<dl>` with three rows in hi/en; before/after toggle is a radio group, keyboard
  operable, side-by-side ≥ 600 px; double-tap likes once and never unlikes, button stays; failed like rolls back with a
  toast; Saved says "सेव किया"; feed post edge-to-edge at 360/390 with no horizontal scroll; composer shows 3 big tiles +
  2 groups and still offers all 10 kinds; camera input has `capture`; draft survives navigation and a leave confirm
  appears; tag contrast ≥ 4.5:1 for all five levels in both themes; unit tests for `useOptimisticToggle` and the
  double-tap window; `measure-js.mjs` Home and post page within budget; Hindi coverage e2e; axe 0 on post page.

### 8.3 U3 — Voice, Ask and Messages (incl. summaries API)

- **Screens:** recorder (everywhere), VoiceNote player (everywhere), Ask list, ask composer, question thread, messages
  inbox and thread.
- **Files (web):** `components/ustaad/media/voice-recorder.tsx`, `media/voice-note.tsx`, `media/listen-button.tsx`,
  new `media/audio-registry.ts`, new `media/level-meter.tsx`, new `media/summary-field.tsx`,
  `qa/ask-composer.tsx`, `qa/ask-list.tsx`, `qa/question-thread.tsx`, `messages/thread-list.tsx`,
  `messages/thread-view.tsx`, `messages/composer.tsx`, `messages/shared.tsx`, `messages/new-thread.tsx`,
  `lib/ustaad/client.ts` (new calls only), `app/[locale]/ustaad/ask/**`, `q/[code]/page.tsx`, `messages/**` pages.
- **Files (shared/API/DB):** `packages/shared/src/ustaad/dto/media.ts`, `dto/feed.ts` (media view `summary`), `dto/qa.ts`,
  `dto/messages.ts`; `packages/db` migration `ustaad_media` summary columns + repository changes (actor-scoped
  `setMediaSummary`, conditional UPDATE on `version`, `ustaad_events`), question search vector update;
  `apps/api/src/ustaad/**` routes `PATCH /v1/ustaad/media/{id}/summary`, summary on `POST /ustaad/media`,
  thread `closed` flag; OpenAPI. **`GET /v1/ustaad/questions/similar` (E18) only if the lead accepts the spec
  addition before the batch starts; otherwise U3 skips E18 entirely** (no UI stub).
- **Components:** `VoiceRecorder` v2 (states § 6.1), `VoiceNote` v2 (§ 6.3), `LevelMeter`, `SummaryField`,
  `SimilarQuestions`, `BestAnswerStamp`, `ChooseBestButton`.
- **Copy keys:** `ustaad.media.*` (§ 6.3 list), `ustaad.qa.{bestStamp,chooseBest,chooseBestConfirm,confirmYes,
confirmNo,helpful,answerVoice,answerType,similarTitle,stateSolved,stateOpen}`, `ustaad.messages.{previewVoice,
previewPhoto,closed,requestsTab}`.
- **Events:** `ustaad_voice_cancelled`, `ustaad_voice_speed_changed`, `ustaad_voice_time_up`,
  `ustaad_media_summary_added` (server), `ustaad_similar_shown`, `ustaad_similar_opened`.
- **Skills extra:** `drizzle-postgis-supabase` + `supabase-postgres-best-practices` (migration), `hono` (routes),
  `test-driven-development`.
- **Acceptance checks:** recorder — Stop has the word and changes the accessible name; Cancel discards and announces;
  pointer-cancel discards; 30 s / 10 s announcements fire once (fake timers); max length opens review; tap-only flow
  works without hold (2.5.7); consent still asked once (SIM-P10 test stays green). Player — duration shown before
  play without network fetch; seek by keyboard; speed cycles and persists; starting a second note pauses the first.
  Summary — Zod 1–280; phone number / link refused with the existing codes; owner-only PATCH (404 for others, 409 on
  stale `version`); held item refuses; search finds a question by its summary; summary rendered with
  `data-user-content`. Ask — best answer first with stamp; "Choose as best" only for the asker; similar questions
  return ≤ 3 solved items and never other cities' hidden content. Messages — closed thread shows the closed line
  before a send; voice bubble uses the new player. Role-leak test for the PATCH and similar routes; `pnpm check`;
  migration journal reconciled; Hindi coverage e2e; axe 0 on thread and Ask pages.

### 8.4 U4 — Me, profile, levels, Learn, Jobs, notifications, Discover polish

- **Screens:** `/ustaad/me` (ID card, next-level progress, stats row, badges, my work, settings list), level sheet,
  `/ustaad/u/[handle]`, `/ustaad/network`, `/ustaad/learn`, `/ustaad/jobs` + `[code]` + `new`, `/notifications` filter
  and grouping, `/ustaad/discover` (tag + card reuse only).
- **Files:** `components/ustaad/card/my-card.tsx`, `card/my-choices.tsx` (placement only), `card/verification-progress.tsx`,
  new `card/next-level.tsx`, new `card/level-sheet.tsx`, new `card/badge-shelf.tsx`, new `card/work-tiles.tsx`,
  `feed/profile-screen.tsx`, `network/network-view.tsx`, `discover/discover-view.tsx`, `learn/learn-view.tsx`,
  `jobs/jobs-view.tsx`, `jobs/job-applicants.tsx`, `jobs/job-post-form.tsx` (labels/targets only), `standing/standing-view.tsx`
  (placement only), the `/notifications` page's list component (filter + grouping only; Batch D owns text rendering),
  `app/[locale]/ustaad/me/**`, `u/[handle]`, `learn`, `jobs/**`, `network`, `discover` pages. Profile "Best answers"
  tab uses the existing `GET /ustaad/members/{handle}/answers` (spec 23 § 8); if it cannot filter best answers, add an
  optional `?best=1` query (read-only, same gate) rather than a new route.
- **Components:** `NextLevelProgress`, `LevelSheet` (wired to `PehchaanTag.onOpen` via a small context provider in
  `card/level-sheet.tsx`), `BadgeShelf`, `WorkTiles`, `JobCard`, `ScamLine`, `LearnProgress`, `NotificationFilters`.
- **Copy keys:** `ustaad.card.{nextLevel,more,howCounted,teamCheck,levelSheetTitle,yourStatus,badgeLocked,tabBest,
tabWork,sendCard}`, `ustaad.learn.{dataSaverShort,towardsNaya,watched,halfWatched,continue}`,
  `ustaad.jobs.{payRange,verifiedGarage,scamLine,learnMore,applyWithCard}`, `notifications.{filterAll,filterUstaad,
filterOrders,filterService,today,yesterday,thisWeek,markAllRead}` (check existing keys first).
- **Events:** `ustaad_level_sheet_opened {level, own}`, `ustaad_card_shared {channel}`, `ustaad_badge_opened {badge}`,
  `ustaad_learn_continue_tapped`, `ustaad_job_scam_line_opened`, `notifications_filter {filter}`.
- **Acceptance checks:** Me at 390 shows the ID card first for a member in good standing (standing panel only for
  banned/limited via the existing gates); next-level rows match `MyCardDto` numbers (unit test with fixtures for each
  level and the staff-review levels); level sheet opens from a tag on any page, closes with Escape, focus returns;
  `/en/ustaad/me` shows English level and badge names (SIM-P4 regression stays green); Learn shows "7/10" for a Chhotu
  fixture and nothing for an Ustaad; video card shows size and no bytes are fetched before tap; job card shows pay,
  verified tick and the scam line; selected job filter chip ≥ 3:1 in dark; notifications filter keeps the URL
  (`?filter=ustaad`) and back works; Hindi coverage e2e; axe 0 on Me, profile, Learn, Jobs; `measure-js.mjs` within
  budget on Me.

---

## 9. Questions for the founder (proposed; the lead queues them in `docs/questions-for-user.md` on accepting this doc — not queued yet)

Related already-queued items: audit #19 dock question (fix plan "Founder decisions needed"), Q-U-CE7 (Learn video
captions field, default: no captions).

1. **Bottom bar tabs** (already queued, audit #19): keep Home · Discover · + · Learn · Me, or Home · **Ask** · + ·
   **Jobs** · Me (Learn and Discover from Home)? _Default meanwhile: keep today's tabs; the design works with both._
2. **No streaks — a weekly "you helped N mechanics" note instead?** (N1) _Default: neither is built._
3. **A second reaction "Kaam ki baat / Useful" on posts** besides Like? (N2) _Default: Like only._
4. **Auto-captions / suggested summaries** need voice sent to an outside speech service (cost per minute, consent),
   which reverses the 2026-11-26 "no speech-to-text" ruling. Allow research + a paid trial later? (N3) _Default:
   author-written summaries only._

---

## 10. Self-review against the brief

- Inspiration not imitation: no reference colours, glyphs, names, mascots, square grid, overlay heart, gradient rings;
  the one bold element (Pehchaan tag) comes from garage material culture. Board "must NOT copy" notes apply.
- Real pages only: every screen lists "Today (keep all)"; new behaviour cites a spec line or sits in § 4 as "new".
- Tokens/fonts unchanged; one new shape → decisions entry in U2.
- Calm UI: each wireframe has one primary action (hero mic, sticky Post, Send card, Apply with my card, answer by voice).
- Hindi-first copy pairs given; `data-user-content` on names and user text.
- Performance: § 7 plan respects the staff-preview secrecy rule; no new dependency.
- Known gaps: no first-hand mechanic interviews (research gap in § 2.4); board images are store marketing shots, not
  raw app UI; similar-questions endpoint is a spec addition the lead must accept.

### 10.1 Web Interface Guidelines pass (vercel-labs `command.md`, fetched 2026-11-27) — applied to the plan

- **URL reflects state:** feed tab stays `?tab=` (exists); notifications `?filter=`; Ask filter `?f=`; profile tab
  `?tab=work|best`. Sheets (More, level sheet) are not URL state (closable overlays).
- **Touch:** `touch-action: manipulation` on feed media and action rows (double-tap window); `overscroll-behavior:
contain` on every sheet and the story viewer; gestures (hold-to-talk, story taps/hold) all have visible button
  alternatives (§ 3.3, § 6.2).
- **Animation:** only `transform`/`opacity`, explicit `transition-property` (never `all`), interruptible, reduced-motion
  variant = none; story auto-advance > 5 s has Pause (§ 3.3).
- **Long lists:** feed/inbox/answers use `content-visibility: auto` + `contain-intrinsic-size` per item instead of a
  virtualisation library (JS budget); pages stay cursor-paged (≤ 20 per page).
- **Numbers and dates:** pay ranges, counts and durations via `Intl.NumberFormat` / existing time-ago helpers in the
  viewer's locale (`en-IN` / `hi-IN`); `tabular-nums` on counts and timers.
- **Brands and codes:** `translate="no"` on MechDost, part brands (Exide, Splendor) in chips, and codes (UQ-…, UJ-…).
- **Images:** width/height or `aspect-ratio` on every image; lazy below the fold; `priority` only where § 7.6 says.
- **Forms:** summary field and fix-log fields have visible labels, a counter, inline errors and keep paste; leave-
  with-changes warning on composers (§ 3.10).
- **Destructive:** "हटाओ" on a recorded take and "Delete post" keep today's confirm/undo behaviour; discarding a take
  by Cancel is announced (§ 6.2).
- **Copy:** the guideline's "Title Case" is overridden by MechDost's sentence-case house style (`docs/design-system.md`,
  concept copy) and does not apply to Hindi.

---

## Appendix A. Advisor brief (mechdost-advisor, run first)

```
ADVISOR BRIEF — Ustaad Network UI/UX upgrade design (docs only)
Context loaded: CLAUDE.md; docs/progress.md (top entries); docs/decisions.md 2026-11-27 night entry (+ Ustaad entries
  by search); spec 23 § 1, 5, 8, 9, 16–18, 21d excerpt, 21h, 22; design-system.md (header/tokens); tokens.css;
  fix plan 2026-11-27; QA logs research.md, audit.md + improvements.md (ranked lists), retest; memory notes
  (ustaad-network, ui-redesign-feedback, design-direction, no-reload-feel, hindi-everywhere); live screenshots; the
  ustaad components and routes (structure, gate, layout, recorder, DTOs).
Areas: UI · i18n · performance · analytics · API (small reads, one PATCH) · DB (one migration) · security (gate secrecy).
Hard rules: ⚠ 2 (new tag shape → decisions entry, no new colours) · ⚠ 6 (CLS 0.83 / JS over budget today → § 7 gate)
  · ⚠ 10 (every new key en+hi, names as user content) · ⚠ 9 (new events listed per screen) · ✅ 3/16 (summary via
  conditional UPDATE + events; codes not text) · ⚠ 4 (secrecy of staff preview; new routes need member gate + limits).
Conflicts / corrections: (1) night decision mentions auto-caption provider vs spec 23 "no speech-to-text" → author
  summaries only until founder Q4 + decisions amendment; (2) founder rejected copied looks → no reference colours,
  glyphs, names, square grid, overlay heart; (3) server-rendered member shell impossible during staff_preview
  (client session) → neutral full-height frame + server path-based chrome hiding; (4) "new posts" cannot use the
  ranked snapshot → new fresh-count read.
Risks: post-hydration shifts (mitigated: server HTML decisions + reserved slots); batch file collisions (mitigated:
  ownership table § 8.0); redesign shock for returning members (R17: keep every control, evolve in place).
Improvements: ranked E1–E22 (P0–P2) in § 4; N1–N6 need the founder.
Decisions needed: Q1–Q4 in § 9 (defaults stated) — lead queues them.
Docs to update when building: spec 23 (§ 5, § 8 new reads/PATCH, § 9.5 fresh count, § 16 events, § 21i as built),
  decisions.md (Pehchaan tag shape; summary columns; fresh-count endpoint), progress.md, questions-for-user.md,
  analytics catalogue, README index (this doc).
Skills to run next (builders): see § 8.0.
Applicable learnings: L319 (registries not installed — check before reaching for shadcn registry blocks), L324 (new).
```

Skills run for this doc: mechdost-advisor (first), ui-ux-pro-max (UX guideline searches: gestures, skeleton/CLS,
bottom nav, reduced motion, optimistic feedback/haptics, progress/badges), frontend-design (critique: SaaS-card kit
and template-chrome traps avoided; boldness spent on the Pehchaan tag only; drag slider replaced by a tap toggle),
web-design-guidelines (§ 10.1). Brainstorming skipped by instruction (direction approved by the founder).
Not done by this docs-only task (lead's integration step): `docs/progress.md` line, `docs/README.md` index entry,
`docs/questions-for-user.md` entries for Q1–Q4, decisions entry — all listed above.
