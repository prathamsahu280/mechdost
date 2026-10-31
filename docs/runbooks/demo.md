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

## Suggested 10-minute walkthrough

1. **Home** (`/`) — hero, search box, trust strip, categories, popular products, "Know the work. Approve the cost.", partner teaser. Toggle **dark mode** (moon icon) and **हिंदी** in the header: everything switches, including prices and dates.
2. **Shop** — search "battery", filter by category, sort by price. Open **Exide XLTZ4A**: MRP + savings, availability, delivery time, specs. **Add to cart** → the header count updates.
3. **Cart → Checkout** — change quantity, see free delivery from ₹999. Place the order with a Raipur PIN (e.g. 492001); try 110001 to show the "not serviceable yet" message.
4. **Order tracking** — code `MD-RPR-2026-XXXXXX`. Timeline shows the real flow: _placed → confirming with a nearby shop (admin routing) → confirmed → packed → out for delivery → delivered_. Open **Demo controls → Simulate next update** to play the shop's actions.
5. **Find workshops** — enter PIN 492006 or **Use my location**; filter Car / SUV or EV. Open **Telibandha Car Clinic**: verified badge, hours, service menu with price ranges.
6. **Book** — pick services (the expected cost updates live), date and time → request `SR-RPR-…`. **Demo controls** → the workshop proposes a slot and cost → **Accept proposal** → appointment confirmed → vehicle received → work → ready.
7. **Account** — recent orders and service requests on this device.
8. **Ask MechDost** (floating button) — "I need 40 batteries, bulk price?" → bulk negotiation answer with WhatsApp hand-off; "book a service" → workshops. Esc closes it.

## What is real vs demo

| Real (production code)                                                                                                        | Demo (replaced in Phase 1)                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Design system, light/dark themes, English/Hindi, accessibility (WCAG 2.2 AA tested), responsive 320–1920 px, analytics events | Product and workshop data (`apps/web/src/demo/*`)             |
| Database schema + integrity rules, API (auth, RBAC, rate limits) on Supabase                                                  | Cart/orders/requests stored in the browser                    |
| Order and service state machines, money/GST maths                                                                             | "Demo controls" stand in for shop, workshop and admin actions |
| Assistant UI                                                                                                                  | Assistant answers are static (LLM later, spec 18)             |

Coming next: phone-OTP sign-in, admin routing console, shop/workshop portals, bulk-quote negotiation with admin (spec 19), payments.
