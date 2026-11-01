# Research — Admin console: controls, enforcement and visualisation

Written 2026-11-01 in answer to the owner's request: "research more around the admin controls and stuff and better visualization, how can that be done". This is research and recommendations only. Nothing here is decided until it is recorded in `docs/decisions.md`. It builds on `specs/08-admin-console.md`, `specs/04`, `specs/12`, `specs/13`, `specs/20` and `packages/shared/src/rbac.ts`.

Context that shapes every recommendation: Raipur first, then more cities. The market is mostly two-wheelers and pays mostly cash on delivery (COD). Partners are small local shops and garages that run everything from one phone. The ops team is small, so the console must make the next action cheap.

---

## 0. The short version

1. **Keep "availability" and "standing" as two separate things.** A partner sets availability (open, busy, holiday). Only staff set standing (active, warned, restricted, paused, suspended, offboarded). Mixing the two causes wrong penalties and confusing copy.
2. **Use a published, graduated ladder:** nudge → written warning → routing de-priority → timed pause (lifts itself) → suspension pending review → offboarding. Jump straight to suspension only for fraud, fake or counterfeit parts, safety issues, invalid KYC or a legal order.
3. **Base every automatic action on a scorecard with a minimum sample size and a human check.** Urban Company's opaque ID blocks led to repeated partner protests. Publish the thresholds, exclude cancellations the customer caused, and have a person confirm every pause or suspension.
4. **Every enforcement action carries a reason code, a written notice in English and Hindi, an end date or review date, and an appeal button.** Uber's appeal screens show the reason, the process and a "Request review" button with uploads.
5. **Build the rollups before the dashboard.** Add `metrics_daily` and `partner_metrics_daily` (IST day boundaries) and a test that reconciles them with the orders tables. Today neither table exists in `packages/db`.
6. **The Overview should start with a "Needs attention" list, not with charts.** Each alert gives an icon, a label, how long it has been open and one action. Under it go KPI tiles (value, change, sparkline, freshness) that link to their queue.
7. **Chart forms:** ranked bars for the fulfilment funnel, stat tile plus histogram for time to accept, a table with inline bars for per-shop scorecards, a diverging bar for coins issued against redeemed, and a MapLibre heatmap plus an "unserved pincodes" table for demand against supply. Never dual axes, pies or donuts.
8. **Library approach:** keep Recharts through the shadcn `chart` component, loaded with `next/dynamic` inside client islands. Draw sparklines in KPI tiles as server-rendered inline SVG with no library. MapLibre's native `heatmap` layer is already in the stack. Do not add Tremor or ECharts.
9. **Productivity basics that pay back from day one:** a global search and command palette (Ctrl/⌘K), queue keyboard shortcuts, saved views, bulk actions that show a preview (never for money), one inbox for four-eyes approvals, and per-entity audit timelines.
10. **Compliance hooks:** the partner agreement must list suspension grounds, notice and appeal (Consumer Protection (E-Commerce) Rules 2020 require a written contract with each seller). Audit logs record IDs and field names, not personal values (DPDP). Enforcement records are retained for at least 72 months, matching GST records.

---

## 1. What exists and what is missing

| Area                     | Today (demo, browser store)                                                                                     | Missing for launch                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Overview                 | KPI tiles linking to queues                                                                                     | Alert list, change against the previous period, freshness, funnel, real rollups                   |
| Orders / service routing | Ranked shops, reroute, reject, SR reassignment                                                                  | Saved views, search, keyboard flow, SLA alert at 50% of the timer (spec 04)                       |
| Partners                 | Applications; pause/suspend/reactivate **in progress**                                                          | Scorecards, warning ladder, notices, appeals, offboarding                                         |
| Customers                | —                                                                                                               | Customer 360, blocking (full or COD only), notes                                                  |
| Money                    | Coins desk                                                                                                      | Four-eyes approvals inbox (refunds, coin grants above threshold, payouts)                         |
| Platform                 | Content, layout and settings editors                                                                            | Per-city kill switches, maintenance mode, notification templates, staff and roles screens         |
| Logs                     | "Recent changes" per settings area                                                                              | Searchable audit log, per-entity timeline, exports                                                |
| DB (`packages/db`)       | `audit_log`, `settings`, `feature_flags`, `notification_templates`, `shops.status` (pending/approved/suspended) | No `workshops`, `metrics_daily`, `shop_metrics`, `blocked_entities`, enforcement or appeal tables |

---

## 2. Admin controls

### 2.1 What real platforms do (benchmarks)

