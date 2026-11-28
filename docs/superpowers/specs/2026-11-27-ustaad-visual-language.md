# Ustaad Network: visual language (colours, components, motion), 2026-11-27

Status: **proposal, not built and not committed.** This doc adds a visual layer on top of the approved layout and
interaction design in `2026-11-27-ustaad-ui-upgrade-design.md` (the "UI upgrade doc"). It does not change any
flow, screen or control in that doc. Where it changes a rule from that doc (new colours), it says so and asks for a
decision (§ 9).

Founder brief (2026-11-27): "modernise the mechanic network ui and colors and components with cool animations and
stuff but make sure its not just ai slop and u do proper visual research and study on it first".

Demo (internal, never published): `D:\mechdost-qa\ustaad-visual-2026-11-27\demo.html`. It is a single file you
open in Chrome. It has a 390 px phone frame and a 1440 view, light/dark and हिंदी/English toggles, a "Loading state"
toggle and a "Reduce motion" toggle. Screenshots are in `D:\mechdost-qa\ustaad-visual-2026-11-27\shots\` (§ 8).

---

## 0. Founder summary (plain words)

**The idea.** The network should look like it belongs to people who work with their hands, not like every other
social app. So we took three things every mechanic touches every day and made them the visual language:

1. **The key tag.** A customer's bike keys hang in a garage on a small tag with a hole. Your level, the **Pehchaan
   tag**, has that shape, with a small punched hole. When you tap it, it swings on its hole like a tag on a hook and
   then opens "what this level means".
2. **The grade marks on a bolt.** Strong bolts carry small lines on the head that tell a mechanic how strong they are
   (3 lines, 6 lines). Each level tag carries 1 to 4 small lines (Naya I, Pakka II, Bada III, Master IIII). The lines
   tell the levels apart even for colour-blind members, and they cost nothing to draw.
3. **Metal finishes for levels.** Naya is **zinc** (plain steel grey), Pakka is **brass** (yellow metal), Bada is
   **copper** (our existing orange), Master is **solid navy** (light mode) or **polished steel** (dark mode). They run
   from light to dark, like a tool getting better, and stay distinct for colour-blind members (checked, § 3.3).

The rest of the screen stays quiet: same MechDost navy and orange, same fonts. The **best answer** gets a
rubber-stamp look ("पूछने वाले ने चुना", stamped slightly crooked with a double border, like the OK stamp on a job
card), and it lands with a short "stamp press" when the asker chooses it. The new **"काम की बात / Useful"** reaction
uses a spanner icon and turns brass when pressed, so it never gets mixed up with Like.

**Animations: six, all small, all answering a tap.** Like and Useful give a small spring "tick" and the number rolls
up. The tag swings. The orange bar in the bottom tabs slides to the tab you picked. The story bar fills while a story
plays. The "नई पोस्ट देखो" button drops in when new posts exist. The best-answer stamp presses down. Nothing moves on
its own when you open a page, and everything stops when the phone's "reduce motion" setting is on.

**What it costs.** Four new colour tokens (zinc, brass, brass text, raised dark surface), no new fonts, no animation
library: 0 KB of extra JavaScript for motion; everything is CSS.

**What we refused** (things that make apps look machine-made): gradient blobs, frosted glass, purple-blue gradients,
emoji as icons, every block the same rounded card, everything fading up as you scroll, a big heart burst copied from
Instagram, all-caps labels.

**New tonight: three colour directions A / B / C** are in the demo behind a switch (§ 3.6). We recommend A (metal levels). **Light mode is lifted** (§ 3.7): a tinted page, floating cards, hairlines with soft layered shadows, framed photos, tinted selected states. Before/after screenshots are in the shots folder. § 3.8 lists which of these we suggest for the whole site.

**Decisions for you** (§ 9, V0–V7; the main ones): (V0) pick colour direction A, B or C; (V1) allow the four new colours; (V2) level colours as metal finishes; (V3) grade lines
on tags; (V4) the stamp look for best answer; (V5) the spanner icon and brass colour for "काम की बात".

---

## 1. Context loaded and the advisor brief

```
ADVISOR BRIEF: Ustaad Network visual language (research, design doc, static demo; no product code)
Context loaded: CLAUDE.md; agent-brief.md; docs/superpowers/specs/2026-11-27-ustaad-ui-upgrade-design.md § 0–3.9;
  docs/decisions.md 2026-11-27 night entries (Q-UI-1..4 answers); packages/ui/src/tokens.css (all three blocks); apps/web/test/tokens.test.ts (TEXT_PAIRS, NON_TEXT_PAIRS);
  docs/design-system.md (colour tokens, shape/depth/motion, Notice priority; docs/progress.md only the header, not
  the ledger); live screenshots RT/G17-me-09-390-hi-dark and RT/LEAD-like-comment-words-09-360-hi-dark (the pattern
  board.html and the other RT shots were not opened in this pass; the UI upgrade doc already cites them); memory notes ui-redesign-feedback,
  design-direction, no-reload-feel, ustaad-network; packages/shared/src/i18n/{en,hi}.json ustaad.*;
  apps/web/src/components/ustaad/** (icon names, existing like = heart, helpful = thumbs-up);
  advisor learnings L319/L324.
Areas: UI, i18n, performance, accessibility, docs.
Hard rules: ⚠ rule 2: new colours need a decisions entry → V1 in § 9. This supersedes Principle 3 ("no new colours")
  and the § 3.8 tag table of the UI upgrade doc. ⚠ rule 10: two new strings (Useful reaction, weekly
  helped note) need en + hi keys. They are proposed in § 6, not invented in product code. ⚠ rule 6: the motion budget
  is 0 KB JS (CSS only); View Transitions are progressive enhancement. ✅ rules 3/4/7/16: not touched (no data or API).
Conflicts / corrections: (1) the brief names a "like burst"; the UI upgrade doc § 0/§ 3.2 bans heart bursts → the
  "tick" motion is on the button itself. (2) A "tag flip" that reveals new content would be an invented behaviour
  (the reason earlier rounds were rejected) → "tag swing" plays on the existing tap that opens the level sheet.
  (3) The dock is Home · Ask · Create · Jobs · Me (founder Q-UI-1), not the § 3.0 drawing. (4) Hindi for "Create"
  is "बनाएँ" in hi.json (the doc's "बनाओ" is not used).
Risks: copying a reference app's look (mitigation: take principles only, § 2 "do not copy" column); contrast of
  light fills (brass 2.19:1 on white) → mandatory 1 px edge; Devanagari clipping inside 24 px tags → 26 px tag height
  for hi, no overflow:hidden on labels.
Improvements: P0 tag + stamp + reaction colours (identity, low cost); P1 motion set; P2 View Transition route
  crossfade (Baseline for same-document since Firefox 144).
Decisions needed: V1–V7 (§ 9), queued as proposals for the lead.
Docs to update in this change: this file only (the lead applies decisions/progress/design-system on acceptance, § 9–10).
Skills: frontend-design, ui-ux-pro-max (--design-system --motion 3 --density 6), dataviz validator,
  accessibility-lead → contrast-master + modal-specialist, web-design-guidelines.
Applicable learnings: L319 (check the lockfile before naming a library: no motion library is named), L324.
```

---

## 2. Research (sources accessed 2026-11-27)

Reference images (internal only, never published or committed) are under
`D:\mechdost-qa\ustaad-visual-2026-11-27\refs\<source>\`, each folder with a `source.txt` (page URL, image URL,
date). Saved: `neopop-web`, `wikipedia-iso3864`, `wikipedia-truck-art`. The earlier pattern board
`D:\mechdost-qa\ui-inspiration-2026-11-27\board.html` (Instagram, ShareChat, Moj, Josh, Apna, Khatabook, Kutumb,
LinkedIn, Quora, Reddit, WhatsApp, YouTube, Duolingo, Vyapar) covers the interaction patterns already used by the UI
upgrade doc; this study adds the **visual** layer.

| #   | Source                                                                                                                                                                                                                                                                                                                                                                                                       | What we take (principle)                                                                                                                                                                                                                                 | What we must not copy                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Material 3 Expressive: Google research on expressive design (46 studies, 18,000+ participants, Google's own figures): https://design.google/library/expressive-material-design-google-research ; launch post: https://blog.google/products/android/material-3-expressive-android-wearos-launch/                                                                                                              | Two kinds of motion. **Spatial springs** may overshoot a little (position, scale). **Effects springs** never overshoot (colour, opacity). Shape or weight changes mark a state change (play ↔ pause).                                                    | Google's 35-shape set, cookie/blob shapes, the "Expressive" look                                                                         |
| R2  | M3 Expressive on Wear OS and Androidify: https://android-developers.googleblog.com/2025/08/introducing-material-3-expressive-for-wear-os.html , https://android-developers.googleblog.com/2025/05/androidify-building-delightful-ui-with-compose.html                                                                                                                                                        | Shape morph on button state, variable-font weight for emphasis                                                                                                                                                                                           | Same as R1                                                                                                                               |
| R3  | M3E spring values from a third-party package: https://pub.dev/documentation/m3e_slider/0.0.2/common_m3e_common/M3EMotion-class.html (spatial stiffness 1400/700/300, damping 0.9; effects 3800/1600/800, damping 1.0). **Not verified** against m3.material.io: the official pages returned no readable text.                                                                                                | Our `--ease-spring-snappy` is **hand-tuned** (one 8 % overshoot, settles < 300 ms). It follows the M3E split (spatial may overshoot, effects never), not these numbers                                                                                   | Treating these numbers as official                                                                                                       |
| R4  | Apple HIG Motion: https://developer.apple.com/design/human-interface-guidelines/motion ; Reduced Motion evaluation criteria: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria                                                                                                                                                                  | Motion only with purpose. Under Reduce Motion, remove or minimise it. Auto-advancing carousels and multi-axis effects are flagged                                                                                                                        | iOS spring feel as-is                                                                                                                    |
| R5  | Apple Design Awards 2025: https://www.apple.com/newsroom/2025/06/apple-unveils-winners-and-finalists-of-the-2025-apple-design-awards/ (CapWords, Balatro, Feather, Infinity Nikki, Speechify, Watch Duty); 2024: https://www.apple.com/newsroom/2024/06/apple-announces-winners-of-the-2024-apple-design-awards (Bears Gratitude, Crouton, Gentler Streak, Rooms)                                            | One distinctive object carries the identity (CapWords' sticker). Watch Duty: clarity over decoration. Crouton: hands-busy ergonomics (fits a workshop). Gentler Streak: compare people with their own past, not with others (fits Q-UI-2 "you helped N") | Game or 3D visuals, characters                                                                                                           |
| R6  | CRED NeoPOP: https://cred.club/neopop , https://github.com/CRED-CLUB/neopop-web ; case study https://thehardcopy.co/cred-product-design-case-study/ ; https://homegrown.co.in/homegrown-voices/cred-s-new-design-philosophy-channels-the-unbridled-creative-spirit-of-the-neo-pop-art-movemen                                                                                                                | An Indian app with a strong, owned identity. The brand acts as a guardrail. "Don't design for the average"                                                                                                                                               | NeoPOP's right-angle 3D buttons and its black/blue look. Ours must not resemble it                                                       |
| R7  | Zepto brand engine: https://inc42.com/features/zepto-brand-engine-keeps-its-10-minute-promise-alive                                                                                                                                                                                                                                                                                                          | Lock one precise signature colour and use it the same way everywhere (for us: accent `#ea5728` = "yours/active")                                                                                                                                         | Purple, gradients                                                                                                                        |
| R8  | Swiggy Instamart brandbook 2026: https://www.swiggy.com/corporate/wp-content/uploads/2026/07/instamart-brandbook.pdf                                                                                                                                                                                                                                                                                         | A secondary colour works when it has one job                                                                                                                                                                                                             | Its colours (hex labels in the PDF look mismatched; not used)                                                                            |
| R9  | Stanley Black & Decker brand guidelines: https://www.stanleyblackanddecker.com/brand-guidelines/visual-elements                                                                                                                                                                                                                                                                                              | Tool brands own one colour, used on the object itself                                                                                                                                                                                                    | Stanley yellow + black                                                                                                                   |
| R10 | Bosch colour scheme: https://bosch-pt.com/ww/en/news-and-stories/color-scheme/                                                                                                                                                                                                                                                                                                                               | **Colour as a tier code** (blue = Professional, green = DIY). This is the direct precedent for level finishes                                                                                                                                            | Bosch blue/green                                                                                                                         |
| R11 | Snap-on red: https://www.ccjdigital.com/business/product/14919320/snap-on-adds-color-to-select-tools ; Taparia listings: https://www.industrybuying.com/brands/taparia/ (listing evidence only; no brand guideline found)                                                                                                                                                                                    | Workshop tools are read by colour from across a bench                                                                                                                                                                                                    | Any tool brand's colour                                                                                                                  |
| R12 | Bolt head grade markings: https://www.fastenersuperstore.com/fastener-guides/bolt-grades-head-markings ; Bossard technical sheet: https://media.bossard.com/-/media/bossard-group/website/documents/technical-resources/en/f-013-en.pdf                                                                                                                                                                      | SAE radial lines (3 = Grade 5, 6 = Grade 8) and ISO 898 classes. Every mechanic reads **lines = strength**. Our tags carry 1–4 lines                                                                                                                     | Claiming the SAE meanings (our ticks are ordinal, not grades)                                                                            |
| R13 | ISO 3864 safety colours: https://en.wikipedia.org/wiki/ISO_3864                                                                                                                                                                                                                                                                                                                                              | Yellow + black = hazard, red = prohibition, blue = mandatory, green = safe. We **reserve** green for "best/solved" and never use yellow-black stripes decoratively. The one hatched pattern ("जाँच बाकी", pending) is neutral grey, not hazard yellow    | Hazard stripes as decoration                                                                                                             |
| R14 | Truck art in South Asia: https://en.wikipedia.org/wiki/Truck_art_in_South_Asia ; origin of "Horn OK Please": https://www.91trucks.com/news/horn-ok-please-tracing-the-origins-of-indias-colourful-truck-art                                                                                                                                                                                                  | Hand-lettered slogans are a voice: Devanagari copy carries warmth ("काम की बात", "पूछने वाले ने चुना"), plus flat, high-contrast colour blocks                                                                                                           | Religious iconography, truck motifs as wallpaper, imitation of real trucks                                                               |
| R15 | View Transitions in 2025: https://developer.chrome.com/blog/view-transitions-in-2025 ; cross-document support: https://caniuse.com/cross-document-view-transitions                                                                                                                                                                                                                                           | **Same-document** View Transitions: Chrome/Edge 111, Safari 18, Firefox 144 (14 Oct 2025), Baseline. **Cross-document**: Chrome/Edge 126, Safari 18.2; Firefox status conflicts between sources → we use same-document only (Next.js client navigations) | Assuming cross-document works everywhere                                                                                                 |
| R16 | Scroll-driven animations (web.dev, Oct 2026): https://web.dev/blog/web-platform-10-2026                                                                                                                                                                                                                                                                                                                      | Now Baseline (Chrome 115, Safari 26, Firefox 159)                                                                                                                                                                                                        | We **do not** use them: scroll-linked decoration is the "fade-up on every section" tell, and it costs main-thread work on low-end phones |
| R17 | CSS `linear()` easing: https://developer.chrome.com/docs/css-ui/css-linear-easing-function , https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/linear                                                                                                                                                                                                                                         | Springs without JS: Chrome 113, Firefox 112, Safari 17.2 (Baseline Dec 2023). A cubic-bezier fallback comes first, inside `@supports`                                                                                                                    | Spring libraries                                                                                                                         |
| R18 | WCAG technique C39 (prefers-reduced-motion): https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html ; Understanding 2.3.3: https://w3c.github.io/wcag/understanding/animation-from-interactions                                                                                                                                                                                                               | 2.2.2 (A): auto-moving content can be paused/stopped (story auto-advance off under reduced motion). 2.3.3 (AAA): interaction motion can be disabled                                                                                                      |                                                                                                                                          |
| R19 | web.dev animations guide: https://web.dev/articles/animations-guide                                                                                                                                                                                                                                                                                                                                          | Animate only `transform` and `opacity`. `will-change` sparingly (each layer costs memory on cheap Android)                                                                                                                                               | Animating width/height/top/clip-path                                                                                                     |
| R20 | AI-slop tells: https://github.com/Laith0003/ux-skill/wiki/How-to-detect-AI-slop-in-your-design , https://docs.bswen.com/blog/2026-03-20-ai-generated-ui-anti-patterns/ , https://impeccable.style/gallery (practitioner opinion, not research)                                                                                                                                                               | The refuse list in § 3.1                                                                                                                                                                                                                                 |                                                                                                                                          |
| R21 | Hand-painted Indian signage: Huck, "HandpaintedType" (Delhi sign painters): https://huckmag.com/art-and-culture/art-2/handpainted-type ; Creative Bloq: https://creativebloq.com/typography/saving-indias-hand-painted-street-sign-type-912863 ; Sahapedia: https://www.sahapedia.org/hand-painted-signs-forgotten-markers-city-space (the last two from search excerpts only)                               | Personal, slightly imperfect lettering is a trust signal. For us that means warm Devanagari copy and the slightly crooked stamp, not a new font                                                                                                          | Any painter's letterforms or the HandpaintedType fonts                                                                                   |
| R22 | Bolt grade marks on Wikimedia Commons: https://commons.wikimedia.org/wiki/File:Hex_cap_screw-grade_5.svg , https://commons.wikimedia.org/wiki/File:Hex_cap_screw-grade_8.2.svg                                                                                                                                                                                                                               | Radial lines read as a grade (backs R12)                                                                                                                                                                                                                 | Hexagon badge shapes                                                                                                                     |
| R23 | Rapido new identity: https://bestmediainfo.com/mediainfo/mediainfo-marketing/rapido-unveils-new-brand-identity-as-it-expands-beyond-bike-taxis-11114881 ; Kuku FM character by Studio Eeksaurus: https://indiantelevision.com/mam/kukufm-unveils-charming-kuku-character-in-exciting-collaboration-with-studio-eeksaurus-and-madison-media-omega/ ; Moj rebrand 2020: https://www.medianews4u.com/?p=2265212 | Rapido: a wordmark can carry the brand without a literal icon. Kuku FM: a mascot personality, which we deliberately do **not** use (calm UI, professionals)                                                                                              | Logos, characters                                                                                                                        |
| R24 | Trade-worker app shots (Contra; closest found, not case studies): https://contra.com/community/gkLbYAgv-this-app-is-for-technicians-who , https://contra.com/p/2qB6ko6e-fixers                                                                                                                                                                                                                               | Fewer steps and plain, unambiguous screens for trade users                                                                                                                                                                                               | Marketplace flows                                                                                                                        |

**Not found or not verified** (we did not cite from memory). Images saved later: `refs/commons-bolt-grade5`, `commons-bolt-grade8`, `commons-himachal-sign`, `commons-bengaluru-sign`, `commons-pune-hotel-gate`, `huck-handpaintedtype`. Still missing: a Dribbble/Behance case study of a trade-worker community app; identity write-ups for Pratilipi, Josh and ShareChat; Rapido's colours and type; any brass key tag or valet tag source. Also unverified: official M3 spring numbers (R3); identity case
studies for Rapido, Josh, Kuku FM, Pratilipi and ShareChat (only the existing board covers ShareChat, Moj and Josh
patterns); Taparia's brand colour; any public source on hand-painted garage boards or brass key tags (the key tag and
stamp ideas come from the UI upgrade doc § 3.8 and our own trade knowledge, not a cited source); Awwwards/FWA mobile
community case studies (none found with case-study text).

**ui-ux-pro-max `--design-system` result: rejected.** The query "professional community social network mobile
workshop" with `--motion 3 --density 6` returned "Vibrant & Block-based", rose `#E11D48` + blue `#2563EB`, Inter +
Playfair Display and a GSAP scroll reveal. All of these conflict with hard rule 2 (MechDost tokens and fonts) and with
the 0 KB motion budget, and the scroll reveal is itself a slop tell. Kept from it: motion dial "subtle", density
"standard" (16–64 px spacing), "avoid heavy skeuomorphism" (so our tag is flat, not a realistic metal render), and its
pre-delivery checklist (no emoji icons, visible focus, reduced motion, 375/768/1024/1440).

---

## 3. The system

### 3.1 Identity concept

**"Bench kit".** The Ustaad Network looks like the objects on a working garage bench: a **key tag** for who you are,
**grade lines** for how far you have come, **metal finishes** for rank, a **rubber stamp** for the answer that fixed
the problem, and a **navy workshop pass** for your card. Everything else is quiet and flat in MechDost navy and orange,
so these few objects carry all the character (frontend-design: "spend your boldness in one place"). It is a mechanic
network, not generic social, because its signals come from the trade (tags, bolts, stamps, job-card fields "खराबी /
वजह / क्या किया"), not from entertainment apps (hearts, gradient rings, streak flames).

**What we refuse** (frontend-design tells + R20 + our own rejected rounds):

| Refused                                                                                  | Why / where it was tempting                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gradient blobs, mesh gradients, purple-blue gradients (`#667eea → #764ba2`)              | Generic AI default. Our only gradient is the photo placeholder in the demo (stands in for a real photo)                                                                       |
| Glassmorphism / frosted blur                                                             | Costly on low-end Android, low contrast. The story scrim is a solid navy at 90 %                                                                                              |
| Emoji as icons                                                                           | Lucide only (2 px stroke, 20 px; 16 px inside tags/stamps). Note: the site's top bar uses decorative emoji (decision 2026-11-01); **not inside the network**                  |
| Identical rounded cards for everything                                                   | Feed posts are edge-to-edge with 8 px gaps (UI upgrade doc § 3.1); cards only for grouped content (job, progress, stats)                                                      |
| Fade-up on every section, scroll-linked reveals                                          | Nothing animates on page load. Motion only answers a tap (§ 5)                                                                                                                |
| Instagram heart burst, gradient story rings                                              | Banned by the UI upgrade doc § 0. Our ring is a flat 3 px accent ring (UI upgrade doc § 3.3). A ring split by story count was tried and dropped: it resembles WhatsApp Status |
| All-caps labels, eyebrows over every heading, "WORD — fragment", trailing "→" on buttons | The UI upgrade doc's wireframe "FIX LOG" becomes a sentence-case template chip "काम की डायरी"                                                                                 |
| Middle-dot meta strings ("A · B · C")                                                    | Meta is "गुढ़ियारी, 2 घंटे पहले" (comma). The existing key `level_ustaad_pending` "उस्ताद · जाँच बाकी" keeps its dot (existing copy, not changed here)                        |
| Monospace for data labels                                                                | Tabular numerals in DM Sans instead                                                                                                                                           |
| Invented features or toggles                                                             | None. Every element in the demo exists today or is in the approved UI upgrade doc                                                                                             |
| Copying a reference app's look                                                           | Every reference row in § 2 has a "do not copy" cell                                                                                                                           |

### 3.2 Colour

Anchors unchanged: navy `#101f34`, accent `#ea5728` (decorative, icons, rings, indicator), filled buttons
`--color-accent-button #d2461a`, accent text `--color-accent-soft-text`. **Accent means "yours / active / act now"**
(R7): your story ring, the current tab bar, a pressed Like, the primary button. It is never a level colour except
Bada's copper, which reuses `accent-button`.

**Proposed new tokens (4 of the allowed 5):**

| Token                    | Light     | Dark      | Job                                                                                         |
| ------------------------ | --------- | --------- | ------------------------------------------------------------------------------------------- |
| `--color-zinc`           | `#c3ccd7` | `#3d4f68` | Naya Ustaad tag fill                                                                        |
| `--color-brass`          | `#e0a526` | `#e0a526` | Pakka tag fill; "काम की बात" pressed tint (16–22 % mix)                                     |
| `--color-brass-text`     | `#865800` | `#f2c461` | Text/icon for the pressed Useful reaction and Useful notifications; brass tag edge in light |
| `--color-surface-raised` | `#ffffff` | `#16263e` | Dock, sheets, sticky composers (dark elevation step 2)                                      |

**Contrast (WCAG 2.x, computed by `D:\mechdost-qa\ustaad-visual-2026-11-27\contrast.mjs`).** Text needs ≥ 4.5:1,
non-text UI ≥ 3:1.

| Pair                                                                                    | Ratio                | Need | Result                                                                                                |
| --------------------------------------------------------------------------------------- | -------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| ink `#101f34` on zinc `#c3ccd7` (L)                                                     | 10.21                | 4.5  | pass                                                                                                  |
| ink `#e8eef5` on zinc `#3d4f68` (D)                                                     | 7.14                 | 4.5  | pass                                                                                                  |
| navy `#101f34` on brass `#e0a526` (L and D)                                             | 7.56                 | 4.5  | pass                                                                                                  |
| white on copper `#d2461a` (Bada)                                                        | 4.53                 | 4.5  | pass                                                                                                  |
| Master L: white on `#101f34`                                                            | 16.57                | 4.5  | pass                                                                                                  |
| Master D: `#101d31` on `#e8eef5`                                                        | 14.47                | 4.5  | pass                                                                                                  |
| brass-text `#865800` on surface / bg / surface-alt (L)                                  | 6.16 / 5.43 / 4.99   | 4.5  | pass                                                                                                  |
| brass-text `#f2c461` on surface / surface-raised / bg (D)                               | 10.34 / 9.30 / 11.28 | 4.5  | pass                                                                                                  |
| ink / muted / accent-soft-text on surface-raised (D)                                    | 13.02 / 7.12 / 8.76  | 4.5  | pass                                                                                                  |
| **brass fill vs white surface (L, non-text)**                                           | **2.19**             | 3    | **fail → mandatory 1 px edge in brass-text (6.16)**                                                   |
| zinc fill vs white (L)                                                                  | 1.62                 | 3    | fail → 1 px edge in `input-border` (3.76)                                                             |
| zinc fill vs surface (D)                                                                | 2.03                 | 3    | fail → 1 px edge in `input-border` dark (5.04)                                                        |
| brass fill vs surface (D)                                                               | 7.71                 | 3    | pass                                                                                                  |
| copper fill vs surface L / D                                                            | 4.53 / 3.73          | 3    | pass                                                                                                  |
| accent icon vs surface L / accent-light vs surface D                                    | 3.56 / 7.32          | 3    | pass                                                                                                  |
| success on success-bg (stamp) L / D                                                     | 6.09 / 8.87          | 4.5  | pass                                                                                                  |
| focus ring L / D (on surface-raised)                                                    | 3.73 / 6.58          | 3    | pass                                                                                                  |
| **Tags on navy surfaces** (ID card, question card, story header; `#101f34` / `#13233b`) |                      |      |                                                                                                       |
| zinc L                                                                                  | 10.21 / 9.72         | 3    | pass                                                                                                  |
| zinc D                                                                                  | 1.99 / 1.89          | 3    | **fail → on navy, Chhotu/Naya edges switch to `#a3b3c7` (7.75 / 7.38)**                               |
| brass                                                                                   | 7.56 / 7.20          | 3    | pass                                                                                                  |
| copper                                                                                  | 3.65 / 3.48          | 3    | pass                                                                                                  |
| Master: navy fill on a navy card is 1:1                                                 |                      |      | **→ Master edge on navy = accent-light `#ff8b59` (7.17 / 6.83)**; dark Master fill `#e8eef5` is 14.18 |
| Story caption: white on `#101f34e6` (≈ `#1c2a3e`)                                       | 14.48                | 4.5  | pass                                                                                                  |

So the rule is: **every tag has a 1 px edge** (it is drawn as an outer clip in the edge colour plus an inner clip in
the fill), and `.on-navy` contexts switch the edge colours. The level word is always printed, so colour is never the
only signal (WCAG 1.4.1).

**Dark elevation scale** (lighter = closer, no shadows needed in dark):
`bg #0a1424` (0, page) → `surface-alt #0d192b` (sunken wells) → `surface #101d31` (1, posts, cards) →
**`surface-raised #16263e`** (2, dock, sheets, sticky composer; 1.21:1 step over bg) → `chip #243752` (3, pressed /
selected chips). Light mode keeps white + shadows (`shadow-card`, `shadow-float`).

### 3.3 Level colours (Naya / Pakka / Bada / Master) and colour-blind check

| Level                                | Fill L                                                        | Fill D          | Text      | Edge                      | Grade lines | Non-colour cue                             |
| ------------------------------------ | ------------------------------------------------------------- | --------------- | --------- | ------------------------- | ----------- | ------------------------------------------ |
| Chhotu (`apprentice`)                | `surface` (outline tag; navy fill + white text on navy cards) | `surface`       | ink       | `input-border`            | 0           | word + outline-only (filled vs not filled) |
| Ustaad, to verify (`ustaad_pending`) | hatched `surface`/`pill` 135°                                 | same            | ink       | `input-border`            | 0           | word + hatch ("work in progress")          |
| Naya Ustaad                          | zinc `#c3ccd7`                                                | `#3d4f68`       | ink       | `input-border`            | I           | word + 1 line                              |
| Pakka Ustaad                         | brass `#e0a526`                                               | `#e0a526`       | `#101f34` | brass-text L / brass D    | II          | word + 2 lines                             |
| Bada Ustaad                          | copper `#d2461a`                                              | `#d2461a`       | white     | `accent-button-hover`     | III         | word + 3 lines                             |
| Master Ustaad                        | ink (`#101f34`)                                               | ink (`#e8eef5`) | surface   | accent L / accent-light D | IIII        | word + 4 lines                             |

This replaces the colour column of the UI upgrade doc § 3.8 table (shape, hole and behaviour unchanged).

**dataviz validator** (`validate_palette.js --pairs all`), reported as it came out. Six-level run (with Chhotu): light `#e8edf3,#c3ccd7,#e0a526,#d2461a,#101f34` gives CVD PASS (worst Chhotu↔Naya ΔE 10.1 protan) but **normal-vision floor FAIL** (Chhotu↔Naya ΔE 10.3 < 15). Dark `#1a2b44,#3d4f68,…` also gives CVD PASS (13.6) and normal-vision FAIL (13.6). So Chhotu is made an **outline** tag (surface fill, no lines) and Naya a **filled** zinc tag with one line. The pair is told apart by structure and the word, not by colour. The four-level run (Naya to Master):

- Light `#c3ccd7,#e0a526,#d2461a,#101f34` on `#ffffff`: **CVD separation PASS**, worst pair copper↔brass ΔE 16.9
  (deutan), tritan 15.5. **Normal-vision floor PASS**, worst brass↔zinc ΔE 18.5. **Lightness band FAIL** and **chroma
  floor FAIL** (zinc and navy are deliberately neutral; these two checks are for chart series of equal weight, and a
  rank ladder is meant to vary in lightness). **Contrast vs surface WARN** (zinc 1.62, brass 2.19). It is met by the
  mandatory 1 px edge and the printed word.
- Dark `#3d4f68,#e0a526,#d2461a,#e8eef5` on `#101d31`: **CVD separation PASS**, worst copper↔zinc ΔE 15.3 (protan),
  tritan 20.5. **Normal-vision PASS**, worst copper↔brass ΔE 21.5. Lightness band and chroma floor FAIL (same reason).
  **Contrast WARN**: zinc 2.03, met by the edge.

All pairs are above the ΔE ≥ 8 target, so the levels stay distinct for deutan, protan and tritan viewers even without
the lines; the lines and the word add two more cues.

### 3.4 Type

Manrope (headings, numbers) + DM Sans (body, labels) + Noto Sans Devanagari (fallback already in `--font-heading` /
`--font-sans`). Manrope has no Devanagari, so Hindi headings fall to Noto Sans Devanagari. The scale therefore sets
Hindi line-heights separately and never uses negative tracking on `:lang(hi)`.

| Role        | en                           | hi                                  | Weight    | Used for                                          |
| ----------- | ---------------------------- | ----------------------------------- | --------- | ------------------------------------------------- |
| Display     | 20/1.3 Manrope               | 20/1.45                             | 800 / 700 | Screen title, ID card name                        |
| Title       | 17/1.3 Manrope, −0.01em      | 17/1.45, 0 tracking                 | 700       | Section, question title (18 in navy card)         |
| Name        | 15/1.3 Manrope               | 15/1.45                             | 700       | Author line                                       |
| Body        | 15/1.5 DM Sans               | 16/1.6                              | 400       | Post text, answers                                |
| Label       | 14/1.4 DM Sans               | 15/1.5                              | 600       | Buttons, actions, fix-log fields                  |
| Meta        | 13/1.45                      | 14/1.5                              | 400       | Area + time, counts, stat labels, story names     |
| Tag         | 13/1 Manrope 700, 26 px tall | 14/1.45 DM Sans 600, **28 px** tall |           | Pehchaan tag, template chip                       |
| Dock        | 13/1.2 600                   | 14/1.2 600                          |           | Tab words (UI upgrade doc § 3.0: 13 px, hi 14 px) |
| Stat number | 20/1.2 Manrope 800, tabular  | same                                |           | Izzat, followers, pay                             |

Rules (UI upgrade doc Principle 6): labels ≥ 13 px, Hindi ≥ 14 px with line-height ≥ 1.45; no `overflow:hidden` on one-line labels with Devanagari (matras clip); numbers use
`font-variant-numeric: tabular-nums` so counts don't jump when they roll.

### 3.5 Shape, borders, depth

Existing radii only: card 16, tile 15, dialog 18, button 9, input 8, pill 25. **One new shape**: the Pehchaan tag
(right corners 7 px, left end a 8 px point, a 6 px punched hole 7 px from the point), drawn with `clip-path`
(no image). The stamp uses radius 6 with a 2 px border + 1 px outline at 2 px offset (double rule), rotated −2°.
The ID card keeps the 6 px accent strip and gains a lanyard slot (44 × 8, radius 4, page colour). Borders: 1 px
`line` dividers, 1 px `line-card` on outlined reaction buttons, 1 px `input-border` on outlined actions. Shadows:
light mode `shadow-card` on grouped cards and `shadow-float` on the pill and sheets; **no shadows in dark** (use
elevation colour).

---

### 3.6 Three colour directions (founder: "colors kinda ehh", meaning not yet up to standard)

The demo has a **Colours: A / B / C** switch in its toolbar. Each option works in light and dark, and each keeps navy
`#101f34` and accent `#ea5728` as the brand anchors. Layout, components and motion are the same in all three; only
colour changes. The choice is remembered per browser. Screenshots (390, Hindi, Useful pressed):
`shots\A-home-390-hi-{light,dark}.png`, `B-…`, `C-…`.

|                                      | **A, Bench kit** (recommended)                                                                                                                                                                                                     | **B, Enamel pass**                                                                                                                                              | **C, Painted board**                                                                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idea                                 | Quiet chrome. The colour lives in the **materials** of the level tags: steel, brass, copper and blackened steel (polished steel in dark). Each fill has a 2-stop sheen, the only gradient in the system, because it shows material | **Navy chrome** (header and dock in navy) like an enamel workshop sign or ID pass. Levels are enamel colours: blue, maroon, copper, navy with a brass edge      | **More colour**, from hand-painted Indian boards and truck art: teal and marigold join the accent. The ID card strip is accent + marigold; template chips are teal                                                        |
| Inspired by                          | Bosch tier colours (R10), bolt grade marks (R12, R22), tool-brand single-colour ownership (R9), Watch Duty / Gentler Streak calm (R5)                                                                                              | Enamel signage, ISO 3864 reserved meanings (R13), CRED's owned dark chrome (R6, principle only)                                                                 | Hand-painted signage (R21), truck art (R14)                                                                                                                                                                               |
| Naya tag (L / D)                     | steel gradient `#d6dde6→#b4bfcc`, ink text 12.10–8.89 / `#4a5d78→#33445c`, `#e8eef5` text 5.75–8.47                                                                                                                                | `#2a64b0`, white 5.92 / `#6f9fe0`, `#0a1424` 6.77                                                                                                               | `#0f6e66`, white 6.10 / `#3cb8aa`, `#0a1424` 7.58                                                                                                                                                                         |
| Pakka tag                            | brass `#eeb94a→#d1961c`, navy 9.21–6.38 (both themes)                                                                                                                                                                              | `#8a2d3b`, white 8.34 / `#e39aa5`, `#0a1424` 8.28                                                                                                               | marigold `#f2b705`, navy 9.11 (edge `#8a6400` 5.38 on white)                                                                                                                                                              |
| Bada                                 | copper `#d2461a`, white 4.53 (all)                                                                                                                                                                                                 | same                                                                                                                                                            | same                                                                                                                                                                                                                      |
| Master (L / D)                       | `#1d3050→#0b1626`, white 13.20 / `#f4f7fb→#cfd8e3`, `#101d31` 11.74; accent edge                                                                                                                                                   | ink fill, **brass edge**                                                                                                                                        | ink fill, **marigold edge**                                                                                                                                                                                               |
| "काम की बात" pressed                 | brass-text `#865800` on tint (5.43–6.16) / `#f2c461`                                                                                                                                                                               | enamel blue `#2a64b0` 5.07–5.92 / `#8fb6ec` 8.11                                                                                                                | teal `#0f6e66` 5.18–6.10 / `#5fd0c2` 9.09                                                                                                                                                                                 |
| Chrome                               | white header, raised dock                                                                                                                                                                                                          | navy header + dock; muted dock words `#b7c4d6` 9.37 on navy                                                                                                     | white header                                                                                                                                                                                                              |
| CVD (validator, 4 levels, all pairs) | L: PASS ΔE 16.9; D: PASS 15.3                                                                                                                                                                                                      | L: PASS 14.2, normal 16.8; D (with `#e39aa5`): PASS 10.0, normal 17.8                                                                                           | L: PASS 9.6 (copper↔teal protan), normal 26.1; D: PASS 15.8                                                                                                                                                               |
| New tokens                           | 4 (§ 3.2)                                                                                                                                                                                                                          | 4 + 4 enamel values                                                                                                                                             | 4 + teal and marigold pairs (6)                                                                                                                                                                                           |
| Risk                                 | Can look too quiet if the photos are dull                                                                                                                                                                                          | Navy chrome makes the network feel separate from MechDost (staff-preview secrecy is fine with it) and heavier on OLED in light mode. Maroon sits near error red | Highest "festival" energy, nearest to a template look. Teal Naya and copper Bada are only ΔE 9.6 apart for protan viewers (the lines and the word carry it). Marigold is close to the warning/hazard yellow meaning (R13) |

**Recommendation: A.** It is the only one where the colour itself says something a mechanic knows (metal grade),
it keeps one confident accent used sparingly, and it leaves the photos of real work as the most colourful thing on
screen. B is the fallback if the founder wants the network to feel more like its own branded space. C is the most
fun, but it spends colour everywhere, against the "spend boldness in one place" rule.

**Side-by-side comparison** (`D:\mechdost-qa\ustaad-visual-2026-11-27\compare.html`, internal). Three real
references were available tonight: Apple Design Award 2025 winner Speechify (`refs\apple-ada-2025`), CRED NeoPOP
(`refs\neopop-web`) and Indian hand-painted signage (`refs\commons-bengaluru-sign`). Linear, Arc and Zepto
screenshots were not captured. Our before shots (`A-home-390-hi-*`, `L-after-390`) sit next to the after shots
(`{A,B,C}-v2-390-hi-{light,dark}.png`).

| Axis            | Where ours was weaker                       | Fixed in the demo (craft pass)                                                                                                                                                         | Still short                                                                              |
| --------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Depth           | Flat blocks; dark mode had no elevation cue | Lifted light (§ 3.7). In dark, cards float with a top-light hairline (`inset 0 1px 0 #ffffff12`) and navy panels lift to `#16294a` (white 14.48, hero copy 10.14, tag edges 6.27–6.78) | No per-surface tint; the soft deep shadow only appears on the player and primary         |
| Type contrast   | Names and body both 15 px                   | Body 16 (hi 17, line-height 1.6), names 16/800                                                                                                                                         | No display moment on Home in the demo; headings are small next to the ADA reference      |
| Spacing rhythm  | 12 px post padding, uneven gaps             | 16 px post top padding, 10 px card gaps, 12 px photo inset                                                                                                                             | Not yet a strict 8/12/16 grid in every component                                         |
| Icon craft      | 2 px lucide looked heavy next to the type   | 1.75 px stroke (2.25 on the current tab); 44 px play button with a soft accent glow; primary buttons 52 px, radius 12, inner top light                                                 | Tag and stamp are CSS shapes, not drawn glyphs; QR and before/after icons are stand-ins  |
| Colour richness | A reads plain next to CRED                  | Metal-sheen levels (A), enamel chrome (B), teal/marigold (C)                                                                                                                           | Grey photo placeholders make every option colder than it will be with real garage photos |

After the comparison A is still the recommendation: next to Speechify, the quiet chrome is the right call for a
work tool. Next to CRED, B holds up better in dark mode. If the founder wants more richness, the best option is
**A in light and B's navy chrome in dark**, a combination we have not yet built in the demo.

**First-pass gaps** (items 2 and 3 are now partly fixed by the craft pass; items 1, 4 and 5 are still open):

1. The demo's photo placeholders are flat grey-blue drawings, so the feed looks emptier and colder than it will with
   real garage photos. Judge colour on real photos.
2. Light-mode surfaces are flat white on cool grey. The tinted tonal layers premium apps use (e.g. a faint navy tint
   per level, `color-mix` of navy 2–4 % into surface for cards) were not tried.
3. Type contrast is modest: names are 15/700 and body is 15/400, so there is little difference in weight or size. A
   stronger name/meta step and tighter vertical rhythm (8/12/16) would add polish.
4. Dark mode A uses a very bright "polished steel" Master tag. It may read as a white blob at small sizes; try
   `#dfe6ee→#b9c5d3`.
5. Shadows vs borders: light mode still mixes card shadows and 1 px borders. Pick one per level (borders inside the
   feed, shadows only on floating items).

### 3.7 Light mode, lifted (founder: "the theme in the light mode didnt look as good")

Light mode gets its own treatment; it is not dark mode inverted. The demo **opens in light, "Light: lifted"**. The
toolbar button "Light: today" switches to today's site light theme for comparison.

Before / after, same scroll position, palette A (`D:\mechdost-qa\ustaad-visual-2026-11-27\shots\`):
`L-before-390.png` → `L-after-390.png`, `L-before-1440.png` → `L-after-1440.png`.

| Today                                                                    | Lifted (proposal)                                                                                                                 | Why                                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Page `#edf1f5`, white blocks butt against each other, edge-to-edge posts | Page `#eef2f7` (navy-tinted off-white, **not** cream). Posts become **floating sheets**: 8 px side inset, 16 px radius, 10 px gap | Three surface tones give depth: page, white card, sunken `#f5f7fa`                    |
| 1 px `#dbe2ea` borders + one soft shadow                                 | **Hairline** `#101f3414` ring plus a **layered** shadow `0 0 0 1px #101f340d, 0 1px 2px #101f340f, 0 10px 28px -18px #101f3433`   | Hairline for edges, a long faint shadow for lift: borders and shadows no longer fight |
| Photo full-bleed and square                                              | Photo **framed**: 12 px inset, 12 px radius inside the card                                                                       | Reads as a print of real work; keeps the 4:3 frame                                    |
| Header and dock with 1 px grey rules                                     | No rules. Header has a hairline + a soft shadow down; dock a hairline + a soft shadow up                                          | Chrome floats over content                                                            |
| Current dock tab: accent bar + bolder word                               | Bar kept, plus an **accent-soft pill behind the icon** (`#fff0e9` / `#bf3c12`, 4.88:1)                                            | Selected state by tint, the most common premium pattern                               |
| Segmented tabs: flat grey track                                          | Track `#e3e9f1` with an inner shade; white thumb with a layered shadow                                                            | Tactile, still calm                                                                   |
| Story row on a white strip                                               | Story row sits on the page tone (no box)                                                                                          | Separation without boxes everywhere                                                   |
| Author name 15/700                                                       | 16/800                                                                                                                            | Stronger name/meta contrast                                                           |
| Navy panels flat                                                         | Navy panels (ask, question, ID card) get one deep, soft drop `0 14px 30px -18px #101f3480`                                        | The one dark object on the page gets weight                                           |

Contrast on the new tones: muted `#536376` on page `#eef2f7` is 5.47, on sunken `#f5f7fa` 5.73, and on the segment
track 5.04. Ink on the page is 14.74. All other pairs are unchanged (§ 3.2). The approved UI upgrade doc § 3.1 drew feed
posts edge-to-edge for bigger photos. The lifted version trades 40 px of photo width for depth, so this needs a
decision (**V8**).

### 3.8 Light-mode improvements recommended SITE-WIDE (separate from the network) — applied 2026-11-28 (V9; see docs/design-system.md)

The founder may want the whole site's light theme lifted. These apply cleanly beyond `/ustaad` (storefront, account,
partner portals, admin) and need only token changes and shared-component edits, no layout redesign:

1. **Page tone** `--color-bg` `#edf1f5 → #eef2f7` (navy-tinted off-white) and a **sunken tone** for wells/inputs
   (`surface-alt` `#e2e8ef → #f5f7fa` light). Re-run `tokens.test.ts`: muted stays ≥ 5.0 on both.
2. **Hairline + layered shadow** as the one card treatment: `--shadow-card: 0 0 0 1px #101f340d, 0 1px 2px #101f340f,
0 10px 28px -18px #101f3433`, and drop the separate 1 px `line-card` border on cards that already have the shadow.
   (Product cards, order cards, portal panels.)
3. **Selected = accent-soft tint** everywhere (current nav item, chosen filter chip, active tab icon), the existing
   `accent-soft` / `accent-soft-text` pair (4.88:1), instead of grey fills.
4. **Header and bottom tab bar**: no grey rule. Use a hairline plus a soft shadow (`shadow-header` already exists; the
   tab bar gets its mirror).
5. **Image framing** on product and workshop cards: inset image with an inner radius (card 16 → image 12) instead of
   full-bleed tops.
6. **Name/price weight step**: headings and prices one step heavier (700 → 800 Manrope); meta stays 400 muted.
7. **Segmented controls and tabs**: tinted track + white thumb with a layered shadow (portal tabs, Q-PP-F2).

Not site-wide: the level metals, the stamp, Useful brass and the floating-sheet feed are network identity only.
Decision **V9**: apply items 1–7 site-wide in a separate batch after the founder sees the network version.

## 4. Components (visual spec)

All icons are **lucide** (`lucide-react` 1.63 in the lockfile; in the demo only the QR and before/after glyphs are hand-drawn stand-ins, and the product uses lucide `qr-code` and `columns-2`), stroke 2 px (2.4 for the current dock tab), 20 px;
16 px in tags, chips and stamps. Touch targets ≥ 44 px (48 px for dock, header and story controls). Focus:
2 px `--color-focus` outline, 2 px offset, everywhere. Pressed: `scale(.95–.97)` 90 ms plus `pill` background. Disabled:
50 % opacity, `cursor:not-allowed`, no press motion, and the reason as text near it (never only greyed).

| Component                                  | Default                                                                                                                                                                                                                                                                                                                                 | Pressed / selected                                                                                                                                   | Focus                                | Disabled / other states                                      | Notes                                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Dock** (Home · Ask · Create · Jobs · Me) | `surface-raised`, 1 px `line` top, words 12/13 px `muted`                                                                                                                                                                                                                                                                               | current: `ink` word, icon 2.4 stroke, **3 px accent bar** slides (§ 5 M3); Create = 40×32 `accent-button` block with white "+" and the word under it | ring                                 | hidden while a text field has focus (UI upgrade doc § 3.0)   | ≥ 1024 px: a left rail, same bar vertical                                                                          |
| **Header**                                 | 56 px `surface`, brand mark (navy tile, white wrench; accent tile in dark), name 17 px 800                                                                                                                                                                                                                                              | button `pill` bg                                                                                                                                     | ring                                 | —                                                            | bell count `accent-button` badge; `role=status` text                                                               |
| **Post card**                              | edge-to-edge `surface`, 8 px `bg` gaps; author row 40 px avatar + name + tag + verified (accent badge-check)                                                                                                                                                                                                                            | —                                                                                                                                                    | —                                    | held: `private-bg` note (existing)                           | template chip (accent-soft) names the template; fix log = `<dl>`, 3 px accent rule on each `dt`                    |
| **Story ring**                             | unseen: 3 px accent ring, 2 px surface gap (no gradient, no count arcs)                                                                                                                                                                                                                                                                 | seen: 1.5 px `line-card`                                                                                                                             | ring                                 | own, none today: grey ring + accent "+" badge                | dot under the name and "नई" in the accessible name (not colour alone)                                              |
| **Pehchaan tag**                           | § 3.3                                                                                                                                                                                                                                                                                                                                   | tap: **swing** (M2) then level sheet                                                                                                                 | ring                                 | —                                                            | `button` when it opens the sheet, `span` inside the sheet                                                          |
| **Reactions** Like + काम की बात            | row 1: two outlined buttons (1 px `line-card`) with icon + count + word                                                                                                                                                                                                                                                                 | Like: heart filled accent, word `accent-soft-text`, bg `accent-soft`; Useful: **wrench** in `brass-text`, word `brass-text`, bg brass 18 %           | ring                                 | failure: rollback + toast (UI upgrade doc § 3.2)             | row 2: Comment, Save, WhatsApp, all with words. `aria-pressed`; count in the name                                  |
| **Helpful** (answers, existing)            | thumbs-up + "काम का" + count, outlined                                                                                                                                                                                                                                                                                                  | pressed like Useful (brass), word "काम आया ✓" per UI upgrade doc                                                                                     | ring                                 | self-vote: hidden (existing error)                           | stays thumbs-up so Q&A "helpful" ≠ post "useful"                                                                   |
| **Best-answer stamp**                      | `success` text on `success-bg`, double rule, −2°, badge-check icon, "पूछने वाले ने चुना"                                                                                                                                                                                                                                                | lands with **stamp press** (M5)                                                                                                                      | —                                    | —                                                            | answer gets a 3 px inset `success` rule on the left; "सबसे अच्छा चुनो" = quiet outlined button with inline confirm |
| **Voice note player**                      | 56 px `pill` well (navy-tint `#ffffff14` on navy); 40 px `accent-button` play; 30-bar waveform `input-border`; time tabular; speed chip 1× / 1.5× / 2×                                                                                                                                                                                  | playing: played bars turn accent (**counter-translate reveal**, M-free: linear, transform only); one at a time                                       | ring                                 | loading "आवाज़ खुल रही है…"; failed: error text + retry      | author summary under it (§ 5 of UI upgrade doc)                                                                    |
| **Composer tiles** (Create sheet)          | wide navy tile "बोलकर पूछो" (mic in 48 px accent circle) then a 2-column grid: Fix log, Before/After, Tip, Short video; 15 px radius, 1 px `line-card`, icon in 36 px `accent-soft` square                                                                                                                                              | pressed: scale .97, accent border                                                                                                                    | ring                                 | —                                                            | one primary (voice) per the calm-UI rule                                                                           |
| **Job card**                               | `surface` card 16 px, `shadow-card`; title 16 Manrope; status dot + word ("खुली", success); `<dl>` pay/experience/area; pay 18 px 800 tabular                                                                                                                                                                                           | —                                                                                                                                                    | ring                                 | filled/closed: status word changes, primary becomes outlined | first card primary "मेरे कार्ड से अर्ज़ी दो", others outlined (one primary per screen)                             |
| **ID card**                                | navy pass, 6 px accent strip, lanyard slot, 72 px avatar with 3 px white-15 % ring, name 20 px, handle tabular top-right, tag + "MechDost से पक्का"                                                                                                                                                                                     | —                                                                                                                                                    | ring                                 | pending: dashed hatch tag + "जाँच कहाँ तक पहुँची, देखो"      | one primary "WhatsApp पर कार्ड भेजो" + QR outlined square                                                          |
| **Notification row**                       | follows design-system "Notice priority" (4 px left bar + icon tile + label): best answer = success; useful, follow, answer = info (`pill`/`muted`) with its own lucide icon (wrench, user, message). **No brass in notices**: brass-on-tint sits near the warning scheme (`warning` `#674e2d` on `#fff3df`) and would read as a warning | unread: 6 px accent dot at the left                                                                                                                  | ring                                 | —                                                            | grouped "आज / पहले की" headings (sentence case, not caps)                                                          |
| **Empty state**                            | `surface`, 1 px **dashed** `line-card` (the empty bay), 56 px glyph tile, one line, **one** outlined action                                                                                                                                                                                                                             | —                                                                                                                                                    | ring                                 | —                                                            | real copy keys (e.g. `notifications.empty`)                                                                        |
| **Skeleton**                               | exact shape of what loads (avatar circle, 2 text bars, 4:3 photo, 2 action pills) in `pill`                                                                                                                                                                                                                                             | sheen: one translateX sweep 1.4 s linear                                                                                                             | —                                    | reduced motion: static                                       | skeleton never shows for < 300 ms loads                                                                            |
| **New posts pill**                         | `ink` pill with `surface` text, chevron-up, `shadow-float`, fixed under the header                                                                                                                                                                                                                                                      | drops in (M4)                                                                                                                                        | ring                                 | —                                                            | only after the fresh-count read is > 0 **and** the reader is down in the feed                                      |
| **Sheets**                                 | `surface-raised`, 18 px top radius, grab bar (phone only), title + 48 px close                                                                                                                                                                                                                                                          | slide up (260 ms)                                                                                                                                    | focus to close, Escape, focus return | —                                                            | ≥ 1024: centred 480 px dialog                                                                                      |

---

## 5. Motion system (CSS only, 0 KB JS for motion)

Tokens (proposed, in `@theme`): `--ease-out-soft` (exists), `--ease-spring-snappy` (new: `linear()` spring with a
`cubic-bezier(.34,1.56,.64,1)` fallback), `--duration-tap 90ms`, `--duration-fast 150ms` (exists), `--duration-base
220ms` (exists), `--duration-sheet 260ms`, `--duration-swing 420ms`.

| #   | Name               | Trigger (user action first)                              | Spec                                                                                                                                                                                                                       | What it tells you                                                       | Reduced motion                                                                         |
| --- | ------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| M1  | **Tick**           | tap Like / काम की बात / Helpful; double-tap photo = Like | icon `scale(.7→1)` 260 ms `--ease-spring-snappy` (spatial spring, one overshoot); count rolls: old number `translateY(-100%)` + fade, new from `+100%`, 180 ms ease-out-soft; colour change 150 ms (effects, no overshoot) | "your reaction counted"                                                 | instant colour + number swap                                                           |
| M2  | **Tag swing**      | tap a Pehchaan tag                                       | `rotate 0 → −9° → 5° → −2° → 0` around the hole (`transform-origin: 7px 50%`), 420 ms ease-out-soft; the level sheet opens at 260 ms                                                                                       | "this is a tag you can open"                                            | no swing; sheet opens at once                                                          |
| M3  | **Dock shift**     | tap a dock tab                                           | 3 px bar `translateX(index × 100%)` 280 ms `--ease-spring-snappy`; page content swaps in a **same-document View Transition** (old/new crossfade 180 ms), so the frame never reloads (memory "no-reload-feel")              | where you are now                                                       | bar jumps; no crossfade (`::view-transition-*` animation none)                         |
| M4  | **New-posts drop** | fresh-count read > 0 while the reader is in the feed     | `translateY(-8px → 0)` + opacity 220 ms; tap = smooth scroll to top                                                                                                                                                        | "new posts exist" (the only non-tap motion, and it carries information) | appears in place                                                                       |
| M5  | **Stamp press**    | asker confirms "हाँ, चुनो"                               | stamp `scale(1.35) rotate(−8°) opacity 0 → scale(.97) rotate(−1.5°) → scale(1) rotate(−2°)`, 240 ms; the answer moves to the top inside a View Transition (FLIP for free)                                                  | "this one is chosen and moved first"                                    | stamp and order appear at once                                                         |
| M6  | **Story progress** | open a story                                             | each segment `scaleX(0 → 1)` linear 6 s (photo); hold or "रोको" pauses (`animation-play-state`); voice/video wait for tap to play (no autoplay)                                                                            | time left on this story                                                 | **no auto-advance** (WCAG 2.2.2); bar shows a static half step; next/prev buttons only |

Supporting micro-motions (not named, no meaning beyond feedback): press `scale(.95–.97)` 90 ms on buttons and tiles;
segmented-control thumb slide 240 ms spring; sheet slide 260 ms; skeleton sheen; voice-note progress
(counter-translate: an outer clip `translateX(-100% → 0)` and inner bars `translateX(100% → 0)`, linear over the
clip's length, so it is compositor-only with no `clip-path` or width animation).

**Rules.** Only `transform` and `opacity` animate (R19). `will-change` is never set globally. One reduced-motion
block (`@media (prefers-reduced-motion: reduce)`) sets durations to 1 ms and turns off View Transition animations; JS
reads the same media query before starting auto-advance or smooth scroll. No scroll-driven animations (R16). No
animation library (Framer/motion/GSAP were not in the lockfile and stay out, learning L319). View Transitions are
progressive: `document.startViewTransition` is used only when present; without it, the state changes instantly.
**JS budget for motion: 0 KB** (the only script touches are class toggles that the components already do for
state).

---

## 6. Copy needed (proposed keys, en + hi; not yet in the locale files)

| Key                                 | en                                 | hi                                       | Status                                                                                   |
| ----------------------------------- | ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ustaad.feed.useful`                | Useful                             | काम की बात                               | new (Q-UI-3 answered)                                                                    |
| `ustaad.feed.usefulAria`            | Mark as useful ({n} so far)        | काम की बात बताओ (अब तक {n})              | new                                                                                      |
| `ustaad.card.helpedWeek`            | This week you helped {n} mechanics | इस हफ़्ते आपने {n} मिस्त्रियों की मदद की | new (Q-UI-2)                                                                             |
| `ustaad.shell.tab_ask` / `tab_jobs` | Ask / Jobs                         | पूछो / नौकरी                             | new keys for the Q-UI-1 dock (the words already exist as `home.sc_ask` / `home.sc_jobs`) |
| `ustaad.notifications.kind_useful`  | Useful                             | काम की बात                               | new                                                                                      |
| `ustaad.home.newPosts`              | See new posts                      | नई पोस्ट देखो                            | already proposed by the UI upgrade doc § 3.1                                             |
| `ustaad.qa.bestStamp`               | Chosen by the asker                | पूछने वाले ने चुना                       | already proposed by the UI upgrade doc § 3.4                                             |

The demo uses existing keys elsewhere (`shell.brand`, `home.askTitle/askBody/askCta/storyAdd/feed_*`,
`card.level_*`, `card.cardLabel`, `card.verified`, `feed.like/save/share/tpl_*`, `qa.helpful/markBest/speakAnswer`,
`jobs.*`, `media.playVoice/voiceNote`). Demo-only strings (people, garages, posts, job titles) are sample user
content.

**Placeholder copy in the demo (not in the locale files, needs keys and a Hindi review before build):** the
notification sentences ("Raju chose your answer as the best one", "5 mechanics found your fix log useful", "Imran
started following you"), the type words on notification rows, the Create tile hints ("Problem, cause, what you did", "Two
photos of the same job", "One thing others should know", "Up to 3 minutes") and the titles "Short video" / "Create",
the level-sheet rule lines and "What is Pakka Ustaad?", "Back to home", "Next level:", "Followers that count",
"8 more", "Today" / "Earlier", "Gudhiyari, within 2 km", "3 photos", "New posts are here". Most of these exist in the UI
upgrade doc § 3.x copy lists or as `card.rule_*` keys with parameters. The builder maps them to those keys and does not
add new ones where a key already exists.

---

## 7. Token diff for `packages/ui/src/tokens.css` (proposal, not applied)

```diff
@@ @theme {
   --color-cart-badge-text: #ffffff;
+  /* Ustaad Network "bench kit" (decision 2026-11-27 V1/V2, visual language doc): level finishes + raised surface */
+  --color-zinc: #c3ccd7; /* Naya Ustaad tag fill; 1 px input-border edge (fill is 1.62:1 on white) */
+  --color-brass: #e0a526; /* Pakka tag fill, Useful pressed tint; 1 px brass-text edge in light (2.19:1 on white) */
+  --color-brass-text: #865800; /* Useful text/icon on surface (6.16:1), bg (5.43:1), surface-alt (4.99:1) */
+  --color-surface-raised: #ffffff; /* dock, sheets, sticky composer */
@@
   --ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1);
