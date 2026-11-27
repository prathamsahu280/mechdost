# Delivery agents + COD by approval: live simulation plan (2026-11-27)

Owner: QA lead (planning agent; plan only, read-only reconnaissance) · Runs on: **mechdost.com (production)** · Team:
3 Opus agents at most (L, P, R) · Tools: Playwright (primary), chrome-devtools MCP (Lighthouse/axe, optional) ·
Specs: `docs/specs/24-delivery-agents.md` (incl. § 16 and "Web screens"),
`docs/superpowers/specs/2026-11-26-delivery-agents-design.md` (Lead's calls 1–13, contract), spec 03 § Cash-on-delivery
eligibility, specs 04, 05, 07, 08, 13, 14 · Model: `docs/qa/ustaad-simulation-plan-2026-11-27.md` · Report (written by
the run): `docs/qa/delivery-cod-simulation-report-2026-11-27.md` · Artefacts: **`D:\mechdost-qa\delivery-cod-sim-2026-11-27\`**
(videos, screenshots, logs, walkthrough.html; never the repo, never C:).

Founder's go-ahead (2026-11-27, relayed by the lead): "yeah run the delivery and cod simulation too". Window: about
**15:30–18:30 IST** unless the founder says otherwise.

Accounts are named **account 01 … account 10** only. Phone numbers, emails and user ids stay in the local file
`D:\mechdost-qa\delivery-cod-sim-2026-11-27\logs\accounts.local.json` (copied from the Ustaad run's `ids.json` plus the
recon below). They never go in this repo file, a caption, a log line or an issue. The Firebase test code and the
staff two-step code are in memory "real-api-test-inputs", so they are not repeated here.

---

## OPEN QUESTIONS THAT BLOCK THE RUN (answer before Gate 1)

| #          | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Default if no answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q-DC-1** | **COD orders can never be carried by a delivery agent.** By design (Lead's calls 8/9/11; `deliveryModeFor` in `packages/db/src/repo/delivery-common.ts`; spec 24 § 3 "COD → `shop`", § 4.6 "COD refused"), a COD sub-order gets `delivery_mode = shop`, and "ready for pickup" is refused. With online payment forbidden (live Razorpay), **no new order can ever open a delivery job.** Recon found the only safe route: **4 already-paid, unrouted `placed` orders of account 01 from 2026-11-16** (online, `payment_status = paid`, captured 11-16; codes in § 2.0 G0-F6). May the delivery chains use them? | **Yes, use them.** They are test-account orders, and routing them needs no payment. Delivery chains D1–D6 run on them, routed **only** to account 02's shop once it is in agents mode. New COD orders prove "COD stays with the shop" (C5). If the founder says no, D1–D6 run in the browser demo (`/demo` build, demo logins in spec 24 "Browser demo") as render and flow checks only, and the live run is limited to onboarding (A1–A4), shop mode (S1) and COD (C1–C6).                                                     |
| **Q-DC-2** | **Were the 11-16 payments made on Razorpay TEST keys?** Approving any refund on those orders would send a refund to **live** Razorpay for a `pay_…` id it may not know (or, if it was live, real money moves). A return (D3) or a reject creates a refund **request** only (`refunds.ts`: every refund waits for `refunds:approve`).                                                                                                                                                                                                                                                                            | Refund requests may be **created** and their amount and wording checked. **No refund is ever approved** in this run (§ 1 forbidden F4). The open request stays for the founder's later cleanup.                                                                                                                                                                                                                                                                                                                                 |
| **Q-DC-3** | **WhatsApp would reach numbers that are not the founder's.** WhatsApp is live (1 `order.rejected` sent 2026-11-23). The templates `order.confirmed`, `order.out_for_delivery`, `order.rejected` and `order.routed` (en + hi) are **enabled and Meta-approved** in `notification_templates`. `queueOrderWhatsApp` sends to the customer's `users.phone`, i.e. the Firebase test range +91 90000 0000x. That range is fictional only inside Firebase: on WhatsApp it can belong to a stranger. Every shop-accept and pickup in this run would send one.                                                           | **Switch those 4 WhatsApp templates (8 rows, en + hi) OFF** in Admin → Notifications for the window, then restore (settings ledger rows L9–L12). Real customers lose order WhatsApp for about 3 h. Recon shows no non-test orders in 30 days, but the founder must approve. **No answer = no order chain starts** (onboarding and COD request chains may run, because they send no WhatsApp). The WhatsApp budget (≤ 3, founder's number) is therefore expected to stay at **0**: no test account carries the founder's number. |
| **Q-DC-4** | **Sign-in after 16:57 IST.** The API Turnstile bypass (`QA_TURNSTILE_BYPASS_*`) ends at 16:57, and the window runs to 18:30. The bypass covers only password sign-in and the Ustaad join, **not** the public "Apply as a delivery agent" form (`POST /v1/delivery-agent-applications`, Turnstile). Are the Cloudflare always-pass TEST keys set on **both** the web (site key) and the API (secret)?                                                                                                                                                                                                            | Sign in every account needed (01, 02, 03, 04, 05, 06, 07, 10) **before 16:45** and save Playwright `storageState` per account. Run the public apply steps A1 first (before 16:45). If the API refuses the apply form (Turnstile 403), the apply step becomes a logged finding, and onboarding continues with a **staff invite of someone who never applied** (A2b). Ask the lead to extend the bypass to 18:45 if the founder agrees.                                                                                           |
| **Q-DC-5** | `checkout.cod_everyone` is city-wide (RPR), not scoped to test accounts. May it be switched on, for ≤ 5 minutes, to see its effect live?                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **No.** Open the switch, read the risk warning, then **cancel**. The ON behaviour is cited from the automated tests (`packages/shared/test/cod-eligibility*.test.ts`, `createTestDb({ codDefaults })` suites).                                                                                                                                                                                                                                                                                                                  |
| **Q-DC-6** | Email budget ≤ 10. Order emails to account 01 (placed / confirmed / out for delivery / delivered / rejected), COD decision emails and invite emails all count. The order chains alone can exceed 10.                                                                                                                                                                                                                                                                                                                                                                                                            | Invites are sent **without an email** except one (A2a). Before the order chains, the customer accounts turn off optional email updates in their own notification preferences (if the order emails are optional; check at G0-9). At 8 emails, stop every email-generating step that is not yet run and assert outbox rows instead (read-only query). If transactional emails cannot be turned off, run only D1 + C5 with email and the rest after the founder raises the cap.                                                    |
| **Q-DC-7** | Data anomaly found in recon: Sharma Auto Parts sells "Racer4 20W40 900 ml" at **₹1.00** (100 paise; MRP ₹350; another shop sells it at ₹340). Is it a deliberate test price?                                                                                                                                                                                                                                                                                                                                                                                                                                    | Logged as finding **F-R1 (P2, data/pricing)**. The run uses it as the cheap COD product **only if** the founder confirms it is a test price. Otherwise it uses "Wheel bearing 6301-2RS" (₹180).                                                                                                                                                                                                                                                                                                                                 |

---

## 0. Advisor brief (mechdost-advisor, run before writing this plan)

```
ADVISOR BRIEF — Delivery agents + COD by approval live simulation plan (planning only)
Context loaded: CLAUDE.md; docs/progress.md (2026-11-27 handover + delivery web alignment + COD entries);
  .claude/skills/mechdost-advisor/references/agent-brief.md; learnings (tail); spec 24 (all, incl. § 16 and Web
  screens); docs/qa/ustaad-simulation-plan-2026-11-27.md (structure, safety, ledger); D:\…\ustaad-sim-2026-11-27\logs
  (gate0.md, ids.json, bugs.md, settings-ledger.md, BYPASS_ON, DEPLOY_OK); code: shared/cod-eligibility.ts,
  state/cod-request.ts, api routes/cod.ts, settings.ts (checkout.cod_*, delivery.*), db repo delivery-common.ts
  (deliveryModeFor, newShopDeliveryMode), delivery-agents.ts (invite, accept, documents), delivery-jobs.ts
  (offer guard), routing.ts (routeOrder, paymentAllowsRouting), refunds.ts (approval gate, delivery_returned),
  order-notifications.ts (WhatsApp), notification-admin.ts (channel gate), shared/delivery/codes.ts (number rules);
  production DB read-only (four READ ONLY transactions, counts and test-account rows only).
Areas: orders/routing · payments/money (refund requests) · auth/RBAC · notifications · analytics · i18n · UI/a11y ·
  security/privacy · infra (live settings).
Hard rules:
  ❌→fixed 3/15 — the brief's "orders are COD only" plus "agents deliver" is impossible by design (COD → shop);
     re-planned on existing prepaid test orders (Q-DC-1) with a no-refund-approval rule (Q-DC-2).
  ❌→fixed 15 — order WhatsApp templates are live and target the Firebase test range (possibly strangers on
     WhatsApp); outward send blocked until the founder approves switching them off (Q-DC-3).
  ⚠️ 4 — the public apply form needs Turnstile outside the bypass (Q-DC-4).
  ⚠️ 9/16 — test traffic in the event store and PostHog: the 10 accounts' ids are in the local file so analysts
     can exclude them.
  ⚠️ 10 — the Hindi crawl of the new screens uses the e2e/hindi-coverage allowlist.
Conflicts / corrections: (1) COD-only vs agent delivery (Q-DC-1). (2) "Never complete a payment" also means "never
  approve a refund" (F4). (3) delivery.agents_enabled ON makes every NEWLY APPROVED shop `agents`
  (newShopDeliveryMode), so no seller approval in the window (F7). (4) Turning it OFF with a job in needs_agent
  strands the job (offer → AGENTS_DISABLED), so restore only after every job is terminal. (5) "Everyone" COD is
  city-wide, so it is not switched (Q-DC-5).
Risks: (1) a stranger receives WhatsApp → templates off + kill switch; (2) live refund → never approve;
  (3) session loss after 16:57 → pre-sign-in + storageState.
Improvements: P0 a "test account" flag that suppresses outward WhatsApp/email to the Firebase test range (would
  have removed Q-DC-3); P1 a staging copy with Razorpay test keys for prepaid chains; P1 a test-only city
  (e.g. `TST`, hidden) so city switches such as cod_everyone and agents_enabled can be tried without touching
  Raipur; P2 a third staff test account (ops_manager or finance) for city-scope and four-eyes checks.
Decisions needed: Q-DC-1 … Q-DC-7 (top of this file); add to docs/questions-for-user.md when the lead commits.
Docs to update in this change: this file only (planning task). The run updates docs/progress.md, the report,
  both learnings files, docs/questions-for-user.md.
Skills: mechdost-advisor (run); website-testing and playwright-best-practices for the run; accessibility (+
  accessibility-agents), core-web-vitals, next-intl-hindi, systematic-debugging (each failure),
  notifications-messaging (C-N chain), razorpay-payments (refund rule check), verification-before-completion.
Applicable learnings: T-UA1 (hidden = indistinguishable 404), N3 (the other role's screen updates), R1 (every
  opened panel closable), SIM-LEAD-7 (admin Delivery tabs layout, already open), Ustaad G0 sign-in method
  (Turnstile stub + allowlisted bypass; see § 2.2).
```

---

## 1. Goals, scope, safety

### 1.1 Goals

1. Prove **COD by approval** end to end on the live stack: request → approve / reject / withdraw / revoke, re-apply
   wait, eligibility through verified Ustaad membership, checkout behaviour per reason, and that a COD order always
   stays with the shop.
2. Prove **delivery agents** end to end: apply → staff review → invite → sign-in → documents → verify / reject →
   active → online. Then shop mode request → approve. Then a prepaid test order routed to the test shop → accept →
   packed → ready for pickup (pickup code) → suggestions → offer timer → accept / decline / expire → pickup (code +
   photo) → out for delivery → deliver (customer code + photo) → rating → payout + correction. Failure, retry, return,
   switch-to-shop, overrides and standing (pause/suspend) branches are covered too.
3. For every action, check the **other** actors' screens (customer, shop, rider, staff; bug class N3) and the role
   boundaries (role-leak checks).
4. Render every delivery and COD screen in en/hi × 390/768/1440 × light/dark; audit design, UX writing,
   accessibility, analytics and privacy.
5. Record everything (video per actor, screenshot per step, timestamped log) and build a walkthrough page.

### 1.2 Out of scope

Online payment of any kind; refund approval or sending; new prepaid orders; `checkout.cod_everyone` ON (Q-DC-5);
WhatsApp delivery templates (not submitted to Meta, spec 24 § 10); masked calling, live map, batching (not built);
document retention purge (not built); load tests; real concurrency races (owned by `packages/db/test/delivery-*.test.ts`).

### 1.3 Environments

| Item    | Value                                                                                                                                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site    | `https://mechdost.com` (en), `https://mechdost.com/hi` (hi)                                                                                                                                                                                   |
| Build   | deployed today: `deca80e7…` (DEPLOY_OK 13:10 IST, contains 9c98757d) **or later**. G0-1 records the live SHA and GHCR digest as the first line of `logs/run-log.jsonl`, and checks that it contains the delivery web + COD (0105, 0106, 0109) |
| Browser | Playwright Chromium, headed for recording. Phone 390×844 with touch (riders, customer); desktop 1440×900 (staff, shop); 768 for the render matrix                                                                                             |
| Machine | founder's PC. Nothing written to C: (outputDir, videos, traces, profiles on D:). At most 3 agents, one recording browser at a time per agent                                                                                                  |

### 1.4 FORBIDDEN (every agent, every step; a breach = stop the run and tell the lead)

| #   | Forbidden                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Any online payment.** Razorpay is on LIVE keys. Never choose "Pay online", never open Razorpay Checkout, never call `/v1/checkout/*/pay` or any payment-verify route. Every new order is **cash on delivery**, which needs COD eligibility first (chain C1/C3). Never "complete" or mark a payment.                                                                                          |
| F2  | **Any order, offer, email or WhatsApp to a real shop, customer or rider.** Orders are routed **by hand to account 02's shops only** (Sharma Auto Parts, Raipur Battery Point; § 2.0 G0-F3). Never use "Let MechDost choose"/auto-routing for a run order, and never route to Chhattisgarh Tyre House or Gupta Lubes & Spares (no owner accounts). Offers go only to the run's riders (06, 07). |
| F3  | **WhatsApp to anyone but the founder's own test number.** The order WhatsApp templates stay OFF the whole window (Q-DC-3, L9–L12). Before **every** order step, L checks that the 4 templates still read OFF. Any outbox row with `channel = whatsapp` created in the window = **kill switch** (§ 9.2) + P0.                                                                                   |
| F4  | **Approving, sending or retrying any refund** (Admin → Refunds). Refund requests from D3/C6 are only **read**.                                                                                                                                                                                                                                                                                 |
| F5  | **Real-looking identity documents.** Riders upload only generated images reading "TEST DOCUMENT — NOT VALID / MechDost QA 2026-11-27" (§ 2.5). Numbers use impossible prefixes: PAN with 4th letter `Z` (no such holder type), licence and RC with state code `ZZ`. Never a real person's number, never a photo of a real card.                                                                |
| F6  | **Sign-in as anyone other than accounts 01–10**, and opening a non-test person's row. Staff screens list only test rows today; if a non-test row appears, do not open it, then screenshot-check and mask.                                                                                                                                                                                      |
| F7  | **Approving any seller/partner application, or changing a real shop's mode,** while `delivery.agents_enabled` is ON (a newly approved shop starts in `agents` mode: `newShopDeliveryMode`).                                                                                                                                                                                                    |
| F8  | **Switching `checkout.cod_everyone` ON** (Q-DC-5). Changing any setting not listed in § 2.4.                                                                                                                                                                                                                                                                                                   |
| F9  | Phone numbers, emails, tokens, invite links, pickup/delivery/return codes or document numbers in logs, captions or the report (codes are typed from the screen into the next actor's step through `logs/_secrets.local.json`, never logged).                                                                                                                                                   |
| F10 | Writing to the database directly. DB access is **read-only** (`node --env-file=.env` scripts that open `sql.begin('read only', …)`, never printing phones/emails). Every write goes through the real UI (or the account's own signed API session when the UI has a gap, logged as GAP).                                                                                                        |
| F11 | Leaving a job non-terminal when switching `delivery.agents_enabled` OFF (strands it: offers refused with `AGENTS_DISABLED`).                                                                                                                                                                                                                                                                   |

### 1.5 Budgets (counters in `logs/budget.json`, checked before every step that can send)

| Budget       | Cap                                                 | Counted from                                                                                  | Stop rule                                                                                                      |
| ------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Emails       | **≤ 10**                                            | outbox rows `channel = email` created in the window (read-only query after each sending step) | at 8: skip remaining email-generating steps, or assert the outbox row only where it is created anyway (Q-DC-6) |
| WhatsApp     | **≤ 3**, founder's test number only; **expected 0** | outbox rows `channel = whatsapp`                                                              | any row at all → kill switch (F3)                                                                              |
| Public apply | 3/day per phone, 5/h per IP (spec 24 § 4.1)         | own counter                                                                                   | A1 uses 3 submissions (06, 07, 08) + 1 limit check                                                             |
| Disk         | ≤ 2 GB                                              | `du` of the run folder                                                                        | compress videos (ffmpeg, as in the Ustaad run), delete traces of passing steps                                 |

Expected emails (worst case, before Q-DC-6 mitigations): COD approve 1 + reject 1 + revoke 1 + invite 1 (A2a only) +
order emails to 01 for D1 (≈ 3) = **7**. Every other order chain goes to outbox-row assertions only.

---

## 2. Setup (Gate 0 → Gate 2)

### 2.0 Gate 0: reconnaissance facts (planning agent, 2026-11-27, read-only) and checks for the lead

**Facts found (production DB, READ ONLY transactions; counts only for non-test data):**

| Id     | Fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0-F1  | Accounts 01–10 exist, all `active`, phone verified. Created: 01, 02, 04, 05 on 2026-11-16; 03, 06–10 on 2026-11-27. Language: 03, 06, 08 = hi; others en. All have an email set; **03, 08, 09 email not verified**.                                                                                                                                                                                                                                                                                                                                                                                                         |
| G0-F2  | Roles: 05 `super_admin` (the **only** super admin in production); 10 `community_manager` RPR; 02 `seller_owner` ×2 + `mechanic`; 04 `workshop_owner` + `mechanic`; 03, 06, 07, 08, 09 `mechanic`. **No account holds `ops_manager`, `city_manager`, `finance` or `delivery_agent`**; the roles exist.                                                                                                                                                                                                                                                                                                                       |
| G0-F3  | **Shops: 4 in production, all RPR, all `approved`, all `delivery_mode = self`, all created 2026-11-16, all with phones in the Firebase test range (seed shops). There is no real shop.** Account 02 owns **Sharma Auto Parts** (PIN 492004, 14 live listings) and **Raipur Battery Point** (492007, 8 listings). Both cover PINs 492001, 492004, 492006, 492007, 492099 (shipping ₹40, 2 days). Chhattisgarh Tyre House and Gupta Lubes & Spares have **no owner user**, so they are never used (F2).                                                                                                                       |
| G0-F4  | Settings: **no `settings` row exists for any `checkout.cod_*`, `delivery.*` or `routing.*` key** → all registry defaults: `delivery.agents_enabled` = off, `offer_timeout_min` 15, `max_attempts` 2, `photos_required` on, `max_active_jobs` 3, `invite_hours` 72, `low_rating_alert_x10` 35, `low_rating_min_count` 5; `checkout.cod_everyone` off, `cod_approved_customers` on, `cod_ustaad_verified` on, `cod_ustaad_min_level` 0, `cod_cap_paise` 500000 (₹5,000), `cod_min_order_paise` 0, `cod_min_items` 1, `cod_request_reapply_days` 7 (global only), `cod_fee_paise` 0.                                           |
| G0-F5  | Delivery tables empty: 0 agents, 0 invites, 0 delivery applications, 0 jobs, 0 shop mode requests. COD: 0 requests. Partner applications: 0 of any kind (so F7 has nothing pending today).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G0-F6  | **Open orders: 5, all account 01's, all from 2026-11-16, all `placed`, unrouted (`shop_id` null), `delivery_mode = shop`, version 1, stock holds expired:** `MD-RPR-2026-ZYJF5E-1` online paid ₹220 (1× wheel bearing 6301-2RS, PIN 492001) · `MD-RPR-2026-B1195T-1` online paid ₹400 (2× bearing, 492001) · `MD-RPR-2026-HXDGD3-1` online paid ₹2,040 (12× bearing, 492001) · `MD-RPR-2026-W45ZKY-1` online paid ₹4,840 (10× Advance AX7 10W30 1 L, 492007) · `MD-RPR-2026-9AHZTD-1` **COD** ₹5,760 (12× 3100 4T 10W30 1 L, 492001; placed before the COD rule). Payments: `pay_…`, captured 11-16 (test or live: Q-DC-2). |
| G0-F7  | Stock at Sharma Auto Parts: bearing 12, AX7 12, 3100 4T 12 (Raipur Battery Point: bearing 3). **Sequence matters:** ZYJF5E (1) + B1195T (2) = 3 bearings, HXDGD3 needs 12 → route HXDGD3 to Sharma only if stock is still ≥ 12 (otherwise skip, or use it as the "shop not eligible / out of stock" negative). Routing reserves stock again (expired holds).                                                                                                                                                                                                                                                                |
| G0-F8  | Ustaad (for the COD Ustaad route): 03 **Bada, verified**; 04 **Master, verified**; 09 **Pakka, verified**; 08 **Naya, verified**; 06, 07 apprentice unverified; **02 `banned`** (negative case); 01, 05, 10 not members.                                                                                                                                                                                                                                                                                                                                                                                                    |
| G0-F9  | Notifications: WhatsApp templates enabled + Meta-approved for `order.confirmed`, `order.out_for_delivery`, `order.rejected`, `order.routed` (en + hi), plus quote/service/ticket ones. Template status synced. One WhatsApp ever sent (11-23, `order.rejected`, not to the test range). No `delivery.*` WhatsApp template rows (so the invite and offer send no WhatsApp). Email outbox: 9 sent in the last 24 h.                                                                                                                                                                                                           |
| G0-F10 | Code facts: `deliveryModeFor` → agents only for **online** sub-orders of an `agents` shop with the city switch on; `routeOrder` needs a paid or COD order and an eligible shop (stock + PIN); `offerJob` refuses when the switch is off (`AGENTS_DISABLED`); `acceptAgentInvite` has **no conflicting-role check** (a mechanic/customer can also be an agent); refunds always wait for approval.                                                                                                                                                                                                                            |

**Gate 0 checks for the lead (before any write; each logged in `logs/gate0.md`):**

| Id    | Check                                                                                                                                                                                                                                                                                          | Pass rule                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| G0-1  | Live SHA/digest (Actions run + `docker ps` image on the server, read-only) contains delivery web + COD; `/partners/apply/delivery_agent`, `/partner/delivery`, `/admin/delivery`, Account → Payments answer 200 (signed out: apply page; others: sign-in redirect)                             | yes, else stop                                              |
| G0-2  | Q-DC-1 … Q-DC-7 answered (or defaults accepted) by the founder through the lead                                                                                                                                                                                                                | written in `logs/gate0.md`                                  |
| G0-3  | Sign-in method still works (Ustaad G0 method: `ctx.route('https://challenges.cloudflare.com/**')` → `logs/_tools/ts-stub.js`, then the real form; staff two-step test code). Bypass end time read from `BYPASS_ON`                                                                             | sign-in of 05 works; plan 16:45 cut-off holds               |
| G0-4  | Permissions seeded: read-only query `role_permissions` ⨝ `permissions` (column names from `packages/db/src/schema/identity.ts`) shows `customers:cod_approve`, `delivery_agents:manage`, `delivery_jobs:assign`, `delivery_payouts:manage` on super_admin (ALL) / ops / city_manager / finance | present (recon query errored on a column name; re-run)      |
| G0-5  | Re-run the recon queries (`logs/_tools/recon*.mjs`, copied from the planning scratchpad): G0-F3 … F7 unchanged (no new shops, orders, applications, settings rows)                                                                                                                             | unchanged; any new non-test order or shop → re-plan         |
| G0-6  | Test accounts' emails all go to the founder's test inbox (compare domains/plus-addresses in the local file; never print)                                                                                                                                                                       | yes, else mark that account "no email steps"                |
| G0-7  | One account holding both `mechanic` and (later) `delivery_agent`: check what `/partner/delivery` and the account menu show with two partner roles (after A3, first rider)                                                                                                                      | logged; a broken portal chooser is a finding, not a blocker |
| G0-8  | Shop 02's view: Sharma Auto Parts shows the "Who delivers your orders" card (agents switch on) and order list empty of real orders                                                                                                                                                             | logged                                                      |
| G0-9  | Customer notification preferences (Account → Notifications) for 01/03/04: which order emails can be turned off (Q-DC-6)                                                                                                                                                                        | logged; decides the email plan                              |
| G0-10 | Fake document images generated (§ 2.5) and checked by eye: no real names, no real number formats                                                                                                                                                                                               | yes                                                         |

### 2.1 Cast (accounts → roles for this run)

| Account | Role in this run                                                                                                                   | Device / locale / theme       | Why this account                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| 05      | **L**: super admin: COD decisions, applications, invites, documents, agent status, routing, dispatch, overrides, payouts, settings | desktop 1440, en, light       | only staff with every permission (G0-F2)                                                              |
| 10      | community manager RPR: **negative** staff (no `customers:cod_approve`, no `delivery_*`)                                            | desktop 1440, en, dark        | role-leak checks; ops/finance splits are cited from `apps/api/test/delivery.test.ts` (no role grants) |
| 01      | **customer**: owns the 4 prepaid orders + the COD order; COD request / reject / re-apply / approve / revoke; rates riders          | phone 390, en, light          | the only non-member customer (COD by request)                                                         |
| 02      | **shop owner** of Sharma Auto Parts (agents mode) and Raipur Battery Point (stays self; mode request rejected)                     | desktop 1440, en, light + 390 | owns both test shops; Ustaad-banned → COD negative                                                    |
| 03      | **COD via Ustaad** (Bada): new COD order, Hindi                                                                                    | phone 390, hi, dark           | verified member                                                                                       |
| 04      | **COD via Ustaad** (Master) + workshop owner: role-leak (workshop sees no delivery)                                                | desktop 1440, en, light       | verified member                                                                                       |
| 06      | **rider A** "Raju", motorcycle, Hindi                                                                                              | phone 390, hi, light          | apprentice mechanic, unverified (no COD conflict)                                                     |
| 07      | **rider B** "Sonu", three-wheeler, English                                                                                         | phone 390, en, dark           | as above                                                                                              |
| 08      | **applicant rejected** (never invited); COD eligible as Naya (eligibility display check)                                           | phone 360, hi, light          | spare                                                                                                 |
| 09      | spare (COD Pakka check, second customer if 01 is blocked)                                                                          | —                             | spare                                                                                                 |

### 2.2 Sign-in (all before 16:45 IST; Q-DC-4)

Same method as the Ustaad run (`D:\mechdost-qa\ustaad-sim-2026-11-27\logs\gate0.md` 12:40): stub
`challenges.cloudflare.com` in the account's context, then the real form, `POST /v1/auth/password`, and the staff
two-step code for 05/10. Save `storageState` per account to `logs/_profiles/<acct>.json`. At 16:45 L checks that every
account in § 2.1 has a fresh session. After 16:57, a lost session for that account = that actor's remaining steps
are DEFERRED (logged), never solved by clicking a challenge.

### 2.3 Emails

Only to the accounts' own (test-inbox) addresses. The invite **with** email is sent once (A2a, rider A's account
email). Rider B's invite has no email (A2b). Every email is checked in the inbox (subject, en/hi, link target, no
token in the subject, no phone) and counted.

### 2.4 Settings ledger (before/after, restore order)

Recorded in `logs/settings-ledger.md` (same columns as the Ustaad run). Before = "**no row (registry default X)**"
(G0-F4). Restoring leaves a row holding the default, which is fine and noted. Every change and restore is read back
after a page reload.

| Row    | Key / item (scope)                                                                                              | Before       | Run value           | When                                           | Why                                | Restore (order)                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------ | ------------------- | ---------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| L1     | `delivery.agents_enabled` (RPR)                                                                                 | no row (off) | **on**              | Gate 1, after Q-DC-3 is done                   | dispatch needs it                  | **R7 (last)**                                                              |
| L2     | `delivery.offer_timeout_min` (RPR)                                                                              | no row (15)  | **2**               | after D1-6 (one offer seen at 15:00 countdown) | see an expiry inside the run       | R4                                                                         |
| L3     | `delivery.low_rating_min_count` (RPR)                                                                           | no row (5)   | **1**               | before D2-9                                    | low-rating staff alert reachable   | R4                                                                         |
| L4     | `delivery.max_active_jobs` (RPR)                                                                                | no row (3)   | **1** for D5-3 only | D5-3, restored at D5-4                         | the "holds too many jobs" refusal  | R4 (immediate)                                                             |
| L5     | `checkout.cod_request_reapply_days` (GLOBAL only)                                                               | no row (7)   | **0**               | after C2-4 (7-day wait seen)                   | re-request in the run              | R5                                                                         |
| L6     | `checkout.cod_min_items` (RPR)                                                                                  | no row (1)   | **2** for C4-4 only | C4-4, restored at C4-5                         | cart reason `below_min_items` live | R5 (immediate)                                                             |
| L7     | Shop mode of **Sharma Auto Parts** (data, via S1 approve)                                                       | `self`       | `agents`            | S1                                             | agent orders                       | R6: staff set `self` directly (reason "QA run end")                        |
| L8     | Riders 06/07 online flag + status (data)                                                                        | none         | online / active     | A4                                             | dispatch                           | R3: offline; status left `active` (founder decides offboarding at cleanup) |
| L9–L12 | WhatsApp templates `order.confirmed`, `order.out_for_delivery`, `order.rejected`, `order.routed` (en + hi rows) | enabled      | **disabled**        | **Gate 1, first** (Q-DC-3)                     | F3                                 | **R8 (after L1 off)**                                                      |
| —      | `checkout.cod_everyone`                                                                                         | no row (off) | **unchanged**       | —                                              | F8 / Q-DC-5                        | —                                                                          |

**Restore order (§ 9.3):** R1 every delivery job terminal (delivered / returned / cancelled), checked in Admin →
Delivery → Jobs (all queues empty but Done) → R2 every open offer gone → R3 riders offline → R4 L2/L3/L4 → R5 L5/L6
→ R6 Sharma back to `self` → R7 L1 off → R8 WhatsApp templates on again → R9 re-read every row after reload, and
re-run the recon script: `delivery_mode = 'agent'` appears **only** on the run's order codes.

### 2.5 Test assets (generated locally, `D:\…\delivery-cod-sim-2026-11-27\assets\`)

- `doc-pan-A.jpg`, `doc-dl-A.jpg`, `doc-rc-A.jpg` (rider A) and `-B` (rider B): 1200×750 grey card, diagonal red
  "TEST DOCUMENT — NOT VALID", "MechDost QA 2026-11-27", no photo of a face, no emblem. Generated with Playwright
  `page.screenshot` of a local HTML file (no EXIF, no location).
- Numbers (fit the regexes in `packages/shared/src/delivery/codes.ts`; impossible as real ids): rider A PAN
  `ZZZZZ9999Z`, licence `ZZ00TEST0000001`, RC `ZZ00ZZ0001`; rider B PAN `ZZZZZ9998Z`, licence `ZZ00TEST0000002`, RC
  `ZZ00ZZ0002`. Negative: `000000000000` (12 digits → `DOCUMENT_AADHAAR`, never stored); rider B typing rider A's
  PAN → `DOCUMENT_IN_USE`; `ABC` → `DOCUMENT_FORMAT`.
- Parcel/handover photos: `parcel-test.jpg` ("TEST PARCEL — QA"), `door-test.jpg`, `fail-test.jpg`. Upload through
  the camera input with Playwright `setInputFiles` (the page re-encodes them; check that EXIF is gone, § 7.6).

### 2.6 Step modes

UI (default) · **API-assisted** (the account's own signed session, only where the UI has no control; logged as GAP)
· **DB-read** (read-only verification query) · **CITE** (not reachable live; points to the owning automated test).

---

## 3. Chains (step id · actor · action · expected result · other actors' checks)

Notation: `→ check` = verify on another actor's screen within one poll cycle (offers 10 s, lists 15–20 s). Every
step: screenshot `screenshots/<chain>/<step>-<acct>.jpg`, a log line with the video time.

### C1: COD request → approve → order → revoke (01, 05, 10)

| Step  | Actor | Action                                                                                                               | Expected                                                                                                                                            |
| ----- | ----- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1-1  | 01    | Cart with 1× wheel bearing (PIN 492001) → checkout                                                                   | COD option **disabled** with the reason in words (`not_approved`) and **one** action "Request cash on delivery"; "Pay online" is never clicked (F1) |
| C1-2  | 01    | Open the request panel (lazy) → reason `no_upi_or_card` + note → send                                                | `pending`; Account → Payments shows "Request pending"; checkout reason becomes `request_pending`; bell notice                                       |
| C1-3  | 01    | Send a second request (UI or API-assisted)                                                                           | refused (one pending per customer, partial unique), with plain words                                                                                |
| C1-4  | 10    | Open `/admin` → Customers → COD requests                                                                             | **hidden or 403/404** (CM has no `customers:cod_approve`): role leak if visible                                                                     |
| C1-5  | 05    | Admin → Customers → COD requests → open 01's request → **Approve** with personal cap ₹1,000 and an end date tomorrow | approved; `cod_request_events` row (DB-read); audit row; **email 1** (approve) en; bell notice to 01                                                |
| C1-6  | 01    | Reload checkout                                                                                                      | COD enabled `via approved`; cap shown; a cart over ₹1,000 shows the cap reason (lower of personal and city cap)                                     |
| C1-7  | 01    | Place a **COD** order of 1× bearing (₹180 + ₹40 shipping) — order **O-C1**                                           | placed, `cod_pending`; order page in en; order code `MD-RPR-…-1`                                                                                    |
| C1-8  | 05    | Route O-C1 **by hand** to Sharma Auto Parts (after S1, so the shop is in agents mode)                                | DB-read: `orders.delivery_mode = shop` (**COD stays with the shop**, even with agents on) → feeds C5                                                |
| C1-9  | 05    | Revoke 01's approval, reason `customer_request`                                                                      | `revoked`; **email 2**; checkout reason `revoked`; "Request again" shows the date (reapply 7 days, L5 not yet changed)                              |
| C1-10 | 01    | Account → Payments in **hi**                                                                                         | all text Hindi (allowlist: ₹, codes); no English reason codes                                                                                       |

### C2: Reject → re-apply wait → re-request → withdraw (01 or 07, 05)

| Step | Actor | Action                                                              | Expected                                                                           |
| ---- | ----- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| C2-1 | 07    | Checkout → request COD (`regular_buyer`)                            | pending                                                                            |
| C2-2 | 05    | Reject with `insufficient_history`, note                            | `rejected`; **email 3**; customer sees the reason in plain words, no code          |
| C2-3 | 07    | Checkout / Account → Payments                                       | reason `rejected`, "You can ask again on {date}" (+7 days, IST), no request button |
| C2-4 | 07    | API-assisted re-request now                                         | refused with the wait reason (cooldown enforced in the API, not only the UI)       |
| C2-5 | 05    | Set **L5** reapply days 7 → 0 (global; ledger)                      | saved; warning that it is global                                                   |
| C2-6 | 07    | Request again → **withdraw**                                        | `pending` → `withdrawn` (customer only); staff queue no longer lists it            |
| C2-7 | 05    | Try to approve the withdrawn request (stale tab opened before C2-6) | refused (state/version), message in words                                          |

### C3: Eligibility through verified Ustaad (03, 04, 08, 02)

| Step | Actor | Action                                                       | Expected                                                                                                                                                                             |
| ---- | ----- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C3-1 | 03    | `/hi` checkout, 1× bearing, PIN 492001                       | COD **enabled** `via ustaad`, no request panel, Hindi                                                                                                                                |
| C3-2 | 03    | Place a COD order — **O-C3**                                 | placed; feeds C5/C6                                                                                                                                                                  |
| C3-3 | 04    | Checkout (en)                                                | COD enabled via Ustaad (Master)                                                                                                                                                      |
| C3-4 | 08    | Checkout (hi, 360)                                           | enabled (Naya counts: min level 0)                                                                                                                                                   |
| C3-5 | 02    | Checkout as a shop owner (Ustaad `banned`)                   | not enabled, reason `ustaad_not_verified` **or** the request option (the code's order: approval route first); a shop owner blocked from buying is also a valid outcome; record which |
| C3-6 | 05    | Settings → Checkout → open `cod_ustaad_min_level`; read only | value 0; the ON behaviour of higher levels is CITE (`cod-eligibility` unit tests)                                                                                                    |

### C4: Checkout rules on top (01 re-approved, 05)

C4-1 05 approves a fresh request of 01 (after L5 = 0, 01 re-requests) → C4-2 01 cart total above the personal
cap → reason "over the cash limit" → C4-3 below the cap → enabled → C4-4 05 sets **L6** `cod_min_items` 1 → 2 →
01 with 1 item sees `below_min_items` in words → C4-5 05 restores L6 to 1 → enabled again. C4-6 **"Everyone"
switch**: 05 opens it, reads the risk warning, **cancels** (F8). Screenshot of the warning in en + hi.

### C5: COD stays with the shop while agents are on (02, 05, 01, 03)

| Step | Actor | Action                                                                                                                                    | Expected                                                                                                                                        |
| ---- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| C5-1 | 05    | Route **9AHZTD** (old COD, ₹5,760) by hand to Sharma Auto Parts (agents mode)                                                             | DB-read `delivery_mode = shop`                                                                                                                  |
| C5-2 | 02    | Accept → Packed                                                                                                                           | the card shows **"Out for delivery"** (shop delivers), **no "Mark ready for pickup"**; WhatsApp none (templates off); bell notice to 01         |
| C5-3 | 02    | API-assisted `advance` step `ready_for_pickup` on 9AHZTD                                                                                  | refused (COD refused, spec 24 § 4.6)                                                                                                            |
| C5-4 | 02    | Out for delivery → deliver with 01's **delivery code** (typed from 01's order page; F9)                                                   | delivered, `cod_collected` (or the shop's COD collection step as built); 01 sees delivered; **no** rate-your-rider prompt (not agent-delivered) |
| C5-5 | 05/02 | O-C1 and O-C3: one delivered the same way (O-C3), one **rejected at routing** by 05 with a customer message (O-C1, before C1-8 if needed) | rejected COD order: **no refund row** (`method !== online`), customer sees "not charged" wording; check the text                                |

### A1: Rider applications (public form) (06, 07, 08, anonymous)

| Step | Actor             | Action                                                                                  | Expected                                                                                                           |
| ---- | ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A1-1 | anon              | `/partners` → "Deliver with MechDost" card → `/partners/apply/delivery_agent` (en, 390) | form: name, mobile, city (Raipur), vehicle radios, consent; **no** pay/insurance/uniform words; no document fields |
| A1-2 | anon (06's phone) | Submit (name "Raju QA", motorcycle). Before 16:45                                       | `PA-RPR-…` reference; status link. Turnstile: if refused → finding + A2b path (Q-DC-4)                             |
| A1-3 | anon (07's phone) | Submit (Sonu QA, three-wheeler) in **hi**                                               | as above, Hindi                                                                                                    |
| A1-4 | anon (08's phone) | Submit (Imran QA, scooter)                                                              | as above                                                                                                           |
| A1-5 | anon              | 4th submission with 06's phone (same day)                                               | per-phone limit (3/day) **or** duplicate refusal; words, not a code                                                |
| A1-6 | anon              | `/partners/status` with each `PA-…`                                                     | recognised as delivery-agent applications (G3)                                                                     |
| A1-7 | 05                | Bell: `staff.delivery_agent_application` ×3; Admin → Delivery → Applications            | 3 rows, phone masked, vehicle, city                                                                                |

### A2: Review → invite (05)

A2-1 05 rejects 08's application with a partner reason + note (sends the row `version`) → 08's status page shows
"not accepted" in words. A2-2 stale tab: reject again → refused. **A2a** 05 invites from 06's application **with**
06's account email → the one-time link is shown once with Copy (screenshot with the token blurred), "invite sent" copy
says the email has the link and the WhatsApp message has none → **email 4** arrives, and its link goes to
`/partners/delivery-invite/…`. **A2b** 05 invites 07 from the application **without** email (or "invite someone who
did not apply" if A1 failed) → link shown once, copied into `_secrets.local.json`. A2-3 a second invite for 06's
phone while one is open → `INVITE_OPEN`. A2-4 05 invites a made-up number in the test range (09's phone) then
**revokes** it → invites list shows revoked; opening its link → "withdrawn".

### A3: Rider join (06, 07, 02)

| Step | Actor | Action                                                                             | Expected                                                                                                                             |
| ---- | ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A3-1 | anon  | Open 06's invite link signed out                                                   | name, city, vehicle, mobile **last 4 only**, expiry; noindex; "sign in to accept"; no token in the analytics event or the page title |
| A3-2 | 02    | Open 06's link **signed in as 02**                                                 | `INVITE_PHONE_MISMATCH` in words; no data of 06 beyond the preview                                                                   |
| A3-3 | 06    | Sign in (saved session) → Accept invite                                            | agent `onboarding`, role `delivery_agent`; lands on "Upload documents"; mechanic role intact (G0-7)                                  |
| A3-4 | 06    | Open the same link again                                                           | "already used"                                                                                                                       |
| A3-5 | 07    | Accept own invite (hi)                                                             | onboarding, Hindi portal                                                                                                             |
| A3-6 | 06    | Portal frame: status strip, Help button (support number), **Take new jobs** switch | switch disabled with "documents waiting" in words (not active)                                                                       |

### A4: Documents → verify/reject → active → online (06, 07, 05)

| Step  | Actor | Action                                                      | Expected                                                                                                                    |
| ----- | ----- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A4-1  | 06    | Profile → PAN `000000000000`                                | refused, Aadhaar wording (`DOCUMENT_AADHAAR`)                                                                               |
| A4-2  | 06    | PAN `ABC`                                                   | `DOCUMENT_FORMAT`                                                                                                           |
| A4-3  | 06    | Upload PAN/DL/RC (§ 2.5 A set)                              | each `submitted`; last 4 shown; staff bell `staff.delivery_documents`                                                       |
| A4-4  | 07    | PAN = rider A's PAN                                         | `DOCUMENT_IN_USE`                                                                                                           |
| A4-5  | 07    | Upload the B set                                            | submitted                                                                                                                   |
| A4-6  | 05    | Agents → 06 → **View** each document (audited)              | image opens via a staff-only signed URL; audit/job event recorded (DB-read count); the URL opened in 06's browser → 403/404 |
| A4-7  | 05    | Reject 06's RC with a reason                                | 06 sees "not accepted" + reason; notice `delivery.document_decided`                                                         |
| A4-8  | 05    | Try to set 06 `active`                                      | `DOCUMENTS_NOT_VERIFIED`                                                                                                    |
| A4-9  | 06    | Replace RC (A set `doc-rc-A.jpg`, same number)              | `submitted` again                                                                                                           |
| A4-10 | 05    | Verify all 3 of 06 and of 07 → set both **active** (reason) | active; history row                                                                                                         |
| A4-11 | 06/07 | Take new jobs → **online**                                  | switch on; `delivery_online_toggled` event                                                                                  |

### S1: Shop delivery mode (02, 05)

S1-1 02 on Sharma Auto Parts: "Who delivers your orders" = self → request **agents** (reason code) → pending; a
second request → refused (one pending). S1-2 05 bell `staff.shop_delivery_mode_request` → Admin → Delivery → Shop
requests → **approve** → 02 notice `shop.delivery_mode_decided`, card says agents. S1-3 02 on Raipur Battery Point
requests agents → 05 **rejects** with a reason → stays self (ledger: no restore needed). S1-4 02 requests and then
**withdraws** a request on Raipur Battery Point. S1-5 10 opens Shop requests → hidden/403.

### D1: Happy path (prepaid ZYJF5E, ₹220, 1 bearing; 05, 02, 06, 07, 01)

| Step  | Actor | Action                                                                                                   | Expected                                                                                                                                                                                                   |
| ----- | ----- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1-1  | 05    | Routing queue → ZYJF5E → suggestions → route **by hand** to Sharma Auto Parts                            | DB-read `delivery_mode = agent`; shop timer starts                                                                                                                                                         |
| D1-2  | 02    | Accept → **Packed**                                                                                      | card offers **Mark ready for pickup** (not "Out for delivery"); 01's page: confirmed. **No WhatsApp row** (L9)                                                                                             |
| D1-3  | 02    | Mark ready for pickup                                                                                    | "Finding a delivery partner" + 4-digit **pickup code** ("tell it only at handover"); job `needs_agent`; staff bell `staff.delivery_needs_agent`                                                            |
| D1-4  | 05    | Delivery → Jobs → Needs an agent → Open                                                                  | ranked suggestions 06, 07 (online, docs verified, vehicle fits, distance, rating weight); Late chip after 15 min                                                                                           |
| D1-5  | 05    | Offer to **07**                                                                                          | 07's Offers: countdown from **15:00** (default; screenshot) with area/PIN only, items, load; `delivery_offer` email if 07 had email on the invite (none, A2b)                                              |
| D1-6  | 07    | **Decline** (`too_far` or the listed reason; `other` needs a note)                                       | job back to `needs_agent`; staff notice `staff.delivery_declined`. **Then L sets L2 = 2 min**                                                                                                              |
| D1-7  | 05    | Offer to 07 again → 07 does nothing for 2 min                                                            | the worker expires it within 30 s after the deadline; `staff.delivery_offer_expired`; 07's card disappears                                                                                                 |
| D1-8  | 05    | Offer to **06** → 06 accepts                                                                             | job `accepted`; 06 sees **shop** name, address, phone, but **customer area + PIN only**; 02: "{first name} (motorcycle) is coming to pick it up"; 01: "{name} will pick up your order" (no phone, no shop) |
| D1-9  | 07    | Accept the stale offer (tab open from D1-7)                                                              | 409 in words ("taken or expired")                                                                                                                                                                          |
| D1-10 | 06    | I'm at the shop → pickup code **wrong** ×2                                                               | "tries left 3, 2"                                                                                                                                                                                          |
| D1-11 | 06    | Right code + parcel photo → **Confirm pickup**                                                           | job `picked_up`, order `out_for_delivery`; 06 now sees customer name/address/phone (audited `delivery_contact_revealed`); 01: "Picked up by {name} (motorcycle)" + delivery code; 02: "Picked up by …"     |
| D1-12 | 06    | I'm at the customer → delivery code wrong ×1 → right (from 01's page) + photo → **Delivered**            | job + order `delivered` in one go; 01: delivered + **Rate your delivery**; 06 History shows codes only, no contact                                                                                         |
| D1-13 | 01    | Rate 5★ `on_time`, `polite` → edit to 4★ within 24 h (version)                                           | saved; second edit with a stale tab → refused; 06 sees only average and count, never who rated                                                                                                             |
| D1-14 | 05    | Payouts → record ₹50 UPI, period today, reference `QA-TEST-1` (paise check: 5000)                        | row; 06's Earnings shows it (no staff note, no recorder name); delivered count 1                                                                                                                           |
| D1-15 | 05    | Submit the same form again (network retry: Playwright replays the request with the same idempotency key) | **one** row (idempotent)                                                                                                                                                                                   |
| D1-16 | 05    | **Correct this payout** (note) → second correction                                                       | one reversing row; 06 sees a minus line; a second correction refused (`reverses_id` unique); CSV download contains both rows                                                                               |

### D2: Failure → retry same rider → second failure → return → returned (prepaid B1195T, ₹400; 05, 02, 06, 01)

D2-1 05 routes B1195T to Sharma → 02 accepts, packs, ready for pickup → 05 offers 06 → 06 accepts, picks up (code +
photo). D2-2 06 **Couldn't deliver** `customer_unreachable` + photo → `failed`; 01 sees the failed try with its
reason; staff bell `staff.delivery_failed`. D2-3 05 **retry same agent** → `picked_up` again (attempt 2 of 2). D2-4
06 fails again with `customer_refused`. D2-5 05: retry no longer offered (`retryAllowed` false; max attempts 2) →
**send back to the shop** → `returning`; 06 sees the shop only + a 4-digit **return code**; 02 sees "Parcel coming
back" with a code box. D2-6 02 types a wrong return code ×1, then the right one → job `returned`, order `returned`
(reason = last failure), stock back to the shop (DB-read on_hand). D2-7 **Refund check (read only, F4):** DB-read
`refunds` row source `delivery_returned`, status `requested`, amount = **parts only** (₹400 − ₹40 shipping = ₹360,
refused on the retry = customer's fault, spec 24 § 13); 01's page: "Returned, refund on its way" with parts-only
wording (gap note: the API block has no refund kind → generic wording is the known state, spec 24 § 16). **Nobody
approves it.** D2-8 01's page for B1195T shows **no** rating form (not delivered). 05 sets **L3** = 1 here, ready
for the low-rating alert in D4-8.

### D3: Switch to the shop + give up + another rider (prepaid HXDGD3, ₹2,040, 12 bearings, only if stock ≥ 12, G0-F7; else W45ZKY)

D3-1 route → accept → packed → ready for pickup → 05 offers 07 → 07 accepts → 07 **I can't do this job**
(`vehicle_issue`) → job back to `needs_agent`, staff notice. D3-2 05 "Ask the shop to deliver" (reason) → 02 sees
"Can you deliver this order yourself?" → **We can't** (reason) → staff notice `staff.delivery_switch_declined`. D3-3
05 asks again → 02 **Yes** → job `cancelled`, order back to `packed`, mode → shop → 02 delivers itself with 01's
delivery code (shop path). D3-4 a second open switch request on the same order → refused (one open per order).

### D4: Standing, locked codes, overrides (prepaid W45ZKY, ₹4,840, 10× oil ≈ 9 kg; 05, 02, 06, 07, 01)

| Step  | Actor | Action                                                                                                                                                                         | Expected                                                                                                                                               |
| ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D4-1  | 05    | Route → 02 accepts, packs, ready → offer 06 → 06 accepts                                                                                                                       | accepted                                                                                                                                               |
| D4-2  | 05    | **Pause** 06 (reason, end date tomorrow)                                                                                                                                       | accepted job back to the queue; open offers withdrawn; `staff.delivery_agent_unavailable`; 06 sees paused reason, switch off, `delivery.job_withdrawn` |
| D4-3  | 05    | Offer to 06 while paused                                                                                                                                                       | 06 not in the suggestions / `AGENT_NOT_ELIGIBLE`                                                                                                       |
| D4-4  | 05    | Offer to 07 → 07 accepts → pickup code wrong **×5**                                                                                                                            | pickup **locked**; 07 told support takes over; job detail `pickupLocked` true                                                                          |
| D4-5  | 05    | **Override pickup** (reason ≥ 5 chars)                                                                                                                                         | audited; job `picked_up`; event actor staff                                                                                                            |
| D4-6  | 05    | **Suspend** 07 while holding the picked-up parcel                                                                                                                              | 07 can no longer deliver/fail (spec 24 § 5); held job gets `agent_unavailable`; staff notice; 07 sees "suspended" in words                             |
| D4-7  | 05    | Override **deliver** (reason; customer code read by 01 aloud = typed by L from `_secrets`)                                                                                     | delivered, audited; 01 sees delivered                                                                                                                  |
| D4-8  | 01    | Rate 1★ `late`, `rude` (L3 = 1 already)                                                                                                                                        | staff `staff.delivery_low_rating` alert once; a second low rating does not alert again (once)                                                          |
| D4-9  | 05    | Resume 06 (active), restore 07 to active                                                                                                                                       | history rows; both can go online again                                                                                                                 |
| D4-10 | 05    | **L4** max active jobs = 1 is not reachable without a 5th prepaid order → **CITE** `packages/db/test/delivery-agents.test.ts`; L4 stays unchanged unless a spare order remains | —                                                                                                                                                      |

### D5: Agents switched off with an open job (F11 rehearsal on purpose, then fixed)

Only if a prepaid order is left (otherwise CITE). With a job `needs_agent`, 05 sets L1 off → offering refused
`AGENTS_DISABLED` → 05 "Ask the shop to deliver" → 02 Yes → job cancelled → L1 back on (or proceed to restore).

### R: Role leaks and privacy (all; agent P with each session)

| Id    | Actor       | Check                                                                                                            | Expected                                                                                    |
| ----- | ----------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| RL-1  | 07          | `/partner/delivery/jobs/{06's job id}` and `GET /v1/agent/jobs/{id}`                                             | 404 "not available to you"                                                                  |
| RL-2  | 06          | Offers list never shows 07's offers; History shows codes only after delivery                                     | as spec 24 § 6                                                                              |
| RL-3  | 01          | Order JSON (`/v1/me/orders/{code}`) for an agent order                                                           | rider first name + vehicle only; **no** rider phone, **no** shop name/phone                 |
| RL-4  | 02          | Shop order JSON                                                                                                  | own orders only; rider first name + vehicle; no rider phone unless the spec allows (record) |
| RL-5  | 04          | `/partner/delivery`, `/admin/delivery`, `/v1/agent/me`                                                           | 403/redirect; workshop portal has no delivery items                                         |
| RL-6  | 10          | `/admin/delivery`, COD requests, `/v1/admin/delivery/payouts`, `payouts.csv`                                     | hidden + 403/404                                                                            |
| RL-7  | 01          | `/v1/delivery-photos/{id}/{variant}` from a D1 photo id                                                          | 403/404 (staff-only signed URLs)                                                            |
| RL-8  | anon        | Invite link page: referrer and analytics carry no token (network log); `/partners/delivery-invite/x` → not found | as spec                                                                                     |
| RL-9  | 06 (paused) | Accept/pickup API calls                                                                                          | `AGENT_NOT_ACTIVE`                                                                          |
| RL-10 | 01          | COD admin routes `/v1/admin/cod-requests`                                                                        | 403                                                                                         |

### C-N: Notifications sweep (all; L tallies)

For every notice kind in spec 24 § 10 and the COD notices: a bell row exists for the right actor only, the link opens
the right screen (no 404; Ustaad run found dead links), en/hi text, and no phone or code in the text. Emails ≤ 10;
WhatsApp rows = 0.

### C-CLOCK: deadlines not driven live (CITE)

Invite expiry 72 h (min 24) → `delivery-agents.test.ts`; rating edit window 24 h → `delivery-ratings` tests; paused
agent auto-resume (worker) → db tests; COD approval `expired` → `cod-requests` tests; offer expiry is driven live
(L2 = 2).

---

## 4. Render matrix (agent R, Playwright, screenshots, no video)

Routes: `/partners` (card), `/partners/apply/delivery_agent` (+ confirmation), `/partners/status`,
`/partners/delivery-invite/{token}` (signed out/in, expired, used, revoked), `/partner/delivery` (Offers empty +
with offer, My jobs, History, Profile with documents + earnings, onboarding/paused/suspended frames), job page steps
1–4 + failed + returning + finished, shop order card states (packed, ready for pickup + code, assigned, picked up,
coming back, switch question), shop "Who delivers" card, customer order page states (finding, will pick up, picked
up, failed try, returned, delivered + rating), checkout COD states (disabled per reason, request panel, enabled
via approved/ustaad, cap/min reasons), Account → Payments (none/pending/approved/rejected/revoked), admin Delivery
tabs (Jobs queues + detail + timeline, Applications, Agents + detail, Payouts, Shop requests, Settings), Admin →
Customers → COD requests (queue, decide dialogs, Everyone warning).

Cells: {en, hi} × {390, 768, 1440} × {light, dark} = 12 per route state; states reached in the chains are captured
when they occur (R follows L's log), others from the browser demo **only for layout** (labelled DEMO).

Checks per cell: no horizontal scroll; tab bar under 1024 px; one primary action; every opened panel closable (R1);
countdown readable; codes in large digits; the Hindi crawl (no English outside the allowlist); console errors 0;
CLS < 0.05 on the rider pages; contrast AA in both themes (dark found misses in Ustaad).

## 5. Audit checklists (agent R; findings with screenshot, route, cell, severity, proposal)

- **Design:** tokens only, Manrope/DM Sans, navy status strip, calm screens; rider flow usable one-handed outdoors
  (tap targets ≥ 44 px, high-contrast codes).
- **UX writing:** plain en + Hindi; reasons in words; no "COD" jargon for customers without explanation; no pay,
  insurance or uniform promises (founder ruling).
- **Accessibility (WCAG 2.2 AA):** axe per route; keyboard through the decline dialog, code inputs (`inputmode`,
  labels, error announced), stars as native radios, countdown not spamming live regions.
- **Performance:** rider Offers page LCP/INP on a slow 4G profile; the delivery client is loaded with `import()`
  (check that Zod is not in first load); JS of `/checkout` with the COD panel lazy.
- **Security/privacy:** contact reveal by stage; photos without EXIF (download a pickup photo as staff, check with
  exiftool); invite token not in logs, analytics or referrer; masked phones in admin lists; audit rows for document
  views and overrides.
- **Analytics:** each typed event of `packages/shared/src/delivery/client-events.ts` fires once (offer viewed once
  per offer, not per poll), with codes/booleans only, no text; server events `delivery_*`, `shop_delivery_mode_*`,
  `cod_*` rows (DB-read counts per run step).
- **Data integrity:** versions bump on every move; one active job per order; one open offer per job; append-only
  events (counts only grow).

## 6. Team, order, timing (≈ 15:30–18:30 IST)

| Agent | Who                                   | Does                                                                                          |
| ----- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| **L** | conductor + staff (05, 10)            | Gate 0–2, ledger, every staff step, budgets, kill switch, DB-read checks, restore, the report |
| **P** | personas (01, 02, 03, 04, 06, 07, 08) | customer, shop and rider steps, one recording browser context per actor in turn               |
| **R** | render + audit                        | § 4 + § 5 from L's log; no writes except its own screenshots                                  |

| Time (IST)  | Phase                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------- |
| 15:00–15:30 | Gate 0 (G0-1 … G0-10), assets, profiles                                                         |
| 15:30–15:45 | **Gate 1:** L9–L12 WhatsApp templates off → sign in all actors (storageState) → A1 applications |
| 15:45–16:30 | A2–A4, S1 (L1 on right before S1), C1-1…C1-6, C2                                                |
| 16:30–16:45 | **Session check** (Q-DC-4 cut-off 16:45)                                                        |
| 16:45–17:45 | D1, D2, C5, C1-7…C1-10, C3                                                                      |
| 17:45–18:15 | D3, D4, (D5), C4, RL-*, C-N                                                                     |
| 18:15–18:30 | **Restore R1–R9**, budgets closed, final recon run                                              |
| after       | R finishes renders; L writes the report and walkthrough                                         |

Hand-offs: `logs/run-log.jsonl` is the contract (one line per step: time, step id, actor, result, screenshot, video
offset). Codes move only through `logs/_secrets.local.json` (deleted after the run).

## 7. Recording

`D:\mechdost-qa\delivery-cod-sim-2026-11-27\` → `videos/<chain>-<acct>-<locale>-<theme>.webm` (Playwright
`recordVideo`, compressed after) · `screenshots/<chain>/<step>-<acct>.jpg` · `logs/` (run-log.jsonl, gate0.md,
settings-ledger.md, budget.json, bugs.md, ids.json, accounts.local.json, _secrets.local.json) · `walkthrough.html`
(built like the Ustaad one: chains in order, each step with its screenshot, video clip at the offset, expected vs
actual, finding links).

## 8. Bugs and findings

Format as the Ustaad run (`SIM-D<n>` / `SIM-C<n>`): severity, cell, accounts, step, repro, expected/actual,
screenshot, clip. Every real bug is fixed later test-first (website-testing), never hot-patched during the run.
Already known going in: F-R1 (₹1 listing, Q-DC-7); spec 24 § 16 open gaps (no refund kind on the customer block;
application rows without a shared schema); SIM-LEAD-7 (admin Delivery tabs).

## 9. Pause, kill switch, restore

### 9.1 Pause

Any unexpected outward message, any non-test person on screen, any 5xx burst (> 3 in 5 min) → pause all agents,
L investigates (systematic-debugging), log, resume or abort.

### 9.2 Kill switch (L, in this order, ≤ 2 minutes)

1. L1 `delivery.agents_enabled` stays ON until jobs are safe: first set riders offline (Admin → Agents → pause both
   with reason "QA kill switch").
2. Every outbound template that fired: disable it in Admin → Notifications.
3. Tell the lead (founder) with the outbox row ids (no recipient numbers).
4. Continue with § 9.3 restore.

### 9.3 Restore (R1–R9 of § 2.4), verified by reload + the recon script

Expected end state: L1 off; L2–L6 at defaults; Sharma Auto Parts `self`; riders 06/07 `active` but offline (or as
the founder decides); WhatsApp templates back to enabled (exactly the 8 rows that were on); no non-terminal delivery
job; `delivery_mode = 'agent'` only on the run's order codes; 0 WhatsApp rows in the window; emails ≤ 10.

## 10. Cleanup inventory (test content stays; every id in `logs/ids.json`)

| Kind                                      | Ids recorded                                                        | Later cleanup (founder decides)                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Partner applications (delivery)           | 3 `PA-…`                                                            | keep / mark rejected                                                                                 |
| Invites                                   | 3–4 ids (used / revoked)                                            | none needed                                                                                          |
| Delivery agents (06, 07) + role grants    | agent ids                                                           | **offboard** (removes the role) if not kept for later demos                                          |
| Documents + media (6 test images, photos) | document ids, media ids                                             | delete media objects (private bucket) after offboarding                                              |
| Shop mode requests                        | 3 ids                                                               | none (history)                                                                                       |
| Orders routed/delivered/returned          | ZYJF5E, B1195T, HXDGD3, W45ZKY, 9AHZTD + new COD O-C1, O-C3 (+ any) | none (history); **refund request of B1195T stays `requested`: founder decides (cancel, never send)** |
| Delivery jobs, offers, ratings            | ids                                                                 | none                                                                                                 |
| Payouts (₹50 + reversal)                  | ids                                                                 | none (append-only, net 0)                                                                            |
| COD requests (01, 07)                     | ids                                                                 | revoke any approval left at the end (01's from C4)                                                   |
| Addresses created at checkout             | ids                                                                 | delete from the account                                                                              |
| Settings rows created at defaults         | keys                                                                | none (default values)                                                                                |

## 11. Walkthrough (for the founder)

`walkthrough.html` opens with: the safety summary (budgets used, WhatsApp 0, refunds approved 0, settings restored
✓), the top findings (P0/P1), then per chain: COD (C1–C5) → onboarding (A1–A4) → shop mode (S1) → deliveries (D1–D5)
→ role leaks → notifications → render matrix grid (en/hi × widths × themes) → audit lists → what was CITED and why.
The lead walks the founder through it in the order of the questions above.