| Platform                                   | What they measure / do                                                                                                                                                                                                                                                                                                                                       | Lesson for MechDost                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Amazon Seller Central** (Account Health) | Order Defect Rate target < 1%; above that "may result in a restriction of your selling privileges". Third-party guides cite late shipment < 4%, pre-fulfilment cancellation < 2.5%, valid tracking > 95%, and a 0–1000 Account Health Rating where 200+ is healthy. Appeals use a written "plan of action".                                                  | One health page per partner, a few metrics, each with a published target. The appeal asks for root cause and corrective steps.       |
| **Flipkart Seller Hub**                    | Its seller performance policy sets seller cancellations at 0.25% weekly. A breach means suspension of at least 3 days; repeated breaches mean account suspension. Seller tiers (reported, not official) move every 90 days.                                                                                                                                  | A **timed** suspension that lifts itself is a normal, proportionate tool. 0.25% is too strict for small Raipur shops at launch.      |
| **Uber** (driver deactivation policy)      | Quality issues (rating, cancellations, acceptance) bring alerts **before** any action. "Not accepting trip requests does not lead to permanent deactivation." Safety complaints can cause a temporary hold pending investigation. Fraud, safety and discrimination mean permanent removal. Quality deactivations can be reversed after proof of improvement. | Quality problems go through a ladder; integrity problems skip it. Low acceptance alone should de-prioritise routing, never offboard. |
| **Urban Company**                          | Reported thresholds: rating ≥ 4.7 (Luxe higher), response rate ≥ 80%, fewer than 4 cancellations a month. "ID blocks" with retraining. Partner protests followed in 2023–2024.                                                                                                                                                                               | Opaque, automatic blocks harm trust and supply. MechDost needs published rules, minimum samples, human review and a clear way back.  |
| **Zomato / Swiggy**                        | Mass delisting for missing FSSAI licences (regulator driven). Zomato's proposed "severe food quality" suspension lasted until remedial action was verified, and it was deferred after restaurant pushback over lack of consultation.                                                                                                                         | Compliance documents (GSTIN, shop licence) need expiry tracking and automatic restriction. Consult partners before new penalties.    |
| **Shopify admin**                          | Granular staff permissions; a store activity log (view only, latest 250 results, no export); a removed staff member's name stays in timelines.                                                                                                                                                                                                               | Copy the "history survives removal" rule. Do better on the log: search, filters, export.                                             |

### 2.2 Partner lifecycle (shops, workshops, mechanics later)

Use two fields, each driven by a state machine in `packages/shared/state`:

```
standing (staff only):
  applied → under_review → verified → active
  active ↔ warned            (warning on file; still routable)
  active/warned → restricted (routing de-priority or category hidden)
  active/warned/restricted → paused     (timed; ends_at required; auto-lifts by job)
  any → suspended            (indefinite; review_at required; appeal open)
  paused/suspended → active  (reinstated: by staff, or automatically when ends_at passes)
  suspended → offboarded     (terminal; listings removed; data kept per retention)

availability (partner, or staff on their behalf):
  open | busy (until time) | holiday (date range)
```

Rules:

- **The router uses both fields.** Only `active`, `warned` or `restricted` partners that are `open` are eligible. `restricted` applies a ranker penalty instead of exclusion. Spec 04 already excludes busy or holiday shops.
- **Orders already in progress when standing changes:** withdraw `offered` assignments (back to `needs_rerouting`, with an admin alert). For `confirmed` orders, default to "keep fulfilling unless the reason is fraud, safety or counterfeit". In those three cases, reroute and contact the customer. Record this as a decision.
- **Public copy never says "suspended".** The storefront shows "Temporarily unavailable" and hides listings. The partner portal shows the full notice.
- **Integrity (rule 3):** every transition is a conditional UPDATE with `version`, writes `partner_standing_events` (append-only) and `audit_log`, and sends notices through the outbox.

**Suggestions for the pause/suspend work now being built** (no duplication intended):

1. Store a `reason_code` enum as well as free text, because analytics and appeals need codes.
2. Make `ends_at` mandatory for a pause, and run a pg-boss job that lifts it with a CAS check.
3. Snapshot the metric value that triggered the action onto the event.
4. Separate partner-visible text from the internal note.
5. Require four-eyes for offboarding.
6. Put staff, shop and workshop history on one timeline.

### 2.3 Graduated enforcement ladder

| Level | Action                                                  | Trigger (examples)                                                                                   | Who                                    | Partner sees                                                        |
| ----- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| 0     | **Nudge**                                               | A metric trends toward its threshold (e.g. acceptance < 85%)                                         | System                                 | Tip on the portal home: "3 orders timed out this week"              |
| 1     | **Written warning**                                     | Below threshold over the window, with enough samples                                                 | System proposes, ops confirms          | Notice: metric, value, target, 14-day improvement window, help link |
| 2     | **Restriction** (routing de-priority / category hidden) | Still below at the end of the window                                                                 | Ops                                    | Notice + "what restores you"                                        |
| 3     | **Timed pause** (e.g. 3 days, as Flipkart)              | Repeat breach within 90 days; or document expired (lifts when renewed)                               | Ops (city manager in scope)            | Notice + end date + appeal                                          |
| 4     | **Suspension pending review**                           | Third breach, or **immediately** for fraud, fake/counterfeit parts, safety, invalid KYC, legal order | Ops manager; four-eyes for fraud cases | Notice + review date + appeal + how to fetch payouts owed           |
| 5     | **Offboarding**                                         | Appeal rejected or not filed by the review date; confirmed fraud                                     | Two staff (four-eyes)                  | Final notice; payout settlement; data retention statement           |

Warnings expire after 90 days without a repeat. That figure is a suggestion, and the admin edits it (rule 8).

### 2.4 Scorecards and thresholds (defaults per city in `settings`, admin-editable)

All rates use a rolling 30 days and need a **minimum sample** before any action (e.g. 20 offers or 10 orders). They exclude events the customer or MechDost caused (customer cancellations, admin reroutes, address not found).

