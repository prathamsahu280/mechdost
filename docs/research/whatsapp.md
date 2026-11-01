# WhatsApp for MechDost: go direct on Meta's Cloud API, or use a BSP? (2026-11-01)

The owner asked: "For the WhatsApp part, is it better if we just get our own Meta API and use their costing? Research and report back with questions and info."

This is research only. No code and no other docs were changed. The rulings it needs go to `docs/decisions.md` and `docs/questions-for-user.md` (§11, §12). Prices are **before 18% GST**. Exchange rates assumed: ₹88/USD and ₹102/EUR. Facts were checked on 2026-11-01 against Meta's developer docs and the providers' own pricing pages. Rates that only third parties report are marked _(3P)_.

## 1. The answer in brief

- **Yes. Go direct on the Meta WhatsApp Cloud API** for all transactional (utility) messages, ticket replies, partner alerts and, later, OTP. Meta charges every provider the same per-message rate. A direct account pays only that rate, with no markup and no monthly fee. We already have the hard parts: the `notification_outbox`, the pg-boss relay, provider adapters, signed-webhook handling and dedupe. Meta hosts the Cloud API, so there is nothing new to run.
- **Do not buy a team-inbox tool at launch.** Inbound WhatsApp messages should become **support tickets** (spec 09). Agents already answer tickets in the admin console. A reply is sent free-form inside the 24-hour window, and as a "new reply on REQ-…" template outside it. This keeps rule 8 (admin control), the audit log and ML-ready data in our own database.
- **When a BSP is the better choice, honestly.** If the owner wants marketers running no-code broadcasts, a chatbot builder and a shared inbox **before** we build ticket bridging, then **MSG91** (pass-through Meta rates, ₹500/month) or **Interakt** (₹2,799/month, about 11–30% markup per message) is the cheaper way to start. A BSP is also the only practical way to **keep the existing WhatsApp Business app number** (coexistence), because Meta offers coexistence only through Solution Partners and Tech Providers.
- **What it costs at Meta list rates (India):** marketing **₹0.8631**, utility **₹0.1150**, authentication **₹0.1150** and service **₹0.1150** after **1,000 free per number per month**. Messages from users are free. **Since 1 Oct 2026, utility templates and service replies are no longer free inside the 24-hour window.** Our docs still say they are free; see §12.
- **Estimated monthly cost going direct** (transactional plus the assumed marketing, §6): about **₹2.3k at 1k orders, ₹23.6k at 10k and ₹2.37 lakh at 100k.** Marketing is about 73% of that. Transactional messages alone come to about **₹0.6k / ₹6.3k / ₹64k**.
- **Timing to plan for:** marketing sends through the plain Cloud API endpoint are **sunset on 13 Oct 2027**, and accounts created on or after 13 Apr 2027 can never use it for marketing. Promotions must go through the **Marketing Messages API (MM API)**. Build marketing on MM API from day one.

## 2. Option A — the Meta WhatsApp Business Cloud API, direct

### 2.1 Setup, in order

| #   | Step                                                                                                                                                                                                                                                                                                                                         | Who               | Notes                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Meta Business portfolio** (business.facebook.com) for _Shourya Integrated Services Pvt Ltd_, with at least 2 admins                                                                                                                                                                                                                        | Owner             | Must be **our** portfolio, never an agency's or a BSP's (§3.3)                                                                                                                                       |
| 2   | **Business verification**: legal name and address exactly as on the CIN or GST certificate; India accepts the Certificate of Incorporation, GST, Udyam, Shop & Establishment licence, business PAN or a bank statement _(3P)_                                                                                                                | Owner or director | A name or address that differs from the document is the most common rejection reason _(3P)_. Our site footer already shows the operator, GSTIN and registered office (Q15), which helps              |
| 3   | **Meta developer app** (type Business) → add the WhatsApp product → test number and sandbox                                                                                                                                                                                                                                                  | Dev               | The test number can message 5 recipients. Use it for staging                                                                                                                                         |
| 4   | **Business phone number**: it must be able to receive an SMS or voice call. **A number already on WhatsApp cannot be registered until that WhatsApp account is deleted.** Landlines and toll-free numbers are allowed; short codes are not                                                                                                   | Owner             | New portfolios can register 2 numbers, rising to 20 after verification. Enable **two-step verification (PIN)**                                                                                       |
| 5   | **Local storage in India**: set `storage_configuration` to `IN_COUNTRY_STORAGE_ENABLED` with `data_localization_region: IN` **before** registering the number                                                                                                                                                                                | Dev               | Changing it later means deregistering and re-registering the number (§8.4)                                                                                                                           |
| 6   | **Display name** "MechDost": Meta reviews it, and the name must clearly belong to the business                                                                                                                                                                                                                                               | Owner             | The brand differs from the legal name, so the website must show "MechDost by Shourya Integrated Services" (it does)                                                                                  |
| 7   | **System User** in Business settings, with an admin role, assigned to the app and the WABA, and a **permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management` permissions                                                                                                                                      | Dev and owner     | Stored in Secret Manager as `WHATSAPP_ACCESS_TOKEN`. Never use a personal user token: it expires and is tied to one person                                                                           |
| 8   | **Payment method / INR billing**: India accounts can be billed in INR since 1 Jan 2026. **Non-INR accounts must migrate by 31 Dec 2026, or Meta stops delivering their messages from 1 Jan 2027**                                                                                                                                            | Owner (finance)   | Without a payment method, service messages beyond the free tier have not been delivered since 1 Oct 2026                                                                                             |
| 9   | **Webhook**: `GET` handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`), then `POST` events. Verify **`X-Hub-Signature-256`**, the HMAC-SHA256 of the **raw body** with the **app secret**, using a constant-time compare. Subscribe to `messages`, `message_template_status_update`, `template_category_update` and `account_update` | Dev               | Dedupe on `wamid` + status. Meta retries failed deliveries, so the handler must be idempotent. Status updates carry a `pricing` object (category, billable, type), which we store for cost analytics |
| 10  | **Templates**: one per event × language (`en` and `hi`), with category utility, marketing or authentication. Variables are positional or named. Buttons can be URL (dynamic suffix), quick reply or copy-code                                                                                                                                | Dev, then admin   | Meta usually reviews in minutes and can take up to 24 h. Unverified portfolios can hold 250 templates; verified ones up to 6,000                                                                     |

