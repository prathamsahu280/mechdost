# Promotions, ads and referrals — research and recommendation

Status: research, 2026-11-01 · Not a decision yet; owner questions at the end (for `docs/questions-for-user.md`) · Related: spec 03 (checkout, coupons), spec 08 (admin "Promotions"), spec 11 (bundles), spec 12 (events), spec 13 (abuse), spec 14 (integrity), spec 15 (multi-city), spec 20 (MechDost Coins), `docs/research/admin-console.md` (approvals inbox; not repeated here).

Owner's ask (2026-11-01): "we will be running ads, discounts, promos etc which would clearly be visible on the home page, like a specific company giving discounts on oils … and we will be going ahead with referral codes too … with rewards and referral milestones, but we need to make sure these can't be completely abused."

---

## 0. The short version

1. **One engine for all offers.** A `campaign` is the parent of every promotion: a brand-funded discount ("Castrol 15% off engine oil"), a category sale, a coupon code, free delivery, a bundle, a flash deal or a paid banner. Coupons become a campaign with a code. Every campaign has a **funder** (MechDost, brand, shop or bank), a **city**, a **schedule**, a **budget that stops it automatically**, and an **approval**.
2. **One fixed order of discounts:** price → automatic offer (best one per line) → one coupon → MechDost Coins (on what is left, max 10%) → bank/UPI offer at payment. The same pure function in `packages/shared` does the maths for web, API and app.
3. **The law changes on 1 Jan 2027 (two months from now).** The E-Commerce Amendment Rules 2026 require (a) the "prior price" next to any reduced price, meaning **the lowest price in the 30 days before the reduction**, (b) **"Sponsored" labels** on paid listings, (c) a yearly dark-pattern self-audit with a certificate on the site. We must **start recording daily prices now** so 30 days of history exist by January.
4. **Referrals pay in MechDost Coins only, and only after the friend's first order is delivered** (delivery code checked) **and the faulty-part claim window has passed** (default 7 + 1 days). The friend gets an instant first-order discount. Milestones at 3, 5 and 10 successful referrals. Monthly and yearly caps.
5. **The coin rules already blunt abuse.** Coins have no cash value and pay at most 10% of a later order, so 100 farmed coins are only worth something if the fraudster spends ₹1,000+ on real parts. That makes farming unprofitable at our reward sizes.
6. **Abuse controls in layers:** phone OTP (exists) + Turnstile (exists) → links between referrer and friend (same device, address, UPI/card, IP) → velocity caps → hold period → risk score with a review queue → clawback → kill switches. Default thresholds are in §4 and are all admin settings.
7. **Integrity:** one referrer per friend for life (unique), one reward per (referral, role) (unique), one qualifying order per referral (unique), coin credits keyed by idempotency key, budgets and per-user limits by conditional UPDATE. Double rewards become impossible at the database level, not just in code.
8. **Tax needs a CA.** Who funds a discount changes its GST treatment. A discount shown on the invoice lowers the taxable value; money a third party (brand or MechDost) pays the shop to cover a discount may be added back as part of the value. This also affects **MechDost Coins today** (MechDost funds that discount, the shop is the seller). Listed as an owner question.

---

## 1. Promotions and ads on the home page

### 1.1 Promotion types

| Type                                  | Example                                                     | How the customer gets it                               | Typical funder            | Phase                                      |
| ------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ | ------------------------- | ------------------------------------------ |
| **Brand-funded product offer**        | "Castrol 15% off engine oil, Raipur, till 30 Nov"           | Automatic: price on card/PDP already shows the offer   | Brand (prepaid budget)    | P0                                         |
| **Category or brand sale**            | "Up to 20% off brake pads"                                  | Automatic                                              | MechDost or shop          | P0                                         |
| **Coupon code**                       | `FIRST100` ₹100 off first order over ₹499                   | Code at checkout                                       | MechDost                  | P0 (exists in schema)                      |
| **Free delivery**                     | Free delivery over ₹999 or for a weekend                    | Automatic in cart                                      | MechDost                  | P0 (threshold setting exists)              |
| **Bundle**                            | Engine oil + oil filter for ₹X (spec 11 "Admin bundles")    | Add bundle to cart                                     | Brand, shop or MechDost   | P1                                         |
| **Flash deal**                        | 50 units of a battery at ₹Y, 6 pm–9 pm                      | Automatic, real stock cap and real end time            | Brand or MechDost         | P1                                         |
| **Bank / UPI offer**                  | "10% off up to ₹150 with X Bank cards"                      | Applied by the payment gateway at payment              | Bank (not MechDost money) | P1, needs Razorpay Offers setup            |
| **Paid banner / sponsored placement** | Castrol pays for the home hero slot for a week              | Nothing to claim; it is an ad and must say "Sponsored" | Brand pays MechDost       | P0 (banner), P2 (sponsored search results) |
| **Workshop service offer**            | "Free 20-point check with any service at partner workshops" | Shown on workshop finder; workshop honours it          | Workshop or MechDost      | P1                                         |
| **Referral benefit**                  | Friend's first-order discount; referrer's coins             | §3                                                     | MechDost                  | P0                                         |

A banner and a discount are **two different things**: a brand can pay for a banner with no discount, or fund a discount with no banner, or both. Model them separately (placement vs rule) under one campaign.

### 1.2 Who funds the discount and how money settles

The shop is the **seller of record** (it issues the GST invoice to the customer). MechDost is the marketplace. So any discount not funded by the shop must be paid back to the shop.