| Metric (shops)               | Definition                                        | Suggested start                              | Action ladder                                      |
| ---------------------------- | ------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| Acceptance rate              | accepted ÷ offered                                | ≥ 80%                                        | L0 → L2 only (Uber: never offboard for this alone) |
| Timeout rate                 | expired ÷ offered                                 | ≤ 10%                                        | L0 → L2                                            |
| Median time to accept        | `responded_at − offered_at`, accepted only        | ≤ 5 min (timer 15)                           | Nudge + ranker signal                              |
| Cancel after accept          | shop-caused cancels ÷ confirmed                   | ≤ 2% (Flipkart 0.25% is too tight at launch) | L1 → L4                                            |
| Delivery-code override share | admin overrides ÷ delivered                       | ≤ 5%                                         | Investigate (possible fake deliveries)             |
| Wrong-code attempts / locks  | shipments locked after 5 tries ÷ out for delivery | ≤ 2%                                         | Investigate                                        |
| Upheld faulty-part claims    | upheld claims ÷ delivered                         | ≤ 1% (cf. Amazon ODR < 1%)                   | L1 → L4; counterfeit → L4 at once                  |
| Rating                       | mean of approved reviews, n ≥ 10                  | ≥ 4.0                                        | L1 → L3                                            |

| Metric (workshops)       | Definition                                 | Suggested start               |
| ------------------------ | ------------------------------------------ | ----------------------------- |
| Proposal response time   | offered → slot proposed                    | median ≤ 30 min               |
| Estimate variance        | final bill ÷ accepted expected cost        | ≤ 1.15× median                |
| Unapproved-line attempts | bill lines not approved per line           | 0 (integrity, L4 if repeated) |
| No-show / late slot      | customer reports + check-in after slot end | ≤ 5%                          |
| Rating, complaints       | as shops                                   | ≥ 4.0; ≤ 2% tickets           |

Every partner gets the **same scorecard** in their own portal. That is fair and costs nothing extra to build.

### 2.5 Customer controls (COD-heavy market)

COD has much higher return-to-origin (RTO) rates than prepaid. Razorpay cites COD RTO of 25–30% against 2–3% prepaid, and Shipway's FY25 data reports that 26% of COD orders were returned. In tier-3 cities, COD was still 52% of Diwali 2025 orders. MechDost therefore needs:

- **Block levels:** `cod_only` (must prepay), `orders` (cannot order; can browse and raise tickets), `full` (cannot sign in). Every block needs a reason code, an end date (optional), the staff member and a note. Use `customers:block`.
- **Automatic COD-off** after N refused deliveries (already decided). Show the rule and the count on the customer 360. Staff can lift it with a reason.
- **`blocked_entities`** (in spec 13, not yet in the schema): phone, device, IP /24, pincode, each with a reason and an expiry.
- **Customer 360:** orders, service requests, vehicles, tickets, coin ledger, consents, blocks, notes. Contacts stay masked unless the viewer holds `customers:read_pii`, and every unmask is audited.

### 2.6 Console-wide controls: catalogue with priorities

| Control                                   | What it is                                                                                                                                                                                                           | Priority | Why                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| Partner standing + availability           | §2.2 (pause/suspend in progress)                                                                                                                                                                                     | **P0**   | Routing depends on it from the first order                           |
| Enforcement ladder + notices              | §2.3, en/hi templates                                                                                                                                                                                                | **P0**   | Reasons and notice are needed from the first suspension (§4)         |
| Appeals                                   | Partner "Request review" with text + photos; staff decide with reason; SLA 7 days                                                                                                                                    | **P0**   | Fairness; partner agreement; Uber/Amazon norm                        |
| Scorecards                                | §2.4, admin and partner views                                                                                                                                                                                        | **P0**   | Evidence for every action                                            |
| Customer block (3 levels) + COD auto-off  | §2.5                                                                                                                                                                                                                 | **P0**   | COD fraud and RTO cost                                               |
| Audit log UX                              | Per-entity timeline (orders, partners, customers) + global search by actor/entity/action/date; before → after diff of field names; export as async job                                                               | **P0**   | Spec 13 requires immutable audit; useless if it cannot be read       |
| Four-eyes approvals inbox                 | One queue of `approval_requests`; the requester can never approve their own request (enforced in the API, not only the UI); blocked if no other approver exists                                                      | **P0**   | Refunds, coin grants, payouts, offboarding                           |
| Staff, roles, city scope                  | Invite, role, city, 2FA status, sessions, deactivate; city managers see only their cities                                                                                                                            | **P0**   | Multi-city by construction (rule 7)                                  |
| Kill switches (per city)                  | New orders, COD, service bookings, auto-route, OTP SMS sending, assistant, coins redemption. Default safe; change audited; fallback state tested                                                                     | **P0**   | An outage or abuse spike needs a 1-click stop                        |
| Maintenance mode                          | Storefront read-only banner + checkout closed; partner portal stays up; scheduled start/end                                                                                                                          | **P0**   | Migrations and incidents                                             |
| Notification templates                    | en/hi side by side, variables, DLT template id, preview, test send to own phone, version history                                                                                                                     | **P0**   | Rule 8; SMS DLT compliance                                           |
| Global search / command palette (Ctrl/⌘K) | Order code `MD-…`, `SR-…`, `REQ-…`, shop or workshop name, last 4 digits of phone (masked results)                                                                                                                   | **P0**   | Support speed; cheap to build                                        |
| Queue keyboard shortcuts                  | `j/k` move, `Enter` open, `r` route recommended, `x` reject, `?` help; never fire inside inputs                                                                                                                      | P1       | Throughput once volume exists                                        |
| Saved views                               | Named filter sets per staff member + shared team views ("Raipur: awaiting > 10 min")                                                                                                                                 | P1       | Spec 08 already lists it as P1                                       |
| Bulk actions                              | Select → preview ("12 shops will be messaged") → confirm → async job → per-item result. Allowed: message partners, tag, export, approve reviews. **Not allowed:** refunds, coin grants, suspensions                  | P1       | Saves clicks without bulk mistakes on money or standing              |
| Impersonation / view-as                   | Read-only "view as partner/customer", enforced on the server (writes rejected), persistent banner, 30-minute cap, PII masked, every session audited under the **staff** identity, permission `customers:impersonate` | P1       | Support debugging; Ory warns plain "log in as" erases the real actor |
| Partner announcements                     | Banner + notice to a city's or category's partners; read receipts                                                                                                                                                    | P1       | Policy changes need notice and consultation (Zomato lesson)          |
| Document expiry tracking                  | GSTIN, shop licence, bank verification dates → automatic L3 when expired, lifts on renewal                                                                                                                           | P1       | Regulator-driven delistings happen (FSSAI example)                   |
| Merge customers                           | Spec 08 P1                                                                                                                                                                                                           | P2       | Rare at launch                                                       |
| Rule builder for automatic enforcement    | Admin-edited conditions → proposals                                                                                                                                                                                  | P2       | Until volume exists, fixed thresholds in settings are enough         |
| Anomaly detection (baseline bands)        | §3.4                                                                                                                                                                                                                 | P2       | Static thresholds first                                              |