+  --ease-spring-snappy: cubic-bezier(0.34, 1.56, 0.64, 1); /* overridden by linear() below where supported */
+  --duration-tap: 90ms;
   --duration-fast: 150ms;
   --duration-base: 220ms;
+  --duration-sheet: 260ms;
+  --duration-swing: 420ms;
   --duration-slow: 420ms;
 }
+
+@supports (transition-timing-function: linear(0, 1)) {
+  :root {
+    --ease-spring-snappy: linear(0, 0.12 4%, 0.44 11%, 0.86 20%, 1.05 28%, 1.08 33%, 1.04 42%, 1 52%, 0.995 64%, 1);
+  }
+}
@@ :root[data-theme='dark'] {
   --shadow-float: 0 12px 34px -12px #00000099, 0 2px 6px #0000004d, 0 0 0 1px #ffffff0f;
+  --color-zinc: #3d4f68;
+  --color-brass-text: #f2c461;
+  --color-surface-raised: #16263e;
   color-scheme: dark;
 }
@@ @media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {
     --shadow-float: 0 12px 34px -12px #00000099, 0 2px 6px #0000004d, 0 0 0 1px #ffffff0f;
+    --color-zinc: #3d4f68;
+    --color-brass-text: #f2c461;
+    --color-surface-raised: #16263e;
     color-scheme: dark;
   }
 }
