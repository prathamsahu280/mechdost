# Partner demo runbook (2026-11-02)

Everything below runs locally with demo data — no accounts or keys needed. Orders and service requests are stored only in the presenting browser (clear site data to reset).

## Start

```
cd C:\Users\Admin\Desktop\automart
pnpm install
pnpm --filter @mechdost/web build
pnpm --filter @mechdost/web start      # http://localhost:3000
```

Use Chrome. For the phone view press F12 → device toolbar → 390 px wide.

## Demo logins (password `Raipur@2026` for every number; staff code `123456`)

| Role                                                         | Number     | Lands on            |
| ------------------------------------------------------------ | ---------- | ------------------- |
| Customer (Ravi Sahu)                                         | 9876543210 | `/account`          |
| Shop owner — Sharma Auto Parts                               | 9000000001 | `/partner/shop`     |
| Shop owner — Raipur Battery Point                            | 9000000004 | `/partner/shop`     |
| Workshop — Telibandha Car Clinic                             | 9000000002 | `/partner/workshop` |
| Admin                                                        | 9000000003 | `/admin`            |
| Shop owner — Gupta Lubes & Spares (MechDost delivery agents) | 9000000006 | `/partner/shop`     |
| Delivery agent — Sunil Yadav (motorcycle, online)            | 9000000005 | `/partner/delivery` |
| Delivery agent — Deepak Sahu (three-wheeler, offline)        | 9000000007 | `/partner/delivery` |

Sign in with the number **or** the email and the password; the admin also enters the code `123456`. "Create an account" signs up a new customer (phone → code `123456` → name, email, password, confirm). "Forgot password?" offers a code to the phone or an email link (the demo shows the link on screen instead of sending mail). The chips on `/login` fill the number and password.

**Full loop to show:** place an order as a guest or customer → sign in as admin → **Order routing** → route to the recommended shop → sign in as that shop → accept (or decline with a reason → admin reroutes) → mark packed → mark out for delivery → open the order page: the customer's **4-digit delivery code** → back in the shop portal enter that code to mark it delivered (5 wrong codes lock it; admin can confirm without the code with a reason). Same for service requests: book at Telibandha Car Clinic → workshop login → propose slot + cost → customer accepts on the request page.

**Delivery agents loop (spec 24):** order a lubricant (e.g. Castrol Activ) → admin routes it to **Gupta Lubes &
Spares** → sign in as Gupta (9000000006) → accept → mark packed → **Mark ready for pickup** (the shop sees a 4-digit
pickup code) → admin → **Delivery** → Jobs → Open → **Offer to Sunil Yadav** → sign in as Sunil (9000000005) →
Offers → **Accept** → I'm at the shop → type the shop's pickup code + take a photo → the customer's details appear →
I'm at the customer → type the customer's delivery code (on the order page) + a photo → delivered → the customer
rates the delivery. Try **Couldn't deliver** → admin "Send it back to the shop" → the agent's return code → the shop
types it → the order shows the refund wording. Admin → Delivery → Payouts records a manual payout; Sunil sees it under
Profile → Earnings. The browser demo has no payments: its orders count as prepaid for the delivery mode.

## Suggested 10-minute walkthrough

