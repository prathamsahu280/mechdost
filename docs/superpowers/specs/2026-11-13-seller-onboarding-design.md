# Seller onboarding, invites, agreement and price approval: design

Status: draft for the user's approval (brainstorming, 2026-11-13). Source: the user's requests of 2026-11-13 (`docs/decisions.md` "Seller onboarding, price approval, buyer GSTIN, comparison"). Research: `docs/research/compare-gstin-onboarding.md`. The buyer GSTIN and product comparison get their own short designs after this one.

## Intent

The user wants MechDost to sign up real Raipur shops quickly but safely.

- **What a shop says:** who it is (GST status), where it is (an address and an exact map pin), and which catalogue products it sells.
- **Admin control:** the admin approves every shop and **every price**.
- **What customers see:** only prices the admin approved. A product the admin rejects for one shop is simply sold by the next nearby shop.
- **Invites:** the admin can invite shops he already knows, so they skip the review.
- **Agreement:** every approved shop sees MechDost's agreement. The user provides the text later (Q77).

## Goals

1. **Seller application** (public form and invite link), with these fields:
   - name, phone, email;
   - business name as on GST, and shop name;
   - **GST status:** a GSTIN, or a GST **enrolment number** for sellers below the registration threshold (Notification 34/2023-CT);
   - **address:** line, landmark, PIN;
   - **location pin:** "use my location", search, or drag the pin;
   - a **tick-list of catalogue products** (searchable, grouped by category);
   - consent.
2. **Admin invite:**
   - The admin enters name, email and phone.
   - MechDost emails a one-time link (the admin can also copy it for WhatsApp).
   - Opening the link proves the email.
   - The application is **pre-approved**: after the seller submits it, it does not wait in the review queue.
3. **Delivery area (user, 2026-11-13: "admin, at approval"):**
   - When approving, the admin sees the shop's city PIN codes pre-filled, each with the standard delivery charge and days (admin settings `partners.default_shipping_paise` and `partners.default_lead_days`).
   - The admin adjusts them; they become `shop_pincodes` rows.
   - The admin can edit them later (coverage editing, spec 07).
4. **Admin review:**
   - The admin sees the application with a checklist: GSTIN checked on the GST portal, address, pin, products.
   - The admin approves (the shop is created, `onboarding`) or rejects with a reason code.
   - A GSTIN already used by another shop or application is flagged.
5. **Agreement:**
   - After approval, the seller's portal shows "MechDost seller agreement" (admin-editable text, versioned) with Accept.
   - The acceptance is recorded: version, user, time.
6. **Prices after approval:**
   - The seller enters a price (never above MRP) and stock for each ticked product.
   - Each price is a **price request**. The admin approves or rejects it **line by line** in one queue.
   - Approved: the product goes on sale for that shop at that price.
   - Rejected (reason code): that product is **not sold by that shop**, and routing and pricing use other nearby shops.
   - A later price change is a new request; the current approved price stays on sale **while it waits**.
   - **If the admin rejects a change, the product is taken off sale for that shop** (user, 2026-11-13: "take it off sale").
     - Customers get it from the next nearby shop until a new price for it is approved.
     - Orders already placed keep their reserved stock and continue.
   - Stock changes stay direct (no approval).
   - Prices the admin sets on a shop's behalf stay direct (audited).
7. **Enrolled (non-GST) shops:**
   - They can apply and be approved with `gst_status = enrolled`.
   - They stay **not routable and not used for pricing** until bills of supply and zero-tax order snapshots exist (a later slice).
   - Checkout today splits GST on every line, and the invoice kinds have no bill of supply.
   - A one-line gate in routing, catalogue pricing and checkout; my call, see below.

## Non-goals (for now)