```

`--color-brass` is the same in both themes, so it is not repeated in the dark blocks. The two dark blocks stay
identical (the token test asserts it).

**`apps/web/test/tokens.test.ts` additions** (TEXT_PAIRS ≥ 4.5 in both themes; non-text ≥ 3):

```ts
// TEXT_PAIRS
['ink', 'zinc'],            // Naya tag label (L 10.21, D 7.14)
['#101f34', 'brass'],       // Pakka tag label (7.56 both)
['brass-text', 'surface'],  // Useful pressed (L 6.16, D 10.34)
['brass-text', 'bg'],       // (L 5.43, D 11.28)
['brass-text', 'surface-alt'], // (L 4.99)
['ink', 'surface-raised'],  // dock, sheets (D 13.02)
['muted', 'surface-raised'], // (D 7.12)
// NON_TEXT_PAIRS (≥ 3)
['brass-text', 'surface'],  // brass tag edge (L)
['input-border', 'surface'], // zinc tag edge (L 3.76, D 5.04)
['#a3b3c7', 'navy'],        // tag edge on navy cards (7.75 / 7.38)
['accent-light', 'navy'],   // Master edge on navy (7.17 / 6.83)
```

---

## 8. Demo and self-check

- Demo: `D:\mechdost-qa\ustaad-visual-2026-11-27\demo.html` (built from `demo.src.html` + a lucide sprite taken from
  `node_modules/.pnpm/lucide-react@1.63.0…/icons/*.mjs`). Screens: Home (stories, compact ask, feed tabs, Fix log
  post, voice post), Ask thread (navy question card, voice player, choose best → stamp), Jobs, Me (ID card, weekly
  helped note, next level, stats), Notifications (rows + empty state), Create sheet (composer tiles), level sheet,
  story viewer. 1440 view: left rail, 640 px feed column, right column ("waiting for your answer", mini card, level
  ladder).
- Screenshots (`D:\mechdost-qa\ustaad-visual-2026-11-27\shots\`): `01-home-390-hi-light.png` (retaken after the fixes),
  `02-home-390-hi-dark.png` (pill shown, Like pressed), `03-me-390-hi-dark.png`,
  `04-ask-390-hi-light.png` (stamp after choosing, voice playing), `05-story-390-hi-light.png`,
  `06-home-1440-en-light.png`, `07-create-1440-en-dark.png`, `08-levels-1440-en-dark.png`.
- **The demo is a subset**: it shows the visual layer on parts of each screen. Home omits the greeting, the shortcuts
  and the questions strip; posts omit Listen and the `⋯` menu contents; Me omits badges, my work and the settings list.
  Every control in the UI upgrade doc stays; nothing is removed by this proposal. The toolbar says so too.
- The demo loads Manrope, DM Sans and Noto Sans Devanagari from Google Fonts (it needs a connection to render
  correctly; the product uses next/font).
- Rendered in Chrome (chrome-devtools), once for review and once to verify the fixes; one page at a time, and each
  was closed afterwards. Chrome capped the viewport at 500 × 637,
  so the 390 shots are full-page captures of the 390 × 844 frame, and the "1440" shots were captured at a 1370 px
  viewport (the layout is the ≥ 1024 desktop grid). Shots 02–08 predate the last fixes (type sizes 13/14, plain story
  ring, notification bars, outline Chhotu); `demo.html` has them.

**Anti-slop self-check (from the screenshots) and fixes made:**

| Check                                                                                     | Result                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gradients / glass / blobs                                                                 | none (only the stand-in photo placeholder)                                                                                                                                                                    |
| Emoji icons                                                                               | none; lucide only                                                                                                                                                                                             |
| Identical card kit                                                                        | no: posts edge-to-edge, cards only for jobs/progress/stats/aside                                                                                                                                              |
| Load animations                                                                           | none; pill appears only after a fresh read and only inside the feed                                                                                                                                           |
| All-caps / eyebrows / arrows / dot meta                                                   | none added (one existing key keeps its dot)                                                                                                                                                                   |
| Copied look                                                                               | heart kept from the product (existing control); no gradient ring; stamp/tag/grade lines are our own                                                                                                           |
| **Fixed:** action row overflowed at 390 in Hindi ("काम की बात" wrapped, WhatsApp clipped) | split into a reactions row (Like, काम की बात) and an actions row (Comment, Save, WhatsApp), all with words                                                                                                    |
| **Fixed:** new-posts pill covered the story row on load                                   | shows only when scrolled > 260 px into the feed                                                                                                                                                               |
| **Fixed:** story viewer filled the browser, not the phone                                 | sized to the frame                                                                                                                                                                                            |
| **Fixed:** sheet grab bar showed in the 1440 dialog                                       | hidden ≥ desktop                                                                                                                                                                                              |
| Known demo limits                                                                         | segmented control thumb in dark reads as a darker "hole" (acceptable; product uses `surface-raised`); the 1440 shot shows the focus ring returned to the story the viewer was opened from (correct behaviour) |

`01-home-390-hi-light.png` was retaken after these fixes and the accessibility fixes below: Useful is pressed and the
pill is shown.

**Accessibility check of the demo** (accessibility-lead → contrast-master + modal-specialist, static review). All the
contrast pairs passed. These findings were fixed in the demo, and the product must do the same:

| Finding                                                                                         | Fix (demo)                                                                                                               | Product rule                                                                         |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Sheets had no focus containment and stayed in the tab order when closed (2.4.3, 4.1.2, serious) | rest of the frame `inert` while a sheet is open; closed sheets `visibility:hidden`                                       | sheets use native `<dialog>` + `showModal()` (the existing `feed/sheet.tsx` pattern) |
| `clip-path` on the tag clipped its focus ring (2.4.7, serious)                                  | `:focus-visible` drops the outer clip and draws the ring (the inner shape stays)                                         | same in `PehchaanTag`                                                                |
| Pressed Useful differed only by colour (1.4.1)                                                  | the wrench fills brass when pressed (shape cue, like the filled heart)                                                   | same                                                                                 |
| Story auto-close ran on a fresh 6 s timer after a resume; the Pause label went stale on reopen  | the story advances on the bar's `animationend` (pause keeps the remaining time); one `setHeld()` sets the icon and label | same                                                                                 |
| Hidden pill stayed focusable; `aria-live` was on a button                                       | `visibility:hidden` while hidden; a separate `role=status` node                                                          | same                                                                                 |
| The count roll exposed both numbers to screen readers                                           | the incoming number has `aria-hidden`                                                                                    | same                                                                                 |
| Story track and on-navy waveform were 2.58 / 2.99:1                                             | raised to `#ffffff73` (≥ 3:1)                                                                                            | same                                                                                 |
| No forced-colors styles                                                                         | `@media (forced-colors: active)` gives tags a CanvasText border                                                          | same                                                                                 |
| Kept as a note: under reduced motion the demo's waveform jumps to the end                       | —                                                                                                                        | the product drives progress from `audio.currentTime`, stepwise                       |

**Web Interface Guidelines** (vercel-labs `command.md`, fetched 2026-11-27): the demo passed transform/opacity-only
motion, named transition properties, reduced motion, interruptible motion, `:focus-visible`, `touch-action:
manipulation`, tabular numerals, real links in the dock and pause controls on auto-advancing content. Fixed: added
`theme-color` metas for both themes, set tap highlights deliberately, and added `overscroll-behavior: contain` on
sheets. Not applied on purpose: "Title Case for headings and buttons". MechDost copy is sentence case
(design-system "Copy rules", frontend-design), and Hindi has no case.

---

## 9. Decisions to add (on the founder's OK)

Append to `docs/decisions.md` as "2026-11-27 (night) — Ustaad visual language (bench kit)":

- **V0 Colour direction**: A Bench kit (recommended), B Enamel pass or C Painted board (§ 3.6). V1–V2 below assume A; B and C each add the enamel or painted values listed in § 3.6.
- **V8 Lifted light mode** for the network (§ 3.7), incl. floating-sheet posts (trades the approved edge-to-edge feed for depth).
- **V9 Site-wide light lift** (§ 3.8 items 1–7) as a separate batch.
- **V1 New colour tokens** `--color-zinc`, `--color-brass`, `--color-brass-text`, `--color-surface-raised` (light +
  dark values § 3.2, contrast in § 3.2, tests in § 7). **Supersedes** UI upgrade doc Principle 3 ("no new colours")
  for the network only; shop pages unchanged. Required by hard rule 2.
- **V2 Level finishes**: Chhotu pill · pending hatched · Naya zinc · Pakka brass · Bada copper (`accent-button`) ·
  Master ink (navy in light, steel in dark), every tag with a 1 px edge; replaces the colour column of UI upgrade doc
  § 3.8.
- **V3 Grade lines** on tags (0–4, ordinal, inspired by bolt-head markings; not SAE grades).
- **V4 Best-answer stamp** look (success double rule, −2°) and the 3 px success rule on the chosen answer.
- **V5 "काम की बात"** reaction = lucide `wrench`, pressed colour brass; Helpful in Q&A stays `thumbs-up`.
- **V6 Motion tokens** `--ease-spring-snappy` (linear() with fallback), `--duration-tap/sheet/swing`, and the six named
  motions M1–M6 (§ 5). CSS only. Same-document View Transitions as enhancement. No scroll-driven animations.
- **V7 Dark elevation** step `surface-raised` for dock/sheets; no shadows in dark.

Shape note: the Pehchaan tag shape was already accepted with the UI upgrade doc (§ 3.8, "the one new shape"); no new
radius tokens are added here.

---

## 10. Implementation plan: a polish pass over U1–U4

Each batch applies the visual layer to the files it already touches. No API or data changes. Every batch: tokens from
`packages/ui/src/tokens.css` only (no raw hex in components), `prefers-reduced-motion` honoured, `pnpm check`, Hindi
coverage e2e, light/dark screenshots at 390/768/1440.

**P0 (before or with U1): tokens.** `packages/ui/src/tokens.css` (§ 7 diff), `apps/web/test/tokens.test.ts`
(pairs), `docs/design-system.md` (colour, motion and "Ustaad bench kit" sections), `docs/decisions.md` (V1–V7). Motion
keyframes and shared classes go in `apps/web/src/app/[locale]/globals.css` under an `/* ustaad */` block (`tick`,
`swing`, `stamp`, `seg`, `sheen`, count-roll, reduced-motion overrides).

| Batch                                           | Components                                                                                                                                                                                                                           | Files                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U1** shell, Home, stories                     | dock (5 tabs, bar M3, Create block), header, story ring (segmented arcs, seen/unseen, own "+"), story viewer (M6, controls, scrim), compact hero, segmented feed tabs, new-posts pill (M4), skeletons                                | `components/ustaad/shell/ustaad-nav.tsx`, `shell/icons.tsx` (map to lucide names), `feed/story-row.tsx`, `feed/story-viewer.tsx`, `feed/feed-screens.tsx`, `feed/feed-list.tsx`, `app/[locale]/ustaad/layout.tsx` (View Transition wrapper on client navigation) |
| **U2** post card, composer                      | edge-to-edge post, template chip, fix-log `<dl>` rules, reactions row (Like + काम की बात, M1 tick + count roll), actions row, Pehchaan tag next to author (M2), Create sheet tiles                                                   | `feed/post-card.tsx`, `feed/social-common.tsx`, `feed/composer.tsx`, `feed/sheet.tsx`, new `components/ustaad/common.tsx` export `PehchaanTag` (or `card/pehchaan-tag.tsx`)                                                                                      |
| **U3** voice, Ask, messages                     | voice-note player (waveform reveal, speed chip, one at a time), navy question card, best-answer stamp (M5) + reorder in a View Transition, Helpful pressed brass, sticky composer on `surface-raised`                                | `media/voice-note.tsx`, `media/voice-recorder.tsx`, `qa/question-thread.tsx`, `qa/ask-list.tsx`, `qa/ask-composer.tsx`, `messages/thread-view.tsx`, `messages/composer.tsx`                                                                                      |
| **U4** Me, profile, levels, jobs, notifications | ID card (strip, slot, tag, one primary), weekly helped note, next-level meters (`transform: scaleX`), stat row, level sheet ladder with tags, job card, notification rows (type icon squares, unread dot), empty states (dashed bay) | `card/my-card.tsx`, `card/verification-progress.tsx`, `feed/profile-screen.tsx`, `learn/learn-view.tsx`, `jobs/jobs-view.tsx`, `discover/discover-view.tsx`, site notifications row component (spec 10), `common.tsx` (EmptyState)                               |

**Tests to add with the batches:** tokens test pairs (§ 7); a Playwright check that every `.pehchaan-tag` has a
visible level word and that `aria-pressed` toggles on Like/Useful; a reduced-motion e2e (emulate
`prefers-reduced-motion: reduce`) asserting the story viewer does not auto-advance; visual snapshots of the tag ladder
in both themes; the JS budget check (`scripts/measure-js.mjs`) shows no growth from motion.

**Events:** no new events from the visual layer. M1 reuses `ustaad_post_liked {via}`; the Useful reaction needs
`ustaad_post_useful {on}` (spec 12) when Q-UI-3 is built; M2 reuses `ustaad_level_sheet_opened`.
