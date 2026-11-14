# Trust wording ("genuine parts"), seller genuineness clause, labour promise, dark-pattern self-audit (design)

Date: 2026-11-15 · Specs: 02 (catalogue), 06, 07 (agreement), 08 (content), concept copy · Decisions: "2026-11-15 —
Launch features round" (trust wording) and "… second answers" (Q102 clause, Q105 labour promise) · Research:
market-scan § 2, `research/promotions-referrals.md` (CCPA rules)

## Intent

MechDost is new in Raipur; customers worry about fake parts and surprise work. The user wants "genuine" and "genuine
parts" language throughout, in both a calm tone ("Genuine parts from verified Raipur shops") and a strong one ("100%
genuine parts", "Only original parts"), backed by a seller clause, and a configurable labour promise for workshop jobs.

## Goals / non-goals / anti-goals

- Goals: trust copy on the home page, catalogue, product page, cart/checkout, order emails, workshop pages and bills,
  en + hi, every line admin-editable (rule 8); a "genuine parts only" clause in the seller agreement with the
  consequence (product pulled, seller can be suspended); a labour-promise setting shown on workshop pages and bills
  when on; a dark-pattern self-audit of checkout and booking before launch.
- Non-goals: brand QR verification (P2), per-product OEM badges with invoice proof (P1 idea in the market scan),
  money-back guarantee (the user chose wording only).
- Anti-goals: a claim the platform cannot stand behind shown where it isn't true (e.g. "100% genuine" on a workshop's
  labour); fake urgency or hidden charges (dark patterns guidelines 2023).

## Approaches

1. **Copy keys with admin overrides through the content module (chosen):** default en + hi strings live in the locale
   files (`trust.*` namespace); Admin → Content → "Trust lines" lists each placement with its default and lets the
   admin override or hide it per language. Server Components read the override, so no client JS is added.
2. Hard-coded copy: breaks rule 8. Dropped.
3. A free-form banner system: too loose for claims that need review. Dropped.

## Decided

- **Placements and default copy** (en; hi in the locale file, reviewed by the Hindi gate):
  - Home hero strip: "100% genuine parts from verified Raipur shops" · "GST bill on every order" · "Clear estimates,
    you approve every line".
  - Product page, near the price: "Genuine {brand} part · sealed pack · GST bill" (brand from the product; if no brand,
    "Genuine part from a verified shop").
  - Cart / checkout trust line: "Only original parts from verified shops. Pay online or cash on delivery."
  - Order emails footer line: "Genuine parts from verified Raipur shops."
  - Workshop pages and booking: "Verified workshop · you approve every line of the estimate" and, when the labour
    promise is on, "{days}-day labour promise".
  - Partner pages: "Sell genuine parts to Raipur customers" (seller pitch).
- **Seller clause (Q102 "Yes"):** the agreement template (`partners.agreement_required` flow) gains a "Genuine parts
  only" clause: sellers list only genuine, legally sourced products in original packaging; a confirmed fake or
  counterfeit means the product is pulled and the seller can be paused or suspended with reason code
  `counterfeit_confirmed` (added to `PARTNER_STANDING_REASONS`). The full agreement text still comes from the user
  (Q77); the clause is drafted in en + hi and marked for legal review.
- **Labour promise (Q105 "admin-configurable"):** settings `service.labour_promise_enabled` (default false) and
  `service.labour_promise_days` (7–90, default 30); when enabled, shown on workshop pages, the booking review and the
  bill, and workshops accept it in onboarding (agreement checkbox). A "redo under promise" support ticket kind lets the
  customer claim it (support flow, no new machine).
- **Dark-pattern self-audit:** a checklist run against checkout, booking, coins, quotes and push prompts (13 patterns of
  the 2023 CCPA guidelines: false urgency, basket sneaking, confirm shaming, forced action, subscription trap, interface
  interference, bait and switch, drip pricing, disguised ads, nagging, trick wording, SaaS billing, rogue malware),
  recorded in `docs/research/dark-patterns-audit-2026-11.md` with fixes filed. The push "Not now" snooze and a single
  calm card satisfy "nagging".
- **Analytics:** none new (copy only); `trust_line_edited {placement}` admin event.

## Left to the builder

Where the content override is stored (existing content blocks table vs settings), the admin editor layout, Hindi
wording (natural, reviewed), how the brand name is resolved for the product line.