### 2.2 Pricing (per message since 1 Jul 2025, charged only when delivered)

| Category                                                                       | India rate (INR, before GST)                            | When it applies                                                                                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketing                                                                      | **₹0.8631** _(3P, from Meta's card)_                    | Promotions, offers, re-engagement. Raised on 1 Jan 2026. **No volume discount**                                                                     |
| Utility                                                                        | **₹0.1150** _(3P)_                                      | Order and service updates tied to the user's own transaction. **Billable inside the 24 h window since 1 Oct 2026** (free from Jul 2025 to Sep 2026) |
| Authentication                                                                 | **₹0.1150** _(3P)_                                      | OTP templates sent to Indian numbers                                                                                                                |
| Authentication-international                                                   | ₹2.4971 _(3P)_                                          | Only after Meta flags the portfolio as eligible (large cross-border OTP senders), with 30 days' notice. Does not apply to us                        |
| Service (free-form reply inside the 24 h window)                               | **First 1,000 per number per month free**, then ₹0.1150 | Since 1 Oct 2026; unused free messages do not roll over                                                                                             |
| Free entry point (the user arrives from a Click-to-WhatsApp ad or Page button) | ₹0                                                      | Every category is free for 72 h if we reply within 24 h                                                                                             |
| Meta Business Agent (Meta's hosted AI replies)                                 | $2 per million tokens, about ₹3.5–4.4 per message       | Since 1 Jul 2026. **Not for us**: our assistant (spec 18) is cheaper and under our control                                                          |

- **Volume tiers** apply only to utility and authentication. They are counted per market and category across the whole portfolio, reset monthly, and discount only the messages above each threshold. For India, utility stays at the list rate up to **25 M messages a month**, and authentication discounts start at **750k a month** _(3P)_. They will not matter to us before about 100k orders a month.
- Meta changes rates only on **1 Jan, 1 Apr, 1 Jul and 1 Oct**, with a month's notice. Budgets need a quarterly review.
- **GST at 18%** is added on top. With INR billing, ask whether the invoice carries our GSTIN so we can claim input credit (Q-W13).

### 2.3 Messaging limits, quality and throughput

- **Limits** count **unique users messaged outside a customer service window in a rolling 24 h**, set at the **portfolio level** and shared by all its numbers. The tiers are **250** for a new portfolio, **2,000** after a scaling path (business verification, a partner verifying us, or 2,000 high-quality sends in 30 days), then **10k → 100k → unlimited** automatically. Each step takes up to 6 h, provided quality is high and we used at least half the current limit in the last 7 days.
- **Launch impact:** 250 a day is too few once we pass about 50 orders a day. **Finish business verification before launch** so we start at 2,000.
- **Quality:** template quality comes from blocks, reports and reads. Low-quality templates are paused and then disabled, and poor quality stops the tier from growing. Rules for us: message only what the user expects, never mix a promo into a utility template, and keep the opt-out one tap away.
- **Throughput** defaults to about 80 messages a second per number, raised automatically for high-volume numbers. Coexistence numbers are fixed at 20 a second. This is far beyond our needs.

### 2.4 The 24-hour window, categories and opt-in

- **Window:** every message from the user opens or refreshes a 24 h **customer service window**. Inside it we may send free-form messages, which are "service" (free up to 1,000 a month). Outside it, **only approved templates** may be sent.
- **Utility vs marketing:** a utility template must be **non-promotional** and **tied to the user's own transaction** (order or shipping update, refund processed, payment reminder, feedback on a specific order). **An order update with a promo in it counts as marketing.** Meta can **reclassify** a utility template as marketing (1 day's notice, or instantly after a warning), and repeated misuse leads to utility rate limits or the loss of utility status for 7–30 days across the whole portfolio. Our admin template editor must not let staff add offers to utility templates (lint check: no coupon variables, no "offer"/"sale" wording).
- **Opt-in (Meta):** the user must agree to receive messages from a **named** business. Any channel is allowed (website, checkout, SMS, IVR, paper), and the opt-in need not mention WhatsApp specifically. Meta **recommends** a separate opt-in per category, and we will do that anyway for DPDP (§8). Every opt-out request, on or off WhatsApp, must be honoured.
- **Marketing frequency caps:** Meta caps how many marketing templates **one user** receives from **all** businesses (stricter in India since 2024, with no published number). A capped message fails with error **131049** and is not billed. Retry no sooner than 24 h, and treat the failure as normal in analytics. **Utility, authentication and service messages are not capped.**
- **Escalation:** automation is allowed, but a clear route to a human must always exist. Our "Talk to support" ticket and the call number cover this.

### 2.5 Official Business Account (the blue badge)

- Requested by the number's owner in **WhatsApp Manager → Phone numbers → Profile → Official business account → Submit request**, or through the API. Requirements: compliance with the Business Messaging Policy, **at least 30 days on the platform**, a **verified** business portfolio, two-step verification on, and an approved display name. A refused request can be resubmitted after 30 days. Third parties say notability (press links) still affects approval.
- Not needed for launch. Apply 30 days after go-live. Meta Verified for Business is a separate, paid subscription in the app; it is not needed.

### 2.6 Hosting and run cost

Meta hosts the Cloud API. The **On-Premises API was sunset on 23 Oct 2025**, and new numbers have been Cloud-only since Jan 2024. Our extra cost is one webhook route on the existing Hono service on Cloud Run, plus a little pg-boss work. **There is no extra infrastructure.**

### 2.7 The inbox: who answers customers who write in?

| Option                                                                                                                                                              | Works with a direct Cloud API number?                                                                                                                                                                                                                                                   | Verdict                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Inbound → support ticket** (ours): each message becomes a `ticket_messages` row in an open REQ-… thread (or a new ticket); the agent replies in the admin console | Yes. We build it                                                                                                                                                                                                                                                                        | **Recommended.** About 3–5 dev days. Reuses spec 09 (SLA, masking, audit, assignment) and keeps the data ours  |
| Free **WhatsApp Business app** on the **same** number (coexistence)                                                                                                 | Meta supports coexistence (app v2.24.17+, history sync up to 180 days, 20 msg/s), but **only through Embedded Signup by a Solution Partner or Tech Provider**. A direct developer would have to become a Tech Provider (app review). Groups, broadcast lists and view-once are disabled | Possible through a BSP, not practical going direct                                                             |
| Free WhatsApp Business app on a **separate** support number (7978776551) and the API on a new number                                                                | Yes; the two are independent                                                                                                                                                                                                                                                            | A good stopgap. Customers who reply to a notification reach the API number, so we still need the ticket bridge |
| Open-source inbox (e.g. self-hosted Chatwoot) on the Cloud API                                                                                                      | Yes, but it wants to own the webhook, and it is another Rails + Redis + Postgres service to run and secure                                                                                                                                                                              | Not worth it; it duplicates spec 09                                                                            |
| BSP team inbox (Interakt, AiSensy, WATI, MSG91 Hello)                                                                                                               | Only if the number sits with that BSP                                                                                                                                                                                                                                                   | See §3                                                                                                         |

## 3. Option B — Business Solution Providers (BSPs)

### 3.1 Prices and features (India, Nov 2026, before GST)

| Provider                  | Platform fee                                                                                                    | Per-message price (marketing / utility / auth / service after 1k free)                                                 | Markup vs Meta                          | Extras                                                                                                                                             | India support                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Meta direct**           | ₹0                                                                                                              | 0.8631 / 0.1150 / 0.1150 / 0.1150                                                                                      | —                                       | API only; Meta's WhatsApp Manager for templates and insights                                                                                       | Meta Business Support (slow, ticket-based) |
| **MSG91**                 | "Titan" ₹500/month (first 2 months free)                                                                        | "Bills only what Meta charges" (MSG91's own claim)                                                                     | ~0 (verify)                             | Hello (ticketing / chat inbox), Campaign, chatbot, SMS + DLT in the same account. Already the decided SMS provider                                 | Indian company, phone support              |
| **Gupshup**               | Self-serve ₹0; India "CX" plan ₹5,000/month + ₹0.32/message _(3P)_                                              | Meta rate + **$0.001 (~₹0.088) per message**, outbound and inbound _(3P)_; +6% on marketing not sent via MM API _(3P)_ | ~₹0.09/msg (~77% on utility)            | Bot builder, campaigns and an agent console on the CX plan; strong in India at enterprise scale. Wallet billed in USD                              | Indian HQ, enterprise teams                |
| **Interakt** (Jio Haptik) | Growth ₹2,799/month; Advanced ₹3,799; Enterprise on request                                                     | Growth: 0.958 / 0.150 / 0.128 / 0.128                                                                                  | +11% marketing, +30% utility, +11% auth | Shared inbox, unlimited agents, chatbot flows, campaigns with click tracking, CTWA launcher, public APIs and webhooks (Advanced), Sales CRM add-on | Strong India SME support                   |
| **AiSensy**               | Free plan; paid plans' prices not machine-readable (roughly ₹1–3k/month, verify); chatbot builder +₹2,500/month | 1.09 / 0.145 / 0.145 / 0.145                                                                                           | +26% marketing, +26% utility            | Broadcasts, unlimited users (fair use 200), inbox, chatbot builder (add-on), AI agent add-on, CTWA                                                 | India SME focus                            |
| **WATI**                  | Growth ₹2,699, Pro ₹5,799, Business ₹16,799 per month (billed quarterly); Growth caps broadcasts at 15k/month   | Growth: 1.0357 / 0.1495 / 0.1495 / 0.138 (Pro and Business slightly lower)                                             | +20% marketing, +30% utility            | Team inbox (3–5 users, then ₹1,299–2,199 per extra user), chatbots, CTWA on Pro+, API call quotas (10k/month on Growth, without webhooks)          | 24×5 on Growth, 24×7 on Pro+               |
| **Twilio**                | ₹0                                                                                                              | Meta rate + **$0.005 (~₹0.44) per message, inbound and outbound**; failed $0.001                                       | about +380% on utility                  | Excellent API, Studio flows, Verify; billed in USD                                                                                                 | Global support, no India pricing edge      |
| **360dialog**             | Regular €49 (~₹5,000)/number/month; Premium €99 (~₹10,100) adds inbox, sendout and automation                   | Meta rate, "no markup"                                                                                                 | flat fee only                           | API-first hosting, 80 msg/s, business verification in 48 h on Premium, 24/7 support, Meta escalation                                               | EU-based, EUR billing                      |

### 3.2 What a BSP actually buys us

1. **Faster onboarding and an escalation path.** BSPs run partner-led business verification and can escalate to Meta. Going direct, our only channel is Meta Business Support.
2. **Coexistence**: keeping a number that is already on the WhatsApp Business app.
3. **A ready team inbox, chatbot builder, campaign scheduler and CTWA analytics** for non-developers.
4. **Rate cards and billing in INR** with a GST invoice. Meta direct now does this too (from 2026).

### 3.3 Lock-in and number portability

- **Insist that the WABA is created in _our_ Business portfolio** through Embedded Signup. Then the number, display name, quality history and verification are ours, and the number can be **migrated** to another BSP or to direct (a new OTP, and two-step verification disabled during the move). Templates may need recreating in the destination WABA (verify per case).
- The real lock-in is **workflows, contacts and chat history living inside the BSP's tool**: campaign lists, bot flows and inbox threads. With a direct API, all of it stays in our database.
- Messages and inbox data held by a BSP make it a **data processor** under DPDP, so we would need a processing agreement and to check where it stores data.

## 4. OTP over WhatsApp vs SMS

| Channel                                       | Cost per OTP (India)                                                                                                      | Regulation                                                                                                                                                         | Reach and UX                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **WhatsApp authentication template** (direct) | **₹0.1150**, charged only when delivered                                                                                  | **No DLT** (TRAI's TCCCPR covers telecom SMS and voice, not OTT apps). Fixed Meta text, optional expiry 1–90 min, copy-code or one-tap button; zero-tap on Android | Most Indian smartphone users have WhatsApp. Codes go only to the primary device. iOS 26+ autofills from the notification                        |
| **MSG91 SMS OTP**                             | ₹0.16–0.25 by volume, down to ~₹0.13 negotiated _(3P)_                                                                    | DLT entity, header and template registration needed (24–48 h, small one-time portal fees)                                                                          | Works on every phone; delivery depends on the operator                                                                                          |
| **Firebase Phone Auth SMS** (current)         | Reported **$0.07 (~₹6) per SMS** to India in 2026 _(3P; Google's per-country table could not be read; check GCP billing)_ | Google handles the routes                                                                                                                                          | Built-in reCAPTCHA and abuse checks; works with the Auth Emulator. Firebase Phone Number Verification (SIM-based) is **not available in India** |

- **This matters less for us than it seems.** By decision, OTP runs **once at sign-up**, with password logins afterwards, plus the staff phone code. Volume is about one OTP per new user. Even at ₹6 each, 3k sign-ups cost about ₹18k a month; on WhatsApp the same sign-ups cost about ₹350.
- **Architecture change if we switch:** Firebase's phone provider only sends SMS. A WhatsApp OTP needs our **own OTP service** in the API: a hashed code, 5 attempts, a rate limit per phone and IP, Turnstile, a 10-minute expiry, idempotent sends. On success the API mints a Firebase **custom token** (`createCustomToken`) or links the phone number. This touches spec 01 and the `firebase-phone-auth-rbac` skill, so it needs a decisions entry. **It is P1, not launch.**
- **Fallback strategy:** WhatsApp first → if the status webhook reports `failed` (e.g. not a WhatsApp user, error 131026) or there is no `delivered` within about 20 s → offer "Send by SMS instead" (Firebase SMS now, MSG91 later). Show which channel the code went to (Meta best practice). Never send both at once.

## 5. What MechDost would send

| Event (spec 10)                                                          | To                  | Category                                             | Template notes                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `order.placed` / `order.confirmed` ("confirmed, will be shipped")        | Customer            | Utility                                              | Order code, item count, total in ₹; URL button to `/orders/MD-…`                                                                                                                                       |
| `order.out_for_delivery` **with the 4-digit delivery code**              | Customer            | Utility (not authentication: it is not a login code) | "Share code {{1}} only after you receive the parcel." Shows on the lock screen, like SMS. The code stays valid only while the order is out for delivery                                                |
| `order.delivered`, `order.rejected` + refund, `payment.refund_processed` | Customer            | Utility                                              | No promos (that would make them marketing)                                                                                                                                                             |
| **Shop assignment offer** (with the accept timer)                        | Shop staff          | Utility                                              | "New order MD-… · accept by {{time}}" + URL button to the portal. **Accepting stays in the portal** (state machine + version). Quick-reply "Accept" is P1, needing a signed payload and an actor check |
| `service.proposed`, `service.estimate_sent` (**approval link**)          | Customer            | Utility                                              | Dynamic URL to `/service/SR-…/estimate`; the page re-authenticates. Approval per line happens in the app, never by a WhatsApp reply                                                                    |
| `service.ready` / `billed`, bookings for workshops                       | Customer / workshop | Utility                                              |                                                                                                                                                                                                        |
| Ticket replies                                                           | Customer            | Service in the window; utility template outside it   | Outside the window: "New reply on REQ-…, open to read". Never put the reply text in a template                                                                                                         |
| Partner application status, admin alerts                                 | Applicant / staff   | Utility                                              | Admin alerts are better as in-app + email; send WhatsApp only for SLA breaches                                                                                                                         |
| Promos, brand offers, coins about to expire, abandoned cart (P1)         | Opted-in customers  | **Marketing** (via MM API)                           | Quiet hours 21:00–09:00 IST; frequency cap of our own (e.g. 2 a week)                                                                                                                                  |
| Sign-up OTP (P1)                                                         | User                | Authentication                                       | §4                                                                                                                                                                                                     |

## 6. Monthly cost estimate (INR, before GST)

**Assumptions per order:** 5.0 utility messages (4 to the customer, about 1.3 shop offers counting reroutes, ≈5); 0.3 OTP (new users only); 0.3 service replies (5% of orders open a ticket, about 6 agent replies each); **2.0 marketing** (an opted-in base of about 2× monthly buyers, one campaign a month); 1 inbound user message. One phone number, so 1,000 service messages free. Volume tiers do not kick in at these volumes. **Service requests (spec 06) add roughly the same per booking**, so scale by total orders plus bookings.

| Option (plan used)                            | 1k orders/month | 10k orders/month | 100k orders/month | of which transactional only (1k / 10k / 100k) |
| --------------------------------------------- | --------------: | ---------------: | ----------------: | --------------------------------------------- |
| **Meta direct**                               |      **₹2,336** |      **₹23,587** |     **₹2,36,905** | ₹610 / ₹6,325 / ₹64,285                       |
| MSG91 (₹500 + pass-through)                   |          ₹2,836 |          ₹24,087 |         ₹2,37,405 | ₹1,110 / ₹6,825 / ₹64,785                     |
| 360dialog Regular (€49)                       |          ₹7,334 |          ₹28,585 |         ₹2,41,903 | ₹5,608 / ₹11,323 / ₹69,283                    |
| Gupshup self-serve (+₹0.088/msg)              |          ₹3,093 |          ₹31,155 |         ₹3,12,585 | ₹1,191 / ₹12,133 / ₹1,22,365                  |
| Interakt Growth (₹2,799)                      |          ₹5,503 |          ₹30,099 |         ₹2,76,951 | ₹3,587 / ₹10,939 / ₹85,351                    |
| AiSensy (message charges + plan fee)          |   ₹2,949 + plan |   ₹29,775 + plan |  ₹2,99,055 + plan | ₹769 / ₹7,975 / ₹81,055 (+ plan)              |
| WATI (Growth → Pro at 10k → Business at 100k) |          ₹5,563 |          ₹34,712 |         ₹3,07,176 | ₹3,491 / ₹14,000 / ₹1,00,036                  |
| Twilio (+$0.005 in and out)                   |          ₹6,120 |          ₹61,427 |         ₹6,15,305 | ₹3,514 / ₹35,365 / ₹3,54,685                  |

- Add **18% GST** to every figure.
- **Engineering cost of going direct** (one-off): about 10–14 dev days (§10), covering the adapter, webhook, template sync, opt-in and the ticket bridge. Most of it would be needed with a BSP too: the adapter, webhook and opt-in. Only the inbox bridge is extra. At 10k orders, a BSP's markup (₹6–11k a month) pays for that work within a few months.
- **Controlling cost:** marketing is the big line. Ending a single monthly campaign to the whole base saves about 70%. CTWA ads give 72 h of free messages.

## 7. Compliance

### 7.1 DPDP (Act 2023, Rules notified 13–14 Nov 2025, phased in over about 18 months)

- **Separate, per-purpose consent**, logged with purpose tags (`consent_log`): `whatsapp_transactional` (covered by the order contract, but notified and switchable to SMS/email), `whatsapp_marketing` (**unticked opt-in**, with the wording naming "MechDost (Shourya Integrated Services Pvt Ltd)" and WhatsApp), and `whatsapp_partner_alerts` (in the partner application form). Withdrawing must be as easy as giving consent: a toggle in Account → Notifications, plus the "STOP" handling in §7.3.
- **Processors:** Meta, or a BSP, processes the phone number and message content. List it in the privacy notice. Templates carry the minimum PII needed (first name, order code). **No addresses or phone numbers in templates**; masked where possible.
- **ML-ready data (rule 16):** `notification_log` stores the category **code**, template key and version, locale, the `pricing.category`/`billable` from the status webhook, delivery and read timestamps (UTC) and the error **code**. Never the message body with a phone number.

### 7.2 Meta policies

- **Business Messaging Policy:** opt-in, honouring opt-outs, a route to a human, templates only outside the window. **Commerce Policy:** auto parts and workshop services are not prohibited categories. Restrictions that touch us: **airbag assemblies and some regulated vehicle parts cannot be sold through Meta Shops** _(3P)_, and firearms and hazardous goods are banned. We do not use the WhatsApp catalogue or payments, so this only matters if we list a catalogue on Meta. Our own catalogue rules already block hazardous goods.
- **Template hygiene:** the admin editor enforces the category rules in §2.4, keeps every change versioned and audited, and blocks promo wording in utility templates.

### 7.3 TRAI does not apply, but opt-out still matters

- The TRAI TCCCPR (DLT, DND, headers, scrubbing) covers telecom SMS and voice. WhatsApp is an OTT app, so **no DLT or DND scrubbing is needed** on WhatsApp.
- **Opt-out handling we build:** a quick-reply button **"Stop offers"** on every marketing template, plus inbound keyword matching (`STOP`, `UNSUBSCRIBE`, `रोकें`, `बंद`). Either one sets `notification_preferences.whatsapp_marketing = false`, writes a consent-withdrawal event and sends one utility confirmation. Users can also block marketing in WhatsApp's own settings; treat blocks and error 131049 as signals, not as "retry". **Transactional messages keep flowing** after a marketing opt-out (spec 10 rule).

### 7.4 Data residency

- The Cloud API runs in Meta's data centres. **Local storage** keeps message content at rest **in India** (`IN`), after up to **60 minutes** of in-transit processing elsewhere. Covered: text, media and template components. Not covered: some tokenised metadata, and contact-card numbers. **Enable it before registering the number.** DPDP does not currently require localisation (only blacklisted countries), but this is cheap insurance and a good answer for partners and auditors.
- The **On-Premises API has been sunset (23 Oct 2025)**, so self-hosting is no longer possible. Local storage is the only residency control.

## 8. Decision table

| Criterion (weight)                                      | Meta direct                        | MSG91                       | Interakt / AiSensy / WATI       | Gupshup    | Twilio         | 360dialog        |
| ------------------------------------------------------- | ---------------------------------- | --------------------------- | ------------------------------- | ---------- | -------------- | ---------------- |
| Message cost (high)                                     | **Best** (list)                    | Best (claimed pass-through) | +11–30%                         | +₹0.09/msg | Worst (+₹0.44) | List + €49/month |
| Fit with our outbox and adapters (high)                 | **Native**                         | Good (REST API)             | Fair (API quotas, tool-centric) | Good       | Good           | Good             |
| Data ownership, ML, DPDP (high)                         | **All ours**                       | Shared                      | Mostly in the tool              | Shared     | Shared         | Shared           |
| Onboarding effort (medium)                              | Highest (our own BV, Meta support) | Low                         | **Lowest**                      | Low        | Medium         | Low              |
| Team inbox / campaigns, no code (medium)                | Build (ticket bridge)              | Hello + Campaign            | **Best**                        | CX plan    | Build          | Premium add-ons  |
| Keep the existing app number (coexistence) (low–medium) | No (Tech Provider only)            | Ask                         | Yes (most support it)           | Yes        | Yes            | Yes              |
| Lock-in (medium)                                        | **None**                           | Low (if WABA ours)          | Medium (flows, contacts)        | Low–medium | Low            | Low              |
| Escalation to Meta (low)                                | Weak                               | Partner                     | Partner                         | Partner    | Partner        | Strong           |

**Recommendation:** **Meta direct** for transactional, partner, ticket and (P1) OTP traffic, with marketing through **MM API** on the same account when the owner switches it on. **Fallback plan:** if business verification or display-name approval stalls for more than 2 weeks, or the owner wants a no-code inbox and campaigns at launch, onboard through **MSG91**. It is the cheapest BSP, already in our decisions for SMS, and our adapter interface makes it a config switch. Interakt is the second choice when the marketing team's no-code tooling matters most.

## 9. Risks and mitigations

| Risk                                                                                                               | Mitigation                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The account or number is restricted** after quality drops or misclassified templates (a single point of failure) | Every WhatsApp send has an in-app + email twin (spec 10); per-template quality watch from `message_template_status_update`; alert on yellow quality |
| Utility template reclassified as marketing (cost ×7.5)                                                             | Editor lint; `template_category_update` webhook → admin alert + auto-disable that template                                                          |
| The 250-a-day limit at launch                                                                                      | Business verification before launch; stagger partner and customer sends                                                                             |
| Meta changes prices quarterly or adds charges (as on 1 Oct 2026)                                                   | Rates in an admin setting (paise/basis points), not code; monthly cost dashboard from the `pricing` webhook fields; budget alert                    |
| Cloud API marketing sunset (13 Oct 2027)                                                                           | Build marketing on the MM API endpoint from the start                                                                                               |
| Token leak or forged webhooks                                                                                      | System User token in Secret Manager, rotated; HMAC check on the raw body; IP allowlisting is not reliable, so the signature is the gate             |
| Billing failures (Indian cards, INR migration deadline 31 Dec 2026)                                                | INR billing from day one; a backup card; a low-balance alert                                                                                        |
| Weak Meta support when we go direct                                                                                | Keep the MSG91 fallback documented; owner holds two admins on the portfolio                                                                         |
| Delivery code visible on the lock screen                                                                           | Same exposure as SMS; the code works only while out for delivery and needs the courier; attempts are capped at 5 (already built)                    |

## 10. Setup checklist with time estimates

| Step                                                                              | Elapsed                       | Effort                            |
| --------------------------------------------------------------------------------- | ----------------------------- | --------------------------------- |
| Meta Business portfolio, 2 admins, two-factor on all admins                       | Day 1                         | 30 min (owner)                    |
| Submit business verification (CIN or GST, matching name and address)              | Day 1 → **2–10 days** _(3P)_  | 1 h (owner)                       |
| Buy a new number (SIM or virtual); confirm it was never on WhatsApp               | Day 1–2                       | 1 h                               |
| Developer app, test number, sandbox templates in staging                          | Day 1                         | 2 h (dev)                         |
| Local storage `IN` → register number + PIN → display name "MechDost"              | After BV → 1–3 days of review | 1 h                               |
| System User token → Secret Manager; `.env.example` entries (`WHATSAPP_*`)         | Day 2                         | 1 h                               |
| INR billing + payment method                                                      | Day 2                         | 30 min (finance)                  |
| Hono webhook (handshake, HMAC, dedupe, status → `notification_log`), with tests   | Week 1                        | 1.5 dev days                      |
| `packages/notify` WhatsApp adapter (Cloud API + MM API) + fake adapter            | Week 1                        | 2 dev days                        |
| Template registry: admin editor ↔ Meta sync (create, status webhooks), lint rules | Week 1–2                      | 2 dev days                        |
| About 20 templates × en/hi written and submitted                                  | Week 2                        | 1 day + minutes to 24 h of review |
| Consent capture (checkout, account, partner form), "Stop offers", keyword opt-out | Week 2                        | 1.5 dev days                      |
| Inbound → support ticket bridge, 24 h window tracking, agent reply path           | Week 2–3                      | 3–5 dev days                      |
| Test suites (rollback, retry, webhook chaos, signature, opt-out, window rules)    | Week 3                        | 2 dev days                        |
| Apply for the Official Business Account                                           | Go-live + 30 days             | 15 min                            |

**Total: about 2–3 weeks elapsed and 10–14 dev days.** Business verification is the critical path, so the owner should start it now. It does not depend on any code.

## 11. Questions for the owner (each with the safe default we use meanwhile)

| #     | Question                                                                                 | Safe default                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Q-W1  | Direct Meta Cloud API, or a BSP (MSG91 / Interakt)?                                      | **Direct**; MSG91 as the documented fallback                                                                    |
| Q-W2  | Which phone number for the API? Is 7978776551 already on the WhatsApp (Business) app?    | A **new dedicated number** for the API; 7978776551 stays on the WhatsApp Business app for calls and chat        |
| Q-W3  | Does a Meta Business portfolio already exist for Shourya / MechDost? Who are the admins? | Create one for the company with the owner + one director as admins                                              |
| Q-W4  | Who does business verification, and with which document (CIN, GST)?                      | Owner, with the Certificate of Incorporation + GST certificate; name and address as on the documents            |
| Q-W5  | Does the support team need a shared WhatsApp inbox at launch? How many agents?           | No separate tool: **inbound WhatsApp → support tickets** in the admin console                                   |
| Q-W6  | Send WhatsApp marketing at launch?                                                       | **No**; transactional only for the first 60–90 days, then opt-in campaigns via MM API                           |
| Q-W7  | Monthly WhatsApp budget and alert threshold?                                             | Alert at ₹5,000/month at launch; marketing sends paused if the cap is hit                                       |
| Q-W8  | Move sign-up OTP from Firebase SMS to WhatsApp?                                          | **Keep Firebase SMS at launch**; WhatsApp OTP with SMS fallback as P1 after the custom-token design is approved |
| Q-W9  | Hindi templates at launch?                                                               | Yes, en + hi for every template                                                                                 |
| Q-W10 | Store messages in India (local storage)?                                                 | **Yes**, set before the number is registered                                                                    |
| Q-W11 | WhatsApp alerts to shops and workshops (consent clause in the partner agreement)?        | Yes, utility only, with opt-in on the application form; accepting stays in the portal                           |
| Q-W12 | Display name "MechDost", and apply for the blue badge?                                   | "MechDost"; apply 30 days after go-live                                                                         |
| Q-W13 | Meta billing: company card + INR billing with our GSTIN on the invoice?                  | INR billing with a company card and a backup card                                                               |
| Q-W14 | Use Meta's paid Business AI for replies?                                                 | **No**; our assistant (spec 18) + human tickets                                                                 |
| Q-W15 | Confirms Q9 (WhatsApp handoff from support tickets): is the ticket bridge the answer?    | Yes; it replaces "Call + in-app only"                                                                           |

## 12. Drift found in our docs (to fix when the ruling lands; not edited here)

- `.claude/skills/msg91-messaging/SKILL.md` gives "~₹0.12" for utility and implies free replies. **Since 1 Oct 2026, utility is ₹0.115 and billable inside the window, and service replies are free only for the first 1,000 a month.** `docs/plan.md` (compliance paragraph) has the same outdated claim.
- `docs/decisions.md` names "MSG91 WhatsApp" as the provider, and spec 10 says "MSG91 SMS and WhatsApp templates". If Q-W1 is direct, record a dated decision: Meta Cloud API for WhatsApp, MSG91 for SMS/DLT only. Pending #6 is also affected.
- Spec 10's data model needs `whatsapp_template_name`, `meta_category`, the `pricing` fields on `notification_log`, and a per-user `whatsapp_window_expires_at`. Spec 09 needs the inbound bridge. Spec 01 needs the OTP-channel note (P1).
- New environment variables for `.env.example`: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_GRAPH_VERSION`.

## Sources

Official (Meta):

- Pricing (per-message model, 1 Oct 2026 changes, free tier, FEP, Business Agent, INR billing): https://developers.facebook.com/docs/whatsapp/pricing
- Pricing updates timeline: https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing
- Rate calculator: https://business.whatsapp.com/products/platform-pricing
- Messaging limits: https://developers.facebook.com/docs/whatsapp/messaging-limits
- Phone numbers: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers.md
- Official Business Accounts: https://developers.facebook.com/documentation/business-messaging/whatsapp/official-business-accounts.md
- Opt-in: https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in.md
- Template categorisation and reclassification: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization.md
- Per-user marketing limits: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits/
- Authentication templates: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-templates.md
- Marketing Messages API (Cloud API marketing sunset dates): https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview.md
- Coexistence (onboarding Business app users): https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users
- Local storage: https://developers.facebook.com/docs/whatsapp/cloud-api/overview/local-storage
- On-Premises API sunset: https://developers.facebook.com/docs/whatsapp/on-premises/sunset
- Business Messaging Policy: https://whatsappbusiness.com/policy/
- Firebase Phone Number Verification pricing (India not supported): https://firebase.google.com/docs/phone-number-verification/pricing

Providers' own pages:

- Interakt pricing: https://www.interakt.shop/pricing/
- AiSensy pricing: https://www.aisensy.com/pricing
- WATI pricing: https://www.wati.io/pricing/ and the Growth rate card (1 Oct 2026): https://cdn.clare.ai/pricing/Wati-Pricing-Rate-Card-Growth-Plan-INR-I.pdf
- MSG91 WhatsApp pricing: https://msg91.com/in/pricing/whatsapp and the pass-through claim: https://msg91.com/guide/whatsapp-pricing-update-2026-and-save-with-msg91
- Twilio WhatsApp pricing: https://www.twilio.com/en-us/whatsapp/pricing
- 360dialog pricing: https://360dialog.com/pricing
- Gallabox rate card (shows a ~15% markup over Meta): https://docs.gallabox.com/pricing-and-billing/whatsapp-pricing/rate-card.md

Third-party (_3P_, used where Meta's INR card file could not be read):

- India rates effective 1 Oct 2026 and the service-message rule: https://instantdm.com/blog/whatsapp-business-api-pricing-2026-india-october-update
- India rates and GST: https://dev.to/abhishek_rajpurohit/whatsapp-business-api-pricing-in-india-2026-per-message-rates-gst-and-real-cost-math-1e3a
- India volume-tier thresholds: https://chatmaxima.com/whatsapp-api-pricing/india/
- Gupshup India fees: https://richautomate.in/blog/gupshup-pricing-india-2026
- Coexistence availability: https://docs.360dialog.com/partner/waba-management/phone-number-and-hosting/using-whatsapp-app-and-cloud-api-simultaneously
- Business verification documents (India): https://richautomate.in/blog/meta-business-verification-whatsapp-api-india-2026
- Error 131049: https://www.wati.io/en/blog/whatsapp-error-131049/
- SMS OTP prices in India: https://www.authgear.com/post/best-otp-service-providers/ and https://pricingsaas.com/companies/msg91
- Firebase SMS to India ($0.07): https://blog.logto.io/it/firebase-authentication-pricing and https://magora-systems.com/firebase-pricing/
- Meta Shops restricted vehicle parts: https://www.godatafeed.com/disapproval/meta-restricted-vehicle-parts-or-accessories