1. **Home** (`/`) — hero, search box, trust strip, categories, popular products, "Know the work. Approve the cost.", partner teaser. Toggle **dark mode** (moon icon) and **हिंदी** in the header: everything switches, including prices and dates.
2. **Shop** — search "battery", filter by category, sort by price. Open **Exide XLTZ4A**: MRP + savings, availability, delivery time, specs. **Add to cart** → the header count updates.
3. **Cart → Checkout** — change quantity, see free delivery from ₹999. Place the order with a Raipur PIN (e.g. 492001); try 110001 to show the "not serviceable yet" message.
4. **Order tracking** — code `MD-RPR-2026-XXXXXX`. Timeline shows the real flow: _placed → confirming with a nearby shop (admin routing) → confirmed → packed → out for delivery → delivered_. Open **Demo controls → Simulate next update** to play the shop's actions.
5. **Find workshops** — enter PIN 492006 or **Use my location**; filter Car / SUV or EV. On the **map**: scroll to zoom, drag, tap a 🔧 pin (popup with rating, **View & book**, **Directions**; the matching card lights up), **Show on map** on any card, ⌖ locate me (re-sorts by distance), full screen, "show all". Open **Telibandha Car Clinic**: verified badge, hours, service menu with price ranges, location map, reviews.
6. **Book** — pick services (the expected cost updates live), date and time → request `SR-RPR-…`. **Demo controls** → the workshop proposes a slot and cost → **Accept proposal** → appointment confirmed → vehicle received → work → ready.
7. **Bulk order** — on a product page click **Need 10 or more? Ask for a bulk price** (or from the cart). Enter 40 units → **Send request** → the quote thread `QT-RPR-…`. Chat, then **Demo controls → Admin: reply / Admin: send an offer** → the offer card shows the final price and savings → **Accept offer** → a normal order `MD-RPR-…` is created and tracked like any other.
8. **Partners** (`/partners`) — apply as a seller, garage or mechanic with a real form → application status `PA-RPR-…`.
9. **Reviews** — every product and workshop page shows ratings and reviews; write one (it waits for admin approval). ⓘ on any product card shows quick details.
10. **Account** — recent orders, service requests and bulk quotes on this device.
11. **Ask MechDost** (floating button) — "I need 40 batteries, bulk price?" → opens the bulk-quote form; "book a service" → workshops. Esc closes it.

## Catalogue on the API (data mode `api`, local only)

1. API on :4000 with the demo catalogue: `pnpm db:seed:demo` once, then in `apps/api`: `CORS_ORIGINS=http://localhost:3100 pnpm exec tsx --env-file-if-exists=../../.env src/server.ts`.
2. Web build: `NEXT_PUBLIC_DATA_MODE=api NEXT_PUBLIC_API_URL=http://localhost:4000 pnpm --filter @mechdost/web build`.
3. Tests (in `apps/web`): `E2E_DATA_MODE=api CATALOGUE_PAGE_SIZE=8 NEXT_PUBLIC_API_URL=http://localhost:4000 pnpm exec playwright test e2e/catalogue-api.spec.ts --workers=1` (8 per page so the 20 demo products span pages). Hindi: add `e2e/hindi-coverage.spec.ts`.
4. API-down check: stop the API, then `E2E_DATA_MODE=api E2E_API_DOWN=1 NEXT_PUBLIC_API_URL=http://localhost:4000 pnpm exec playwright test e2e/catalogue-api.spec.ts --workers=1` → the retry message, focused.
5. Rebuild in demo mode (`pnpm --filter @mechdost/web build`) before any other e2e run.

## What is real vs demo

| Real (production code)                                                                                                        | Demo (replaced in Phase 1)                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Design system, light/dark themes, English/Hindi, accessibility (WCAG 2.2 AA tested), responsive 320–1920 px, analytics events | Product and workshop data (`apps/web/src/demo/*`)                 |
| Database schema + integrity rules, API (auth, RBAC, rate limits) on Supabase                                                  | Cart/orders/requests stored in the browser                        |
| Order and service state machines, money/GST maths                                                                             | "Demo controls" stand in for shop, workshop and admin actions     |
| Assistant UI + `POST /v1/assistant/messages` (Anthropic, needs a key)                                                         | Assistant answers in the web app are static until wired (spec 18) |

### Demo catalogue in the database (2026-11-03)

`pnpm db:seed:demo` loads the same 20 products, 9 categories, 4 shops (with stock and delivery to the 5 demo PIN codes) and their Hindi texts into the database `.env` points at, so the catalogue API (`GET /v1/catalogue/…`, spec 02) serves what the web demo shows. Safe to re-run (upserts; stock never drops below what is reserved). Refuses `NODE_ENV=production`. Shops other than the first in a category price 3 % higher, so the "nearest covering shop sets the price" rule is visible: e.g. Castrol Activ is ₹440 from Sharma Auto Parts but ₹453 for PIN 492099, served by Gupta Lubes & Spares. **Before public launch (Q21): `pnpm db:seed:demo --remove`** (rolls back if any demo product is already in an order — archive those instead). The data file `packages/db/seed/raipur-demo.json` is generated from the web demo data; `apps/web/test/demo-seed-fixture.test.ts` fails when they drift (regenerate with `UPDATE_DEMO_SEED=1`). Loaded into the dev database 2026-11-03.

Coming next: demo sign-in for every role, reworked account section, admin console (routing, quotes, applications, reviews), shop/workshop portals, then phone-OTP sign-in with Firebase and payments.