---

## 3. Visualisation and dashboards

### 3.1 Principles (dataviz skill + operational-dashboard practice)

- **Ops dashboards are scanned, not studied.** Lead with what needs action. Analysis (trends, cohorts) goes lower down or on its own page.
- **Every number either links to the queue behind it or is clearly informational.**
- **The form comes before colour.** A single value is a stat tile (value + change + sparkline), not a one-bar chart. A ratio against a limit is a meter. More than 7 classes is a table.
- **One axis per chart.** Two measures of different scale (orders and GMV) become two small charts, never a dual axis.
- **Colour by job:** sequential means one hue, light to dark (default). Emphasis means one hue plus grey for "this shop against the rest". Diverging means two hues plus a grey midpoint (issued against redeemed). **Status colours are reserved** and always come with an icon and a text label.
- **MechDost tokens:** the accent `#ea5728` sits close to typical "warning/serious" oranges. Use the accent only for the emphasis series and keep status steps separate. Run `scripts/validate_palette.js` from the dataviz skill on the chart palette in light **and** dark mode before shipping. Dark mode uses its own validated steps, not an automatic inversion. Any new chart colours need a decisions entry (rule 2).
- **Accessibility:** a legend for 2 or more series, direct labels when there are 4 or fewer, a "View as table" toggle on every chart, keyboard focus showing the same tooltip as hover, text in text tokens (never in series colour), and WCAG 2.2 AA in both themes.
- **Freshness on every tile** ("Updated 2 min ago" / "Yesterday, IST"), with an obvious state when a rollup is stale.

### 3.2 Page structure

| Page                | Content                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Overview (live)** | 1) Needs attention (alerts) · 2) KPI row · 3) Today's funnel · 4) 30-day trends (GMV, orders) · 5) leaderboards                    |
| **Fulfilment**      | Funnel by stage and city, time to accept, timeouts, cancel after accept, delivery code against overrides, orders by hour × weekday |
| **Partners**        | Scorecard table (sortable, filterable), partner detail with metric history and the enforcement timeline                            |
| **Customers & COD** | COD share, RTO rate, blocks issued, repeat rate cohort                                                                             |
| **Coins**           | Liability, issued against redeemed, expiries, manual grants                                                                        |
| **Services**        | Workshop booking funnel, response time, estimate variance                                                                          |
| **Demand map**      | Demand against supply by pincode (MapLibre)                                                                                        |

### 3.3 Metric → form