| Funder       | Customer pays                      | Shop receives (payout)                       | Who pays the shop the gap                                        | Settlement record                                          |
| ------------ | ---------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| **Shop**     | Price − discount                   | Price − discount − commission                | Nobody (shop's own margin)                                       | Discount on the shop's invoice                             |
| **MechDost** | Price − discount                   | Price − commission (gap added in the payout) | MechDost, in the normal payout cycle                             | `promotion_funding` line per order item, funder = mechdost |
| **Brand**    | Price − discount                   | Price − commission (gap added in the payout) | MechDost fronts it, recovers from the brand's **prepaid budget** | Same line, funder = brand; monthly statement to the brand  |
| **Bank**     | Price − bank discount (at payment) | Full price − commission                      | The bank, via the payment gateway's offer settlement             | Payment record shows the offer; no MechDost money          |

Recommendations:

- **Brands prepay** a campaign budget (deposit) before go-live. The campaign stops itself when the budget is used. No "we'll invoice you later" for new brands; that is how marketplaces end up chasing receivables.
- **Settle on delivered orders only.** A funded discount is "committed" when the order is placed and "spent" when the order is delivered (delivery code). Cancelled, rejected or RTO orders release the commitment. The brand is never billed for an undelivered order.
- **Snapshot the split on the order item** (`line_discount_paise` already exists): store, per line, how much each funder paid. Refunds and credit notes reuse it, never recomputed (same rule as `data-integrity.md` §6 allocation).
- **Monthly brand statement**: orders, units, discount funded, budget left; finance approves (four-eyes) before any refund of unused deposit.
- **MechDost Coins are a MechDost-funded discount** too. The same payout and GST question applies to `coin_discount_paise` already in production code (see 1.6).

### 1.3 Targeting and scheduling

| Dimension               | Values                                                                | Notes                                                                          |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| City (required)         | one or more cities                                                    | Hard rule 7: no campaign without a city; national = all live cities explicitly |
| Zone / pincode          | include or exclude lists                                              | e.g. launch offer only in new pincodes                                         |
| Vehicle type            | 2W / 4W / commercial                                                  | Raipur is 2W-heavy: most budget should target 2W                               |
| Vehicle model / fitment | make, model, year range                                               | Only show "Castrol for your Activa 6G" if the product fits (spec 02 fitment)   |
| Catalogue               | category, brand, product, variant                                     | Brand-funded offers can only target that brand's products (CHECK in code)      |
| Customer segment        | new (no delivered order), returning, lapsed 90 days, business (GSTIN) | Computed server-side; never trust a client flag                                |
| Payment method          | any, prepaid only                                                     | Big discounts prepaid-only cut COD fake orders                                 |
| Time                    | start, end (IST, `timestamptz`), optional daily window (e.g. 6–9 pm)  | Business-day boundaries in IST (CLAUDE.md)                                     |
| Channel / slot          | home hero, offer strip, category top, product badge, cart nudge       | §2.2 `campaign_placements`                                                     |
| Frequency               | banner at most N views per user per day                               | Calm UI; avoids "nagging" dark pattern                                         |

### 1.4 Stacking and precedence (one rule, everywhere)

Apply in this fixed order. Each step works on what the previous step left.

| Step | What                           | Rule                                                                                                                                                                                           |
| ---- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Selling price**              | From `shop_inventory`, always ≤ MRP (Legal Metrology; CHECK already in spec 02)                                                                                                                |
| 2    | **Automatic offer** (per line) | At most **one** automatic offer per line; if several match, the one that saves the customer the most wins (tie → higher priority, then earlier start). Two only if both are marked `stackable` |
| 3    | **Coupon** (per checkout)      | At most **one** coupon. Applies on top of step 2 only if the coupon allows `stacks_with_offers` (default **off**, as spec 03 already says). Allocated across lines (Fowler allocate)           |
| 4    | **MechDost Coins**             | On the **product subtotal after steps 2–3**, max `maxRedeemBp` (10%), never delivery or COD fee (existing `coinRedemption`; pass the post-discount subtotal)                                   |
| 5    | **Free delivery**              | Separate; based on the product subtotal after steps 2–4 crossing the threshold (decide: before or after coins — recommend **before coins**, so coins never cost the customer free delivery)    |
| 6    | **Bank / UPI offer**           | Applied by the gateway at payment on the amount due; shown as a line on the order and invoice note                                                                                             |

Safety floors (admin settings with defaults):

- Total discount from steps 2–4 never more than **60%** of the product subtotal unless the campaign is approved as a clearance (four-eyes).
- A line's net price is never below ₹0; GST computed on the net taxable value per line.
- Referral first-order discount counts as a coupon (step 3), so it never stacks with another coupon.
- The cart shows each step as its own line: "Castrol offer −₹90", "Coupon FIRST100 −₹100", "MechDost Coins −₹40", "You save ₹230". No hidden maths.

### 1.5 Price display rules

| Rule                                                                                                                                                   | Source                                                                             | What we build                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| MRP shown, inclusive of all taxes; never sell above MRP; e-commerce sites must show the package declarations (Rule 6 incl. 6(10)); one MRP per product | Legal Metrology (Packaged Commodities) Rules 2011, e-commerce provisions from 2018 | `MRP ₹X (incl. of all taxes)` on card and PDP; CHECK selling ≤ MRP; declarations block on PDP (exists in spec 02)                      |
| **From 1 Jan 2027:** any announced price reduction shows the **prior price** = the **lowest price in the 30 days before** the reduction was announced  | E-Commerce Amendment Rules 2026, Rule 4(13)                                        | `price_history_daily` per variant × city from **now**; "Was ₹Y" and "% off" computed from that 30-day low, not from MRP                |
| **From 1 Jan 2027:** sponsored listings distinctly identified with clear, prominent disclosure                                                         | Rule 4(12)                                                                         | "Sponsored" / "प्रायोजित" tag on every paid banner, badge and listing; never inside a "Top rated" or "Recommended" row without the tag |
| **From 1 Jan 2027:** no manipulation of search results that misleads users; explain the main ranking parameters                                        | Rules 4(11)(c), 5(3)(f)                                                            | A "How we rank products" page (CMS); sponsored slots shown separately from organic results                                             |
| **From 1 Jan 2027:** yearly dark-pattern self-audit, certificate displayed prominently                                                                 | Rule 4(15)                                                                         | Checklist in §1.6 run before each December; certificate page in CMS                                                                    |
| All charges (delivery, COD fee) visible before checkout; no extra items added to the cart; no fake timers or stock counts; no shaming copy             | CCPA Dark Patterns Guidelines 2023                                                 | §1.6                                                                                                                                   |
| "Free" only if the customer pays nothing beyond unavoidable delivery; bait offers need enough stock and clear limits                                   | CCPA Misleading Ads Guidelines 2022                                                | Flash deals show the real unit cap ("50 units at this price"); "free gift" only when truly free                                        |

**Badge wording** (copy into locale files, en + hi, admin-editable): "15% off · Castrol offer", "Extra ₹100 off with FIRST100", "Sponsored". Percent badges from 1 Jan 2027 use the 30-day low; until then, compute from MRP but already store the history.

### 1.6 Indian legal checklist (brief, sourced)

**Consumer Protection (E-Commerce) Amendment Rules 2026** — notified September 2026 (sources differ: 9 or 10 Sept), **in force 1 January 2027** (Rule 1(2)). Verified from the gazette reproduction and LiveLaw:

- Rule 4(13): show prior price with reduced price; prior price = lowest price of the good or service in the 30 days before the announcement.
- Rule 4(12): sponsored listings distinctly identified.
- Rule 4(15): yearly self-audit for dark patterns; certificate displayed prominently.
- Rule 4(11)(c): no misleading manipulation of search results.
- Rule 5(7): no bundled fees for unrelated services; **loyalty or membership programmes are exempt**, which supports MechDost Coins.
- The amendment does **not** mention coupons, cashback or referral programmes. Those fall under the general rules below.

**CCPA Guidelines for Prevention and Regulation of Dark Patterns, 2023** (notified and in force 30 Nov 2023; apply to platforms, advertisers and sellers). Patterns that matter for promotions and referrals:

| Pattern                 | What it means for us                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| False urgency           | Countdown = the campaign's real `ends_at`; "only N left" = real stock or the real deal cap; never invented demand ("20 people viewing") |
| Basket sneaking         | Never auto-add a bundle item, warranty or donation; recommendations are opt-in buttons                                                  |
| Drip pricing            | Delivery fee and COD fee shown on PDP/cart, not first at the last step; coupon conditions shown before applying                         |
| Disguised advertisement | Paid banners and placements labelled "Sponsored"; referral share text says the sender gets coins                                        |
| Bait and switch         | The offer advertised is the offer applied; if a campaign ends while in cart, show "offer ended" clearly, never silently swap            |
| Confirm shaming         | No "No thanks, I like paying more" on dismiss buttons                                                                                   |
| Nagging                 | Banner frequency cap; referral prompts at most once per session and never blocking checkout                                             |
| Interface interference  | Primary button = the customer's choice, not "Apply offer and pay later"                                                                 |

**CCPA Guidelines for Prevention of Misleading Advertisements and Endorsements, 2022** (in force June 2022): bait ads allowed only with adequate supply and clear disclosure; "free" only if nothing beyond unavoidable delivery cost; penalties up to ₹10 lakh (₹50 lakh repeat) for manufacturers, advertisers, endorsers. Brand banners we publish are advertisements: get written substantiation from the brand for claims like "best engine oil".

**ASCI** (self-regulatory): influencer content with a "material connection" must carry an upfront label from ASCI's list (Advertisement, Ad, Sponsored, Collaboration, Partnership, Employee, Free gift), visible without "see more", superimposed on image/video posts. If MechDost pays creators or mechanics to post, this applies; contract them to it. The advertiser is responsible for compliance. Our referral share text should be honest ("I get MechDost Coins if you order") rather than pretending to be an unpaid tip.

**GST on discounts** (brief; **CA must confirm the structure** before brand-funded money flows):

- A discount given before or at supply and **shown on the invoice** is excluded from the taxable value (CGST Act s.15(3)(a)). Our automatic offers, coupons and coins are all of this kind.
- Post-supply discounts: CBIC Circular 251/08/2025 (12 Sept 2025) and the Finance Act 2026 amendment to s.15(3)(b) / s.34 simplified credit notes (secondary sources; verify the enacted text). We have few post-supply discounts (no returns policy), so this matters mainly for brand rebates to shops.
- **Third-party funding:** s.15(2)(e) adds "subsidies directly linked to the price" (other than government subsidies) to the value of the supplier who receives them. If MechDost or a brand pays the shop to cover a customer discount, that payment **may be part of the shop's taxable value**, so the shop could owe GST on the full pre-discount price. Practice differs and the search found no authoritative ruling for marketplaces. Two structures to put to the CA:
  - (A) Invoice shows the full price; the funded part is shown as "Paid by MechDost / Castrol on your behalf"; GST on the full value. Conservative: never under-pays.
  - (B) Invoice shows the net price; the brand gives the shop a separate commercial credit (no GST effect, per Circular 251 treatment of financial credit notes) or a proper s.34 credit note.
- Circular 92/11/2019: buy-one-get-one is two supplies (no ITC reversal); free samples/gifts follow Schedule I. Relevant for bundles and "free gift" offers.
- **Income-tax s.194R:** TDS on business benefits over ₹20,000 a year; CBDT Circular 12/2022 excludes sales discounts and rebates to customers. Only relevant if we later give shops or workshops non-discount rewards (partner referrals, contests).

**FDI note:** Press Note 2 (2018) bars a **foreign-invested** marketplace from directly or indirectly influencing sale prices, including through cashback and business arrangements. If MechDost ever takes foreign investment, MechDost-funded discounts and coins would need restructuring. Owner question.

**DPDP (data protection):** DPDP Rules 2025 notified 14 Nov 2025 (PIB), phased in. Device signals and payment fingerprints we use for fraud checks are personal data. We could not confirm that fraud prevention is a consent-free "legitimate use" under s.7, so: state **"fraud and abuse prevention"** as a purpose in the sign-up privacy notice, keep only hashed identifiers, keep them 12 months after last activity, and limit access to the risk role. Legal review before launch.

---

## 2. Admin control and data model

### 2.1 What admins can do (hard rule 8)

| Area               | Admin controls                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Campaigns          | Create, edit, schedule, pause, resume, end, duplicate; target (§1.3); funder; budget; per-user limits; stacking flags; T&Cs (en + hi)      |
| Placements         | Which slot, creative (image, alt text en/hi, headline, link), weight, frequency cap, "Sponsored" flag (forced on when a brand pays)        |
| Coupons            | Single public code or batch of unique single-use codes (for brand partners); attach to a campaign                                          |
| Referral programme | On/off, rewards, milestones, caps, hold period, risk thresholds, review queue, per-user block, per-code disable                            |
| Kill switches      | Per campaign "Stop now"; global "Pause all promotions"; global "Pause referral rewards" (keeps tracking, stops unlocking)                  |
| Reports            | Per campaign and per funder: impressions, clicks, redemptions, discount cost, GMV, incremental orders, budget burn; brand statement export |

Permissions (existing `packages/shared/src/rbac.ts`): `coupons:write` (marketing) covers campaigns today. Recommend adding `campaigns:approve` (ops manager, super admin), `referrals:review` (support/ops), `referrals:rules` (marketing; mirrors `coins:rules`), `promotions:finance` (finance: settlements, deposit refunds).

### 2.2 Tables (proposal; Drizzle, all mutable rows with `version`, `created_at`, `updated_at`, `created_by`)

| Table                        | Key columns                                                                                                                                                                                                                                                                                       | Constraints / indexes                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sponsors`                   | id, kind (`brand`\|`shop`\|`bank`), brand_id, legal_name, gstin, contact, contract_ref, status                                                                                                                                                                                                    | P1; unique gstin                                                                                                                                             |
| `campaigns`                  | id, code (`CMP-RPR-2026-XXXXXX`), name, kind (`offer`\|`coupon`\|`free_delivery`\|`bundle`\|`flash_deal`\|`banner_only`\|`bank_offer`\|`referral`), status, funder (`mechdost`\|`brand`\|`shop`\|`bank`), sponsor_id, starts_at, ends_at, priority, terms_key (CMS), approved_by, approved_at     | status via state machine; CHECK `ends_at > starts_at`; CHECK funder = brand ⇒ sponsor_id not null; CHECK approved_by ≠ created_by; index (status, starts_at) |
| `campaign_cities`            | campaign_id, city_id                                                                                                                                                                                                                                                                              | PK both; at least one row before `scheduled` (checked in repo + trigger)                                                                                     |
| `campaign_rules`             | campaign_id, benefit (`percent`\|`flat`\|`fixed_price`\|`free_delivery`\|`bundle_price`), value_bp, value_paise, max_discount_paise (per line), max_order_discount_paise, min_subtotal_paise, per_user_limit, per_user_qty_limit, prepaid_only, new_customers_only, stackable, stacks_with_coupon | CHECK value_bp 1..9000; integer paise; one rule per campaign at launch                                                                                       |
| `campaign_targets`           | campaign_id, target_type (`category`\|`brand`\|`product`\|`variant`\|`vehicle_type`\|`vehicle_model`\|`pincode`\|`zone`\|`segment`), target_id/text, include (bool)                                                                                                                               | index (target_type, target_id) for "which offers apply to this variant"                                                                                      |
| `campaign_placements`        | id, campaign_id, slot (`home_hero`\|`home_offer_strip`\|`category_top`\|`product_badge`\|`cart_nudge`\|`search_sponsored`), image asset, alt/headline keys (en+hi), link, weight, freq_cap_per_day, sponsored (bool)                                                                              | CHECK funder brand/shop or paid slot ⇒ sponsored = true; index (slot, campaign status)                                                                       |
| `campaign_budgets`           | campaign_id PK, budget_paise, committed_paise, spent_paise, daily_cap_paise, max_redemptions, redemptions                                                                                                                                                                                         | CHECK `committed + spent <= budget`; CHECK `redemptions <= max_redemptions`; changed only by conditional UPDATE                                              |
| `campaign_user_usage`        | campaign_id, user_id, uses, units                                                                                                                                                                                                                                                                 | PK both; CHECK uses ≤ limit (copied at insert); conditional increment — fixes a race in today's per-user coupon limit (see §5.3)                             |
| `promotion_applications`     | id, order_item_id, campaign_id, coupon_id, funder, discount_paise, status (`committed`\|`spent`\|`released`)                                                                                                                                                                                      | unique (order_item_id, campaign_id); sum per item = `line_discount_paise` minus coins share (asserted)                                                       |
| `coupons` (existing, extend) | + campaign_id FK, + stacks_with_offers, + prepaid_only, + kind `referral`, + `batch_id` for unique codes                                                                                                                                                                                          | keep citext unique code, existing CHECKs                                                                                                                     |
| `price_history_daily`        | variant_id, city_id, day (IST date), min_price_paise, max_price_paise                                                                                                                                                                                                                             | PK (variant_id, city_id, day); written by a nightly job + on price change; serves Rule 4(13)                                                                 |
| `campaign_settlements`       | id, sponsor_id, period, orders, discount_paise, status (`draft`\|`approved`\|`sent`\|`settled`), approved_by                                                                                                                                                                                      | four-eyes; P1                                                                                                                                                |
| `campaign_events`            | append-only: created, submitted, approved, rejected, scheduled, live, paused, budget_exhausted, ended, killed, edited (diff)                                                                                                                                                                      | trigger blocks UPDATE/DELETE (like `coin_ledger`)                                                                                                            |

Campaign state machine (`packages/shared/state`): `draft → pending_approval → scheduled → live ⇄ paused → ended`; `live → exhausted` (budget or redemptions used up); any non-ended → `cancelled`. Edits to value, targeting or budget of a `scheduled`/`live` campaign create a new pending version (old one keeps running until the new one is approved) — no silent price changes mid-checkout.

### 2.3 Approval (four-eyes)

Requester ≠ approver, enforced in the API; uses the approvals inbox from `admin-console.md`.

| Needs a second approver                                                                    | Default threshold (setting) |
| ------------------------------------------------------------------------------------------ | --------------------------- |
| Any brand- or shop-funded campaign (money owed between parties)                            | always                      |
| MechDost-funded campaign with budget above `approval_threshold_paise`                      | ₹25,000                     |
| Discount above 30% on any line, or no per-user limit, or a public code with no total limit | always                      |
| Budget increase on a live campaign                                                         | always                      |
| Referral reward settings change (amounts, caps, hold period)                               | always                      |
| Bulk approval of referral rewards from the review queue                                    | more than 20 at once        |

### 2.4 Preview

- "Preview as customer": pick city, pincode, vehicle, segment and a **date/time** (to check scheduling); see home, category, PDP, cart with the campaign applied; both themes, both languages, 390 / 768 / 1440 widths.
- The approver sees the same preview before approving. Preview never writes to budgets or usage.
- Pricing engine "explain" view: for one cart, which offers matched, which won and why (tie rules in §1.4).

### 2.5 A/B and measurement

- A/B the **creative and placement** (banner A vs B, slot order) with PostHog flags. **Do not A/B the price** of the same offer for customers who are equally eligible: two people seeing different prices for the same product at the same time invites complaints and looks like hidden personalised pricing.
- **Holdout** for incrementality: for MechDost-funded campaigns, keep a small random holdout (default 5%) that sees no banner; compare order rate. Brand-funded discounts apply to everyone eligible (the brand paid for reach).
- Metrics per campaign: viewable impressions (≥ 50% of the banner for ≥ 1 s), clicks, CTR, add-to-cart, orders, redemptions, discount cost, GMV, average order value, incremental orders vs holdout, cost per incremental order, budget burn per day, share of COD vs prepaid, cancellation/RTO rate of orders using the offer (abuse signal).

### 2.6 Analytics events (hard rule 9; spec 12)

Client: `promo_impression` (campaign_id, slot, position), `promo_click`, `offer_badge_view` (sampled), `offer_terms_opened`, `apply_coupon` (exists; add `campaign_id`, `result`), `referral_page_view`, `referral_code_copied`, `referral_shared` (channel: whatsapp/sms/copy/other), `referral_landing_view` (code present, no PII).

Server (never lost to ad blockers): `campaign_redeemed` (order, campaign, funder, discount), `campaign_budget_exhausted`, `campaign_status_changed`, `referral_attributed`, `referral_qualified`, `referral_held`, `referral_reward_unlocked`, `referral_reward_reversed`, `referral_flagged` (risk band only), `referral_milestone_reached`, `admin_campaign_*` (created, submitted, approved, rejected, paused, killed), `admin_referral_reviewed` (approve/reject). No phone, email, address or device id in props (spec 12 rule).

---

## 3. Referral programme

### 3.1 What Indian apps do (evidence)

| App            | Referee must                                                                                                      | Reward trigger                                          | Referrer reward and caps                                                               | Source quality      |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------- |
| **Google Pay** | Be new: phone, email, bank account and device never on GPay; no refurbished device or recycled number; +91 number | Friend's **first successful payment within 28 days**    | ₹101 + ₹25 × 4 weekly quests (₹201); **max 100 rewards and ₹9,000 per financial year** | Official help page  |
| **Swiggy**     | Never ordered before                                                                                              | Friend's first order                                    | ~₹50 per referral; friend ~₹90 off + free delivery; reported cap 50 referrals          | Third-party blog    |
| **Zomato**     | New user                                                                                                          | First order ≥ ₹300                                      | Friend ₹100 off                                                                        | Third-party blog    |
| **Meesho**     | New user                                                                                                          | Friend's **first order** before the referrer's cashback | Cashback                                                                               | Third-party summary |

Official current terms for CRED, Urban Company, PhonePe and Swiggy were not found; we do not rely on their specifics. The pattern is consistent: **new-to-platform friend, reward on a real transaction (not sign-up), a time window, a yearly cap.**

### 3.2 MechDost design (defaults are admin settings)

| Item                 | Default                                                                                                                                                            | Why                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Who can refer        | Any customer with **one delivered order** (and not blocked)                                                                                                        | Real customers only; stops fresh fake accounts from becoming referrers                   |
| Code and link        | Personal code `MD` + 6 base32 (e.g. `MDK7Q2PX`) and `mechdost.com/r/MDK7Q2PX`; WhatsApp share first                                                                | WhatsApp is how Raipur shares; codes easy to read over the phone                         |
| Attribution          | Link sets a first-party cookie for **30 days**; code can be typed at sign-up; **cannot be added after sign-up** (support can fix within 7 days, audited)           | Prevents people adding a friend's code after the fact                                    |
| Friend must be new   | Phone never registered (including deleted accounts; keep a salted hash of deleted phones), no earlier order from the same device, address or payment instrument    | Mirrors Google Pay's new-user rules                                                      |
| **Friend's benefit** | ₹100 off the **first order** with product subtotal ≥ ₹499, applied at checkout as a referral coupon (step 3 in §1.4); valid 30 days after sign-up                  | Instant benefit converts; min order keeps the discount small vs margin                   |
| **Qualifying event** | Friend's first order group reaches **delivered with the delivery code** (not a staff override), product subtotal after discounts ≥ ₹499, within 30 days of sign-up | Delivery code = real hand-over; matches "first delivered order" ask                      |
| **Referrer reward**  | **100 MechDost Coins** per qualified referral                                                                                                                      | Coins: no cash value, max 10% of a later order (spec 20)                                 |
| **Hold period**      | Coins unlock **claim window + 1 day after delivery** (7 + 1 = 8 days, Q25)                                                                                         | Faulty-part claims and fraud surface before coins exist                                  |
| **Milestones**       | 3 qualified → +100 bonus coins; 5 → +200; 10 → +500 and a "MechDost Champion" badge; counted per financial year (April–March, like Google Pay)                     | The owner asked for milestones; bonuses are back-loaded so fraud must succeed many times |
| **Caps**             | 5 qualified referrals per calendar month; 25 per financial year; 5,000 referral coins per financial year (including milestones)                                    | Bounded loss per account even if checks fail                                             |
| Expiry               | Referral coins expire **180 days** after unlock (shorter than the 365-day default)                                                                                 | Limits stockpiling liability; still long for a parts buyer                               |
| Services             | Phase 2: a friend's first **completed and paid workshop service** also qualifies (same hold, after the bill is paid)                                               | Needs Q24 answer on coins for services                                                   |
| Not eligible         | Staff, partner accounts (shop/workshop owners and their staff), business (GSTIN) bulk-quote orders                                                                 | Insiders and B2B bulk flows are the easiest to farm                                      |
| Copy                 | Share text: "I use MechDost for bike and car parts in Raipur. Get ₹100 off your first order with my code MDK7Q2PX. (I get MechDost Coins if you order.)"           | Honest disclosure (ASCI spirit, "disguised advertisement")                               |

Why coins and not a cash reward: a cash or bank reward needs KYC, payout rails and is closer to a payment instrument; the owner already chose "no wallet". Coins also make farming expensive: 100 coins are worth ₹100 only on orders of ₹1,000+ (10% cap), so a fraudster has to buy real parts to get anything.

### 3.3 Referral page (customer)

`/account/refer` (and a card on `/account/coins`):

1. Your code + "Share on WhatsApp" (primary) + copy link (secondary).
2. "How it works" in three steps: friend signs up with your code → gets ₹100 off first order → you get 100 coins 8 days after it is delivered.
3. Milestone tracker: a simple progress bar 0 → 3 → 5 → 10 with the next bonus.
4. Your referrals: masked name ("Ra\*\*\* S."), status in plain words ("Signed up", "Order placed", "Delivered — coins on 12 Nov", "Not eligible: already a customer"), no reasons that teach fraudsters which check fired ("Not eligible" only; support can explain).
5. Terms (CMS, en + hi): one account per person, no deal sites, rewards can be reversed for misuse.

Empty state: one next action ("Share your code"). Calm UI: no confetti loops; a short success animation when coins unlock, respecting reduced motion.

---

## 4. Abuse prevention (most important)

### 4.1 Threats and controls

| #   | Threat                                                                                                           | Controls (layered)                                                                                                                                                                                                                                                                                           | Default thresholds (admin-tunable)                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Self-referral with a second SIM** (India allows up to 9 SIMs per person, not always enforced)                  | Phone OTP raises the cost but does not stop it. Link checks between referrer and friend: same device id, same delivery address (normalised text or within 30 m), same UPI VPA / card fingerprint, same IP at sign-up and order, same contact phone on the address. Any **strong** link → no referrer reward. | Strong links: device, address, payment instrument → auto-reject. Weak links: IP, same /24 network, same pincode + name pattern → +risk only |
| 2   | **Household / family** (real but cheap: everyone at home "refers" each other)                                    | One qualified referral per delivery address, lifetime                                                                                                                                                                                                                                                        | 1 per address                                                                                                                               |
| 3   | **Device farms / emulators**                                                                                     | First-party device id (random id stored in app/browser, plus app install id later), Turnstile on OTP send (exists), emulator/headless signals from Turnstile/WAF, one referral benefit per device for life                                                                                                   | Max 2 accounts ever signed up from one device id; 3rd+ account gets no referral or first-order benefits                                     |
| 4   | **Bot sign-ups / SMS pumping**                                                                                   | Existing: OTP 5/phone/hour, 20/IP/hour, 3/device/10 min, Turnstile, India-only numbers, SMS cost alert. Add: per-code sign-up velocity                                                                                                                                                                       | Per code: 5 sign-ups/day, 20/month attributed; per IP: 5 referred sign-ups/day                                                              |
| 5   | **COD fake orders / RTO farming** (COD RTO in India is commonly reported at 25–35% vs low single digits prepaid) | Reward only on **delivered with code**; RTO or refused delivery voids the referral; referee COD first order needs OTP (exists) and is capped; friend's discount can be made prepaid-only if RTO rises                                                                                                        | Referee first-order COD cap ₹2,000; if a referrer's friends have ≥ 2 RTOs → referrer's referrals paused for review                          |
| 6   | **Order-then-cancel farming**                                                                                    | Cancelled, rejected or undelivered orders never qualify; friend's discount is restored only like coins (once)                                                                                                                                                                                                | —                                                                                                                                           |
| 7   | **Faulty-claim farming** (we have no returns except faulty parts)                                                | Hold until claim window + 1 day; an approved refund on the qualifying order voids the reward; a replacement does not                                                                                                                                                                                         | Hold = 8 days after delivery                                                                                                                |
| 8   | **Staff-override deliveries** (delivered without the customer code)                                              | Never auto-qualify; always go to the review queue                                                                                                                                                                                                                                                            | always                                                                                                                                      |
| 9   | **Code posted on coupon/deal sites** (CashKaro, DesiDime etc.)                                                   | Mostly real new customers, but it turns referrals into unbudgeted paid acquisition. Monthly cap bounds cost; spike detection; terms forbid it; admin can disable or rotate a code                                                                                                                            | > 10 sign-ups/day on one code or friends from > 2 cities in a week → code auto-paused for review                                            |
| 10  | **Collusion rings** (groups refer each other in a circle)                                                        | Referral graph checks: A→B and B→A, or many accounts sharing devices/addresses across a cluster; milestones need distinct, unlinked friends                                                                                                                                                                  | Any cycle → review; cluster of ≥ 3 linked accounts → reject all rewards in the cluster                                                      |
| 11  | **Multi-account for first-order coupons** (not just referrals)                                                   | Same link checks for any `new_customers_only` offer: one first-order benefit per phone, device, address and payment instrument                                                                                                                                                                               | 1 each, lifetime                                                                                                                            |
| 12  | **Coupon guessing / leaked codes**                                                                               | Existing 10 attempts/user/hour; add 30/IP/hour; brand codes as unique single-use batches; every public code has a total limit and a budget                                                                                                                                                                   | Public code without total limit → four-eyes                                                                                                 |
| 13  | **Flash-deal hoarding by resellers**                                                                             | Per-user and per-address unit caps per deal; deal price only on the capped quantity                                                                                                                                                                                                                          | 2 units per user per deal                                                                                                                   |
| 14  | **Shop collusion on brand-funded offers** (shop orders from itself to claim brand reimbursement)                 | Funded discount paid only on delivered orders; flag orders where the delivery address is within 200 m of the shop, or the customer device was seen on the shop's portal login; per-shop anomaly report                                                                                                       | Shop with > 20% of a campaign's redemptions in a city → review                                                                              |
| 15  | **Insider abuse** (staff create a campaign and use it)                                                           | Four-eyes; staff and partner accounts excluded from referrals and from campaigns they created; audit log                                                                                                                                                                                                     | always                                                                                                                                      |

### 4.2 Risk score and review queue

Each referral gets a score when it reaches "delivered" (and again before unlock). Signals and default weights:

| Signal                                                                           | Points            |
| -------------------------------------------------------------------------------- | ----------------- |
| Same device id as referrer, same address, or same payment instrument             | 100 (auto-reject) |
| Same IP at sign-up as referrer within 7 days                                     | 30                |
| Friend signed up < 10 min after the referrer's share event from the same network | 20                |
| Friend's order is COD and its value is just over the minimum (₹499–₹599)         | 15                |
| Referrer has > 3 referrals in the last 7 days                                    | 15                |
| Friend's account has no vehicle saved and no browsing before ordering            | 10                |
| Delivery confirmed by staff override                                             | 40                |
| Friend or referrer previously flagged                                            | 50                |

Bands: **0–29** auto-approve at unlock time · **30–69** review queue (support/ops, `referrals:review`) · **70+** auto-reject (customer sees "Not eligible"). Reviewers see the signals, not raw device ids. Decisions are audited and each is a state transition.

### 4.3 Holding, clawback and kill switches

- **Hold:** reward `pending` until `unlock_at = delivered_at + claim_window_days + 1 day`. Nothing spendable exists before that.
- **Clawback window:** 90 days after unlock, if fraud is confirmed or the qualifying order is refunded. Reverse with a negative ledger row; if the coins were already spent, deduct what is left and record the rest as an outstanding clawback that future earnings pay first. Balance never goes below 0 (existing CHECK). Repeat offenders: block referrals and coin redemption.
- **Kill switches:** `referrals.enabled` (stop new attribution), `referrals.rewards_unlock_enabled` (keep tracking, stop unlocking — use during an attack), per-code disable, per-user `referral_blocked`, "Pause all promotions" for campaigns. Each switch is a setting change: audited, with a reason.
- **Auto-pause:** a campaign whose redemptions per hour exceed 5 × its trailing average, or whose cancellation/RTO rate exceeds 2 × the city average after 20 orders, pauses itself and alerts marketing + ops.

### 4.4 Privacy limits on fingerprinting

- Use a **first-party random device id** and server-side signals (IP, user agent, Turnstile result). Do not use invasive canvas/font/audio fingerprinting libraries at launch; a commercial device-intelligence service is P2 and needs a privacy review first.
- Store device ids, addresses and payment fingerprints for matching as **HMAC hashes** (key in Secret Manager), never raw in analytics or logs.
- Name "fraud and abuse prevention" as a purpose in the privacy notice; keep 12 months after last activity; access limited to the risk role.
- Never use IP alone to block: households and offices share networks.

---

## 5. Integrity (hard rule 3)

### 5.1 Tables for referrals

| Table                  | Key columns                                                                                                                                                         | Constraints that make double rewards impossible                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `referral_codes`       | user_id, code (citext), status, version                                                                                                                             | unique user_id (one active code each); unique code                                                                          |
| `referrals`            | id, referrer_id, referee_id, code_id, attributed_at, state, qualifying_order_group_id, risk_score, risk_reasons (jsonb, codes only), decided_by, version            | **unique referee_id** (one referrer per person, ever); **unique qualifying_order_group_id**; CHECK referrer_id ≠ referee_id |
| `referral_rewards`     | id, referral_id (null for milestones), user_id, role (`referrer`\|`referee`\|`milestone`), milestone_level, period (FY), coins, state, unlock_at, idem_key, version | **unique (referral_id, role)**; **unique (user_id, milestone_level, period)**; unique idem_key; CHECK coins > 0             |
| `referral_events`      | append-only log of every transition with actor                                                                                                                      | trigger blocks UPDATE/DELETE                                                                                                |
| `risk_identifiers`     | user_id, kind (`device`\|`address`\|`payment`\|`phone_deleted`), hash, first_seen, last_seen                                                                        | index (kind, hash) for link checks; retention job                                                                           |
| `first_order_benefits` | kind (`device`\|`address`\|`payment`\|`phone`), hash, user_id, order_group_id                                                                                       | **unique (kind, hash)** — two parallel "first orders" from linked accounts cannot both get the benefit                      |

### 5.2 State machines (`packages/shared/state`, conditional UPDATE with `version`)

- **Referral:** `attributed → order_placed → delivered → held → qualified` · from any non-final: `→ void` (order cancelled, rejected, RTO, refunded, expired 30-day window) · `delivered/held → under_review → qualified | rejected`.
- **Reward:** `pending → unlocked → (reversed)` · `pending → void | rejected`. Only the unlock job moves `pending → unlocked`.

### 5.3 How each write stays safe

| Operation                            | Pattern                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attribution at sign-up               | Inside the `ensureUser` transaction: insert `referrals` (unique referee_id) — a retry or second tab is a no-op                                                                                                                                                                                                                                              |
| Qualify on delivery                  | In the same transaction that marks the order delivered (delivery-code path): conditional UPDATE `referrals` `order_placed → delivered WHERE qualifying_order_group_id = $order`; create `referral_rewards` rows `pending` with `unlock_at`                                                                                                                  |
| Unlock                               | pg-boss job; `SELECT … WHERE state='pending' AND unlock_at <= now() FOR UPDATE SKIP LOCKED`; per row in one tx: re-score, conditional UPDATE `pending → unlocked WHERE version = v`, `earnCoins(idemKey)`, write event + outbox notice                                                                                                                      |
| Coin credit                          | Existing `earnCoins` with keys `ref-{referralId}-referrer`, `ref-{referralId}-referee`, `refm-{userId}-{FY}-{level}` (fit the existing `^[A-Za-z0-9:_-]{10,100}$` format). Unique key = a second credit is impossible                                                                                                                                       |
| Reversal                             | Conditional UPDATE `unlocked → reversed`; negative ledger row with key `ref-{referralId}-referrer-rev`. Needs a new ledger kind (`reverse`, delta < 0) or reuse `adjust` with a system actor — recommend a new kind so reports stay clear                                                                                                                   |
| Caps                                 | Monthly/yearly caps checked inside the unlock tx against a per-user counter row (`referral_counters (user_id, period)` with CHECK ≤ cap, conditional increment), not by `COUNT(*)` (read-then-write race)                                                                                                                                                   |
| Campaign budget                      | At order placement: `UPDATE campaign_budgets SET committed = committed + $d, redemptions = redemptions + 1 WHERE campaign_id = $c AND committed + spent + $d <= budget AND redemptions < max` — 0 rows → offer no longer available, re-price and tell the customer (spec 03 edge case)                                                                      |
| Per-user limits (coupons and offers) | `campaign_user_usage` conditional increment. **Gap found in the current schema:** `coupon_redemptions` has unique (coupon_id, group_id) and an index on (user_id, coupon_id), so a per-user limit of 1 would be checked by counting — two checkouts racing could both pass. Fix with the counter row (or a unique (coupon_id, user_id) when the limit is 1) |
| Release on cancel                    | Idempotent: `promotion_applications committed → released`, budget `committed −= d`, usage −1, once (same pattern as `restoreCoinsForOrder`)                                                                                                                                                                                                                 |

### 5.4 Tests to write (acceptance, mandatory)

Unit (Vitest, `packages/shared`): stacking order and tie rules; best-offer selection; allocation sums exactly (property test); coin cap on post-discount subtotal; 30-day prior price from history (incl. a price raised then "reduced"); floor at 60%; IST campaign boundaries (23:59:59 vs 00:00 IST); risk score bands.

Integration (`packages/db/test/integrity.test.ts`):

- Two parallel unlocks of one reward → one ledger row, one coin credit.
- Two referrals for the same friend from two codes → second insert fails.
- Two parallel checkouts using the last ₹100 of a campaign budget → one succeeds, the other is re-priced.
- Two parallel first orders from accounts sharing a device → only one gets the first-order benefit.
- Per-user limit 1 under two racing checkouts → one redemption.
- Milestone 3 reached by two rewards unlocking at the same moment → one milestone bonus.
- Cap reached: 6th qualified referral in a month stays pending/void, no coins.
- Cancel after commit → budget and usage released exactly once (replay the cancel twice).
- Reversal after coins were spent → balance never below 0; outstanding clawback recorded.
- Append-only: UPDATE/DELETE on `referral_events` and `campaign_events` rejected.

E2E (Playwright): refer → friend signs up with link → first order COD → delivery code → reward pending → clock +8 days → coins unlocked → milestone tracker updates; self-referral on the same device → "Not eligible"; staff override delivery → review queue → approve; campaign scheduled in IST appears/disappears at the right minute (clock suite); "Sponsored" label visible on paid banners in en and hi; budget exhaustion auto-stops and the badge disappears; four-eyes: requester cannot approve own campaign (API 403); role-leak: shop/workshop users cannot read referral or campaign admin APIs (404).

Abuse suite (website-testing learnings): device reuse, address reuse with different formatting ("H.No 12, Shankar Nagar" vs "12 Shankar nagar"), UPI reuse, code velocity spike → auto-pause, RTO voids referral.

---

## 6. Prioritised build plan

### P0 — before public launch (and before 1 Jan 2027 for the legal items)

| #   | Item                                                                                                                                                                                                                               | Notes                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | `price_history_daily` + nightly job **now**                                                                                                                                                                                        | Needs ≥ 30 days of history before 1 Jan 2027 → start by 1 Dec 2026                             |
| 2   | Pricing engine in `packages/shared/pricing` (pure, §1.4) used by cart, checkout, PDP, cards                                                                                                                                        | One source of truth for web/API/app                                                            |
| 3   | `campaigns`, `campaign_cities`, `campaign_rules`, `campaign_targets`, `campaign_budgets`, `campaign_user_usage`, `promotion_applications`, `campaign_events`; extend `coupons`                                                     | Funder field from day one, even if only MechDost funds at launch                               |
| 4   | Home: one hero banner slot + one offer strip from campaigns (CMS), "Sponsored" label, frequency cap                                                                                                                                | Reserve aspect ratio (CLS < 0.05), `next/image`, `priority` only on hero; no autoplay carousel |
| 5   | Offer badges on product cards and PDP; offer terms sheet; cart "You save" lines                                                                                                                                                    | en + hi copy in locale files                                                                   |
| 6   | Admin `/admin/promotions`: list with status and budget bar, editor, preview, kill switch, pause all                                                                                                                                | Four-eyes via approvals inbox                                                                  |
| 7   | Referral core: codes, link attribution, friend's first-order discount, delivered-with-code qualification, 8-day hold, coins via `earnCoins`, caps, link checks (device, address, payment), risk score, review queue, kill switches | Milestones can ship in P1 if time is short                                                     |
| 8   | `/account/refer` page; share on WhatsApp; status list                                                                                                                                                                              | Events from §2.6                                                                               |
| 9   | "How we rank products" page and dark-pattern self-audit checklist (CMS)                                                                                                                                                            | Rule 5(3)(f), 4(15)                                                                            |
| 10  | Fix the per-user coupon limit race (§5.3)                                                                                                                                                                                          | Integrity gap in existing schema                                                               |

### P1

Milestones and badge; brand sponsors + prepaid deposits + monthly statements + settlements (four-eyes); flash deals with unit caps; bundles with prices (spec 11); bank/UPI offers via the gateway; holdout measurement and campaign reports; auto-pause on anomalies; clawback flow; referral rewards for workshop services; unique single-use code batches for brands; per-shop anomaly report.

### P2

Sponsored products in search and category results (separate, labelled slots; ranking explanation); brand self-serve portal (create a campaign, upload creative, see reports; MechDost approves); partner referrals (shop refers shop, with 194R check); device-intelligence vendor (after privacy review); learned targeting.

---

## 7. Questions for the owner (queue in `docs/questions-for-user.md`; suggested safe default in brackets)

1. **Referral rewards:** friend gets ₹100 off first order over ₹499; you get 100 coins per successful referral; milestones +100 / +200 / +500 at 3 / 5 / 10. OK? [Yes, as listed]
2. **Caps:** 5 rewards a month, 25 a year, 5,000 referral coins a year? [Yes]
3. **Hold:** coins unlock 8 days after delivery (claim window 7 days + 1)? Depends on Q25. [8 days]
4. **Who can refer:** only customers with one delivered order? [Yes]
5. **COD for the friend's first order:** allowed with a ₹2,000 cap, or prepaid only? [Allowed, capped]
6. **Household rule:** one successful referral per delivery address, ever? [Yes]
7. **Referral coins expiry:** 180 days, or the same 365 as other coins? [180]
8. **Coins for workshop services** (also part of Q24): should a friend's first paid service count as a referral? [Later, Phase 2]
9. **Brand deals:** how will brands pay for banners — fixed price per week per slot, or per thousand views? And for funded discounts, a prepaid deposit before going live? [Fixed weekly price; prepaid deposit]
10. **Can shops run their own discounts** on MechDost (shop-funded), or only MechDost and brands at launch? [Only MechDost and brands at launch]
11. **GST structure for funded discounts and for MechDost Coins** — please ask your CA: (A) invoice at full price with "paid by MechDost/brand", or (B) net price with a separate credit to the shop? [Hold brand-funded money until the CA answers; MechDost-funded offers use (A)]
12. **Foreign investment:** any plan to take foreign investment? It would restrict MechDost-funded discounts and coins (Press Note 2 of 2018). [Assume no]
13. **Approval threshold** for MechDost-funded campaigns needing a second approver: ₹25,000 budget? [₹25,000]
14. **Deal sites:** forbid posting referral codes on coupon sites (and pause codes that spike), or allow it? [Forbid; auto-pause]
15. **Staff and partners** excluded from the referral programme? [Excluded]
16. **Discount ceiling:** maximum 60% total discount per order unless a clearance is approved? [60%]

---

## Sources

E-Commerce Amendment Rules 2026

- TaxGuru (gazette reproduction of the Consumer Protection (E-Commerce) (Amendment) Rules, 2026): https://taxguru.in/?p=1078866
- LiveLaw, "Government Amends E-Commerce Rules To Strengthen Consumer Protection": https://www.livelaw.in/consumer-cases/government-amends-e-commerce-rules-to-strengthen-consumer-protection-550184

Dark patterns and misleading ads

- SCC Online, CCPA notifies Dark Patterns Guidelines 2023: https://www.scconline.com/blog/post/2023/12/04/ccpa-notifies-guidelines-for-prevention-and-regulation-of-dark-patterns-2023-legal-news/
- JSA, CCPA Guidelines for Prevention and Regulation of Dark Patterns 2023: https://www.jsalaw.com/newsletters-and-updates/ccpa-issues-guidelines-for-prevention-and-regulation-of-dark-patterns-2023/
- Khaitan & Co, Misleading Advertisements and Endorsements Guidelines 2022: https://khaitanco.com/thought-leaderships/CCPA-releases-guidelines-for-Prevention-of-Misleading-Advertisements-and-Endorsements-for-Misleading-Advertisements-2022
- Lexplosion, bait and free-claim ads under the 2022 guidelines: https://lexplosion.in/guidelines-for-prevention-of-misleading-advertisements-notified-prohibits-surrogate-advertisements-regulates-bait-free-claims-and-children-targeted-advertisements/

ASCI

- Legal500, ASCI final Guidelines for Influencer Advertising on Digital Media: https://legal500.com/developments/?p=29827
- Mondaq, ASCI releases final influencer guidelines: https://www.mondaq.com/india/social-media/1076110/advertising-standards-council-of-india-asci-releases-final-guidelines-for-influencer-advertising-on-digital-media

Legal Metrology

- India Briefing, LM Rules apply to e-commerce: https://www.india-briefing.com/news/consumer-protection-india-lm-rules-now-apply-e-commerce-notified-medical-devices-16587.html
- LiveLaw, selling above MRP is an unfair trade practice: https://www.livelaw.in/amp/consumer-cases/selling-pre-packaged-products-above-mrp-is-unfair-trade-practice-thrissur-district-commission-297444

GST and income tax

- CGST Act s.15 (value of supply): https://www.knowyourgst.com/gstlaw/cgst-act/15-value-of-taxable-supply-15/
- TaxGuru, Circular 251/08/2025 on post-sale discounts: https://taxguru.in/goods-and-service-tax/gst-treatment-post-sale-discounts-circular-no-251-08-2025-gst.html
- Lakshmikumaran & Sridharan, discount schemes and credit notes after Budget 2026: https://www.lkslaw.com/insights/news/gst-discount-schemes-and-credit-notes-changes-by-budget-2026
- GST Council, Circular 92/11/2019 (sales promotion schemes): https://gstcouncil.gov.in/sites/default/files/2024-06/circular-cgst-92.pdf
- Income Tax Department, TDS on benefit or perquisite (s.194R): https://www.incometaxindia.gov.in/w/tds-on-benefit-or-perquisite-arising-from-business-or-profession
- TaxGuru, summary of CBDT Circular 12/2022: https://taxguru.in/income-tax/summary-tds-section-194r-faqs-cbdt.html

FDI and data protection

- Khaitan & Co, FDI in e-commerce, Press Note 2 (2018): https://khaitanco.com/thought-leadership/FDI-in-E-commerce-activities-press-note-no-2
- IndiaCorpLaw, revised FDI policy for e-commerce: https://indiacorplaw.in/2019/01/12/dipps-revised-fdi-policy-e-commerce-changing-rules-game/
- PIB, DPDP Rules 2025: https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf
- DPDP Act s.7 text: https://www.dpdpa.com/dpdpa2023/chapter-2/section7.html

Referral programmes

- Google Pay India, Refer your friends (official): https://support.google.com/pay/india/answer/13267498?hl=en
- Zoutons, Swiggy refer and earn (third party): https://zoutons.com/news/swiggy-refer-and-earn
- CashKaro, Zomato refer and earn (third party): https://cashkaro.com/blog/refer-and-earn-on-zomato/102897

Fraud, COD and bots

- Prefinery, referral fraud types and prevention: https://www.prefinery.com/blog/referral-fraud-types-and-prevention/
- Track360, preventing referral fraud: https://www.track360.io/learn/refer-a-friend-program-design/preventing-referral-fraud
- ReferralCandy, 7 referral fraud patterns: https://www.referralcandy.com/blog/7-referral-program-fraud-patterns-and-how-to-block-each-one
- ISB, how SIM card fraud fuels cybercrime (SIM limits in India): https://www.isb.edu/insights/how-sim-card-fraud-fuels-a-hidden-world-of-cybercrime
- Tech Observer, organised fraud rings targeting e-commerce: https://techobserver.in/news/cybersecurity/organised-fraud-rings-targeting-e-commerce-platforms-says-study-323699/
- Razorpay, cash on delivery challenges: https://razorpay.com/blog/cash-on-delivery-and-the-challenges/
- Shipmozo, COD fraud in Indian e-commerce: https://www.shipmozo.com/blog/cod-fraud-in-indian-e-commerce
- Cloudflare Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
