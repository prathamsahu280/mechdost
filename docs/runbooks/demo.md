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

## Demo logins (code 123456 for every number)

| Role                              | Number     | Lands on            |
| --------------------------------- | ---------- | ------------------- |
| Customer (Ravi Sahu)              | 9876543210 | `/account`          |
| Shop owner — Sharma Auto Parts    | 9000000001 | `/partner/shop`     |
| Shop owner — Raipur Battery Point | 9000000004 | `/partner/shop`     |
| Workshop — Telibandha Car Clinic  | 9000000002 | `/partner/workshop` |
| Admin                             | 9000000003 | `/admin`            |

Any other Indian mobile number creates a new customer account (name + email). The chips on `/login` fill these numbers.

**Full loop to show:** place an order as a guest or customer → sign in as admin → **Order routing** → route to the recommended shop → sign in as that shop → accept (or decline with a reason → admin reroutes) → mark packed → open the order page: "Fulfilled by …" and the timeline update. Same for service requests: book at Telibandha Car Clinic → workshop login → propose slot + cost → customer accepts on the request page.

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

## What is real vs demo

| Real (production code)                                                                                                        | Demo (replaced in Phase 1)                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Design system, light/dark themes, English/Hindi, accessibility (WCAG 2.2 AA tested), responsive 320–1920 px, analytics events | Product and workshop data (`apps/web/src/demo/*`)                 |
| Database schema + integrity rules, API (auth, RBAC, rate limits) on Supabase                                                  | Cart/orders/requests stored in the browser                        |
| Order and service state machines, money/GST maths                                                                             | "Demo controls" stand in for shop, workshop and admin actions     |
| Assistant UI + `POST /v1/assistant/messages` (Anthropic, needs a key)                                                         | Assistant answers in the web app are static until wired (spec 18) |

Coming next: demo sign-in for every role, reworked account section, admin console (routing, quotes, applications, reviews), shop/workshop portals, then phone-OTP sign-in with Firebase and payments.