| Metric                                               | Form                                                                                                                                                 | Notes                                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GMV, orders, AOV (today / 7d / 30d)                  | **Stat tiles** (value, change against the same period before, sparkline)                                                                             | Paise to ₹ at render; IST day                                                                                                                               |
| GMV trend                                            | **Line**, 30 days; previous period as a grey line for context (emphasis)                                                                             | Separate chart from order count (no dual axis)                                                                                                              |
| Order funnel: placed → routed → accepted → delivered | **Horizontal ranked bars** in stage order, one hue, with step conversion % labelled                                                                  | Not a funnel-shaped graphic; an optional emphasis bar for the worst step                                                                                    |
| Time to accept                                       | **Stat tile** (median + p90) + **histogram** (1-minute bins) with a reference line at the timer                                                      | Trend as a line of the daily median                                                                                                                         |
| Acceptance rate per shop                             | **Table with inline thin bar** (n > 7 shops); for ≤ 7, ranked horizontal bars, below-threshold rows with a status icon + label                       | Show n (sample size) beside each rate                                                                                                                       |
| Delivery code confirmations against overrides        | **Stat tile** "override share 3.1%" + **meter** against the 5% limit; weekly line of override share                                                  | Click through to the override list with reasons                                                                                                             |
| Cancellation and fault-claim rates                   | **Line** per week with a dashed threshold reference; per-shop table below                                                                            | Status icon when above the threshold                                                                                                                        |
| Coins liability                                      | **Hero stat** "₹X outstanding" (balance × coin value) + **diverging bar** per week (issued above, redeemed + expired below a zero line)              | Finance view; ties to spec 20                                                                                                                               |
| Payment mix COD / prepaid                            | **Stacked bar** per week (2 parts)                                                                                                                   | Or a tall segmented bar for one period                                                                                                                      |
| Orders by hour × weekday                             | **Heatmap grid**, sequential single hue                                                                                                              | Staffing and shop opening hours                                                                                                                             |
| Category mix                                         | **Ranked horizontal bars**                                                                                                                           | Not a pie                                                                                                                                                   |
| Repeat rate                                          | **Cohort table** with sequential cell shading                                                                                                        | P1                                                                                                                                                          |
| Workshop booking funnel                              | Ranked bars: request → proposal → accepted → received → estimate approved → billed → paid → reviewed                                                 | Same component as the order funnel                                                                                                                          |
| Demand against supply by pincode                     | **MapLibre heatmap** of demand (orders + searches + rejected "no shop") with shop/workshop pins on top; **table of top unserved pincodes** beside it | India pincode boundary polygons are not reliably available free, so a heatmap of points or H3 hexagons beats a choropleth. The table is the accessible view |

### 3.4 Alerts and anomaly cues

Start with **static thresholds from settings**. Add baseline bands (same hour, previous 4 weeks, ± 2σ) in P2.

| Alert                      | Default rule                                  | Action button        |
| -------------------------- | --------------------------------------------- | -------------------- |
| Order waiting to be routed | any `placed` > 5 min                          | Route                |
| Shop timer at 50%          | per spec 04                                   | Call shop / reroute  |
| No acceptances in city     | 0 accepts in 30 min while ≥ 3 offers are open | Open fulfilment      |
| Override spike             | override share today > 2× 30-day average      | Review overrides     |
| COD refusals spike         | refused deliveries today > threshold          | Customers & COD      |
| OTP send spike (SMS cost)  | sends/hour > 3× normal                        | Kill switch: OTP SMS |
| Payment webhooks failing   | > 3 failures in 10 min                        | Payment log          |
| Partner document expiring  | 14 days before expiry                         | Partner              |
| Appeals near SLA           | appeal open > 5 days                          | Appeals              |

To avoid alert fatigue: one row per cause (deduplicated), snooze with a reason, an owner per alert, and automatic resolution when the condition clears. Notify in the console, by email and later by PWA push. Status colour always comes with an icon and words.

### 3.5 Real time against rollups

| Data                               | Freshness                                          | Source                                                                                                        |
| ---------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Queues, timers, alert list         | Live (Supabase Realtime; 15–30 s polling fallback) | Indexed live counts on `orders` / `order_assignments`                                                         |
| Today's KPI tiles                  | ≤ 1 min                                            | Live counts, cached 30 s with a tag                                                                           |
| Trends, scorecards, coins, cohorts | Hourly / nightly                                   | `metrics_hourly` (P1) and `metrics_daily` / `partner_metrics_daily` built by pg-boss jobs, IST day boundaries |
| Product funnels (web behaviour)    | PostHog                                            | Events (spec 12); money and ops truth always from first-party tables                                          |

A reconciliation test (spec 08 acceptance) checks that the rollups for a seeded day equal sums over `orders`/`payments`/`coin_ledger`.

### 3.6 Mobile admin

City managers will often be in the field on a phone.

- Below 1024 px: bottom tab bar (Attention · Queues · Search · Partners · More).
- KPI tiles 2-up; charts reduce to sparkline + number + "View table".
- Queue items as cards with one primary action and the countdown chip.
- Tap targets ≥ 24 px (already a test class).
- No hover-only information.
- PWA install and push for alerts once `serwist-pwa` lands.

### 3.7 Library approach and budgets

- **Recharts through the shadcn `chart` component** (already decided; the tooling audit rejected Tremor as stale). Chart cards are client islands loaded with `next/dynamic`, with a fixed-height skeleton so CLS stays 0. The page and its data are Server Components.
- **Sparklines without a library:** a tiny server-rendered `<svg><polyline>` component. KPI rows then ship zero chart JS.
- **Tables:** check the `@reui` and `@data-table-filters` registries before building (shadcn-component-discovery). TanStack Table only if a registry block needs it. Virtualise lists over 200 rows. Use cursor pagination from the API.
- **Maps:** MapLibre GL is already present (worker served from `/vendor`). Use the native `heatmap` layer; load the map only on the Demand map page.
- **Budgets:** admin routes are outside the product-page 180 KB gate. Set **admin initial JS ≤ 250 KB gz**, with chart and map chunks loaded after first paint, INP < 200 ms on queue actions, and Lighthouse ≥ 90 on Overview. Published Recharts sizes conflict (~45 KB gz in one source, ~150 KB minified in another), so measure with the bundle analyzer before setting the chunk budget.
- **Dependency policy:** check `research/security-vulnerabilities.md` before adding any library (rule 4).

