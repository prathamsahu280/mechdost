# Partner portals UI upgrade — design (shop, workshop, delivery rider)

Status: **design, waiting for the founder; master–detail built (Batch E, 2026-11-28)** · Date 2026-11-27 (night) · Founder request (2026-11-27): "the partner shop
and workshops and other portals could also do a proper ui customization and upgrade, rn its bad make it better with
proper visualization and better components as well, first study for this too" · Decision entry: decisions.md
"2026-11-27 (night) — Founder: improvements approved …", item "Partner portals UI upgrade".

Inputs: spec 07 (partner portals), 04 (orders and routing), 06 (service requests), 24 (delivery agents), 08 (admin
shared pieces), design-system.md (tokens, Admin page patterns, Admin data colour, rider status strip), memory
"ui-redesign-feedback", "no-reload-feel", "hindi-everywhere". Visual study (internal, never published or committed):
`D:\mechdost-qa\portal-inspiration-2026-11-27\board.html`.

---

## 1. One-page summary for the founder

**What is wrong today (seen on the live screens of 2026-11-27):**

1. **The shop portal is one very long page of about fifteen cards that all look the same.** Availability, working
   hours, delivery area, "Who delivers", stock file, performance, team, then _New orders to accept_, then _Your
   orders_, then Delivered, Notes, Prices and "Sell another product". A new order — the one thing that has a timer —
   sits below the team card (screenshot `D1-2-02`). On a phone the owner scrolls past setup cards to find work.
2. **On a rider's phone the new offer starts below the fold.** The site's announcement bar, search bar, the page title,
   "Signed in as" and the status strip use the first 760 px of an 844 px screen; the offer card with its 1:52 timer
   starts at the very bottom (`D1-8b-06`, Hindi). The workshop portal has the same stack (name plate, My workshop,
   Home servicing, Performance, then requests).
3. **The numbers are hidden behind buttons and drawn small.** Shop performance and earnings are behind a quiet toggle;
   the workshop's performance is behind "Show performance". There is no "today" view anywhere: nobody can see at a
   glance "how many orders are waiting, how many are in progress, what did I earn".
4. **Timers are a small grey pill.** The timer is the most important number on an offer, but it looks like a tag.
   There is **no sound** on a new order, although spec 07 § UI asks for "sound + badge on new assignment".
5. **One dark-mode bug seen in the simulation:** the rider's "Take new jobs" label was nearly invisible on the white
   inset in dark mode (`D1-6-07`). The code was changed at 20:09 today (the online card is now `bg-success-bg` /
   `text-ink`), so this becomes an acceptance check rather than a fix.

**What we propose (no new feature; every item names its spec line):**

- **A partner frame for each portal** — the rider portal already has one. It is a short navy header with the
  business name and its state ("Taking orders" / "Busy for 2 hours" / "Online"). Under it are **tabs at the bottom
  of the phone** (at most 5) and a **navy side rail on a computer**. Spec 07 § UI already says "Partner shell = concept
  admin shell (navy sidebar) in mobile-first layout". The work comes first: **Today** opens on new orders, requests or
  offers. Setup (hours, area, team, agreement) moves to its own tab.
- **Today** = 4 big number tiles (waiting, in progress, ready, done today) + the work list. Each tile is a link to its
  list, uses the admin data colours (amber waiting, blue in progress, green done) and says what it means in words.
- **Offer card with a proper timer:** a large countdown in words and digits, plus an orange "tread" bar that drains
  (our own tyre-tread mark from the site header, not another app's look). There is one Accept button and Decline as a
  quiet button, and a short sound and vibration when a new offer arrives (after the partner turns sound on once,
  because browsers require a tap).
- **Order lanes as tabs with counts**, not a drag board: Packing · Ready for pickup (agent shops) · Out for
  delivery · Delivered · Given up (shop); Proposed · Confirmed · In the workshop · Ready & bill · Done (workshop). This is how Meesho and other Indian partner apps
  do it on a phone (research § 3).
- **Numbers you can read:** "You vs the city" bars become bullet bars with the city middle as a marker and the value
  written beside it. Earnings get a day-by-day bar chart in money green. The workshop funnel and payment split are
  drawn as labelled bars in one colour. Every chart also has a table view and works in Hindi and in dark mode.
- **Job card for workshops as numbered steps** (received → estimate → work → ready → bill → paid), with estimate
  lines as large rows showing each line's state in words (approved / waiting / declined).
- **Rider:** the offer goes to the top of the screen; job steps keep the 4-segment bar; earnings get a weekly
  bar chart from the payouts already recorded; the dark-mode label is re-checked.

**What we do NOT do:** copy any app's look, add toggles or modes that do not exist, add new money features (payout
statements wait for Q11), add a drag-and-drop board, or add a new chart library without your OK (question F1).

**Cost:** four build batches (one small shared kit, then shop, workshop and rider in parallel). No database change. Two
small read endpoints are proposed as _later_ (P1) items and are marked as such.

---

## 2. Principles (checked against hard rules 2, 8, 9, 10 and memory "ui-redesign-feedback")

1. **Restyle the real pages; invent nothing.** Every block below exists today or is a line in spec 07 / 24 that was
   never built; each is tagged **[built → restyle]**, **[spec, not built]** (with the spec line) or **[new — founder
   OK]**.
2. **Work first, setup second.** The first screen of each portal answers "what needs me now?". Setup lives one tab
   away and is never more than two taps from Today.
3. **One primary action per screen and per card.** Accept, Mark packed, Send proposal, Confirm pickup. Every other
   action is a quiet button.
4. **Phone in a shop or garage:** 360–390 px first, 48 px targets on every action button (the rider portal already
   uses 48 px), thumb-reach primary buttons, icon **with** a word (lucide line icons, 1.9 stroke, like the v4 chrome),
   and Hindi first (Devanagari length is about 1.3× English: no fixed-width labels).
5. **Our tokens only:** navy `#101f34`, accent `#ea5728` / button `#d2461a`, Manrope + DM Sans, the existing radii, and
   the Admin data colour tokens (amber waiting, red urgent, blue in progress, green done or money, grey empty). **No
   new colour, font or radius.** The one "signature" is the orange **tread** dash already used by the nav chip
   (`.nav-chip-active::after`), reused as the timer bar.
