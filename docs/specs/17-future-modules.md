# 17 · Future modules (phase 4+ and P1/P2 items), mini-specs so they can start any time

## A. Vehicle Discovery (concept hidden section, screenshots `03-section-06`, `03-section-08`)

Goal: "Your next vehicle. Explore every possibility." — browse cars/bikes/scooters/EVs, filters (city, type, brand, body, fuel, budget, search, sort), shortlist, compare ≤3 (same family), on-road cost & EMI calculator (reducing balance 0–50% down, 1–120 months), test-drive enquiry, quotation enquiry, showroom directory, "My vehicle enquiries". Data: `vehicle_models` (real data later; concept has 8 fictional), `showrooms`, `vehicle_enquiries`. Monetisation: dealer leads. Needs: real model data source; dealer partners. Phase 4.

## B. Mechanic Learning Academy (`03-section-16-academy`)

Curated external links (NGK/NTK videos, Schaeffler REPXPERT, Bosch training), topic/format filters, saved/done self-marking, admin "Add a training link" form; later: MechDost Certified tiers with quizzes. Data: `learning_resources`, `learning_progress`. Phase 4.

## C. Product Lens (QR/barcode scanner, concept `assistance-scan.js`) — PARKED (user 2026-11-01: "not practical at this stage")

Camera (BarcodeDetector) / photo / manual code → match `part_numbers`/barcodes → product page or sourcing request. Needs barcode data on products. Phase 4.

## D. Roadside assistance & pickup/return (`03-section-12-assistance`)

Request roadside help (tyre, starting, breakdown, towing) with live location and ETA; pickup & return with handover photos (2 photos, custody terms); provider network (ReadyAssist-style partners or own mechanics); pricing/dispatch; "My assistance enquiries". Phase 4 (pickup/drop basic flag already in workshops).

## E. Mechanic network (`03-section-15-mechanics`)

Mechanic registration (4 consents), skills profile, district/PIN, directory, job cards workspace, network operations admin (verification, consent, export). Role `mechanic` portal. Phase 4.

## F. Referral, loyalty tiers (P1) — no wallet

**No wallet** (decision 2026-11-01): replaced by MechDost Coins (spec 20, built). Still future: referral codes rewarded in coins, loyalty tiers (P2), both depending on the earning rules in Q24.

## G. Exchanges, disputes, order chat, service reminders (P1, possibly launch — register #2)

Exchanges with price difference; disputes with evidence and admin ruling; order chat with masked numbers; reminders by km/date + insurance/PUC/RC expiry + challan check (Vahan/eChallan APIs).

## H. Registration-number lookup (P1)

Vahan API → make/model/variant/fuel/year prefill; cache by registration.

## I. Saved cards & UPI, EMI/BNPL (P1/L)

Razorpay tokenisation (RBI CoFT), saved UPI ids; cardless EMI for tyres/batteries.

## J. Subscriptions & care plans; fleet/B2B accounts (L)

RSA/care plan subscriptions; fleet accounts for auto/taxi unions with monthly invoicing and B2B price lists.

## K. ONDC listing; Google Business Profile review import (L)

## L. Meilisearch migration (planned)

Index sync job, typo tolerance, Hinglish synonyms, facets, geo; same `/search` API contract.

## M. Mobile app (later)

React Native/Expo consuming the same OpenAPI client and `packages/shared`; push notifications; partner app first.