---

## 4. Legal and compliance hooks (India)

Not legal advice. Have counsel review the partner agreement before launch, and queue this in `docs/questions-for-user.md`.

| Source                                                        | What it requires                                                                                                                                                                                                                                                                                                                                                                                             | MechDost hook                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Consumer Protection (E-Commerce) Rules, 2020**              | Marketplace: show seller name, address, customer-care number and rating; a grievance officer who acknowledges within 48 h and resolves within one month; disclose the main ranking parameters and any differentiated treatment; get an undertaking that seller information is true. Sellers: a **prior written contract** with the marketplace; their own grievance officer; provide legal name, GSTIN, PAN. | (a) The partner agreement lists suspension grounds, the ladder, notice and the appeal route. (b) The routing ranker's parameters are summarised in the terms (rule on ranking disclosure). (c) Restricted or paused shops stay disclosed to customers who already have their orders. (d) Grievance SLA alerts (§3.4). |
| **Natural-justice practice; state gig-worker laws**           | Karnataka's Platform-Based Gig Workers Act 2025 requires 14 days' notice with written reasons before termination, except bodily-harm cases, and an internal dispute route. Bihar's 2025 Act uses 7 days. These do not apply in Chhattisgarh today.                                                                                                                                                           | Make `notice_days` a **per-state setting** now. When mechanics (gig workers) launch or MechDost enters such states, the ladder already gives notice + written reasons + appeal. Immediate suspension only for safety/fraud categories.                                                                                |
| **DPDP Act 2023 + DPDP Rules 2025** (notified 13–14 Nov 2025) | Purpose limitation, security safeguards, erasure when the purpose ends. Logs: minimum one-year retention of personal data, traffic data and processing logs for listed purposes (Rule 8(3)), then erasure unless another law requires more. Commentary says retention and erasure provisions start about 18 months after notification (≈ May 2027); verify.                                                  | Audit and enforcement rows store user **ids**, reason codes and **field names**, never phone or address values (already the encryption ruling). Access to the audit log is itself audited. Impersonation masks PII. A retention job erases personal data that has expired but keeps pseudonymous audit rows.          |
| **CGST Act s.36**                                             | Keep accounts and records for 72 months from the annual-return due date (longer during disputes).                                                                                                                                                                                                                                                                                                            | Keep enforcement records, payouts and orders ≥ 72 months; erase personal data separately from financial records.                                                                                                                                                                                                      |

---

## 5. Prioritised build plan (next 8 admin features)

Each feature follows the hard rules: Zod DTOs in `packages/shared`, state machines in `packages/shared/state`, CAS + `version`, append-only `*_events`, `audit_log`, outbox notices, city scope, en/hi strings in the locale files, and analytics events in the same change. Events use the existing `admin_*` / `partner_*` naming. Every staff mutation also emits the server `admin_action {actor, entity, action, duration_ms}` (spec 08).

### 1. Metrics rollups (foundation)

- **Data:**
  - `metrics_daily (city_id, day_ist date, metric text, dims jsonb, value bigint, computed_at)` with a unique key on (city_id, day_ist, metric, dims).
  - `partner_metrics_daily (partner_kind, partner_id, city_id, day_ist, offers, accepted, expired, declined, cancels_after_accept, delivered, overrides, code_locks, upheld_claims, ttaccept_p50_s, ttaccept_p90_s, rating_sum, rating_n)`.
  - pg-boss nightly job plus a re-run for yesterday; indexes on (partner_id, day_ist).
- **UI:** none, except freshness stamps.
- **Tests:** reconciliation on a seeded day; IST boundary at 23:59/00:00; idempotent re-run.
- **Events:** server only, `metrics_rollup_completed {day, rows, ms}`.

### 2. Overview v2: Needs attention + KPI row + funnel

- **Data:** `ops_alerts (id, city_id, kind, entity, entity_id, opened_at, resolved_at, snoozed_until, snooze_reason, owner_id, version)` with a partial unique index on (kind, entity_id) where unresolved. Rules come from `settings`.
- **UI:** alert list (icon + label + age + one action), KPI tiles with server SVG sparklines, funnel bars, GMV and orders lines (dynamic Recharts), table toggles.
- **Events:** `admin_dashboard_viewed {page, range, city}`, `admin_alert_opened {kind}`, `admin_alert_snoozed {kind}`, `admin_kpi_clicked {kpi}`.

### 3. Partner scorecards + enforcement ladder (extends the pause/suspend work)

- **Data:**
  - `enforcement_actions (id, partner_kind, partner_id, city_id, level 0–5, reason_code, metric_key, metric_value, threshold, sample_n, partner_message_en, partner_message_hi, internal_note, starts_at, ends_at, review_at, status proposed|active|lifted|expired|overturned, proposed_by, decided_by, version)`.
  - `partner_standing_events` (append-only).
  - Thresholds in `settings` per city.
- **UI:** scorecard table with inline bars and status icons; partner detail with metric history and enforcement timeline; "Propose warning" from a breached metric; ops confirm/decline; the same scorecard in the partner portal.
- **Events:** `admin_partner_action_proposed {level, reason_code}`, `admin_partner_warned`, `admin_partner_restricted`, `admin_partner_paused`, `admin_partner_suspended`, `admin_partner_reinstated`, `partner_scorecard_viewed`.

