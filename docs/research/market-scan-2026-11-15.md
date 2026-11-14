# Market scan — launch features round (2026-11-15)

Scope: eight areas for the 2026-11-15 launch features round. Builds on `industry-features.md` (not repeated: boodmo/GoMechanic/Pitstop basics, Zomato 4-min auto-reject, Swiggy ~₹50 penalty, Urban Company ≥70% acceptance and ₹1,500 monthly cap). Method: standard web searches only. **Evidence is often thin**: where a competitor does not publish a policy, this says so rather than guessing. Vendor blogs and consumer-complaint sites are unverified single accounts; they are flagged as such.

## 1. Doorstep / home vehicle servicing

Findings

- Doorstep works for simple periodic jobs (about 45–90 minutes at home); work needing a lift or special tools is not suitable (competitor view, Ride N Repair: https://www.ridenrepair.com/blog-details/is-doorstep-car-service-worth-it-pros-cons-2026).
- GoMechanic's bike division (launched Feb 2025) mostly still means drop-off at a partner workshop; its bike service starts at ₹299 as a workshop price. Doorstep is limited (same Ride N Repair source, so a competitor's claim).
- Pitstop runs doorstep through mechanic partners and vans (https://yourstory.com/2019/02/iit-kanpur-graduates-full-stack-car-service-startup-pitstop-shifts-gears-accelerate-growth); a ₹649 doorstep inspection is a low-price first order (https://www.autocarpro.in/news-national/pitstop-launches-doorstep-long-drive-inspection-package-for-cars-at-rs-649-79543).
- Apna Mechanic lists scooter service at home from ₹799 and car service at home from ₹3,065 (https://www.apnamechanic.com/bikes/scooty-service-at-home/), so home service is priced as a full service, not a visit fee plus jobs.
- No public per-km visit fee, radius or mechanic-verification policy found for GoMechanic or Pitstop.
- What goes wrong, from complaint sites (unverified): billed for work already done (air filter and spark plug cleaning after replacement), advisors pushing unneeded axle/brake work, support tickets unanswered, Trustpilot 1.5/5 on 28 reviews (https://www.consumercomplaints.in/bycompany/gomechanic-a551755.html, https://www.trustpilot.com/review/www.gomechanic.in). A Pitstop complaint describes a car held about five hours and a bill of ₹7,661 after promised doorstep service (https://www.consumercomplaints.in/bycompany/pitstop-a430569.html).

Implications for MechDost

- Our design (workshop-set fee, radius, per-service "can do at home" ticks) matches how the market splits jobs. Seed the default tick list with periodic service, battery, wipers, bulbs, minor brake pad changes; leave lift jobs unticked.
- The complaints are about price surprises and silence, which our per-line estimate approval and ticket flow already answer. Show the visit fee as its own line before the customer confirms.
- Show "visit fee is not charged again if you approve the work" only if the workshop sets it that way; make it a workshop setting, shown plainly.
- Mechanic safety: show the verified workshop name and a one-time arrival code the customer shares at the door (same pattern as our delivery code).

## 2. Trust for "genuine parts"

Findings

- boodmo lists seller information, technical data, photos and return terms per listing, and recurring complaints are slow delivery and refused wrong-fitment returns (https://motoxindia.com/boodmo-brings-you-better-and-genuine-spare-parts, https://de.trustpilot.com/review/boodmo.com?page=2). I found no confirmation that it is an authorised dealer.
- Brand QR/hologram checks (Bosch, Castrol, Exide): no official verification pages surfaced. Search results are about medicines. Caveat from the results: QR codes are easy to copy, and a single code scanned from many places is the real signal (https://www.securingindustry.com/pharmaceuticals/india-s-qr-code-programme-part-3-how-to-repair-and-reform/s40/a17040). Treat brand QR checks as something to ask each brand for, not something we can build blind.
- CCPA Guidelines for Prevention of Misleading Advertisements 2022 (notified 9 June 2022, apply to e-commerce): claims about objectively checkable facts must be substantiable on request; penalties up to ₹10 lakh (https://www.mondaq.com/india/social-media/1312524/ccpa-guidelines-for-misleading-advertisements-and-endorsements-2022). Regulators cite absolute "100% pure / natural" style claims as a problem category (https://rsdebate.nic.in/bitstream/123456789/752503/1/PQ_266_17122024_U2439_p151_p152.pdf). No source says "100% genuine" specifically; the inference is ours.
- Consumer Protection (E-Commerce) Rules 2020 bar unfair trade practices by marketplaces and sellers (https://www.nishithdesai.com/default.aspx?id=15590). I did not retrieve the rule text on accurate descriptions; check Rule 5/6 before launch.
- Dark-patterns guidelines 2023 (13 patterns, effective 30 Nov 2023); CCPA asked platforms to self-audit in June 2025 (https://ksandk.com/newsletter/safeguarding-consumer-rights-dark-patterns-guidelines-2023/). One law-firm summary says E-Commerce Amendment Rules 2026 (notified 9 Sept 2026, effective 1 Jan 2027) make dark-pattern compliance mandatory for all e-commerce entities (https://www.khaitanco.com/sites/default/files/2026-09/Ergo_E-Commerce%20Amendment%20Rules_18%20September%202026.pdf). Single source: verify against the gazette.

Implications for MechDost

- A "100% genuine" line is a factual claim we must be able to prove per product. Safer tiers (decision for Q102): default "Genuine parts from verified Raipur shops"; show "Original / OEM" only on products where the shop supplied brand + part number + purchase invoice, shown as per-product badges rather than a site-wide promise.
- Add a seller-agreement clause (Q77) that the shop warrants genuineness and will supply purchase invoices on request; store the invoice reference on the listing so the claim can be substantiated within days if the CCPA asks.
- Per-product trust facts we can show honestly: brand, OEM/OES/aftermarket label, part number, shop name and verification, GST invoice with every order, photo of sealed pack (optional upload by shop).
- Dark-patterns audit before launch: no fake urgency/stock counters, no pre-ticked add-ons, no drip pricing, easy cancellation. Our countdown timers are for shops, not customers; keep it that way.

## 3. Proof of work (DVI, before/after photos)

Findings

- Tekmetric ties inspections to the repair order; the customer gets a text link to approve or decline each line, and declined items are recorded (https://www.tekmetric.com/post/enhancing-customer-transparency-with-digital-solution).
- Vendor claim: sending photos/video raises average repair order (6–8 or 8+ photos; the thresholds disagree) (https://www.tekmetric.com/blog-post/digital-vehicle-inspection-software-increase-sales-aro). Vendor marketing, no independent data.
- GoMechanic sells "car health reports" with photos (see `industry-features.md`).
- Privacy practice (number plates, faces): no authoritative source found in this scan.

Implications for MechDost

- Our flow (before at vehicle received, after before ready) is the standard shape. Photos should attach to estimate lines where possible ("worn pad, photo") because the photo is what gets a line approved.
- Allow at most about 8 photos per stage, compressed on the device, EXIF location stripped, stored privately by default (matches the 2026-11-15 ruling).
- Privacy: tell workshops not to photograph people; do not publish plate-visible photos on public profiles. Offer an automatic plate blur later (P2); until then public display should default to off.
- Record "photo count per job" and "lines declined" as events: both feed the analytics in area 4.

## 4. Workshop analytics

Findings

- Standard KPIs from shop-software vendors: car count, average repair order (ARO), effective labor rate (labor revenue ÷ billed hours; a gap above 10–15% to the posted rate is a warning), technician efficiency (billed ÷ worked hours; 100–125% reference), comeback rate (repeat repair within 30 days; about 3% called healthy in one fleet source) (https://blog.autovitals.com/auto-repair-shop-metrics-kpis-to-track, https://autoleap.com/blog/top-kpi-track-auto-repair-shop/, https://oxmaint.com/industries/fleet-management/technician-comeback-tracking-kpi). Benchmarks are indicative, from vendor blogs.
- No benchmark found for approval rate; sources list "close rate" without a definition.
- Marketplace-side partner metrics (acceptance rate, cancellation, rating, response time) come from the Urban Company thresholds already in `industry-features.md`.

Implications for MechDost

- Workshop portal (own numbers): requests received, proposals sent, acceptance rate, jobs completed, ARO in paise, estimate line approval rate, median time to estimate, comeback count, rating, photo compliance.
- Admin view (partners compared): same plus slot-proposal time, give-ups/no-shows, warnings, refund and complaint rate per 100 jobs, repeat-customer share.
- Define "comeback" now as a support ticket or new request for the same vehicle and workshop within 30 days with a reason code from the repair; do not infer it.
- Skip technician efficiency at launch; small Raipur workshops will not log billed vs worked hours (P2).

## 5. Push notifications

Findings

- iOS web push works only for sites added to the Home Screen (iOS 16.4+); the permission prompt must follow a user tap; a denial is effectively permanent; the manifest `id` must stay stable; pushes must display immediately or Safari revokes permission (https://webkit.org/?p=13878, https://documentation.onesignal.com/docs/en/web-push-for-ios, https://notificare.com/blog/2024/09/16/web-push-in-ios-add-to-home-screen/).
- Vendor claim: a primed prompt lifts opt-in from about 38% to 62%; web push opt-in is far below app opt-in (3–8% vs 50–60%) (https://ecosire.com/blog/push-notifications-e-commerce). Unverified.
- Frequency: transactional order updates are exempt from marketing caps; promotional sends are 2–3 per week typical and the main cause of opt-outs; count each notification type separately (https://www.pushwoosh.com/blog/push-notifications-e-commerce, https://www.suprsend.com/post/reduce-push-notification-opt-out-rates).
- I could not verify which events Swiggy, Zomato, Flipkart or Urban Company push; no source gave a list. Do not cite them for this.

Implications for MechDost

- Ask for permission only after a meaningful moment (order placed, request accepted, shop first login), with a one-line pre-prompt explaining what they will get ("order and visit updates"). Never on first page load.
- On iPhone Safari (not installed): show "Add to Home Screen to get updates" instead of a prompt; keep the in-app bell and email/WhatsApp as the real channel since many Raipur users are on Android or WhatsApp.
- Promotions stay behind a separate opt-in (ruled). Cap promotions at 2 per week per person; transactional uncapped. Track opt-in, opt-out and CTR per notification type.
- Shops and workshops need a loud, reliable channel for timers (new order, 5-minute warning); push plus the 2026-11-16 WhatsApp alert, not push alone.

## 6. Refunds UX

Findings

- Razorpay: normal refunds take 5–7 working days (one page splits it as 3–5 to process, 5–7 to reach the customer); instant refunds reach the customer within minutes at an extra fee; the ARN/RRN is what the customer's bank uses to trace the credit; a refund can show "processed" before the ARN exists (https://razorpay.com/docs/payments/refunds.md, https://razorpay.com/blog/instant-refunds/).
- The CCPA has looked at Zomato/Swiggy cancellation and refund policies after complaints of high cancellation charges (https://www.business-standard.com/industry/news/ccpa-zomato-swiggy-cancellation-refund-policy-update-directive-125052101628_1.html). Final directive not confirmed.

Implications for MechDost

- Customer-facing steps: Requested → Approved by MechDost → Sent to your bank (Razorpay processed) → Credited (ARN shown once available). Show the expected date as "within 5–7 working days of approval", counted from approval, not from the request.
- Because every refund waits for finance approval (ruled), the biggest delay is our own queue. Add an internal SLA (for example, decide within 1 working day), an alert for refunds waiting over 24 hours, and show "Under review" honestly. Do not hide the approval wait in the 5–7 days.
- Four-eyes control: the approver cannot be the person who raised it; large amounts need super admin; every decision has a reason code. COD orders need a bank/UPI payout path: queue as a pending question.
- Send an email and push at approval and at credit, with ARN, not only on request.

## 7. Partner penalties

Findings

- Zomato reportedly made high-rejection restaurants pay the customer 25% of the order or at least ₹25; the restaurant association called it one-sided; undated (https://www.deccanherald.com/business/restaurant-owners-slam-zomato-over-rejection-policy-973163.html).
- Acceptance and cancellation rates also feed listing rank (low-authority source) (https://restro-logic.pages.dev/blog/swiggy-zomato-order-cancellation-india.html).
- Urban Company: suspensions without warning drew a worker protest (2023); commission was cut after protests (https://www.businesstoday.in/latest/in-focus/story/urban-company-punishes-workers-for-user-cancellations-blocks-worker-id-over-poor-rating-385830-2023-06-15, https://moneylife.in/article/urban-company-slashes-commission-by-5-percentage-after-workers-protest/65384.html). Its pro-side policy tells pros to cancel in-app as early as possible and treats cancellation like lateness, with exceptions for emergencies and platform faults (https://urban.co/en-gb/hero/article/Cancellation-lateness-and-no-show-policy-CLNS). Thresholds not visible.
- I found no official Swiggy/Zomato partner warning ladder.

Implications for MechDost

- Our ruled design (reason code, goes back to admin, warnings, prompt to pause after N in 30 days, never automatic) avoids the "suspended without warning" backlash. Keep it that way and add an appeal note.
- Treat "gave up early with a good reason" (stock-out reported before accepting window ends, shop closed, emergency) differently from "gave up after accepting for no reason": only the second counts toward warnings. Reason codes make this auditable.
- Penalise with visibility, not money, at first: ranker weight falls with give-ups; no fees until the commission model is decided (pending #9). Fees on small Raipur shops will cause drop-off.
- Warnings need a "what to do next time" line in Hindi and English, and a cool-off: warnings expire after 30 days.

## 8. What else is out there (gaps vs our specs)

1. Fixed-price inspection SKU as a first order (Pitstop ₹649). Low commitment, produces a DVI and a repair quote.
2. Network warranty on workshop labour (GoMechanic 1,000 km / 1 month; Ride N Repair 30-day labour) (`industry-features.md`). Even a 30-day workshop-labour promise gives a new brand credibility.
3. Public service-level numbers (ReadyAssist "96% within SLA"). Show our own once there is data: "accepted within 10 minutes: 90%".
4. Per-product fitment check "Fits your Maruti Swift VXi" with a wrong-part replacement path (boodmo's top complaint is refused wrong-fitment returns). Spec 21 and the vehicle garage cover part of this.
5. Request-a-quote fallback when search finds nothing (SparesHub); spec 19 bulk quotes may already cover this, extend to single parts.
6. Service reminders by date and mileage (Autodoc Club, GoMechanic). Cheap with push and WhatsApp; builds repeat use.
7. WhatsApp-first status and support. Already built inbound; add proactive order and visit updates as the main channel.
8. "Pay after work" and bill-in-app with GST invoice for service jobs (we plan this); make "no work starts without your approval" the headline promise.
9. Verified shop profile with real shop-front photo, years in business and GSTIN badge (builds on our seller onboarding).
10. Reviews only from verified orders/jobs, with owner replies; GoMechanic's trust collapse (fake-review allegations, unanswered tickets) shows why (https://www.team-bhp.com/forum/technical-stuff/284436-go-mechanic-review-absolute-disaster-should-avoided-all-costs.html, one forum poster's claim).

## Ranked improvements

**P0: before or at soft launch**

1. Prove-or-soften the genuineness wording: default to "verified Raipur shops" copy, per-product OEM badge only with invoice and part number, agreement clause (Q77/Q102). Reason: it is a statement of fact under CCPA rules with a ₹10 lakh ceiling.
2. Dark-patterns self-audit of checkout and booking flows. Reason: mandatory from 1 Jan 2027 per one summary, and regulators already audited platforms in 2025.
3. Refund status page with approval step, 5–7 working-day expectation, ARN shown when issued, plus finance approval SLA and old-item alert. Reason: our approval queue is the delay customers will blame.
4. Visit fee shown as its own line before home-service booking, plus arrival code at the door. Reason: the main complaints are price surprises and distrust of who turns up.
5. Push permission only after a meaningful moment with a pre-prompt; iOS Add-to-Home-Screen guidance; in-app bell as the fallback. Reason: a denial is near-permanent on iOS.
6. Give-up reason codes that separate legitimate early give-ups from no-reason give-ups; warnings expire in 30 days. Reason: fairness avoids the Urban Company suspension backlash.

**P1: first month** 7. Photos attached to estimate lines, EXIF stripped, private by default; "declined lines" recorded. Reason: photos drive approvals and give evidence in disputes. 8. Workshop portal analytics (acceptance, ARO, estimate approval rate, time to estimate) and admin comparison view. Reason: the data starts existing at launch; owners need to see value. 9. Public "responds within X minutes" stat per shop and workshop once there is data. Reason: cheap trust signal for a new brand. 10. 30-day workshop labour promise (workshop-funded, admin-editable). Reason: matches GoMechanic and Ride N Repair offers. 11. Fixed-price inspection SKU as the first service product. Reason: lowest-friction first order. 12. Service reminders by date/mileage through push and WhatsApp. Reason: repeat use at near-zero cost.

**P2: later** 13. Automatic number-plate blur on public photos. 14. Technician efficiency and effective labour rate reports. 15. Brand QR/authenticity verification partnerships (Bosch, Castrol, Exide) via the brands' own programmes. 16. Request-a-quote fallback for single parts; BNPL for tyres and batteries. 17. Pay-linked penalties for shops once the commission model is set (pending #9).

## Open questions for the user (queue in `questions-for-user.md`)

- Which product genuineness tier goes live: per-product "Original" badge with invoice proof, or the site-wide "100% genuine" line? (Q102)
- How do COD customers receive refunds (UPI/bank details collected, or manual payout)?
- Is a 30-day workshop labour promise acceptable to partner workshops?
