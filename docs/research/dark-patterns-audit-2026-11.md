# Dark-pattern self-audit, November 2026

Status: done 2026-11-15 on the code of branch `worktree-agent-a60fd5ab3acdbed1d` (main as of 8e9f784) · Method: read the checkout,
booking, coins, quote and push-prompt code and copy against the 13 patterns of the CCPA Guidelines for Prevention and
Regulation of Dark Patterns, 2023, as summarised in `docs/research/promotions-referrals.md` § 1.6 · Design:
`docs/superpowers/specs/2026-11-15-trust-wording-design.md` · The E-Commerce Amendment Rules 2026 (from 1 Jan 2027, rule
4(15)) ask for a yearly self-audit with a certificate on the site: this is the first pass; re-run it before December and
after every change to the surfaces below.

## Result in one paragraph

No false urgency, no pre-ticked extras, no shaming copy, no subscription and no ads exist on these surfaces. Two real
problems were found and **fixed in this branch**: a cash-on-delivery fee that the checkout summary did not show (drip
pricing the moment the admin sets a fee), and a quote that could not be closed without answering a survey (forced
action). Four smaller items are **listed** for the owners of those areas.

## The 13 patterns against the five surfaces

| #   | Pattern (CCPA 2023)    | Checkout and cart                                                                                                                                            | Workshop booking and estimate                                                                                                      | Coins                                                                                           | Bulk quotes                                                                                           | Push prompt (design only, not built here)                                                                |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | False urgency          | Pass: no timers, no "x people viewing". "Few left" exists only on the demo catalogue's static data; the real catalogue never sets it (F4)                    | Pass: nothing counts down; the shop acceptance timer is shown to shops, not customers                                              | Pass: "{coins} coins expire on {date}" is a real date from the ledger, no "last chance" wording | Pass: expiry is a real date                                                                           | Pass by design: no countdown                                                                             |
| 2   | Basket sneaking        | **F1 fixed**: a cash-on-delivery fee was charged but not listed. Now its own line. No donations, insurance or add-ons exist                                  | Pass: no service is pre-selected, pick-up and drop is an unticked box, work is added only by the customer's approval, line by line | Pass: coins are off until the customer ticks them (`useCoinsOn` starts false)                   | Pass: the quantity prefill is the stated minimum, shown above the field, editable                     | Pass                                                                                                     |
| 3   | Confirm shaming        | Pass: no guilt copy. The "Not now" and "Keep it open" buttons are neutral                                                                                    | Pass                                                                                                                               | Pass                                                                                            | Pass ("Keep it open")                                                                                 | Pass by design: "Not now" is a quiet text button, same size as "Turn on" (builder to confirm, F5)        |
| 4   | Forced action          | Pass: guest checkout needs name, phone and address only; the consent is for processing this order                                                            | Pass                                                                                                                               | Pass                                                                                            | **F2 fixed**: closing a quote required choosing a reason. The reason is now optional (none = "other") | Pass: a browser prompt never appears before the person taps "Turn on" (design)                           |
| 5   | Subscription trap      | n/a (no subscriptions)                                                                                                                                       | n/a                                                                                                                                | n/a                                                                                             | n/a                                                                                                   | n/a                                                                                                      |
| 6   | Interface interference | **F3 listed**: cash on delivery is the preselected payment. It is also the cheaper one only while the COD fee is 0 (default). Online is a plain, equal radio | Pass                                                                                                                               | Pass                                                                                            | Pass                                                                                                  | Pass by design (equal weight)                                                                            |
| 7   | Bait and switch        | Pass: the price on the page is the server quote; the order carries `expectedTotalPaise` and the API refuses a different total (`PRICE_CHANGED`)              | Pass: the estimate is a range, work starts only after the itemised estimate is approved                                            | Pass: coin value is shown at checkout before use; refunds never turn into coins                 | Pass: the offer version the customer saw is the one accepted                                          | n/a                                                                                                      |
| 8   | Drip pricing           | **F1 fixed** (COD fee). Delivery is shown in the cart and again at checkout with the free-delivery hint; prices say "inclusive of GST"                       | Pass: the expected cost is a range up front; the home-service visit fee is not built yet (rule for the builder below)              | Pass: coins reduce the price, never add to it                                                   | Pass: the offer total is itemised                                                                     | n/a                                                                                                      |
| 9   | Disguised ads          | Pass: no ads. "Popular" badge exists only on demo data (F4). Paid placements, when built, must say "Sponsored" (promotions research)                         | Pass                                                                                                                               | n/a                                                                                             | n/a                                                                                                   | n/a                                                                                                      |
| 10  | Nagging                | Pass                                                                                                                                                         | Pass                                                                                                                               | Pass: coin reminders are transactional and capped by the notification preferences               | Pass                                                                                                  | Pass by design: one card, "Not now" hides it for 14 days (setting); a browser "denied" is never re-asked |
| 11  | Trick wording          | Pass: no double negatives. Trust wording is reviewed separately below                                                                                        | Pass                                                                                                                               | Pass: "no cash value" is stated at checkout and in the policy                                   | Pass                                                                                                  | Pass                                                                                                     |
| 12  | SaaS billing           | n/a                                                                                                                                                          | n/a                                                                                                                                | n/a                                                                                             | n/a                                                                                                   | n/a                                                                                                      |
| 13  | Rogue malware          | n/a: nothing is installed or scanned on the visitor's device; the notification service worker loads only after "Turn on" (design)                            | n/a                                                                                                                                | n/a                                                                                             | n/a                                                                                                   | n/a                                                                                                      |