### 4. Partner notices + appeals

- **Data:**
  - `partner_notices (id, partner_id, enforcement_action_id, template_key, rendered_en, rendered_hi, sent_at, read_at)` through the outbox.
  - `appeals (id, enforcement_action_id, partner_id, statement, attachments[], submitted_at, sla_due_at, decision upheld|overturned|modified, decided_by, decision_reason, version)`. One open appeal per action (partial unique index).
- **UI:** partner portal notice card with "Request review" (text + up to 5 photos, upload limits from spec 13); admin appeals queue with SLA chips; a decision with reason is sent back as a notice.
- **Events:** `partner_notice_viewed`, `partner_appeal_submitted`, `admin_appeal_decided {decision}`.

### 5. Customer 360 + blocking

- **Data:**
  - `customer_blocks (id, user_id, level cod_only|orders|full, reason_code, note, ends_at, created_by, lifted_by, lifted_reason, version)` with one active block per user and level.
  - `blocked_entities (kind phone_index|device|ip_prefix|pincode, value, reason_code, ends_at, created_by)`.
  - COD auto-off counter view.
- **UI:** customer page (orders, SRs, vehicles, tickets, coins, consents, blocks, notes), masked contacts with an audited "Reveal" button (`customers:read_pii`), block dialog with level, reason and end date. Checkout enforcement happens in the API.
- **Events:** `admin_customer_viewed`, `admin_customer_pii_revealed`, `admin_customer_blocked {level, reason_code}`, `admin_customer_unblocked`.

### 6. Approvals inbox (four-eyes)

- **Data:** `approval_requests (id, kind refund|coin_grant|payout|offboard|commission, entity_id, amount_paise, payload jsonb, requested_by, requested_at, decided_by, decision, decision_reason, expires_at, version)` with a CHECK that `decided_by <> requested_by`. The action runs only from the approved state, in the same transaction.
- **UI:** one queue; the request shows the diff and context; approve/decline with a reason; the requester sees the status.
- **Events:** `admin_approval_requested {kind}`, `admin_approval_decided {kind, decision}`.

### 7. Kill switches, maintenance mode, notification templates

- **Data:**
  - Extend `feature_flags` with `city_id`, `kind release|ops|permission`, `owner`, `version`, `updated_by`, and audit every change.
  - `maintenance_windows (id, scope, starts_at, ends_at, message_en, message_hi, created_by)`.
  - `notification_templates`: add `version`, `dlt_template_id`, `locale`, `variables[]`, `published_at`.
- **UI:**
  - Switches page grouped by city, with a confirm dialog that names the effect.
  - Maintenance scheduler with a preview banner.
  - Template editor (en/hi side by side, variable chips, preview, test send to own phone).
  - Each switch's off state is tested in e2e.
- **Events:** `admin_flag_changed {key, city, enabled}`, `admin_maintenance_scheduled`, `admin_template_published {key}`, `admin_template_test_sent`.

### 8. Global search, saved views, queue shortcuts

- **Data:** `saved_views (id, owner_id, shared bool, page, name, filters jsonb, version)`. Search uses existing indexes (code unique, trigram on names, `phone_index` blind index for exact phone match).
- **UI:**
  - Ctrl/⌘K palette with results grouped by type and masked contacts.
  - "Save view" on lists.
  - Shortcut help on `?`.
  - Shortcuts are disabled while typing in an input.
- **Events:** `admin_search {result_kind, results_n}` (never the query text if it could be a phone), `admin_view_saved`, `admin_view_opened`, `admin_shortcut_used {key}`.

**Next after these (P1):**

- Demand map: MapLibre heatmap and an unserved-pincodes table built from `metrics_daily` dims.
- Read-only impersonation.
- Bulk actions.
- Partner announcements.
- Document expiry tracking.

**Decisions to record when this is adopted:**

- availability vs standing split
- the ladder and its default thresholds
- in-flight order handling on suspension
- per-state `notice_days`
- an admin JS budget of 250 KB gz
- the chart palette (after the validator run)

---

## Sources