- PAN, bank details and payouts.
- E-sign of the agreement (click-through only until Q77).
- A GSTIN API check (the admin checks on the GST portal).
- Search-as-you-type addresses.
- Shops adding products that are not in the catalogue (spec 07 "submit new": later).
- Workshop and mechanic applications (they keep today's form; only `seller` changes).

## Anti-goals (a failure even if it works)

- A seller's price goes live without the admin.
- A rejection hides the product for every shop.
- The public form asks for identity documents beyond the GSTIN or enrolment number.
- Invited sellers create an account without proving their phone.
- Any English on `/hi`.

## Constraints

- **Hard rules:**
  - 3: state machines with conditional updates, one pending request per shop and product, audit plus events, integer paise.
  - 4: Turnstile and rate limits on the public form and on invite opening, Zod `.strict()`, 404 for foreign ids, the GSTIN encrypted (`kyc_enc`) with a blind index.
  - 8: the category list comes from the catalogue; agreement text, reason codes and the invite expiry are admin-editable.
  - 9: events.
  - 10: English and Hindi.
  - 16: codes, not free text.
- **Decisions:**
  - Phone OTP is required to create any account (2026-11-01): **the invite proves the email; the phone is still confirmed once by OTP at first sign-in** (Q78 with this default).
  - Partner KYC "GSTIN or declaration" becomes "**GSTIN or enrolment number**" (research; new decisions entry).
  - Nominatim forbids autocomplete: search runs on submit, through our server, rate-limited and cached.
  - The geocoding provider decision (#7) is unchanged.
- **Performance:** the map and product picker load only when opened (the JS budget, `/shop` 175 KB of 180).
- **Data mode:** the website's portals and admin console run on the demo store until the data switch. This design builds the database and API for real and the screens in demo mode, the same pattern as shop inventory today.

## Approaches considered

1. **The application carries a price list that becomes stock on approval.** Simple, but later price changes need a second mechanism, and approval is all-or-nothing. Not chosen.
2. **A pending shop with pending inventory rows.** Fewer tables, but half-made shops exist before approval and the history is thin. Not chosen.
3. **Every price is a request in one queue (chosen, user 2026-11-13).**
   - Onboarding prices, invited sellers' prices and later changes all use `shop_price_requests`.
   - The admin decides per product line.
   - The history is append-only and ready for analysis.
   - The user added that **prices are asked only after the application is approved**, which this fits.

## Design

### Seller journey

```
Apply (public) ──► new ──► in_review ──► approved ──► agreement ──► prices ──► live products
Invite link ─────────────► (pre-approved on submit) ──┘                │
                                         rejected (reason)              └─► each price: pending → approved | rejected
```

- `partner_applications.status`:
  - `new`, `in_review`, `approved`, `rejected`;
  - plus `source` = `public` or `invite`.
  - An invited application is created `approved` by the system on submit, with the actor recorded as the inviting admin.
- **Approval:**
  - creates `shops` (status `onboarding`, the GST status, address, location, city from the PIN);
  - links the applicant's user (`shop_users`, owner) when they sign in with that phone.
- **The shop becomes `approved`** (routable) after the agreement is accepted **and** at least one price is approved.
  - The agreement is a **one-time onboarding gate** (`onboarding` → `approved`), not a standing routing condition.
  - Shops already live (and seeded shops) are never taken offline.
  - A new agreement version shows live shops a "Review the updated agreement" card; their acceptance is recorded, but routing does not wait.
  - The admin setting `partners.agreement_required` (default `true`) switches the gate off (Q77).

### Data (new and changed)

- **`partner_applications` (changed):**
  - New columns:
    - `email` (citext), `shop_name`, `shop_name_hi`;
    - `gst_status` (`registered` | `enrolled`) and `gstin_index` (blind index, used to spot duplicates);
    - `address_line`, `landmark`;
    - `location` (geography point), `location_accuracy_m`, `location_source` (`gps` | `search` | `pin`);
    - `source` (`public` | `invite`), `invite_id`.
  - The GSTIN or enrolment number goes inside `kyc_enc`.
  - `details` becomes optional for sellers.
- **`partner_application_products` (new):** `application_id`, `product_id`, unique together.
- **`partner_invites` (new):**
  - `token_hash` (SHA-256 of 32 random bytes; the token itself is never stored);
  - `name`, `email`, `phone`;
  - `created_by`, `expires_at` (admin setting, default 7 days), `used_at`, `application_id`;
  - `status` (`sent` | `used` | `expired` | `revoked`).
  - One open invite per phone (partial unique index).
- **`shop_price_requests` (new):**
  - `shop_id`, `variant_id`;
  - `requested_paise`, `previous_paise`, `on_hand`;
  - `status` (`pending` | `approved` | `rejected` | `withdrawn` | `superseded`);
  - `reason_code`, `note`, `decided_by`, `decided_at`, `version`.
  - One `pending` per shop and variant (partial unique index); price never above MRP (as today).
- **`shop_inventory` (changed):** `admin_blocked` (boolean) and `blocked_reason_code`.
  - A rejected first price leaves no sellable row, or sets `active = false, admin_blocked = true`.
  - The shop cannot re-activate a blocked row; a new approved request clears it.
- **`agreement_versions` and `shop_agreements` (new):**
  - `agreement_versions`: version, text in English and Hindi, `published_at` (admin CMS).
  - `shop_agreements`: shop, version, accepted by, accepted at. Append-only.
- **State machines** in `packages/shared/state`: application, invite, price request.
- **Reason codes** (admin-editable labels): rejecting an application and rejecting a price (for example `above_market`, `wrong_product`, `mrp_mismatch`, `other`).

### API

- **Public:**
  - `POST /v1/partner-applications`: Turnstile, rate limit per IP and per phone, Zod strict.
  - `GET /v1/partner-invites/{token}`: returns the prefill only (name, email, phone masked except the last 4 digits); rate limited.
  - `POST /v1/partner-invites/{token}/application`: an invited submission.
- **Admin** (`partners:write`, city-scoped):
  - list and show applications; approve (with the delivery area: PIN codes, charge and days, pre-filled from the city), reject;
  - create, revoke and resend invites;
  - the price request queue: approve, reject (`prices:approve`, a new permission given to `ops_manager`, `city_manager` and `super_admin`);
  - agreement versions (`content:write`).
- **Shop** (`inventory:write`, own shop only):
  - submit, list and withdraw price requests;
  - accept the agreement.
  - `PATCH …/inventory` no longer changes `sellingPaise` for shop roles (`409 PRICE_NEEDS_APPROVAL`, use a request instead); stock and on/off stay direct.
- **Geocoding search:** `GET /api/geo/search?q=` (web route, like `/api/geo/pincode`):
  - Nominatim limited to India, 1 request/s upstream, 10/min per client, 1-day cache;
  - runs only when the seller presses Search.

### Screens (web; demo store until the data switch)

- **`/partners/apply/seller`:**
  - GST block: "I have a GSTIN" / "I have a GST enrolment number" (a short note on who needs which);
  - business and shop name;
  - address;
  - **location button**: a dialog with a MapLibre map (dynamically loaded), "Use my location", a search field with a Search button, a draggable pin and "Confirm this location"; shows the accuracy;
  - **products**: "Add products you sell" opens a searchable list grouped by category with tick-boxes and a selected count;
  - consent.
- **`/partners/invite/[token]`:** the same form with name, email and phone prefilled and locked, and an "Invited by MechDost" note.
- **Admin:**
  - Applications: a card with a checklist and a duplicate-GSTIN warning.
  - Invites: a form plus a list with status and copy link.
  - Prices: a queue with product, shop, old → new price, MRP, approve, and reject with a reason.
- **Shop portal:**
  - an "Agreement" card (placeholder text until Q77);
  - "Set your prices": the ticked products with price and stock inputs and a status per line (Waiting for approval / On sale / Not approved: reason).
- **Events:**
  - `partner_application_submitted` (kind, source, `gst_status`, product count, location source);
  - `partner_invite_sent` / `partner_invite_opened`;
  - `price_request_submitted` / `price_request_decided` (approved or rejected, reason code);
  - `agreement_accepted`.

### Tests (acceptance)

- **GSTIN checksum** (valid, wrong check character, bad state code); enrolment-number format.
- **Applications:**
  - a public application without Turnstile is refused;
  - rate limited per phone;
  - a duplicate GSTIN is flagged;
  - foreign ids return 404.
- **Invites:**
  - single use, expired or revoked links are refused;
  - an invited submission is approved without review;
  - the phone still needs OTP to create the account.
- **Price requests:**
  - one pending per shop and product;
  - approval puts it on sale at that price;
  - a rejected line is not offered for that shop and the next nearby shop serves the PIN;
  - a later change keeps the old price while it waits; a rejected change takes the product off sale for that shop (orders already placed continue) until a new price is approved;
  - a shop `PATCH` of the price returns 409;
  - an admin price set is direct.
- **Delivery area:** approval writes `shop_pincodes`; a shop without any is never priced or routed.
- **Agreement:** without acceptance the shop is not routable (while required); acceptance is append-only.
- **Web:** the form at 390, 768 and 1440 px, keyboard-only, `/hi` Hindi coverage, axe; the map dialog has a non-map fallback (search and PIN), and the JS budget holds.

## Left to the builder

Exact column names and indexes, file layout, copy wording (en + hi, short and plain), reason-code lists, rate-limit numbers within spec 13's ranges, and the order of the slices in the plan.

## Calls I made (for the user to check)

- **"GSTIN or enrolment number"** instead of "GSTIN or declaration", so small non-GST Raipur shops can join legally.
- **Phone OTP still required** for invited sellers (the email counts as verified through the link). Q78.
- **Agreement acceptance required once**, before a new shop goes live (one-time gate, behind an admin setting). Live shops are never taken offline by a new version. Q77 can change it.
- **Enrolled (non-GST) shops can apply and be approved, but are not routable or used for pricing** until bills of supply exist (no zero-tax invoicing in this build).
- **The old price stays on sale** while a change waits for approval.
- **Stock changes need no approval;** only prices do.

## User answers (2026-11-13, after the builder check)

- **Delivery area:** the admin sets it at approval, pre-filled from the city's PIN codes with the standard charge and days.
- **A rejected price change takes the product off sale** for that shop until a new price is approved; orders already placed continue.
- **Approach 3** (every price is a request in one queue) confirmed.
- **Search runs when the seller presses Search** (no typeahead), because of the free provider's rules.