## Findings

**F1 fixed (P1): cash-on-delivery fee missing from the checkout summary.** The API quote carries `codFeePaise`, and
`totalPaise` already includes it, but the summary listed only subtotal, delivery, coins and a total, so with a fee above
0 the rows did not add up, and the "Place order" total showed the cash-on-delivery amount even when "Pay online" was
selected. Now the summary has a "Cash on delivery fee" line when the fee applies, and the total follows the chosen method
(`onlineTotalPaise` for online). The setting defaults to 0, so nothing was charged wrongly yet; the fix makes turning it
on safe. Files: `apps/web/src/lib/use-cart-pricing.ts`, `apps/web/src/components/commerce/checkout-form.tsx`, locale key
`checkout.codFee`.

**F2 fixed (P2): quote close demanded a reason.** The "Close quote" button stayed disabled until a reason was picked
(forced disclosure to reach the goal). The reason is now optional; none given is stored as `other`. File:
`apps/web/src/components/quotes/quote-thread-api.tsx`, title "(optional)" in en and hi.

**F3 listed (P2): cash on delivery is preselected.** Fine while the fee is 0. Before an admin sets a COD fee above 0,
decide whether the cheaper method should be the default (queued as a suggestion in `docs/questions-for-user.md`
Q109). The fee is already shown (F1), so this is not a violation.

**F4 listed (P2): "Few left" and "Popular" are static demo labels.** The real catalogue source never sets them
(`apps/web/src/lib/catalogue/api-source.ts` sets `availability` to in stock or on request and `popular: false`). If either is ever
turned on for real data it must come from real stock or real sales, never an admin switch, and a number ("only 3 left")
must be the real stock. Added to spec 02 as a rule.

**F5 listed (P2): the push prompt and the bell are being built by another agent.** Checklist for its reviewer, taken
from this audit: "Turn on" and "Not now" the same size and weight, no countdown, no pre-ticked promotions switch
(promotions are a separate opt-in), "Not now" snoozes 14 days and the card never returns after "denied", no browser
prompt before the tap, no guilt copy.

**F6 listed (P2): home-service visit fee (not built).** When built (decision 2026-11-15, "fee shown upfront and added as a
line on the final bill"), show it on the booking card before the customer submits, not first on the bill.

## Trust wording against the same rules (design 2026-11-15)

- "100% genuine parts" and "Only original parts" are claims about what sellers do. They stay on the home strip and at
  checkout because the user chose the strong tone. They are backed by the seller clause (a confirmed fake pulls the
  product and can suspend the seller, reason `counterfeit_confirmed`) and every line is admin-editable and can be hidden.
  Risk if wrong: a consumer complaint under the E-Commerce Rules, not a dark pattern. Reduce it by running the clause
  past legal (draft marked in `docs/specs/07`) and by watching `counterfeit_confirmed` and "faulty part" tickets.
- "Bill with every order" is true for every order (an invoice or bill of supply, Q97). "GST bill" appears only beside a
  seller that is GST-registered, and the product page, which does not know the seller yet, leaves it out.
- "Sealed pack" is not claimed anywhere: it cannot be verified per item.
- The labour promise is shown only while the admin has it on; the days are frozen on each bill, so a later change never
  rewrites a promise already made.

## Re-run

Before 1 December each year and after any change to checkout, booking, coins, quotes, notifications or the trust lines:
walk the table above, update the findings, and keep the signed certificate text (once the legal wording is chosen) in
Admin -> Content. Unit tests that pin today's fixes: `apps/web/test/state-audit-trust.test.ts` (trust-line rows) and the
checklist rows `CHK-FORM` (`trust=…`) in `docs/qa/ui-state-checklist.md`.