- Amazon Seller Central — Order defect rate help page: https://sellercentral.amazon.com/gp/help/external/G200285170
- SellerSprite — Amazon Account Health Rating guide 2026: https://www.sellersprite.com/en/blog/amazon-account-health-rating-2026
- Feedvisor — Amazon seller performance measurement: https://feedvisor.com/university//Seller_Performance_Measurement
- My Amazon Guy — submitting an appeal / plan of action: https://myamazonguy.com/suspensions/submit-an-appeal-to-amazon/
- Flipkart Seller Performance Policy (PDF): https://cdn.pixelbin.io/v2/noisy-leaf-04a452/original/Marketplace-Content-University/MCU-Images/operations/SLA/Flipkart-Seller-Performance-Policy-updated.pdf
- Fynd docs — Flipkart SLA metrics: https://documentation.fynd.com/commerce/docs/openapi/operations-management/flipkart-sla.md
- Uber — Driver deactivation policy: https://www.uber.com/pr/en/legal/deactivation-policy/
- Uber — Fairness in the driver seat: https://www.uber.com/us/en/blog/fairness-in-the-driver-seat/
- Minnesota DLI — Uber driver access to platform: https://dli.mn.gov/sites/default/files/pdf/tnc_uber_driver_access_to_platform_092623.pdf
- Business Today — Urban Company ID blocks over ratings: https://businesstoday.in/technology/story/urban-company-punishes-workers-when-users-cancel-services-blocks-ids-for-getting-ratings-below-48-out-of-5-385722-2023-06-15
- Inc42 — Urban Company partner protests: https://inc42.com/buzz/urban-company-rocked-by-another-protest-by-gig-workers-for-blocking-their-ids
- Wired (mirror) — Urban Company retraining and blocks: https://wirednews.pages.dev/story/urban-company-women-gig-economy-pushed-them-out
- Deccan Herald — Zomato defers food-quality ban: https://www.deccanherald.com/business/zomato-defers-plan-to-ban-eateries-over-poor-food-quality-after-restaurants-fume-report-1101532.html
- Inc42 — Zomato delists FSSAI non-compliant restaurants: https://inc42.com/buzz/zomato-delists-5k-fssai-non-complaint-restaurants
- Shopify Help — Activity logs: https://help.shopify.com/en/manual/shopify-admin/activity-logs
- Shopify Help — Staff permissions: https://help.shopify.com/manual/your-account/staff-accounts/staff-permissions/staff-permissions-description
- Pigment Engineering — Safe user impersonation: https://engineering.pigment.com/2026/04/08/safe-user-impersonation/
- Lattice — Impersonation: https://help.lattice.com/hc/en-us/articles/360060517914
- Files.com — Impersonate user: https://www.files.com/docs/users-and-groups/users/impersonate-user
- Ory — Identity-level impersonation: https://www.ory.com/blog/identity-level-impersonation
- Opcito — Maker-checker implementation guide: https://www.opcito.com/blogs/maker-checker-implementation-guide-for-secure-fintech-systems
- OneSpan — Maker-checker authorization: https://docs.onespan.com/docs/fr/maker-checker-authorization-1
- Wikipedia — Feature toggle (ops toggles, Fowler): https://en.wikipedia.org/wiki/Feature_toggle
- Open edX OEP-17 — Feature toggles: https://open-edx-proposals.readthedocs.io/en/latest/oep-0017-bp-feature-toggles.html
- Basedash — Operational vs analytical dashboards: https://www.basedash.com/blog/operational-dashboards-vs-analytical-dashboards-how-to-design-each
- Dashboard Design Patterns (arXiv): https://arxiv.org/pdf/2205.00757
- MapLibre GL JS — Create a heatmap layer: https://maplibre.org/maplibre-gl-js/docs/examples/create-a-heatmap-layer/
- LogRocket — React chart libraries: https://blog.logrocket.com/top-5-react-chart-libraries/
- PkgPulse — Recharts v3 vs Tremor vs Nivo 2026: https://www.pkgpulse.com/guides/recharts-v3-vs-tremor-vs-nivo-react-charting-2026
- Razorpay — Cash on delivery challenges: https://razorpay.com/blog/cash-on-delivery-and-the-challenges/
- ClickPost — Diwali Report 2025: https://www.clickpost.ai/hubfs/ClickPost%20Diwali%20Report%202025.pdf
- Social Samosa — Prepaid orders rise to 41%: https://www.socialsamosa.com/report/prepaid-e-commerce-orders-rise-10958917
- IndiaLaw — Consumer Protection (E-Commerce) Rules 2020 summary: https://www.indialaw.in/guides/civil/consumer-protection-e-commerce-rules/
- Khaitan & Co — E-Commerce Rules 2020: https://khaitanco.com/sites/default/files/2020-08/Stricter%20Regulations%20on%20E-Commerce%20%E2%80%93%20The%20Consumer%20Protection%20(E-Commerce)%20Rules,%202020.pdf
- Mondaq — E-Commerce Rules 2020: https://www.mondaq.com/india/dodd-frank-consumer-protection-act/995148/the-consumer-protection-e-commerce-rules-2020
- Mondaq — Karnataka Platform-Based Gig Workers Act 2025: https://www.mondaq.com/india/employee-rights-labour-relations/1713454/karnataka-platform-based-gig-workers-social-security-and-welfare-act-2025
- Khaitan & Co — Karnataka gig workers (Nov 2025): https://www.khaitanco.com/sites/default/files/2025-11/ERGO%20-%20Karnataka%20Gig%20workers%20-%2027%20Nov%202025.pdf
- Saraf & Partners — States regulate gig economy: https://sarafpartners.com/?p=37878
- Mondaq — DPDP Rules 2025 notified: https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified
- Bar & Bench — MeitY notifies DPDP Rules 2025: https://www.barandbench.com/view-point/meity-notifies-final-digital-personal-data-protection-rules-2025
- SCC Online — DPDP Rules 2025 highlights: https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/
- KnowYourGST — CGST Act s.36 retention: https://www.knowyourgst.com/gstlaw/cgst-act/36-period-of-retention-of-accounts-36/
- Teachoo — CGST s.36: https://www.teachoo.com/5846/1919/Section-36-CGST---Period-of-retention-of-accounts/category/Chapter-VIII-CGST-Accounts-And-Records-(Section-35-to-36)/
- dataviz skill (installed, bundled): `references/choosing-a-form.md`, `anti-patterns.md`, `scripts/validate_palette.js`
