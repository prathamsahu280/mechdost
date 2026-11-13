# Admin catalogue screen with admin PIN prices: short design

User (2026-11-13):

- **Q82:** "Now, before the switch".
- **Q26:** "admin can set the price for the pincodes but the admin would get suggestions based on the nearest shop prices".
- **Q11:** MechDost keeps the **margin** between the admin price and the shop's approved price.
- **Design answers:**
  - city price + PIN overrides;
  - suggestions show the nearest shop, the lowest and the highest;
  - a price below the shop price is **blocked**;
  - "no admin price" is **decide later** (Q83, interim default below).

## Intent

MechDost, not each shop, decides what the customer pays in each area. Shops keep their own approved price (what they are paid); the difference is MechDost's margin. The admin needs one screen to manage everything about a product: texts (English and Hindi), vehicle types, comparison specs, pack sizes and prices.

## What it does

- **Admin → Catalogue (new section):** a product list (search, category, status, "missing Hindi"), then a product page with tabs:
  - **Texts:** English and Hindi side by side (the API exists: `PATCH /v1/admin/catalogue/products/{slug}`).
  - **Fit and specs:** vehicle types (API exists); typed attributes and pack sizes (API exists, comparison work).
  - **Prices:** per pack (variant), a **city price** plus **PIN overrides**. Each PIN row shows suggestions: the nearest stocked shop's approved price, the lowest and highest approved price among shops delivering there, and MRP.
- **Customer price** = PIN override, else city price, else (**interim default, Q83**) the nearest stocked shop's price, as today.
- **Rules:**
  - An admin price can never exceed **MRP** (Legal Metrology).
  - It can never be **below the shop price**: saving is refused when no delivering shop's approved price is at or below it, and routing only offers an order to shops whose approved price is at or below the customer price. So MechDost never loses money on an order.
- **Orders snapshot both prices:** each order item stores the customer unit price and the shop's unit price, and the margin is their difference (Q11; the payout ledger uses it later).
- **Admin control and audit:** every price change is versioned (compare-and-set) and audited (who, before, after); `products:write` edits texts and specs, and a new permission `prices:write` edits prices (finance and ops managers).

## Approaches

1. **Admin price table plus resolution in the catalogue and checkout reads (chosen).** A new `admin_prices` table (variant, city, optional PIN, price, version, audit) is read by the same queries that pick the shop today. Prices stay one SQL read, and the shop and routing logic is unchanged.
2. **Write the admin price into each shop's inventory row.** Fewer reads, but it loses the shop's own price, which Q11 needs for the margin.
3. **A price service computed on request.** Flexible, but adds a layer for no gain at this size.

## Where it runs

The admin screen calls the real API with a real staff sign-in, so it is **usable on the live site after the website switch** (the live site is in demo sign-in mode today). It is built and tested now against the API locally, as the user chose.

## Left to the builder

- Screen layout within the design system.
- A CSV bulk-price import (later).
- How suggestions are cached.
- The `prices:write` role grants.
- Showing the margin to staff in the order view.