6. **Calm, not gamified.** No streaks, confetti, leaderboards or penalty scare copy. Rules (for example "an offer you do
   not answer goes back to MechDost") are stated plainly before the action (research pitfalls § 9).
7. **Slow data:** every list keeps its skeleton at row height, numbers stay visible while a new range loads, polls back
   off when the tab is hidden, and an offline line says when the data was last fetched ("Updated 2 min ago").
8. **No reload feel:** the frame lives in a `layout.tsx` (as the rider portal does), tabs are links with
   `aria-current`, and the frame never remounts.

---

## 3. Research summary (sources)

Full notes: `board.html` (pattern sections) and `research.md` beside it (`D:\mechdost-qa\portal-inspiration-2026-11-27\`). The key findings and their sources:

| Pattern                           | Finding                                                                                                                                                      | Source                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New-order alert                   | Zomato restaurant partners must accept or reject "within stipulated time"; vendors report automatic rejection after about 4 minutes, which cannot be changed | https://www.eternal.com/policies/online-ordering/ · https://www-dr.sapaad.com/knowledge-base/how-do-i-disable-or-modify-the-auto-reject-feature-for-zomato-orders/                                                                    |
| Reject penalty (what not to copy) | Restaurants were charged 25 % of the order or at least ₹25 for rejecting, and owners complained                                                              | https://www.deccanherald.com/amp/story/business%2Frestaurant-owners-slam-zomato-over-rejection-policy-973163.html                                                                                                                     |
| Rider offer                       | Swiggy shows earnings, time and route **before** the rider accepts; one-touch earnings on home (daily and weekly, cash in hand, orders, incentives)          | https://blog.swiggy.com/?p=7950                                                                                                                                                                                                       |
| Rider earnings clarity            | Rapido found most captains could not work out their daily earnings, so it rebuilt the earnings screen (snippet only)                                         | https://medium.com/rapidobike/rebuilding-rapido-captains-earnings-screen-3461a8152c18                                                                                                                                                 |
| Pipeline on a phone               | Meesho supplier: accepted orders move from Pending to the "Ready to Ship" tab, with days left to dispatch on each order                                      | https://sites.google.com/meesho.com/updated-alc/orders-tab                                                                                                                                                                            |
| Workshop board                    | AutoLeap's schedule board spreads jobs across bays with drag and drop (desktop); Shopmonkey links appointments to repair orders                              | https://autoleap.com/features/scheduling/ · https://www.shopmonkey.io/product/estimates                                                                                                                                               |
| Per-line estimate approval        | Tekmetric: the customer approves or declines each line from a phone; findings coloured red/yellow/green; signature audit log                                 | https://www.tekmetric.com/blog-post/questions-auto-tech-software · https://support.tekmetric.com/hc/en-us/articles/4421125978391-Digital-Signature-Authorization-Process                                                              |
| Declined lines                    | Shopmonkey parks declined lines as "Deferred services" for later                                                                                             | https://www.shopmonkey.io/blog/make-it-easy-for-customers-to-approve-or-decline-recommended-services                                                                                                                                  |
| Approval confusion (pitfall)      | Tekmetric G2 reviewers say customers get confused picking jobs                                                                                               | https://www.g2.com/products/tekmetric                                                                                                                                                                                                 |
| Stock on a phone                  | Shopify mobile: +/− or type a number, with an adjustment reason; committed stock is not editable                                                             | https://help.shopify.com/manual/shopify-admin/shopify-app/inventory-scanner                                                                                                                                                           |
| Stock adjustments                 | Vyapar: stock goes down when billing; manual adjustment for damage or loss                                                                                   | https://vyaparapp.in/guides/how-to-manage-stock-inventory-in-vyapar                                                                                                                                                                   |
| Payouts                           | Swiggy Owner: weekly invoices and settlements in the app; Zomato added daily payouts in 2024; Meesho Payments tab lists every deduction                      | https://apps.apple.com/in/app/swiggy-owner/id1209732136 · https://yourstory.com/2024/01/zomato-restaurant-partners-daily-weekly-payments-feature · https://supplier.meesho.com/learning-hub/lessons/how-to-handle-incorrect-penalties |
| Gross vs net (pitfall)            | Owners cannot match dashboard sales to bank deposits                                                                                                         | https://blog.petpooja.com/operations-workflows/why-swiggy-zomato-sales-bank-deposits-never-match/                                                                                                                                     |
| Reviews                           | Google Business Profile: reply from Maps; replies are public and the reviewer is told                                                                        | https://support.google.com/business/answer/3474050?hl=en                                                                                                                                                                              |
| Scorecards                        | Amazon Account Health: one 0–1000 score with Healthy / At risk / Unhealthy bands; Flipkart Gold/Silver/Bronze tiers over 90 days                             | https://sellercentral.amazon.com/gp/help/external/GR786P4BPEVKTBAG · https://support.increff.com/support/solutions/articles/36000414644-flipkart-performance-training                                                                 |
| Vernacular                        | Hindi was 54 % of Zomato's regional-language orders; Meesho tier-4 buyers prefer vernacular; low-literacy users rely on large icons beside each function     | https://inc42.com/buzz/zomato-app-now-available-in-hindi-startup-delivers-150k-orders-a-month-via-regional-languages/amp · https://theprint.in/ground-reports/voice-based-banking-for-low-literate-indians/2610584                    |
| Partner training                  | Urban Company trains partners on a dummy app (choose a job, mark leave, reach the helpline)                                                                  | https://www.urbancompany.com/blog/setting-up-service-partners-for-success-upskilling-at-urban-company                                                                                                                                 |
| Charts                            | Bullet chart is the compact form for "performance vs benchmark"; label ranges with text                                                                      | ui-ux-pro-max chart DB ("Performance vs Target (Compact)")                                                                                                                                                                            |

**What Indian partner users find familiar (we take these patterns):** a loud new-order alert with a visible countdown
and two buttons · tabs per order state with counts · a home that answers "aaj kitna kaam / kitna kamaya" at a glance ·
big numbers and few words (Khatabook/Vyapar) · red/amber/green with a word · online switch as the rider's main control
· WhatsApp-style links for customer approval.

**What we must not copy:** any app's colours, layout chrome or illustrations · hidden or steep penalties (state the
rule plainly, as spec 04 already does) · gamified incentives · one opaque score (we keep separate measures with the
city middle) · gross figures without the deductions · English-only partner screens.

### 3b. Visual study (board.html, 12 pattern sections, 19 reference apps)

Reference galleries came from public Google Play listings (package ids in each folder's `source.txt`; Shopmonkey from
its official site, because it has no Play app). Meesho supplier, a Blinkit/Zepto seller app and a Google Business
Profile app have no Play listing, and GoMechanic has no partner app, so these were not studied. Today's MechDost
screens sit beside them: the shop at 390 and 1440 in en and hi, the workshop demo at 390, and the rider offers, job,
documents and earnings in hi and dark. What the board showed:

- **Timer inside the primary button** is the shared look of Swiggy Partner ("Mark Ready in 10:32") and Zomato
  Restaurant ("ORDER READY (04:15)"). It is their signature, and a half-filled button puts white text on a light fill,
  so we **do not copy it**. We keep the timer as text plus a bar _directly above_ the button.
- **Lanes as tabs with counts** (Swiggy "Preparing 2 · Ready · Picked up 2", Dukaan, Tekmetric board on a tablet)
  confirm § 5.1 / § 6.1.
- **"Last refreshed 1 min ago"** on Flipkart Seller Hub's home confirms `UpdatedAgo`. Flipkart also puts "Critical
  actions" (counts that need the seller) first, which is our KPI tiles with "Needs you".
- **Single-hue earnings bars with the current period highlighted** (Urban Company "Money", Swiggy Delivery weekly,
  Uber weekly) match our money-green `DailyBars`. Every payout tool shows a **net total and states in words**
  (Upcoming / In processing). New finding: our rider earnings list a ₹50 payout and a −₹50 correction with **no
  total** (`_current/D1-14-06.jpg`), so § 7 adds a net "Paid to you" total.
- **Stock rows:** Khatabook "+ IN / − OUT" and Vyapar's in-stock switch per row confirm the −/+ stock control. Their
  red "OUT" button is not copied, because red means urgent or failed in our data colours. Khatabook's **"Low stock"
  chip** maps to spec 07 "low-stock alerts" (not built); it is added as P1.
- **Week strip:** AutoLeap's check-in screen (week strip, "Jump to today", empty day with one action) confirms the
  read-only calendar agenda (§ 6.4).
- **Rider home:** in Swiggy Delivery and Rapido Captain the online switch is the first control. Their surge maps,
  incentive banners, insurance and referral screens are out of scope (founder: no insurance; none of these exist).
- **MechDost today:** partner pages carry the full storefront footer (shop links, "Apply as a workshop", company
  block) under the work. On a phone, the workshop's requests start at y≈510 and the rider's offer at y≈760 of 844.
  This feeds question F4.

Gaps found (not documented publicly): exact countdown lengths in rider apps, rider OTP screens, onboarding checklists
and offline behaviour. We design those from our own specs (spec 24 already fixes pickup/delivery codes and photos).

---

## 4. Shared partner kit (used by all three portals)

All kit pieces are **in-house** (no new dependency). Registry check (shadcn-component-discovery, 2026-11-27): there is
no `components.json` and no Radix/Base UI in the app; the registry items that fit need new libraries:

| Need              | Registry candidate (checked)              | Dependencies               | Verdict                                                                                                                   |
| ----------------- | ----------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Timer ring        | @magicui `animated-circular-progress-bar` | none                       | **copy pattern** (plain SVG + CSS); restyled to tokens; we use a bar, the ring is the fallback for the rider's small card |
| Animated numbers  | @magicui `number-ticker`                  | `motion`                   | no (new dependency; numbers do not need to roll)                                                                          |
| Status pill       | @kibo-ui `status`, `pill`                 | badge / lucide             | no: we already have `StatusBadge` (admin)                                                                                 |
| Lanes board       | @kibo-ui `kanban`                         | `@dnd-kit/*`, `tunnel-rat` | no: lanes are tabs on a phone; no dragging (state machine moves orders, not hands)                                        |
| Calendar          | @kibo-ui `mini-calendar`                  | `radix-ui`, `date-fns`     | no: a day strip of 7 buttons is enough (§ 6.4)                                                                            |
| Steps / timeline  | @reui `stepper`, `timeline`               | `@base-ui/react`           | no: copy the markup idea (ordered list with `aria-current="step"`)                                                        |
| Data grid         | @reui `data-grid`                         | TanStack, dnd-kit, Base UI | no: `AdminTable` exists                                                                                                   |
| Banner            | @kibo-ui `banner`                         | Radix                      | no: the existing alert pattern                                                                                            |
| KPI / stat blocks | @dashboardblocks                          | —                          | registry URL not reachable on 2026-11-27 (404 on `/r/stats-01.json`); `OverviewTile` covers it                            |

Precedent: the admin settings workbench (decisions 2026-11-25 "Admin settings workbench" entry) checked the same registries and chose no new
dependency. Charts stay hand-made SVG like the admin charts (decision "Admin data colour": one hue per measure).
**Recharts is listed in CLAUDE.md's stack but is not installed** (no lockfile entry); adding it costs about 50–90 KB gz
in a lazy chunk. Question F1 asks the founder; the default is **no Recharts**.

New shared pieces (folder `apps/web/src/components/partner/`):

| Piece               | What it is                                                                                                                                                                                                                                                                                                      | Built from                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `PartnerFrame`      | Navy header strip (business name, state in words, Help call) + bottom tab bar under 1024 px (52 px tiles, icon over a word, `accent-soft` current tab, like the v4 dock) + navy side rail from 1024 px (`navy-sidebar` tokens, as spec 07 § UI). Lives in each portal's `layout.tsx`.                           | rider `AgentFrame` + v4 dock + admin side bar |
| `KpiTile`           | Number first (Manrope 28 px tabular), label, tone by meaning, icon chip, "Needs you" in words for amber/red, the whole tile is a link to its list; min height fixed (no shift)                                                                                                                                  | `OverviewTile` (same tokens; a partner size)  |
| `OfferTimer`        | Big countdown text ("4:32 left", "अभी 4:32 बाकी") + tread bar draining by `transform: scaleX` (one CSS animation per offer, linear, from the server end time); turns amber under 1 minute and says "Hurry" in words; reduced motion: no bar animation, the text still counts                                    | `offerLeftParams`, `useNow`, nav tread CSS    |
| `LaneTabs`          | Tab list (links with `?lane=` so the URL keeps the state) with a count badge on each; horizontally scrolls inside its own box at 360 px; keyboard arrows                                                                                                                                                        | admin toolbar + `ScrollRegion`                |
| `StepRail`          | Ordered list of steps with done / now / later, "Step 3 of 6" in words                                                                                                                                                                                                                                           | rider 4-segment bar                           |
| `BulletBar`         | One measure: your bar (accent for "you", ink marker for the city middle), the value written at the end, the city middle written under it; no colour-only meaning                                                                                                                                                | shop `Row` SVG in `shop-performance-api.tsx`  |
| `DailyBars` (moved) | The admin day-bar chart, moved from `portal/analytics-charts.tsx` to be shared (it already has tooltip, keyboard, table view and tone)                                                                                                                                                                          | existing                                      |
| `NewWorkAlert`      | Plays a short two-tone beep (Web Audio, no audio file) and `navigator.vibrate(200)` when the offer list gains an id and the page is visible; a one-time "Turn on order sound" button (browsers need a tap first; spec 07 § UI "sound + badge"); the choice is kept in `localStorage` (a per-device convenience) | `useNoticeRefresh` hook                       |
| `UpdatedAgo`        | "Updated 2 min ago · Refresh" line + offline line (`navigator.onLine`)                                                                                                                                                                                                                                          | `useNow`                                      |

Motion (design-system tokens): the offer card enters with a 220 ms fade + 8 px rise (`ease-out-soft`); a card that
leaves a lane collapses in 150 ms; tab change = no animation (instant, the frame stays). Nothing else moves. All
motion is off under `prefers-reduced-motion`.

---

## 5. Shop portal (`/partner/shop`)

### 5.1 Structure: tabs instead of one long page

| Tab (en / hi)                 | Route                        | What moves there (all **[built → restyle]** unless marked)                                                                                                  |
| ----------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today / आज                    | `/partner/shop`              | KPI tiles; **New orders** with `OfferTimer`; **In progress** (next step per order, packing slip, give up); flash line; push prompt; paused/suspended banner |
| Orders / ऑर्डर                | `/partner/shop/orders?lane=` | `LaneTabs`: Packing · Ready for pickup (agent mode) · Out for delivery · Delivered · Given up / cancelled; the existing lists and "Load more"               |
| Stock & prices / स्टॉक और दाम | `/partner/shop/stock`        | Your prices, Sell another product, Update stock with a file (CSV), Offers to accept                                                                         |
| Numbers / हिसाब               | `/partner/shop/numbers`      | How your shop is doing (owner), Team / My performance and earnings, Notes from MechDost                                                                     |
| My shop / मेरी दुकान          | `/partner/shop/profile`      | Availability (busy), Working hours, Delivery area, Who delivers your orders, Your team, Seller agreement                                                    |

Staff (no `payouts:read`, no performance) see the Numbers tab as "My performance" only; tiles never show money to
staff (the API already returns null). The packing slip route `/partner/shop/slip/{code}` stays outside the frame
(print page).

**Links already stored in notices** (lesson L-RT2): `/partner/shop` stays valid (it is Today). `#warnings` and other
anchors used by notice links are mapped by a small client handler on Today (`#warnings` → `/partner/shop/numbers#warnings`)
with a test that lists every partner link in `notice-catalogue.ts`.

### 5.2 Today — wireframes

390 px. **When any offer is open, the offers come first and the tiles shrink to one row of four count chips**
(the tiles' full 2 × 2 form shows only when nothing is waiting). Sizing with today's storefront chrome kept (F4
default: announcement ≈ 52 px + header ≈ 70 + phone search ≈ 60 = ≈ 180 px), strip 64, chips 72, list heading 40,
card top to Accept ≈ 200: **Accept sits at ≈ 560–600 px of 844, above the 64 px tab bar + safe area**, in en and hi
(Hindi item names wrap to two lines: +40 px still fits). If F4 is answered "hide the chrome" (as the Ustaad upgrade
does inside `/ustaad`, its design § E2), everything moves up ≈ 180 px.

```
┌──────────────────────────────────────┐
│ (storefront announcement + header +  │  ≈ 180 px, unchanged unless F4
│  phone search bar)                   │
├──────────────────────────────────────┤
│ ▓ Sharma Auto Parts        [☎ Help] │  navy strip, 64 px
│ ● Taking orders · Open till 21:00    │  state in words (green dot + word)
├──────────────────────────────────────┤
│ [2 New] [3 Packing] [1 Out] [6 Done] │  count chips, 72 px (tile tones; each a link)
│ New orders (2)          Updated 1 min│
│ ┌──────────────────────────────────┐ │
│ │ MD-RPR-2026-ZYJF5E-1             │ │
│ │ 3:41 left        ▬▬▬▬▬▬▬▬▬░░░░░░ │ │  OfferTimer (tread bar)
│ │ 2 items · ₹1,240 · PIN 492001    │ │
│ │ • Exide Mileage ML38B20L   × 1   │ │
│ │ • NBC bearing 6301-2RS     × 1   │ │
│ │ [        Accept order        ]   │ │  48 px, accent (≈ 580 px from the top)
│ │ [ Can't take it ]                │ │  quiet
│ └──────────────────────────────────┘ │
│ In progress (3) …                    │
├──────────────────────────────────────┤
│ [Today] [Orders] [Stock] [Numbers] [Shop] │ bottom tabs, 64 px + safe area
└──────────────────────────────────────┘
```

Nothing waiting (390 px): the four tiles show at full size (2 × 2, 112 px each, number first, "Needs you" in words on
amber), then "No new orders right now …" with its one action.

**Tile set by delivery mode** (agents are off per city by default, spec 24 § 7):

| Shop mode                       | Tiles                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Self-delivery (today's default) | New (amber) · Packing (blue) · Out for delivery (blue) · Delivered today (green)                         |
| MechDost agents                 | New (amber) · Packing (blue) · Ready for pickup (amber: waiting for a partner) · Delivered today (green) |

Counts come from the three existing lists (`/v1/shop/orders?view=offers|active|done`): offers are all live; "Packing"
and "Out for delivery" / "Ready for pickup" count the loaded `active` page by stage and show "20+" when a next cursor
exists; "Delivered today" counts today's IST rows on the first `done` page and shows "20+" when that page is full. No
new API. A count endpoint is a P1 option if owners find "20+" unhelpful.

**Several shops (spec 07 QA pass 4, hard rule 7):** an owner of two or more shops sees "{n} shops" in the strip (never one
shop's name or state for all). In v1 the lists stay merged, as today. A shop switcher and a shop name on each card need
the shop on `ShopOrder` (`packages/shared/src/order-views.ts` has no shop field today) → a small API addition, P1. The busy/hours/area cards keep one block per shop on My shop, as
today. Workshop owners with two workshops get the same pattern.

1440 px:

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│ MechDost   │ Sharma Auto Parts · ● Taking orders · Open till 21:00  [Help]│  (F4 default: storefront header above)
│ partner    ├──────────────────────────────────────────────────────────────┤
│            │ [2 New]   [3 Packing]   [1 Ready for pickup]  [6 Delivered]  │  4 tiles in a row
│ ▸ Today    ├───────────────────────────────┬──────────────────────────────┤
│   Orders   │ New orders (2)                │ In progress (3)              │
│   Stock &  │ ┌───────────────────────────┐ │ ┌──────────────────────────┐ │
│   prices   │ │ offer card + timer        │ │ │ Packed · next step       │ │
│   Numbers  │ └───────────────────────────┘ │ └──────────────────────────┘ │
│   My shop  │ ┌───────────────────────────┐ │ ┌──────────────────────────┐ │
│            │ │ offer card                │ │ │ Out for delivery · code  │ │
│ ☎ Help     │ └───────────────────────────┘ │ └──────────────────────────┘ │
└────────────┴───────────────────────────────┴──────────────────────────────┘
```

Empty Today: tiles show grey "0" with no "Needs you"; New orders: "No new orders right now. Fresh stock and open hours
get you more offers." + one action **Check your stock** (existing copy `shopTier1.empty*`).

### 5.3 Screen notes

| Screen                           | Change and why                                                                                                                                                                                                                                                                                    | Tag                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Offer card                       | `OfferTimer` replaces the pill; items listed with quantity; payout line (owner only, as now); Accept primary, "Can't take it" opens the existing decline reason form inline (no modal)                                                                                                            | built → restyle                                                                            |
| New-order sound                  | `NewWorkAlert` on Today; the bell already refreshes the list (`useNoticeRefresh`)                                                                                                                                                                                                                 | spec 07 § UI "sound + badge on new assignment", not built                                  |
| Order detail + handover          | Card shows the **step rail** (Accepted → Packed → Out for delivery → Delivered) and one next button; agent-mode orders show "Ready for pickup", the pickup code in the big code style (`BigCode`), and the agent's first name and vehicle (from `shopAgentHandover`)                              | built → restyle (spec 24 § Web screens)                                                    |
| Delivery code entry              | unchanged rules (auto-submit at 4 digits, 5 tries then locked with support link); larger field at 390 px                                                                                                                                                                                          | built → restyle                                                                            |
| Your prices                      | Each row: product, pack, **price / MRP** with a thin bar showing price as a share of the MRP (one hue; "₹1,180 of MRP ₹1,250"), status badge in words (On sale · Waiting for approval · Not approved · Taken off sale)                                                                            | built → restyle                                                                            |
| Stock per row (−/+)              | Today the screen has **no stock field** (a price request re-sends the current `onHand`; stock changes only by CSV). A per-row stock field with − / + (48 px) would call the existing `PATCH /v1/shops/{shopId}/inventory/{sku} {version, onHand}` (never below reserved, `STALE_OFFER` on a race) | **spec 07 "per-variant price/MRP/stock/active" — API built, UI not built** → P1, not in v1 |
| Stock CSV                        | Unchanged flow; the preview becomes `AdminTable` rows with error badges                                                                                                                                                                                                                           | built → restyle                                                                            |
| Delivery area                    | The shop's `GET /v1/shop/me` returns only a **summary** (PIN count, cheapest and dearest charge): shown as one tile-like card with the three numbers; "To change it, contact MechDost" stays. A per-PIN list needs a shop-side route (today only the admin detail has it)                         | built → restyle; per-PIN list = API, P2                                                    |
| Numbers → How your shop is doing | 30/90 switch kept; each measure is a `BulletBar` (acceptance, on time, give-ups (lower is better, said in words), time to accept, rating) with the city middle marker; when there is no city middle the marker is absent and the line says why                                                    | built → restyle                                                                            |
| Numbers → Earnings               | `DailyBars` (money green) on `byDay` from `/v1/shop/staff-performance`; total and by kind as rows; the lead text keeps saying what the figure is (the ledger, not sales)                                                                                                                          | built → restyle                                                                            |
| Payout statements                | **Not shown** — waits for Q11 (commission/payout rates)                                                                                                                                                                                                                                           | spec 07, not built, out of scope                                                           |
| Profile / hours / busy           | Availability card gets a segmented choice (Taking orders · Busy for … · Closed today) using the existing three API modes; hours as a weekday strip (Mon–Sun chips, open ones filled)                                                                                                              | built → restyle                                                                            |
| Who delivers your orders         | Existing request card; agent vs self-delivery as two labelled rows                                                                                                                                                                                                                                | built → restyle                                                                            |
| Returns handling (spec 07 line)  | Not shown: the product rule is "no returns" (CLAUDE.md); only the agent return code exists and stays on the order card                                                                                                                                                                            | —                                                                                          |

### 5.4 Copy (en / hi, new keys in `partnerShop`)

| Key                   | English                                                | Hindi                                                  |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `tab_today`           | Today                                                  | आज                                                     |
| `tab_orders`          | Orders                                                 | ऑर्डर                                                  |
| `tab_stock`           | Stock & prices                                         | स्टॉक और दाम                                           |
| `tab_numbers`         | Numbers                                                | हिसाब                                                  |
| `tab_shop`            | My shop                                                | मेरी दुकान                                             |
| `kpi_new`             | New                                                    | नए                                                     |
| `kpi_packing`         | Packing                                                | पैक हो रहे                                             |
| `kpi_ready`           | Ready for pickup                                       | उठाने के लिए तैयार                                     |
| `kpi_delivered_today` | Delivered today                                        | आज पहुँचाए                                             |
| `needs_you`           | Needs you                                              | आपका इंतज़ार                                           |
| `timer_left`          | {time} left                                            | {time} बाकी                                            |
| `timer_hurry`         | Hurry: under a minute                                  | जल्दी करें: एक मिनट से कम                              |
| `timer_rule`          | If you do not answer, the order goes back to MechDost. | जवाब न देने पर ऑर्डर MechDost के पास वापस चला जाता है। |
| `sound_on`            | Turn on order sound                                    | ऑर्डर की आवाज़ चालू करें                               |
| `state_taking`        | Taking orders                                          | ऑर्डर ले रहे हैं                                       |
| `state_busy_until`    | Busy until {time}                                      | {time} तक व्यस्त                                       |
| `updated_ago`         | Updated {minutes} min ago                              | {minutes} मिनट पहले अपडेट हुआ                          |
| `offline`             | You are offline. We will refresh when you are back.    | इंटरनेट बंद है। वापस आते ही ताज़ा करेंगे।              |

---

## 6. Workshop portal (`/partner/workshop`)

### 6.1 Tabs

| Tab (en / hi)              | Route                          | Content                                                                                                                         |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Today / आज                 | `/partner/workshop`            | KPI tiles (new requests · waiting for the customer · in the workshop · ready or to bill); **New requests** (propose or decline) |
| Jobs / काम                 | `/partner/workshop/jobs?lane=` | `LaneTabs` over the existing `active` and `done` lists (`GET /v1/workshop/requests?view=new                                     | active | done`): Proposed (`proposed`) · Confirmed (`confirmed`) · In the workshop (`vehicle_received`, `estimate_sent`, `approved`, `no_work_approved`, `in_progress`) · Ready & bill (`ready`, `billed`) · Done (`paid`, `completed`, `cancelled`, `rejected`); job cards open in place (deep link `?job=SR-…`) |
| Calendar / कैलेंडर         | `/partner/workshop/calendar`   | **Built in Batch P (2026-11-28)** (§ 6.4; the list rows carry `visitDate` / `visitHour`)                                        |
| Numbers / हिसाब            | `/partner/workshop/numbers`    | Performance (owner only; today behind "Show performance")                                                                       |
| My workshop / मेरी वर्कशॉप | `/partner/workshop/profile`    | My workshop (profile, hours, busy, capacity, menu), Home servicing, Roadside opt-in                                             |

Roadside offers keep their own panel on Today when the workshop has opted in (spec 22), with the same `OfferTimer`.

Tile sources (no new API): "New requests" = the `new` list; "Waiting for the customer" = `active` rows with
`waitingForCustomer` (a field the summary DTO already has); "In the workshop" and "Ready or to bill" = `active` rows by
status. Counts of a paged list show "20+" when a next cursor exists.

### 6.2 Request card and proposal

**[built → restyle]** Card shows the vehicle (make, model, fuel), the problem, area and distance, and the customer's
preferred time. "Send a proposal" is the one primary button. It expands inline to the existing form: date, hour
picker, cost range and note. The hour picker becomes a row of 48 px hour chips showing free capacity in words
("2 free" / "full"), from the capacity the picker already reads. Decline is a quiet button with the reason codes.

### 6.3 Job card + per-line estimate (key screen)

390 px:

```
┌──────────────────────────────────────┐
│ SR-RPR-2026-K3M9QD   [In workshop]   │ status badge (blue)
│ Maruti Swift · Petrol · CG04 …       │
│ ①──②──③──④──⑤──⑥                    │ StepRail: Received ✓ Estimate ✓ Work ● Ready Bill Paid
│                                      │ (states: vehicle_received · estimate_sent/approved/
│                                      │  no_work_approved · in_progress · ready · billed · paid)
│ Step 3 of 6: Work                    │
├──────────────────────────────────────┤
│ Estimate                    ₹3,450   │
│ ┌──────────────────────────────────┐ │
│ │ Brake pads (front)   ₹1,800  ✓   │ │ "Approved" badge green, word + icon
│ │ Labour              ₹  650  ✓    │ │
│ │ Coolant top-up       ₹  300  …   │ │ "Waiting for customer" amber
│ │ Wiper blades         ₹  700  ✕   │ │ "Declined" grey, struck total
│ └──────────────────────────────────┘ │
│ Approved ₹2,450 · Waiting ₹300       │
│ [ + Add a line ]  (quiet)            │
│ Photos (3)  [▢][▢][▢] [+ Add photo]  │
│ [        Mark ready for pickup     ] │ one primary
└──────────────────────────────────────┘
```

At 1440 px the job card opens as a right-hand panel beside the lane list (master–detail):

```
┌────────────┬───────────────────────────────┬──────────────────────────────────────────┐
│ side rail  │ Jobs  [Proposed 2][Confirmed 3]│ SR-RPR-2026-K3M9QD      [In the workshop] │
│ Today      │ [In the workshop 4][Ready 1]…  │ Maruti Swift · Petrol                     │
│ ▸ Jobs     │ ┌───────────────────────────┐ │ ①──②──③──④──⑤──⑥  Step 3 of 6: Work      │
│ Numbers    │ │ SR-…K3M9QD · Swift · Work │◀│ Estimate lines (rows, states in words)   │
│ My workshop│ └───────────────────────────┘ │ Approved ₹2,450 · Waiting ₹300           │
│            │ ┌───────────────────────────┐ │ Photos  [▢][▢][▢]                         │
│            │ │ SR-…P2Q8XA · Activa · Est.│ │ [          Mark ready for pickup       ] │
│            │ └───────────────────────────┘ │                                          │
└────────────┴───────────────────────────────┴──────────────────────────────────────────┘
```

The selected job is in the URL (`?job=`), so Back and reload keep it. On a phone it opens in
place and "Back to jobs" returns focus to the card that opened it.

Everything above exists (estimate builder with lines, per-line approval states, odometer, arrival code for home
visits, photos, steps, bill, mark paid). The change is visual: the step rail, line rows with states in words (`EstimateDecision` = `pending` / `approved` / `declined`), totals
split by state, and one next-step button. Saved line templates (spec 07 "estimate builder with saved line
templates") are **[spec, not built]** → P1.

### 6.4 Calendar (slots)

**[spec 07 "calendar with hourly capacity, blackout dates" — partly built]**: capacity per hour and the hour picker
exist; a calendar view does not. Proposal: a **read-only agenda** (P1): a 7-day strip (date chips showing the number of
visits) and, for the chosen day, the confirmed visits by hour with the free capacity written per hour
(`GET /v1/workshop/slots` already returns `{hour, free}` for a date). **As built (Batch P, 2026-11-28): the strip and the day's visits by hour; free capacity per hour is not shown.** **API need (met):** the list rows
(`ServiceRequestSummaryDto`) carry only the customer's `preferredDate` / `preferredSlot`, not the accepted proposal's
date and hour, so the agenda needs those two fields on the summary (small API change) or one detail call per job
(too many calls on slow data). Not in v1.
Blackout dates and per-hour edits need API work → P2 (new endpoint, spec 07 line). No drag grid (research: drag
boards are desktop-only bay tools).

### 6.5 Numbers (performance)

**[built → restyle]** Tiles keep the city median beside each figure. Funnel (requests → proposed → accepted → billed)
as horizontal bars in one blue, with the count and percent written. Money as rows. **Payment split** (cash / UPI /
card) as three labelled bars in money green, **not** three colours: the palette check (dataviz validator, 2026-11-27)
failed for blue/green/orange as categories (CVD ΔE 4.2 light; normal-vision ΔE 13.7 dark), so we use one hue with
the label and value written. Reasons for cancelled/rejected work as a sorted bar list with counts.

### 6.5b Bills and the service menu

- **Bill** **[built → restyle]**: the bill step shows approved lines only, GST per line and the rupee round-off
  (`service-bill.ts`), the total in Manrope 28 px, and "Mark paid at the workshop" with the payment way (cash / UPI /
  card) as three 48 px choice buttons with words. An online payment already made shows "Paid online" and no mark button
  (spec 07 § Workshop bill payment).
- **Service menu** **[built → restyle]** (My workshop tab): each line as a row: name (en + hi), price range "₹800–₹1,200",
  duration, on/off switch with its state in words; "Add a service" quiet; one "Save changes" primary in the existing
  sticky save bar pattern (design-system "Forms"). Hindi name missing → an amber "Hindi name missing" badge (hard rule
  10), never a blocker on saving other fields.

### 6.6 Reviews

Rating and count already show in Numbers. **Reply to reviews** (spec 07 "reviews reply") is **[spec, not built]**:
P2, with its own API and moderation rule. It is not part of this upgrade.

### 6.7 Copy (en / hi, `partnerWorkshop`)

| Key                    | English                     | Hindi                     |
| ---------------------- | --------------------------- | ------------------------- |
| `tab_jobs`             | Jobs                        | काम                       |
| `tab_calendar`         | Calendar                    | कैलेंडर                   |
| `tab_workshop`         | My workshop                 | मेरी वर्कशॉप              |
| `kpi_new_requests`     | New requests                | नए अनुरोध                 |
| `kpi_waiting_customer` | Waiting for the customer    | ग्राहक के जवाब का इंतज़ार |
| `kpi_in_workshop`      | In the workshop             | वर्कशॉप में               |
| `kpi_to_bill`          | Ready or to bill            | तैयार या बिल बाकी         |
| `step_of`              | Step {n} of {total}: {name} | चरण {n} / {total}: {name} |
| `line_approved`        | Approved                    | मंज़ूर                    |
| `line_waiting`         | Waiting for the customer    | ग्राहक का इंतज़ार         |
| `line_declined`        | Declined                    | मना किया                  |
| `hour_free`            | {n} free                    | {n} खाली                  |
| `hour_full`            | Full                        | भरा हुआ                   |

---

## 7. Delivery rider portal (`/partner/delivery`)

The frame exists (status strip, online switch, Help, 4 tabs: Offers · My jobs · History · Profile). Changes:

| Screen                  | Change                                                                                                                                                                                                                                                                                                                                          | Tag                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Frame on a phone        | The offer must be above the fold at 390 × 844: the page intro ("Deliveries", "Signed in as …", Sign out) moves into the strip (sign-out lives in the account menu already); tabs move to the bottom bar (`PartnerFrame`)                                                                                                                        | built → restyle                                                            |
| Online switch           | Strip shows the state in words and colour (green "Online · new offers come here" / grey "Offline"); the dark-mode label contrast seen in `D1-6-07` was changed in code at 20:09 today (`bg-success-bg` + `text-ink` when online) — re-measure in both themes                                                                                    | built → restyle + **P0 check**                                             |
| Offer card              | `OfferTimer` (15 min default per founder ruling, so mm:ss); pickup area → drop area with distance; items, load class (light / heavy / bulky), distance and attempt number (the fields spec 24 § Web screens lists); "Accept" primary, "Decline" quiet with reasons (existing); sound + vibration via `NewWorkAlert`                             | built → restyle; sound is spec 24 offers "with a countdown" + spec 07 § UI |
| Job steps               | Keep the 4 steps; the step header becomes the shared `StepRail`; shop card (call shop, open in maps), pickup code + parcel photo; customer card hidden until pickup (as now); big code entry; failed delivery with reason + photo                                                                                                               | built → restyle                                                            |
| History                 | Rows grouped by day with a day total count ("Today · 4 delivered")                                                                                                                                                                                                                                                                              | built → restyle                                                            |
| Earnings (in Profile)   | Net "Paid to you" total (corrections included; today only the rows are listed, see board `D1-14-06`) + delivered jobs as two tiles; payout rows as a list; a **bar chart of payouts by period** (money green) from the payout rows already returned by `GET /v1/agent/me/earnings`; reversing corrections shown as their own row (never hidden) | built → restyle                                                            |
| Documents               | PAN, licence, RC as three rows with status badges in words (Approved · Waiting · Not approved: reason) and one "Upload again" button per row                                                                                                                                                                                                    | built → restyle                                                            |
| Own rating              | Average + count only (founder ruling); no per-customer detail                                                                                                                                                                                                                                                                                   | built → restyle                                                            |
| Per-day delivered chart | Needs a per-day series → **new read endpoint** `GET /v1/agent/me/stats?days=`                                                                                                                                                                                                                                                                   | new — P1, founder OK needed                                                |

390 px offer screen:

```
┌──────────────────────────────────────┐
│ ▓ Hello, Raju · Motorcycle  [☎ Help]│
│ [● Online · new offers come here  ⏻]│  switch in the strip, 48 px
├──────────────────────────────────────┤
│ New offers (1)        Updated 20 s   │
│ ┌──────────────────────────────────┐ │
│ │ 12:41 left  ▬▬▬▬▬▬▬▬▬▬▬▬░░░       │ │
│ │ Pick up  Pandri / Shankar Nagar  │ │
│ │ Drop     PIN 492001 · 4.2 km     │ │
│ │ 2 items · light                  │ │
│ │ [          Accept job         ]  │ │
│ │ [ Decline ]                      │ │
│ └──────────────────────────────────┘ │
├──────────────────────────────────────┤
│ [Offers] [My jobs] [History] [Profile] │
└──────────────────────────────────────┘
```

1440 px: the rider portal stays a single centred column (max 576 px, as today's `max-w-xl`) with the navy side rail on
the left; riders use phones, so the desktop view only has to work, not to be dense.

Copy (en / hi, `partnerRider`): `online_on` "Online · new offers come here" / "ऑनलाइन · नए ऑफ़र यहीं आएँगे";
`online_off` "Offline · you get no offers" / "ऑफ़लाइन · कोई ऑफ़र नहीं आएगा"; `earn_total` "Paid to you" /
"आपको मिला"; `earn_jobs` "Jobs delivered" / "पहुँचाए गए काम"; `history_day` "{day} · {n} delivered" /
"{day} · {n} पहुँचाए".

---

## 8. Mechanic / other partner views

Mechanics use the Ustaad Network (spec 23), which has its own UI upgrade in progress (decision 2026-11-27 night). The
workshop portal's staff view (mechanic role sees assigned job cards only, spec 07) uses the workshop Jobs tab with the
other tabs hidden. `/partners/status` (application status) gets the `StepRail` (New → In review → Approved/Rejected)
as a restyle. No separate mechanic portal is designed here.

---

## 9. Accessibility (WCAG 2.2 AA, both themes)

- Tabs: `<nav aria-label>` with links and `aria-current="page"`; lanes: links with `aria-current`, count in the
  accessible name ("Packing, 3 orders").
- Timer: visible text is the source of truth; an `aria-live="polite"` region announces only at 5 min, 1 min and
  expiry (not every second); the bar is `aria-hidden`.
- New-work sound is never the only signal (bell badge, list update, live region "New order MD-…").
- Every chart: title, the value written beside each mark, a "Show as table" button (existing `DataTable`), keyboard
  focus shows the same detail as hover; marks ≥ 3:1 on the card in both themes (tokens test).
- Targets 48 px for actions, 44 px minimum for everything else; focus never hidden under the bottom bar
  (`scroll-padding-bottom` = bar height; WCAG 2.4.11).
- Colour is never alone: "Needs you", "Approved", "Hurry" are words.
- Hindi: no fixed widths; tabs allow two lines; Devanagari line height 1.5.

## 10. Analytics (spec 12 additions, same change as the build)

`partner_tab_viewed {portal, tab}` · `partner_kpi_clicked {portal, tile}` · `partner_lane_viewed {portal, lane}` ·
`partner_sound_enabled {portal}` · `partner_offer_alert_played {portal}` (sampled, client) · `partner_chart_table_toggled
{portal, chart}` · existing events stay (`shop_performance_viewed`, `workshop_analytics_viewed`, `shop_staff_perf_30/90`,
delivery events). Pseudonymous; no order codes or names in properties.

## 11. Performance budget

- Partner pages are not product pages, but the 180 KB gz product-page budget must not grow: **no partner code in
  always-loaded chunks** (the 2026-11-27 overnight deploy failed on exactly this). The kit lives under
  `components/partner/` and is imported only from `/partner/*` layouts.
- Each portal route: first-load JS ≤ 200 KB gz (measure with the build output); charts lazy (`next/dynamic`) on the
  Numbers tabs; the sound helper loads on the first "Turn on order sound" tap.
- Polls: offers 30 s while visible, paused when hidden, immediate refresh on bell notices (exists).
- INP < 200 ms on Accept (optimistic disabled state, then the server answer).

---

## 12. Ranked enhancements

| #   | Item                                                              | Portal                         | Impact × effort | Tag                                   |
| --- | ----------------------------------------------------------------- | ------------------------------ | --------------- | ------------------------------------- |
| 1   | Partner frame with bottom tabs / side rail; work first            | all                            | high × M        | spec 07 § UI                          |
| 2   | Offer card with `OfferTimer` + offer above the fold               | shop, rider, workshop roadside | high × S        | restyle                               |
| 3   | Rider dark-mode label contrast (re-measure; code changed 20:09)   | rider                          | high × XS       | bug check                             |
| 4   | Today KPI tiles linking to lanes                                  | shop, workshop                 | high × S        | restyle (counts from existing lists)  |
| 5   | Order/job lanes as tabs with counts                               | shop, workshop                 | high × M        | restyle                               |
| 6   | New-order sound + vibration (opt-in tap)                          | shop, rider, workshop          | high × S        | spec 07 § UI, not built               |
| 7   | Job card step rail + per-line estimate states                     | workshop                       | high × M        | restyle                               |
| 8   | BulletBar performance vs city middle                              | shop, workshop                 | med × S         | restyle                               |
| 9   | Earnings day bars (shop), payout bars (rider)                     | shop, rider                    | med × S         | restyle                               |
| 10  | Price row with MRP share bar                                      | shop                           | med × S         | restyle                               |
| 10b | Per-row stock −/+ on the existing inventory PATCH                 | shop                           | med × S         | built (Batch P, 2026-11-28)           |
| 11  | Availability segmented choice + hours weekday strip               | shop                           | med × S         | restyle                               |
| 12  | Hour chips with free capacity in the proposal                     | workshop                       | med × S         | restyle                               |
| 13  | "Updated n min ago" + offline line                                | all                            | med × XS        | new — small, founder OK               |
| 14  | Documents rows with status words                                  | rider                          | med × XS        | restyle                               |
| 15  | Status page step rail                                             | applicants                     | low × XS        | restyle                               |
| P1  | Workshop calendar agenda (read-only)                              | workshop                       | med × M         | built (Batch P, 2026-11-28)           |
| P1  | "Low stock" filter on Your prices (threshold as an admin setting) | shop                           | med × S         | spec 07 "low-stock alerts", not built |
| P1  | Saved estimate line templates                                     | workshop                       | med × M         | spec 07, not built (API)              |
| P1  | Rider per-day stats endpoint + chart                              | rider                          | med × M         | new — founder OK                      |
| P2  | Blackout dates / per-hour capacity edit                           | workshop                       | med × L         | spec 07, API                          |
| P2  | Review replies                                                    | workshop                       | med × L         | spec 07, API + moderation             |
| P2  | Payout statements                                                 | shop                           | high × L        | waits for Q11                         |

---

## 13. Build plan (v1 — research can only add P1/P2 items)

Four batches. **Batch 0 runs first** (about 1–1.5 h); A, B and C then run **in parallel** in their own worktrees.
Each batch owns its own locale namespace, so the merge of `en.json` / `hi.json` is a set of independent new top-level
keys (no edits to someone else's keys). Shared files have one owner: Batch 0 owns `components/partner/*`,
`partnerKit` strings and `analytics-charts.tsx`; nobody else edits them (A–C may only import).

Every batch: standard agent-brief checklist (`.claude/skills/mechdost-advisor/references/agent-brief.md`), UI chain as
skills (accessibility-lead, ui-ux-pro-max, frontend-design, web-design-guidelines, shadcn-component-review),
`website-testing` + `verification-before-completion`. **No database change, no API change** in v1.

### Batch 0 — Partner kit (shared)

- Files (new): `apps/web/src/components/partner/{partner-frame.tsx, partner-tabs.tsx, kpi-tile.tsx, offer-timer.tsx,
lane-tabs.tsx, step-rail.tsx, bullet-bar.tsx, new-work-alert.ts, updated-ago.tsx, index.ts}`; CSS for the tread
  bar in `apps/web/src/app/globals.css` (or the existing utilities file next to `.nav-chip-active`).
- Files (changed): `components/portal/analytics-charts.tsx` (export `DailyBars`/`DataTable` for partner use; no
  behaviour change), `packages/shared/src/i18n/{en,hi}.json` (namespace `partnerKit`: timer, sound, updated, offline,
  table view, step words), `apps/web/test/tokens.test.ts` only if a new token pair is used (none expected).
- Tests: unit for `offer-timer` (time maths, amber under 60 s, reduced motion), `new-work-alert` (plays only on a new
  id and when visible), `lane-tabs` (URL state), `bullet-bar` (labels, no city marker when null).
- Acceptance: kit renders in both themes at 360/390/768/1440 (storybook-free: a test page under `e2e` fixtures or a
  unit render), axe clean, no import from a storefront chunk (check `next build` output: no kit module in shared
  chunks).

### Batch A — Shop portal

- Routes: `apps/web/src/app/[locale]/partner/shop/layout.tsx` (new: frame + ClientMessages, namespaces moved from
  `page.tsx`), `page.tsx` (Today), `orders/page.tsx`, `stock/page.tsx`, `numbers/page.tsx`, `profile/page.tsx`
  (new); `slip/[code]` unchanged.
- Components (changed): `components/portal/shop-portal-api.tsx` (split into `ShopTodayApi`, `ShopOrdersLanesApi`;
  the list hooks stay), `shop-portal.tsx` (demo: the same tabs over the demo store), `shop-profile-api.tsx`
  (header → frame state; cards to the profile tab), `shop-busy-api.tsx` (segmented choice), `shop-hours-fields.tsx`
  (weekday strip view), `shop-prices-api.tsx` + `shop-prices.tsx` (row with MRP share; no stock control in v1), `shop-csv-api.tsx`
  (preview table), `shop-performance-api.tsx` (BulletBar), `shop-staff-performance-api.tsx` (DailyBars),
  `shop-warnings-api.tsx`, `shop-offers-api.tsx`, `shop-onboarding-api.tsx` (agreement card on profile),
  `shop-empty.tsx`, `delivery/shop-delivery.tsx` (handover card + StepRail), `notices/*` only for the `#warnings`
  mapping (or a Today-page handler).
- Strings: namespace `partnerShop` (tabs, tiles, lanes, state words; table in § 5.4).
- Charts: BulletBar on `GET /v1/shop/performance/{shopId}`; DailyBars on `byDay` of `GET /v1/shop/staff-performance`.
  Tiles: counts from `/v1/shop/orders?view=offers|active|done` (show "20+" when a next cursor exists; "Delivered
  today" counts today's IST rows of the first page and says "20+" if the page is full).
- Events: `partner_tab_viewed`, `partner_kpi_clicked`, `partner_lane_viewed`, `partner_sound_enabled` (portal
  `shop`) + spec 12 rows.
- Acceptance: every block of today's page is reachable in the tabs (checklist in the PR); the Today offer card's **Accept button is fully visible above the bottom tab bar** on a 390 × 844 viewport in en and hi with the storefront chrome kept (F4 default); state-audit rows `API-SHOP-*` updated + new `SHOP-FRAME`;
  e2e seller-onboarding and shop flows green; Hindi coverage adds the 4 new routes; role leak: staff see no money tile
  and no owner-only tab content; old notice links open the right tab.

### Batch B — Workshop portal

- Routes: `app/[locale]/partner/workshop/layout.tsx` (new), `page.tsx` (Today), `jobs/page.tsx`,
  (no Calendar tab in v1: § 6.4 needs an API field), `numbers/page.tsx`,
  `profile/page.tsx`.
- Components (changed): `workshop-portal-api.tsx` (Today + lanes; master–detail at ≥ 1024 px), `workshop-portal.tsx`
  (demo), `workshop-job-api.tsx` + `workshop-job.tsx` (StepRail, estimate rows with state words and split totals),
  `workshop-tier1-api.tsx` (hour chips with free capacity; My workshop to the profile tab), `workshop-stats-view.tsx`
  - `workshop-performance-api.tsx` (funnel bars, single-hue payment split, tiles), `workshop-roadside.tsx`
    (OfferTimer), `home-visit-portal-api.tsx` (layout only).
- Strings: `partnerWorkshop` (§ 6.7).
- Charts: funnel, payment split, reasons on `GET /v1/workshop/analytics` (owner only); no new API.
- Acceptance: request → proposal → estimate → work → ready → bill → paid works on the new layout (existing e2e); the
  per-line states read as words in en/hi; staff (mechanic) see Jobs only; axe clean at 390 and 1440; state-audit
  rows `API-WS-*` updated + `WS-FRAME`; Hindi coverage for new routes.

### Batch C — Rider portal

**Starts after** the uncommitted edits to `delivery/agent-portal.tsx`, `ui/switch.tsx` and
`apps/web/test/delivery-online-card.test.ts` (another stream's online-card contrast fix, seen in the working tree on
2026-11-27) are merged, so the batch does not fight over the same lines.

- Routes: `app/[locale]/partner/delivery/layout.tsx` (move intro into the frame; bottom tabs).
- Components (changed): `delivery/agent-portal.tsx` (frame → `PartnerFrame`, online state words, offer card with
  `OfferTimer`, `NewWorkAlert`), `agent-job.tsx` (StepRail), `agent-profile.tsx` (earnings tiles + payout bars,
  documents rows), `parts.tsx` (only if `BigCode`/`CodeEntry` sizes change).
- Strings: `partnerRider` (§ 7).
- Charts: payout bars from `GET /v1/agent/me/earnings` (group rows by `periodFrom`; corrections as negative rows in
  the table, bars only for net per period).
- Acceptance: **dark-mode "Take new jobs" label ≥ 4.5:1** (tokens test + screenshot); offer top above the fold at
  390 × 844 in hi; accept/decline/expiry flows of `e2e` delivery specs green; role leak (foreign job 404) unchanged;
  state-audit rows `DLV-*` updated.

### After the batches

Lead merges A, B, C (namespaces do not overlap), runs the full gates, the JS budget, Hindi coverage, the state audit
and a real-phone check (360/390 in hi + dark), then updates spec 07, spec 24 § Web screens, spec 12, design-system.md
("Partner frame" section) and progress.md.

---

## 14. Founder questions (defaults used meanwhile)

Queued in `docs/questions-for-user.md` as Q-PP-F1 to Q-PP-F5.

| #   | Question                                                                                                                                                                                      | Default                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| F1  | Add Recharts (about 50–90 KB in a lazy chunk) for nicer charts, or keep our own drawn charts like the admin?                                                                                  | Keep our own (no new dependency)                                 |
| F2  | Is it OK to split the shop and workshop portals into tabs (same content, new places)?                                                                                                         | Yes, as designed                                                 |
| F3  | New-order sound: on by default after the first tap, or off until the partner turns it on?                                                                                                     | Off until the partner taps "Turn on order sound"                 |
| F4  | On partner pages, hide the site's announcement bar, phone search bar and the customer footer (shop links, "Apply as a workshop") so the work starts higher and partners see only their tools? | Keep them (chrome is shared); move the page intro into the strip |
| F5  | Rider per-day delivered chart needs a small new API (P1). Build it next?                                                                                                                      | Later (P1)                                                       |
